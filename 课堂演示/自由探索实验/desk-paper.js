import * as THREE from 'three';
import notebook from './notebook.json';
import { createRouteBoard } from './evidence.js';

export const deskTop = .801;
export const deskBounds = {x: .85, z: .475};
export const journalOrigin = new THREE.Vector3(-.331, deskTop, .100);
export const dossierOrigin = new THREE.Vector3(.243, deskTop, -.013);
export const foldedMap = new THREE.Vector3(.315, deskTop + .002, .333);
const journalSize = [.326, .421];
const dossierSize = [.309, .414];
const looseSize = [.255, .292];
const paperHeight = .018;
const mapWidth = .565, mapDepth = .232;

function surface(color, side = THREE.FrontSide) {
  return new THREE.MeshStandardMaterial({color, side, roughness: .94});
}

function printMaterial(title, rows, { stamp = '', kind = 'paper', paragraphs = [] } = {}) {
  const width = 768, height = 840;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const cover = kind === 'cloth' || kind === 'kraft';
  const background = ctx.createLinearGradient(0, 0, width * .85, height);
  const colors = kind === 'cloth' ? ['#695943','#837153','#504434'] :
    kind === 'kraft' ? ['#a98452','#c3a572','#8e6946'] : ['#d8b987','#f3e6c6','#cdb07d'];
  for (let i = 0; i < colors.length; i++) background.addColorStop(i / (colors.length - 1), colors[i]);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  let seed = 90213;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  ctx.fillStyle = cover ? '#30251d25' : '#68451914';
  for (let i = 0; i < 8700; i++) {
    const x = random() * width, y = random() * height;
    ctx.fillRect(x, y, 1 + 3 * random(), 1 + (cover ? 2 : 5) * random());
  }
  const margin = 66;
  if (cover) {
    ctx.fillStyle = '#d9c39a';
    ctx.fillRect(206, 284, 358, 212);
    ctx.strokeStyle = '#5c4731';
    ctx.lineWidth = 4;
    ctx.strokeRect(216, 294, 338, 192);
    ctx.textAlign = 'center';
    ctx.font = 'bold 58px SimSun, serif';
    ctx.fillStyle = '#34271e';
    ctx.fillText(title, width / 2, 406);
  } else {
    ctx.fillStyle = '#34271c';
    ctx.font = 'bold 73px SimSun, serif';
    ctx.fillText(title, margin, 178, width - 2 * margin);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#9d7653';
    ctx.beginPath();
    ctx.moveTo(margin, 226);
    ctx.lineTo(width - margin, 226);
    ctx.stroke();

    let y = 324;
    for (const [label, value] of rows) {
      ctx.fillStyle = '#604c37';
      ctx.font = '37px Microsoft YaHei, sans-serif';
      ctx.fillText(label, margin, y, width - 2 * margin);
      ctx.fillStyle = '#382520';
      ctx.font = 'bold 65px SimSun, serif';
      ctx.fillText(value, margin, y + 77, width - 2 * margin);
      y += 180;
    }
    for (const paragraph of paragraphs) {
      ctx.font = '42px SimSun, serif';
      ctx.fillStyle = '#382c23';
      for (let i = 0; i < paragraph.length; i += 14) {
        ctx.fillText(paragraph.slice(i, i + 14), margin, y);
        y += 61;
      }
      y += 32;
      if (y > height - 95) break;
    }
    if (stamp) {
      ctx.fillStyle = '#784a34';
      ctx.font = '32px SimSun, serif';
      ctx.fillText(stamp, margin, height - 55, width - 2 * margin);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = surface(0xffffff);
  material.map = texture;
  return material;
}

function placedBox(parent, width, height, depth, at, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(...at);
  mesh.castShadow = mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function makeSheet(width, depth, segments = 1) {
  const geometry = new THREE.PlaneGeometry(width, depth, segments, segments === 1 ? 1 : 12);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, surface(0xe0cd9f));
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function makeLeaf(parent, width, depth, hinge) {
  const face = makeSheet(width, depth, 28);
  const back = new THREE.Mesh(face.geometry, surface(0xd2bd97, THREE.BackSide));
  back.receiveShadow = true;
  back.castShadow = true;
  face.add(back);
  parent.add(face);
  const position = face.geometry.getAttribute('position');
  const original = position.array.slice();
  return {
    face,
    setSurface(front, reverse) {
      face.material = front;
      back.material = reverse;
    },
    bend(progress, curl = 1, swing = 0) {
      const turn = Math.PI * progress;
      const edge = hinge * width / 2;
      const bulge = Math.sin(turn) * curl;
      for (let i = 0; i < position.count; i++) {
        const x = original[i * 3], z = original[i * 3 + 2];
        const span = Math.abs(x - edge);
        const tangent = turn + bulge * (.40 * (span / width - .45) - .36 * z / depth);
        const reach = -hinge * span * Math.cos(tangent);
        position.setXYZ(i, edge + reach * Math.cos(swing),
          span * Math.sin(tangent) + .0005 * (1 + progress), z + reach * Math.sin(swing));
      }
      position.needsUpdate = true;
      face.geometry.computeVertexNormals();
      face.geometry.computeBoundingSphere();
    },
  };
}

function reverseOf(material) {
  const back = material.clone();
  back.map = material.map.clone();
  back.map.repeat.x = -1;
  back.map.offset.x = 1;
  back.map.needsUpdate = true;
  back.side = THREE.BackSide;
  return back;
}

function mountLayers(parent, width, depth, x, baseY, paper, trim) {
  placedBox(parent, width + .007, .0021, depth + .006, [x, baseY + .0011, 0], trim);
  for (let i = 0; i < 9; i++) {
    const taper = ((i % 3) - 1) * .0018;
    placedBox(parent, width - .001 + taper, .00153, depth - .003 - taper,
      [x + taper * .37, baseY + .0032 + i * .00163, taper * .34], paper[i % paper.length]);
  }
}

function makeRope(root, width, depth) {
  const rope = new THREE.Group();
  root.add(rope);
  const strips = [
    [[-.5, 0, .06], [-.25, 0, .04], [.15, .07, .054], [.5, 0, .05], [.503, -.7, .05], [.49, -.89, .05]],
    [[.14, -.8, -.5], [.15, 0, -.5], [.15, .03, -.28], [.15, .9, .05], [.18, 0, .36], [.18, -.65, .49]],
    [[.15, .45, .06], [.19, .85, .094], [.26, .62, .041], [.20, .53, .013], [.15, .45, .06],
      [.078, .68, .073], [-.012, .72, .030], [.10, .53, -.007], [.15, .44, .06]],
    [[.16, .45, .06], [.25, .22, .145], [.36, .1, .183], [.43, -.20, .28], [.50, -.43, .29]],
    [[.13, .57, .059], [.07, .39, .136], [-.01, .07, .155], [-.067, -.12, .248]],
  ];
  const hemp = surface(0x97693c);
  for (const strip of strips) {
    const curve = new THREE.CatmullRomCurve3(strip.map(([x, y, z]) => new THREE.Vector3(x * width, y * .008, z * depth)));
    const cord = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, .0024, 6, false), hemp);
    cord.castShadow = cord.receiveShadow = true;
    rope.add(cord);
  }
  return rope;
}

function makeFoldedMap(scene, routeBoard, paper, trim) {
  const group = new THREE.Group();
  group.position.copy(foldedMap);
  scene.add(group);
  const folded = placedBox(group, .198, .008, .154, [0, .004, 0], paper);
  folded.material = [paper, paper, printMaterial('行军图', [], {kind: 'kraft'}), trim, paper, paper];
  const map = makeSheet(mapWidth, mapDepth, 42);
  const flaps = makeLeaf(group, mapWidth, mapDepth, 1);
  flaps.face.position.y = .008;
  map.position.y = .003;
  group.add(map);
  const routeInk = surface(0xfbf7ec);
  routeInk.map = routeBoard.texture;
  map.material = routeInk;
  const overlay = routeInk.clone();
  const back = reverseOf(overlay);
  overlay.transparent = true;
  overlay.opacity = .88;
  overlay.depthWrite = false;
  flaps.setSurface(overlay, back);
  flaps.face.renderOrder = 2;
  const position = map.geometry.getAttribute('position');
  const original = position.array.slice();
  let previous = '';
  function update(mode, preview) {
    const action = preview?.kind === 'map' ? (mode === 'stored' ? preview.progress : 1 - preview.progress) : mode === 'stored' ? 0 : 1;
    const fold = THREE.MathUtils.clamp(action, 0, 1);
    folded.visible = fold < .03;
    map.visible = fold >= .03;
    group.position.x = THREE.MathUtils.lerp(foldedMap.x, .104, fold);
    const width = .33 + fold * .67;
    for (let i = 0; i < position.count; i++) {
      const dx = original[i * 3];
      const z = original[i * 3 + 2];
      const segment = (dx / mapWidth + .5) * 3;
      const crease = 1 - Math.abs(segment - Math.round(segment));
      position.setXYZ(i, dx * width, (1 - fold) * .094 * Math.max(0, 1.85 * (crease - .5)), z);
    }
    position.needsUpdate = true;
    map.geometry.computeVertexNormals();
    map.geometry.computeBoundingSphere();
    flaps.face.visible = fold > .985 && (mode === 'both' || preview?.kind === 'overlay');
    const lifted = preview?.kind === 'overlay' ? mode === 'both' ? preview.progress : 1 - preview.progress : 0;
    if (flaps.face.visible) flaps.bend(.48 * lifted, .55);
    const style = mode === 'stored' ? 'original' : mode;
    if (style !== previous) {
      routeBoard.paint(style === 'revised' ? 1 : style === 'both' ? .5 : 0, style === 'both');
      previous = style;
    }
  }
  return {group, folded, map, overlay: flaps.face, update};
}

function moveLoose(mesh, at, lift, height) {
  mesh.position.set(at.x, height + .047 * lift, at.z);
  const position = mesh.geometry.getAttribute('position');
  const original = mesh.userData.rest;
  for (let i = 0; i < position.count; i++) {
    const x = original[i * 3], z = original[i * 3 + 2];
    const corner = (x / looseSize[0] + .5) * (z / looseSize[1] + .5);
    position.setY(i, .0025 * corner + .051 * lift * corner * corner);
  }
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}

export function createDeskPapers(scene, terrain) {
  const routeBoard = createRouteBoard(terrain);
  const textures = new Set();
  const materials = new Set();
  function remember(material) {
    materials.add(material);
    if (material.map) textures.add(material.map);
    return material;
  }
  const paper = [surface(0xd0b892), surface(0xe8d6ac), surface(0xcbaf83)].map(remember);
  const cloth = remember(surface(0x58472f));
  const wrapper = remember(surface(0xad8758));
  const leftCover = remember(printMaterial('线装手记', [], {kind: 'cloth'}));
  const rightCover = remember(printMaterial('会议卷宗', [], {kind: 'kraft'}));
  const neutralBack = remember(surface(0xd8c194, THREE.BackSide));
  const pages = notebook.map(page => remember(printMaterial(page.title, page.rows, {stamp: page.note})));
  const facingPages = notebook.map(page => remember(printMaterial(page.title, [], {
    paragraphs: [page.finding],
  })));
  const backPages = facingPages.map(material => remember(reverseOf(material)));
  const meetingInk = remember(printMaterial('会议讨论', [], {
    paragraphs: ['总结第五次反“围剿”失败和长征初期受挫的经验教训。', '集中解决军事和组织问题。'],
    stamp: '1935 年 1 月 · 遵义',
  }));
  const summaryInk = remember(printMaterial('会议材料', [['军事问题', '总结教训'], ['组织问题', '调整领导']]));

  const journal = new THREE.Group(), dossier = new THREE.Group();
  journal.position.copy(journalOrigin);
  journal.rotation.y = THREE.MathUtils.degToRad(-8.3);
  dossier.position.copy(dossierOrigin);
  dossier.rotation.y = THREE.MathUtils.degToRad(10.5);
  scene.add(journal, dossier);

  mountLayers(journal, ...journalSize, 0, 0, paper, cloth);
  const oppositeStack = new THREE.Group();
  journal.add(oppositeStack);
  mountLayers(oppositeStack, ...journalSize, -journalSize[0], 0, paper, cloth);
  const leftPage = makeSheet(...journalSize), rightPage = makeSheet(...journalSize);
  leftPage.position.set(-journalSize[0], paperHeight, 0);
  rightPage.position.y = paperHeight;
  oppositeStack.add(leftPage);
  journal.add(rightPage);
  const leaf = makeLeaf(journal, ...journalSize, -1);
  leaf.face.position.y = paperHeight + .002;
  const note = makeSheet(.095, .131, 10);
  note.position.set(-.111, paperHeight + .004, -.112);
  journal.add(note);

  for (let i = 0; i < 6; i++) {
    const z = -.167 + i * .065;
    const thread = new THREE.TorusGeometry(.006, .00085, 6, 18, Math.PI * 1.35);
    thread.rotateY(Math.PI / 2);
    const loop = new THREE.Mesh(thread, cloth);
    loop.position.set(-journalSize[0] / 2 + .002, .014, z);
    loop.castShadow = true;
    journal.add(loop);
  }

  mountLayers(dossier, ...dossierSize, 0, 0, paper, wrapper);
  const heldSheet = makeSheet(...dossierSize);
  heldSheet.material = summaryInk;
  heldSheet.position.y = paperHeight + .001;
  dossier.add(heldSheet);
  const cover = makeLeaf(dossier, ...dossierSize, 1);
  cover.face.position.y = paperHeight + .006;
  cover.setSurface(rightCover, neutralBack);
  const rope = makeRope(dossier, ...dossierSize);

  const loose = new Map(['discussion', 'before'].map((id, i) => {
    const mesh = makeSheet(...looseSize, 20);
    materials.add(mesh.material);
    mesh.material = i === 0 ? meetingInk : pages[0];
    mesh.userData.rest = mesh.geometry.getAttribute('position').array.slice();
    scene.add(mesh);
    return [id, mesh];
  }));
  const map = makeFoldedMap(scene, routeBoard, paper[0], wrapper);
  const originalMeeting = new THREE.Vector3(0, paperHeight + .002, 0);
  const noteAt = new THREE.Vector3();
  function update({saved, preview}) {
    const spread = saved.spread;
    const flip = preview?.kind === 'page' ? preview : null;
    const next = flip?.direction === 'forward';
    const turn = flip ? (next ? flip.progress : 1 - flip.progress) : spread === 0 ? 0 : 1;
    const current = Math.max(0, spread - 1);
    const destination = THREE.MathUtils.clamp(current + (next ? Number(spread > 0) : -1), 0, pages.length - 1);
    oppositeStack.visible = spread > 0 || !!flip && turn > .54;
    leftPage.material = facingPages[flip && !next ? destination : current];
    rightPage.material = pages[flip && next ? destination : current];
    const closed = spread === 0 || flip && !next && spread === 1;
    leaf.setSurface(closed ? leftCover : pages[flip && !next ? destination : current],
      backPages[flip && next ? destination : current]);
    leaf.face.visible = spread === 0 || !!flip;
    leaf.bend(turn, closed ? .72 : 1);
    const noteId = 'before';
    const savedIds = new Set(saved.sheets.map(sheet => sheet.id));
    note.visible = spread > 0 && !flip && !savedIds.has(noteId) && !(preview?.kind === 'sheet' && preview.id === noteId);
    note.material = pages[0];

    const untied = preview?.kind === 'cord' ? preview.progress : Number(saved.dossier !== 'sealed');
    const opened = preview?.kind === 'cover' ? preview.progress : Number(saved.dossier === 'open');
    const slack = Math.sin(untied * Math.PI) * .020;
    rope.position.set(untied * .078, paperHeight + .011 - untied * .023 + slack, untied * .237);
    rope.rotation.y = .64 * untied;
    rope.scale.set(1 - .24 * untied, 1 - .63 * untied, 1 - .36 * untied);
    cover.bend(opened, .63, .64 * THREE.MathUtils.smoothstep(opened, .57, 1));

    scene.updateMatrixWorld(true);
    dossier.localToWorld(noteAt.copy(originalMeeting));
    for (const [id, mesh] of loose) {
      const sheet = saved.sheets.find(item => item.id === id);
      const moving = preview?.kind === 'sheet' && preview.id === id ? preview : null;
      mesh.visible = !!sheet || !!moving || id === 'discussion' && saved.dossier === 'open';
      if (!mesh.visible) continue;
      const at = moving?.at ?? sheet?.at ?? {x: noteAt.x, z: noteAt.z};
      const order = saved.sheets.findIndex(item => item.id === id);
      const overMap = saved.map !== 'stored' && at.z + looseSize[1] / 2 > foldedMap.z - mapDepth / 2 &&
        Math.abs(at.x - .104) < (mapWidth + looseSize[0]) / 2;
      const overLeft = Math.abs(at.z - journalOrigin.z) < (journalSize[1] + looseSize[1]) / 2 &&
        at.x + looseSize[0] / 2 > journalOrigin.x - journalSize[0] * (spread > 0 ? 1.5 : .5) &&
        at.x - looseSize[0] / 2 < journalOrigin.x + journalSize[0] / 2;
      const overRight = Math.abs(at.z - dossierOrigin.z) < (dossierSize[1] + looseSize[1]) / 2 &&
        at.x + looseSize[0] / 2 > dossierOrigin.x - dossierSize[0] / 2 &&
        at.x - looseSize[0] / 2 < dossierOrigin.x + dossierSize[0] * (saved.dossier === 'open' ? 1.5 : .5);
      const support = deskTop + (overLeft || overRight ? .031 : overMap ? .015 : .002) + Math.max(0, order) * .004;
      moveLoose(mesh, at, moving?.lift ?? 0, !sheet && !moving ? noteAt.y : support);
      mesh.rotation.y = Number.isFinite(sheet?.yaw) ? sheet.yaw : !sheet && !moving ? dossier.rotation.y : -.023;
      if (preview?.kind === 'inspect' && preview.id === id) {
        mesh.position.y += .115;
        mesh.rotation.x = .18;
      } else mesh.rotation.x = 0;
    }
    map.update(saved.map, preview);
    scene.updateMatrixWorld(true);
  }

  function dispose() {
    for (const material of materials) if (material.map) textures.add(material.map);
    for (const object of [journal, dossier, ...loose.values(), map.group]) {
      object.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(material);
          if (material.map) textures.add(material.map);
        }
      });
      scene.remove(object);
    }
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  }
  return {journal, dossier, loose, leaf, note, cover, rope, map, update, dispose};
}

export const journalWidth = journalSize[0];
export const dossierWidth = dossierSize[0];
