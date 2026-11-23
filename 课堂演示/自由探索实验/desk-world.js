import * as THREE from 'three';
import { createDeskCamera, createDeskRoom } from './desk-room.js';
import { createDeskPapers, deskBounds, deskTop, dossierWidth, journalWidth } from './desk-paper.js';

const landing = {x: .68, z: .30};

function lightDesk(scene) {
  const ambient = new THREE.HemisphereLight(0xf7eddf, 0xbca381, 1.18);
  const window = new THREE.DirectionalLight(0xc2d6ff, 1.76);
  window.position.set(-1.12, 1.81, -1.28);
  window.target.position.set(-.16, deskTop, .08);
  window.castShadow = true;
  window.shadow.mapSize.set(1024, 1024);
  Object.assign(window.shadow.camera, {left: -1.03, right: 1.03, top: .67, bottom: -.67, near: .1, far: 4});
  window.shadow.bias = -.00015;
  window.shadow.normalBias = .0012;
  window.shadow.radius = 2;
  const fill = new THREE.DirectionalLight(0xf6dac3, .66);
  fill.position.set(.38, 1.58, 1.43);
  const lamp = new THREE.PointLight(0xffbb6b, .30, .9);
  lamp.position.set(.012, deskTop + .16, -.258);
  scene.add(ambient, window, window.target, fill, lamp);

  const receiving = new THREE.PlaneGeometry(deskBounds.x * 2 - .006, deskBounds.z * 2 - .007);
  receiving.rotateX(-Math.PI / 2);
  const shadow = new THREE.Mesh(receiving, new THREE.ShadowMaterial({opacity: .43, depthWrite: false}));
  shadow.position.y = deskTop + .0008;
  shadow.receiveShadow = true;
  shadow.renderOrder = 1;
  scene.add(shadow);
  return () => {
    receiving.dispose();
    shadow.material.dispose();
    window.shadow.dispose();
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
  renderer.toneMappingExposure = 1.03;
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
  let room, papers, cleanLighting;

  const loaded = await Promise.allSettled([
    createDeskRoom(renderer, assets, manifest),
    textureImage(assets.terrain),
  ]);
  try {
    if (loaded[0].status !== 'fulfilled' || loaded[1].status !== 'fulfilled') {
      if (loaded[0].status === 'fulfilled') loaded[0].value.dispose();
      throw new Error('桌边实时资源读取失败', {
        cause: loaded.find(result => result.status === 'rejected')?.reason,
      });
    }
    room = loaded[0].value;
    scene.add(room.room);
    cleanLighting = lightDesk(scene);
    papers = createDeskPapers(scene, {image: loaded[1].value});
  } catch (error) {
    room?.dispose();
    cleanLighting?.();
    renderer.dispose();
    throw error;
  }

  let currentSaved, currentPreview;
  let width = 0, height = 0;
  function resize(w = canvas.width, h = canvas.height) {
    if (width === w && height === h) return;
    width = w;
    height = h;
    renderer.setSize(Math.max(1, w), Math.max(1, h), false);
    rig.resize(Math.max(1, w) / Math.max(1, h));
  }
  resize();

  function apply(view) {
    if (currentSaved !== view.saved || currentPreview !== view.preview) {
      papers.update(view);
      currentSaved = view.saved;
      currentPreview = view.preview;
      renderer.shadowMap.needsUpdate = true;
    }
    const inspector = view.preview?.kind === 'inspect' ? papers.loose.get(view.preview.id) : null;
    rig.set(view.preview?.kind === 'camera' ? view.preview.pose : view.saved.camera,
      inspector?.visible ? inspector.position : undefined);
  }
  function draw(view) {
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
      case 'left': return at(journal, 0, .024, .012);
      case 'right': return at(dossier, 0, .027, 0);
      case 'page-forward': return spread < 4 ? at(journal, journalWidth * .38, .025, .168) : undefined;
      case 'page-back': return spread > 0 ? at(journal, -journalWidth * 1.36, .025, .166) : undefined;
      case 'cord': return status === 'sealed' ? at(rope, dossierWidth * .17, .008, .018) : undefined;
      case 'cover': return status === 'untied' ? at(dossier, -dossierWidth * .36, .027, .098) : undefined;
      case 'note':
      case 'before-sheet': return before.visible ? before.position.clone() : note.visible ? at(note, 0, .004, 0) : undefined;
      case 'dossier-sheet':
      case 'discussion-sheet': return discussion.visible ? discussion.position.clone() : undefined;
      case 'map': return view.saved.map === 'stored' ? at(map.group, 0, .012, .010) : undefined;
      case 'map-overlay':
      case 'overlay': return view.saved.map !== 'stored' ? at(map.group, .195, .012, .032) : undefined;
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
  function rayAt(u, v, view) {
    if (!Number.isFinite(u) || !Number.isFinite(v)) return false;
    apply(view);
    pointer.set(u * 2 - 1, 1 - v * 2);
    raycaster.setFromCamera(pointer, camera);
    return true;
  }
  function tablePoint(u, v, view) {
    if (!rayAt(u, v, view) || !raycaster.ray.intersectPlane(tabletop, point)) return;
    return {x: THREE.MathUtils.clamp(point.x, -landing.x, landing.x), z: THREE.MathUtils.clamp(point.z, -landing.z, landing.z)};
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
    const forward = j.z > .090 && j.z <= .236 && Math.abs(j.x - journalWidth * .39) < .085;
    const back = j.z > .090 && j.z <= .236 && Math.abs(j.x + journalWidth * 1.36) < .085;
    if (forward && view.saved.spread < 4) return 'page-forward';
    if (back && view.saved.spread > 0) return 'page-back';
    if (Math.abs(d.x) < dossierWidth / 2 + .023 && Math.abs(d.z) < .224) {
      if (view.saved.dossier === 'sealed' && d.x > -.008 && Math.abs(d.z - .03) < .115) return 'cord';
      if (view.saved.dossier === 'untied' && d.x < .008 && Math.abs(d.z) < .213) return 'cover';
      return 'right';
    }
    if (Math.abs(j.x) <= journalWidth / 2 && Math.abs(j.z) < .22) return 'left';
    return null;
  }

  return {
    resize, draw, project, pick, tablePoint,
    dispose() {
      room.dispose();
      papers.dispose();
      cleanLighting();
      renderer.dispose();
    },
  };
}
