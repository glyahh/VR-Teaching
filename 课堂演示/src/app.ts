type LessonMode = 'lesson' | 'revisit';
type Point = [number, number];
type IconName = 'plus'|'minus'|'reset'|'play'|'pause'|'image'|'check'|'info'|'arrowLeft'|'arrowRight'|'expand'|'compress'|'compass'|'layers'|'map'|'soundOn'|'soundOff';

const app = document.querySelector<HTMLElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
const closeDialog = document.querySelector<HTMLButtonElement>('#close-dialog')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const iconPaths: Record<IconName, string[]> = {
  plus: ['M12 5v14','M5 12h14'],
  minus: ['M5 12h14'],
  reset: ['M3 12a9 9 0 1 0 3-6.7L3 8','M3 3v5h5'],
  play: ['M7 5l12 7-12 7V5z'],
  pause: ['M7 5h3v14H7z','M14 5h3v14h-3z'],
  image: ['M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z','M7 16l3.5-4.5 2.5 3 2-2.5L19 16'],
  check: ['M5 13l4 4L19 7'],
  info: ['M12 16v-4','M12 8h.01','M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z'],
  arrowLeft: ['M15 18l-6-6 6-6'],
  arrowRight: ['M9 18l6-6-6-6'],
  expand: ['M15 3h6v6','M9 21H3v-6','M21 3l-7 7','M3 21l7-7'],
  compress: ['M4 14h6v6','M20 10h-6V4','M14 10l7-7','M3 21l7-7'],
  compass: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z','M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z'],
  layers: ['M12 2l9 4.5-9 4.5-9-4.5L12 2z','M3 12l9 4.5 9-4.5','M3 17.5l9 4.5 9-4.5'],
  map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z', 'M9 4v14', 'M15 6v14'],
  soundOn: ['M11 5L6 9H3v6h3l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
  soundOff: ['M11 5L6 9H3v6h3l5 4V5z', 'M22 9l-6 6', 'M16 9l6 6'],
};
const revealed = new Set<string>();
const chapterPages = events.flatMap((event, chapter) => event.pages.map(page => ({event, chapter, page})));
const chapterStarts = events.map(event => chapterPages.findIndex(entry => entry.event.id === event.id));
const lastViewed = new Map<number, number>();
const reviewSteps = new Set<number>();
let reviewAnswer = false;
let selectedChapter = 0;
let dialogOpener: HTMLElement | null = null;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}
function svgIcon(name: IconName) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of iconPaths[name]) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    svg.append(path);
  }
  return svg;
}
function setButtonContent(button: HTMLButtonElement, label: string, icon?: IconName, iconAfter = false) {
  const nodes: (Node | string)[] = [];
  if (icon && !iconAfter) nodes.push(svgIcon(icon));
  if (label) nodes.push(element('span', '', label));
  if (icon && iconAfter) nodes.push(svgIcon(icon));
  button.replaceChildren(...nodes);
}
function control(label: string, act: () => void, className = '', icon?: IconName, iconAfter = false) {
  const node = element('button', className);
  node.type = 'button';
  if (icon || label) setButtonContent(node, label, icon, iconAfter);
  node.addEventListener('click', act);
  return node;
}
function setIconButton(button: HTMLButtonElement, label: string, icon: IconName) {
  button.classList.add('icon-button');
  button.setAttribute('aria-label',label);
  button.title = label;
  setButtonContent(button,'',icon);
}
function syncScenePoint(id: string, name: string, action: () => void, className: string) {
  return explorationStage.markScenePoint(lessonControl(id, '', action, className), name);
}
function photo(key: string, alt = '') {
  const node = element('img');
  node.src = mediaAssets[key];
  node.alt = alt;
  return node;
}
const svgNamespace = 'http://www.w3.org/2000/svg';
const motionEasing = 'cubic-bezier(.22,1,.36,1)';
const runningMotion = new Set<Animation>();

function stopMotion(scope?: Element) {
  if (!scope) settlePageEntry();
  for (const animation of runningMotion) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (scope && !scope.contains(target ?? null)) continue;
    animation.cancel();
    runningMotion.delete(animation);
  }
}

function animatePart(node: Element, frames: Keyframe[], duration: number, delay = 0, easing = motionEasing) {
  if (reducedMotion.matches || !node.isConnected || typeof node.animate !== 'function') return;
  const animation = node.animate(frames,{duration,delay,easing,fill:'backwards'});
  runningMotion.add(animation);
  const release = ()=>runningMotion.delete(animation);
  animation.finished.then(release,release);
  return animation;
}

function appear(node: Element, delay = 0, duration = 280) {
  animatePart(node,[{opacity:0,translate:'0 9px'},{opacity:1,translate:'0 0'}],duration,delay);
}

