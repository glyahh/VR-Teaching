import * as THREE from 'three';
import pages from './notebook.json';

export async function prepareFolio(notebook, hinge, first, loader, assets) {
  const maps = [first.material.map, ...await Promise.all(pages.slice(1).map(async (_, index) => {
    const texture = await loader.loadAsync(assets['folio-page-' + (index + 2)]);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = first.material.map.flipY;
    texture.anisotropy = 8;
    return texture;
  }))];
  const rear = first.material.clone();
  rear.map = notebook.getObjectByName('封面内衬')?.material.map ?? null;
  if (!rear.map) rear.color.set('#dbc49d');
  rear.side = THREE.BackSide;
  rear.polygonOffset = true;
  rear.polygonOffsetFactor = 1;
  rear.polygonOffsetUnits = 1;
  first.updateMatrix();
  const baseGeometry = first.geometry.clone().applyMatrix4(first.matrix);
  const rest = baseGeometry.attributes.position.array.slice();
  const xEdge = hinge.position.x;
  const yEdge = hinge.position.y;
  let pageWidth = 0.001;
  for (let i = 0; i < rest.length; i += 3) {
    pageWidth = Math.max(pageWidth, rest[i] - xEdge);
  }
  first.removeFromParent();
  const leaves = maps.map(map => {
    const material = first.material.clone();
    material.map = map;
    material.side = THREE.FrontSide;
    const shape = baseGeometry.clone();
    const face = new THREE.Mesh(shape, material);
    const back = new THREE.Mesh(shape, rear);
    face.castShadow = face.receiveShadow = true;
    back.castShadow = false;
    back.receiveShadow = true;
    const leaf = new THREE.Group();
    leaf.add(face, back);
    leaf.visible = false;
    face.frustumCulled = back.frustumCulled = false;
    notebook.add(leaf);
    return { leaf, shape, last: NaN };
  });

  return position => {
    hinge.rotation.z = Math.min(position, 1) * Math.PI * 0.985;
    const active = Math.max(0, Math.floor(position - 1));
    for (const [index, sheet] of leaves.entries()) {
      const turn = THREE.MathUtils.clamp(position - 1 - index, 0, 1);
      sheet.leaf.visible = position > 0.14 && (index === active || index === active - 1 ||
        (index === active + 1 && turn === 0 && position > active + 1));
      if (!sheet.leaf.visible || sheet.last === turn) continue;
      const points = sheet.shape.attributes.position;
      const curl = Math.sin(Math.PI * turn);
      const settle = turn * turn;
      for (let i = 0; i < points.count; i++) {
        const x = rest[3 * i] - xEdge;
        const y = rest[3 * i + 1] - yEdge + 0.0018;
        const z = rest[3 * i + 2];
        const u = THREE.MathUtils.clamp(x / pageWidth, 0, 1);
        const angle = turn * Math.PI * 0.97 + settle * 0.032 * u * u +
          curl * u * (0.48 - 0.95 * u + z * 0.42);
        points.setXYZ(i, xEdge + Math.cos(angle) * x - Math.sin(angle) * y,
          yEdge + Math.sin(angle) * x + Math.cos(angle) * y - index * 0.00035 * (1 - 2 * turn), z);
      }
      points.needsUpdate = true;
      sheet.shape.computeVertexNormals();
      sheet.last = turn;
    }
  };
}
