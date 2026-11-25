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
    anchor: [-1.72, 1.24, -3.14], focus: [-1.81, 0.86, -3.12],
  },
};

// 与墙、门柱、桌椅、书架的实际平面对应。两种操作使用同一组障碍。
export const obstacles = [
  [-5.46, 0.57, -0.91, -0.59], [2.23, 5.46, -0.91, -0.59],
  [-2.87, -0.55, -4.36, -2.73], [-4.7, -2.5, 1.33, 2.01],
  [-4.65, -3.17, -4.96, -4.45], [3.7, 5.05, 1.43, 1.9],
  [3.79, 5.2, -5.22, -3.99], [-5.13, -4.85, 0.37, 0.65], [-2.53, -2.25, 0.37, 0.65],
  [4.65, 5.35, -4.15, -1.95], [3.95, 5.35, 3.98, 5.60],
];

function createSkyAndMountains(scene) {
  const skyGeo = new THREE.SphereGeometry(48, 32, 20);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        float y = clamp(vDir.y, -0.15, 1.0);
        vec3 low = vec3(0.48, 0.49, 0.45);
        vec3 mid = vec3(0.35, 0.43, 0.47);
        vec3 top = vec3(0.16, 0.23, 0.30);
        vec3 col = mix(low, mid, smoothstep(-0.02, 0.24, y));
        col = mix(col, top, smoothstep(0.24, 0.85, y));
        float sunHalo = pow(max(0.0, dot(vDir, normalize(vec3(-0.52, 0.24, 0.82)))), 10.0);
        col += vec3(0.34, 0.24, 0.14) * sunHalo;
        float mist = exp(-abs(y - 0.02) * 14.0) * 0.22;
        col = mix(col, vec3(0.68, 0.65, 0.56), mist);
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const skyDome = new THREE.Mesh(skyGeo, skyMat);
  skyDome.renderOrder = -20;
  scene.add(skyDome);

  // 黔北远山连绵轮廓环，消除院墙外单调空隙
  const ringGeo = new THREE.CylinderGeometry(32, 34, 15, 72, 2, true);
  const pos = ringGeo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (y > 0) {
      const ang = Math.atan2(z, x);
      const ridge = 4.6 + 2.8 * Math.sin(ang * 3.0 + 0.7) + 1.9 * Math.cos(ang * 5.0 - 0.4) +
        1.1 * Math.sin(ang * 11.0 + 1.2);
      pos.setY(i, ridge);
    } else {
      pos.setY(i, -2.5);
    }
  }
  ringGeo.computeVertexNormals();
  const mountainMat = new THREE.MeshBasicMaterial({
    color: 0x3b484a, side: THREE.BackSide, fog: true,
  });
  const mountains = new THREE.Mesh(ringGeo, mountainMat);
  scene.add(mountains);
}

function makeGlowTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(0.45, outer);
  g.addColorStop(1, 'rgba(255, 190, 110, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeWallMapTexture(terrainImage) {
  const c = document.createElement('canvas');
  c.width = 768;
  c.height = 512;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#c8b38d';
  ctx.fillRect(0, 0, c.width, c.height);
  if (terrainImage) {
    ctx.save();
    ctx.filter = 'grayscale(80%) sepia(42%) contrast(88%) brightness(102%)';
    ctx.drawImage(terrainImage, 30, 56, c.width - 60, c.height - 96);
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(218, 194, 148, 0.28)';
  ctx.fillRect(30, 56, c.width - 60, c.height - 96);
  ctx.strokeStyle = '#5c462e';
  ctx.lineWidth = 3;
  ctx.strokeRect(24, 20, c.width - 48, c.height - 40);
  ctx.strokeStyle = '#7c6244';
  ctx.lineWidth = 1.4;
  ctx.strokeRect(30, 56, c.width - 60, c.height - 96);
  ctx.fillStyle = '#332418';
  ctx.font = 'bold 28px SimSun, serif';
  ctx.textAlign = 'center';
  ctx.fillText('黔北与湘黔川边形势略图', c.width / 2, 46);
  // 绘制长征行军路线
  ctx.strokeStyle = '#92291c';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(640, 320);
  ctx.quadraticCurveTo(510, 345, 412, 315);
  ctx.quadraticCurveTo(320, 290, 224, 210);
  ctx.stroke();
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = '#375866';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(412, 315);
  ctx.quadraticCurveTo(440, 210, 495, 118);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [name, x, y] of [['于都', 640, 320], ['湘江', 508, 336], ['黎平', 412, 315], ['乌江', 286, 250], ['遵义', 224, 210]]) {
    ctx.fillStyle = '#9e281b';
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2d1f14';
    ctx.font = 'bold 20px SimSun, serif';
    ctx.fillText(name, x, y - 12);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export async function createWorld(assets) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x526163);
  scene.fog = new THREE.FogExp2(0x6d7c7c, 0.0175);

  createSkyAndMountains(scene);

  const textureLoader = new THREE.TextureLoader();
  const fetchTexture = async (name, color = true) => {
    const texture = await textureLoader.loadAsync(assets[name]);
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 8;
    return texture;
  };
  const materials = Object.fromEntries(await Promise.all([
    ['brick', '#a9a598', 1.9],
    ['wood', '#8f867c', 1.65],
    ['plaster', '#beb39e', 1.55],
  ].map(async ([name, color, meters]) => {
    const [map, normalMap] = await Promise.all([
      fetchTexture(name), fetchTexture(name + '-normal', false),
    ]);
    const material = new THREE.MeshStandardMaterial({
      color, map, normalMap, normalScale: new THREE.Vector2(0.55, 0.55), roughness: 0.88,
    });
    material.userData.meters = meters;
    return [name, material];
  })));
  const { brick, wood, plaster } = materials;
  const trim = wood.clone();
  trim.color.set('#665545');
  trim.roughness = 0.78;
  trim.userData.meters = 1.35;
  const iron = new THREE.MeshStandardMaterial({ color: 0x3b342d, metalness: 0.45, roughness: 0.62 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x9b7f52, metalness: 0.65, roughness: 0.42 });
  const clay = new THREE.MeshStandardMaterial({ color: 0x8a7766, roughness: 0.88 });
  const slab = new THREE.MeshStandardMaterial({ color: 0x4b4d44, roughness: 0.94 });

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

  // 建筑承重墙与隔断墙（与 refine_hall.py 砖瓦立面精密契合）
  box([11.16, 2.84, 0.22], [0, 1.42, -5.44], plaster, true);
  box([11.12, 0.36, 0.25], [0, 0.18, -5.29], brick);
  box([0.22, 2.62, 11.47], [-5.47, 1.31, 0.17], brick, true);
  box([0.22, 2.62, 11.47], [5.47, 1.31, 0.17], brick, true);
  box([11.1, 1.83, 0.22], [0, 0.915, 5.81], brick, true);

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
  box([10.98, 0.055, 4.45], [0, 2.84, -3.09], wood);

  // 立体门楣匾额芯（精准嵌于 refine_hall.py 的金线立体雕框内）
  {
    const sign = document.createElement('canvas');
    [sign.width, sign.height] = [512, 160];
    const ink = sign.getContext('2d');
    const bg = ink.createLinearGradient(0, 0, 512, 160);
    bg.addColorStop(0, '#2a1f16');
    bg.addColorStop(0.5, '#39281c');
    bg.addColorStop(1, '#241a12');
    ink.fillStyle = bg;
    ink.fillRect(0, 0, 512, 160);
    ink.fillStyle = 'rgba(220, 185, 122, 0.08)';
    for (let i = 0; i < 40; i++) ink.fillRect(0, i * 4, 512, 1);
    ink.fillStyle = '#e7cc93';
    ink.font = 'bold 82px "STZhongsong", "Songti SC", SimSun, serif';
    ink.textAlign = 'center';
    ink.shadowColor = 'rgba(0,0,0,0.65)';
    ink.shadowBlur = 4;
    ink.shadowOffsetY = 2;
    ink.fillText('材料厅', 256, 110);
    const texture = new THREE.CanvasTexture(sign);
    texture.colorSpace = THREE.SRGBColorSpace;
    const plate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.88, 0.275),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.72, metalness: 0.12 }),
    );
    plate.position.set(1.4, 2.59, -0.558);
    scene.add(plate);
  }

  for (const z of [-4.97, 1.65]) {
    const x = z < 0 ? 4.53 : 4.37;
    box([1.32, 0.085, 0.45], [x, 0.47, z], wood, false, scene, 0.008);
    for (const offset of [-0.5, 0.5]) box([0.084, 0.45, 0.32], [x + offset, 0.23, z], trim, false, scene, 0.006);
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

  // 行军图木质倾斜沙盘展台
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
    box([0.092, 0.91, 0.075], [x - 3.6, 0.455, 1.75], trim, false, scene, 0.008);
    box([0.13, 0.075, 0.49], [x - 3.6, 0.038, 1.75], trim, false, scene, 0.008);
  }
  const terrainTex = await textureLoader.loadAsync(assets.terrain);
  const demonstration = createRouteBoard(terrainTex);
  const chart = new THREE.Mesh(
    new THREE.PlaneGeometry(1.717, 0.976),
    new THREE.MeshStandardMaterial({ map: demonstration.texture, roughness: 0.86 }),
  );
  const paperEdge = new THREE.MeshStandardMaterial({ color: 0xc2aa7f, roughness: 0.95 });
  box([1.727, 0.984, 0.008], [0, 0, 0.036], paperEdge, false, display, 0.002);
  chart.position.z = 0.041;
  chart.receiveShadow = true;
  display.add(chart);
  box([1.12, 0.022, 0.022], [0, -0.388, 0.049], iron, false, display);
  const knob = box([0.076, 0.068, 0.031], [-0.54, -0.388, 0.069], bronze, false, display, 0.006);
  const knobGlow = new THREE.Mesh(
    new THREE.RingGeometry(0.032, 0.052, 24),
    new THREE.MeshBasicMaterial({ color: 0xf4cf84, transparent: true, opacity: 0.52, side: THREE.DoubleSide }),
  );
  knobGlow.position.set(0, 0, 0.019);
  knob.add(knobGlow);
  for (const x of [-0.826, 0.826]) {
    for (const y of [-0.46, 0.46]) {
      box([0.053, 0.034, 0.009], [x, y, 0.047], bronze, false, display, 0.003);
      box([0.012, 0.012, 0.005], [x + 0.012 * Math.sign(x), y, 0.053], iron, false, display, 0.002);
    }
  }

  // 北墙大号挂轴战略地图画芯（装于 refine_hall.py 的木轴之间）
  const wallMap = new THREE.Mesh(
    new THREE.PlaneGeometry(1.72, 1.30),
    new THREE.MeshStandardMaterial({
      map: makeWallMapTexture(terrainTex.image),
      roughness: 0.91,
    }),
  );
  wallMap.position.set(1.55, 1.64, -5.285);
  wallMap.receiveShadow = true;
  scene.add(wallMap);

  // 复用轻量远景树与草丛模型，在院墙外探出苍劲枝叶、花台增添生机（兼顾低配流畅度）
  const treeKey = assets['river-tree-far'] ? 'river-tree-far' : 'river-tree';
  if (assets[treeKey] && assets['river-grass']) {
    try {
      const [treeModel, grassModel] = await Promise.all([
        loadModel(assets[treeKey]),
        loadModel(assets['river-grass']),
      ]);
      const prepFoliage = root => {
        root.traverse(obj => {
          if (!obj.isMesh) return;
          obj.castShadow = false;
          obj.receiveShadow = true;
          const m = obj.material;
          if (m?.transparent) {
            m.transparent = false;
            m.alphaTest = 0.42;
            m.depthWrite = true;
          }
        });
      };
      prepFoliage(treeModel);
      prepFoliage(grassModel);
      for (const [tx, ty, tz, s, ry] of [
        [-6.35, -0.15, 2.85, 0.95, 0.6],
        [6.35, -0.15, 3.45, 0.88, 2.1],
        [-6.1, -0.1, -6.8, 1.05, 1.4],
        [6.4, -0.1, -6.4, 0.98, 3.5],
      ]) {
        const tree = treeModel.clone(true);
        tree.position.set(tx, ty, tz);
        tree.scale.setScalar(s);
        tree.rotation.y = ry;
        scene.add(tree);
      }
      for (const [gx, gy, gz, s, ry] of [
        [4.55, 0.29, 4.65, 1.25, 0.4],
        [4.82, 0.29, 4.92, 1.05, 1.8],
        [-4.95, 0.0, 5.25, 0.82, 0.9],
        [-5.02, 0.0, 3.15, 0.72, 2.4],
      ]) {
        const tuft = grassModel.clone(true);
        tuft.position.set(gx, gy, gz);
        tuft.scale.setScalar(s);
        tuft.rotation.y = ry;
        scene.add(tuft);
      }
    } catch {
      // 植被复用失败不影响核心建筑
    }
  }

  // 加载书桌、油灯与线装手记
  const [desk, folio] = await Promise.all([loadModel(assets.furniture), loadModel(assets.folio)]);
  desk.position.set(-1.48, 0, -3.2);
  desk.traverse(object => {
    if (!object.isMesh) return;
    object.castShadow = object.receiveShadow = object.name !== 'lamp-glass';
    if (object.name === 'lamp-glass') object.material = new THREE.MeshStandardMaterial({
      color: 0xffe4bc, roughness: 0.18, metalness: 0.06, transparent: true, opacity: 0.28, depthWrite: false,
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
    // 降低纸面高反光，避免手记过曝泛白
    if (part.material.roughness !== undefined) part.material.roughness = Math.max(0.88, part.material.roughness);
  });
  const setBook = await prepareFolio(notebook, hinge, page, textureLoader, assets);

  // 廊下两盏暖光宫灯纸芯 + 柔光晕，共用一盏门廊主暖光避免过多片元光源开销
  const glowTex = makeGlowTexture('rgba(255, 224, 154, 0.92)', 'rgba(255, 162, 72, 0.24)');
  const lanternHalos = [];
  const lanternCoreMat = new THREE.MeshStandardMaterial({
    color: 0xfff0cc, emissive: 0xffa640, emissiveIntensity: 1.45, roughness: 0.85,
  });
  for (const lx of [0.18, 2.62]) {
    const core = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.26, 0.18), lanternCoreMat);
    core.position.set(lx, 2.22, -0.26);
    scene.add(core);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, blending: THREE.AdditiveBlending, transparent: true, opacity: 0.58, depthWrite: false,
    }));
    halo.position.set(lx, 2.20, -0.26);
    halo.scale.set(0.98, 0.98, 1);
    scene.add(halo);
    lanternHalos.push(halo);
  }
  const porchLight = new THREE.PointLight(0xffb45a, 2.15, 7.6, 1.75);
  porchLight.position.set(1.4, 2.18, 0.15);
  scene.add(porchLight);

  // 书桌煤油灯实时动态火苗与暖晕
  const lampFlame = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture('rgba(255, 245, 210, 0.98)', 'rgba(255, 168, 62, 0.35)'),
    blending: THREE.AdditiveBlending, transparent: true, opacity: 0.85, depthWrite: false,
  }));
  lampFlame.position.set(-1.46, 0.955, -3.455);
  lampFlame.scale.set(0.16, 0.22, 1);
  scene.add(lampFlame);

  // 窗隙柔和体积光束（冷暖交汇的空气感）
  const beamMat = new THREE.MeshBasicMaterial({
    color: 0xcfdad6, transparent: true, opacity: 0.055, blending: THREE.AdditiveBlending,
    depthWrite: false, side: THREE.DoubleSide,
  });
  for (const wx of [-3.89, -1.82, 3.97]) {
    const beam = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 2.55), beamMat);
    beam.position.set(wx + 0.28, 1.32, -1.72);
    beam.rotation.set(0.74, 0.22, -0.16);
    scene.add(beam);
  }

  // 室内缓慢漂浮的金色尘埃微粒
  const dustCount = 68;
  const dustPos = new Float32Array(dustCount * 3);
  const dustBase = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    const x = -4.2 + ((i * 73) % 100) / 100 * 8.4;
    const y = 0.65 + ((i * 41) % 100) / 100 * 1.9;
    const z = -4.6 + ((i * 29) % 100) / 100 * 3.5;
    dustPos[i * 3] = dustBase[i * 3] = x;
    dustPos[i * 3 + 1] = dustBase[i * 3 + 1] = y;
    dustPos[i * 3 + 2] = dustBase[i * 3 + 2] = z;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = new THREE.PointsMaterial({
    map: glowTex, color: 0xf7dca6, size: 0.048, transparent: true, opacity: 0.42,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const dust = new THREE.Points(dustGeo, dustMat);
  scene.add(dust);

  // 电影级冷暖对比布光（兼顾高画质层次与流畅帧率）
  const sky = new THREE.HemisphereLight(0xc2d5dc, 0x54493d, 1.08);
  const sun = new THREE.DirectionalLight(0xffdfb8, 1.48);
  sun.position.set(-5.2, 8.8, 7.6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, far: 30 });
  sun.shadow.normalBias = 0.03;
  sun.shadow.bias = -0.0003;
  const roomLight = new THREE.PointLight(0xffba6b, 2.45, 7.2, 1.75);
  roomLight.position.set(-1.38, 1.62, -3.22);
  scene.add(sky, sun, roomLight);
  scene.updateMatrixWorld(true);

  function animate(time, reduced = false) {
    if (reduced) return;
    const flick = 1 + 0.065 * Math.sin(time * 5.2) + 0.04 * Math.sin(time * 11.7 + 1.3);
    roomLight.intensity = 2.45 * flick;
    lampFlame.scale.set(0.155 * (0.96 + 0.06 * flick), 0.22 * (0.95 + 0.08 * flick), 1);
    porchLight.intensity = 2.15 * (1 + 0.04 * Math.sin(time * 3.6));
    for (let i = 0; i < lanternHalos.length; i++) {
      const wave = 1 + 0.05 * Math.sin(time * 3.8 + i * 2.1);
      lanternHalos[i].material.opacity = 0.50 + 0.08 * wave;
    }
    knobGlow.material.opacity = 0.36 + 0.22 * (0.5 + 0.5 * Math.sin(time * 2.6));
    const attr = dustGeo.attributes.position;
    for (let i = 0; i < dustCount; i++) {
      const phase = i * 0.71;
      attr.setXYZ(
        i,
        dustBase[i * 3] + Math.sin(time * 0.28 + phase) * 0.14,
        dustBase[i * 3 + 1] + Math.sin(time * 0.22 + phase * 1.3) * 0.09,
        dustBase[i * 3 + 2] + Math.cos(time * 0.25 + phase) * 0.12,
      );
    }
    attr.needsUpdate = true;
  }

  return {
    scene, occluders, chart, notebook, demonstration, dossier: desk.getObjectByName('牛皮纸封卷'),
    setBook, animate,
    setRoute(progress, compared, station) {
      knob.position.x = THREE.MathUtils.lerp(-0.54, 0.54, progress);
      demonstration.paint(progress, compared, station);
    },
  };
}
