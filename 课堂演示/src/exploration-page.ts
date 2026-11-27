declare const explorationStage: typeof import('../自由探索实验/exploration-stage.js');
type Exploration = ReturnType<typeof explorationStage.createExploration>;
type ExplorationView = NonNullable<ReturnType<Exploration['read']>>;
type ExplorationId = ExplorationView['id'];
type HallClue = NonNullable<ReturnType<typeof explorationStage.hallClue>>;
const explorationLabels = {
  'yudu-river': { enter: '进入河岸', leave: '返回浮桥', name: '于都河岸', reset: '回全景' },
  'zunyi-hall': { enter: '进入材料厅', leave: '返回会场', name: '遵义材料厅', reset: '重新开始' },
} satisfies Record<ExplorationId, { enter: string; leave: string; name: string; reset: string }>;

let explorationActivity: Exploration | undefined;
let releaseCurrentExploration: (()=>void) | undefined;
let retainedHallClues: HallClue[] = [];
const visitedExplorations = new Set<ExplorationId>();

function captureExplorationView(id: ExplorationId) {
  if (reducedMotion.matches || explorationActivity?.read()?.id !== id) return;
  const frame = document.createElement('canvas');
  if (explorationActivity.capture(frame)) return frame;
}

function captureDeskDeparture(): HTMLCanvasElement | HTMLImageElement | undefined {
  if (reducedMotion.matches) return;
  const hall = captureExplorationView('zunyi-hall');
  if (hall) return hall;
  const film = app.querySelector<HTMLVideoElement>('.scene-camera video.is-visible');
  if (film && film.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && film.videoWidth) {
    const still = element('canvas');
    still.width = Math.min(720,film.videoWidth);
    still.height = Math.round(still.width * film.videoHeight / film.videoWidth);
    const ctx = still.getContext('2d');
    if (ctx) {
      ctx.drawImage(film,0,0,still.width,still.height);
      return still;
    }
  }
  const still = app.querySelector<HTMLImageElement>('.scene-camera img');
  if (still?.naturalWidth) return photo('zunyi');
}

function releaseExplorationPage() {
  releaseCurrentExploration?.();
  releaseCurrentExploration = undefined;
}

type TourCue = { until: number; text: string };
type SceneTourEnd = {
  layer: HTMLElement;
  frame: HTMLCanvasElement | HTMLVideoElement;
  aspect: number;
};
const sceneTours = {
  'yudu-river': { key: 'river-tour', start: '于都河岸', short: '河岸短片' },
  xiang: { key: 'xiang-tour', start: '播放渡江短片', short: '渡江短片' },
};

