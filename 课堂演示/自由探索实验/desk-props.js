import * as THREE from 'three';
import { loadModel } from './packed-model.js';

const glassVertex = `
  varying vec3 eyeToGlass, glassNormal, glassPoint;
  void main() {
    vec4 eyePoint = modelViewMatrix * vec4(position,1.);
    eyeToGlass = -eyePoint.xyz;
    glassNormal = normalize(normalMatrix*normal);
    glassPoint = (modelMatrix*vec4(position,1.)).xyz;
    gl_Position = projectionMatrix*eyePoint;
  }
`;

const glassFragment = `
  varying vec3 eyeToGlass, glassNormal, glassPoint;
  void main() {
    vec3 eye = normalize(eyeToGlass);
    vec3 normal = normalize(glassNormal);
    float incidence = abs(dot(eye,normal));
    float fresnel = pow(1.-incidence,3.4);
    vec3 reflection = reflect(-eye,normal);
    float window = smoothstep(.90,.994,dot(reflection,normalize(vec3(-.55,.32,.72))));
    float wick = 1.-smoothstep(.0,.066,abs(glassPoint.y-.952));
    float surface = .96 + .04*sin(285.*glassPoint.x + sin(181.*glassPoint.y));
    vec3 color = mix(vec3(.49,.34,.18),vec3(.67,.81,.93),clamp(window + .69*fresnel,0.,1.));
    gl_FragColor = vec4(color*surface,.025+.24*fresnel+.29*window+.025*wick);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

const surfaceGrain = new Map([
  ['desk-iron', [.22, 155]],
  ['desk-brass', [.21, 210]],
  ['desk-soot', [.19, 220]],
  ['desk-glaze', [.14, 110]],
  ['desk-clay', [.17, 195]],
  ['desk-rim', [.18, 120]],
  ['desk-pencil', [.22, 220]],
  ['desk-cutwood', [.19, 345]],
]);

function ageMaterial(material, [amount, scale]) {
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 deskGrainPoint;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ndeskGrainPoint=(modelMatrix*vec4(position,1.)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 deskGrainPoint;')
      .replace('#include <color_fragment>', `
        #include <color_fragment>
        vec3 grain = deskGrainPoint * ${scale.toFixed(1)};
        float worn = sin(grain.x + 1.7*sin(grain.y*.41))*cos(grain.z + .8*sin(grain.y));
        float fine = sin(dot(grain,vec3(3.3,1.9,2.7)));
        diffuseColor.rgb *= 1. + ${amount.toFixed(2)}*(worn*.55 + fine*.17);
      `);
  };
  material.customProgramCacheKey = () => 'desk-grain:'+material.name;
}

function roomReflections() {
  const image=document.createElement('canvas');
  image.width=256;
  image.height=128;
  const brush=image.getContext('2d');
  const surround=brush.createLinearGradient(0,0,0,128);
  surround.addColorStop(0,'#4d4842');
  surround.addColorStop(.48,'#655447');
  surround.addColorStop(1,'#3a2d24');
  brush.fillStyle=surround;
  brush.fillRect(0,0,256,128);
  const sky=brush.createRadialGradient(68,42,4,68,42,41);
  sky.addColorStop(0,'#cdd7e5');
  sky.addColorStop(.44,'#a9baccc0');
  sky.addColorStop(1,'#a9bacc00');
  brush.fillStyle=sky;
  brush.fillRect(15,0,117,92);
  const texture=new THREE.CanvasTexture(image);
  texture.mapping=THREE.EquirectangularReflectionMapping;
  texture.colorSpace=THREE.SRGBColorSpace;
  return texture;
}

export async function createDeskProps(source) {
  const group = await loadModel(source);
  const pencil=group.getObjectByName('削过的木杆铅笔');
  if (pencil) pencil.position.z-=.055;
  const materials = new Set(), geometries = new Set(), flames = [];
  const glass = new THREE.ShaderMaterial({
    vertexShader: glassVertex, fragmentShader: glassFragment,
    transparent: true, depthWrite: false, side: THREE.FrontSide,
  });
  const reflections=roomReflections();
  const treated = new Set();
  group.traverse(object => {
    if (!object.isMesh) return;
    geometries.add(object.geometry);
    const material = object.material;
    const name = material.name;
    materials.add(material);
    if (name === 'desk-glass') {
      object.material = glass;
      object.renderOrder = 4;
      return;
    }
    if (name === 'desk-flame-amber' || name === 'desk-flame-core') {
      const core = name.endsWith('core');
      const glow = new THREE.MeshBasicMaterial({
        color: core ? 0xffe5b0 : 0xffa747, toneMapped: false,
      });
      object.material = glow;
      object.renderOrder = 3;
      materials.add(glow);
      flames.push({object, rest: object.scale.clone(), core});
      return;
    }
    if (!treated.has(material)) {
      treated.add(material);
      const grain = surfaceGrain.get(name);
      if (grain) ageMaterial(material,grain);
      material.envMap=reflections;
      material.envMapIntensity=name==='desk-tea' ? .28 : .75;
      if (name==='desk-iron' || name==='desk-brass') {
        material.metalness*=.69;
        material.roughness=Math.max(material.roughness,.61);
      }
    }
    object.castShadow = name !== 'desk-tea';
    object.receiveShadow = true;
  });
  materials.add(glass);
  if (flames.length !== 2) {
    reflections.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
    throw new Error('桌边提灯缺少焰芯或外焰');
  }
  return {
    group,
    flicker(time) {
      const wave = Math.sin(time*4.9 + .3), drift = Math.sin(time*8.1 + 1.8);
      for (const {object,rest,core} of flames) {
        object.scale.set(rest.x*(1+.035*drift),rest.y*(1+.070*wave+.032*drift),rest.z*(1-.035*drift));
        object.rotation.z = .030*drift*(core ? .65 : 1);
      }
    },
    dispose() {
      group.removeFromParent();
      reflections.dispose();
      for (const material of materials) material.dispose();
      for (const geometry of geometries) geometry.dispose();
    },
  };
}
