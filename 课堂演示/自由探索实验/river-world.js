import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { loadModel } from './packed-model.js';
import { placeRiverNature } from './river-nature.js';

const riverBounds = { left: -142, right: 142, back: -105, front: 105 };
const waterLevel = -0.26;
const outerReach = x => THREE.MathUtils.smoothstep(Math.abs(x), 36, 102);
const center = x => 2.7 * Math.sin(x / 13) + 0.56 * Math.sin(x / 6.5)
  + outerReach(x) * 7.2 * Math.sin(x / 25 + 0.77);
const halfWidth = x => 5.03 + 0.64 * Math.cos(x / 19)
  + outerReach(x) * (1.5 + 1.15 * Math.sin(x / 18));
const distanceFromWater = (x, z) => Math.abs(z - center(x)) - halfWidth(x);

function groundHeight(x, z) {
  const bank = distanceFromWater(x, z);
  const shore = THREE.MathUtils.smoothstep(bank, -0.80, 1.50);
  const bankRise = THREE.MathUtils.smoothstep(bank, 3.1, 16.8);
  const ridge = THREE.MathUtils.smoothstep(bank, 15, 71);
  const lowHills = 1.38 + 1.95 * (0.5 + 0.5 * Math.cos(x * 0.098 + z * 0.145)) +
    1.26 * (0.51 + 0.49 * Math.sin(z * 0.26 - x * 0.155));
  const farHills = 5.5 + 4.8 * Math.sin(x * 0.063 - z * 0.098) ** 2 +
    3.6 * Math.cos(x * 0.079 + z * 0.061) ** 2;
  const uneven = (Math.sin(x * 0.93 + z * 1.21) + 0.54 * Math.cos(x * 1.45 - z * 0.81)) * 0.041;
  return THREE.MathUtils.lerp(-1.17, 0.39, shore) + bankRise * lowHills +
    ridge * farHills + uneven * THREE.MathUtils.smoothstep(bank, 0.19, 3.55);
}

function terrainAxis(edge, near, nearStep, farStep) {
  const join = (from, to, step) => {
    const count = Math.ceil((to - from) / step);
    return Array.from({ length: count }, (_, i) => THREE.MathUtils.lerp(from, to, i / count));
  };
  return [...join(-edge, -near, farStep), ...join(-near, near, nearStep), ...join(near, edge, farStep), edge];
}

const deckHeight = 0.4895;
const doorWidth = 2.10;
const bankStop = (label, x, side, setback) => ({ label, x, z: center(x) + side * (halfWidth(x) + setback) });
const dock = x => ({ x, z: center(x), span: halfWidth(x) + 1.22 });
const crossings = { east: dock(4.9), downstream: dock(-16.7) };
const approaches = Object.values(crossings);

function bareSoil(x, z, bank) {
  const shore = (1 - THREE.MathUtils.smoothstep(bank, 0.1, 1.18 + 0.25 * Math.sin(x * 0.76))) * 0.69;
  let track = 0;
  for (const entry of approaches) {
    const depth = Math.abs(z - entry.z) - entry.span;
    const bend = Math.sin(Math.max(0, depth) * 0.27) * Math.sign(z - entry.z) * 1.63;
    const width = 1.1 + 0.18 * Math.cos(depth * 2 + z);
    const cross = Math.abs(x - entry.x - bend);
    const worn = (1 - THREE.MathUtils.smoothstep(cross, width, width + 0.7)) *
      THREE.MathUtils.smoothstep(depth, -0.58, 0.04) * (1 - THREE.MathUtils.smoothstep(depth, 8, 14.6));
    track = Math.max(track, worn);
  }
  return Math.max(shore, track * 0.91);
}

export const riverStops = {
  east: bankStop('东门渡口', crossings.east.x + 1.95, 1, 2.5),
  downstream: bankStop('下游渡口', crossings.downstream.x + 1.72, 1, 2.35),
  supply: bankStop('备料岸', -28.7, 1, 1.85),
};