function mountSceneTour({ id, scene, stage, tools, signal, onEnded }: {
  id: keyof typeof sceneTours; scene: HTMLElement; stage: HTMLElement; tools: HTMLElement; signal: AbortSignal;
  onEnded?: (end: SceneTourEnd) => void;
}) {
  type TourState = 'ready' | 'playing' | 'paused' | 'finished' | 'unavailable';
  const config = sceneTours[id];
  const isYudu = id === 'yudu-river';
  const cues: TourCue[] = JSON.parse(mediaAssets[config.key + '-cues']);
  const film = element('div', 'scene-tour ' + config.key);
  const video = element('video');
  video.src = mediaAssets[config.key + '-video'];
  video.poster = mediaAssets[config.key + '-poster'];
  video.preload = 'auto';
  video.playsInline = true;
  video.muted = soundscape.isMuted();
  const caption = element('p', 'film-subtitle scene-tour-caption' + (isYudu ? ' river-tour-caption' : ''));
  film.append(video);
  stage.append(film);
  let state: TourState = 'ready';
  let playback = 0;
  const controlButton = lessonControl('tour-playback','', () => {
    if (state === 'playing') pause();
    else void play();
  });
  controlButton.dataset.sceneTourControl = '';
  const stillButton = isYudu ? lessonControl('tour-still','', () => {
    render('ready');
    controlButton.focus({preventScroll:true});
  }) : undefined;
  tools.append(controlButton);
  if (stillButton) {
    setIconButton(stillButton, '查看浮桥图', 'image');
    stillButton.dataset.sceneTourControl = '';
    tools.append(stillButton);
  }
  render('ready');

  function render(next: TourState) {
    if (next === 'playing' || next === 'finished') {
      const still = next === 'finished' ? mediaAssets[config.key + '-end-poster'] : video.poster;
      film.style.setProperty('--scene-tour-still', `url("${still}")`);
    }
    state = next;
    scene.dataset.sceneTour = next;
    if (isYudu) scene.dataset.riverTour = next;
    film.hidden = next === 'ready' || next === 'unavailable';
    tools.classList.toggle('film-controls', !film.hidden);
    caption.hidden = film.hidden;
    controlButton.classList.toggle('primary', next === 'ready');
    if (stillButton) stillButton.hidden = next !== 'finished';
    if (next === 'ready') {
      controlButton.classList.remove('icon-button');
      controlButton.removeAttribute('aria-label');
      controlButton.removeAttribute('title');
      setButtonContent(controlButton, config.start, 'play');
    } else {
      const action = next === 'playing' ? '暂停' : next === 'paused' ? '继续播放' : next === 'finished' ? '重播' : '重试';
      const label = action + config.short;
      setIconButton(controlButton, label, next === 'playing' ? 'pause' : next === 'finished' ? 'reset' : 'play');
    }
    soundscape.setVideoDuck(next === 'playing' && !video.muted && !video.paused);
  }

  function updateCaption(time: number) {
    const text = cues.find(cue => time < cue.until)?.text ?? cues.at(-1)?.text ?? '';
    if (caption.textContent !== text) caption.textContent = text;
  }

  async function play() {
    if (signal.aborted) return;
    const attempt = ++playback;
    if (video.error) video.load();
    if (state !== 'paused') video.currentTime = 0;
    render('playing');
    updateCaption(video.currentTime);
    try {
      try {
        await video.play();
      } catch (error) {
        if (signal.aborted || attempt !== playback) return;
        if (!(error instanceof DOMException) || error.name !== 'NotAllowedError' || video.muted) throw error;
        soundscape.setMuted(true);
        await video.play();
      }
      if (attempt === playback && !signal.aborted) render('playing');
    } catch {
      if (attempt === playback && !signal.aborted) render('unavailable');
    }
  }

  function pause() {
    if (state !== 'playing') return;
    ++playback;
    video.pause();
    render('paused');
  }

  if (typeof video.requestVideoFrameCallback === 'function') {
    const onFrame: VideoFrameRequestCallback = (_, {mediaTime}) => {
      updateCaption(mediaTime);
      frame = video.requestVideoFrameCallback(onFrame);
    };
    let frame = video.requestVideoFrameCallback(onFrame);
    signal.addEventListener('abort', () => video.cancelVideoFrameCallback(frame), { once: true });
  } else {
    video.addEventListener('timeupdate', () => updateCaption(video.currentTime), { signal });
  }
  video.addEventListener('seeked', () => updateCaption(video.currentTime), { signal });
  video.addEventListener('ended', () => {
    if (state !== 'playing' || !video.ended) return;
    updateCaption(video.duration);
    render('finished');
    if (!onEnded) return;
    let frame: SceneTourEnd['frame'] = video;
    if (!reducedMotion.matches && video.videoWidth && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      const still = element('canvas');
      still.width = video.videoWidth;
      still.height = video.videoHeight;
      const brush = still.getContext('2d');
      if (brush) {
        brush.drawImage(video,0,0);
        film.replaceChildren(still);
        frame = still;
      }
    }
    onEnded({layer: film, frame, aspect: video.videoWidth / video.videoHeight});
  }, { signal });
  video.addEventListener('error', () => {
    if (state !== 'ready') render('unavailable');
  }, { signal });
  const stopListening = soundscape.onMuteChange(muted => {
    video.muted = muted;
    soundscape.setVideoDuck(state === 'playing' && !video.paused && !muted);
  });
  signal.addEventListener('abort', () => {
    video.pause();
    stopListening();
    soundscape.setVideoDuck(false);
  }, { once: true });
  return { pause, caption };
}

