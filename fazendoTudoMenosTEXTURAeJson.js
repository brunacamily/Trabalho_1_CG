"use strict";

// This is not a full .obj parser.
// see http://paulbourke.net/dataformats/obj/

function parseOBJ(text) {
  // because indices are base 1 let's just fill in the 0th data
  const objPositions = [[0, 0, 0]];
  const objTexcoords = [[0, 0]];
  const objNormals = [[0, 0, 0]];
  const objColors = [[0, 0, 0]];

  // same order as `f` indices
  const objVertexData = [
    objPositions,
    objTexcoords,
    objNormals,
    objColors,
  ];

  // same order as `f` indices
  let webglVertexData = [
    [],   // positions
    [],   // texcoords
    [],   // normals
    [],   // colors
  ];

  const materialLibs = [];
  const geometries = [];
  let geometry;
  let groups = ['default'];
  let material = 'default';
  let object = 'default';

  const noop = () => {};

  function newGeometry() {
    // If there is an existing geometry and it's
    // not empty then start a new one.
    if (geometry && geometry.data.position.length) {
      geometry = undefined;
    }
  }

  function setGeometry() {
    if (!geometry) {
      const position = [];
      const texcoord = [];
      const normal = [];
      const color = [];
      webglVertexData = [
        position,
        texcoord,
        normal,
        color,
      ];
      geometry = {
        object,
        groups,
        material,
        data: {
          position,
          texcoord,
          normal,
          color,
        },
      };
      geometries.push(geometry);
    }
  }

  function addVertex(vert) {
    const ptn = vert.split('/');
    ptn.forEach((objIndexStr, i) => {
      if (!objIndexStr) {
        return;
      }
      const objIndex = parseInt(objIndexStr);
      const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
      webglVertexData[i].push(...objVertexData[i][index]);
      // if this is the position index (index 0) and we parsed
      // vertex colors then copy the vertex colors to the webgl vertex color data
      if (i === 0 && objColors.length > 1) {
        geometry.data.color.push(...objColors[index]);
      }
    });
  }

  const keywords = {
    v(parts) {
      // if there are more than 3 values here they are vertex colors
      if (parts.length > 3) {
        objPositions.push(parts.slice(0, 3).map(parseFloat));
        objColors.push(parts.slice(3).map(parseFloat));
      } else {
        objPositions.push(parts.map(parseFloat));
      }
    },
    vn(parts) {
      objNormals.push(parts.map(parseFloat));
    },
    vt(parts) {
      // should check for missing v and extra w?
      objTexcoords.push(parts.map(parseFloat));
    },
    f(parts) {
      setGeometry();
      const numTriangles = parts.length - 2;
      for (let tri = 0; tri < numTriangles; ++tri) {
        addVertex(parts[0]);
        addVertex(parts[tri + 1]);
        addVertex(parts[tri + 2]);
      }
    },
    s: noop,    // smoothing group
    mtllib(parts, unparsedArgs) {
      // the spec says there can be multiple filenames here
      // but many exist with spaces in a single filename
      materialLibs.push(unparsedArgs);
    },
    usemtl(parts, unparsedArgs) {
      material = unparsedArgs;
      newGeometry();
    },
    g(parts) {
      groups = parts;
      newGeometry();
    },
    o(parts, unparsedArgs) {
      object = unparsedArgs;
      newGeometry();
    },
  };

  const keywordRE = /(\w*)(?: )*(.*)/;
  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
    const line = lines[lineNo].trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const m = keywordRE.exec(line);
    if (!m) {
      continue;
    }
    const [, keyword, unparsedArgs] = m;
    const parts = line.split(/\s+/).slice(1);
    const handler = keywords[keyword];
    if (!handler) {
      console.warn('unhandled keyword:', keyword);  // eslint-disable-line no-console
      continue;
    }
    handler(parts, unparsedArgs);
  }

  // remove any arrays that have no entries.
  for (const geometry of geometries) {
    geometry.data = Object.fromEntries(
        Object.entries(geometry.data).filter(([, array]) => array.length > 0));
  }

  return {
    geometries,
    materialLibs,
  };
}