function drawLine(node: SVGElement, delay = 0, duration = 290) {
  animatePart(node,[{strokeDasharray:'1 1',strokeDashoffset:1},{strokeDasharray:'1 1',strokeDashoffset:0}],duration,delay);
}

function diagramPath(d: string, className = '') {
  const path = document.createElementNS(svgNamespace,'path');
  path.setAttribute('d',d);
  path.setAttribute('pathLength','1');
  if (className) path.setAttribute('class',className);
  return path;
}

function syncCinemagraphReading() {
  const reading = dialog.open || Boolean(app.querySelector(
    '[data-practicing="true"], [data-reading="true"], .story-panel [aria-expanded="true"], .slide-line[data-narration-view="point"]'
  ));
  setCinemagraphIntensity(reading ? 0.2 : 1);
}
window.addEventListener('lesson-reading', syncCinemagraphReading);
createTerrainSurface(() => {});

reducedMotion.addEventListener('change',event=>{
  if (event.matches) stopMotion();
  setCinemagraphsPaused(event.matches);
  currentVideo?.applyMotionPreference();
});

function modal(title: string, ...nodes: HTMLElement[]) {
  stopMotion();
  if (!dialog.open) {
    dialogOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  document.querySelector('#dialog-title')!.textContent = title;
  document.querySelector('#dialog-content')!.replaceChildren(...nodes);
  if (!dialog.open) dialog.showModal();
  syncCinemagraphReading();
  closeDialog.focus();
}
closeDialog.onclick = () => closeMaterial();
dialog.addEventListener('click', e => {
  if (e.target === dialog) closeMaterial();
});
dialog.addEventListener('cancel',event=>{
  event.preventDefault();
  closeMaterial();
});
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  stopMotion(dialog);
  dialog.classList.remove('comparison');
  if (dialogOpener?.isConnected) dialogOpener.focus({preventScroll:true});
  dialogOpener = null;
  syncCinemagraphReading();
  currentVideo?.resumeBackground();
});

function soundButton() {
  const button = control('', () => {
    soundscape.toggleMuted();
  }, 'sound-toggle');
  const update = (isMuted: boolean) => {
    setIconButton(button, isMuted ? '开启环境声' : '静音环境声', isMuted ? 'soundOff' : 'soundOn');
    button.setAttribute('aria-pressed', String(isMuted));
  };
  update(soundscape.isMuted());
  releasePageSound = soundscape.onMuteChange(update);
  return button;
}

function fullscreenButton() {
  const button = control('', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      modal('全屏不可用', element('p', '', '可按 F11 切换。'));
    }
  });
  const update = () => {
    const active = Boolean(document.fullscreenElement);
    setIconButton(button, active ? '退出全屏' : '全屏', active ? 'compress' : 'expand');
    button.setAttribute('aria-pressed', String(active));
  };
  update();
  document.onfullscreenchange = update;
  return button;
}
function position([lon,lat]: Point): Point {
  return [(lon-104.5)/14*100, (30.65-lat)/6.8*100];
}
let pageButtons: {previous?: HTMLButtonElement; next?: HTMLButtonElement} = {};
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || dialog.open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === 'Escape' && currentPractice?.close()) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && currentSceneLesson?.dismissPoint()) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && onStageDismiss) {
    event.preventDefault();
    onStageDismiss();
    return;
  }
  if (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable]')) return;
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && (
    (event.target instanceof Element && event.target.closest('.lesson-exploration[data-scene="zunyi-hall"]')) ||
    app.querySelector('.desk-live-page .desk-live-frame[data-inquiry="active"]')
  )) return;
  const button = ['ArrowLeft', 'PageUp'].includes(event.key) ? pageButtons.previous
    : ['ArrowRight', 'PageDown'].includes(event.key) ? pageButtons.next : undefined;
  if (!button?.isConnected) return;
  event.preventDefault();
  if (!event.repeat && !button.disabled) button.click();
});

function openReview(conclusionPage = false) {
  releaseCurrentPage();
  soundscape.setScene('recap', 0.9);
  const shell = element('section','shell review recap-shell');
  const header = element('header','top recap-top');
  const actions = element('div','top-actions');
  actions.append(soundButton());
  actions.append(fullscreenButton(),lessonControl('map','返回地图',()=>renderMap(true),'','arrowLeft'));
  const title = element('h1','course-title',conclusionPage ? '全课结论' : '课堂回顾');
  title.tabIndex = -1;
  header.append(title,actions);
  shell.append(header);

  const { previous, next, footer } = mountRecapStage(shell, conclusionPage, index => {
    openChapter(index,'revisit',()=>{
      openReview(conclusionPage);
    });
  });

  app.replaceChildren(shell);
  displayView({kind:'review',conclusionPage});
  pageButtons = {previous,next};
  title.focus({preventScroll:true});
  startPageEntry(shell, [[title,'left'],[actions,'right'],[footer,'bottom']]);
}