async function playSceneTourExit({layer, frame, aspect}: SceneTourEnd,
  stage: HTMLElement, destination: HTMLImageElement, signal: AbortSignal) {
  if (reducedMotion.matches) return;
  layer.classList.add('outgoing-image');
  layer.setAttribute('aria-hidden','true');
  stage.append(layer);
  const box = layer.getBoundingClientRect();
  const scale = getComputedStyle(frame).objectFit === 'contain' && box.width && aspect
    ? Math.max(1, aspect * box.height / box.width) : 1;
  let crop: Animation | undefined;
  const cancelCrop = () => crop?.cancel();
  signal.addEventListener('abort',cancelCrop,{once:true});
  try {
    await destination.decode().catch(() => {});
    if (scale > 1 && !signal.aborted) {
      frame.style.willChange = 'transform';
      await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      if (signal.aborted) return;
      crop = frame.animate(
        [{transform:'scale(1)'},{transform:`scale(${scale})`}],
        {duration:360,easing:motionEasing,fill:'forwards'},
      );
      await crop.finished.catch(() => {});
    }
    if (!signal.aborted) await animatePart(layer,[{opacity:1},{opacity:0}],180)?.finished.catch(() => {});
  } finally {
    cancelCrop();
    signal.removeEventListener('abort',cancelCrop);
    layer.remove();
  }
}

function mountExplorationPage({ id, scene, stage, tools, bottom, pauseMedia, backdrop, openDesk }: {
  id: ExplorationId; scene: HTMLElement; stage: HTMLElement;
  tools: HTMLElement; bottom: HTMLElement; pauseMedia: () => void;
  backdrop?: { key: string; image: HTMLImageElement };
  openDesk?: () => void;
}) {
  const labels = explorationLabels[id];
  const withTour = id === 'yudu-river';
  const activity = () => explorationActivity ??= explorationStage.createExploration({
    assets: mediaAssets, riverExplorationOnly: true,
  });
  let surface: 'static' | 'loading' | 'exploration' = 'static';
  let request = 0;
  const status = element('p', 'exploration-load-status');
  status.setAttribute('role', 'status');
  status.hidden = true;
  (withTour ? bottom : scene).append(status);

  const header = scene.querySelector<HTMLElement>('.scene-head');
  const identity = header?.querySelector<HTMLElement>('.scene-identity');
  const next = bottom.querySelector<HTMLElement>('[data-lesson-action=next]');
  function positionDock() {
    const frame = stage.getBoundingClientRect();
    {
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
    if (id === 'zunyi-hall' && surface === 'exploration') {
      const clues = explorationStage.hallClues(explorationActivity?.read() ?? null);
      if (clues.length) {
        retainedHallClues = clues;
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

  const toggle = control(labels.enter, () => {
    if (surface === 'static') {
      pauseMedia();
      void show(activity().open(id, stage));
    } else {
      close();
      toggle?.focus({preventScroll: true});
    }
  }, withTour ? 'primary' : '', 'compass');
  if (withTour) toggle.dataset.sceneTourEntry = '';
  if (id === 'yudu-river') toggle.dataset.riverEntry = '';
  const reset = control(labels.reset, () => {
    if (id === 'yudu-river') explorationActivity?.home();
    else explorationActivity?.restart();
  }, '', 'reset');
  const desk = openDesk ? lessonControl('hall-desk','会议桌',() => {
    if (surface === 'exploration') openDesk();
  },'journey-control','layers') : undefined;
  if (desk) {
    desk.hidden = true;
    tools.prepend(desk);
  }
  if (toggle && reset) {
    reset.hidden = true;
    const playback = withTour ? tools.querySelector('[data-scene-tour-control]') : null;
    if (playback) playback.after(toggle, reset);
    else tools.prepend(toggle, reset);
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
    if (withTour) {
      toggle.disabled = surface === 'loading';
      toggle.classList.toggle('primary', surface === 'static');
    }
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
      if (withTour) pauseMedia();
      stopCinemagraphs();
      surface = 'exploration';
      visitedExplorations.add(id);
      scene.dataset.exploration = id;
      status.hidden = true;
      syncButtons();
      positionDock();
      {
        if (id === 'yudu-river') soundscape.setScene('yudu', 0.6);
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
  releaseCurrentExploration = () => {
    close(false);
    dockSize.disconnect();
  };
}

window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  releaseExplorationPage();
  explorationActivity?.dispose();
  explorationActivity = undefined;
});