export async function createRiverWorld(assets) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa2ada6);
  scene.fog = new THREE.Fog(0xa2ada6, 89, 218);
  const loader = new THREE.TextureLoader();
  const [groundMap, groundNormal, woodMap, woodNormal, woodRough, waves, soil] = await Promise.all(
    ['river-ground', 'river-ground-normal', 'river-timber', 'river-timber-normal', 'river-timber-rough',
      'water-normal', 'river-soil'].map(async name => {
      const texture = await loader.loadAsync(assets[name]);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = name.endsWith('normal') || name.endsWith('rough') ? THREE.NoColorSpace : THREE.SRGBColorSpace;
      texture.anisotropy = 8;
      return texture;
    }),
  );
  const landscape = new THREE.MeshStandardMaterial({
    map: groundMap, normalMap: groundNormal, normalScale: new THREE.Vector2(0.37, 0.37),
    vertexColors: true, roughness: 0.99,
  });
  landscape.onBeforeCompile = shader => {
    shader.uniforms.soil = { value: soil };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float soilWeight; varying float vSoilWeight;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvSoilWeight = soilWeight;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D soil; varying float vSoilWeight;')
      .replace('#include <map_fragment>', `
        #include <map_fragment>
        vec3 earth = texture2D(soil, vMapUv * 3.1).rgb;
        diffuseColor.rgb = mix(diffuseColor.rgb, earth, vSoilWeight);
      `);
  };
  const wood = new THREE.MeshStandardMaterial({
    color: 0xc8b696, map: woodMap, normalMap: woodNormal, roughnessMap: woodRough, roughness: 0.96,
    normalScale: new THREE.Vector2(0.46, 0.46),
  });
  const hullWood = wood.clone();
  hullWood.color.set(0x9d896f);
  const hemp = new THREE.MeshStandardMaterial({ color: 0xa68b63, roughness: 0.97 });
  const waterCuts = Array.from({ length: approaches.length * 4 }, () => new THREE.Vector4());
  const water = new THREE.ShaderMaterial({
    fog: true,
    uniforms: {
      ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      elapsed: { value: 0 },
      brightness: { value: 1 },
      hulls: { value: waterCuts },
      ripples: { value: waves },
      riverbed: { value: soil },
      deeper: { value: new THREE.Color(0x455d54) },
      shallower: { value: new THREE.Color(0x7d7964) },
      reflectedSky: { value: new THREE.Color(0x9cb1b4) },
    },
    vertexShader: `
      #include <fog_pars_vertex>
      varying vec2 along;
      varying vec3 positionOnRiver;
      void main() {
        along = uv;
        positionOnRiver = (modelMatrix * vec4(position, 1.)).xyz;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: `
      #include <fog_pars_fragment>
      uniform float elapsed, brightness;
      uniform vec4 hulls[${waterCuts.length}];
      uniform sampler2D ripples, riverbed;
      uniform vec3 deeper, shallower, reflectedSky;
      varying vec2 along;
      varying vec3 positionOnRiver;
      void main() {
        vec2 p = positionOnRiver.xz;
        // 船内底板低于外部水线。根据船壳实际截面裁去同一平面的河水。
        for (int i = 0; i < ${waterCuts.length}; i++) {
          vec4 hull = hulls[i];
          vec2 d = p - hull.xy;
          if (dot(d, d) > 9.2) continue;
          float x = hull.w * d.x - hull.z * d.y;
          float z = hull.z * d.x + hull.w * d.y;
          float t = x / 5.82 + .5;
          if (t <= 0. || t >= 1.) continue;
          float rise = (t > .5 ? .166 : .115) * pow(abs(2. * t - 1.), 4.);
          float y = -.26 - rise;
          if (y <= -.394) continue;
          float cut = y < -.375
            ? mix(0., .22, (y + .394) / .019)
            : (y < -.309 ? mix(.22, .55, (y + .375) / .066) : mix(.55, .77, (y + .309) / .109));
          float beam = .82 * pow(max(.012, sin(3.14159265 * t)), t < .55 ? .68 : .83) * (1. - .10 * (t - .5));
          if (abs(z) < cut * beam) discard;
        }
        vec2 a = texture2D(ripples, p * vec2(.064,.157) + vec2(-elapsed*.064,elapsed*.009)).rg * 2. - 1.;
        vec2 q = vec2(p.y + .44*p.x, -.34*p.y+p.x);
        vec2 b = texture2D(ripples, q * vec2(.092,.169) + vec2(elapsed*.051,-elapsed*.027)).rg * 2. - 1.;
        vec2 fine = texture2D(ripples, p * vec2(.23,.68) + vec2(-elapsed*.14,elapsed*.031)).rg * 2. - 1.;
        vec2 slope = a * .49 + b * .34 + fine * .25;
        vec3 n = normalize(vec3(slope.x * .73, 1., slope.y * .67));
        vec3 viewRay = normalize(cameraPosition - positionOnRiver);
        float incidence = max(0., dot(viewRay, n));
        float fresnel = .06 + .71 * pow(1. - incidence, 3.);
        vec3 sunlight = normalize(vec3(-.38, .82, .39));
        vec3 halfway = normalize(sunlight + viewRay);
        float sunAngle = max(0., dot(n, halfway));
        float glint = pow(sunAngle, 31.) * .065 + pow(sunAngle, 98.) * .07;
        float bank = smoothstep(.34, .49, abs(along.y - .5));
        vec3 bed = texture2D(riverbed, p / 2.64 + slope * .032).rgb;
        vec3 color = mix(deeper, mix(shallower, bed, .46), bank * .76) * (1. + slope.y * .16);
        color = mix(color, reflectedSky, fresnel) + glint * vec3(1., .90, .77);
        gl_FragColor = vec4(color * brightness, 1.);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });

  const width = riverBounds.right - riverBounds.left;
  const columns = terrainAxis(riverBounds.right, 42, 0.55, 4.0);
  const rows = terrainAxis(riverBounds.front, 18, 0.45, 3.7);
  const groundPositions = [];
  const groundUV = [];
  const faces = [];
  const shades = [];
  const soilWeights = [];
  const meadow = new THREE.Color(0xc6caaa);
  const clay = new THREE.Color(0xd2c1ac);
  const hills = new THREE.Color(0xa7b7a4);
  const shade = new THREE.Color();
  rows.forEach((z, row) => columns.forEach((x, column) => {
    const d = distanceFromWater(x, z);
    groundPositions.push(x, groundHeight(x, z), z);
    groundUV.push(x / 7.8, -z / 7.8);
    soilWeights.push(bareSoil(x, z, d));
    shade.copy(clay).lerp(meadow, THREE.MathUtils.smoothstep(d, 0.65, 5.7))
      .lerp(hills, THREE.MathUtils.smoothstep(d, 27, 83));
    shade.multiplyScalar(0.94 + 0.055 * Math.sin(x * 0.39 - z * 0.27) * Math.cos(z * 0.21));
    shades.push(shade.r, shade.g, shade.b);
    if (row && column) {
      const i = row * columns.length + column;
      faces.push(i - columns.length - 1, i - 1, i - columns.length, i - columns.length, i - 1, i);
    }
  }));
  const landscapeMesh = new THREE.BufferGeometry();
  landscapeMesh.setAttribute('position', new THREE.Float32BufferAttribute(groundPositions, 3));
  landscapeMesh.setAttribute('uv', new THREE.Float32BufferAttribute(groundUV, 2));
  landscapeMesh.setIndex(faces);
  landscapeMesh.setAttribute('color', new THREE.Float32BufferAttribute(shades, 3));
  landscapeMesh.setAttribute('soilWeight', new THREE.Float32BufferAttribute(soilWeights, 1));
  landscapeMesh.computeVertexNormals();
  const terrain = new THREE.Mesh(landscapeMesh, landscape);
  terrain.receiveShadow = true;
  scene.add(terrain);

  const positions = [];
  const uvs = [];
  const index = [];
  const segments = 340;
  for (let i = 0; i <= segments; i++) {
    const x = riverBounds.left + i / segments * width;
    for (const side of [-1, 1]) {
      positions.push(x, waterLevel, center(x) + side * (halfWidth(x) + 1.25));
      uvs.push(i / segments, (side + 1) / 2);
    }
    if (i) index.push(2 * i - 2, 2 * i - 1, 2 * i, 2 * i - 1, 2 * i + 1, 2 * i);
  }
  const river = new THREE.BufferGeometry();
  river.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  river.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  river.setIndex(index);
  scene.add(new THREE.Mesh(river, water));

  function box(size, at, material, parent = scene, radius = 0, grain = 0) {
    const geometry = radius ? new RoundedBoxGeometry(...size, 1, radius) : new THREE.BoxGeometry(...size);
    if (grain) {
      const uv = geometry.attributes.uv;
      const positions = geometry.attributes.position;
      const alongX = size[0] > size[2];
      const strip = [0.056, 0.174, 0.301, 0.408, 0.508, 0.616, 0.731, 0.838][Math.floor(grain * 17) % 8];
      for (let i = 0; i < uv.count; i++) {
        const long = alongX ? positions.getX(i) : positions.getZ(i);
        const wide = alongX ? positions.getZ(i) / size[2] : positions.getX(i) / size[0];
        uv.setXY(i, strip + wide * 0.079, long * 0.41 + grain + positions.getY(i) * 0.3);
      }
    }
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(...at);
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  const clearings = [...approaches.map(bridge => bridge.x), riverStops.supply.x];
  const [boat] = await Promise.all([
    loadModel(assets['river-boat']),
    placeRiverNature(scene, assets, { center, halfWidth, groundHeight, clearings }),
  ]);
  boat.traverse(part => {
    if (!part.isMesh) return;
    part.castShadow = part.receiveShadow = true;
    if (part.material.map) part.material.map.anisotropy = 6;
  });

  function lashBeam(group, x, z, material) {
    const corner = value => Math.sign(value) * Math.abs(value) ** 0.42;
    const points = Array.from({ length: 41 }, (_, i) => {
      const angle = i / 40 * Math.PI * 5;
      return new THREE.Vector3(x + 0.121 * corner(Math.cos(angle)),
        0.283 + 0.113 * corner(Math.sin(angle)), z + (i / 40 - 0.5) * 0.14);
    });
    const strand = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points),
      40, 0.017, 5), material);
    strand.castShadow = true;
    group.add(strand);
    const ends = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x + 0.102, 0.192, z - 0.065),
      new THREE.Vector3(x + 0.135, 0.172, z + 0.013),
      new THREE.Vector3(x + 0.081, 0.169, z + 0.067),
      new THREE.Vector3(x + 0.055, 0.188, z - 0.018),
    ]);
    group.add(new THREE.Mesh(new THREE.TubeGeometry(ends, 9, 0.012, 5), material));
  }

  const floats = Object.fromEntries(Object.entries(crossings).map(([id, spec]) => {
    const colors = [0xd9c8aa, 0xbfad94, 0xe0cfb1].map(color => {
      const material = wood.clone();
      material.color.set(color).multiplyScalar(1.14);
      return material;
    });
    const bayLength = spec.span / 2;
    const bays = Array.from({ length: 4 }, (_, bay) => {
      const z = spec.z + (bay - 1.5) * bayLength;
      const support = new THREE.Group();
      const hull = boat.clone(true);
      hull.position.set(spec.x, 0, z);
      scene.add(support, hull);
      for (const x of [spec.x - 0.96, spec.x + 0.96]) {
        box([0.22, 0.203, bayLength - 0.018], [x, 0.285, z], hullWood, support, 0.015, 0.19 + bay * 0.24);
        for (const side of [-1, 1]) {
          box([0.267, 0.024, 0.174], [x, 0.178, z + side * 0.742], hullWood, support, 0.004, 0.28);
          lashBeam(support, x, z + side * 0.739, hemp);
        }
      }
      const boards = [];
      for (let i = 0; i < 6; i++) {
        const length = bayLength / 6;
        const at = new THREE.Vector3(spec.x, 0.438, z + (i - 2.5) * length);
        const width = 2.66 + ((bay + i * 3) % 5 - 2) * 0.023;
        const material = colors[(bay + i) % colors.length];
        let mesh;
        let boardWidth = width;
        if (id === 'downstream' && bay === 2 && i === 5) {
          boardWidth = doorWidth;
          const shape = new THREE.Shape();
          const half = (length - 0.022) / 2;
          shape.moveTo(-1.05, -half);
          shape.lineTo(1.043, -half + 0.004);
          shape.lineTo(1.05, half - 0.01);
          shape.lineTo(-1.038, half);
          shape.closePath();
          for (const x of [-0.93, -0.838]) {
            const hole = new THREE.Path();
            hole.absarc(x, 0.078, 0.020, 0, Math.PI * 2, true);
            shape.holes.push(hole);
          }
          const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: 0.094, bevelThickness: 0.0045, bevelSize: 0.004, bevelSegments: 2, curveSegments: 12,
          });
          geometry.rotateX(-Math.PI / 2).translate(0, -0.047, 0);
          const uv = geometry.attributes.uv;
          const points = geometry.attributes.position;
          for (let j = 0; j < uv.count; j++) {
            const z = points.getZ(j);
            const band = THREE.MathUtils.clamp(Math.floor((z / half + 1) * 1.5), 0, 2);
            const strip = [0.18, 0.30, 0.414][band];
            uv.setXY(j, strip + (((z / half + 1) * 1.5) % 1 - 0.5) * 0.082, 0.56 + points.getX(j) * 0.35);
          }
          const weathered = wood.clone();
          weathered.color.set(0xefdbc0).multiplyScalar(1.21);
          mesh = new THREE.Mesh(geometry, weathered);
          const wornRim = new THREE.MeshStandardMaterial({ color: 0xa38c6c, roughness: 0.93 });
          for (const x of [-0.93, -0.838]) {
            const rim = new THREE.Mesh(new THREE.RingGeometry(0.020, 0.030, 13), wornRim);
            rim.rotation.x = -Math.PI / 2;
            rim.position.set(x, 0.0518, -0.078);
            mesh.add(rim);
          }
          const joint = new THREE.MeshStandardMaterial({ color: 0x584637, roughness: 0.98 });
          for (const z of [-half / 3, half / 3]) {
            box([2.068, 0.001, 0.004], [0, 0.0516, z], joint, mesh);
          }
          for (const x of [-0.65, 0.66]) {
            box([0.11, 0.027, half * 1.94], [x, -0.062, 0], hullWood, mesh, 0.004, x);
          }
          mesh.castShadow = mesh.receiveShadow = true;
          scene.add(mesh);
        } else {
          mesh = box([width, 0.103, length - 0.022],
            at.toArray(), material, scene, 0.012, 0.17 * (1 + bay + i));
        }
        mesh.position.copy(at);
        boards.push({ mesh, at, width: boardWidth, depth: length });
      }
      return { z, hull, support, boards };
    });
    return [id, { ...spec, bays, anchor: new THREE.Vector3(spec.x, 0, bays[2].z) }];
  }));

  const supplyX = riverStops.supply.x;
  const supplyBerth = new THREE.Vector3(supplyX, 0, center(supplyX) + halfWidth(supplyX) - 1.0);
  const repair = floats.downstream.bays[2];
  const hulls = Object.values(floats).flatMap(float => float.bays.map(bay => bay.hull));
  const door = repair.boards.at(-1);
  const apron = new THREE.Vector3(floats.downstream.x, 0, floats.downstream.z + floats.downstream.span + 0.55);
  apron.y = groundHeight(apron.x, apron.z) + 0.128;
  const pole = new THREE.Group();
  const bamboo = new THREE.MeshStandardMaterial({ color: 0xa88d62, roughness: 0.77 });
  const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.029, 2.48, 10), bamboo);
  cane.castShadow = true;
  pole.add(cane);
  for (let n = -4; n <= 4; n++) {
    const node = new THREE.Mesh(new THREE.TorusGeometry(0.0235 - n * 0.00094, 0.0021, 5, 12), hemp);
    node.rotation.x = Math.PI / 2;
    node.position.y = n * 0.24;
    pole.add(node);
  }
  scene.add(pole);
  pole.visible = false;

  function planks(site, count) {
    const pile = new THREE.Group();
    const x = site.x - 2.0;
    const z = site.z + 0.42;
    for (let i = 0; i < count; i++) {
      box([2.38 + (i % 3) * 0.13, 0.073, 0.70],
        [x + 0.045 * i, groundHeight(x, z) + 0.039 + i * 0.073, z - 0.025 * i], wood, pile, 0.012, 0.17 * (i + 1))
        .rotation.y = 0.07 * Math.sin(i * 2.35);
    }
    scene.add(pile);
    return pile;
  }
  const reserveTimber = planks(riverStops.supply, 6);
  const downstreamTimber = planks(riverStops.downstream, 4);

  const sun = new THREE.DirectionalLight(0xffecd1, 2.18);
  sun.position.set(-22, 42, 37);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1536, 1536);
  Object.assign(sun.shadow.camera, { left: -44, right: 44, top: 44, bottom: -44, far: 117 });
  sun.shadow.normalBias = 0.07;
  const fill = new THREE.DirectionalLight(0xd4e2e0, 0.62);
  fill.position.set(17, 16, -15);
  const sky = new THREE.HemisphereLight(0xe5edef, 0x655948, 2.04);
  scene.add(sun, fill, sky);
  const periods = [
    { sky: new THREE.Color(0x9b9390), water: new THREE.Color(0x929caa), key: new THREE.Color(0xffd4ac), sun: 1.47, fill: 0.73, ambient: 1.42 },
    { sky: new THREE.Color(0x536478), water: new THREE.Color(0x5e7890), key: new THREE.Color(0xb5c9ec), sun: 0.66, fill: 0.78, ambient: 1.26 },
    { sky: new THREE.Color(0xb7b5ac), water: new THREE.Color(0xa4aeb2), key: new THREE.Color(0xffdcc0), sun: 1.69, fill: 0.72, ambient: 1.67 },
  ];

  function lightAt(time) {
    const from = periods[time >= 1 ? 1 : 0];
    const to = periods[time >= 1 ? 2 : 1];
    const mix = time >= 1 ? time - 1 : time;
    scene.background.lerpColors(from.sky, to.sky, mix);
    scene.fog.color.copy(scene.background);
    water.uniforms.reflectedSky.value.lerpColors(from.water, to.water, mix);
    water.uniforms.brightness.value = THREE.MathUtils.lerp(0.48, 0.92, Math.abs(time - 1));
    sun.color.lerpColors(from.key, to.key, mix);
    sun.intensity = THREE.MathUtils.lerp(from.sun, to.sun, mix);
    fill.intensity = THREE.MathUtils.lerp(from.fill, to.fill, mix);
    sky.intensity = THREE.MathUtils.lerp(from.ambient, to.ambient, mix);
  }

  function positionHeight(x, z) {
    for (const float of Object.values(floats)) {
      if (Math.abs(x - float.x) > 1.31 || Math.abs(z - float.z) > float.span) continue;
      const bay = float.bays[Math.min(3, Math.floor((z - float.z + float.span) / (float.span / 2)))];
      if (bay.support.visible) return deckHeight;
    }
    return groundHeight(x, z);
  }

  function footingAt(x, z) {
    for (const float of Object.values(floats)) {
      if (Math.abs(x - float.x) > 1.35 || Math.abs(z - float.z) > float.span) continue;
      const bay = float.bays[Math.min(3, Math.floor((z - float.z + float.span) / (float.span / 2)))];
      for (const { mesh, at, width, depth } of bay.boards) {
        if (mesh.visible && mesh.position.distanceToSquared(at) < 0.00015 &&
            Math.abs(x - at.x) <= width / 2 && Math.abs(z - at.z) <= depth / 2) return deckHeight;
      }
    }
    return groundHeight(x, z);
  }

  function travelBoat(from, to, amount, hull) {
    const x = THREE.MathUtils.lerp(from.x, to.x, amount);
    const offset = THREE.MathUtils.lerp(from.z - center(from.x), to.z - center(to.x), amount);
    hull.position.set(x, 0, center(x) + offset);
  }

  function cutWater() {
    hulls.forEach((hull, i) => {
      const angle = hull.rotation.y;
      waterCuts[i].set(hull.position.x, hull.position.z, Math.sin(angle), Math.cos(angle));
    });
  }

  function setBridges(complete) {
    for (const float of Object.values(floats)) {
      for (const bay of float.bays) {
        const assembled = complete || bay !== repair;
        bay.support.visible = assembled;
        bay.support.position.y = 0;
        bay.hull.position.set(float.x, 0, bay.z);
        bay.hull.rotation.y = 0;
        for (const { mesh, at } of bay.boards) {
          mesh.visible = assembled;
          mesh.position.copy(at);
          mesh.rotation.set(0, 0, 0);
        }
      }
    }
    if (!complete) repair.hull.position.copy(supplyBerth);
    cutWater();
    pole.visible = false;
    downstreamTimber.visible = reserveTimber.visible = !complete;
  }

  function stageBoat(progress) {
    travelBoat(supplyBerth, floats.downstream.anchor, 0.72 * progress, repair.hull);
    cutWater();
  }

  function assemble(time) {
    const ease = (a, b) => THREE.MathUtils.smoothstep(time, a, b);
    travelBoat(supplyBerth, floats.downstream.anchor, 0.72 + 0.28 * ease(0, 1.05), repair.hull);
    cutWater();
    const stable = time >= 1.05;
    const ready = time >= 1.42;
    repair.support.visible = stable;
    repair.support.position.y = 0;
    for (const { mesh } of repair.boards) mesh.visible = ready;
    const lift = ease(0.13, 0.67);
    const approach = ease(0.63, 2.68);
    const putDown = ease(2.72, 3.41);
    const board = door.mesh;
    board.visible = true;
    board.position.copy(apron).lerp(door.at, approach);
    const walkingY = Math.max(deckHeight, groundHeight(board.position.x, board.position.z)) + 0.88;
    const sway = Math.sin(15 * time) * ease(0.67, 0.95) * (1 - ease(2.25, 2.68));
    board.position.y = THREE.MathUtils.lerp(THREE.MathUtils.lerp(apron.y, walkingY, lift), door.at.y, putDown) + 0.012 * sway;
    board.rotation.z = 0.018 * sway;
    pole.visible = true;
    const foot = repair.hull.getObjectByName('bow-footing').getWorldPosition(new THREE.Vector3());
    pole.position.set(foot.x + 0.16, foot.y + 0.90 + 0.16 * ease(1.04, 1.72), foot.z + 0.345);
    pole.rotation.z = -0.26 + 0.19 * ease(0.02, 1.25);
    pole.rotation.x = 0.18 * (1 - ease(0.42, 1.18));
    pole.updateMatrixWorld(true);
    const grips = [0.32, 0.112].map(y => pole.localToWorld(new THREE.Vector3(0, y, 0)));
    downstreamTimber.visible = time < 3.41;
    return { board, foot, grips, release: ease(3.41, 3.84), stanceEdge: door.at.z + door.depth * 0.5 };
  }

  function clearBridges(time) {
    const carried = [];
    for (const { x, z, span, bays } of Object.values(floats)) {
      bays.forEach((bay, i) => {
        const direction = i < 2 ? -1 : 1;
        const berthX = x + (i - 1.5) * 4.2;
        const berthZ = center(berthX) + direction * (halfWidth(berthX) - 0.68);
        const delay = (i === 0 || i === 3) ? 0.82 : 0;
        const retreat = THREE.MathUtils.smoothstep(time, delay + 1.09, delay + 2.48);
        travelBoat(new THREE.Vector3(x, 0, bay.z), new THREE.Vector3(berthX, 0, berthZ), retreat, bay.hull);
        bay.hull.rotation.y = direction * retreat * 0.18;
        const load = THREE.MathUtils.smoothstep(time, delay + 0.83, delay + 1.09);
        bay.support.visible = load < 1;
        bay.support.position.y = -load * 0.16;
        const bank = z + direction * (span + 1.55);
        for (const [j, { mesh, at }] of bay.boards.entries()) {
          const toShore = (i === 0 && j === 0) || (i === 3 && j === 5);
          const start = delay + (toShore ? 0 : 0.024 * j);
          const lift = THREE.MathUtils.smoothstep(time, start, start + 0.23);
          const progress = THREE.MathUtils.smoothstep(time, start + 0.19, start + 0.79);
          const set = THREE.MathUtils.smoothstep(time, start + 0.75, start + 0.97);
          const stackX = toShore ? x : x - 0.52;
          const stackZ = toShore ? bank : bay.z + (j - 2.5) * 0.052;
          const stackHeight = toShore ? groundHeight(stackX, stackZ) + 0.052 : 0.02 + j * 0.091;
          mesh.position.set(THREE.MathUtils.lerp(at.x, stackX, progress), 0,
            THREE.MathUtils.lerp(at.z, stackZ, progress));
          mesh.position.y = THREE.MathUtils.lerp(at.y + lift * 0.38, stackHeight, set);
          if (toShore && lift > 0 && set < 1) carried.push({ board: mesh.position, direction });
          if (!toShore) {
            mesh.position.x += bay.hull.position.x - x;
            mesh.position.z += bay.hull.position.z - bay.z;
          }
        }
      });
    }
    cutWater();
    return carried;
  }

  setBridges(false);
  lightAt(0);
  return { scene, water, floats, lightAt, setBridges, stageBoat, assemble, clearBridges, positionHeight, footingAt,
    door: door.mesh, timber: downstreamTimber };
}