function parseMapArgs(unparsedArgs) {
  // TODO: handle options
  return unparsedArgs;
}

function parseMTL(text) {
  const materials = {};
  let material;

  const keywords = {
    newmtl(parts, unparsedArgs) {
      material = {};
      materials[unparsedArgs] = material;
    },
    /* eslint brace-style:0 */
    Ns(parts)     { material.shininess      = parseFloat(parts[0]); },
    Ka(parts)     { material.ambient        = parts.map(parseFloat); },
    Kd(parts)     { material.diffuse        = parts.map(parseFloat); },
    Ks(parts)     { material.specular       = parts.map(parseFloat); },
    Ke(parts)     { material.emissive       = parts.map(parseFloat); },
    Ni(parts)     { material.opticalDensity = parseFloat(parts[0]); },
    d(parts)      { material.opacity        = parseFloat(parts[0]); },
    illum(parts)  { material.illum          = parseInt(parts[0]); },
  };

  const keywordRE = /(\w*)(?: )*(.*)/;
  const lines = text.split('\n');
  for (let lineNo = 0; lineNo < lines.length; ++lineNo) {
    const line = lines[lineNo].trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const m = keywordRE.exec(line);
    if (!m) {
      continue;
    }
    const [, keyword, unparsedArgs] = m;
    const parts = line.split(/\s+/).slice(1);
    const handler = keywords[keyword];
    if (!handler) {
      console.warn('unhandled keyword:', keyword);  // eslint-disable-line no-console
      continue;
    }
    handler(parts, unparsedArgs);
  }

  return materials;
}




