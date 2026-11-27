import { createExplorationOverlay } from './exploration-overlay.js';
import { createStageViewport } from './viewport.js';
import { isRiverView, startRiver } from './river.js';
import { describeHallClue, describeHallClues, isHallView, startWalk } from './walk.js';
import riverControls from './river-controls.html';
import walkControls from './walk-controls.html';
import reading from './exploration-reading.html';

const scenes = {
  'yudu-river': { title: '于都河岸', start: startRiver },
  'zunyi-hall': { title: '遵义材料厅', start: startWalk },
};

/** @template {HTMLElement} T
 * @param {T} node
 * @param {string} label
 * @returns {T}
 */
export function markScenePoint(node, label) {
  node.classList.add('scene-point');
  node.setAttribute('aria-label', label);
  node.replaceChildren();
  return node;
}

/**
 * @typedef {{
 *   id: 'yudu-river', state: import('./river.js').RiverView
 * } | {
 *   id: 'zunyi-hall', state: import('./walk.js').HallView
 * }} ExplorationView
 */

/** @returns {view is ExplorationView} */
export function isExplorationView(view) {
  return view != null && (view.id === 'yudu-river' && isRiverView(view.state) ||
    view.id === 'zunyi-hall' && isHallView(view.state));
}

/** @param {ExplorationView | null} view */
export function hallClue(view) {
  return view?.id === 'zunyi-hall' ? describeHallClue(view.state) : undefined;
}

/** @param {ExplorationView | null} view */
export function hallClues(view) {
  return view?.id === 'zunyi-hall' ? describeHallClues(view.state) : [];
}

/** @param {{
 *   assets: Readonly<Record<string, string>>, stage?: HTMLElement, projection?: boolean, riverExplorationOnly?: boolean,
 *   onChange?: (immediate: boolean) => void, onSwitch?: (id: string, previous?: string) => void
 * }} options */
