import * as THREE from 'three';
import { routes, stations } from './evidence.js';
import pages from './notebook.json';
import { slide } from './navigation.js';
import { createWorld, entrance, roomEdge, spots } from './world.js';

const eyeHeight = 1.57;
const homeAngles = [-0.29, -0.012];
const movement = new Map([
  ['KeyW', 'forward'], ['ArrowUp', 'forward'], ['KeyS', 'back'], ['ArrowDown', 'back'],
  ['KeyA', 'left'], ['ArrowLeft', 'left'], ['KeyD', 'right'], ['ArrowRight', 'right'],
]);

/**
 * @typedef {{
 *   player: number[], eye: number[], yaw: number, pitch: number, zoom: number,
 *   focused: 'route' | 'record' | null, approach: 'route' | 'record' | null,
 *   routeProgress: number, station: string, seen: string[],
 *   bookPage: number, bookPose: number, reading: boolean, walking: boolean,
 *   lastClue?: 'route' | 'record' | null
 * }} HallView
 */

/** @returns {view is HallView} */
export function isHallView(view) {
  const point = value => Array.isArray(value) && value.length === 2 &&
    Number.isFinite(value[0]) && Number.isFinite(value[1]);
  const evidence = key => key === 'route' || key === 'record';
  return view != null && point(view.player) && point(view.eye) &&
    Number.isFinite(view.yaw) && Number.isFinite(view.pitch) &&
    Number.isFinite(view.zoom) && view.zoom > 0 &&
    (view.focused === null || evidence(view.focused)) &&
    (view.approach === null || evidence(view.approach)) &&
    Number.isFinite(view.routeProgress) && view.routeProgress >= 0 && view.routeProgress <= 1 &&
    typeof view.station === 'string' && (!view.station || Object.hasOwn(stations, view.station)) &&
    Array.isArray(view.seen) && view.seen.length <= 2 && [...view.seen].every(evidence) &&
    Number.isInteger(view.bookPage) && view.bookPage >= 0 && view.bookPage <= pages.length &&
    Number.isFinite(view.bookPose) && view.bookPose >= 0 && view.bookPose <= pages.length &&
    (view.lastClue == null || evidence(view.lastClue)) &&
    typeof view.reading === 'boolean' && typeof view.walking === 'boolean';
}

function buildRouteClue(view) {
  if (view.station && Object.hasOwn(stations, view.station)) {
    return { kind: 'route', title: view.station, lines: [stations[view.station]] };
  }
  return { kind: 'route', title: routes.title, lines: [routes.original, routes.changed] };
}

function buildRecordClue(view) {
  const page = pages[Math.max(0, view.bookPage - 1)];
  return page ? { kind: 'record', title: page.title, lines: [page.finding, page.detail] } : undefined;
}

export function describeHallClue(view) {
  if (view.lastClue === 'route') return buildRouteClue(view);
  if (view.lastClue === 'record' && view.bookPage > 0) return buildRecordClue(view);
  return undefined;
}

export function describeHallClues(view) {
  const list = [];
  const seen = Array.isArray(view.seen) ? view.seen : [];
  if (seen.includes('route') || view.lastClue === 'route') list.push(buildRouteClue(view));
  if ((seen.includes('record') || view.lastClue === 'record') && view.bookPage > 0) {
    const rec = buildRecordClue(view);
    if (rec) list.push(rec);
  }
  // 将最后查看的线索排在最前面作为默认高亮项
  if (view.lastClue && list.length > 1) {
    list.sort((a, b) => (a.kind === view.lastClue ? -1 : b.kind === view.lastClue ? 1 : 0));
  }
  return list;
}

function lessonSound() {
  return /** @type {{ setScene?: (s: string, f?: number) => void; playSfx?: (k: string) => void } | undefined} */ (
    /** @type {unknown} */ (window).__lessonSound
  );
}

