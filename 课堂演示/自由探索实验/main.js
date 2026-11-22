import { createExploration } from './exploration-stage.js';

const stage = document.getElementById('stage');
const get = id => stage.querySelector('#' + id);
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const scenes = {
  walk: { id: 'zunyi-hall', title: '会前的遵义', era: '1935 年 1 月　贵州 · 遵义' },
  river: { id: 'yudu-river', title: '于都河岸', era: '1934 年 10 月　江西 · 于都' },
};
const tabs = stage.querySelector('.modes');
const status = get('status');
const snapshot = get('scene-previous');
const home = get('home');
const restart = get('restart');
let selected;
let generation = 0;
let fade;
let captured = false;

function headingFor(name) {
  const scene = scenes[name];
  document.body.dataset.mode = name;
  get('scene-title').textContent = scene.title;
  get('era').textContent = scene.era;
  home.hidden = name !== 'river';
  restart.hidden = name !== 'walk';
  restart.disabled = false;
  for (const button of tabs.querySelectorAll('[data-scene]')) {
    if (button.dataset.scene === name) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
}

function clearTransition() {
  fade?.cancel();
  fade = undefined;
  snapshot.hidden = true;
  snapshot.width = snapshot.height = 1;
}

const exploration = createExploration({
  stage, assets: __ASSETS__,
  onSwitch(id, previous) {
    clearTransition();
    captured = Boolean(previous && !reduced.matches && exploration.capture(snapshot));
    selected = id === scenes.river.id ? 'river' : 'walk';
    headingFor(selected);
  },
});

async function selectScene(name) {
  const request = ++generation;
  status.hidden = Boolean(selected);
  if (!selected) status.textContent = '正在载入…';
  try {
    const opened = await exploration.open(scenes[name].id);
    if (!opened || request !== generation) return;
    status.hidden = true;
    if (captured && !reduced.matches) {
      captured = false;
      snapshot.hidden = false;
      const animation = exploration.animate(snapshot, [
        {opacity: 1, transform: 'none'},
        {opacity: 0, transform: 'translateY(-5px) scale(1.006)'},
      ], 360);
      fade = animation;
      animation.finished.then(() => { if (fade === animation) clearTransition(); }, () => {});
      exploration.animate(get('markers'), [{opacity: 0}, {opacity: 1}], 285);
      exploration.animate(stage.querySelector('.heading'), [
        {opacity: 0.42, transform: 'translateY(6px)'},
        {opacity: 1, transform: 'none'},
      ], 250);
    }
  } catch (error) {
    if (request !== generation) return;
    console.error(error);
    status.hidden = false;
    status.textContent = '场景载入失败，请使用已启用 WebGL 2 的 Edge 重试。';
  }
}

const sceneFromHash = () => location.hash === '#river' ? 'river' : 'walk';
window.addEventListener('hashchange', () => selectScene(sceneFromHash()));
tabs.addEventListener('click', event => {
  const target = event.target.closest('[data-scene]');
  if (!target) return;
  const name = target.dataset.scene;
  if (location.hash !== '#' + name) location.hash = name;
  else if (selected !== name) selectScene(name);
});
reduced.addEventListener('change', () => { if (reduced.matches) clearTransition(); });
home.addEventListener('click', () => exploration.home());
restart.addEventListener('click', () => exploration.restart());
get('full').addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen().catch(() => {});
  else await stage.requestFullscreen().catch(() => {});
});
document.addEventListener('fullscreenchange', () => {
  get('full').textContent = document.fullscreenElement ? '退出全屏' : '全屏';
});
window.addEventListener('pagehide', event => { if (!event.persisted) exploration.dispose(); });

selectScene(sceneFromHash());
