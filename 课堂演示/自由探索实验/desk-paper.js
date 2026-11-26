import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import notebook from './notebook.json';
import { createRouteBoard } from './evidence.js';

export const deskTop = .801;
export const deskBounds = {x: .85, z: .475};
export const journalOrigin = new THREE.Vector3(-.331, deskTop, .100);
export const dossierOrigin = new THREE.Vector3(.243, deskTop, -.013);
export const foldedMap = new THREE.Vector3(.395, deskTop + .002, .382);
const expandedMap = {x: .216, z: .354};
const journalSize = [.326, .421];
const dossierSize = [.309, .414];
const looseSize = [.255, .292];
const paperHeight = .018;
const mapWidth = .416, mapDepth = .220, mapPanels = 3, mapSegments = 48;

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
    if (title) {
      ctx.fillStyle = '#34271c';
      ctx.font = 'bold 73px SimSun, serif';
      ctx.fillText(title, margin, 178, width - 2 * margin);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#9d7653';
      ctx.beginPath();
      ctx.moveTo(margin, 226);
      ctx.lineTo(width - margin, 226);
      ctx.stroke();
    }

    let y = title ? 324 : 178;
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
    bumpScale: isDossier || isFolded ? .00072 : isJournal ? .0006 : .00034,
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

function makeLeaf(parent, width, depth, hinge, frontMaterial, backMaterial, {castShadow=true, thickness=.00032}={}) {
  const segments = 32, rows = 13, stride = segments+1;
  const face = makeSheet(width, depth, frontMaterial, segments);
  face.castShadow = castShadow;
  face.receiveShadow = false;
  if (castShadow) frontMaterial.shadowSide = THREE.DoubleSide;
  const back = new THREE.Mesh(face.geometry.clone(), backMaterial);
  back.receiveShadow = false;
  back.castShadow = false;
  face.add(back);
  parent.add(face);
  const position = face.geometry.getAttribute('position');
  const underside = back.geometry.getAttribute('position');
  const original = position.array.slice();
  const perimeter = [];
  for (let x=0; x<stride; x++) perimeter.push(x);
  for (let z=1; z<rows; z++) perimeter.push(z*stride+segments);
  for (let x=segments-1; x>=0; x--) perimeter.push((rows-1)*stride+x);
  for (let z=rows-2; z>0; z--) perimeter.push(z*stride);
  const edgeGeometry = new THREE.BufferGeometry();
  const edgePosition = new THREE.BufferAttribute(new Float32Array(perimeter.length*6), 3);
  const edgeIndices = [];
  for (let i=0; i<perimeter.length; i++) {
    const a=i*2, b=((i+1)%perimeter.length)*2;
    edgeIndices.push(a,b,a+1,b,b+1,a+1);
  }
  edgeGeometry.setAttribute('position',edgePosition);
  edgeGeometry.setIndex(edgeIndices);
  const border = new THREE.Mesh(edgeGeometry,surface(0xad926c,{side:THREE.DoubleSide}));
  face.add(border);
  let previous;
  return {
    face,
    setSurface(front, reverse) {
      if (castShadow) front.shadowSide = THREE.DoubleSide;
      face.material = front;
      back.material = reverse;
    },
    bend(progress, curl = 1, swing = 0, drop = 0) {
      const signature=[progress,curl,swing,drop];
      if (previous?.every((value,index)=>value===signature[index])) return;
      previous=signature;
      const turn = Math.PI * progress;
      const pin = hinge * width / 2;
      const flex = Math.sin(turn)*curl;
      const settling = THREE.MathUtils.smoothstep(progress,.72,1)*drop;
      const ds = width/segments, swingX = Math.cos(swing), swingZ = Math.sin(swing);
      for (let row=0; row<rows; row++) {
        const z = original[(row*stride)*3+2];
        const twist = z/depth;
        let x=0, y=0;
        for (let column=0; column<=segments; column++) {
          const index = row*stride+(hinge<0 ? column : segments-column);
          const u = column/segments;
          if (column) {
            const t = u-.5/segments;
            const bend = flex*(.96*(t-.34) + .37*twist*t - .31*Math.sin(Math.PI*t));
            const angle = THREE.MathUtils.clamp(turn+bend,0,Math.PI);
            x -= hinge*ds*Math.cos(angle);
            y += ds*Math.sin(angle);
          }
          const wornCorner = flex*.0045*twist*Math.abs(twist)*u*u;
          position.setXYZ(index,pin+x*swingX,y+wornCorner-settling*u,z+x*swingZ);
        }
      }
      position.needsUpdate = true;
      face.geometry.computeVertexNormals();
      face.geometry.computeBoundingSphere();
      const normal=face.geometry.getAttribute('normal');
      for (let i=0;i<position.count;i++) {
        underside.setXYZ(i,position.getX(i)-normal.getX(i)*thickness,
          position.getY(i)-normal.getY(i)*thickness,position.getZ(i)-normal.getZ(i)*thickness);
      }
      underside.needsUpdate=true;
      back.geometry.computeVertexNormals();
      back.geometry.computeBoundingSphere();
      for (let i=0;i<perimeter.length;i++) {
        const k=perimeter[i];
        edgePosition.setXYZ(2*i,position.getX(k),position.getY(k),position.getZ(k));
        edgePosition.setXYZ(2*i+1,underside.getX(k),underside.getY(k),underside.getZ(k));
      }
      edgePosition.needsUpdate=true;
      edgeGeometry.computeVertexNormals();
      edgeGeometry.computeBoundingSphere();
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
  const sheets = [];
  const count=36, thickness=(paperHeight-.0044)/count;
  for (let i=0;i<count;i++) {
    const taper=.0012*Math.sin(i*1.91)+.00068*Math.sin(i*3.28);
    const layer=new THREE.BoxGeometry(width-.001+taper,thickness*.92,depth-.003-taper,3,1,5);
    const vertices=layer.getAttribute('position');
    const color=paper[i%paper.length].color.clone().multiplyScalar(.92+.14*Math.sin(i*2.4)**2);
    const colors=new Float32Array(vertices.count*3);
    for (let j=0;j<vertices.count;j++) {
      const dx=vertices.getX(j), dy=vertices.getY(j), z=vertices.getZ(j);
      const nearEdge=Math.abs(dx)/(width*.5);
      const waviness=.00034*Math.sin(z*63+i*.82)*nearEdge;
      vertices.setXYZ(j,dx+x+taper*.32,baseY+.003+dy+thickness*(i+.5)+waviness,z+taper*.37);
      color.toArray(colors,j*3);
    }
    layer.setAttribute('color',new THREE.BufferAttribute(colors,3));
    layer.computeVertexNormals();
    sheets.push(layer);
  }
  const block = new THREE.Mesh(mergeGeometries(sheets),new THREE.MeshStandardMaterial({vertexColors:true,roughness:.93}));
  block.castShadow=block.receiveShadow=true;
  parent.add(block);
  for (const layer of sheets) layer.dispose();
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
  const map = makeSheet(mapWidth, mapDepth, routeInk, mapSegments);
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
  let previous = '', previousFold = -1;
  const outlineX = new Float32Array(mapSegments+1), outlineY = new Float32Array(mapSegments+1);
  function shape(fold) {
    if (fold===previousFold) return;
    previousFold=fold;
    const step=mapWidth/mapSegments, span=mapSegments/mapPanels;
    outlineX[0]=outlineY[0]=0;
    for (let i=1;i<=mapSegments;i++) {
      const panel=Math.floor((i-1)/span);
      const easing=THREE.MathUtils.smoothstep(fold,panel*.055,1-(mapPanels-1-panel)*.055);
      const hinged=panel%2 ? Math.PI*(1-easing) : .32*Math.sin(Math.PI*easing);
      outlineX[i]=outlineX[i-1]+step*Math.cos(hinged);
      outlineY[i]=outlineY[i-1]+step*Math.sin(hinged);
    }
    const middle=(Math.min(...outlineX)+Math.max(...outlineX))*.5;
    const depthScale=THREE.MathUtils.lerp(.64,1,fold);
    for (let i=0;i<position.count;i++) {
      const index=i%(mapSegments+1), z=original[3*i+2];
      const edge=Math.abs(z)/mapDepth*2;
      const curl=.0022*edge**5*(.58+.42*Math.sin(index*.22)**2);
      position.setXYZ(i,outlineX[index]-middle,outlineY[index]+curl,z*depthScale);
    }
    position.needsUpdate=true;
    map.geometry.computeVertexNormals();
    map.geometry.computeBoundingSphere();
  }
  function update(mode, preview) {
    const action = preview?.kind === 'map' ? (mode === 'stored' ? preview.progress : 1 - preview.progress) : mode === 'stored' ? 0 : 1;
    const fold = THREE.MathUtils.clamp(action, 0, 1);
    folded.visible = fold < .012;
    map.visible = !folded.visible;
    group.position.x = THREE.MathUtils.lerp(foldedMap.x, expandedMap.x, fold);
    group.position.z = THREE.MathUtils.lerp(foldedMap.z, expandedMap.z, fold);
    shape(fold);
    flaps.face.visible = fold > .985 && (mode === 'both' || preview?.kind === 'overlay');
    const lifted = preview?.kind === 'overlay' ? mode === 'both' ? preview.progress : 1 - preview.progress : 0;
    if (flaps.face.visible) flaps.bend(.48 * lifted, .55);
    const style = mode === 'both' && fold<.985 ? 'folded-both' : mode === 'stored' ? 'original' : mode;
    if (style !== previous) {
      if (style === 'revised') routeBoard.paintRevised();
      else if (style==='folded-both') routeBoard.paint(.5,true);
      else routeBoard.paintBase();
      previous = style;
    }
  }
  return {group, folded, map, overlay: flaps.face, update};
}

function moveLoose(mesh, at, lift, height, support) {
  mesh.position.set(at.x, height + .047 * lift, at.z);
  const position = mesh.geometry.getAttribute('position');
  const original = mesh.userData.rest;
  const cos = Math.cos(mesh.rotation.y), sin = Math.sin(mesh.rotation.y);
  for (let i = 0; i < position.count; i++) {
    const x = original[i * 3], z = original[i * 3 + 2];
    const corner = (x / looseSize[0] + .5) * (z / looseSize[1] + .5);
    const underneath = support?.(at.x + x*cos + z*sin, at.z + z*cos - x*sin) ?? 0;
    position.setY(i, underneath * (1 - .68*lift) + .0018 * corner + .038 * lift * corner * corner);
  }
  position.needsUpdate = true;
  mesh.geometry.computeVertexNormals();
  mesh.geometry.computeBoundingSphere();
}

/** @param {'forward'|'back'} [direction] */
export function deskJournalFaces(spread, direction) {
  const current = Math.max(0, spread - 1);
  const next = direction === 'forward';
  const previous = direction === 'back';
  const offset = next ? Number(spread > 0) : previous ? -1 : 0;
  const destination = THREE.MathUtils.clamp(current + offset, 0, notebook.length - 1);
  return {
    left: previous ? destination : current,
    right: next ? destination : current,
    front: previous ? destination : current,
    back: next ? destination : current,
    closed: spread === 0 || previous && spread === 1,
  };
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
  const noteSlip = remember(printMaterial('摘录', [], {kind: 'folded', grains}));
  const neutralBack = remember(surface(0xd8c194, {side: THREE.BackSide, roughness: .91, bumpMap: grains.paper, bumpScale: .0012}));
  const pages = notebook.map(page => remember(printMaterial('', page.rows, {stamp: page.note, grains})));
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
  // 精致侧边夹签条置于右页外缘留白处，彻底避开正文排版杜绝重影穿模
  const note = makeSheet(.062, .118, noteSlip, 8);
  note.position.set(journalSize[0] * .44, paperHeight + .0055, -.132);
  note.rotation.y = -.06;
  journal.add(note);

  const spineX=-journalSize[0]*.5;
  const spine=placedBox(journal,.007,.015,journalSize[1]-.009,[spineX,.008,0],cloth);
  spine.castShadow=false;
  const stitches=[];
  for (let i=0;i<6;i++) {
    const z=-.167+i*.065+Math.sin(i*7)*.0016;
    const knot=new THREE.CatmullRomCurve3([
      [spineX+.005,.017,z-.004],[spineX-.003,.0196,z-.002],
      [spineX-.006,.013,z],[spineX-.003,.007,z+.002],[spineX+.005,.006,z+.005],
    ].map(point=>new THREE.Vector3(...point)));
    stitches.push(new THREE.TubeGeometry(knot,12,.00068,5,false));
  }
  const binding=new THREE.Mesh(mergeGeometries(stitches),hemp);
  journal.add(binding);
  for (const stitch of stitches) stitch.dispose();

  mountLayers(dossier, ...dossierSize, 0, 0, paper, wrapper);
  const heldSheet = makeSheet(...dossierSize, summaryInk);
  heldSheet.position.y = paperHeight + .001;
  dossier.add(heldSheet);
  const cover = makeLeaf(dossier, ...dossierSize, 1, rightCover, neutralBack, {thickness:.00083});
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
  const journalCos=Math.cos(journal.rotation.y), journalSin=Math.sin(journal.rotation.y);
  const dossierCos=Math.cos(dossier.rotation.y), dossierSin=Math.sin(dossier.rotation.y);
  let hoveredTarget = null;
  const hoverPulse = .17;
  const hoverTint = new THREE.Color(0xf6c975);
  const glowing = new Set();

  function setEmissive(material, intensity) {
    if (!material || !material.emissive) return;
    if (intensity > 0) {
      material.emissive.copy(hoverTint);
      material.emissiveIntensity = intensity;
      glowing.add(material);
    } else {
      material.emissiveIntensity = 0;
    }
  }

  function setHover(target) {
    const changed = hoveredTarget !== target;
    hoveredTarget = target;
    return changed;
  }

  function update({saved, preview}) {
    for (const material of glowing) material.emissiveIntensity = 0;
    glowing.clear();
    const spread = saved.spread;
    const flip = preview?.kind === 'page' ? preview : null;
    const next = flip?.direction === 'forward';
    const hoverPage = !preview && (hoveredTarget === 'page-forward' || hoveredTarget === 'page-back');
    const turn = flip ? (next ? flip.progress : 1 - flip.progress) : spread === 0 ? 0 : 1;
    const faces = deskJournalFaces(spread, flip?.direction);
    oppositeStack.visible = spread > 0 || !!flip && turn > .56;
    leftPage.material = facingPages[faces.left];
    rightPage.material = pages[faces.right];
    leaf.setSurface(faces.closed ? leftCover : pages[faces.front], backPages[faces.back]);
    rightPage.visible = !faces.closed || !!flip;
    leaf.face.visible = spread === 0 || !!flip;
    const previewLift = spread === 0 && hoverPage ? .024 : 0;
    if (leaf.face.visible) leaf.bend(flip ? turn : previewLift,faces.closed ? .72 : 1);
    setEmissive(leftCover, hoveredTarget === 'page-forward' && spread === 0 ? hoverPulse : 0);
    setEmissive(rightPage.material, hoveredTarget === 'page-forward' && spread > 0 ? hoverPulse : 0);
    setEmissive(leftPage.material, hoveredTarget === 'page-back' && spread > 0 ? hoverPulse : 0);
    const noteId = 'before';
    const savedIds = new Set(saved.sheets.map(sheet => sheet.id));
    note.visible = spread > 0 && !flip && !savedIds.has(noteId) && !(preview?.kind === 'sheet' && preview.id === noteId);
    note.position.y = paperHeight + .0055 + (hoveredTarget === 'before-sheet' && !preview ? .004 : 0);
    setEmissive(note.material, hoveredTarget === 'before-sheet' && note.visible ? hoverPulse : 0);

    const untied = preview?.kind === 'cord' ? preview.progress : Number(saved.dossier !== 'sealed');
    const opened = preview?.kind === 'cover' ? preview.progress : Number(saved.dossier === 'open');
    const hoverCord = !preview && hoveredTarget === 'cord' && saved.dossier === 'sealed';
    const hoverCover = !preview && hoveredTarget === 'cover' && saved.dossier === 'untied';
    const slack = Math.sin(untied * Math.PI) * .020 + (hoverCord ? .003 : 0);
    rope.position.set(untied * .205, paperHeight + .011 - untied * (paperHeight + .008) + slack, -untied * .145);
    rope.rotation.y = -.52 * untied;
    rope.scale.set(1 - .28 * untied, 1 - .62 * untied, 1 - .38 * untied);
    setEmissive(hemp, hoverCord ? hoverPulse * 1.4 : 0);
    cover.bend(hoverCover ? 0.055 : opened, .63, .51 * THREE.MathUtils.smoothstep(opened, .57, 1), paperHeight+.003);
    setEmissive(rightCover, hoverCover ? hoverPulse : 0);

    scene.updateMatrixWorld(true);
    dossier.localToWorld(noteAt.copy(originalMeeting));
    function pad(x,z,left,right,depth,height) {
      const outside = Math.max(left-x,x-right,Math.abs(z)-depth);
      return height*(1-THREE.MathUtils.smoothstep(outside,0,.060));
    }
    for (const [id, mesh] of loose) {
      const sheet = saved.sheets.find(item => item.id === id);
      const moving = preview?.kind === 'sheet' && preview.id === id ? preview : null;
      mesh.visible = !!sheet || !!moving || id === 'discussion' && saved.dossier === 'open';
      if (!mesh.visible) continue;
      const at = moving?.at ?? sheet?.at ?? {x: noteAt.x, z: noteAt.z};
      const order = saved.sheets.findIndex(item => item.id === id);
      const isHoveredSheet = !preview && hoveredTarget === (id === 'discussion' ? 'discussion-sheet' : 'before-sheet');
      mesh.rotation.y = !sheet && !moving ? dossier.rotation.y : id === 'discussion' ? .028 : -.035;
      const flat = !sheet && !moving;
      const under = order>0 ? saved.sheets[order-1].at : undefined;
      const mapCenter = saved.map==='stored' ? foldedMap : expandedMap;
      function support(x,z) {
        const jx=x-journal.position.x,jz=z-journal.position.z;
        const dx=x-dossier.position.x,dz=z-dossier.position.z;
        const book = pad(jx*journalCos-jz*journalSin,jz*journalCos+jx*journalSin,
          journalSize[0]*(spread>0 ? -1.5 : -.5),journalSize[0]*.5,journalSize[1]*.5,paperHeight+.003);
        const folder = pad(dx*dossierCos-dz*dossierSin,dz*dossierCos+dx*dossierSin,
          -dossierSize[0]*.5,dossierSize[0]*.5,dossierSize[1]*.5,paperHeight+.005);
        const mapPad = saved.map==='stored'
          ? pad(x-mapCenter.x,z-mapCenter.z,-.094,.094,.068,.008)
          : pad(x-mapCenter.x,z-mapCenter.z,-mapWidth*.5,mapWidth*.5,mapDepth*.5,.008);
        const pencil = pad(x,z-.218,-.025,.16,.024,.007);
        const stack = under ? pad(x-under.x,z-under.z,-looseSize[0]*.5,looseSize[0]*.5,looseSize[1]*.5,.005) : 0;
        return Math.max(book,folder,mapPad,pencil)+stack;
      }
      moveLoose(mesh,at,moving?.lift ?? (isHoveredSheet ? .055 : 0),flat ? noteAt.y+.003 : deskTop+.0025,flat ? undefined : support);
      setEmissive(mesh.material, isHoveredSheet ? hoverPulse : 0);
    }
    map.update(saved.map, preview);
    const hoverMap = !preview && (hoveredTarget === 'map' || hoveredTarget === 'overlay');
    map.group.position.y = foldedMap.y + (hoverMap ? .0035 : 0);
    setEmissive(map.map.material, hoverMap && saved.map !== 'stored' ? hoverPulse * 0.75 : 0);
    if (Array.isArray(map.folded.material)) {
      setEmissive(map.folded.material[2], hoverMap && saved.map === 'stored' ? hoverPulse : 0);
    }
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
  return {journal, dossier, loose, leaf, note, cover, rope, map, update, setHover, dispose};
}

export const journalWidth = journalSize[0];
export const dossierWidth = dossierSize[0];
