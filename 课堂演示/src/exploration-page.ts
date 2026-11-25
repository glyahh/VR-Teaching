declare const explorationStage: typeof import('../自由探索实验/exploration-stage.js');
type Exploration = ReturnType<typeof explorationStage.createExploration>;
type ExplorationView = NonNullable<ReturnType<Exploration['read']>>;
type ExplorationId = ExplorationView['id'];
type HallClue = NonNullable<ReturnType<typeof explorationStage.hallClue>>;
type HallHandoff = { frame: HTMLCanvasElement; anchor?: number[]; closeup?: HTMLCanvasElement };
type ExplorationAddress = { position: number; visit: number; version: number };
type ExplorationFrame = ExplorationAddress & { kind: 'view'; view: ExplorationView | null };
type ExplorationUpdate = ExplorationFrame | (ExplorationAddress & { kind: 'visit' });
type ExplorationPage = {
  id: ExplorationId;
  position: number;
  visit: number | null;
  apply(view: ExplorationView | null): void;
  release(): void;
};

const explorationLabels = {
  'yudu-river': { enter: '于都河岸', leave: '返回浮桥', name: '于都河岸', reset: '回全景' },
  'xiang-crossing': { enter: '湘江渡口现场', leave: '返回渡口', name: '湘江渡口', reset: '回全景' },
  'zunyi-hall': { enter: '进入材料厅', leave: '返回会场', name: '遵义材料厅', reset: '重新开始' },
} satisfies Record<ExplorationId, { enter: string; leave: string; name: string; reset: string }>;

let explorationActivity: Exploration | undefined;
let currentExplorationPage: ExplorationPage | undefined;
let explorationVisit = 0;
let explorationVersion = 0;
let receivedExplorationVisit = 0;
let receivedExplorationVersion = 0;
let explorationPublishTimer: number | undefined;
let retainedHallClues: HallClue[] = [];
const visitedExplorations = new Set<ExplorationId>();

function captureExplorationView(id: ExplorationId) {
  if (reducedMotion.matches || explorationActivity?.read()?.id !== id) return;
  const frame = document.createElement('canvas');
  if (explorationActivity.capture(frame)) return frame;
}

function captureHallHandoff(): HallHandoff | undefined {
  const frame = captureExplorationView('zunyi-hall');
  if (frame) return {frame, ...explorationActivity?.captureDeskShot(document.createElement('canvas'))};
}

function readExplorationUpdate(): ExplorationFrame | undefined {
  const page = currentExplorationPage;
  if (!page || page.visit === null) return;
  return {
    kind: 'view', position: page.position, visit: page.visit, version: ++explorationVersion,
    view: explorationActivity?.read() ?? null,
  };
}

function publishExplorationView(immediate: boolean) {
  if (projectionMode || !projectionReady || !currentExplorationPage) return;
  const send = () => {
    explorationPublishTimer = undefined;
    const update = readExplorationUpdate();
    if (update) sendProjection({type: 'exploration', update});
  };
  if (immediate) {
    window.clearTimeout(explorationPublishTimer);
    send();
  } else if (explorationPublishTimer === undefined) {
    explorationPublishTimer = window.setTimeout(send, 45);
  }
}

function applyExplorationUpdate(update: unknown, reconnect = false) {
  const page = currentExplorationPage;
  if (!page || typeof update !== 'object' || update === null ||
    !('position' in update && update.position === page.position) ||
    !('visit' in update && typeof update.visit === 'number' && Number.isSafeInteger(update.visit) && update.visit > 0) ||
    !('version' in update && typeof update.version === 'number' && Number.isSafeInteger(update.version) &&
      update.version > receivedExplorationVersion) || !('kind' in update)) return;

  if (update.kind === 'visit') {
    if (update.visit <= receivedExplorationVisit) return;
    page.visit = receivedExplorationVisit = update.visit;
    receivedExplorationVersion = update.version;
    return;
  }
  if (update.kind !== 'view' ||
    !('view' in update && (update.view === null ||
      explorationStage.isExplorationView(update.view) && update.view.id === page.id))) return;

  if (reconnect) {
    if (update.visit < receivedExplorationVisit) return;
    page.visit = receivedExplorationVisit = update.visit;
  }
  if (update.visit !== page.visit) return;
  receivedExplorationVersion = update.version;
  page.apply(update.view);
}

function releaseExplorationPage() {
  window.clearTimeout(explorationPublishTimer);
  explorationPublishTimer = undefined;
  currentExplorationPage?.release();
  currentExplorationPage = undefined;
}

