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

export function describeHallClue(view) {
  if (view.lastClue === 'route') {
    if (view.station && Object.hasOwn(stations,view.station)) {
      return {kind:'route', title:view.station, lines:[stations[view.station]]};
    }
    return {kind:'route', title:routes.title, lines:[routes.original,routes.changed]};
  }
  const page = view.lastClue === 'record' ? pages[view.bookPage - 1] : undefined;
  return page ? {kind:'record', title:page.title, lines:[page.finding,page.detail]} : undefined;
}

export async function startWalk(ui, assets) {
  const world = await createWorld(assets);
  const camera = new THREE.PerspectiveCamera(61, 1, 0.062, 80);
  const player = new THREE.Vector2(...entrance);
  const eye = player.clone();
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
  const rayToMarker = new THREE.Raycaster();
  const direction = new THREE.Vector3();
  const targetPoint = new THREE.Vector3();
  const deskPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.83);
  let [yaw, pitch] = homeAngles;
  let aim = null;
  let focused = null;
  let viewBeforeFocus = null;
  let pointer = null;
  let needsMarkers = true;
  let changed = false;
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
    aim = { yaw, pitch, toYaw: yaw + Math.atan2(Math.sin(difference), Math.cos(difference)),
      toPitch: nextPitch, elapsed: 0, x: eye.x, z: eye.y, toX: x, toZ: z, zoom: camera.zoom, toZoom };
  }

  function approach(id) {
    if (!near(id)) {
      approachTarget = id;
      refreshControls();
      ui.canvas.focus({ preventScroll: true });
      redraw();
      return;
    }
    approachTarget = null;
    focused = id;
    viewBeforeFocus ??= [yaw, pitch];
    stopWalking();
    ui.closeReading({ restoreFocus: false });
    const [x, y, z] = spots[id].focus;
    const [standX, standZ] = spots[id].stand;
    const anchor = id === 'route' ? [standX, standZ + 0.55] : player.toArray();
    turnTo(Math.atan2(x - anchor[0], anchor[1] - z),
      Math.atan2(y - eyeHeight, Math.hypot(x - anchor[0], z - anchor[1])), anchor,
      id === 'record' ? 1.78 : 1);
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
      text = bookPage === 0 ? '拖动封面翻开' : bookPage + ' / ' + pages.length;
    } else if (focused === 'route') {
      text = '湘江之后，原定的会合路线还能走吗？拨动行军图对照两条路线。';
    } else {
      const nearby = markers.find(({ id }) => near(id));
      text = nearby ? '按 E 查看' + spots[nearby.id].label :
        approachTarget ? '走近' + spots[approachTarget].label + '查看' : 'WASD 移动，拖动转向';
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
    if (next !== bookPage) ui.closeReading({ immediate: true, restoreFocus: false });
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
    ].filter(([id, hit]) => hit && hit.distance < wall && sameArea(id));
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
      ui.canvas.style.cursor = hit?.uv && world.demonstration.placeAt(hit.uv)
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
      yaw += (event.clientX - pointer.x) * 0.0042;
      pitch = THREE.MathUtils.clamp(pitch - (event.clientY - pointer.y) * 0.0038, -1, 0.91);
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
    aim = bookMotion = null;
    player.fromArray(view.player);
    eye.fromArray(view.eye);
    yaw = view.yaw;
    pitch = view.pitch;
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
    routeProgress = bookPage = bookPose = 0;
    station = routeStops.value = '';
    bookMotion = approachTarget = null;
    world.setRoute(0, false);
    world.setBook(0);
    player.set(...entrance);
    eye.copy(player);
    [yaw, pitch] = homeAngles;
    aim = viewBeforeFocus = null;
    camera.zoom = 1;
    camera.updateProjectionMatrix();
    leave();
    viewport.updateShadows();
  }

  function drawMarkers() {
    for (const { id, anchor, button } of markers) {
      direction.subVectors(anchor, camera.position);
      rayToMarker.set(camera.position, direction.normalize());
      rayToMarker.far = camera.position.distanceTo(anchor) - 0.04;
      viewport.place(button, anchor,
        !focused && sameArea(id) && !rayToMarker.intersectObjects(world.occluders, false).length);
      button.dataset.near = String(near(id));
      button.dataset.seen = String(seen.has(id));
    }
  }

  function frame(delta, _now, dirty) {
    if (aim) {
      aim.elapsed += delta;
      const fraction = ui.reduced.matches ? 1 : Math.min(1, aim.elapsed / 0.24);
      const smooth = fraction * fraction * (3 - 2 * fraction);
      yaw = THREE.MathUtils.lerp(aim.yaw, aim.toYaw, smooth);
      pitch = THREE.MathUtils.lerp(aim.pitch, aim.toPitch, smooth);
      camera.zoom = THREE.MathUtils.lerp(aim.zoom, aim.toZoom, smooth);
      camera.updateProjectionMatrix();
      eye.set(THREE.MathUtils.lerp(aim.x, aim.toX, smooth), THREE.MathUtils.lerp(aim.z, aim.toZ, smooth));
      if (fraction === 1) aim = null;
      redraw();
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
    if (!focused && !aim && keys.size) {
      const held = direction => Number([...keys].some(key => movement.get(key) === direction));
      const forward = held('forward') - held('back');
      const right = held('right') - held('left');
      const length = Math.hypot(forward, right);
      if (length) {
        const speed = 2.75 * delta / length;
        slide(player, (Math.sin(yaw) * forward + Math.cos(yaw) * right) * speed,
          (-Math.cos(yaw) * forward + Math.sin(yaw) * right) * speed);
        redraw();
      }
    }
    if (!ui.projection && !focused && !aim) eye.copy(player);
    camera.position.set(eye.x, eyeHeight, eye.y);
    camera.rotation.set(pitch, -yaw, 0, 'YXZ');
    camera.updateMatrixWorld();
    const area = player.y < roomEdge ? '材料厅' : player.y > 4.38 ? '庭院入口' : '庭院';
    ui.stage.dataset.area = area;
    if (needsMarkers || dirty) {
      drawMarkers();
      if (!focused) refreshControls();
      needsMarkers = false;
    }
    if (changed && !ui.projection) ui.changed?.(false);
    changed = false;
  }

  return {
    read, restore, reset,
    deskShot() {
      if (!world.dossier) return;
      const dossier = world.dossier.getWorldPosition(targetPoint);
      projectedDossier.copy(dossier).project(camera);
      const x = (1+projectedDossier.x)/2, y = (1-projectedDossier.y)/2;
      if (projectedDossier.z > -1 && projectedDossier.z < 1 && x > .24 && x < .76 && y > .24 && y < .76) {
        direction.subVectors(dossier, camera.position);
        rayToMarker.far = direction.length() - .05;
        rayToMarker.set(camera.position, direction.normalize());
        if (!rayToMarker.intersectObjects(world.occluders, false).length) return {anchor:[x,y]};
      }
      const detail = camera.clone();
      detail.position.copy(dossier).add(new THREE.Vector3(.04,.77,1.03));
      detail.lookAt(dossier);
      detail.zoom = 1.32;
      detail.updateProjectionMatrix();
      return {anchor:[.5,.5],camera:detail};
    },
    activate(view) {
      ui.inspect.hidden = false;
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