function renderMap(restoreFocus = false) {
  releaseCurrentPage();
  soundscape.setScene('map', 0.8);
  displayView({kind:'map'});
  const map = mountLessonMap({
    root: app,
    chapter: selectedChapter,
    restoreFocus,
    onSelect: index => { selectedChapter = index; },
    onEnter: openChapter,
    onStart: beginLesson,
    onReview: () => openReview(),
  });
  releaseLessonMap = map.dispose;
  pageButtons = {next: map.start};
}

function beginLesson() {
  explorationActivity?.reset();
  revealed.clear();
  lessonItemsSeen.clear();
  reviewSteps.clear();
  reviewAnswer = false;
  recapFocusIndex = null;
  completedPractices.clear();
  visitedExplorations.clear();
  lastViewed.clear();
  routeOffset = 0;
  retainedHallClues = [];
  renderOpening();
}

function openChapter(index: number, variant: LessonMode = 'lesson', returnToReview?: () => void) {
  const first = chapterStarts[index];
  openScene(lastViewed.get(index) ?? first, variant, returnToReview);
}

function openDeskPage() {
  const position = chapterPages.findIndex(entry=>entry.page.activity==='materials');
  if (position>=0) openScene(position);
}

function renderOpening(autoplay = true) {
  const mapExit = currentView.kind === 'map' ? captureMapExit(app) : undefined;
  releaseCurrentPage();
  soundscape.setScene('silent', 0.35);
  const scene = element('section','scene opening-page');
  const stage = element('div','scene-stage');
  const media = element('div','scene-media');
  const camera = element('div','scene-camera');
  const heading = element('header','scene-head');
  const title = element('h1','course-title','从于都到遵义');
  const actions = element('div','scene-actions');
  const controls = element('div','film-controls');
  const landing = photo('yudu-assembly','于都集结');
  void landing.decode().catch(()=>{});
  title.tabIndex = -1;
  const openingPicture = photo('terrain','长征地形总览');
  camera.append(openingPicture,element('div','scene-spotlight'));
  media.append(camera,element('div','scene-shade'));
  stage.append(media);
  const player = currentVideo = attachVideo({mode:'opening',key:'opening'},'terrain',camera,controls);
  const openingVideo = player.element;
  let autoEntry: number | undefined;
  function cancelAutoEntry() {
    window.clearTimeout(autoEntry);
    autoEntry = undefined;
  }
  function enterClassroom() {
    cancelAutoEntry();
    if (!scene.isConnected) return;
    player.pause();
    openScene(0,'lesson',undefined,landing.complete && landing.naturalWidth ? landing : undefined);
  }
  mountOpeningOverlay(scene, openingVideo);
  mountOpeningProgress(scene, openingVideo, time => {
    cancelAutoEntry();
    if (openingVideo.ended && time < openingVideo.duration) {
      void player.set({mode:'paused',time});
    } else {
      openingVideo.currentTime = time;
    }
  });
  openingVideo.addEventListener('ended', () => {
    cancelAutoEntry();
    autoEntry = window.setTimeout(() => {
      if (openingVideo.ended && !openingVideo.seeking) enterClassroom();
    }, 2000);
  });
  openingVideo.addEventListener('play', cancelAutoEntry);
  openingVideo.addEventListener('seeking', cancelAutoEntry);
  const backToMap = lessonControl('map','',()=>{
    cancelAutoEntry();
    player.pause();
    renderMap(true);
  });
  setIconButton(backToMap,'地图','map');
  actions.append(controls,fullscreenButton(),backToMap);
  heading.append(title,actions);
  const next = lessonControl('opening-next','进入课堂',enterClassroom,'primary','arrowRight',true);
  controls.append(next);
  scene.append(stage,heading);
  app.replaceChildren(scene);
  if (mapExit) {
    Object.assign(mapExit.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2' });
    stage.append(mapExit);
    const fade = animatePart(mapExit, [{ opacity: 1 }, { opacity: 0 }], 220);
    const remove = () => mapExit.remove();
    if (fade) fade.finished.then(remove, remove);
    else remove();
  }
  const sizeMedia = ()=>{media.style.width=Math.max(stage.clientWidth,stage.clientHeight*16/9)+'px';};
  pageResize = new ResizeObserver(sizeMedia);
  pageResize.observe(stage);
  sizeMedia();
  pageButtons = {next};
  displayView({kind:'opening'});
  {
    title.focus({preventScroll:true});
    if (autoplay) {
      const state: VideoState = {mode:'playing',time:0,at:sceneNow()};
      void player.set(state);
    }
  }
  startPageEntry(scene, [[title,'left'],[actions,'right']],openingPicture);
}
