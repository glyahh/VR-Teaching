import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createRouteBoard } from './evidence.js';
import { loadModel } from './packed-model.js';
import { prepareFolio } from './folio-pages.js';

export const entrance = [0.9, 4.95];
export const scale = { left: -5.35, right: 5.35, back: -5.25, front: 5.65 };
export const roomEdge = -0.75;
export const spots = {
  route: {
    label: '行军图', stand: [-3.6, 2.62], reach: 1.55, accessFromZ: 2.09,
    anchor: [-3.6, 1.62, 1.68], focus: [-3.6, 1.12, 1.73],
  },
  record: {
    label: '会前材料', stand: [-1.75, -2.08], reach: 1.55,
    anchor: [-1.83, 1.21, -3.18], focus: [-1.81, 0.86, -3.12],
  },
};

// 与墙、门柱、桌椅的实际平面对应。两种操作使用同一组障碍。
export const obstacles = [
  [-5.46, 0.57, -0.91, -0.59], [2.23, 5.46, -0.91, -0.59],
  [-2.87, -0.55, -4.36, -2.73], [-4.7, -2.5, 1.33, 2.01],
  [-4.65, -3.17, -4.96, -4.45], [3.7, 5.05, 1.43, 1.9],
  [3.79, 5.2, -5.22, -3.99], [-5.13, -4.85, 0.37, 0.65], [-2.53, -2.25, 0.37, 0.65],
];