export async function startWalk(ui, assets) {
  const world = await createWorld(assets);
  const camera = new THREE.PerspectiveCamera(61, 1, 0.062, 95);
  const player = new THREE.Vector2(...entrance);
  const eye = player.clone();
  const velocity = new THREE.Vector2();
  const moveRampSeconds = 0.06;
  const moveSpeed = 2.85;
  const autoWalkSpeed = 4.8;
  const viewport = ui.viewport.register(camera, world.scene, frame);
  const keys = new Set();
  const seen = new Set();
  const bookControls = ui.stage.querySelector('#book-controls');
  const previousPage = ui.stage.querySelector('#book-previous');
  const nextPage = ui.stage.querySelector('#book-next');
  const routeStops = ui.stage.querySelector('#route-stops');
  routeStops.replaceChildren(new Option('行军地点', ''), ...Object.keys(stations).map(name => new Option(name, name)));
  let routeProgress = 0;
  let station = '';
  let bookPage = 0;
  let bookPose = 0;
  let bookMotion = null;
  let approachTarget = null;
  /** @type {{ id: 'route' | 'record'; waypoints: [number, number][] } | null} */
  let autoWalk = null;
  const rayToMarker = new THREE.Raycaster();
  const direction = new THREE.Vector3();
  const targetPoint = new THREE.Vector3();
  const deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.83);
  let [yaw, pitch] = homeAngles;
  let [targetYaw, targetPitch] = homeAngles;
  let aim = null;
  let focused = null;
  let viewBeforeFocus = null;
  let pointer = null;
  let needsMarkers = true;
  let changed = false;
  let simClock = 0;
  let lastAmbientDraw = 0;
  let stepDistance = 0;
  let bobPhase = 0;
  let lastAreaSound = '';
  /** @type {'route' | 'record' | null} */
  let lastClue = null;
  const projectedDossier = new THREE.Vector3();

  const markers = Object.entries(spots).map(([id, site]) => {
    const button = ui.marker(site.label);
    ui.on(button, 'click', () => approach(id));
    return { id, button, anchor: new THREE.Vector3(...site.anchor) };
  });

  function redraw() {
    needsMarkers = true;
    changed = true;
    viewport.invalidate();
  }

  function walking(active) {
    if (ui.stage.hasAttribute('data-walking') === active) return;
    ui.stage.toggleAttribute('data-walking', active);
    if (!ui.projection) ui.changed?.(true);
  }

  function stopWalking() {
    keys.clear();
    velocity.set(0, 0);
    autoWalk = null;
    walking(false);
  }

  function sameArea(id) {
    return id === 'record' ? player.y < roomEdge : player.y > roomEdge;
  }

  function near(id) {
    const { stand, reach, accessFromZ = -Infinity } = spots[id];
    return sameArea(id) && player.y >= accessFromZ &&
      Math.hypot(player.x - stand[0], player.y - stand[1]) < reach;
  }

  function turnTo(nextYaw, nextPitch, [x, z] = player.toArray(), toZoom = 1) {
    const difference = nextYaw - yaw;
    const goalYaw = yaw + Math.atan2(Math.sin(difference), Math.cos(difference));
    targetYaw = goalYaw;
    targetPitch = nextPitch;
    aim = { yaw, pitch, toYaw: goalYaw,
      toPitch: nextPitch, elapsed: 0, x: eye.x, z: eye.y, toX: x, toZ: z, zoom: camera.zoom, toZoom };
  }

  function buildPathTo(id) {
    const goal = spots[id].stand;
    const waypoints = [];
    const inRoom = player.y < roomEdge;
    const goalInRoom = id === 'record';
    if (inRoom !== goalInRoom) {
      if (!inRoom) {
        // 庭院 → 穿过门洞 → 室内书桌前
        if (player.x < -1.8 && player.y < 2.2) waypoints.push([-1.8, 2.7]);
        waypoints.push([1.4, 0.45], [1.4, -1.65], [-0.25, -2.05]);
      } else {
        // 室内 → 穿过门洞 → 庭院行军图前
        if (player.x < 0.2) waypoints.push([0.35, -1.85]);
        waypoints.push([1.4, -1.55], [1.4, 0.55], [-1.35, 2.75]);
      }
    } else if (id === 'route' && player.y < 2.09) {
      waypoints.push([-1.95, 2.68]);
    }
    waypoints.push([goal[0], goal[1]]);
    return waypoints;
  }

  function enterFocus(id, fromAutoWalk = false) {
    autoWalk = null;
    approachTarget = null;
    focused = id;
    if (fromAutoWalk && id === 'route') {
      // 点击远处行军图自动走近时，退出后默认回望庭院与敞开大门，一眼看见室内「会前材料」圆点
      const [dx, dz] = [doorGuideAnchor.x - player.x, doorGuideAnchor.z - player.y];
      viewBeforeFocus ??= [Math.atan2(dx, -dz) - 0.16, -0.02];
    } else {
      viewBeforeFocus ??= [yaw, pitch];
    }
    stopWalking();
    ui.closeReading({ restoreFocus: false });
    const [x, y, z] = spots[id].focus;
    const [standX, standZ] = spots[id].stand;
    const anchor = id === 'route' ? [standX, standZ + 0.55] : player.toArray();
    turnTo(Math.atan2(x - anchor[0], anchor[1] - z),
      Math.atan2(y - eyeHeight, Math.hypot(x - anchor[0], z - anchor[1])), anchor,
      id === 'record' ? 1.78 : 1);
    lessonSound()?.playSfx?.('point');
    refreshControls();
    ui.canvas.focus({ preventScroll: true });
    redraw();
  }

  function approach(id) {
    if (near(id)) {
      enterFocus(id);
      return;
    }
    approachTarget = id;
    ui.closeReading({ restoreFocus: false });
    if (ui.reduced.matches) {
      player.set(...spots[id].stand);
      eye.copy(player);
      enterFocus(id);
      return;
    }
    // 点击远处目标时自动沿安全路径平滑漫步走近并自动聚焦
    autoWalk = { id, waypoints: buildPathTo(id) };
    lessonSound()?.playSfx?.('point');
    refreshControls();
    ui.canvas.focus({ preventScroll: true });
    redraw();
  }

  function refreshControls() {
    ui.inspect.dataset.tool = focused || 'explore';
    bookControls.hidden = focused !== 'record';
    routeStops.hidden = focused !== 'route';
    ui.summary.hidden = !focused || (focused === 'record' && bookPage === 0);
    ui.leave.hidden = !focused;
    previousPage.disabled = bookPage === 0 || !!bookMotion;
    nextPage.disabled = bookPage === pages.length || !!bookMotion;
    let text;
    if (focused === 'record') {
      text = bookPage === 0 ? '拖动封面翻开' : '第 ' + bookPage + ' 页';
    } else if (focused === 'route') {
      text = '拨动行军图滑块或点选站点对照两条路线';
    } else if (autoWalk) {
      text = '正在前往' + spots[autoWalk.id].label + '…';
    } else {
      const nearby = markers.find(({ id }) => near(id));
      text = nearby ? '点击圆点或按 E 查看' + spots[nearby.id].label : '点击圆点自动前往 · WASD 自由漫步';
    }
    if (ui.instruction.textContent !== text) ui.instruction.textContent = text;
  }

  function leave() {
    ui.closeReading({ restoreFocus: false });
    focused = null;
    if (viewBeforeFocus) turnTo(...viewBeforeFocus);
    viewBeforeFocus = null;
    stopWalking();
    ui.canvas.focus({ preventScroll: true });
    refreshControls();
    redraw();
  }

  function paintBook(value) {
    bookPose = value;
    world.setBook(value);
    redraw();
  }

  function turnBook(value) {
    const next = THREE.MathUtils.clamp(value, 0, pages.length);
    if (next !== bookPage) {
      ui.closeReading({ immediate: true, restoreFocus: false });
      lessonSound()?.playSfx?.('paper-turn');
    }
    bookPage = next;
    if (!ui.projection && bookPage > 0) lastClue = 'record';
    if (bookPage > 0 && !seen.has('record')) {
      seen.add('record');
      world.setRoute(routeProgress, true, station);
    }
    if (ui.reduced.matches || Math.abs(bookPose - next) < 0.001) {
      bookMotion = null;
      paintBook(next);
      viewport.updateShadows();
    } else {
      bookMotion = { from: bookPose, to: next, elapsed: 0 };
    }
    refreshControls();
  }

  function readSelection() {
    if (focused === 'route') {
      if (!ui.projection) lastClue = 'route';
      const item = station ? { title: station } : routes;
      ui.read(item, station ? stations[station] : routeProgress >= 0.5 ? routes.changed : routes.original,
        station ? '' : routes.compare);
    } else if (focused === 'record' && bookPage) {
      if (!ui.projection) lastClue = 'record';
      const item = pages[bookPage - 1];
      ui.read(item, item.finding, item.detail);
    }
    if (!ui.projection) ui.changed?.(true);
  }

  function setRoute(value) {
    routeProgress = THREE.MathUtils.clamp(value, 0, 1);
    seen.add('route');
    if (!ui.projection) lastClue = 'route';
    world.setRoute(routeProgress, seen.has('record'), station);
    redraw();
  }

  function selectStation(place) {
    if (!place || !Object.hasOwn(stations, place)) return;
    station = place;
    routeStops.value = place;
    const route = place === '湘西北' ? 0 : ['猴场', '乌江', '遵义'].includes(place) ? 1 : routeProgress;
    lessonSound()?.playSfx?.('point');
    setRoute(route);
    refreshControls();
    readSelection();
  }

  ui.on(routeStops, 'change', () => selectStation(routeStops.value));
  ui.on(previousPage, 'click', () => turnBook(bookPage - 1));
  ui.on(nextPage, 'click', () => turnBook(bookPage + 1));
  ui.on(ui.summary, 'click', readSelection);
  ui.on(ui.leave, 'click', leave);

  function hitObject(ray) {
    const wall = ray.intersectObjects(world.occluders, false)[0]?.distance ?? Infinity;
    const targets = [
      ['route', ray.intersectObject(world.chart, false)[0]],
      ['record', ray.intersectObject(world.notebook, true)[0]],
    ].filter(([, hit]) => hit && hit.distance < wall);
    targets.sort((a, b) => a[1].distance - b[1].distance);
    return targets[0]?.[0];
  }

  function handleAt(ray) {
    if (focused === 'route') return ray.intersectObject(world.chart, false).length > 0;
    if (focused !== 'record') return false;
    if (!ray.ray.intersectPlane(deskPlane, targetPoint)) return false;
    world.notebook.worldToLocal(targetPoint);
    return targetPoint.x >= -0.51 && targetPoint.x <= 0.26 && Math.abs(targetPoint.z) < 0.26;
  }

  ui.on(ui.canvas, 'pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    if (bookMotion && focused === 'record') return;
    const handle = !aim && handleAt(viewport.pick(event)) ? focused : null;
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, handle,
      initial: handle === 'record' ? bookPage : routeProgress, moved: false };
    ui.canvas.setPointerCapture(event.pointerId);
    ui.canvas.focus({ preventScroll: true });
  });
  ui.on(ui.canvas, 'pointermove', event => {
    if (!pointer || pointer.id !== event.pointerId) {
      const ray = viewport.pick(event);
      const hit = focused === 'route' && !aim ? ray.intersectObject(world.chart, false)[0] : null;
      const hoverObj = !focused && !aim ? hitObject(ray) : null;
      ui.canvas.style.cursor = (hit?.uv && world.demonstration.placeAt(hit.uv)) || hoverObj
        ? 'pointer' : focused && !aim && handleAt(ray) ? 'grab' : '';
      return;
    }
    const dx = event.clientX - pointer.startX;
    const dy = event.clientY - pointer.startY;
    if (Math.hypot(dx, dy) > 4) pointer.moved = true;
    if (pointer.handle && pointer.moved) {
      const width = ui.canvas.clientWidth;
      const height = ui.canvas.clientHeight;
      const amount = pointer.handle === 'record' ? -dx / (0.24 * width) - dy / (0.42 * height)
        : dx / (0.31 * width);
      if (pointer.handle === 'record') {
        paintBook(THREE.MathUtils.clamp(pointer.initial + THREE.MathUtils.clamp(amount, -1, 1), 0, pages.length));
      } else {
        if (station) {
          station = '';
          routeStops.value = '';
          refreshControls();
        }
        setRoute(pointer.initial + amount);
      }
    } else if (!focused && pointer.moved) {
      aim = null;
      autoWalk = null;
      yaw = targetYaw = yaw + (event.clientX - pointer.x) * 0.0044;
      pitch = targetPitch = THREE.MathUtils.clamp(pitch - (event.clientY - pointer.y) * 0.0038, -0.92, 0.85);
      redraw();
    }
    pointer.x = event.clientX;
    pointer.y = event.clientY;
  });
  ui.on(ui.canvas, 'pointerup', event => {
    if (pointer?.id !== event.pointerId) return;
    const ray = viewport.pick(event);
    if (!pointer.moved && !focused) {
      const id = hitObject(ray);
      if (id) approach(id);
    } else if (!pointer.moved && !aim && focused === 'route') {
      const uv = ray.intersectObject(world.chart, false)[0]?.uv;
      if (uv) selectStation(world.demonstration.placeAt(uv));
    } else if (pointer.handle === 'record') {
      if (pointer.moved) turnBook(Math.round(bookPose));
      else if (handleAt(ray)) turnBook(bookPage === 0 || targetPoint.x >= -0.139 ? bookPage + 1 : bookPage - 1);
    }
    pointer = null;
  });
  function cancelPointer() {
    if (!pointer) return;
    if (ui.canvas.hasPointerCapture(pointer.id)) ui.canvas.releasePointerCapture(pointer.id);
    const turnedPage = pointer.handle === 'record';
    pointer = null;
    if (turnedPage) turnBook(bookPage);
  }
  ui.on(ui.canvas, 'pointercancel', cancelPointer);
  ui.on(window, 'blur', () => { stopWalking(); cancelPointer(); });
  ui.on(document, 'visibilitychange', () => {
    if (document.hidden) { stopWalking(); cancelPointer(); }
  });
  ui.on(ui.stage, 'focusout', event => {
    if (!ui.stage.contains(event.relatedTarget)) stopWalking();
  });

  ui.on(ui.stage, 'keydown', event => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.code === 'Escape') {
      if (!ui.reading.hidden) {
        event.preventDefault();
        ui.closeReading();
        ui.changed?.(true);
      } else if (focused) {
        event.preventDefault();
        leave();
      } else if (autoWalk) {
        event.preventDefault();
        autoWalk = null;
        approachTarget = null;
        refreshControls();
      }
      return;
    }
    if (!ui.reading.hidden) return;
    if (event.target instanceof HTMLSelectElement) return;
    if (focused) {
      if (event.code !== 'ArrowLeft' && event.code !== 'ArrowRight') return;
      event.preventDefault();
      const right = event.code === 'ArrowRight' ? 1 : -1;
      if (focused === 'record') {
        if (!event.repeat && !bookMotion) turnBook(bookPage + right);
      } else {
        station = '';
        routeStops.value = '';
        setRoute(routeProgress + right * 0.15);
        refreshControls();
      }
      return;
    }
    if (event.code === 'KeyE' && !event.repeat) {
      const marker = markers.find(({ id }) => near(id));
      if (marker) approach(marker.id);
      return;
    }
    if (movement.has(event.code)) {
      event.preventDefault();
      if (autoWalk) {
        autoWalk = null;
        approachTarget = null;
      }
      if (!keys.size) {
        ui.canvas.focus({ preventScroll: true });
        walking(true);
      }
      keys.add(event.code);
    }
  });
  ui.on(window, 'keyup', event => {
    if (keys.delete(event.code) && !keys.size) walking(false);
  });

  /** @returns {HallView} */
  function read() {
    return {
      player: player.toArray(), eye: eye.toArray(), yaw, pitch, zoom: camera.zoom,
      focused, approach: approachTarget, routeProgress, station, seen: [...seen],
      bookPage, bookPose, reading: !ui.reading.hidden && !ui.reading.inert,
      walking: ui.stage.hasAttribute('data-walking'), lastClue,
    };
  }

  function restore(view) {
    const materialChanged = focused !== view.focused || station !== view.station ||
      bookPage !== view.bookPage || (routeProgress >= 0.5) !== (view.routeProgress >= 0.5);
    const routeChanged = routeProgress !== view.routeProgress || station !== view.station ||
      seen.has('record') !== view.seen.includes('record');
    aim = bookMotion = autoWalk = null;
    velocity.set(0, 0);
    player.fromArray(view.player);
    eye.fromArray(view.eye);
    yaw = targetYaw = view.yaw;
    pitch = targetPitch = view.pitch;
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    focused = view.focused;
    approachTarget = view.approach;
    routeProgress = view.routeProgress;
    station = routeStops.value = view.station;
    seen.clear();
    view.seen.forEach(id => seen.add(id));
    bookPage = view.bookPage;
    lastClue = view.lastClue ?? null;
    if (bookPose !== view.bookPose) {
      paintBook(view.bookPose);
      viewport.updateShadows();
    }
    if (routeChanged) world.setRoute(routeProgress, seen.has('record'), station);
    walking(view.walking);
    refreshControls();
    if (view.reading && (ui.reading.hidden || ui.reading.inert || materialChanged)) readSelection();
    else if (!view.reading) ui.closeReading({ immediate: true, restoreFocus: false });
    redraw();
  }

  function reset() {
    lastClue = null;
    seen.clear();
    pointer = null;
    autoWalk = null;
    routeProgress = bookPage = bookPose = 0;
    station = routeStops.value = '';
    bookMotion = approachTarget = null;
    world.setRoute(0, false);
    world.setBook(0);
    player.set(...entrance);
    eye.copy(player);
    [yaw, pitch] = [targetYaw, targetPitch] = homeAngles;
    aim = viewBeforeFocus = null;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    leave();
    viewport.updateShadows();
  }

  const doorGuideAnchor = new THREE.Vector3(1.4, 1.32, -0.85);

  function drawMarkers() {
    const inRoom = player.y < roomEdge;
    for (const { id, anchor, button } of markers) {
      // 在庭院里时，把室内「会前材料」圆点引导在敞开大门内的温暖厅堂处，点一下即可自动穿门走到书桌前
      const activeAnchor = id === 'record' && !inRoom ? doorGuideAnchor : anchor;
      direction.subVectors(activeAnchor, camera.position);
      const distance = direction.length();
      rayToMarker.set(camera.position, direction.normalize());
      rayToMarker.far = Math.max(0.05, distance - 0.06);
      const blocked = rayToMarker.intersectObjects(world.occluders, false).length > 0;
      viewport.place(button, activeAnchor, !focused && !blocked);
      button.dataset.near = String(near(id));
      button.dataset.seen = String(seen.has(id));
    }
  }

  function frame(delta, _now, dirty) {
    simClock += delta;
    if (!ui.reduced.matches && (dirty || autoWalk || aim || bookMotion || keys.size || simClock - lastAmbientDraw >= 0.085)) {
      lastAmbientDraw = simClock;
      world.animate?.(simClock, false);
      viewport.invalidate();
    }
    if (aim) {
      aim.elapsed += delta;
      const fraction = ui.reduced.matches ? 1 : Math.min(1, aim.elapsed / 0.28);
      const smooth = fraction * fraction * (3 - 2 * fraction);
      yaw = targetYaw = THREE.MathUtils.lerp(aim.yaw, aim.toYaw, smooth);
      pitch = targetPitch = THREE.MathUtils.lerp(aim.pitch, aim.toPitch, smooth);
      camera.zoom = THREE.MathUtils.lerp(aim.zoom, aim.toZoom, smooth);
      camera.updateProjectionMatrix();
      eye.set(THREE.MathUtils.lerp(aim.x, aim.toX, smooth), THREE.MathUtils.lerp(aim.z, aim.toZ, smooth));
      if (fraction === 1) aim = null;
      redraw();
    } else if (!focused && !ui.projection) {
      // 平滑视角阻尼，减少生硬抖动
      const damp = ui.reduced.matches ? 1 : 1 - Math.exp(-delta * 16);
      if (Math.abs(targetYaw - yaw) > 1e-4 || Math.abs(targetPitch - pitch) > 1e-4) {
        yaw = THREE.MathUtils.lerp(yaw, targetYaw, damp);
        pitch = THREE.MathUtils.lerp(pitch, targetPitch, damp);
        redraw();
      }
    }

    if (bookMotion) {
      bookMotion.elapsed += delta;
      const t = Math.min(1, bookMotion.elapsed / 0.245);
      paintBook(THREE.MathUtils.lerp(bookMotion.from, bookMotion.to, t * t * (3 - 2 * t)));
      if (t === 1) {
        bookMotion = null;
        viewport.updateShadows();
        refreshControls();
      }
    }

    let movingSpeed = 0;
    if (!focused && !aim && autoWalk && !ui.projection) {
      if (near(autoWalk.id)) {
        enterFocus(autoWalk.id, true);
      } else {
        const nextPt = autoWalk.waypoints[0];
        if (!nextPt) {
          enterFocus(autoWalk.id, true);
        } else {
          const dx = nextPt[0] - player.x;
          const dz = nextPt[1] - player.y;
          const dist = Math.hypot(dx, dz);
          if (dist < 0.28) {
            autoWalk.waypoints.shift();
            if (!autoWalk.waypoints.length || near(autoWalk.id)) enterFocus(autoWalk.id, true);
          } else {
            const step = Math.min(dist, autoWalkSpeed * delta);
            const beforeX = player.x, beforeY = player.y;
            const subSteps = Math.max(1, Math.ceil(step / 0.16));
            const sx = (dx / dist) * (step / subSteps);
            const sz = (dz / dist) * (step / subSteps);
            for (let k = 0; k < subSteps; k++) slide(player, sx, sz);
            const moved = Math.hypot(player.x - beforeX, player.y - beforeY);
            movingSpeed = moved / Math.max(0.001, delta);
            const desiredYaw = Math.atan2(dx, -dz);
            const diff = Math.atan2(Math.sin(desiredYaw - targetYaw), Math.cos(desiredYaw - targetYaw));
            targetYaw += diff * Math.min(1, delta * 5.2);
            targetPitch = THREE.MathUtils.lerp(targetPitch, -0.05, Math.min(1, delta * 4.5));
            yaw = THREE.MathUtils.lerp(yaw, targetYaw, Math.min(1, delta * 8.5));
            pitch = THREE.MathUtils.lerp(pitch, targetPitch, Math.min(1, delta * 8.5));
            if (moved < step * 0.15) {
              autoWalk.waypoints.shift();
            }
            redraw();
          }
        }
      }
    } else if (!focused && !aim) {
      const held = dir => Number([...keys].some(key => movement.get(key) === dir));
      const forward = held('forward') - held('back');
      const right = held('right') - held('left');
      const length = Math.hypot(forward, right);
      const targetX = length ? (Math.sin(yaw) * forward + Math.cos(yaw) * right) * moveSpeed / length : 0;
      const targetZ = length ? (-Math.cos(yaw) * forward + Math.sin(yaw) * right) * moveSpeed / length : 0;
      if (ui.reduced.matches) {
        velocity.set(targetX, targetZ);
      } else {
        const step = moveSpeed / moveRampSeconds * delta;
        const approachAxis = (current, target) => Math.abs(target - current) <= step ? target :
          current + Math.sign(target - current) * step;
        velocity.set(approachAxis(velocity.x, targetX), approachAxis(velocity.y, targetZ));
      }
      if (velocity.lengthSq() > 1e-8) {
        const beforeX = player.x, beforeY = player.y;
        slide(player, velocity.x * delta, velocity.y * delta);
        movingSpeed = Math.hypot(player.x - beforeX, player.y - beforeY) / Math.max(0.001, delta);
        redraw();
      }
    } else if (velocity.lengthSq() > 0) {
      velocity.set(0, 0);
    }

    if (movingSpeed > 0.35 && !ui.reduced.matches) {
      stepDistance += movingSpeed * delta;
      bobPhase += delta * 8.4;
      if (!ui.projection && stepDistance >= 0.72) {
        stepDistance = 0;
        lessonSound()?.playSfx?.(player.y < roomEdge ? 'step-wood' : 'step-stone');
      }
    } else {
      bobPhase *= Math.max(0, 1 - delta * 8);
    }

    if (!ui.projection && !focused && !aim) eye.copy(player);
    const bobOffset = !focused && !aim && !ui.reduced.matches ? Math.sin(bobPhase) * Math.min(1, movingSpeed / 2.6) * 0.024 : 0;
    camera.position.set(eye.x, eyeHeight + bobOffset, eye.y);
    camera.rotation.set(pitch, -yaw, 0, 'YXZ');
    camera.updateMatrixWorld();

    const inRoom = player.y < roomEdge;
    const area = inRoom ? '材料厅' : player.y > 4.38 ? '庭院入口' : '庭院';
    ui.stage.dataset.area = area;
    const areaSound = inRoom ? 'zunyi-room' : 'zunyi-yard';
    if (!ui.projection && areaSound !== lastAreaSound) {
      lastAreaSound = areaSound;
      lessonSound()?.setScene?.(areaSound, 0.7);
    }

    if (needsMarkers || dirty) {
      drawMarkers();
      if (!focused) refreshControls();
      needsMarkers = false;
    }
    if (changed && !ui.projection) ui.changed?.(false);
    changed = false;
  }

  function dispose() {
    const geometries = new Set();
    const materials = new Set();
    const textures = new Set();
    world.scene.traverse(node => {
      if (node.geometry) geometries.add(node.geometry);
      if (!node.material) return;
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) textures.add(value);
        }
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
  }

  return {
    read, restore, reset, dispose,
    deskShot() {
      if (!world.dossier) return;
      const dossier = world.dossier.getWorldPosition(targetPoint);
      projectedDossier.copy(dossier).project(camera);
      const x = (1 + projectedDossier.x) / 2, y = (1 - projectedDossier.y) / 2;
      if (projectedDossier.z > -1 && projectedDossier.z < 1 && x > .24 && x < .76 && y > .24 && y < .76) {
        direction.subVectors(dossier, camera.position);
        rayToMarker.far = direction.length() - .05;
        rayToMarker.set(camera.position, direction.normalize());
        if (!rayToMarker.intersectObjects(world.occluders, false).length) return { anchor: [x, y] };
      }
      const detail = camera.clone();
      detail.position.copy(dossier).add(new THREE.Vector3(.04, .77, 1.03));
      detail.lookAt(dossier);
      detail.zoom = 1.32;
      detail.updateProjectionMatrix();
      return { anchor: [.5, .5], camera: detail };
    },
    activate(view) {
      ui.inspect.hidden = false;
      lastAreaSound = '';
      if (view) restore(view);
      else refreshControls();
      viewport.activate();
    },
    deactivate() {
      stopWalking();
      cancelPointer();
      viewport.deactivate();
      ui.inspect.hidden = true;
      ui.canvas.style.cursor = '';
    },
  };
}