async function main() {
  // Get A WebGL context
  /** @type {HTMLCanvasElement} */
  const canvas = document.querySelector("#canvas");
  const gl = canvas.getContext("webgl2");
  if (!gl) {
    return;
  }


  // Tell the twgl to match position with a_position etc..
  twgl.setAttributePrefix("a_");

  const vs = `#version 300 es
  in vec4 a_position;
  in vec3 a_normal;
  in vec4 a_color;

  uniform mat4 u_projection;
  uniform mat4 u_view;
  uniform mat4 u_world;
  uniform vec3 u_viewWorldPosition;

  out vec3 v_normal;
  out vec3 v_surfaceToView;
  out vec4 v_color;

  void main() {
    vec4 worldPosition = u_world * a_position;
    gl_Position = u_projection * u_view * worldPosition;
    v_surfaceToView = u_viewWorldPosition - worldPosition.xyz;
    v_normal = mat3(u_world) * a_normal;
    v_color = a_color;
  }
  `;

  const fs = `#version 300 es
  precision highp float;

  in vec3 v_normal;
  in vec3 v_surfaceToView;
  in vec4 v_color;

  uniform vec3 diffuse;
  uniform vec3 ambient;
  uniform vec3 emissive;
  uniform vec3 specular;
  uniform float shininess;
  uniform float opacity;
  uniform vec3 u_lightDirection;
  uniform vec3 u_ambientLight;

  out vec4 outColor;

  void main () {
    vec3 normal = normalize(v_normal);

    vec3 surfaceToViewDirection = normalize(v_surfaceToView);
    vec3 halfVector = normalize(u_lightDirection + surfaceToViewDirection);

    float fakeLight = dot(u_lightDirection, normal) * .5 + .5;
    float specularLight = clamp(dot(normal, halfVector), 0.0, 1.0);

    vec3 effectiveDiffuse = diffuse.rgb * v_color.rgb;
    float effectiveOpacity = v_color.a * opacity;

    outColor = vec4(
        emissive +
        ambient * u_ambientLight +
        effectiveDiffuse * fakeLight +
        specular * pow(specularLight, shininess),
        effectiveOpacity);
  }
  `;

  const pickingVS = `#version 300 es
  in vec4 a_position;
  
  uniform mat4 u_world;
  
  void main() {
    // Multiplica a posição pela matriz.
    gl_Position = u_world * a_position;
  }
  `;

  const pickingFS = `#version 300 es
    precision highp float;
    
    uniform vec4 u_id;

    out vec4 outColor;
    
    void main() {
      outColor = u_id;
    }
  `;

  // compila e vincula os shaders, localiza os atributos e as localizações dos uniformes
  const meshProgramInfo = twgl.createProgramInfo(gl, [vs, fs]);
  //const pickingProgramInfo = twgl.createProgramInfo(gl, [pickingVS, pickingFS], options);


  // procura as localizações dos uniforms

  const objHref = ["Tree 1.obj","Tree 2.obj", "Tree 3.obj", "Tree 4.obj", "Tree 5.obj"];  

  //+++++++++++++++++++++++++++++++++

  const response1 = [null, null, null, null, null];
  const text1 = [null, null, null, null, null];
  const obj1 = [null, null, null, null, null];
  const baseHref1 = [null, null, null, null, null];
  const matTexts1 = [null, null, null, null, null];
  const materials1 = [null, null, null, null, null];
  const bufferInfo1 = [null, null, null, null, null];
  const vao1 = [null, null, null, null, null];
  const parts = [[], [], [], [], []];

  for (let index = 0; index < 5; index++) {
    response1[index] = await fetch(objHref[index]);
    text1[index] = await response1[index].text();
    obj1[index] = parseOBJ(text1[index]);
    baseHref1[index] = new URL(objHref[index], window.location.href);
    matTexts1[index] = await Promise.all(obj1[index].materialLibs.map(async filename => {
      const matHref = new URL(filename, baseHref1[index]).href;
      const matResponse = await fetch(matHref); // Nome atualizado para evitar conflito
      return await matResponse.text();
    }));
    materials1[index] = parseMTL(matTexts1[index].join('\n'));

    parts[index] = obj1[index].geometries.map(({ material, data }) => {
      if (data.color) {
        if (data.position.length === data.color.length) {
          data.color = { numComponents: 3, data: data.color };
        }
      } else {
        data.color = { value: [1, 1, 1, 1] };
      }

      bufferInfo1[index] = twgl.createBufferInfoFromArrays(gl, data);
      vao1[index] = twgl.createVAOFromBufferInfo(gl, meshProgramInfo, bufferInfo1[index]);
      return {
        material: materials1[index][material], // Ajustando material indexado
        bufferInfo: bufferInfo1[index], // Corrigido para referenciar o índice correto
        vao: vao1[index], // Corrigido para referenciar o índice correto
      };
    });
  }

  //+++++++++++++++++++++++++++++++++

  // Cria informações para cada objeto.
  const objectsToDraw = [];
  const objects = [];
  
  for (let ii = 0; ii < 5; ++ii) {
    const id = ii + 1;
    addOBJnaLista(ii, id);

  }

  function addOBJnaLista(index, id) {
    
    // Cria um objeto.
    const object = {
      uniforms: {
        u_world: m4.identity(),
        u_id: [
          ((id >> 0) & 0xFF) / 0xFF,
          ((id >> 8) & 0xFF) / 0xFF,
          ((id >> 16) & 0xFF) / 0xFF,
          ((id >> 24) & 0xFF) / 0xFF,
        ],
      },
      translation: m4.translation(20, 0, 0),
      xRotationSpeed: 0,
      yRotationSpeed: 0,
    };

    objects.push(object);
  
    // Adiciona à lista de coisas para desenhar.
    parts[index].forEach(({ bufferInfo, vao, material }) => {
      objectsToDraw.push({
        programInfo: meshProgramInfo,
        bufferInfo: bufferInfo,
        vertexArray: vao,
        material: material,
        uniforms: object.uniforms,
      });
    });

  }
  


  function getExtents(positions) {
    const min = positions.slice(0, 3);
    const max = positions.slice(0, 3);
    for (let i = 3; i < positions.length; i += 3) {
      for (let j = 0; j < 3; ++j) {
        const v = positions[i + j];
        min[j] = Math.min(v, min[j]);
        max[j] = Math.max(v, max[j]);
      }
    }
    return {min, max};
  }

  function getGeometriesExtents(geometries) {
    return geometries.reduce(({min, max}, {data}) => {
      const minMax = getExtents(data.position);
      return {
        min: min.map((min, ndx) => Math.min(minMax.min[ndx], min)),
        max: max.map((max, ndx) => Math.max(minMax.max[ndx], max)),
      };
    }, {
      min: Array(3).fill(Number.POSITIVE_INFINITY),
      max: Array(3).fill(Number.NEGATIVE_INFINITY),
    });
  }

  const extents = getGeometriesExtents(obj1[0].geometries);
  const range = m4.subtractVectors(extents.max, extents.min);

  // quantidade necessária para mover o objeto para que seu centro fique na origem
  const objOffset = m4.scaleVector(
      m4.addVectors( extents.min, m4.scaleVector(range, 0.5)), -1
    );


  const cameraTarget = [0, 0, 0];
  // calcular a distância necessária para mover a câmera para que
  // possamos provavelmente ver o objeto.
  const radius = m4.length(range) * 1.2;
  const cameraPosition = m4.addVectors(cameraTarget, [ 0, 0, radius, ]);

  // Define zNear e zFar para algo, com sorte, apropriado
  // ao tamanho deste objeto.
  const zNear = radius / 100;
  const zFar = radius * 3;

  function degToRad(deg) {
    return deg * Math.PI / 180;
  }

  // Função para desenhar os objetos
  function drawObjects(objectsToDraw, overrideProgramInfo) {
    objectsToDraw.forEach(function (object) {

      const programInfo = overrideProgramInfo || object.programInfo;

      gl.useProgram(programInfo.program);

      gl.bindVertexArray(object.vertexArray);

      twgl.setUniforms(programInfo, object.uniforms, object.material);

      twgl.drawBufferInfo(gl, object.bufferInfo);
    });
  }

  function insereOBJ(index, id) {
    addOBJnaLista(index, 4);
  }

  function xRotationOBJ(index) {
  // Aplica a rotação no eixo X à matriz u_world
  objects[index].uniforms.u_world = m4.multiply(m4.rotationX(Math.PI / 4), objects[index].uniforms.u_world);
  
  }

  function xTranslationOBJ(index) {
    //objects[5].uniforms.u_world =  m4.translation(5, 0, 0);
    return function(event, ui) {
      objects[index].uniforms.u_world[12] = ui.value;
    };
  }

  function yTranslationOBJ(index) {
    //objects[5].uniforms.u_world =  m4.translation(5, 0, 0);
    return function(event, ui) {
      objects[index].uniforms.u_world[13] = ui.value;
    };
  }

  function zTranslationOBJ(index) {
    //objects[5].uniforms.u_world =  m4.translation(5, 0, 0);
    return function(event, ui) {
      objects[index].uniforms.u_world[14] = ui.value;
    };
  }

  function scalingOBJ(index) {
    return function(event, ui) {
      objects[index].uniforms.u_world[0] = ui.value;
      objects[index].uniforms.u_world[5] = ui.value;
      objects[index].uniforms.u_world[10] = ui.value;
    };
  }
  
  // BOTÕES P/ ADICIONAR OBJ

  document.getElementById("av1").addEventListener("click", function () {
    insereOBJ(0,0);
    addNewButton();
  } );
  document.getElementById("av2").addEventListener("click", function () {
    insereOBJ(1,0);
    addNewButton();
  } );

  document.getElementById("av3").addEventListener("click", function () {
    insereOBJ(2,0);
    addNewButton();
  } );

  document.getElementById("av4").addEventListener("click", function () {
    insereOBJ(3,0);
    addNewButton();
  } );

  document.getElementById("av5").addEventListener("click", function () {
    insereOBJ(4,0);
    addNewButton();
  } );

  // CAIXA P/ ESCOLHER BOTÕES
  let buttonCount = 0;

  // Função para adicionar um novo botão à caixa
  function addNewButton() {
      buttonCount++;

      let button = document.createElement("button");

      button.textContent = "Árvore " + buttonCount;

      // Adiciona um evento de clique ao botão recém-criado
      button.addEventListener("click", function() {
          mudançasOBJ(buttonCount + 4);
          //console.log(indexOBJ )
      });

      // Adiciona o botão ao container
      document.getElementById("buttonContainer").appendChild(button);
  }

  document.getElementById("buttonContainer").addEventListener("click", function(event) {
    if (event.target.tagName === "BUTTON") {
        let buttonIndex = parseInt(event.target.textContent.split(" ")[1]) + 4;
        mudançasOBJ(buttonIndex);
    }
  });
  
  
  function mudançasOBJ(indexOBJ) {
    webglLessonsUI.setupSlider("#x", {value: objects[indexOBJ].uniforms.u_world[12], slide: xTranslationOBJ(indexOBJ), min: -7, max: 7 });
    webglLessonsUI.setupSlider("#y", {value: objects[indexOBJ].uniforms.u_world[13], slide: yTranslationOBJ(indexOBJ), min: -30, max: 7 });
    //webglLessonsUI.setupSlider("#z", {value: objects[indexOBJ].uniforms.u_world[12], slide: zTranslationOBJ(indexOBJ), min: -7, max: 7 });
    webglLessonsUI.setupSlider("#scale", {value: objects[indexOBJ].uniforms.u_world, slide: scalingOBJ(indexOBJ), min: 0.1, max: 10, step: 0.1});

    let rotationButton = document.getElementById("rotation");

    // Remove todos os event listeners anteriores para evitar múltiplas execuções
    let newButton = rotationButton.cloneNode(true);
    rotationButton.parentNode.replaceChild(newButton, rotationButton);

    // Adiciona um novo evento apenas para o objeto selecionado
    newButton.addEventListener("click", function () {
        let angle = Math.PI / 8; // 22,5 graus
        objects[indexOBJ].uniforms.u_world = m4.yRotate(objects[indexOBJ].uniforms.u_world, angle);
    });
  }

  /// ===========

  function render(time) {
    time *= 0.0005;
    twgl.resizeCanvasToDisplaySize(gl.canvas);

    const fieldOfViewRadians = degToRad(60);
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const projection = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);

    const up = [0, 1, 0];
    // Calcula a matriz da câmera usando look at.
    const camera = m4.lookAt(cameraPosition, cameraTarget, up);

    // Cria uma matriz de visualização a partir da matriz da câmera.
    const view = m4.inverse(camera);

    const viewProjectionMatrix = m4.multiply(projection, view);

    // colocando os uniforms em object.uniform

    objects.forEach(function(object) {
      object.uniforms.u_lightDirection =  m4.normalize([-1, 3, 5]),
      object.uniforms.u_view = view,
      object.uniforms.u_projection = projection,
      object.uniforms.u_viewWorldPosition = cameraPosition
    });


    objects[0].uniforms.u_world = m4.multiply(m4.scaling(0.48, 0.48, 0), m4.translation(23, 9, 0));
    objects[1].uniforms.u_world = m4.multiply(m4.scaling(0.34, 0.34, 0), m4.translation(42, 12, 0));
    objects[2].uniforms.u_world = m4.multiply(m4.scaling(0.23, 0.23, 0), m4.translation(47, -5, 0));
    objects[3].uniforms.u_world =  m4.multiply(m4.scaling(0.2, 0.2, 0), m4.translation(71, -6, 0));
    objects[4].uniforms.u_world = m4.multiply(m4.scaling(0.75, 0.75, 0), m4.translation(16.5, -8.5, 0));

    //console.log(buttonCount);

   // ------ Desenhar os objetos no canvas

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);

    // Chama a função para desenhar os objetos
    drawObjects(objectsToDraw);

    requestAnimationFrame(render);
  }
  requestAnimationFrame(render);


}

main();