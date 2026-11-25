import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { arrangeRound, countArrivals, groupCount, roundDuration } from './river-flow.js';
import { createRiverWorld, riverStops } from './river-world.js';
import { loadModel } from './packed-model.js';
import { createCrowd, createWorkers } from './river-people.js';

/**
 * @typedef {{
 *   index: number, phase: 'waiting' | 'playing' | 'paused' | 'finished', elapsed: number,
 *   water: number, eye: number[], target: number[], zoom: number,
 *   selected: 'east' | 'downstream' | null, part: 'hull' | 'beam' | 'board' | null,
 *   recall: 'night' | 'dawn', reading: boolean, comparison?: Comparison | null
 * }} RiverView
 */

/** @typedef {{groups: number, elapsed: number, phase: 'ready' | 'playing' | 'paused' | 'finished'}} Comparison */

function isComparison(value) {
  return !!value && Number.isInteger(value.groups) && value.groups >= 0 && value.groups <= groupCount &&
    Number.isFinite(value.elapsed) && value.elapsed >= 0 && value.elapsed <= roundDuration &&
    ['ready','playing','paused','finished'].includes(value.phase);
}

/** @returns {view is RiverView} */
export function isRiverView(view) {
  const triplet = value => Array.isArray(value) && value.length === 3 &&
    Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]);
  return view != null && Number.isInteger(view.index) && view.index >= -1 &&
    ['waiting', 'playing', 'paused', 'finished'].includes(view.phase) &&
    Number.isFinite(view.elapsed) && view.elapsed >= 0 &&
    Number.isFinite(view.water) && view.water >= 0 &&
    triplet(view.eye) && triplet(view.target) && Number.isFinite(view.zoom) && view.zoom > 0 &&
    [null, 'east', 'downstream'].includes(view.selected) &&
    [null, 'hull', 'beam', 'board'].includes(view.part) &&
    ['night', 'dawn'].includes(view.recall) && typeof view.reading === 'boolean' &&
    (view.comparison == null || (view.phase === 'finished' && isComparison(view.comparison)));
}

