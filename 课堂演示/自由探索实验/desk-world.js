import * as THREE from 'three';
import { createDeskCamera, createDeskRoom } from './desk-room.js';
import { createDeskProps } from './desk-props.js';
import { createDeskPapers, deskBounds, deskTop, dossierWidth, journalWidth } from './desk-paper.js';
import notebook from './notebook.json';

const landing = {x: .68, z: .30};
const staticObstacles = [
  {x: 0, z: -.259, r: .145},
  {x: .609, z: -.222, r: .125},
];

function makeGlowTex(inner, mid) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 3, 64, 64, 62);
  g.addColorStop(0, inner);
  g.addColorStop(0.4, mid);
  g.addColorStop(1, 'rgba(255, 170, 72, 0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function lightDesk(scene, sky) {
  const ambient = new THREE.HemisphereLight(0xe8dfd0, 0x7d6850, .62);
  const window = new THREE.DirectionalLight(0xb8cff8, 1.48);
  window.position.set(-1.12, 1.81, -1.28);
  window.target.position.set(-.16, deskTop, .08);
  window.castShadow = true;
  window.shadow.mapSize.set(1024, 1024);
  Object.assign(window.shadow.camera, {left: -1.03, right: 1.03, top: .67, bottom: -.67, near: .1, far: 4});
  window.shadow.bias = -.00015;
  window.shadow.normalBias = .0012;
  window.shadow.radius = 2;
  const fill = new THREE.DirectionalLight(0xf2d4b5, .30);
  fill.position.set(.38, 1.58, 1.43);
  const lamp = new THREE.PointLight(0xffae52, .24, 1.22, 2);
  lamp.position.set(0, deskTop + .155, -.259);
  scene.add(ambient, window, window.target, fill, lamp);

  const spillTexture = makeGlowTex('rgba(255, 176, 92, .62)', 'rgba(228, 132, 53, .28)');
  const spillGeometry = new THREE.PlaneGeometry(.47,.40);
  spillGeometry.rotateX(-Math.PI/2);
  const spillMaterial = new THREE.MeshBasicMaterial({
    map: spillTexture, transparent: true, opacity: .12, depthWrite: false,
    blending: THREE.AdditiveBlending, toneMapped: false,
  });
  const spill = new THREE.Mesh(spillGeometry,spillMaterial);
  spill.position.set(.008,deskTop+.0011,-.258);
  spill.renderOrder = 2;
  scene.add(spill);

  const skyGeometry = new THREE.SphereGeometry(12, 16, 12);
  const skyMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(...sky).convertSRGBToLinear(),
    side: THREE.BackSide, depthWrite: false, toneMapped: false, fog: false,
  });
  const backdrop = new THREE.Mesh(skyGeometry, skyMaterial);
  backdrop.renderOrder = -10;
  scene.add(backdrop);

  const receiving = new THREE.PlaneGeometry(deskBounds.x * 2 - .006, deskBounds.z * 2 - .007);
  receiving.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(receiving, new THREE.ShadowMaterial({opacity: .34, depthWrite: false}));
  shadow.position.y = deskTop + .0008;
  shadow.receiveShadow = true;
  shadow.renderOrder = 1;
  scene.add(shadow);

  function pulse(time) {
    const flick = 1 + .048*Math.sin(time*4.9+.3) + .022*Math.sin(time*8.1+1.8);
    lamp.intensity = .24*flick;
    spillMaterial.opacity = .12 + .065*(flick-1);
  }

  return {
    pulse,
    dispose() {
      skyGeometry.dispose();
      skyMaterial.dispose();
      spillTexture.dispose();
      spillGeometry.dispose();
      spillMaterial.dispose();
      scene.remove(backdrop,spill,shadow,ambient,window,window.target,fill,lamp);
      receiving.dispose();
      shadow.material.dispose();
      window.shadow.dispose();
    },
  };
}

function textureImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('桌面地形图读取失败'));
    image.src = source;
  });
}

