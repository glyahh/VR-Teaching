import * as THREE from 'three';
import { loadModel } from './packed-model.js';
import { createCrowd } from './river-people.js';

const waterLevel = 0.05;
const bounds = { left: -104, right: 104, back: -112, front: 92 };

// 湘江河道呈南北斜向蜿蜒穿过全州—兴安谷地（沿 Z 轴流向，红军由东向西 +X -> -X 涉水）
export function riverCenterX(z) {
  return 4.5 * Math.sin(z * 0.055) + 1.8 * Math.cos(z * 0.12);
}

export function riverHalfWidth(z) {
  return 13.5 + 2.6 * Math.sin(z * 0.045 + 0.6);
}

export function groundHeight(x, z) {
  const cx = riverCenterX(z);
  const hw = riverHalfWidth(z);
  const dist = Math.abs(x - cx) - hw;
  // 河床明确深于水面，确保宽阔明亮江面完整显现；浅滩区（z ∈ [-9, 9]）略浅可涉水
  const fordFactor = Math.exp(-Math.pow(z / 11, 2));
  const bedDepth = THREE.MathUtils.lerp(-1.85, -0.85, fordFactor);
  const bankShore = THREE.MathUtils.smoothstep(dist, -1.2, 3.2);
  const terrace = THREE.MathUtils.smoothstep(dist, 3.8, 19.0);
  const slope = THREE.MathUtils.smoothstep(dist, 16.0, 58.0);
  const westBias = x < cx ? 1.28 : 0.94;
  const rolling = (1.5 + 2.1 * Math.sin(x * 0.07 + z * 0.09) ** 2 + 1.4 * Math.cos(x * 0.11 - z * 0.06) ** 2) * westBias;
  const karst = (9.5 + 11.5 * Math.pow(0.5 + 0.5 * Math.sin(x * 0.055 + 0.8) * Math.cos(z * 0.062 - 0.5), 1.8)) * westBias;
  const micro = (Math.sin(x * 0.72 + z * 0.88) + 0.5 * Math.cos(x * 1.3 - z * 0.9)) * 0.08;
  return THREE.MathUtils.lerp(bedDepth, 0.65, bankShore) + terrace * rolling + slope * karst +
    micro * THREE.MathUtils.smoothstep(dist, 0.2, 4.5);
}

