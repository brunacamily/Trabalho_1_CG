"use strict";

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

    map_Kd(parts, unparsedArgs)   { material.diffuseMap = parseMapArgs(unparsedArgs); },
    map_Ns(parts, unparsedArgs)   { material.specularMap = parseMapArgs(unparsedArgs); },
    map_Bump(parts, unparsedArgs) { material.normalMap = parseMapArgs(unparsedArgs); },
    
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
  in vec2 a_texcoord;
  in vec4 a_color;

  uniform mat4 u_projection;
  uniform mat4 u_view;
  uniform mat4 u_world;
  uniform vec3 u_viewWorldPosition;

  out vec3 v_normal;
  out vec3 v_surfaceToView;
  out vec2 v_texcoord;
  out vec4 v_color;

  void main() {
    vec4 worldPosition = u_world * a_position;
    gl_Position = u_projection * u_view * worldPosition;
    v_surfaceToView = u_viewWorldPosition - worldPosition.xyz;
    v_normal = mat3(u_world) * a_normal;
    v_texcoord = a_texcoord;
    v_color = a_color;
  }
  `;

  const fs = `#version 300 es
  precision highp float;

  in vec3 v_normal;
  in vec3 v_surfaceToView;
  in vec2 v_texcoord;
  in vec4 v_color;

  uniform vec3 diffuse;
  uniform sampler2D diffuseMap;
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

    vec4 diffuseMapColor = texture(diffuseMap, v_texcoord);
    vec3 effectiveDiffuse = diffuse * diffuseMapColor.rgb * v_color.rgb;
    float effectiveOpacity = opacity * diffuseMapColor.a * v_color.a;

    outColor = vec4(
        emissive +
        ambient * u_ambientLight +
        effectiveDiffuse * fakeLight +
        specular * pow(specularLight, shininess),
        effectiveOpacity);
  }
  `;


  // compila e vincula os shaders, localiza os atributos e as localizações dos uniformes
  const meshProgramInfo = twgl.createProgramInfo(gl, [vs, fs]);

  const objHref = ["OBJs/Tree 1.obj", "OBJs/Tree2.obj", "OBJs/Tree 3.obj", "OBJs/Tree 4.obj", "OBJs/Tree 5.obj"];  

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
  
        
  const textures = {
    defaultWhite: twgl.createTexture(gl, {src: [255, 255, 255, 255]}),
  };

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

    // load texture for materials
    for (const material of Object.values(materials1[index])) {
      Object.entries(material)
        .filter(([key]) => key.endsWith('Map'))
        .forEach(([key, filename]) => {
          let texture = textures[filename];
          if (!texture) {
            const textureHref = new URL(filename, baseHref1[index]).href;
            texture = twgl.createTexture(gl, {src: textureHref, flipY: true});
            textures[filename] = texture;
          }
          material[key] = texture;
        });
    }

    const defaultMaterial = {
      diffuse: [1, 1, 1],
      diffuseMap: textures.defaultWhite,
      ambient: [0, 0, 0],
      specular: [1, 1, 1],
      shininess: 400,
      opacity: 1,
    };
    
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
        material:  {...defaultMaterial, ...materials1[index][material]},//material: {materials1[index][material], defaultMaterial}, // Ajustando material indexado
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
    addOBJnaLista(ii);
  }

  function addOBJnaLista(index) {
    // Cria um objeto.
    const object = {
      uniforms: {
        u_world: m4.identity(),
      },
      tipo: index,
      material: null, // Material será atribuído abaixo
    };

    objects.push(object);

    // Adiciona à lista de coisas para desenhar.
    parts[index].forEach(({ bufferInfo, vao, material }) => {
      // Criar uma cópia do material para este objeto
      const materialClone = { ...material };

      objectsToDraw.push({
        programInfo: meshProgramInfo,
        bufferInfo: bufferInfo,
        vertexArray: vao,
        material: materialClone, // Cada objeto tem seu próprio material
        uniforms: object.uniforms,
        tipo: object.tipo,
      });

      // Armazena o material individual no objeto também (caso precise acessar depois)
      object.material = materialClone;
    });
  }

  // Função para desenhar os objetos
  function drawObjects(objectsToDraw) {
    objectsToDraw.forEach(function (object) {

      const programInfo = object.programInfo;

      gl.useProgram(programInfo.program);

      gl.bindVertexArray(object.vertexArray);

      twgl.setUniforms(programInfo, object.uniforms, object.material);

      twgl.drawBufferInfo(gl, object.bufferInfo);
    });
  }

  function xTranslationOBJ(index) {
    return function(event, ui) {
      objects[index].uniforms.u_world[12] = ui.value;
    };
  }

  function yTranslationOBJ(index) {
    return function(event, ui) {
      objects[index].uniforms.u_world[13] = ui.value;
    };
  }

  function scalingOBJ(index) {
    return function(event, ui) {
      objects[index].uniforms.u_world[0] = ui.value;
      objects[index].uniforms.u_world[5] = ui.value;
      objects[index].uniforms.u_world[10] = ui.value;
    };
  }
  
  function salvarJSON(objetos) {
    const listaObjetos = [];

    for (let i = 5; i < objetos.length; i++) {
        const obj = {
            tipoArv: objetos[i].tipo, // Valor padrão, pode ser alterado conforme necessário

             matrix: {
                // Translação (posição no espaço 3D)
              positionX: objetos[i].uniforms.u_world[12],
              positionY: objetos[i].uniforms.u_world[13],
              positionZ: objetos[i].uniforms.u_world[14], 

              // Escala (fatores de escala ao longo de cada eixo)
              scaleX: objetos[i].uniforms.u_world[0],
              scaleY: objetos[i].uniforms.u_world[5],
              scaleZ: objetos[i].uniforms.u_world[10],

              // Rotação (extraída da matriz de rotação)
              rotationXY: objetos[i].uniforms.u_world[1],  // Influência no eixo X e Y
              rotationXZ: objetos[i].uniforms.u_world[2],  // Influência no eixo X e Z
              rotationYX: objetos[i].uniforms.u_world[4],  // Influência no eixo Y e X
              rotationYZ: objetos[i].uniforms.u_world[6],  // Influência no eixo Y e Z
              rotationZX: objetos[i].uniforms.u_world[8],  // Influência no eixo Z e X
              rotationZY: objetos[i].uniforms.u_world[9],  // Influência no eixo Z e Y
              },

              // ajustar para guardar somente o diffuse !!!!!!!!!
              material: {
                diffuse: objetos[i].material.diffuse,	
                diffuseMap: objetos[i].material.diffuseMap,
                ambient: objetos[i].material.ambient,
                specular: objetos[i].material.specular, 
                shininess: objetos[i].material.shininess,
                opacity: objetos[i].material.opacity, // Se não existir, assume 1
                emissive: objetos[i].material.emissive , // Se não existir, assume [0, 0, 0]
                opticalDensity: objetos[i].material.opticalDensity , // Se não existir, assume 1.45
                illum: objetos[i].material.illum
            }
        };

        listaObjetos.push(obj);
    }

    // Converter para JSON
    const jsonString = JSON.stringify(listaObjetos, null, 2);
    
    // Criar um blob (arquivo temporário)
    const blob = new Blob([jsonString], { type: 'application/json' });
    
    // Criar um link de download
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'dados.json';
    
    // Adicionar o link na página e simular o clique
    document.body.appendChild(link);
    link.click();
    
    // Remover o link após o download
    document.body.removeChild(link);
  
  }

  function carregaJSON(objetos) {

    // Criar um input do tipo file para carregar o arquivo
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
  
    input.onchange = (event) => {
      const file = event.target.files[0]; // Obter o arquivo selecionado
      const reader = new FileReader();
      
      reader.onload = () => {
        // Parse o JSON para objeto
        const data = JSON.parse(reader.result);
        
        // Aqui, ajusta os objetos carregados conforme a estrutura do arquivo JSON
        for (let i = 0; i < data.length; i++) {
          const objeto = data[i];  // Objeto carregado do JSON
          addOBJnaLista(objeto.tipoArv)
          // Atualizar as propriedades do objeto com os dados do arquivo JSON
          //objetos[i].tipo = objeto.tipoArv; 
          objetos[objects.length - 1].material.diffuse = objeto.material.diffuse;
          objetos[objects.length - 1].material.diffuseMap = textures.defaultWhite;
          objetos[objects.length - 1].material.ambient = objeto.material.ambient;
          objetos[objects.length - 1].material.specular = objeto.material.specular;
          objetos[objects.length - 1].material.shininess = objeto.material.shininess;
          objetos[objects.length - 1].material.opacity = objeto.material.opacity;
          objetos[objects.length - 1].material.emissive = objeto.material.emissive;
          objetos[objects.length - 1].material.opticalDensity = objeto.material.opticalDensity;
          objetos[objects.length - 1].material.illum = objeto.material.illum;
  
          // Atualizar a matriz (matriz de transformação 3D)
          objetos[objects.length - 1].uniforms.u_world[12] = objeto.matrix.positionX;
          objetos[objects.length - 1].uniforms.u_world[13] = objeto.matrix.positionY;
          objetos[objects.length - 1].uniforms.u_world[14] = objeto.matrix.positionZ;
          objetos[objects.length - 1].uniforms.u_world[0] = objeto.matrix.scaleX;
          objetos[objects.length - 1].uniforms.u_world[5] = objeto.matrix.scaleY;
          objetos[objects.length - 1].uniforms.u_world[10] = objeto.matrix.scaleZ;
          objetos[objects.length - 1].uniforms.u_world[1] = objeto.matrix.rotationXY;
          objetos[objects.length - 1].uniforms.u_world[2] = objeto.matrix.rotationXZ;
          objetos[objects.length - 1].uniforms.u_world[4] = objeto.matrix.rotationYX;
          objetos[objects.length - 1].uniforms.u_world[6] = objeto.matrix.rotationYZ;
          objetos[objects.length - 1].uniforms.u_world[8] = objeto.matrix.rotationZX;
          objetos[objects.length - 1].uniforms.u_world[9] = objeto.matrix.rotationZY;
          addNewButton();
        }
      };
      
      reader.onerror = (error) => {
        console.error('Erro ao ler o arquivo JSON:', error);
      };
      
      reader.readAsText(file); // Lê o arquivo como texto
    };
  
    input.click(); // Dispara o evento de seleção de arquivo
  }
  

  // BOTÕES P/ ADICIONAR OBJ

  document.getElementById("av1").addEventListener("click", function () {
    addOBJnaLista(0);
    addNewButton();
  } );
  document.getElementById("av2").addEventListener("click", function () {
    addOBJnaLista(1);
    addNewButton();
  } );

  document.getElementById("av3").addEventListener("click", function () {
    addOBJnaLista(2);
    addNewButton();
  } );

  document.getElementById("av4").addEventListener("click", function () {
    addOBJnaLista(3);
    addNewButton();
  } );

  document.getElementById("av5").addEventListener("click", function () {
    addOBJnaLista(4);
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

  document.getElementById("salvar").addEventListener("click", function () {
    salvarJSON(objects);
  } );
  
  document.getElementById("carregar").addEventListener("click", function () {
    carregaJSON(objects);
} );
  
  function mudançasOBJ(indexOBJ) {
    webglLessonsUI.setupSlider("#x", {value: objects[indexOBJ].uniforms.u_world[12], slide: xTranslationOBJ(indexOBJ), min: -10, max: 10 });
    webglLessonsUI.setupSlider("#y", {value: objects[indexOBJ].uniforms.u_world[13], slide: yTranslationOBJ(indexOBJ), min: -30, max: 10 });
    webglLessonsUI.setupSlider("#scale", {value: objects[indexOBJ].uniforms.u_world, slide: scalingOBJ(indexOBJ), min: 0.1, max: 5, step: 0.1});

    // ---- ROTAÇÃO
    let rotationButton = document.getElementById("rotation");

    // Remove todos os event listeners anteriores para evitar múltiplas execuções
    let newButton = rotationButton.cloneNode(true);
    rotationButton.parentNode.replaceChild(newButton, rotationButton);

    // Adiciona um novo evento apenas para o objeto selecionado
    newButton.addEventListener("click", function () {
        let angle = Math.PI / 8; // 22,5 graus
        objects[indexOBJ].uniforms.u_world = m4.yRotate(objects[indexOBJ].uniforms.u_world, angle);
    });


    // ---- TEXTURA
    let textureButton = document.getElementById("texture");

    // Remove todos os event listeners anteriores para evitar múltiplas execuções, pq estava clicando 2x
    let newButtont = textureButton.cloneNode(true);
    textureButton.parentNode.replaceChild(newButtont, textureButton);

    newButtont.addEventListener("click", function () {
      
      if ( objects[indexOBJ].material.diffuse ==  objects[objects[indexOBJ].tipo].material.diffuse )
        objects[indexOBJ].material.diffuse = [1,0,0];
       else 
        objects[indexOBJ].material.diffuse = objects[objects[indexOBJ].tipo].material.diffuse ;   
    } );
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


  function render(time) {
    time *= 0.0005;
    twgl.resizeCanvasToDisplaySize(gl.canvas);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
    gl.enable(gl.DEPTH_TEST);

    const fieldOfViewRadians = degToRad(60);
    const aspect = gl.canvas.clientWidth / gl.canvas.clientHeight;
    const projection = m4.perspective(fieldOfViewRadians, aspect, zNear, zFar);

    const up = [0, 1, 0];
    // Calcula a matriz da câmera usando look at.
    const camera = m4.lookAt(cameraPosition, cameraTarget, up);

    // Cria uma matriz de visualização a partir da matriz da câmera.
    const view = m4.inverse(camera);


    // colocando os uniforms em object.uniform
    objects.forEach(function(object) {
      object.uniforms.u_lightDirection =  m4.normalize([-1, 3, 5]),
      object.uniforms.u_view = view,
      object.uniforms.u_projection = projection,
      object.uniforms.u_viewWorldPosition = cameraPosition
    });

    // objetos que ficam sob os botões
    objects[0].uniforms.u_world = m4.multiply(m4.scaling(0.48, 0.48, 0), m4.translation(23, 9, 0));
    objects[1].uniforms.u_world = m4.multiply(m4.scaling(0.34, 0.34, 0), m4.translation(42, 12, 0));
    objects[2].uniforms.u_world = m4.multiply(m4.scaling(0.23, 0.23, 0), m4.translation(47, -5, 0));
    objects[3].uniforms.u_world =  m4.multiply(m4.scaling(0.2, 0.2, 0), m4.translation(71, -6, 0));
    objects[4].uniforms.u_world = m4.multiply(m4.scaling(0.75, 0.75, 0), m4.translation(16.5, -8.5, 0));

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