function mountExplorationPage({ id, position, scene, stage, tools, bottom, pauseMedia, backdrop, openDesk }: {
  id: ExplorationId; position: number; scene: HTMLElement; stage: HTMLElement;
  tools: HTMLElement; bottom: HTMLElement; pauseMedia: () => void;
  backdrop?: { key: string; image: HTMLImageElement };
  openDesk?: () => void;
}) {
  const labels = explorationLabels[id];
  const activity = () => explorationActivity ??= explorationStage.createExploration({
    assets: mediaAssets, projection: projectionMode, onChange: publishExplorationView,
  });
  let surface: 'static' | 'loading' | 'exploration' = 'static';
  let request = 0;
  const status = element('p', 'exploration-load-status');
  status.setAttribute('role', 'status');
  status.hidden = true;
  scene.append(status);

  const header = scene.querySelector<HTMLElement>('.scene-head');
  const identity = header?.querySelector<HTMLElement>('.scene-identity');
  const next = bottom.querySelector<HTMLElement>('[data-lesson-action=next]');
  function positionDock() {
    const frame = stage.getBoundingClientRect();
    if (!projectionMode) {
      const gap = frame.bottom - bottom.getBoundingClientRect().top;
      scene.style.setProperty('--exploration-dock-bottom', Math.ceil(gap + 14) + 'px');
      const nav = next?.getBoundingClientRect();
      if (nav?.height) scene.style.setProperty('--river-action-bottom', (frame.bottom - nav.bottom) + 'px');
    }
    const buttons = tools.getBoundingClientRect();
    const top = buttons.height ? buttons.bottom - frame.top + Math.max(0,buttons.top - frame.top) :
      (header?.offsetHeight ?? 0) + 12;
    const title = identity?.getBoundingClientRect();
    const clearance = title && title.bottom > frame.top + top ? title.right - frame.left + 12 : 0;
    scene.style.setProperty('--scene-note-top', top + 'px');
    scene.style.setProperty('--scene-note-clearance', clearance + 'px');
  }
  const dockSize = new ResizeObserver(positionDock);
  for (const node of [stage, tools, bottom, header, identity]) if (node) dockSize.observe(node);

  function close(restoreBackdrop = true) {
    ++request;
    if (id === 'zunyi-hall' && !projectionMode && surface === 'exploration') {
      const clues = explorationStage.hallClues(explorationActivity?.read() ?? null);
      if (clues.length) {
        retainedHallClues = clues;
        sendProjection({type:'hall-clues', clues});
      }
    }
    explorationActivity?.close();
    const resume = restoreBackdrop && surface !== 'static';
    if (resume && surface === 'exploration' && backdrop) attachCinemagraph(backdrop.key, backdrop.image);
    surface = 'static';
    status.hidden = true;
    scene.removeAttribute('data-exploration');
    if (resume) currentVideo?.resumeBackground();
    syncButtons();
  }

  const toggle = projectionMode ? undefined : control(labels.enter, () => {
    if (surface === 'static') {
      pauseMedia();
      if (currentVideo) sendProjection({type: 'video', state: currentVideo.read()});
      void show(activity().open(id, stage));
    } else {
      close();
      publishExplorationView(true);
      toggle?.focus({preventScroll: true});
    }
  }, '', 'compass');
  const reset = projectionMode ? undefined : control(labels.reset, () => {
    if (id === 'yudu-river' || id === 'xiang-crossing') explorationActivity?.home();
    else explorationActivity?.restart();
  }, '', 'reset');
  const desk = openDesk ? syncControl('hall-desk','会议桌',() => {
    if (surface === 'exploration') openDesk();
  },'journey-control','layers') : undefined;
  if (desk) {
    desk.hidden = true;
    tools.prepend(desk);
  }
  if (toggle && reset) {
    reset.hidden = true;
    tools.prepend(toggle, reset);
  }

  function syncButtons() {
    const open = surface === 'exploration';
    if (desk) desk.hidden = !open;
    if (!toggle || !reset) return;
    if (surface === 'static') {
      toggle.classList.remove('icon-button');
      toggle.removeAttribute('aria-label');
      toggle.removeAttribute('title');
      setButtonContent(toggle,labels.enter,'compass');
    } else setIconButton(toggle,labels.leave,'arrowLeft');
    setIconButton(reset,labels.reset,'reset');
    toggle.setAttribute('aria-expanded', String(open));
    reset.hidden = !open;
  }

  async function show(opening: Promise<boolean>) {
    const loading = ++request;
    surface = 'loading';
    status.textContent = '正在载入' + labels.name + '…';
    status.hidden = false;
    syncButtons();
    try {
      const opened = await opening;
      if (loading !== request || !opened) return;
      stopCinemagraphs();
      surface = 'exploration';
      visitedExplorations.add(id);
      scene.dataset.exploration = id;
      status.hidden = true;
      syncButtons();
      positionDock();
      publishExplorationView(true);
      if (!projectionMode) {
        if (id === 'yudu-river') soundscape.setScene('yudu', 0.6);
        else if (id === 'xiang-crossing') soundscape.setScene('xiang', 0.6);
        else if (id === 'zunyi-hall') soundscape.setScene('zunyi-yard', 0.6);
      }
    } catch {
      if (loading !== request) return;
      close();
      status.textContent = labels.name + '载入失败，可继续使用当前课页。';
      status.hidden = false;
    }
  }

  syncButtons();
  const visit = projectionMode ? null : ++explorationVisit;
  currentExplorationPage = {
    id, position, visit,
    apply(view) {
      if (view === null) {
        close();
      } else {
        if (surface === 'static') pauseMedia();
        const opening = activity().apply(stage, view);
        if (surface === 'static') void show(opening);
      }
    },
    release() {
      close(false);
      dockSize.disconnect();
    },
  };
  if (visit !== null) {
    sendProjection({type: 'exploration', update: {kind: 'visit', position, visit, version: ++explorationVersion}});
  }
}

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  releaseExplorationPage();
  explorationActivity?.dispose();
  explorationActivity = undefined;
});