function makeSoftCircleTex(r, g, b, alpha) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  grad.addColorStop(0, `rgba(${r},${g},${b},${alpha})`);
  grad.addColorStop(0.5, `rgba(${r},${g},${b},${alpha * 0.35})`);
  grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export async function createXiangWorld(assets) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x7c8b8c);
  scene.fog = new THREE.FogExp2(0x7e8d8d, 0.0126);

  // 桂北深秋阴雨亮灰云雾天空穹顶（与湘江河谷写实影调呼应）
  const skyGeo = new THREE.SphereGeometry(135, 32, 18);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      varying vec3 vDir;
      void main() {
        float y = clamp(vDir.y, -0.1, 1.0);
        vec3 horizon = vec3(0.72, 0.76, 0.75);
        vec3 cloud = vec3(0.56, 0.62, 0.63);
        vec3 zenith = vec3(0.41, 0.48, 0.51);
        vec3 col = mix(horizon, cloud, smoothstep(-0.02, 0.28, y));
        col = mix(col, zenith, smoothstep(0.28, 0.85, y));
        float breakGlow = pow(max(0.0, dot(vDir, normalize(vec3(-0.35, 0.28, -0.82)))), 6.0);
        col += vec3(0.18, 0.17, 0.14) * breakGlow;
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));

  // 远景桂北喀斯特峰林群（圆润错落、远距隐于秋雾，避免突兀多边形尖锥）
  const karstGroup = new THREE.Group();
  const karstMat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.96, metalness: 0, flatShading: false,
  });
  const peakSpecs = [
    [-78, -68, 22, 30, 0.86], [-42, -78, 20, 27, 0.92], [-6, -84, 24, 34, 0.82],
    [32, -80, 21, 28, 0.9], [68, -70, 23, 31, 0.85],
    [-86, -30, 22, 26, 0.88], [-88, 14, 24, 29, 0.92], [-76, 58, 22, 24, 0.9],
    [84, -26, 20, 25, 0.88], [86, 22, 23, 27, 0.9], [68, 66, 22, 23, 0.85], [14, 84, 26, 26, 0.88],
    // 二层更远淡黛山脊，丰富纵深层次
    [-26, -104, 30, 40, 0.78], [52, -102, 28, 38, 0.8], [-64, -98, 26, 36, 0.76],
  ];
  const footCol = new THREE.Color(0x4b5c54);
  const midCol = new THREE.Color(0x5b6d66);
  const topCol = new THREE.Color(0x7c8e8b);
  const tmpCol = new THREE.Color();
  for (const [px, pz, rad, h, stretchZ] of peakSpecs) {
    const geo = new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI * 0.54);
    const p = geo.attributes.position;
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const ux = p.getX(i), uy = p.getY(i), uz = p.getZ(i);
      const a = Math.atan2(uz, ux);
      const wave = 0.88 + 0.14 * Math.sin(a * 3 + px * 0.13) + 0.08 * Math.cos(a * 5 + pz * 0.17);
      const slope = Math.pow(1 - uy, 0.42);
      const apexFade = 1 - THREE.MathUtils.smoothstep(uy, 0.82, 0.99);
      const rx = ux * rad * wave * (0.72 + 0.35 * slope);
      const rz = uz * rad * stretchZ * wave * (0.72 + 0.35 * slope);
      const ry = Math.pow(Math.max(0, uy), 0.76) * h * (1 + 0.08 * apexFade * Math.sin(a * 2 + px));
      p.setXYZ(i, rx, ry, rz);
      tmpCol.copy(footCol).lerp(midCol, THREE.MathUtils.smoothstep(uy, 0.1, 0.55))
        .lerp(topCol, THREE.MathUtils.smoothstep(uy, 0.55, 0.98));
      cols[i * 3] = tmpCol.r;
      cols[i * 3 + 1] = tmpCol.g;
      cols[i * 3 + 2] = tmpCol.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.computeVertexNormals();
    const peak = new THREE.Mesh(geo, karstMat);
    peak.position.set(px, -1.5, pz);
    karstGroup.add(peak);
  }
  scene.add(karstGroup);

  // 远谷飘移薄雾片，柔化山脚与江谷衔接
  const mistTex = makeSoftCircleTex(188, 198, 198, 0.34);
  for (const [mx, my, mz, sx, sy] of [
    [-24, 9, -56, 48, 16], [18, 10, -58, 52, 18], [-44, 8, -22, 42, 14], [46, 9, -18, 44, 15],
  ]) {
    const mist = new THREE.Sprite(new THREE.SpriteMaterial({
      map: mistTex, transparent: true, opacity: 0.55, depthWrite: false,
    }));
    mist.position.set(mx, my, mz);
    mist.scale.set(sx, sy, 1);
    scene.add(mist);
  }

  // 加载复用贴图（无需新增任何外部贴图文件）
  const loader = new THREE.TextureLoader();
  const [groundMap, groundNormal, waves, soil] = await Promise.all(
    ['river-ground', 'river-ground-normal', 'water-normal', 'river-soil'].map(async name => {
      const tex = await loader.loadAsync(assets[name]);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.colorSpace = name.endsWith('normal') ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      tex.anisotropy = 6;
      return tex;
    }),
  );

  // 河谷与浅滩地形网格
  const cols = 128, rows = 112;
  const gPos = [], gUv = [], gCol = [], gIdx = [];
  const shingle = new THREE.Color(0x9a9382);
  const meadow = new THREE.Color(0x7c8669);
  const ridgeCol = new THREE.Color(0x556657);
  const c = new THREE.Color();
  for (let r = 0; r <= rows; r++) {
    const z = THREE.MathUtils.lerp(bounds.back, bounds.front, r / rows);
    for (let k = 0; k <= cols; k++) {
      const x = THREE.MathUtils.lerp(bounds.left, bounds.right, k / cols);
      const y = groundHeight(x, z);
      gPos.push(x, y, z);
      gUv.push(x / 8.5, z / 8.5);
      const d = Math.abs(x - riverCenterX(z)) - riverHalfWidth(z);
      c.copy(shingle).lerp(meadow, THREE.MathUtils.smoothstep(d, 1.2, 7.5))
        .lerp(ridgeCol, THREE.MathUtils.smoothstep(y, 4.5, 16.0));
      gCol.push(c.r, c.g, c.b);
      if (r && k) {
        const i = r * (cols + 1) + k;
        gIdx.push(i - cols - 2, i - 1, i - cols - 1, i - cols - 1, i - 1, i);
      }
    }
  }
  const terrainGeo = new THREE.BufferGeometry();
  terrainGeo.setAttribute('position', new THREE.Float32BufferAttribute(gPos, 3));
  terrainGeo.setAttribute('uv', new THREE.Float32BufferAttribute(gUv, 2));
  terrainGeo.setAttribute('color', new THREE.Float32BufferAttribute(gCol, 3));
  terrainGeo.setIndex(gIdx);
  terrainGeo.computeVertexNormals();
  const terrainMat = new THREE.MeshStandardMaterial({
    map: groundMap, normalMap: groundNormal, normalScale: new THREE.Vector2(0.45, 0.45),
    vertexColors: true, roughness: 0.94,
  });
  const terrain = new THREE.Mesh(terrainGeo, terrainMat);
  terrain.receiveShadow = true;
  scene.add(terrain);

  // 寒江急流 Shader（冷灰绿水色 + 湍流法线 + 浅滩白沫 + 细雨涟漪）
  const waterUniforms = {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uRipples: { value: waves },
    uBed: { value: soil },
  };
  const waterMat = new THREE.ShaderMaterial({
    fog: true,
    transparent: true,
    side: THREE.DoubleSide,
    uniforms: waterUniforms,
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 vUv;
      varying vec3 vWorld;
      void main() {
        vUv = uv;
        vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float uTime;
      uniform sampler2D uRipples, uBed;
      varying vec2 vUv;
      varying vec3 vWorld;

      float rainRing(vec2 p, float t, float seed) {
        vec2 cell = floor(p);
        vec2 f = fract(p) - 0.5;
        float h = fract(sin(dot(cell, vec2(127.1, 311.7)) + seed) * 43758.5453);
        float age = fract(t * 0.65 + h);
        float radius = age * 0.46;
        float ring = smoothstep(0.04, 0.0, abs(length(f) - radius)) * (1.0 - age);
        return ring;
      }

      void main() {
        vec2 p = vWorld.xz;
        vec2 n1 = texture2D(uRipples, p * vec2(0.11, 0.065) + vec2(0.0, -uTime * 0.22)).rg * 2.0 - 1.0;
        vec2 n2 = texture2D(uRipples, p * vec2(0.19, 0.12) + vec2(uTime * 0.04, -uTime * 0.34)).rg * 2.0 - 1.0;
        vec2 slope = n1 * 0.55 + n2 * 0.45;
        vec3 normal = normalize(vec3(slope.x * 0.72, 1.0, slope.y * 0.72));
        vec3 viewRay = normalize(cameraPosition - vWorld);
        float fresnel = 0.08 + 0.68 * pow(1.0 - max(0.0, dot(viewRay, normal)), 3.0);

        float edge = smoothstep(0.32, 0.49, abs(vUv.x - 0.5));
        float bankFade = (1.0 - smoothstep(0.45, 0.50, abs(vUv.x - 0.5))) * smoothstep(0.0, 0.14, vUv.y);
        float fordZone = exp(-pow(vWorld.z / 11.5, 2.0));
        // 线性色彩空间的深秋寒江冷青绿水色（经 ACES + sRGB 映射后通透自然不泛白）
        vec3 deep = vec3(0.042, 0.078, 0.088);
        vec3 shallow = vec3(0.115, 0.132, 0.105);
        vec3 skyCol = vec3(0.24, 0.295, 0.315);
        vec3 color = mix(deep, shallow, max(edge * 0.68, fordZone * 0.32));
        // 柔和冷银天光反射、细碎滩沫与秋雨涟漪
        vec3 sunDir = normalize(vec3(-0.35, 0.72, -0.58));
        float spec = pow(max(0.0, dot(normal, normalize(sunDir + viewRay))), 32.0) * 0.22;
        float foam = smoothstep(0.38, 0.78, slope.y + edge * 0.45 + fordZone * 0.22) * 0.14;
        float rain = (rainRing(p * 1.15, uTime, 1.7) + rainRing(p * 1.75 + 3.2, uTime * 1.1, 4.9)) * 0.095;
        color = mix(color, skyCol, clamp(fresnel * 0.62, 0.12, 0.58)) + vec3(0.55, 0.62, 0.64) * (foam + rain + spec);
        gl_FragColor = vec4(color, 0.94 * bankFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });

  const wPos = [], wUv = [], wIdx = [];
  const wSegs = 200;
  for (let i = 0; i <= wSegs; i++) {
    const z = THREE.MathUtils.lerp(bounds.back, bounds.front, i / wSegs);
    const cx = riverCenterX(z);
    const hw = riverHalfWidth(z) + 2.8;
    for (const s of [-1, 1]) {
      wPos.push(cx + s * hw, waterLevel, z);
      wUv.push((s + 1) / 2, i / wSegs);
    }
    if (i) wIdx.push(2 * i - 2, 2 * i, 2 * i - 1, 2 * i - 1, 2 * i, 2 * i + 1);
  }
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(wPos, 3));
  waterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(wUv, 2));
  waterGeo.setIndex(wIdx);
  waterGeo.computeVertexNormals();
  scene.add(new THREE.Mesh(waterGeo, waterMat));

  // 复用已有岩石、草木与远景树模型布置湘江岸线与涉水礁石
  const [rockModel, grassModel, farTreeModel, crowdModel] = await Promise.all([
    loadModel(assets['river-rock']),
    loadModel(assets['river-grass']),
    loadModel(assets['river-tree-far']),
    loadModel(assets['river-crowd']),
  ]);

  const scatterSimple = (model, placements, tintHex, shadow) => {
    const tint = new THREE.Color(tintHex);
    const pose = new THREE.Object3D();
    const parts = [];
    model.updateMatrixWorld(true);
    model.traverse(obj => {
      if (!obj.isMesh) return;
      const mat = obj.material.clone();
      if (mat.transparent) {
        mat.transparent = false;
        mat.alphaTest = 0.42;
        mat.depthWrite = true;
      }
      parts.push({ geo: obj.geometry, mat, local: obj.matrixWorld.clone() });
    });
    const m = new THREE.Matrix4();
    for (const { geo, mat, local } of parts) {
      const inst = new THREE.InstancedMesh(geo, mat, placements.length);
      placements.forEach(({ x, y, z, s, ry, shade }, idx) => {
        pose.position.set(x, y, z);
        pose.rotation.y = ry;
        pose.scale.setScalar(s);
        pose.updateMatrix();
        inst.setMatrixAt(idx, m.multiplyMatrices(pose.matrix, local));
        inst.setColorAt(idx, tint.clone().multiplyScalar(shade));
      });
      inst.castShadow = shadow;
      inst.receiveShadow = true;
      inst.computeBoundingSphere();
      scene.add(inst);
    }
  };

  let randSeed = 19341127;
  const rnd = () => ((randSeed = (Math.imul(randSeed, 1664525) + 1013904223) >>> 0) / 4294967296);

  // 测量岩石原始底面高度，半埋入滩涂彻底杜绝浮石感
  rockModel.updateMatrixWorld(true);
  const rockBox = new THREE.Box3().setFromObject(rockModel);
  const rockMinY = Number.isFinite(rockBox.min.y) ? rockBox.min.y : 0;
  const rockH = Math.max(0.4, rockBox.max.y - rockMinY);

  // 贴岸鹅卵石礁与少量江心浅滩踏脚石
  const rocks = [];
  for (let i = 0; i < 36; i++) {
    const z = -40 + rnd() * 80;
    const side = i % 2 ? 1 : -1;
    const x = riverCenterX(z) + side * (riverHalfWidth(z) + 0.6 + rnd() * 4.2);
    const s = 0.28 + rnd() * 0.42;
    rocks.push({
      x, y: groundHeight(x, z) - rockMinY * s - rockH * s * 0.42, z,
      s, ry: rnd() * 6.28, shade: 0.78 + rnd() * 0.22,
    });
  }
  for (const [rx, rz, rs] of [[-4.8, -1.8, 0.42], [-1.2, 2.4, 0.36], [3.8, -2.5, 0.46], [6.2, 1.5, 0.38]]) {
    rocks.push({
      x: rx, y: waterLevel - rockMinY * rs - rockH * rs * 0.56, z: rz,
      s: rs, ry: rnd() * 6.28, shade: 0.8,
    });
  }
  scatterSimple(rockModel, rocks, 0xa2a096, true);

  const tufts = [];
  for (let i = 0; i < 85; i++) {
    const z = -44 + rnd() * 88;
    const side = i % 2 ? 1 : -1;
    const x = riverCenterX(z) + side * (riverHalfWidth(z) + 1.8 + rnd() * 14.0);
    tufts.push({ x, y: groundHeight(x, z) - 0.04, z, s: 0.55 + rnd() * 0.9, ry: rnd() * 6.28, shade: 0.72 + rnd() * 0.25 });
  }
  scatterSimple(grassModel, tufts, 0xa7a582, false);

  const trees = [];
  for (let i = 0; i < 42; i++) {
    const z = -50 + rnd() * 100;
    const side = i % 2 ? 1 : -1;
    const x = riverCenterX(z) + side * (riverHalfWidth(z) + 11.5 + rnd() * 24.0);
    trees.push({ x, y: groundHeight(x, z) - 0.18, z, s: 0.9 + rnd() * 1.1, ry: rnd() * 6.28, shade: 0.75 + rnd() * 0.25 });
  }
  scatterSimple(farTreeModel, trees, 0x8ea094, false);

  // 涉水红军队列与西岸阻击守军（复用已有高精度红军人群 InstancedMesh）
  const crowd = createCrowd(scene, crowdModel, 130);
  const waders = Array.from({ length: 78 }, (_, idx) => ({
    lane: (idx % 5) - 2,
    offset: Math.floor(idx / 5) * 1.48 + (idx % 3) * 0.42,
    wobble: rnd() * 6.28,
  }));
  const defenders = Array.from({ length: 18 }, (_, idx) => {
    const z = -15 + (idx % 9) * 3.8 + (idx >= 9 ? 1.4 : -0.8);
    const x = riverCenterX(z) - riverHalfWidth(z) - 8.5 - (idx >= 9 ? 3.5 : 0) - rnd() * 2.2;
    return { x, z };
  });

  // 南北两翼封锁线柔和脉冲红弧（半透明光带，直观标出合围压迫感）
  const blockadeArcs = [];
  for (const [sign, zBase] of [[-1, -24], [1, 24]]) {
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const t = i / 28;
      const x = THREE.MathUtils.lerp(-24, 28, t);
      const z = zBase - sign * Math.sin(t * Math.PI) * 7.5;
      pts.push(new THREE.Vector3(x, Math.max(waterLevel + 0.28, groundHeight(x, z) + 0.45), z));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xd44b36, transparent: true, opacity: 0.46, depthWrite: false,
    });
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 48, 0.16, 6, false), mat);
    scene.add(tube);
    blockadeArcs.push({ tube, mat, sign, zBase });
  }

  // 渡江突破暖金细流光线（顺江面浮现，不抢夺涉水红军视觉主体）
  const fordPoints = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    const x = THREE.MathUtils.lerp(22, -24, t);
    const z = Math.sin(t * Math.PI * 1.5) * 1.8;
    fordPoints.push(new THREE.Vector3(x, Math.max(waterLevel + 0.16, groundHeight(x, z) + 0.24), z));
  }
  const fordMat = new THREE.MeshBasicMaterial({
    color: 0xf4cf84, transparent: true, opacity: 0.42, depthWrite: false,
  });
  const fordRibbon = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(fordPoints), 40, 0.085, 6, false),
    fordMat,
  );
  scene.add(fordRibbon);

  // 西岸与南岸阻击烟雾与微弱炮火闪光
  const smokeTex = makeSoftCircleTex(165, 174, 178, 0.42);
  const flashTex = makeSoftCircleTex(255, 165, 92, 0.85);
  const smokePuffs = Array.from({ length: 14 }, (_, i) => {
    const mat = new THREE.SpriteMaterial({ map: smokeTex, transparent: true, opacity: 0.35, depthWrite: false });
    const sp = new THREE.Sprite(mat);
    const isNorth = i % 2 === 0;
    const x = (i % 3 - 1) * 9 - 10;
    const z = (isNorth ? -1 : 1) * (15 + (i % 4) * 3.8);
    const y = groundHeight(x, z) + 1.8;
    sp.position.set(x, y, z);
    sp.scale.set(5.5, 4.8, 1);
    scene.add(sp);
    return { sp, mat, baseX: x, baseY: y, baseZ: z, phase: i * 1.13 };
  });
  const flashes = [[-19, -18], [-17, 17], [16, -20], [18, 19]].map(([fx, fz], idx) => {
    const mat = new THREE.SpriteMaterial({
      map: flashTex, blending: THREE.AdditiveBlending, transparent: true, opacity: 0, depthWrite: false,
    });
    const sp = new THREE.Sprite(mat);
    sp.position.set(fx, groundHeight(fx, fz) + 1.2, fz);
    sp.scale.set(4.5, 4.5, 1);
    scene.add(sp);
    return { sp, mat, phase: idx * 2.17 };
  });

  // 实时斜飘细雨丝粒子
  const rainCount = 420;
  const rainPos = new Float32Array(rainCount * 6);
  const rainSeeds = Array.from({ length: rainCount }, () => [
    (rnd() - 0.5) * 68, rnd() * 26, (rnd() - 0.5) * 58, 12 + rnd() * 6,
  ]);
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: 0xbcd0d6, transparent: true, opacity: 0.24 });
  const rainLines = new THREE.LineSegments(rainGeo, rainMat);
  scene.add(rainLines);

  // 明亮自然的桂北阴雨天光与柔阴影（让宽阔冷银江面、涉水队列与喀斯特峰丛层次分明）
  const hemi = new THREE.HemisphereLight(0xd9e6e8, 0x5c6455, 1.92);
  const sun = new THREE.DirectionalLight(0xf2efe4, 1.78);
  sun.position.set(-28, 38, -26);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, far: 120 });
  sun.shadow.normalBias = 0.08;
  scene.add(hemi, sun);

  function update(progress, elapsed, reduced = false) {
    waterUniforms.uTime.value = reduced ? 0 : elapsed;

    // 1. 随态势时间轴推进红军涉水队伍：0(集结渡口) -> 0.55(苦战涉水) -> 1.0(突围至西岸，人数明显减少)
    crowd.show();
    const survivingRatio = THREE.MathUtils.lerp(1.0, 0.36, THREE.MathUtils.smoothstep(progress, 0.25, 0.95));
    const visibleWaders = Math.max(18, Math.round(waders.length * survivingRatio));
    let slot = 0;
    for (let i = 0; i < visibleWaders; i++) {
      const w = waders[i];
      // 从东岸 x≈+26 涉水向西岸 x≈-26 推进
      const march = progress * 44 - w.offset * 0.72;
      const x = 26 - march;
      if (x < -34 || x > 32) continue;
      const z = w.lane * 2.25 + Math.sin(x * 0.14 + w.wobble) * 1.15;
      // 在河道内脚踩河床但身躯大半露出水面，体现齐腰涉水感，面朝西岸(-X)奋勇渡江
      const yFn = (px, pz) => Math.max(waterLevel - 0.52, groundHeight(px, pz));
      crowd.put(slot++, x, z, yFn, reduced ? 0 : elapsed * 0.78 + w.wobble, -Math.PI / 2);
    }
    // 西岸高地掩护阻击队伍（面朝东岸迎敌，随苦战逐渐收缩）
    const activeDefenders = Math.max(5, Math.round(defenders.length * THREE.MathUtils.lerp(1, 0.32, progress)));
    for (let i = 0; i < activeDefenders; i++) {
      const d = defenders[i];
      crowd.put(slot++, d.x, d.z, groundHeight, 0, Math.PI / 2);
    }
    crowd.update();

    // 2. 南北封锁红弧随进度向渡口逼近并脉冲
    const squeeze = THREE.MathUtils.smoothstep(progress, 0.1, 0.85) * 6.5;
    const pulse = 0.5 + 0.5 * Math.sin(elapsed * 3.2);
    for (const arc of blockadeArcs) {
      arc.tube.position.z = -arc.sign * squeeze;
      arc.mat.opacity = 0.34 + 0.32 * pulse * (0.5 + 0.5 * progress);
    }
    fordMat.opacity = 0.28 + 0.35 * THREE.MathUtils.smoothstep(progress, 0.05, 0.75);

    // 3. 战火烟尘与零星炮火闪烁（中段 0.3~0.8 最激烈）
    const battleIntensity = Math.sin(Math.PI * THREE.MathUtils.clamp(progress, 0.08, 0.96));
    for (const s of smokePuffs) {
      const rise = reduced ? 0.4 : (elapsed * 0.22 + s.phase) % 1;
      s.sp.position.set(s.baseX + rise * 2.6, s.baseY + rise * 5.2, s.baseZ + Math.sin(elapsed + s.phase) * 0.8);
      s.sp.scale.setScalar(4.2 + rise * 5.8);
      s.mat.opacity = (1 - rise) * 0.34 * (0.35 + 0.65 * battleIntensity);
    }
    for (const f of flashes) {
      const burst = Math.pow(Math.max(0, Math.sin(elapsed * 4.4 + f.phase) * Math.sin(elapsed * 11.3 + f.phase * 2)), 6);
      f.mat.opacity = reduced ? 0 : burst * 0.85 * battleIntensity;
    }

    // 4. 斜飘细雨动画
    if (!reduced) {
      const arr = rainGeo.attributes.position.array;
      for (let i = 0; i < rainCount; i++) {
        const [bx, by, bz, speed] = rainSeeds[i];
        const y = ((by - elapsed * speed) % 26 + 26) % 26;
        const x = bx - (26 - y) * 0.14;
        const idx = i * 6;
        arr[idx] = x; arr[idx + 1] = y; arr[idx + 2] = bz;
        arr[idx + 3] = x + 0.11; arr[idx + 4] = y + 0.82; arr[idx + 5] = bz + 0.04;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
  }

  return { scene, update };
}
