import * as THREE from 'three';
import notebook from './notebook.json';
import { createRouteBoard } from './evidence.js';

export const deskTop = .801;
export const deskBounds = {x: .85, z: .475};
export const journalOrigin = new THREE.Vector3(-.331, deskTop, .100);
export const dossierOrigin = new THREE.Vector3(.243, deskTop, -.013);
export const foldedMap = new THREE.Vector3(.395, deskTop + .002, .382);
const expandedMap = {x: .175, z: .390};
const journalSize = [.326, .421];
const dossierSize = [.309, .414];
const looseSize = [.255, .292];
const paperHeight = .018;
const mapWidth = .48, mapDepth = .150;

function makeGrain(kind) {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#808080';
  ctx.fillRect(0, 0, size, size);
  let seed = kind === 'cloth' ? 4109 : kind === 'kraft' ? 7319 : kind === 'rope' ? 5827 : 2917;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  if (kind === 'cloth') {
    for (let i = 0; i < size; i += 3) {
      ctx.fillStyle = i % 6 === 0 ? '#97979766' : '#68686866';
      ctx.fillRect(i, 0, 1.5, size);
      ctx.fillRect(0, i, size, 1.5);
    }
  } else if (kind === 'rope') {
    ctx.strokeStyle = '#a8a8a880';
    ctx.lineWidth = 4;
    for (let i = -size; i < size * 2; i += 14) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + size * .65, size);
      ctx.stroke();
    }
  }
  const strokes = kind === 'kraft' ? 2400 : 1800;
  for (let i = 0; i < strokes; i++) {
    const x = random() * size, y = random() * size;
    const len = 2 + random() * (kind === 'kraft' ? 12 : 8);
    const angle = random() * Math.PI * 2;
    ctx.strokeStyle = i % 2 ? '#9c9c9c33' : '#5e5e5e33';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(kind === 'rope' ? 6 : 2, kind === 'rope' ? 2 : 2);
  return texture;
}

function surface(color, { side = THREE.FrontSide, roughness = .90, bumpMap = null, bumpScale = 0 } = {}) {
  const options = {color, side, roughness};
  if (bumpMap) {
    options.bumpMap = bumpMap;
    options.bumpScale = bumpScale;
  }
  return new THREE.MeshStandardMaterial(options);
}

function paintPaperTone(ctx, width, height, colors, seed, { stains = 8, fibers = 6200, edgeShade = .24, binding = false, crease = false } = {}) {
  const background = ctx.createLinearGradient(0, 0, width * .85, height);
  for (let i = 0; i < colors.length; i++) background.addColorStop(i / (colors.length - 1), colors[i]);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);

  let state = seed;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  for (let i = 0; i < stains; i++) {
    const cx = random() * width, cy = random() * height;
    const radius = width * (.08 + random() * .22);
    const patch = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const alpha = .035 + random() * .07;
    patch.addColorStop(0, `rgba(74, 52, 31, ${alpha.toFixed(3)})`);
    patch.addColorStop(1, 'rgba(74, 52, 31, 0)');
    ctx.fillStyle = patch;
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
  }
  ctx.lineWidth = 1;
  for (let i = 0; i < fibers; i++) {
    const x = random() * width, y = random() * height;
    const len = 1.5 + 8 * random();
    const angle = random() * Math.PI * 2;
    ctx.strokeStyle = i % 3 ? 'rgba(78, 56, 35, 0.11)' : 'rgba(244, 231, 200, 0.12)';
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
    ctx.stroke();
  }
  const vignette = ctx.createRadialGradient(width * .52, height * .46, width * .24, width * .5, height * .5, width * .78);
  vignette.addColorStop(0, 'rgba(54, 38, 22, 0)');
  vignette.addColorStop(1, `rgba(54, 38, 22, ${edgeShade})`);
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
  if (binding) {
    const gutter = ctx.createLinearGradient(0, 0, width * .13, 0);
    gutter.addColorStop(0, 'rgba(42, 31, 20, 0.28)');
    gutter.addColorStop(1, 'rgba(42, 31, 20, 0)');
    ctx.fillStyle = gutter;
    ctx.fillRect(0, 0, width * .13, height);
  }
  if (crease) {
    ctx.strokeStyle = 'rgba(58, 40, 24, 0.16)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(0, height * .54);
    ctx.lineTo(width, height * .545);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(width * .68, 0);
    ctx.lineTo(width * .685, height);
    ctx.stroke();
  }
}

