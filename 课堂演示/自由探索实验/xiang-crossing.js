import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createXiangWorld, groundHeight, riverCenterX } from './xiang-world.js';

const presets = {
  overview: { eye: [22, 20, 34], target: [-1, 1.0, -4], label: '两岸态势' },
  wade: { eye: [-13.5, 3.6, 13.5], target: [2.5, 0.8, -4.5], label: '寒江涉水' },
  ridge: { eye: [-27, 10.5, -14], target: [2, 0.4, 2], label: '西岸阻击' },
};

const hotSpots = {
  ford: {
    label: '全州—兴安渡口浅滩',
    anchor: [1.5, 1.8, 0.4],
    view: 'wade',
    title: '抢渡湘江',
    finding: '1934 年 11 月 27 日至 12 月 1 日，中央红军在全州、兴安之间顶着寒水与炮火强渡湘江。',
    detail: '部队突破了国民党军第四道封锁线，但渡江通道狭窄、行军辎重沉重，各军团为掩护主力付出极大牺牲。',
  },
  blockade: {
    label: '两翼阻击与合围',
    anchor: [-16.5, 4.2, -14.5],
    view: 'ridge',
    title: '前堵后追的处境',
    finding: '南北两翼敌军向湘江渡口急速合拢，后卫部队在西岸高地死守数昼夜。',
    detail: '即使拼死打开了渡口，前方的湘西北原定路线仍重兵云集，继续按老办法硬打代价难以承受。',
  },
  aftermath: {
    label: '渡江之后',
    anchor: [-18.5, 2.5, 2.2],
    view: 'overview',
    title: '结果与代价同时成立',
    finding: '红军突破了第四道封锁线。掩护大部队过江的许多战士牺牲在湘江两岸。',
    detail: '队伍还要继续走。湘西北原定方向上仍有重兵，过江的代价促使红军重新审视前路。',
  },
};

const stages = [
  { at: 0.15, date: '11.27', note: '先头部队抢占界首、脚山铺一带渡口，敞开过江通道。' },
  { at: 0.56, date: '11.29', note: '南北两翼敌军合拢，大部队顶着寒水与炮火昼夜强渡。' },
  { at: 0.96, date: '12.01', note: '红军突破第四道封锁线。渡江的惨重损失促使部队反思此前的作战指挥。' },
];

/**
 * @typedef {{
 *   eye: number[], target: number[], progress: number, playing: boolean,
 *   preset: 'overview' | 'wade' | 'ridge', spot: string | null, reading: boolean
 * }} XiangView
 */

/** @returns {view is XiangView} */
export function isXiangView(view) {
  const vec = v => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
  return view != null && vec(view.eye) && vec(view.target) &&
    Number.isFinite(view.progress) && view.progress >= 0 && view.progress <= 1 &&
    typeof view.playing === 'boolean' &&
    (view.preset === 'overview' || view.preset === 'wade' || view.preset === 'ridge') &&
    (view.spot === null || Object.hasOwn(hotSpots, view.spot)) &&
    typeof view.reading === 'boolean';
}