export async function createDeskWorld(canvas, assets) {
  const manifest = JSON.parse(assets['desk-manifest']);
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: false});
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.04;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(...manifest.sky).convertSRGBToLinear();
  const rig = createDeskCamera(manifest);
  const {camera} = rig;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(), point = new THREE.Vector3();
  const tabletop = new THREE.Plane(new THREE.Vector3(0, 1, 0), -deskTop);
  const objectPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(deskTop + .023));
  let room, papers, lighting, props;

  const loaded = await Promise.allSettled([
    createDeskRoom(renderer, assets, manifest),
    textureImage(assets.terrain),
    createDeskProps(assets['desk-props']),
  ]);
  try {
    if (loaded[0].status === 'fulfilled') room = loaded[0].value;
    if (loaded[2].status === 'fulfilled') props = loaded[2].value;
    if (!room || !props || loaded[1].status !== 'fulfilled') {
      throw new Error('桌边实时资源读取失败', {
        cause: loaded.find(result => result.status === 'rejected')?.reason,
      });
    }
    scene.add(room.room, props.group);
    lighting = lightDesk(scene, manifest.sky);
    papers = createDeskPapers(scene, {image: loaded[1].value});
  } catch (error) {
    room?.dispose();
    props?.dispose();
    lighting?.dispose();
    renderer.dispose();
    throw error;
  }

  let currentSaved, currentPreview, currentPose, currentFocus, currentHover = null;
  let width = 0, height = 0;
  function resize(w = canvas.width, h = canvas.height) {
    if (width === w && height === h) return;
    width = w;
    height = h;
    renderer.setSize(Math.max(1, w), Math.max(1, h), false);
    rig.resize(Math.max(1, w) / Math.max(1, h));
    currentPose = undefined;
  }
  resize();

  function setHover(target) {
    if (currentHover === target) return false;
    currentHover = target;
    return true;
  }

  function apply(view) {
    const hoverChanged = papers.setHover(currentHover);
    const physical = view.preview?.kind === 'camera' ? undefined : view.preview;
    const saved=view.saved;
    const papersChanged=currentSaved!==saved && (!currentSaved || currentSaved.spread!==saved.spread ||
      currentSaved.dossier!==saved.dossier || currentSaved.map!==saved.map ||
      currentSaved.sheets.length!==saved.sheets.length || saved.sheets.some(({id,at},index)=>{
        const last=currentSaved.sheets[index];
        return last.id!==id || last.at.x!==at.x || last.at.z!==at.z;
      }));
    if (papersChanged || currentPreview !== physical || hoverChanged) {
      papers.update(view);
      currentPreview = physical;
      renderer.shadowMap.needsUpdate = true;
    }
    currentSaved=saved;
    const pose = view.camera ?? (view.preview?.kind === 'camera' ? view.preview.pose : view.saved.camera);
    const focus = view.focus;
    if (pose !== currentPose || focus !== currentFocus) {
      rig.set(pose,focus);
      currentPose = pose;
      currentFocus = focus;
    }
  }
  function draw(view, time = 0) {
    if (time > 0) {
      lighting.pulse(time);
      props.flicker(time);
    }
    apply(view);
    room.update(camera.position);
    renderer.render(scene, camera);
  }

  function locate(target, view) {
    const {journal, dossier, note, rope, map, loose} = papers;
    const spread = view.saved.spread;
    const status = view.saved.dossier;
    const discussion = loose.get('discussion');
    const before = loose.get('before');
    const at = (group, x, y, z) => group.localToWorld(new THREE.Vector3(x, y, z));
    switch (target) {
      case 'left': return at(journal, spread > 0 ? -journalWidth * 1.38 : -journalWidth * .38, .024, -.165);
      case 'right': return at(dossier, dossierWidth * .38, .027, -.165);
      case 'page-forward': return spread < notebook.length ? at(journal, journalWidth * .38, .025, .168) : undefined;
      case 'page-back': return spread > 0 ? at(journal, -journalWidth * 1.36, .025, .166) : undefined;
      case 'cord': return status === 'sealed' ? at(rope, dossierWidth * .17, .008, .018) : undefined;
      case 'cover': return status === 'untied' ? at(dossier, -dossierWidth * .36, .027, .098) : undefined;
      case 'note':
      case 'before-sheet': return before.visible ? before.position.clone() : note.visible ? at(note, 0, .004, 0) : undefined;
      case 'dossier-sheet':
      case 'discussion-sheet': return discussion.visible ? discussion.position.clone() : undefined;
      case 'map': return view.saved.map === 'stored' ? at(map.group, 0, .012, .010) : undefined;
      case 'map-overlay':
      case 'overlay': return view.saved.map !== 'stored' ? at(map.group, .155, .012, .018) : undefined;
      case 'table': return new THREE.Vector3(.045, deskTop, .123);
      default: return undefined;
    }
  }
  function project(target, view) {
    apply(view);
    const world = locate(target, view);
    if (!world) return;
    const screen = world.project(camera);
    if (!Number.isFinite(screen.x) || !Number.isFinite(screen.y) || Math.abs(screen.z) > 1) return;
    return [(screen.x + 1) / 2, (1 - screen.y) / 2];
  }
  function focusPoint(target, view) {
    apply(view);
    const {journal,dossier,note,map,loose}=papers;
    if (target === 'journal') return {x:journal.position.x-journalWidth*.35,z:journal.position.z};
    if (target === 'dossier') return {x:dossier.position.x,z:dossier.position.z};
    if (target === 'map') return {x:.20,z:map.group.position.z};
    const sheet=loose.get(target);
    const at=sheet?.visible ? sheet.position : note.getWorldPosition(new THREE.Vector3());
    return {x:at.x,z:at.z};
  }
  function rayAt(u, v, view) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return false;
    apply(view);
    pointer.set(u * 2 - 1, 1 - v * 2);
    raycaster.setFromCamera(pointer, camera);
    return true;
  }
  function tablePoint(u, v, view) {
    if (!rayAt(u, v, view) || !raycaster.ray.intersectPlane(tabletop, point)) return;
    let x = THREE.MathUtils.clamp(point.x, -landing.x, landing.x);
    let z = THREE.MathUtils.clamp(point.z, -landing.z, landing.z);
    for (const obstacle of staticObstacles) {
      const dx = x - obstacle.x, dz = z - obstacle.z;
      const dist = Math.hypot(dx, dz);
      if (dist < obstacle.r) {
        const nx = dist > 1e-5 ? dx / dist : 0;
        const nz = dist > 1e-5 ? dz / dist : 1;
        x = obstacle.x + nx * obstacle.r;
        z = obstacle.z + nz * obstacle.r;
      }
    }
    return {x: THREE.MathUtils.clamp(x, -landing.x, landing.x), z: THREE.MathUtils.clamp(z, -landing.z, landing.z)};
  }
  function pick(u, v, view) {
    if (u < 0 || v < 0 || u > 1 || v > 1 || !rayAt(u, v, view)) return null;
    const {journal, dossier, map, note, loose} = papers;
    const clickable = [];
    const mapping = new Map();
    const register = (mesh, target) => {
      if (mesh.visible) {
        clickable.push(mesh);
        mapping.set(mesh, target);
      }
    };
    register(loose.get('before'), 'before-sheet');
    register(loose.get('discussion'), 'discussion-sheet');
    register(note, 'before-sheet');
    register(map.folded, 'map');
    register(map.map, 'overlay');
    register(map.overlay, 'overlay');

    const hit = raycaster.intersectObjects(clickable, false)[0];
    if (hit) {
      const obstacle = raycaster.intersectObject(room.room, true)[0];
      if (!obstacle || obstacle.distance + .003 >= hit.distance) return mapping.get(hit.object);
      return null;
    }
    if (!raycaster.ray.intersectPlane(objectPlane, point)) return null;
    const j = journal.worldToLocal(point.clone());
    const d = dossier.worldToLocal(point.clone());
    // 放宽翻页、解绳、揭封的有效热区，轻点主体即可顺滑响应不再抠小角
    const onLeftRightPage = Math.abs(j.z) <= .254 && j.x >= -journalWidth * .54 && j.x <= journalWidth * .60;
    const onLeftBackPage = Math.abs(j.z) <= .254 && j.x >= -journalWidth * 1.62 && j.x < -journalWidth * .54;
    if (onLeftRightPage && view.saved.spread < notebook.length) return 'page-forward';
    if (onLeftBackPage && view.saved.spread > 0) return 'page-back';
    if (Math.abs(d.x) < dossierWidth / 2 + .045 && Math.abs(d.z) < .254 ||
        view.saved.dossier === 'open' && d.x > dossierWidth / 2 && d.x < dossierWidth * 1.4 && Math.abs(d.z) < .235) {
      if (view.saved.dossier === 'sealed') return 'cord';
      if (view.saved.dossier === 'untied') return 'cover';
      return 'right';
    }
    if (onLeftRightPage || onLeftBackPage) return 'left';
    const mapPoint = map.group.worldToLocal(point);
    const stored = view.saved.map === 'stored';
    if (Math.abs(mapPoint.x) <= (stored ? .115 : .228) && Math.abs(mapPoint.z) <= (stored ? .096 : .125)) return stored ? 'map' : 'overlay';
    return null;
  }

  return {
    resize, draw, project, pick, tablePoint, focusPoint, setHover,
    dispose() {
      room.dispose();
      props.dispose();
      papers.dispose();
      lighting.dispose();
      renderer.dispose();
    },
  };
}