function printMaterial(title, rows, { stamp = '', kind = 'paper', paragraphs = [], grains } = {}) {
  const width = 768, height = 840;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  const isJournal = kind === 'journal';
  const isDossier = kind === 'dossier';
  const isFolded = kind === 'folded';
  const colors = isJournal ? ['#bca47e', '#cfbda0', '#a9916c'] :
    isDossier || isFolded ? ['#9e7c55', '#b79266', '#856544'] : ['#d9be8f', '#f0e2c0', '#cbb07f'];
  const seed = isJournal ? 83113 : isDossier ? 93947 : isFolded ? 61421 : 90213 + title.length * 137;
  paintPaperTone(ctx, width, height, colors, seed, {
    stains: isJournal || isDossier ? 14 : 6,
    fibers: isJournal || isDossier ? 7200 : 4800,
    edgeShade: isJournal || isDossier ? .27 : .16,
    binding: isJournal,
    crease: isDossier,
  });

  const margin = 66;
  if (isJournal) {
    ctx.strokeStyle = 'rgba(86, 70, 46, 0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(width * .735, height * .168);
    ctx.lineTo(width * .734, height * .315);
    ctx.stroke();
    ctx.font = '46px KaiTi, STKaiti, SimSun, serif';
    ctx.fillStyle = 'rgba(53, 46, 35, 0.72)';
    ctx.textAlign = 'center';
    for (let i = 0; i < title.length; i++) {
      ctx.fillText(title[i], width * .78 - i * 2, height * .22 + i * 56);
    }
  } else if (isFolded) {
    ctx.font = '42px KaiTi, STKaiti, SimSun, serif';
    ctx.fillStyle = 'rgba(56, 40, 26, 0.74)';
    ctx.textAlign = 'center';
    for (let i = 0; i < title.length; i++) {
      ctx.fillText(title[i], width * .76, height * .28 + i * 54);
    }
  } else if (!isDossier) {
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
  const material = surface(0xffffff, {
    roughness: isDossier || isFolded ? .87 : isJournal ? .92 : .90,
    bumpMap: grains ? (isDossier || isFolded ? grains.kraft : grains.paper) : null,
    bumpScale: isDossier || isFolded ? .0024 : isJournal ? .0022 : .0014,
  });
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

function makeSheet(width, depth, material, segments = 1) {
  const geometry = new THREE.PlaneGeometry(width, depth, segments, segments === 1 ? 1 : 12);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = mesh.receiveShadow = true;
  return mesh;
}

function makeLeaf(parent, width, depth, hinge, frontMaterial, backMaterial, { castShadow = true } = {}) {
  const face = makeSheet(width, depth, frontMaterial, 28);
  face.castShadow = castShadow;
  const back = new THREE.Mesh(face.geometry, backMaterial);
  back.receiveShadow = true;
  back.castShadow = castShadow;
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

function makeRope(root, width, depth, hemp) {
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
  for (const strip of strips) {
    const curve = new THREE.CatmullRomCurve3(strip.map(([x, y, z]) => new THREE.Vector3(x * width, y * .008, z * depth)));
    const cord = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, .0019, 6, false), hemp);
    cord.castShadow = cord.receiveShadow = true;
    rope.add(cord);
  }
  return rope;
}

function makeFoldedMap(scene, routeBoard, paper, trim, grains, remember) {
  const group = new THREE.Group();
  group.position.copy(foldedMap);
  scene.add(group);
  const foldedCover = remember(printMaterial('行军图', [], {kind: 'folded', grains}));
  const folded = placedBox(group, .185, .008, .136, [0, .004, 0], paper);
  folded.material = [paper, paper, foldedCover, trim, paper, paper];
  const routeInk = remember(surface(0xfbf7ec, {roughness: .89, bumpMap: grains.paper, bumpScale: .0012}));
  routeInk.map = routeBoard.texture;
  const map = makeSheet(mapWidth, mapDepth, routeInk, 42);
  map.position.y = .003;
  group.add(map);
  const overlay = remember(surface(0xffffff, {roughness: .86, bumpMap: grains.paper, bumpScale: .0006}));
  overlay.map = routeBoard.createOverlay();
  overlay.transparent = true;
  overlay.opacity = .94;
  overlay.depthWrite = false;
  const back = remember(reverseOf(overlay));
  back.opacity = .72;
  const flaps = makeLeaf(group, mapWidth, mapDepth, 1, overlay, back, {castShadow: false});
  flaps.face.position.y = .008;
  flaps.face.renderOrder = 2;
  const position = map.geometry.getAttribute('position');
  const original = position.array.slice();
  let previous = '';
  function update(mode, preview) {
    const action = preview?.kind === 'map' ? (mode === 'stored' ? preview.progress : 1 - preview.progress) : mode === 'stored' ? 0 : 1;
    const fold = THREE.MathUtils.clamp(action, 0, 1);
    folded.visible = fold < .03;
    map.visible = fold >= .03;
    group.position.x = THREE.MathUtils.lerp(foldedMap.x, expandedMap.x, fold);
    group.position.z = THREE.MathUtils.lerp(foldedMap.z, expandedMap.z, fold);
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
      if (style === 'revised') routeBoard.paint(1, false);
      else routeBoard.paintBase();
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
  const grains = {
    paper: makeGrain('paper'),
    kraft: makeGrain('kraft'),
    cloth: makeGrain('cloth'),
    rope: makeGrain('rope'),
  };
  for (const grain of Object.values(grains)) textures.add(grain);
  function remember(material) {
    materials.add(material);
    if (material.map) textures.add(material.map);
    return material;
  }
  const paper = [0xd0b892, 0xe8d6ac, 0xcbaf83].map(color => remember(surface(color, {
    roughness: .92, bumpMap: grains.paper, bumpScale: .0012,
  })));
  const cloth = remember(surface(0x6b5a42, {roughness: .96, bumpMap: grains.cloth, bumpScale: .0028}));
  const wrapper = remember(surface(0x9a774f, {roughness: .88, bumpMap: grains.kraft, bumpScale: .0022}));
  const hemp = remember(surface(0x8c704c, {roughness: .95, bumpMap: grains.rope, bumpScale: .0032}));
  const leftCover = remember(printMaterial('随记', [], {kind: 'journal', grains}));
  const rightCover = remember(printMaterial('', [], {kind: 'dossier', grains}));
  const neutralBack = remember(surface(0xd8c194, {side: THREE.BackSide, roughness: .91, bumpMap: grains.paper, bumpScale: .0012}));
  const pages = notebook.map(page => remember(printMaterial(page.title, page.rows, {stamp: page.note, grains})));
  const facingPages = notebook.map(page => remember(printMaterial(page.title, [], {
    paragraphs: [page.finding], grains,
  })));
  const backPages = facingPages.map(material => remember(reverseOf(material)));
  const meetingInk = remember(printMaterial('会议讨论', [], {
    paragraphs: ['总结第五次反“围剿”失败和长征初期受挫的经验教训。', '集中解决军事和组织问题。'],
    stamp: '1935 年 1 月 · 遵义',
    grains,
  }));
  const summaryInk = remember(printMaterial('会议材料', [['军事问题', '总结教训'], ['组织问题', '调整领导']], {grains}));

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
  const leftPage = makeSheet(...journalSize, facingPages[0]), rightPage = makeSheet(...journalSize, pages[0]);
  leftPage.position.set(-journalSize[0], paperHeight, 0);
  rightPage.position.y = paperHeight;
  oppositeStack.add(leftPage);
  journal.add(rightPage);
  const leaf = makeLeaf(journal, ...journalSize, -1, leftCover, backPages[0]);
  leaf.face.position.y = paperHeight + .002;
  const note = makeSheet(.095, .131, pages[0], 10);
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
  const heldSheet = makeSheet(...dossierSize, summaryInk);
  heldSheet.position.y = paperHeight + .001;
  dossier.add(heldSheet);
  const cover = makeLeaf(dossier, ...dossierSize, 1, rightCover, neutralBack);
  cover.face.position.y = paperHeight + .006;
  const rope = makeRope(dossier, ...dossierSize, hemp);

  const loose = new Map(['discussion', 'before'].map((id, i) => {
    const mesh = makeSheet(...looseSize, i === 0 ? meetingInk : pages[0], 20);
    mesh.userData.rest = mesh.geometry.getAttribute('position').array.slice();
    scene.add(mesh);
    return [id, mesh];
  }));
  const map = makeFoldedMap(scene, routeBoard, paper[0], wrapper, grains, remember);
  const originalMeeting = new THREE.Vector3(0, paperHeight + .002, 0);
  const noteAt = new THREE.Vector3();
  const probe = new THREE.Vector3();
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
    rope.position.set(untied * .205, paperHeight + .011 - untied * (paperHeight + .008) + slack, -untied * .145);
    rope.rotation.y = -.52 * untied;
    rope.scale.set(1 - .28 * untied, 1 - .62 * untied, 1 - .38 * untied);
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
      const overMap = saved.map !== 'stored' &&
        Math.abs(at.z - expandedMap.z) < (mapDepth + looseSize[1]) * .44 &&
        Math.abs(at.x - expandedMap.x) < (mapWidth + looseSize[0]) * .46;
      const j = journal.worldToLocal(probe.set(at.x, deskTop, at.z));
      const overLeft = Math.abs(j.z) < journalSize[1] / 2 + looseSize[1] * .38 &&
        j.x > -journalSize[0] * (spread > 0 ? 1.5 : .5) - looseSize[0] * .38 &&
        j.x < journalSize[0] / 2 + looseSize[0] * .38;
      const d = dossier.worldToLocal(probe.set(at.x, deskTop, at.z));
      const overRight = Math.abs(d.z) < dossierSize[1] / 2 + looseSize[1] * .38 &&
        d.x > -dossierSize[0] / 2 - looseSize[0] * .38 &&
        d.x < dossierSize[0] * (saved.dossier === 'open' ? 1.45 : .5) + looseSize[0] * .38;
      const overPencil = at.x > -.11 && at.x < .26 && Math.abs(at.z - .278) < looseSize[1] * .46;
      const support = deskTop + (overLeft || overRight ? paperHeight + .0025 : overMap ? .011 : overPencil ? .0078 : .002) +
        Math.max(0, order) * .0035;
      moveLoose(mesh, at, moving?.lift ?? 0, !sheet && !moving ? noteAt.y : support);
      mesh.rotation.y = !sheet && !moving ? dossier.rotation.y : id === 'discussion' ? .028 : -.035;
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