export async function startXiang(ui, assets) {
  const world = await createXiangWorld(assets);
  const camera = new THREE.PerspectiveCamera(44, 1, 0.25, 240);
  camera.position.set(...presets.overview.eye);

  const controls = new OrbitControls(camera, ui.canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minPolarAngle = 0.18;
  controls.minDistance = 8;
  controls.maxDistance = 68;
  controls.target.set(...presets.overview.target);
  controls.update();

  const panel = ui.stage.querySelector('#xiang-tools');
  const note = ui.stage.querySelector('#xiang-instruction');
  const playBtn = ui.stage.querySelector('#xiang-play');
  const scrubber = ui.stage.querySelector('#xiang-scrubber');
  const camButtons = [...ui.stage.querySelectorAll('#xiang-cams button[data-preset]')];

  let progress = 0.16;
  let playing = false;
  let activePreset = 'overview';
  let activeSpot = null;
  let elapsed = 0;
  let glide = null;
  let dirty = true;

  const viewport = ui.viewport.register(camera, world.scene, frame);

  const markers = Object.entries(hotSpots).map(([id, item]) => {
    const button = ui.marker(item.label);
    const [ax, ay, az] = item.anchor;
    const anchor = new THREE.Vector3(ax, Math.max(ay, groundHeight(ax, az) + 1.4), az);
    ui.on(button, 'click', () => inspectSpot(id));
    return { id, button, anchor };
  });

  function sound() {
    return /** @type {{ playSfx?: (k: string) => void } | undefined} */ (/** @type {unknown} */ (window).__lessonSound);
  }

  function glideTo(presetName) {
    const target = presets[presetName];
    if (!target) return;
    activePreset = presetName;
    if (ui.reduced.matches) {
      camera.position.set(...target.eye);
      controls.target.set(...target.target);
      controls.update();
      glide = null;
    } else {
      glide = {
        fromEye: camera.position.clone(),
        toEye: new THREE.Vector3(...target.eye),
        fromTarget: controls.target.clone(),
        toTarget: new THREE.Vector3(...target.target),
        t: 0,
      };
    }
    syncUi();
    if (!ui.projection) ui.changed?.(true);
  }

  function inspectSpot(id) {
    const item = hotSpots[id];
    if (!item) return;
    activeSpot = id;
    playing = false;
    glideTo(item.view);
    if (id === 'ford') progress = Math.max(progress, 0.35);
    else if (id === 'blockade') progress = Math.max(progress, 0.62);
    else if (id === 'aftermath') progress = 0.96;
    sound()?.playSfx?.('point');
    ui.read(item, item.finding, item.detail);
    syncUi();
    if (!ui.projection) ui.changed?.(true);
  }

  function currentStage() {
    if (progress < 0.36) return stages[0];
    if (progress < 0.78) return stages[1];
    return stages[2];
  }

  function syncUi() {
    const st = currentStage();
    if (note && note.textContent !== st.note) note.textContent = st.note;
    if (scrubber) scrubber.value = String(Math.round(progress * 100));
    if (playBtn) {
      playBtn.dataset.icon = playing ? 'pause' : progress >= 0.98 ? 'repeat' : 'play';
      playBtn.setAttribute('aria-label', playing ? '暂停态势推演' : progress >= 0.98 ? '重播态势推演' : '播放态势推演');
    }
    camButtons.forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.preset === activePreset)));
    markers.forEach(({ id, button }) => {
      button.setAttribute('aria-pressed', String(activeSpot === id));
      button.dataset.seen = String(activeSpot === id);
    });
  }

  if (playBtn) {
    ui.on(playBtn, 'click', () => {
      if (progress >= 0.98) progress = 0.04;
      playing = !playing;
      sound()?.playSfx?.('point');
      syncUi();
      ui.changed?.(true);
    });
  }
  if (scrubber) {
    ui.on(scrubber, 'input', () => {
      playing = false;
      progress = THREE.MathUtils.clamp(Number(scrubber.value) / 100, 0, 1);
      syncUi();
      dirty = true;
      viewport.invalidate();
      ui.changed?.(false);
    });
  }
  for (const btn of camButtons) {
    ui.on(btn, 'click', () => {
      sound()?.playSfx?.('point');
      glideTo(btn.dataset.preset);
    });
  }
  ui.on(controls, 'start', () => { glide = null; });
  ui.on(controls, 'change', () => {
    dirty = true;
    viewport.invalidate();
    if (!ui.projection) ui.changed?.(false);
  });

  function frame(delta) {
    elapsed += delta;
    if (playing && !ui.projection) {
      progress = Math.min(1, progress + delta * 0.085);
      if (progress >= 1) playing = false;
      syncUi();
      ui.changed?.(false);
    }
    if (glide) {
      glide.t = Math.min(1, glide.t + delta / 0.58);
      const s = glide.t * glide.t * (3 - 2 * glide.t);
      camera.position.lerpVectors(glide.fromEye, glide.toEye, s);
      controls.target.lerpVectors(glide.fromTarget, glide.toTarget, s);
      if (glide.t >= 1) glide = null;
      dirty = true;
    }
    controls.update();
    world.update(progress, elapsed, ui.reduced.matches);
    for (const { anchor, button } of markers) {
      viewport.place(button, anchor, true);
    }
    if (!ui.reduced.matches || dirty) {
      viewport.invalidate();
      dirty = false;
    }
  }

  /** @returns {XiangView} */
  function read() {
    return {
      eye: camera.position.toArray(),
      target: controls.target.toArray(),
      progress,
      playing,
      preset: /** @type {'overview'|'wade'|'ridge'} */ (activePreset),
      spot: activeSpot,
      reading: !ui.reading.hidden && !ui.reading.inert,
    };
  }

  function restore(view) {
    glide = null;
    camera.position.fromArray(view.eye);
    controls.target.fromArray(view.target);
    controls.update();
    progress = view.progress;
    playing = view.playing;
    activePreset = view.preset;
    activeSpot = view.spot;
    syncUi();
    if (view.reading && activeSpot && hotSpots[activeSpot]) {
      const item = hotSpots[activeSpot];
      ui.read(item, item.finding, item.detail);
    } else if (!view.reading) {
      ui.closeReading({ immediate: true, restoreFocus: false });
    }
    dirty = true;
    viewport.invalidate();
  }

  function reset() {
    playing = false;
    progress = 0.16;
    activeSpot = null;
    ui.closeReading({ immediate: true, restoreFocus: false });
    glideTo('overview');
  }

  function dispose() {
    controls.dispose();
    const geos = new Set(), mats = new Set(), texs = new Set();
    world.scene.traverse(n => {
      if (n.geometry) geos.add(n.geometry);
      if (!n.material) return;
      for (const m of Array.isArray(n.material) ? n.material : [n.material]) {
        mats.add(m);
        for (const v of Object.values(m)) if (v?.isTexture) texs.add(v);
      }
    });
    for (const t of texs) t.dispose();
    for (const m of mats) m.dispose();
    for (const g of geos) g.dispose();
  }

  return {
    read, restore, reset, dispose,
    home: () => glideTo('overview'),
    pauseForSwitch() { playing = false; syncUi(); },
    activate(view) {
      if (panel) panel.hidden = false;
      controls.enabled = !ui.projection;
      if (view) restore(view);
      else syncUi();
      viewport.activate();
    },
    deactivate() {
      playing = false;
      controls.enabled = false;
      viewport.deactivate();
      if (panel) panel.hidden = true;
    },
  };
}