export async function startRiver(ui, assets) {
  const [world, workerModel, crowdModels] = await Promise.all([
    createRiverWorld(assets), loadModel(assets['river-people']), loadModel(assets['river-crowd']),
  ]);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 240);
  const viewport = ui.viewport.register(camera, world.scene, frame);
  const controls = new OrbitControls(camera);
  controls.enabled = false;
  camera.position.set(39, 53, 62);
  controls.target.set(0, 0.3, 0);
  controls.minPolarAngle = 0.10;
  controls.maxPolarAngle = 1.28;
  controls.minZoom = 0.59;
  controls.maxZoom = 15.5;
  controls.maxTargetRadius = 42;
  controls.screenSpacePanning = false;
  controls.enableDamping = !ui.projection;
  controls.dampingFactor = 0.105;
  controls.update();
  controls.saveState();
  let orbitChanged = false;
  controls.addEventListener('change', () => {
    orbitChanged = true;
    viewport.invalidate();
  });

  const tools = ui.stage.querySelector('#river-tools');
  const caption = tools.querySelector('#river-instruction');
  const action = tools.querySelector('#river-action');
  const historyButton = tools.querySelector('#river-history');
  const recall = ui.reading.querySelector('#river-recall');
  const actionGroup = tools.querySelector('#river-actions');
  const inspectButton = tools.querySelector('#river-inspect');
  const parts = tools.querySelector('#river-parts');
  const closeParts = tools.querySelector('#river-inspect-close');
  const compareButton = tools.querySelector('#river-compare');
  const comparisonControls = tools.querySelector('#river-comparison');
  const allocation = tools.querySelector('#river-allocation');
  const allocated = tools.querySelector('#river-allocated');
  const runComparison = tools.querySelector('#river-run-comparison');
  const closeComparison = tools.querySelector('#river-close-comparison');
  allocation.max = String(groupCount);
  const people = createCrowd(world.scene, crowdModels, groupCount * 2);
  const workers = createWorkers(world.scene, workerModel, 8);
  workers.show(0);
  const firstRound = arrangeRound(0);
  const secondRound = arrangeRound(groupCount / 2);
  const firstPassed = countArrivals(firstRound, roundDuration);
  const wide = controls.target.clone();
  const point = new THREE.Vector3();
  const duskView = camera.position.clone().sub(wide);
  let recallTime = 'dawn';
  let nightWater = 0;
  let dawnWater = 0;

  let index = -1;
  let phase = 'waiting';
  let elapsed = 0;
  let previousFrame = 0;
  let riverTime = 0;
  let selected = null;
  let inspection = null;
  let focus = null;
  const pointers = new Set();
  let tap = null;
  let started = false;
  let following = true;
  /** @type {Comparison | null} */
  let comparison = null;
  let comparisonRound = firstRound;
  let viewBeforeComparison = null;

  // The guided sequence is original video. The live canvas is used only for
  // free observation, evidence inspection and the allocation simulation.
  const clipKeys = ['approach','under-bridge','deck','night-crossing','clear-bridge'];
  const clip = !ui.projection && clipKeys.every(key => assets['river-short-'+key])
    ? document.createElement('video') : null;
  const backdrop = clip ? document.createElement('div') : null;
  let clipIndex = -1;
  let clipGeneration = 0;
  let clipRequested = 0;
  let clipMoved = 0;
  let clipTime = 0;
  let staticClip = false;
  let clipStarted = false;
  let releaseVoiceMute;
  function setVoiceDuck(playing) { ui.narration?.setVideoDuck(playing && !clip?.muted); }
  if (clip && backdrop) {
    backdrop.className = 'river-short-backdrop';
    backdrop.setAttribute('aria-hidden','true');
    clip.className = 'river-short';
    clip.muted = ui.narration?.isMuted() ?? false;
    releaseVoiceMute = ui.narration?.onMuteChange(muted => {
      clip.muted = muted;
      setVoiceDuck(!clip.paused && phase === 'playing');
    });
    clip.playsInline = true;
    clip.preload = 'auto';
    clip.setAttribute('aria-hidden','true');
    ui.canvas.after(backdrop, clip);
  }

  function paintClip(decoded, key = '', edge = 'start') {
    if (!clip || !backdrop) return;
    const visible = !!key;
    const poster = visible && assets['river-short-'+key+'-'+edge];
    backdrop.style.backgroundImage = poster ? 'url("'+poster+'")' : '';
    clip.style.opacity = decoded ? '1' : '0';
    ui.stage.toggleAttribute('data-river-short-visible', visible);
  }

  function stopClip(clear = false) {
    if (!clip) return;
    ++clipGeneration;
    clip.pause();
    setVoiceDuck(false);
    paintClip(false);
    if (clear) {
      clipIndex = -1;
      if (clip.hasAttribute('src')) {
        clip.removeAttribute('src');
        clip.load();
      }
    }
  }

  function holdClip(i) {
    if (!clip || !clipKeys[i]) return;
    ++clipGeneration;
    clip.pause();
    setVoiceDuck(false);
    clipIndex = -1;
    if (clip.hasAttribute('src')) {
      clip.removeAttribute('src');
      clip.load();
    }
    paintClip(false, clipKeys[i], 'end');
  }

  function playClip() {
    const key = clipKeys[index];
    if (!clip || !key) return;
    const request = ++clipGeneration;
    staticClip = ui.reduced.matches;
    clipStarted = false;
    clipRequested = clipMoved = performance.now();
    clipTime = elapsed;
    const stillDecoded = clipIndex === index && elapsed > 0 &&
      clip.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && !clip.seeking;
    paintClip(!staticClip && stillDecoded,key,staticClip ? 'end' : 'start');
    if (staticClip) return;
    if (clipIndex !== index || !clip.hasAttribute('src')) {
      clipIndex = index;
      clip.src = assets['river-short-'+key];
      if (elapsed > 0) clip.currentTime = elapsed;
    }
    void clip.play().then(() => {
      if (request === clipGeneration && !clip.paused) {
        clipStarted = true;
        clipMoved = performance.now();
        setVoiceDuck(true);
      }
    }).catch(() => {
      if (request === clipGeneration) {
        staticClip = true;
        holdClip(index);
      }
    });
  }

  function videoDelta(now) {
    if (!clip) return null;
    if (staticClip || ui.reduced.matches || clip.error) {
      holdClip(index);
      return beats[index].duration - elapsed;
    }
    if (!clipStarted || clip.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || clip.seeking || clipIndex !== index) {
      if (now - clipRequested > 4000) { staticClip = true; return 0; }
      return 0;
    }
    const next = Math.min(beats[index].duration, clip.ended ? beats[index].duration : clip.currentTime);
    if (next > clipTime + 0.001) { clipTime = next; clipMoved = now; }
    if (now - clipMoved > 4000) { staticClip = true; return 0; }
    if (clip.style.opacity !== '1') paintClip(true,clipKeys[index]);
    return Math.max(0,next - elapsed);
  }

  function notify() {
    ui.changed?.(true);
  }

  const labels = Object.entries(riverStops).map(([id, loc]) => {
    const element = ui.marker(loc.label, 'span');
    element.classList.add('river-label');
    return { id, element, anchor: new THREE.Vector3(loc.x, world.positionHeight(loc.x, loc.z) + 1, loc.z) };
  });

  function resetView() {
    focus = null;
    controls.enableDamping = false;
    controls.reset();
    controls.enableDamping = !ui.projection;
    viewport.invalidate();
  }

  function cameraTo(target, zoom, direction = duskView, duration = 0.9, delay = 0) {
    const offset = direction.clone().setLength(duskView.length());
    focus = { from: controls.target.clone(), to: target, eye: camera.position.clone(),
      destination: target.clone().add(offset), zoom: camera.zoom, targetZoom: zoom, elapsed: -delay, duration };
  }

  const { east, downstream } = world.floats;
  const ease = (time, start, end) => THREE.MathUtils.smoothstep(time, start, end);
  const queueStart = 3.95;
  const nightStop = 6.5;

  function smoothStepClock(workerIndex, time, walkWindow) {
    if (!walkWindow) return time;
    const [start, stopStart, stopEnd] = walkWindow;
    if (time <= start || time >= stopEnd) return 0;
    const offset = workerIndex * 0.74;
    const basePhase = time * 13 + offset;
    let phaseAngle = basePhase;
    if (time < start + 0.16) {
      const zeroStart = Math.round((start * 13 + offset) / Math.PI) * Math.PI;
      phaseAngle = THREE.MathUtils.lerp(zeroStart, basePhase, ease(time, start, start + 0.16));
    } else if (time > stopStart) {
      const zeroEnd = Math.ceil((stopStart * 13 + offset) / Math.PI) * Math.PI;
      phaseAngle = THREE.MathUtils.lerp(basePhase, zeroEnd, ease(time, stopStart, stopEnd));
    }
    return (phaseAngle - offset) / 13;
  }

  function carry(index, at, time, direction, board = null, release = 0, stanceEdge = -Infinity, walkWindow = null) {
    for (const [j, side] of [-1, 1].entries()) {
      const x = at.x + side * 1.17;
      const z = Math.max(stanceEdge + 0.078, at.z + direction * 0.31);
      const y = world.footingAt(x, z);
      const yaw = Math.atan2(-side, -direction * 0.16);
      const pair = [-1, 1].map(hand => {
        const target = new THREE.Vector3(side * (board ? 0.997 : 1.20), -0.062,
          direction * 0.062 - hand * side * 0.122);
        if (board) board.localToWorld(target);
        else target.add(at);
        return target.lerp(new THREE.Vector3(x - side * 0.06,
          y + 0.72, z - hand * side * 0.18), release);
      });
      workers.put(index + j, x, z, y, {
        yaw, grips: pair, stepClock: smoothStepClock(index + j, time, walkWindow),
        footing: world.footingAt, stanceEdge, release,
      });
    }
  }

  function showAssembling(time) {
    const { board, foot, grips, release, stanceEdge } = world.assemble(time);
    workers.show(3);
    carry(0, board.position, time, 1, board, release, stanceEdge, [0.63, 2.52, 2.70]);
    workers.put(2, foot.x, foot.z - 0.025, foot.y,
      { yaw: 0.26, grips, footing: () => foot.y, pole: true });
    if (time < 3.85) viewport.updateShadows();
    if (!ui.projection && following && time >= 2.62) {
      cameraTo(downstream.anchor.clone().add(new THREE.Vector3(-0.36, 0.48, 1.65)),
        7.1, new THREE.Vector3(38, 53, 15), 0.48);
      following = false;
    }
  }

  function showClearing(time) {
    if (time < 0.58) {
      drawRound(secondRound, THREE.MathUtils.lerp(nightStop, 7.8, time / 0.58), beats[3].duration + time);
      return;
    }
    people.show(0);
    world.lightAt(1 + ease(time, 0.58, 3.85));
    const loads = world.clearBridges(time - 0.58);
    workers.show(loads.length * 2);
    loads.forEach(({ board, direction }, i) => carry(i * 2, board, time, direction));
    viewport.updateShadows();
  }

  const beats = [
    {
      label: '到桥头', duration: 3.65,
      caption: '沿土路到渡口。', hold: '窄桥一次只能过一小批人，岸边还有人等。',
      enter() {
        selected = 'east';
        cameraTo(new THREE.Vector3(east.x, 0.6, east.z + east.span - 0.75),
          3.25, new THREE.Vector3(40, 28, 54), 0.82);
      },
      draw: time => drawRound(firstRound, queueStart + time, time),
    },
    {
      label: '看桥下', duration: 3.1,
      caption: '从侧面看桥板下面。', hold: '船舷托住纵梁。想看缺船处的断口，点「看构件」。',
      enter() {
        selected = 'downstream';
        cameraTo(downstream.anchor.clone().add(new THREE.Vector3(0, 0.46, 0.7)),
          4.65, new THREE.Vector3(51, 16, 27), 0.68);
      },
      draw(time) {
        world.stageBoat(ease(time, 0.4, 2.85));
        if (time < 2.9) viewport.updateShadows();
      },
    },
    {
      label: '看架桥', duration: 3.95,
      caption: '船靠稳，两人把门板抬上桥。', hold: '旧铰链孔还在。这块板原是乡亲家里的一扇门。',
      enter() {
        following = true;
        cameraTo(downstream.anchor.clone().add(new THREE.Vector3(-1.2, 0.48, 3.5)),
          4.9, new THREE.Vector3(42, 53, 19), 0.58);
      },
      draw: showAssembling,
    },
    {
      label: '看夜渡', duration: 3.6,
      caption: '镜头里是一处渡口。队伍也能从别处同时过河。', hold: '夜里能过河的时间有限。分到不同渡口，几路队伍就能同时过河。',
      enter() {
        selected = null;
        cameraTo(wide, 1.28, duskView, 0.78);
      },
      draw(time) {
        world.lightAt(ease(time, 0, 0.88));
        drawRound(secondRound, nightStop - this.duration + time, time);
      },
    },
    {
      label: '看收桥', duration: 3.9,
      caption: '最后一批过河后，天快亮了。', hold: '白天的浮桥容易被敌机发现。拂晓前撤桥，是为了掩护部队转移。',
      enter() {
        recallTime = 'dawn';
        selected = null;
      },
      draw: showClearing,
    },
  ];

  function home() {
    if (phase === 'playing') {
      phase = 'paused';
      controlsForBeat(false);
    }
    stopClip(true);
    if (comparison) {
      leaveComparison();
      return;
    }
    if (inspection) closeInspection(false);
    selected = null;
    resetView();
    notify();
  }

  function drawRound(groups, time, stepClock = time) {
    people.show();
    let next = 0;
    for (const { dock, order, leaves, arrives } of groups) {
      const { x, z, span } = world.floats[dock];
      const bank = z + span + 0.64;
      const far = z - span - 0.56;
      const trail = order % 2 ? -0.92 : 0.92;
      const row = Math.floor(order / 2);
      const progress = THREE.MathUtils.clamp((time - leaves) / (arrives - leaves), 0, 1);
      const join = THREE.MathUtils.smoothstep(progress, 0, 0.20);
      const exit = THREE.MathUtils.smoothstep(progress, 0.76, 1);
      const across = THREE.MathUtils.clamp((progress - 0.20) / 0.56, 0, 1);
      const centerX = x + trail * (1 - join + exit);
      const centerZ = THREE.MathUtils.lerp(bank, far, across) +
        (1.6 + row * 0.99) * (1 - join) - (0.85 + row * 0.83) * exit;
      const moving = progress > 0 && progress < 1;
      people.put(next++, centerX - 0.29, centerZ - 0.16, world.positionHeight, moving ? stepClock : 0);
      people.put(next++, centerX + 0.29, centerZ + 0.18, world.positionHeight, moving ? stepClock + 0.25 : 0);
    }
    people.update();
  }

  function choosePart(key) {
    if (!inspection) return;
    inspection.part = key;
    const { bay, board, decks } = inspection;
    for (const [mesh, visible] of decks) {
      mesh.visible = visible && (key !== 'beam' || mesh === board);
    }
    const anchor = bay.hull.position;
    if (key === 'hull') {
      if (!ui.projection) cameraTo(anchor.clone().add(new THREE.Vector3(0.78, 0.2, 0)), 5.35,
        new THREE.Vector3(72, 22, 32), 0.42);
      caption.textContent = '船舷在下，托住上方纵梁。';
    } else if (key === 'beam') {
      if (!ui.projection) cameraTo(anchor.clone().add(new THREE.Vector3(0, 0.34, 0)), 5.75,
        new THREE.Vector3(57, 42, 32), 0.42);
      caption.textContent = '露出的纵梁连着两侧桥板。';
    } else {
      const point = board.getWorldPosition(new THREE.Vector3());
      if (!ui.projection) cameraTo(point, 7.1, new THREE.Vector3(36, 58, 20), 0.42);
      caption.textContent = index === 2 ? '门板的旧铰链孔仍在。' : '岸上的木板等待铺上纵梁。';
    }
    for (const button of parts.querySelectorAll('[data-part]')) {
      button.setAttribute('aria-pressed', String(button.dataset.part === key));
    }
    viewport.updateShadows();
    notify();
  }

  function syncShadow() {
    if (inspection) return world.focusShadow(inspection.bay.hull.position, 14);
    if (!comparison && (index === 1 || index === 2)) return world.focusShadow(downstream.anchor, 14);
    return world.focusShadow(null);
  }

  function openInspection(key = 'hull') {
    if (phase !== 'waiting' || (index !== 1 && index !== 2)) return;
    stopClip();
    ui.closeReading({ immediate: true, restoreFocus: false });
    const bay = downstream.bays[index === 2 ? 2 : 3];
    const board = index === 2 ? world.door : world.timber.children.at(-1);
    inspection = {
      bay, board, view: { eye: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom },
      decks: bay.boards.map(({ mesh }) => [mesh, mesh.visible]),
    };
    syncShadow();
    parts.querySelector('[data-part="board"]').textContent = index === 2 ? '门板' : '木板';
    controlsForBeat(false);
    choosePart(key);
    if (!ui.projection) parts.querySelector('[data-part="hull"]').focus({ preventScroll: true });
  }

  function closeInspection(restoreFocus = true) {
    const { decks, view } = inspection;
    for (const [mesh, visible] of decks) mesh.visible = visible;
    inspection = null;
    focus = null;
    syncShadow();
    controls.enableDamping = false;
    controls.update();
    camera.position.copy(view.eye);
    controls.target.copy(view.target);
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    controls.update();
    controls.enableDamping = !ui.projection;
    viewport.updateShadows();
    controlsForBeat(false);
    if (restoreFocus) { holdClip(index); inspectButton.focus({ preventScroll: true }); }
    notify();
  }

  function pickPart(event) {
    const { bay, board, decks } = inspection;
    const ray = viewport.pick(event);
    const options = [
      ['hull', ray.intersectObject(bay.hull, true)[0]],
      ['beam', ray.intersectObject(bay.support, true)[0]],
      ['board', ray.intersectObjects([board, ...decks.map(([mesh]) => mesh)].filter(mesh => mesh.visible), true)[0]],
    ].filter(([, hit]) => hit).sort((a, b) => a[1].distance - b[1].distance);
    if (options.length) choosePart(options[0][0]);
  }

  ui.on(inspectButton, 'click', () => openInspection());
  ui.on(closeParts, 'click', () => closeInspection());
  ui.on(parts, 'click', event => {
    const button = event.target.closest('[data-part]');
    if (button) choosePart(button.dataset.part);
  });

  function paintPlayback(button, icon, label) {
    button.dataset.icon = icon;
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  function showProgress() {
    tools.dataset.progress = String(comparison ? comparison.elapsed / roundDuration :
      beats[index] ? elapsed / beats[index].duration : 0);
  }

  function controlsForBeat(animate = true) {
    actionGroup.hidden = !!inspection || !!comparison;
    parts.hidden = !inspection || !!comparison;
    comparisonControls.hidden = !comparison;
    if (comparison) {
      tools.dataset.playback = comparison.phase;
      tools.dataset.comparing = '';
      allocation.value = String(comparison.groups);
      allocation.disabled = comparison.phase === 'playing';
      allocated.textContent = comparison.groups + ' 组';
      paintPlayback(runComparison, {ready:'play', playing:'pause', paused:'play', finished:'repeat'}[comparison.phase],
        {ready:'播放', playing:'暂停', paused:'继续', finished:'重播'}[comparison.phase]);
      showProgress();
      caption.textContent = comparison.phase === 'finished'
        ? '未过河 ' + (groupCount - countArrivals(comparisonRound, comparison.elapsed)) + ' 组'
        : '课堂推演';
      return;
    }
    delete tools.dataset.comparing;
    if (inspection) return;
    inspectButton.hidden = phase !== 'waiting' || (index !== 1 && index !== 2);
    const previousCaption = caption.textContent;
    if (phase === 'playing' || phase === 'paused') {
      caption.textContent = (clip && assets['river-short-caption-'+clipKeys[index]]) || beats[index].caption;
      paintPlayback(action, phase === 'playing' ? 'pause' : 'play', phase === 'playing' ? '暂停' : '继续');
    } else {
      caption.textContent = index < 0 ? '中央红军要秘密转移。于都河上没有固定桥，八万多人得在夜里过河。' :
        phase === 'finished' && recallTime === 'night' ? beats[3].hold : beats[index].hold;
      paintPlayback(action, phase === 'finished' ? 'repeat' : 'next', phase === 'finished' ? '重播' : beats[index + 1].label);
    }
    tools.dataset.playback = phase;
    if (animate && previousCaption && previousCaption !== caption.textContent) {
      ui.animate(caption, [{ opacity: 0.3, transform: 'translateY(5px)' }, { opacity: 1, transform: 'none' }], 240);
    }
    tools.dataset.step = beats[index]?.label ?? '';
    showProgress();
    historyButton.hidden = !(phase === 'finished' || (index === 2 && phase === 'waiting'));
    compareButton.hidden = phase !== 'finished';
  }

  function showComparison() {
    world.lightAt(1 + ease(comparison.elapsed, roundDuration - 1.2, roundDuration) * .55);
    drawRound(comparisonRound, comparison.elapsed);
    world.water.uniforms.elapsed.value = nightWater + (ui.reduced.matches ? 0 : comparison.elapsed);
    showProgress();
    viewport.invalidate();
  }

  function setComparison(next) {
    const groupsChanged = !comparison || comparison.groups !== next.groups;
    const phaseChanged = !comparison || comparison.phase !== next.phase;
    if (!comparison) {
      stopClip();
      world.setBridges(true);
      workers.show(0);
      world.focusShadow(null);
      viewport.updateShadows();
    }
    if (groupsChanged) comparisonRound = arrangeRound(next.groups);
    comparison = next;
    if (groupsChanged || phaseChanged) controlsForBeat(false);
    showComparison();
  }

  function leaveComparison() {
    comparison = null;
    if (!ui.projection) controls.enabled = true;
    if (viewBeforeComparison) applyCameraView(viewBeforeComparison);
    controls.enableDamping = !ui.projection;
    viewBeforeComparison = null;
    drawRecall();
    controlsForBeat(false);
    compareButton.focus({preventScroll:true});
    notify();
  }

  ui.on(compareButton, 'click', () => {
    if (phase !== 'finished') return;
    ui.closeReading({immediate:true, restoreFocus:false});
    viewBeforeComparison = cameraView();
    focus = null;
    controls.enabled = false;
    controls.enableDamping = false;
    controls.update();
    applyCameraView({eye:wide.clone().add(duskView).toArray(), target:wide.toArray(), zoom:1.28});
    setComparison({groups:0, elapsed:0, phase:'ready'});
    allocation.focus({preventScroll:true});
    notify();
  });
  ui.on(allocation, 'input', () => {
    if (!comparison || comparison.phase === 'playing') return;
    setComparison({groups:Number(allocation.value), elapsed:0, phase:'ready'});
    notify();
  });
  ui.on(runComparison, 'click', () => {
    if (!comparison) return;
    const next = comparison.phase === 'playing' ? 'paused' : 'playing';
    setComparison({...comparison, elapsed:comparison.phase === 'finished' ? 0 : comparison.elapsed, phase:next});
    previousFrame = performance.now();
    notify();
  });
  ui.on(closeComparison, 'click', leaveComparison);

  function prepareBeat() {
    world.setBridges(index >= 3);
    world.lightAt(index === 4 ? 1 : 0);
    workers.show(0);
    if (index < 0) drawRound(firstRound, queueStart, 0);
    if (index === 1 || index === 2) drawRound(firstRound, queueStart + beats[0].duration, beats[0].duration);
    syncShadow();
    viewport.updateShadows();
  }

  function resetScene() {
    stopClip(true);
    if (inspection) closeInspection(false);
    comparison = viewBeforeComparison = null;
    controls.enabled = !ui.projection;
    index = -1;
    phase = 'waiting';
    elapsed = riverTime = 0;
    recallTime = 'dawn';
    selected = null;
    ui.closeReading({ restoreFocus: false });
    world.water.uniforms.elapsed.value = 0;
    resetView();
    prepareBeat();
    controlsForBeat();
  }

  function playNext() {
    if (phase === 'finished') resetScene();
    ui.closeReading({ immediate: true, restoreFocus: false });
    index++;
    elapsed = 0;
    phase = 'playing';
    previousFrame = performance.now();
    prepareBeat();
    beats[index].enter();
    beats[index].draw(0);
    playClip();
    controlsForBeat();
    viewport.invalidate();
    notify();
  }

  ui.on(action, 'click', () => {
    if (inspection) return;
    if (phase === 'waiting' || phase === 'finished') playNext();
    else {
      phase = phase === 'playing' ? 'paused' : 'playing';
      if (phase === 'paused') { ++clipGeneration; clip?.pause(); setVoiceDuck(false); }
      else playClip();
      previousFrame = performance.now();
      controlsForBeat();
      notify();
    }
  });

  function showHistory() {
    if (phase !== 'finished') {
      ui.read({ title: '船与门板' },
        '架浮桥要用的船和木料一时难以凑齐。乡亲们卸下自家的门板、床板，渔民把赖以谋生的船划来帮忙。',
        '一条船损坏，船主可能就没法出工。毛泽东在渡口谈赔偿时，用一艘值一百块大洋的船举例，连船主误工的三十块也算了进去。');
      return;
    }
    ui.read({ title: '渡河计划' },
      '《野战军南渡贡水计划表》给各部队定了渡口和时段。8.6 万余人分批从 8 处渡口过河，其中 5 处架设浮桥。',
      '收桥后，还得清理河滩上的脚印。白天即使看不到桥，密集的脚印也可能泄露大队人马的行踪。',
      `课堂推演。同一时长内，单处过河 ${firstPassed} 组，两处分流过河 ${countArrivals(secondRound, roundDuration)} 组。`);
    recall.hidden = false;
    updateRecall();
  }

  ui.on(historyButton, 'click', () => {
    showHistory();
    notify();
  });

  function updateRecall() {
    for (const button of recall.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.recall === recallTime));
    }
  }

  function drawRecall() {
    world.setBridges(true);
    workers.show(0);
    syncShadow();
    if (recallTime === 'night') {
      world.lightAt(1);
      drawRound(secondRound, nightStop, beats[3].duration);
      world.water.uniforms.elapsed.value = nightWater;
      caption.textContent = beats[3].hold;
    } else {
      showClearing(beats.at(-1).duration);
      world.water.uniforms.elapsed.value = dawnWater;
      caption.textContent = beats.at(-1).hold;
    }
    holdClip(recallTime === 'night' ? 3 : 4);
    updateRecall();
    viewport.updateShadows();
  }

  ui.on(recall, 'click', event => {
    const button = event.target.closest('button[data-recall]');
    if (phase !== 'finished' || !button) return;
    recallTime = button.dataset.recall;
    drawRecall();
    ui.closeReading();
    notify();
  });

  ui.on(ui.canvas, 'pointerdown', event => {
    pointers.add(event.pointerId);
    if (!event.isPrimary) return;
    const start = event.button === 0 && !event.shiftKey && !event.ctrlKey && !event.metaKey;
    tap = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, start };
  }, true);
  ui.on(ui.canvas, 'pointermove', event => {
    if (tap?.id === event.pointerId && Math.hypot(tap.x - event.clientX, tap.y - event.clientY) > 6) {
      tap.moved = true;
      if (phase !== 'playing' && phase !== 'paused') stopClip();
      following = false;
      focus = null;
    }
  });
  ui.on(ui.canvas, 'pointerup', event => {
    pointers.delete(event.pointerId);
    if (tap?.id !== event.pointerId) return;
    const still = tap.start && !tap.moved && Math.hypot(tap.x - event.clientX, tap.y - event.clientY) <= 6;
    tap = null;
    if (still && inspection) pickPart(event);
    else if (still && phase === 'waiting') playNext();
  });
  ui.on(ui.canvas, 'pointercancel', event => {
    pointers.delete(event.pointerId);
    if (tap?.id === event.pointerId) tap = null;
  });

  function cancelPointers() {
    for (const pointerId of pointers) {
      ui.canvas.dispatchEvent(new PointerEvent('pointercancel', { pointerId }));
    }
    pointers.clear();
    tap = null;
  }

  ui.on(window, 'blur', cancelPointers);
  ui.on(ui.reduced, 'change', () => { if (ui.reduced.matches && phase === 'paused') holdClip(index); });
  ui.on(document, 'visibilitychange', () => {
    previousFrame = performance.now();
  });
  ui.on(ui.canvas, 'wheel', () => { if (phase !== 'playing' && phase !== 'paused') stopClip(); following = false; focus = null; }, { passive: true });
  ui.on(ui.canvas, 'keydown', event => {
    if (!event.repeat && !inspection && phase === 'waiting' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      playNext();
    }
  });
  ui.on(ui.stage, 'keydown', event => {
    if (event.code !== 'Escape') return;
    event.preventDefault();
    if (!ui.reading.hidden) ui.closeReading();
    else if (comparison) return leaveComparison();
    else if (inspection) closeInspection();
    else resetView();
    notify();
  });

  function advanceCamera(delta) {
    if (!focus) return;
    focus.elapsed += delta;
    const blend = ui.reduced.matches ? 1 : THREE.MathUtils.clamp(focus.elapsed / focus.duration, 0, 1);
    const eased = blend * blend * (3 - 2 * blend);
    point.copy(focus.from).lerp(focus.to, eased);
    controls.target.copy(point);
    camera.position.copy(focus.eye).lerp(focus.destination, eased);
    camera.zoom = THREE.MathUtils.lerp(focus.zoom, focus.targetZoom, eased);
    camera.updateProjectionMatrix();
    if (blend === 1) focus = null;
  }

  function advanceBeat(delta) {
    const beat = beats[index];
    const next = Math.min(beat.duration, elapsed + delta);
    riverTime += next - elapsed;
    elapsed = next;
    beat.draw(elapsed);
    advanceCamera(delta);
    showProgress();
    if (!ui.reduced.matches) {
      world.water.uniforms.elapsed.value = riverTime;
    }
    if (elapsed === beat.duration) {
      holdClip(index);
      if (index === 3) nightWater = world.water.uniforms.elapsed.value;
      if (index === 4) dawnWater = world.water.uniforms.elapsed.value;
      phase = index === beats.length - 1 ? 'finished' : 'waiting';
      controlsForBeat();
    }
    viewport.invalidate();
  }

  function frame(frameDelta, now) {
    const previousPhase = phase;
    const delta = Math.min(0.05, Math.max(0, frameDelta), Math.max(0, (now - previousFrame) / 1000));
    if (!ui.projection && comparison?.phase === 'playing') {
      comparison.elapsed = Math.min(roundDuration, comparison.elapsed + delta);
      if (comparison.elapsed === roundDuration) {
        comparison.phase = 'finished';
        controlsForBeat(false);
      }
      showComparison();
      ui.changed?.(comparison.phase === 'finished');
    } else if (!ui.projection && phase === 'playing') {
      const shotDelta = videoDelta(now);
      if (shotDelta !== 0) advanceBeat(shotDelta ?? delta);
    }
    else if (focus && (inspection || index < 0)) {
      advanceCamera(delta);
      viewport.invalidate();
    }
    previousFrame = now;
    controls.update();
    camera.updateMatrixWorld();
    const title = selected ? riverStops[selected].label : '两处渡口';
    ui.stage.dataset.area = title;
    for (const { id, element, anchor } of labels) {
      element.dataset.hint = String(id === selected);
      const introduced = id === 'east' || (id === 'downstream' && index >= 1) ||
        (id === 'supply' && index === 1 && elapsed < 1.1);
      viewport.place(element, anchor, introduced);
    }
    if (previousPhase === 'playing' || orbitChanged) ui.changed?.(phase !== previousPhase);
    orbitChanged = false;
  }

  function cameraView() {
    return { eye: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom };
  }

  function applyCameraView(view) {
    camera.position.fromArray(view.eye);
    controls.target.fromArray(view.target);
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    controls.update();
  }

  /** @returns {RiverView} */
  function read() {
    return {
      ...cameraView(), index, phase, elapsed, selected, recall: recallTime,
      water: world.water.uniforms.elapsed.value,
      part: inspection?.part ?? null,
      reading: !ui.reading.hidden && !ui.reading.inert,
      comparison: comparison ? {...comparison} : null,
    };
  }

  function restore(view) {
    const beat = beats[view.index];
    if (view.index >= beats.length || (!beat && view.phase !== 'waiting') ||
      (beat && view.elapsed > beat.duration)) return;

    const beatChanged = view.index !== index;
    const recallChanged = view.recall !== recallTime;
    const phaseChanged = view.phase !== phase;
    const timeChanged = view.elapsed !== elapsed;
    const closingComparison = comparison && !view.comparison;
    if (inspection && (beatChanged || !view.part)) closeInspection(false);
    index = view.index;
    phase = view.phase;
    elapsed = view.elapsed;
    selected = view.selected;
    recallTime = view.recall;
    if (beatChanged) prepareBeat();
    if (view.comparison) {
      setComparison({...view.comparison});
    } else if (phase === 'finished' && (beatChanged || recallChanged || phaseChanged || closingComparison)) {
      comparison = null;
      drawRecall();
    } else if (beat && (beatChanged || timeChanged)) {
      beat.draw(elapsed);
      viewport.updateShadows();
    }
    world.water.uniforms.elapsed.value = view.water;
    if (!comparison) showProgress();
    if (beatChanged || phaseChanged || recallChanged || closingComparison) controlsForBeat(false);
    if (view.part && !inspection) openInspection(view.part);
    else if (view.part && view.part !== inspection?.part) choosePart(view.part);
    if (syncShadow()) viewport.updateShadows();
    if (view.reading && (ui.reading.hidden || ui.reading.inert || beatChanged || phaseChanged)) showHistory();
    else if (!view.reading) ui.closeReading({ immediate: true, restoreFocus: false });
    applyCameraView(view);
    viewport.invalidate();
  }

  function dispose() {
    stopClip(true);
    clip?.remove();
    backdrop?.remove();
    releaseVoiceMute?.();
    if (controls.domElement) controls.dispose();
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
        if (material.uniforms) {
          for (const uniform of Object.values(material.uniforms)) {
            if (uniform?.value?.isTexture) textures.add(uniform.value);
          }
        }
      }
    });
    for (const texture of textures) texture.dispose();
    for (const material of materials) material.dispose();
    for (const geometry of geometries) geometry.dispose();
  }

  return {
    read,
    restore,
    home,
    reset: resetScene,
    dispose,
    activate(view) {
      if (!ui.projection) {
        controls.connect(ui.canvas);
        controls.enabled = !comparison;
        controls.enableDamping = !comparison;
      }
      previousFrame = performance.now();
      tools.hidden = false;
      if (!started) {
        resetScene();
        started = true;
        if (!ui.projection && !ui.reduced.matches && ui.stage.classList.contains('lesson-exploration')) {
          const bow = east.bays[1].hull.position.clone().add(new THREE.Vector3(0.42, 0.30, 0.54));
          applyCameraView({
            eye:bow.clone().add(new THREE.Vector3(-2.8, 1, 5.1)).toArray(), target:bow.toArray(), zoom:15.5,
          });
          cameraTo(wide, 1, duskView, 0.68, 0.24);
        }
      } else controlsForBeat(false);
      if (view) restore(view);
      viewport.activate();
      if (clip && index >= 0 && !inspection && !comparison) {
        if (phase === 'paused' && !ui.reduced.matches) {
          paintClip(clipIndex === index && clip.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA,clipKeys[index]);
        } else if (phase !== 'playing') {
          holdClip(phase === 'finished' && recallTime === 'night' ? 3 : index);
        }
      }
    },
    pauseForSwitch() {
      if (comparison?.phase === 'playing') {
        comparison.phase = 'paused';
        controlsForBeat(false);
      }
      if (phase === 'playing') {
        phase = 'paused';
        ++clipGeneration;
        clip?.pause();
        setVoiceDuck(false);
        controlsForBeat(false);
      }
    },
    deactivate({ preserveInspection = false } = {}) {
      stopClip();
      if (!ui.projection) {
        cancelPointers();
        const view = cameraView();
        controls.enableDamping = false;
        controls.update();
        applyCameraView(view);
        controls.enableDamping = true;
        controls.enabled = false;
        controls.disconnect();
      }
      if (inspection && !preserveInspection) closeInspection(false);
      viewport.deactivate();
      tools.hidden = true;
    },
  };
}
