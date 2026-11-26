import * as THREE from 'three';
import { loadModel } from './packed-model.js';

function seed() {
  let next = 35112;
  return () => ((next = (Math.imul(next, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function templates(root) {
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const center = bounds.getCenter(new THREE.Vector3());
  const height = bounds.max.y - bounds.min.y;
  const transform = new THREE.Matrix4().makeScale(1 / height, 1 / height, 1 / height)
    .multiply(new THREE.Matrix4().makeTranslation(-center.x, -bounds.min.y, -center.z));
  const shapes = [];
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    const material = mesh.material;
    material.roughness = Math.max(0.74, material.roughness);
    if (material.map) material.map.anisotropy = 6;
    if (material.transparent) {
      material.transparent = false;
      material.depthWrite = true;
      material.alphaTest = 0.41;
      material.alphaToCoverage = true;
      material.emissive.set(0xffffff);
      material.emissiveMap = material.map;
      material.emissiveIntensity = 0.17;
    }
    shapes.push({ mesh, transform: transform.clone().multiply(mesh.matrixWorld) });
  });
  return shapes;
}

function spread(scene, source, positions, shade, groundHeight, shadow) {
  const pose = new THREE.Object3D();
  const matrix = new THREE.Matrix4();
  for (const { mesh, transform } of templates(source)) {
    const copies = new THREE.InstancedMesh(mesh.geometry, mesh.material, positions.length);
    positions.forEach(({ x, z, height, angle, tint, sunk = 0 }, i) => {
      pose.position.set(x, groundHeight(x, z) - sunk, z);
      pose.rotation.y = angle;
      pose.scale.setScalar(height);
      pose.updateMatrix();
      copies.setMatrixAt(i, matrix.multiplyMatrices(pose.matrix, transform));
      copies.setColorAt(i, shade.clone().multiplyScalar(tint));
    });
    copies.castShadow = shadow;
    copies.receiveShadow = true;
    copies.computeBoundingSphere();
    scene.add(copies);
  }
}

export async function placeRiverNature(scene, assets, { center, halfWidth, groundHeight, clearings }) {
  const [tree, farTree, grass, rock] = await Promise.all(
    ['river-tree', 'river-tree-far', 'river-grass', 'river-rock'].map(name => loadModel(assets[name])),
  );
  const random = seed();
  const plant = (x, side, setback, height, sunk = 0) => ({
    x, z: center(x) + side * (halfWidth(x) + setback), height,
    angle: random() * Math.PI * 2, tint: 0.83 + 0.31 * random(), sunk,
  });
  const near = [
    [-35, 1, 8.2, 6.65], [-24.5, 1, 8.8, 5.9], [-8.3, 1, 8.1, 5.8],
    [15.8, 1, 7.2, 6.3], [24.5, 1, 13, 5.7], [-32, -1, 6, 6.35],
    [-12, -1, 10.2, 6.3], [14.5, -1, 6.4, 5.85], [25.1, -1, 8.9, 4.9],
  ].map(([x, side, setback, height]) => plant(x, side, setback, height, 0.035));
  const distant = [];
  for (const [x, side, setback] of [
    [-52, -1, 16], [-29, -1, 25], [-10, -1, 21], [13, -1, 24], [39, -1, 16],
    [-49, 1, 15], [-26, 1, 22], [-4, 1, 23], [17, 1, 22], [40, 1, 18],
  ]) {
    for (let i = 0; i < 5; i++) {
      distant.push(plant(x + (random() - 0.5) * 16, side, setback + (random() - 0.5) * 10,
        2.9 + random() * 3.2, 0.075));
    }
  }
  const grasses = grass.children.filter(node => node.isMesh || node.children.length);
  const rocks = rock.children.filter(node => node.isMesh || node.children.length);
  const clearPath = (x, width) => clearings.every(dock => Math.abs(dock - x) > width);
  const detailedBank = Boolean(assets['river-meadow']);
  const bankGrass = [];
  const bankRocks = [];
  for (let i = 0; i < 112; i++) {
    const x = -53 + 106 * random();
    if (!clearPath(x, 1.9)) continue;
    const side = i % 2 ? 1 : -1;
    bankGrass.push(plant(x, side, 0.36 + random() * 5.1, 0.28 + random() * 0.54, 0.01));
    if (i % 4 === 0) bankRocks.push(plant(x + 0.27, side, 0.30 + 1.1 * random(),
      0.19 + 0.36 * random(), 0.13));
  }
  if (detailedBank) {
    for (let i = 0; i < 330; i++) {
      const x = -47 + 94 * random();
      const side = i % 2 ? 1 : -1;
      const setback = 0.58 + random() * 6.4;
      const clump = Math.sin(x * 0.55 + side * 1.9) * Math.cos(setback * 0.63 - x * 0.21);
      if (!clearPath(x, 2.6) || random() > 0.46 + 0.39 * clump) continue;
      const height = setback < 1.55 ? 0.43 + random() * 0.53 : 0.19 + random() * 0.40;
      bankGrass.push(plant(x, side, setback, height, 0.014));
      if (i % 5 === 0 && clearPath(x + 0.31, 2.6)) {
        bankGrass.push(plant(x + 0.31, side, setback + 0.19, height * 0.72, 0.012));
      }
    }
    for (const [x, side, setback] of [[-3.4, 1, .88], [0.3, 1, .59], [1.25, 1, 1.4],
      [8.5, 1, .61], [10.2, 1, .85], [12.8, 1, 2.2], [2.1, -1, .78], [8.7, -1, 1.05]]) {
      for (let i = 0; i < 6; i++) {
        const height = 0.28 + random() * 0.55;
        bankGrass.push(plant(x + (random() - .5) * 1.40, side, setback + random() * .69, height, .02));
      }
    }
  }
  for (const [x, side] of [[-24.7, 1], [-9.1, -1], [0.4, 1], [14.8, -1], [23.1, 1]]) {
    bankRocks.push(plant(x, side, 0.31, 0.58 + random() * 0.25, 0.17));
    bankRocks.push(plant(x + 1.1, side, 0.64, 0.36 + random() * 0.18, 0.06));
  }
  spread(scene, tree, near, new THREE.Color(0xf6f2df), groundHeight, true);
  spread(scene, farTree, distant, new THREE.Color(0xccd3b8), groundHeight, false);
  grasses.forEach((variant, i) => {
    spread(scene, variant, bankGrass.filter((_, j) => j % grasses.length === i),
      new THREE.Color(0xe2d7ad), groundHeight, false);
  });
  rocks.forEach((variant, i) => {
    spread(scene, variant, bankRocks.filter((_, j) => j % rocks.length === i),
      new THREE.Color(0xc9c2ac), groundHeight, true);
  });
}