export function createExploration({ assets, stage: sampleStage, onSwitch, projection = false, onChange, riverExplorationOnly = false }) {
  const stage = sampleStage ?? document.createElement('section');
  if (!sampleStage) {
    stage.className = 'lesson-exploration exploration-stage';
    stage.innerHTML = '<canvas id="view" tabindex="0"></canvas><div id="markers"></div>' +
      walkControls + riverControls + reading;
    if (riverExplorationOnly) {
      stage.querySelector('#river-compare').remove();
      stage.querySelector('#river-comparison').remove();
      stage.querySelector('#river-tools').setAttribute('aria-label', '于都河岸');
    }
  }
  const canvas = stage.querySelector('#view');
  if (projection) canvas.tabIndex = -1;
  const markerLayer = stage.querySelector('#markers');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const overlay = createExplorationOverlay({
    stage, canvas, reduced, projection,
    header: stage.querySelector('.hud'),
    docks: [stage.querySelector('#inspect'), stage.querySelector('#river-tools')].filter(Boolean),
  });
  const closeButton = overlay.reading.querySelector('#close');
  const cache = new Map();
  const controllers = new Set();
  let viewport;
  let current;
  let selection;

  function closeMaterial() {
    overlay.closeReading();
    if (current) onChange?.(true);
  }
  if (!projection && closeButton) closeButton.addEventListener('click', closeMaterial);

  function getScene(id) {
    if (cache.has(id)) return cache.get(id);
    viewport ??= createStageViewport(canvas, stage);
    const markers = document.createElement('div');
    markers.hidden = true;
    markerLayer.append(markers);
    const subscriptions = [];
    const entry = { id, markers, subscriptions, input: null, controller: null };
    const loaded = scenes[id].start({
      ...overlay, stage, canvas, reduced, viewport, projection, riverExplorationOnly,
      inspect: stage.querySelector('#inspect'),
      instruction: stage.querySelector('#instruction'),
      summary: stage.querySelector('#summary'),
      leave: stage.querySelector('#leave'),
      changed(immediate) { if (current === entry) onChange?.(immediate); },
      marker(label, tag = 'button') {
        const node = document.createElement(projection ? 'span' : tag);
        if (node instanceof HTMLButtonElement) node.type = 'button';
        node.className = 'marker';
        if (tag === 'button') {
          markScenePoint(node, label);
          if (projection) node.setAttribute('aria-hidden', 'true');
        } else node.textContent = label;
        node.hidden = true;
        markers.append(node);
        return node;
      },
      on(target, type, listener, options = {}) {
        if (!projection) subscriptions.push([target, type, listener,
          typeof options === 'boolean' ? {capture: options} : options]);
      },
    }, assets).then(controller => {
      entry.controller = controller;
      controllers.add(controller);
      return entry;
    }).catch(error => {
      markers.remove();
      cache.delete(id);
      throw error;
    });
    cache.set(id, loaded);
    return loaded;
  }

  function deactivate() {
    if (!current) return;
    const entry = current;
    current = undefined;
    entry.controller.pauseForSwitch?.();
    entry.controller.deactivate({ preserveInspection: !sampleStage });
    entry.input?.abort();
    entry.markers.hidden = true;
    overlay.closeReading({ immediate: true, restoreFocus: false });
    canvas.style.cursor = '';
  }

  function close() {
    selection = undefined;
    deactivate();
    stage.removeAttribute('data-ready');
    if (!sampleStage) stage.remove();
  }

  function open(id, container, state) {
    if (!sampleStage && stage.parentElement !== container) {
      close();
      container.append(stage);
    }
    if (current?.id === id) {
      selection = undefined;
      if (state) current.controller.restore(state);
      return Promise.resolve(true);
    }
    if (selection?.id === id) {
      selection.state = state;
      return selection.loading;
    }
    current?.controller.pauseForSwitch?.();
    const pending = { id, state, loading: null };
    selection = pending;
    pending.loading = Promise.resolve().then(() => getScene(id)).then(entry => {
      if (selection !== pending) return false;
      onSwitch?.(id, current?.id);
      deactivate();
      current = entry;
      stage.dataset.scene = id;
      canvas.setAttribute('aria-label', scenes[id].title + '三维场景');
      if (!projection) {
        entry.input = new AbortController();
        for (const [target, type, listener, options] of entry.subscriptions) {
          target.addEventListener(type, listener, {...options, signal: entry.input.signal});
        }
      }
      entry.markers.hidden = false;
      entry.controller.activate(pending.state);
      stage.setAttribute('data-ready', '');
      if (!projection) canvas.focus({preventScroll: true});
      selection = undefined;
      return true;
    }).catch(error => {
      if (selection !== pending) return false;
      selection = undefined;
      if (!sampleStage) close();
      throw error;
    });
    return pending.loading;
  }

  return {
    open, close,
    /** @returns {ExplorationView | null} */
    read() { return current ? {id: current.id, state: current.controller.read()} : null; },
    apply(container, view) {
      if (view) return open(view.id, container, view.state);
      close();
      return Promise.resolve(false);
    },
    home() { current?.controller.home?.(); },
    restart() { current?.controller.reset(); },
    reset() {
      for (const ready of cache.values()) void ready.then(entry => entry.controller.reset(), () => {});
    },
    capture(snapshot) { return viewport?.capture(snapshot) ?? false; },
    animate: overlay.animate,
    dispose() {
      close();
      for (const controller of controllers) controller.dispose?.();
      controllers.clear();
      cache.clear();
      if (!projection) closeButton?.removeEventListener('click', closeMaterial);
      overlay.dispose();
      viewport?.dispose();
    },
  };
}
export { createDeskWorld } from './desk-world.js';
export { deskJournalFaces } from './desk-paper.js';
export { deskRouteMap } from './evidence.js';
export { default as deskNotebook } from './notebook.json';