export async function createWorld(assets) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xaebcb7);
  scene.fog = new THREE.FogExp2(0xbfc8be, 0.023);

  const textureLoader = new THREE.TextureLoader();
  const fetchTexture = async (name, color = true) => {
    const texture = await textureLoader.loadAsync(assets[name]);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  };
  const materials = Object.fromEntries(await Promise.all([
    ['brick', '#bbb6a5', 1.9],
    ['wood', '#9e9890', 1.65],
    ['plaster', '#cbbfab', 1.55],
  ].map(async ([name, color, meters]) => {
    const [map, normalMap] = await Promise.all([
      fetchTexture(name), fetchTexture(name + '-normal', false),
    ]);
    const material = new THREE.MeshStandardMaterial({
      color, map, normalMap, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 0.9,
    });
    material.userData.meters = meters;
    return [name, material];
  })));
  const { brick, wood, plaster } = materials;
  const trim = wood.clone();
  trim.color.set('#716252');
  trim.userData.meters = 1.35;
  const iron = new THREE.MeshStandardMaterial({ color: 0x403932, metalness: 0.2, roughness: 0.78 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x86714f, metalness: 0.38, roughness: 0.68 });
  const clay = new THREE.MeshStandardMaterial({ color: 0x978575, roughness: 0.91 });
  const slab = new THREE.MeshStandardMaterial({ color: 0x5b5c4e, roughness: 0.96 });

  const occluders = [];
  function box(size, at, material, solid = false, parent = scene, radius = 0, grain = 0) {
    const geometry = radius ? new RoundedBoxGeometry(...size, 1, radius) : new THREE.BoxGeometry(...size);
    const meters = material.userData.meters;
    if (meters) {
      const [w, h, d] = size;
      const faces = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      const uv = geometry.attributes.uv;
      const faceSize = uv.count / faces.length;
      for (let i = 0; i < uv.count; i++) {
        const [u, v] = faces[Math.floor(i / faceSize)];
        uv.setXY(i, uv.getX(i) * u / meters + grain, uv.getY(i) * v / meters + 0.73 * grain);
      }
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    if (solid) occluders.push(mesh);
    return mesh;
  }

  box([11.55, 0.38, 11.88], [0, -0.24, 0.17], slab);
  const hall = await loadModel(assets['hall-model']);
  hall.traverse(part => {
    if (!part.isMesh) return;
    part.castShadow = part.receiveShadow = true;
    for (const material of Array.isArray(part.material) ? part.material : [part.material]) {
      if (material.map) material.map.anisotropy = 8;
      if (material.normalMap) material.normalMap.anisotropy = 4;
    }
  });
  scene.add(hall);

  box([11.16, 2.84, 0.22], [0, 1.42, -5.44], plaster, true);
  box([11.12, 0.3, 0.25], [0, 0.15, -5.29], brick);
  box([0.22, 2.62, 11.47], [-5.47, 1.31, 0.17], brick, true);
  box([0.22, 2.62, 11.47], [5.47, 1.31, 0.17], brick, true);
  box([11.1, 1.83, 0.22], [0, 0.915, 5.81], brick, true);
  box([0.27, 0.09, 11.54], [-5.47, 2.663, 0.17], trim);
  box([0.27, 0.09, 11.54], [5.47, 2.663, 0.17], trim);

  for (const x of [-4.6, 0.5, 4.7]) {
    box([0.094, 2.62, 0.085], [x, 1.31, -5.297], trim);
  }
  for (const [a, b, centers] of [[-5.36, 0.57, [-3.89, -1.82]], [2.23, 5.36, [3.97]]]) {
    const midpoint = (a + b) / 2;
    box([b - a, 1.04, 0.24], [midpoint, 0.52, roomEdge], brick, true);
    let edge = a;
    for (const center of centers) {
      const end = center - 0.66;
      box([end - edge, 1.21, 0.22], [(edge + end) / 2, 1.645, roomEdge], plaster, true);
      edge = center + 0.66;
    }
    box([b - edge, 1.21, 0.22], [(edge + b) / 2, 1.645, roomEdge], plaster, true);
    box([b - a, 0.63, 0.24], [midpoint, 2.54, roomEdge], plaster, true);
  }
  box([11.39, 0.16, 0.29], [0, 2.85, roomEdge], trim);
  box([10.98, 0.055, 4.45], [0, 2.83, -3.09], wood);
  {
    const sign = document.createElement('canvas');
    [sign.width, sign.height] = [512, 160];
    const ink = sign.getContext('2d');
    ink.fillStyle = '#372c20';
    ink.fillRect(0, 0, 512, 160);
    ink.strokeStyle = '#ae8c60';
    ink.lineWidth = 5;
    ink.strokeRect(10, 10, 492, 140);
    ink.fillStyle = '#eadab5';
    ink.font = 'bold 81px SimSun, serif';
    ink.textAlign = 'center';
    ink.fillText('材料厅', 256, 110);
    const texture = new THREE.CanvasTexture(sign);
    texture.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 0.275),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.9 }));
    plate.position.set(1.4, 2.59, roomEdge + 0.163);
    scene.add(plate);
  }
  for (const z of [-4.97, 1.65]) {
    const x = z < 0 ? 4.53 : 4.37;
    box([1.32, 0.085, 0.45], [x, 0.47, z], wood);
    for (const offset of [-0.5, 0.5]) box([0.084, 0.45, 0.32], [x + offset, 0.23, z], trim);
  }
  const jarProfile = [[0, 0.011], [0.14, 0.011], [0.18, 0.041], [0.213, 0.118], [0.228, 0.184],
    [0.216, 0.268], [0.175, 0.335], [0.141, 0.378], [0.141, 0.404], [0.163, 0.415],
    [0.169, 0.43], [0.156, 0.444], [0.138, 0.443], [0.123, 0.429], [0.119, 0.394],
    [0.144, 0.347], [0.186, 0.285], [0.2, 0.198], [0.178, 0.105], [0.121, 0.051], [0, 0.048]];
  const jarGeometry = new THREE.LatheGeometry(jarProfile.map(([x, y]) => new THREE.Vector2(x, y)), 36);
  for (const [x, z, size] of [[4.25, -4.31, 1.15], [4.73, -4.49, 0.87], [-4.73, -4.6, 0.82]]) {
    const jar = new THREE.Mesh(jarGeometry, clay);
    jar.position.set(x, 0, z);
    jar.scale.setScalar(size);
    jar.castShadow = jar.receiveShadow = true;
    scene.add(jar);
  }

  const display = new THREE.Group();
  display.position.set(-3.6, 1.12, 1.63);
  display.rotation.x = -0.77;
  scene.add(display);
  box([1.84, 1.12, 0.066], [0, 0, 0], wood, false, display, 0.012);
  for (const side of [-1, 1]) {
    box([0.055, 1.083, 0.035], [side * 0.89, 0, 0.028], trim, false, display, 0.008);
    box([1.78, 0.046, 0.035], [0, side * 0.537, 0.029], trim, false, display, 0.008);
  }
  for (const x of [-0.73, 0.73]) {
    box([0.092, 0.91, 0.075], [x - 3.6, 0.455, 1.75], trim);
    box([0.13, 0.075, 0.49], [x - 3.6, 0.038, 1.75], trim);
  }
  const demonstration = createRouteBoard(await textureLoader.loadAsync(assets.terrain));
  const chart = new THREE.Mesh(new THREE.PlaneGeometry(1.717, 0.976),
    new THREE.MeshStandardMaterial({ map: demonstration.texture, roughness: 0.91 }));
  const paperEdge = new THREE.MeshStandardMaterial({ color: 0xcbb48a, roughness: 0.98 });
  box([1.727, 0.984, 0.008], [0, 0, 0.036], paperEdge, false, display, 0.002);
  chart.position.z = 0.041;
  chart.receiveShadow = true;
  display.add(chart);
  box([1.12, 0.022, 0.022], [0, -0.388, 0.049], iron, false, display);
  const knob = box([0.076, 0.068, 0.031], [-0.54, -0.388, 0.069], bronze, false, display);
  for (const x of [-0.826, 0.826]) {
    for (const y of [-0.46, 0.46]) {
      box([0.053, 0.034, 0.009], [x, y, 0.047], bronze, false, display, 0.003);
      box([0.012, 0.012, 0.005], [x + 0.012 * Math.sign(x), y, 0.053], iron, false, display, 0.002);
    }
  }

  const [desk, folio] = await Promise.all([loadModel(assets.furniture), loadModel(assets.folio)]);
  desk.position.set(-1.48, 0, -3.2);
  desk.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = object.name !== 'lamp-glass';
    if (object.name === 'lamp-glass') object.material = new THREE.MeshPhysicalMaterial({
      color: 0xe0c8a2, roughness: 0.17, transparent: true, opacity: 0.21, depthWrite: false,
    });
  });
  scene.add(desk);
  const mount = desk.getObjectByName('notebook');
  const notebook = folio.getObjectByName('notebook');
  const hinge = notebook?.getObjectByName('cover-pivot');
  const page = notebook?.getObjectByName('reading-page');
  if (!mount?.parent || !hinge || !page) throw new Error('缺少线装手记的安放点、封面转轴或卷首');
  notebook.position.copy(mount.position);
  notebook.quaternion.copy(mount.quaternion);
  notebook.scale.copy(mount.scale);
  mount.parent.add(notebook);
  mount.removeFromParent();
  notebook.traverse(part => {
    if (!part.isMesh) return;
    part.castShadow = part !== page;
    part.receiveShadow = part !== page;
    if (part.material.map) part.material.map.anisotropy = 8;
  });
  const setBook = await prepareFolio(notebook, hinge, page, textureLoader, assets);

  const sky = new THREE.HemisphereLight(0xf2f2e8, 0x756a60, 1.80);
  const sun = new THREE.DirectionalLight(0xffecd7, 1.94);
  sun.position.set(-4.5, 9.5, 7.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, far: 28 });
  sun.shadow.normalBias = 0.035;
  const roomLight = new THREE.PointLight(0xffe2bf, 3.45, 6, 2);
  roomLight.position.set(-1.18, 1.83, -3.02);
  scene.add(sky, sun, roomLight);

  return {
    scene, occluders, chart, notebook, demonstration, dossier:desk.getObjectByName('牛皮纸封卷'),
    setBook,
    setRoute(progress, compared, station) {
      knob.position.x = THREE.MathUtils.lerp(-0.54, 0.54, progress);
      demonstration.paint(progress, compared, station);
    },
  };
}
