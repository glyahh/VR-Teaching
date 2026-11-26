type LessonMode = 'lesson' | 'revisit';
type Point = [number, number];
type IconName = 'plus'|'minus'|'reset'|'play'|'pause'|'image'|'check'|'info'|'arrowLeft'|'arrowRight'|'expand'|'compress'|'compass'|'layers'|'sliders'|'moveHorizontal'|'map'|'screens'|'soundOn'|'soundOff';

const app = document.querySelector<HTMLElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
const closeDialog = document.querySelector<HTMLButtonElement>('#close-dialog')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const places: [string, number, number][] = [
  ['贵州',106.37,26.22],['湖南',112.15,28.3],['江西',116.6,27.35],['广西',109.2,24.58],['广东',114.1,24.54],
];
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
  sliders: ['M4 21v-7','M4 10V3','M12 21v-9','M12 8V3','M20 21v-5','M20 12V3','M1 14h6','M9 8h6','M17 16h6'],
  moveHorizontal: ['M18 8l4 4-4 4','M6 8l-4 4 4 4','M2 12h20'],
  map: ['M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2V6z', 'M9 4v14', 'M15 6v14'],
  screens: ['M9 4h12v11h-5', 'M3 9h12v11H3z'],
  soundOn: ['M11 5L6 9H3v6h3l5 4V5z', 'M15.5 8.5a5 5 0 0 1 0 7', 'M18.5 5.5a9 9 0 0 1 0 13'],
  soundOff: ['M11 5L6 9H3v6h3l5 4V5z', 'M22 9l-6 6', 'M16 9l6 6'],
};
const revealed = new Set<string>();
const chapterPages = events.flatMap((event, chapter) => event.pages.map(page => ({event, chapter, page})));
const chapterStarts = events.map(event => chapterPages.findIndex(entry => entry.event.id === event.id));
const lastViewed = new Map<number, number>();
const reviewSteps = new Set<number>();
let reviewAnswer = false;
let selected = 0;
let mapResize: ResizeObserver | undefined;
let zoom = 1;
let pan: Point = [0,0];
let mapAngle: TerrainAngle = mapHomeAngle;
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
  soundscape.onMuteChange(update);
  return button;
}

function sceneSoundOf(eventId: string, page: LessonPage): SoundScene {
  if (page.activity === 'materials') return 'desk';
  if (page.image === 'wujiang') return 'wujiang';
  if (eventId === 'yudu') return 'yudu';
  if (eventId === 'xiang') return 'xiang';
  if (eventId === 'liping') return 'liping';
  return 'zunyi-room';
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

function chapterNav(current: number, jump: (index: number) => void) {
  const nav = element('nav','chapter-nav chapter-rail');
  nav.setAttribute('aria-label','章节导航');
  events.forEach((event, index) => {
    const button = lessonControl('chapter-'+index,event.name, () => jump(index),'chapter-link');
    if (index === current) button.setAttribute('aria-current','step');
    nav.append(button);
  });
  return nav;
}

function openReview(conclusionPage = false) {
  releaseSceneLesson();
  disposePageEntry();
  releaseExplorationPage();
  releaseDesk();
  releaseDeskPrewarm();
  releaseRecap();
  releaseOpeningOverlay();
  currentPractice = undefined;
  activeSceneCue = undefined;
  currentVideo = undefined;
  onStageDismiss = undefined;
  stopMotion();
  stopCinemagraphs();
  mapResize?.disconnect();
  soundscape.setVideoDuck(false);
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

let updateMapSelection: (focus?: 'pin'|'timeline') => void;
function select(index: number, focus?: 'pin'|'timeline') {
  selected = index;
  updateMapSelection(focus);
}
function renderMap(restoreFocus = false) {
  releaseSceneLesson();
  disposePageEntry();
  releaseMapCard?.();
  releaseMapCard = undefined;
  releaseExplorationPage();
  releaseDesk();
  releaseDeskPrewarm();
  releaseRecap();
  releaseOpeningOverlay();
  currentPractice = undefined;
  activeSceneCue = undefined;
  currentVideo = undefined;
  onStageDismiss = undefined;
  stopMotion();
  stopCinemagraphs();
  mapResize?.disconnect();
  soundscape.setVideoDuck(false);
  soundscape.setScene('map', 0.8);
  const shell = element('section','shell');
  const header = element('header','top');
  const actions = element('div','top-actions');
  actions.append(lessonControl('review','课堂回顾',()=>openReview()));
  actions.append(soundButton(),fullscreenButton());
  header.append(element('h1','course-title','从于都到遵义'),actions);
  const map = element('section','map');
  map.setAttribute('aria-label','长征阶段地图');
  const world = element('div','map-world');
  const terrain = createTerrainSurface(()=>moveCamera());
  world.append(terrain.element);
  map.append(world);
  const geoLabels: { node: HTMLElement; point: Point }[] = places.map(([label,lon,lat])=>{
    const node = element('span','place',label);
    world.append(node);
    return {node,point:position([lon,lat])};
  });
  const routeDiagram = document.createElementNS(svgNamespace,'svg');
  routeDiagram.setAttribute('class','map-route');
  routeDiagram.setAttribute('viewBox','0 0 100 100');
  routeDiagram.setAttribute('preserveAspectRatio','none');
  routeDiagram.setAttribute('aria-hidden','true');
  const segmentPoints = route.slice(1).map((point,index)=>{
    const [x,y] = position(route[index]);
    const [tx,ty] = position(point);
    return Array.from({length:17},(_,step):Point=>[x+(tx-x)*step/16,y+(ty-y)*step/16]);
  });
  const segments = segmentPoints.map(()=>diagramPath('','route'));
  routeDiagram.append(...segments);
  world.append(routeDiagram);
  let displayedRouteEnd = events[selected].routeEnd;
  const stationMeta: readonly { short: string; side: 'top-right' | 'bottom' | 'left' | 'top-left' }[] = [
    { short: '于都', side: 'top-right' },
    { short: '湘江', side: 'bottom' },
    { short: '黎平', side: 'left' },
    { short: '遵义', side: 'top-right' },
  ];
  const stationLabels: HTMLElement[] = [];
  const pins = events.map((e,i) => {
    const pt = position(route[e.routeEnd]);
    const node = syncScenePoint('pin-'+i,e.name, () => select(i,'pin'), 'pin');
    geoLabels.push({node,point:pt});
    world.append(node);
    const meta = stationMeta[i];
    if (meta) {
      const label = element('span','map-station-name',meta.short);
      label.dataset.side = meta.side;
      label.setAttribute('aria-hidden','true');
      geoLabels.push({node:label,point:pt});
      world.append(label);
      stationLabels.push(label);
    }
    return node;
  });
  const card = element('article','event-card');
  const thumb = photo(events[selected].pages[0].image, events[selected].name);
  const copy = element('div','event-copy');
  const date = element('time');
  const title = element('h2');
  const enterScene = lessonControl('enter-scene','进入场景',()=>openChapter(selected),'','arrowRight',true);
  const start = lessonControl('start','开始授课',()=>{
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
  },'primary','arrowRight',true);
  copy.append(date,title,start,enterScene);
  const preview = element('div','event-preview');
  preview.append(thumb);
  card.append(preview,copy);
  map.append(card);
  const tools = element('div','map-tools');
  const zoomTools = element('div','zoom');
  const zoomOut = control('',()=>changeZoom(zoom / 1.25, undefined, true));
  const zoomReadout = element('span','zoom-readout','100%');
  zoomReadout.setAttribute('aria-live','polite');
  const zoomIn = control('',()=>changeZoom(zoom * 1.25, undefined, true));
  const view = control('',()=>{
    mapAngle = mapAngle[1] === 0 ? mapHomeAngle : [0,0];
    moveCamera(false,true);
  });
  function resetMapCamera() {
    zoom=1;
    pan=[0,0];
    mapAngle=mapHomeAngle;
    resetMapCard?.();
    moveCamera(true,true);
  }
  const resetView = control('',resetMapCamera);
  setIconButton(zoomOut,'缩小地图（快捷键 -）','minus');
  setIconButton(zoomIn,'放大地图（快捷键 +）','plus');
  setIconButton(resetView,'重置地图视角（快捷键 0）','reset');
  zoomTools.append(zoomOut,zoomReadout,zoomIn,view,resetView);
  tools.append(zoomTools);
  const timeline = element('nav','timeline chapter-rail');
  timeline.setAttribute('aria-label','时间轴');
  const times = events.map((e,i) => {
    const node = lessonControl('time-'+i,'',()=>select(i,'timeline'),'time-button chapter-link');
    node.append(element('time','',e.timeline),element('strong','',e.name));
    timeline.append(node);
    return node;
  });
  const mapFooter = element('div','map-footer');
  mapFooter.append(timeline,tools);
  map.append(mapFooter);
  shell.append(header,map);
  app.replaceChildren(shell);
  displayView({kind:'map'});
  releaseMapCard = mountMapCard(map,card,mapFooter);
  let width = 0;
  let height = 0;
  let origin: Point = [0,0];
  function layout() {
    map.style.setProperty('--map-rail-height',mapFooter.offsetHeight+'px');
    const narrow = map.clientWidth <= 720;
    width = Math.max(map.clientWidth * (narrow ? 1.02 : .96), map.clientHeight * (narrow ? .56 : .93) * terrainAspect);
    height = width / terrainAspect;
    origin = narrow
      ? [(map.clientWidth-width)/2, map.clientHeight*.18]
      : [map.clientWidth*.60-width*.52, (map.clientHeight-height)/2];
    world.style.width = width+'px';
    world.style.height = height+'px';
    moveCamera();
  }
  function moveCamera(animate = false, broadcast = false) {
    terrain.orient(mapAngle);
    geoLabels.forEach(({node,point})=>{
      const [x,y] = terrain.project(point);
      node.style.left = x+'%';
      node.style.top = y+'%';
    });
    segments.forEach((path,index)=>{
      const points = segmentPoints[index].map(point=>terrain.project(point).join(' '));
      path.setAttribute('d','M '+points.join(' L '));
    });
    view.hidden = !terrain.ready;
    const label = mapAngle[1] === 0 ? '斜视' : '俯视';
    if (view.getAttribute('aria-label') !== label) setIconButton(view,label,'compass');
    const limitX = map.clientWidth*.28 + width*(zoom-1)/2;
    const limitY = map.clientHeight*.24 + height*(zoom-1)/2;
    pan = [Math.max(-limitX,Math.min(limitX,pan[0])), Math.max(-limitY,Math.min(limitY,pan[1]))];
    world.classList.toggle('ease-camera',animate);
    world.style.transform = `translate(${origin[0]+pan[0]}px, ${origin[1]+pan[1]}px) scale(${zoom})`;
    world.style.setProperty('--inverse-zoom',String(1/zoom));
    zoomOut.disabled = zoom <= .85;
    zoomIn.disabled = zoom >= 2.5;
    zoomReadout.textContent = Math.round(zoom * 100) + '%';
  }
  function changeZoom(next: number, anchor: Point = [map.clientWidth*.65,map.clientHeight*.48], animate = false) {
    const newZoom = Math.max(.85,Math.min(2.5,next));
    const ratio = newZoom/zoom;
    pan = pan.map((offset,axis)=>offset+(anchor[axis]-origin[axis]-offset)*(1-ratio)) as Point;
    zoom = newZoom;
    moveCamera(animate,true);
  }
  mapResize=new ResizeObserver(layout);
  mapResize.observe(map);
  mapResize.observe(mapFooter);
  let drag: {id:number;x:number;y:number;start:Point; orbit:boolean} | undefined;
  map.addEventListener('wheel', e => {
    if ((e.target as Element).closest('.event-card,.map-tools,.timeline')) return;
    e.preventDefault();
    const rect = map.getBoundingClientRect();
    changeZoom(zoom*Math.exp(-Math.sign(e.deltaY)*.12),[e.clientX-rect.left,e.clientY-rect.top],false);
  }, {passive:false});
  map.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button!==0 || (e.target as Element).closest('button,.event-card,.map-tools,.timeline')) return;
    const orbit = terrain.ready && !e.shiftKey;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:orbit ? mapAngle : pan,orbit};
    map.setPointerCapture(e.pointerId);
    map.classList.add('dragging');
  });
  map.addEventListener('pointermove', e => {
    if (!drag || drag.id!==e.pointerId) return;
    const dx = e.clientX-drag.x, dy = e.clientY-drag.y;
    if (drag.orbit) {
      mapAngle=[Math.max(-38,Math.min(38,drag.start[0]+dx*.14)),Math.max(0,Math.min(55,drag.start[1]+dy*.16))];
    } else {
      pan=[drag.start[0]+dx, drag.start[1]+dy];
    }
    moveCamera(false,true);
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) {
    map.addEventListener(type,event=>{
      if ((event as PointerEvent).pointerId!==drag?.id) return;
      drag=undefined;
      map.classList.remove('dragging');
    });
  }
  shell.addEventListener('keydown', ev => {
    if (dialog.open || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === '+' || ev.key === '=') {
      ev.preventDefault();
      changeZoom(zoom * 1.25, undefined, true);
    } else if (ev.key === '-') {
      ev.preventDefault();
      changeZoom(zoom / 1.25, undefined, true);
    } else if (ev.key === '0') {
      ev.preventDefault();
      resetMapCamera();
    }
  });
  updateMapSelection = (focus) => {
    stopMotion();
    const e=events[selected];
    const previousEnd = displayedRouteEnd;
    displayedRouteEnd = e.routeEnd;
    thumb.src=mediaAssets[e.pages[0].image];
    thumb.alt=e.name;
    date.textContent=e.date;
    title.textContent=e.name;
    enterScene.setAttribute('aria-label','进入「'+e.name+'」场景');
    pins.forEach((node,i)=>node.setAttribute('aria-pressed',String(i===selected)));
    stationLabels.forEach((node,i)=>{ node.dataset.active = String(i===selected); });
    times.forEach((node,i)=>node.setAttribute('aria-current',String(i===selected)));
    segments.forEach((node,i)=>node.classList.toggle('past',i<e.routeEnd));
    if (focus) {
      const first = Math.min(previousEnd,e.routeEnd);
      const arriving = segments.slice(first,e.routeEnd);
      const draw = arriving.length ? arriving : segments.slice(Math.max(0,e.routeEnd-1),e.routeEnd);
      draw.forEach((segment,i)=>drawLine(segment,110+i*65,290));
      animatePart(pins[selected],[{outline:'5px solid #f6dca6a0',outlineOffset:'0px'},{outline:'5px solid #f6dca600',outlineOffset:'13px'}],420);
      appear(times[selected].querySelector('strong')!,90,240);
      animatePart(preview,[{opacity:.16},{opacity:1}],330,Math.min(510,220+draw.length*36));
      appear(copy,Math.min(610,320+draw.length*36),265);
      const [x,y] = terrain.project(position(route[e.routeEnd]));
      const targetX = map.clientWidth*(map.clientWidth<=720 ? .5 : .65);
      const targetY = map.clientHeight*(map.clientWidth<=720 ? .33 : .47);
      const focusAmount = Math.max(.14,Math.min(1,(zoom-1)*2));
      pan = [(targetX-origin[0]-width*zoom*x/100)*focusAmount,
        (targetY-origin[1]-height*zoom*y/100)*focusAmount];
      moveCamera(!reducedMotion.matches);
      (focus==='pin'?pins:times)[selected].focus({preventScroll:true});
    }
  };
  updateMapSelection();
  layout();
  pageButtons = {next: start};
  if (restoreFocus) times[selected].focus({preventScroll:true});
  startPageEntry(shell, [[header,'top'],[card,'left'],[mapFooter,'bottom']],thumb);
}
function openChapter(index: number, variant: LessonMode = 'lesson', returnToReview?: () => void) {
  const first = chapterStarts[index];
  openScene(lastViewed.get(index) ?? first, variant, returnToReview);
}

function openDeskPage() {
  const position = chapterPages.findIndex(entry=>entry.page.activity==='materials');
  if (position>=0) openScene(position);
}

function captureMapExit(): HTMLCanvasElement | undefined {
  if (currentView.kind !== 'map' || reducedMotion.matches) return;
  const map = app.querySelector<HTMLElement>('.map');
  const glCanvas = map?.querySelector<HTMLCanvasElement>('.terrain-surface.is-relief canvas');
  if (!map || !glCanvas || !glCanvas.width || !glCanvas.height) return;
  const mapRect = map.getBoundingClientRect();
  const glRect = glCanvas.getBoundingClientRect();
  if (!mapRect.width || !mapRect.height || !glRect.width || !glRect.height) return;
  const shot = element('canvas', 'outgoing-image');
  shot.width = Math.max(1, Math.round(mapRect.width));
  shot.height = Math.max(1, Math.round(mapRect.height));
  shot.setAttribute('aria-hidden', 'true');
  const ctx = shot.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#161f19';
  ctx.fillRect(0, 0, shot.width, shot.height);
  try {
    ctx.drawImage(glCanvas, glRect.left - mapRect.left, glRect.top - mapRect.top, glRect.width, glRect.height);
  } catch {
    return;
  }
  return shot;
}

function renderOpening(autoplay = true) {
  const mapExit = captureMapExit();
  releaseSceneLesson();
  disposePageEntry();
  releaseExplorationPage();
  releaseDesk();
  releaseDeskPrewarm();
  releaseRecap();
  mapResize?.disconnect();
  currentPractice = undefined;
  activeSceneCue = undefined;
  currentVideo = undefined;
  onStageDismiss = undefined;
  stopMotion();
  stopCinemagraphs();
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
  const player = attachVideo({mode:'opening',key:'opening'},'terrain',camera,controls);
  const openingVideo = camera.querySelector<HTMLVideoElement>('video');
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
  if (openingVideo) {
    mountOpeningOverlay(scene, openingVideo);
    openingVideo.addEventListener('ended', () => {
      cancelAutoEntry();
      autoEntry = window.setTimeout(() => {
        if (openingVideo.ended && !openingVideo.seeking) enterClassroom();
      }, 2000);
    });
    openingVideo.addEventListener('play', cancelAutoEntry);
    openingVideo.addEventListener('seeking', cancelAutoEntry);
  }
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
  mapResize = new ResizeObserver(sizeMedia);
  mapResize.observe(stage);
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

function openScene(position: number, variant: LessonMode = 'lesson', returnToReview?: () => void,
  matchedFrame?: HTMLImageElement) {
  const departingPage = currentView.kind === 'scene' ? chapterPages[currentView.position]?.page : null;
  const arriving = chapterPages[position].page;
  const spatial = departingPage ? findSpatialJourney(departingPage.title, arriving.title) : undefined;
  const deskDeparture = arriving.activity === 'materials' && departingPage?.video?.key === 'zunyi'
    ? captureDeskDeparture() : undefined;
  if (arriving.activity !== 'materials') releaseDeskPrewarm();
  const riverHandoff = arriving.image === 'yudu' ? captureExplorationView('yudu-river') : undefined;
  releaseSceneLesson();
  disposePageEntry();
  releaseExplorationPage();
  releaseDesk();
  releaseRecap();
  releaseOpeningOverlay();
  currentPractice = undefined;
  activeSceneCue = undefined;
  currentVideo = undefined;
  onStageDismiss = undefined;
  stopMotion();
  stopCinemagraphs();
  const priorImage = app.querySelector<HTMLImageElement>('.scene-media img');
  const priorChapter = app.querySelector<HTMLElement>('.classroom-slide')?.dataset.chapter;
  mapResize?.disconnect();
  const { event, chapter, page } = chapterPages[position];
  selected = chapter;
  lastViewed.set(chapter,position);
  soundscape.setVideoDuck(false);
  soundscape.setScene(sceneSoundOf(event.id, page), 0.85);

  const liveDesk = page.activity === 'materials';
  const scene = element('section','scene classroom-slide');
  if (liveDesk) scene.classList.add('desk-live-page');
  scene.dataset.chapter = String(chapter);
  if (page.activity) scene.dataset.activity = page.activity;

  const stage = element('div','scene-stage');
  const media = element('div','scene-media');
  const camera = element('div','scene-camera');
  const spotlight = element('div','scene-spotlight');
  spotlight.setAttribute('aria-hidden','true');
  const shade = element('div','scene-shade');
  const picture = matchedFrame ?? (liveDesk ? element('img') : photo(page.image,page.title));
  const captionText = element('div','caption-copy');
  const lesson = currentSceneLesson = mountSceneLesson(scene,captionText,page);
  if (!liveDesk) {
    camera.append(picture,spotlight);
    if (page.video?.mode !== 'loop') attachCinemagraph(page.image, picture);
    media.append(camera,shade);
  }

  const registerDismiss = (fn: () => void) => {
    const prev = onStageDismiss;
    onStageDismiss = () => {
      activeSceneCue = undefined;
      prev?.();
      fn();
    };
  };
  let pauseVideo = () => {};
  const tools = element('div','scene-actions');
  const riverTour = page.exploration === 'yudu-river'
    ? mountRiverTour({scene, stage, tools, signal: lesson.signal})
    : undefined;
  if (riverTour) pauseVideo = riverTour.pause;
  if (page.video) {
    let movieAdvance: HTMLButtonElement | undefined;
    if (page.video.mode === 'transition') {
      const destination = chapterPages[position+1].page;
      const landing = photo(destination.image,destination.title);
      const decoded = landing.decode().then(()=>landing,()=>undefined);
      movieAdvance = lessonControl('clip-next','',async()=>{
        const frame = await decoded;
        if (movieAdvance?.isConnected && currentVideo?.read().mode === 'playing') turn(1,frame);
      });
      movieAdvance.hidden = true;
      tools.append(movieAdvance);
    }
    pauseVideo = attachVideo(page.video,page.image,camera,tools,()=>lesson.dismissPoint(),()=>movieAdvance?.click()).pause;
  }
  if (page.video?.key==='zunyi') {
    camera.append(lessonControl('visit-meeting-desk','进入会议桌实景',()=>{
      pauseVideo();
      openScene(position+1,variant,returnToReview);
    },'desk-scene-link','layers'));
  }

  const leave = ()=>{
    pauseVideo();
    if (returnToReview) returnToReview();
    else renderMap(true);
  };
  const jump = (index: number)=>{
    pauseVideo();
    openChapter(index,variant,returnToReview);
  };
  const heading = element('header','scene-head');
  const identity = element('div','scene-identity');
  const title = element('h1','course-title',page.title);
  title.tabIndex = -1;
  const location = page.title === '猴场会议' ? '贵州瓮安 · 1935 年 1 月 1 日'
    : page.image === 'wujiang' ? '贵州乌江 · 1935 年 1 月初' : event.place+' · '+event.date;
  identity.append(title,element('p','scene-date',location));
  const back = lessonControl('map',returnToReview ? '返回回顾' : '地图',leave,'','arrowLeft');
  if (!returnToReview) setIconButton(back,'地图','map');
  tools.append(soundButton());
  tools.append(fullscreenButton(),back);
  heading.append(identity,tools);

  let practiceFocus = '';
  let showPracticeReference: ((focus: PracticeQuestion['focus']) => void) | undefined;

  function setCamera(fx = 50, fy = 50, scale = 1, spot = false) {
    const tx = Math.min(0, Math.max(100 * (1 - scale), 50 - fx * scale));
    const ty = Math.min(0, Math.max(100 * (1 - scale), 48 - fy * scale));
    camera.style.transform = `translate(${tx}%, ${ty}%) scale(${scale})`;
    spotlight.style.setProperty('--spot-x', fx + '%');
    spotlight.style.setProperty('--spot-y', fy + '%');
    spotlight.classList.toggle('is-active', spot);
  }

  if (page.camera) {
    setCamera(page.camera.x, page.camera.y, page.camera.scale, true);
  }

  for (const probe of page.probes ?? []) {
    addHotspot(`${probe.label}：${probe.title}`, probe.id, [probe.x,probe.y], {
      text: probe.detail,
      enter: () => setCamera(probe.x, probe.y, probe.zoom ?? 1.38, true),
    }, 'probe-pin');
  }

  // ---- 2. Bridge structural outlines (浮桥近景) ----
  if (page.activity === 'bridge') {
    const outlines = document.createElementNS(svgNamespace,'svg');
    outlines.setAttribute('class','bridge-outlines');
    outlines.setAttribute('viewBox','0 0 100 100');
    outlines.setAttribute('preserveAspectRatio','none');
    outlines.setAttribute('aria-hidden','true');
    camera.append(outlines);
    const parts: [string,string,Point,string,string][] = [
      ['船体','boat',[28,65],'M 9 42 Q 11 57 32 59 L 57 61 Q 49 78 39 84 Q 13 79 9 54 Z','木船托住桥面。船舷上的纵梁把船和桥板连在一起。'],
      ['桥板','plank',[73,46],'M 41 39 L 97 36 L 99 57 Q 70 49 45 45 Z','木板铺成通道。乡亲们送来的门板和木料就用在桥面上。'],
    ];
    parts.forEach(([label,key,point,shape,text])=>{
      const outline = diagramPath(shape,'bridge-outline');
      outline.dataset.part = key;
      outline.classList.toggle('is-drawn',revealed.has(key));
      outlines.append(outline);
      addHotspot(label,key,point,{
        text,
        enter(animate) {
          practiceFocus = key;
          outline.classList.add('is-drawn');
          setCamera(point[0], point[1], 1.14, true);
          if (animate) drawLine(outline,0,450);
        },
      });
    });
  }

  // ---- 3. Xiang River Crossing In-Scene Overlay (湘江渡口) ----
  if (page.activity === 'crossing') {
    const overlay = element('div','crossing-inscene');
    const svg = document.createElementNS(svgNamespace,'svg');
    svg.setAttribute('viewBox','0 0 100 100');
    svg.setAttribute('preserveAspectRatio','none');
    svg.setAttribute('aria-hidden','true');
    const riverZone = diagramPath('M 18 65 Q 48 56 88 53 L 94 74 Q 52 78 16 86 Z','river-zone');
    const crossingPath = diagramPath('M 14 70 Q 44 59 69 49 L 64 46 M 69 49 L 66 54','crossing-inscene-line');
    svg.append(riverZone, crossingPath);
    overlay.append(
      svg,
      element('span','map-tag tag-xingan','兴安方向'),
      element('span','map-tag tag-quanzhou','全州方向'),
      element('span','map-tag tag-zone','全州—兴安渡江区域 · 突破第四道封锁线'),
      element('span','map-tag tag-guanyang','灌阳方向（战役波及）'),
    );
    const active = revealed.has('crossing');
    overlay.classList.toggle('is-active', active);
    camera.append(overlay);
    addHotspot('标绘渡江区域','crossing',[56,57],{
      text: '中央红军在全州、兴安之间抢渡湘江。灌阳也在战役涉及范围内。红军在这里突破了第四道封锁线。',
      enter(animate) {
        overlay.classList.add('is-active');
        setCamera(54, 58, 1.15, true);
        if (animate) drawLine(crossingPath, 0, 520);
      },
    });
  }

  if (page.activity === 'troops') {
    const approach = photo('xiang-ford');
    approach.className = 'story-shot';
    spotlight.before(approach);
    const returnToBank = lessonControl('xiang-reflect', '回望渡口', () => {
      if (!lesson.dismissPoint()) lesson.explain('xiang-reflection');
    }, 'journey-control');
    lesson.addCue('xiang-reflection', {
      text: '有人留在险处，把过江的时间让给战友。渡江以后，红军要带着这些教训继续往前走。',
      enter() {
        approach.classList.add('is-current');
        returnToBank.setAttribute('aria-pressed','true');
        setButtonContent(returnToBank,'回到岸上');
        soundscape.playSfx('route');
      },
      leave() {
        approach.classList.remove('is-current');
        returnToBank.setAttribute('aria-pressed','false');
        setButtonContent(returnToBank,'回望渡口');
      },
    });
    returnToBank.setAttribute('aria-pressed','false');
    const records = lessonControl('xiang-records','查兵力记录', () => {
      const dates = element('dl','xiang-records');
      for (const {date,label,amount} of troopRecords) {
        const row = element('div');
        row.append(element('dt','',date+' · '+label),element('dd','',amount));
        dates.append(row);
      }
      modal('长征出发与渡过湘江后的兵力', dates,
        element('p','','两组数字跨越从出发到渡江后的整段行程。其间的累计减员包含湘江战役前的损失。'),
        element('p','xiang-record-source','出处：国防部《中国共产党领导红军主力开始长征》'));
    },'journey-control');
    tools.prepend(returnToBank, records);
  }

  // ---- 5. Liping Tabletop Perspective Map (进军方向) ----
  if (page.activity === 'directions') {
    const paper = element('div','tabletop-paper');
    const svg = document.createElementNS(svgNamespace,'svg');
    svg.setAttribute('viewBox','0 0 100 100');
    svg.setAttribute('preserveAspectRatio','none');
    svg.setAttribute('aria-hidden','true');
    const eastLine = diagramPath('M 50 84 Q 65 73 82 26 L 76 30 M 82 26 L 84 34','paper-line east');
    const westLine = diagramPath('M 50 84 Q 35 73 19 26 L 17 34 M 19 26 L 25 30','paper-line west');
    svg.append(eastLine, westLine);
    const guideEast = diagramPath('M 50 84 Q 65 73 82 26','paper-guide');
    const guideWest = diagramPath('M 50 84 Q 35 73 19 26','paper-guide');
    svg.append(guideEast,guideWest);
    const marker = element('button','march-marker');
    marker.type = 'button';
    marker.append(element('span','march-marker-arrow'));
    marker.setAttribute('role','slider');
    marker.setAttribute('aria-label','行军标记');
    marker.setAttribute('aria-valuemin','-100');
    marker.setAttribute('aria-valuemax','100');

    const originNode = element('span','paper-node origin','黎平');
    const eastNode = element('span','paper-node east');
    eastNode.innerHTML = '<em>原计划</em><strong>湘西北（险）</strong>';
    const westNode = element('span','paper-node west');
    westNode.innerHTML = '<em>会议决定</em><strong>贵州北部</strong>';

    let comparing = false;
    function paintRoutes() {
      const east = comparing || revealed.has('direction-east');
      const west = comparing || revealed.has('direction-west');
      eastLine.classList.toggle('is-drawn',east);
      westLine.classList.toggle('is-drawn',west);
      eastNode.hidden = !east;
      westNode.hidden = !west;
    }
    showPracticeReference = cue=>{
      comparing = cue === 'routes';
      paintRoutes();
    };
    paintRoutes();

    paper.append(svg, originNode, eastNode, westNode,marker);
    camera.append(paper);

    const deck = element('div','tabletop-deck');
    lesson.addCue('direction-east', {text: '原计划去湘西北与红二、红六军团会合，沿途有敌军重兵堵截。'});
    lesson.addCue('direction-west', {text: '会议决定转向敌军力量较弱的贵州北部，争取主动。'});
    lesson.addCue('directions-both', {text: '原计划北上会合，黎平会议决定改向贵州北部。'});
    const directionNote = (key: string) => lesson.explain(
      revealed.has('direction-west') && revealed.has('direction-east') ? 'directions-both' : key);
    const btnEast = lessonControl('direction-east','推演原计划 · 湘西北',()=>{
      revealed.add('direction-east');
      updateMarch(100);
      paintRoutes();
      btnEast.setAttribute('aria-pressed','true');
      btnWest.setAttribute('aria-pressed','false');
      drawLine(eastLine,0,480);
      appear(eastNode,350,240);
      directionNote('direction-east');
    },'deck-btn','compass');
    const btnWest = lessonControl('direction-west','推演新方向 · 贵州北部',()=>{
      revealed.add('direction-west');
      updateMarch(-100);
      paintRoutes();
      btnWest.setAttribute('aria-pressed','true');
      btnEast.setAttribute('aria-pressed','false');
      drawLine(westLine,0,480);
      appear(westNode,350,240);
      directionNote('direction-west');
    },'deck-btn is-gold','compass');
    btnEast.setAttribute('aria-pressed', String(routeOffset > 0));
    btnWest.setAttribute('aria-pressed', String(routeOffset < 0));
    deck.append(btnEast,btnWest);
    stage.append(deck);

    function updateMarch(progress: number, broadcast = false) {
      routeOffset = Math.round(Math.max(-100, Math.min(100,progress)));
      const east = routeOffset > 0;
      const direction = east ? '原计划 · 湘西北' : '会议决定 · 黔北';
      marker.setAttribute('aria-valuenow',String(routeOffset));
      marker.setAttribute('aria-valuetext',routeOffset ? direction : '黎平');
      if (routeOffset) revealed.add(east ? 'direction-east' : 'direction-west');
      paintRoutes();
      const guide = east ? guideEast : guideWest;
      const track = guide.getTotalLength();
      const step = guide.getPointAtLength(track*Math.abs(routeOffset)/100);
      marker.style.left = step.x + '%';
      marker.style.top = step.y + '%';
      marker.dataset.side = routeOffset === 0 ? 'origin' : east ? 'east' : 'west';
    }
    updateMarch(routeOffset);

    {
      let pointer: {id:number, x:number, initial:number, span:number} | undefined;
      marker.addEventListener('pointerdown',event=>{
        if (!event.isPrimary || event.button!==0) return;
        pointer = {id:event.pointerId, x:event.clientX, initial:routeOffset, span:Math.max(52,paper.getBoundingClientRect().width*.32)};
        marker.setPointerCapture(event.pointerId);
      });
      marker.addEventListener('pointermove',event=>{
        if (pointer?.id === event.pointerId) updateMarch(pointer.initial+(event.clientX-pointer.x)*100/pointer.span,true);
      });
      for (const name of ['pointerup','pointercancel','lostpointercapture']) {
        marker.addEventListener(name,event=>{ if ((event as PointerEvent).pointerId===pointer?.id) pointer=undefined; });
      }
      marker.addEventListener('keydown',event=>{
        const values: Record<string,number> = {ArrowLeft:routeOffset-10, ArrowRight:routeOffset+10, Home:0};
        if (!Object.hasOwn(values,event.key)) return;
        event.preventDefault();
        updateMarch(values[event.key],true);
      });
    }
    registerDismiss(()=>{
      btnEast.setAttribute('aria-pressed', 'false');
      btnWest.setAttribute('aria-pressed', 'false');
    });
  }

  if (liveDesk) {
    currentDesk = mountDesk(stage,position,deskDeparture);
    registerDismiss(()=>currentDesk?.dismiss());
  }

  if (page.activity === 'wujiang-view') mountWujiangView(stage,tools,near=>{
    if (near) setCamera(59,73,1.32,true);
    else setCamera();
  });

  if (page.activity === 'military' || page.activity === 'result') {
    lesson.mountItems(stage,page,mountStoryShots(camera,spotlight,page.steps));
  }
  if (page.activity === 'organization') {
    const showFolder = mountOrganizationFolder(stage,()=>selectItem(page.steps[0].id));
    const selectItem = lesson.mountItems(stage,page,showFolder);
  }
  if (page.activity === 'houchang') {
    const showStop = mountHouchangMap(stage,page.steps,step=>lesson.explain(step.id));
    for (const step of page.steps) lesson.addCue(step.id,{
      text: step.detail,
      enter() {
        activeSceneCue = step.id;
        revealed.add(step.id);
        showStop(step.id);
      },
      leave() {
        activeSceneCue = undefined;
        showStop();
      },
    });
  }

  const navigation = element('div','scene-navigation');
  const previous = lessonControl('previous','上一页',()=>turn(-1),'','arrowLeft');
  setIconButton(previous,'上一页','arrowLeft');
  const finalPage = position === chapterPages.length-1;
  const lastInChapter = chapterPages[position+1]?.chapter !== chapter;
  previous.disabled = variant !== 'lesson' && position === chapterStarts[chapter];
  const nextLabel = variant === 'revisit' && lastInChapter ? '返回回顾'
    : finalPage ? '课堂回顾' : '下一页';
  const next = lessonControl('next',nextLabel,()=>turn(1),'primary','arrowRight',true);
  if (nextLabel === '下一页') setIconButton(next,nextLabel,'arrowRight');
  navigation.append(previous);
  navigation.append(next);

  if (liveDesk) {
    stage.setAttribute('aria-label','遵义会议桌实景');
  } else {
    stage.append(media);
  }

  const bottom = element('section','slide-caption');
  const footer = element('footer','lesson-footer');
  const caption = liveDesk && currentDesk ? currentDesk.transport : captionText;
  bottom.append(caption);
  if (page.practice) {
    currentPractice = mountPractice(page.practice,scene,caption,()=>practiceFocus,showPracticeReference);
    bottom.append(currentPractice.panel);
    navigation.insertBefore(currentPractice.entry,next);
  }
  bottom.append(navigation);
  if (riverTour) footer.append(riverTour.caption);
  footer.append(bottom);
  if (variant === 'lesson') footer.append(chapterNav(chapter,jump));
  scene.append(stage, heading, footer);
  app.replaceChildren(scene);
  syncCinemagraphReading();
  if (page.exploration) {
    const backdrop = page.video?.mode === 'loop' ? undefined : {key: page.image, image: picture};
    const openDesk = page.exploration === 'zunyi-hall' && chapterPages[position+1]?.page.activity === 'materials'
      ? () => openScene(position+1,variant,returnToReview)
      : undefined;
    mountExplorationPage({id: page.exploration, scene, stage, tools, bottom:footer,
      pauseMedia: pauseVideo, backdrop, openDesk});
  }
  displayView({kind:'scene',position,variant});

  const sizeMedia = ()=>{
    media.style.width = Math.max(stage.clientWidth,stage.clientHeight*16/9)+'px';
    const clearance = footer.offsetHeight ? stage.getBoundingClientRect().bottom - footer.getBoundingClientRect().top : 0;
    stage.style.setProperty('--story-bottom',Math.max(16,clearance + 12)+'px');
  };
  if (!liveDesk) {
    mapResize = new ResizeObserver(sizeMedia);
    mapResize.observe(stage);
    mapResize.observe(footer);
    sizeMedia();
  }
  pageButtons = {previous,next};
  title.focus({preventScroll:true});
  if (riverHandoff) playRiverExit(scene,riverHandoff);
  else if (!spatial && !matchedFrame && !liveDesk && priorImage?.complete && priorImage.naturalWidth && priorImage.getAttribute('src') !== picture.getAttribute('src') && !reducedMotion.matches) {
    const old = element('img','outgoing-image');
    old.src = priorImage.src;
    old.alt = '';
    old.setAttribute('aria-hidden','true');
    spotlight.before(old);
    const fade = animatePart(old,[{opacity:1},{opacity:0}],380);
    const remove = ()=>old.remove();
    if (fade) fade.finished.then(remove,remove);
    else remove();
  } else if (!spatial && !matchedFrame && !liveDesk && priorImage?.getAttribute('src') !== picture.getAttribute('src')) {
    animatePart(picture,[{opacity:.62},{opacity:1}],340);
  }
  if (!liveDesk) {
    camera.querySelectorAll('.hotspot,.probe-pin').forEach((spot,index)=>appear(spot,220+index*75,260));
    const activeChapter = footer.querySelector('[aria-current="step"]');
    if (activeChapter && priorChapter !== String(chapter)) {
      animatePart(activeChapter,[{backgroundColor:'#e8c48552'},{backgroundColor:'#e8c48514'}],380,220);
    }
  }
  const entranceImage = liveDesk ? stage.querySelector<HTMLImageElement>('.desk-live-still') ?? undefined : picture;
  lesson.enter(journey => {
    const finished = journey && playSpatialJourney(scene, journey, lesson.signal);
    startPageEntry(scene, [[identity,'left'],[tools,'right'],[footer,'bottom']],entranceImage,
      {after: finished, onLayoutReady: () => {
        lesson.start();
        if (page.video?.key === 'zunyi') prewarmDesk(stage,position+1);
      }});
  }, spatial && !reducedMotion.matches ? { id: spatial, startedAt: sceneNow() } : undefined);

  function addHotspot(label: string, key: string, [x,y]: Point, cue: Pick<SceneCue,'text'|'enter'>, className = 'hotspot') {
    const spot = explorationStage.markScenePoint(control('',()=>lesson.explain(key),className),label);
    lesson.addCue(key,{
      text: cue.text,
      enter(animate) {
        revealed.add(key);
        spot.dataset.visited = 'true';
        spot.dataset.active = 'true';
        spot.dataset.dismissed = 'true';
        cue.enter?.(animate);
      },
      leave() {
        spot.dataset.active = 'false';
        spot.dataset.dismissed = 'false';
        const {x = 50, y = 50, scale = 1} = page.camera ?? {};
        setCamera(x,y,scale,!!page.camera);
      },
    });
    spot.style.left = x+'%';
    spot.style.top = y+'%';
    spot.dataset.visited = String(revealed.has(key));
    spot.dataset.active = 'false';
    camera.append(spot);
  }

  function turn(direction: number, frame?: HTMLImageElement) {
    if (direction < 0 && previous.disabled) return;
    pauseVideo();
    if (position+direction < 0 || (direction > 0 && variant === 'revisit' && lastInChapter)) leave();
    else if (direction > 0 && finalPage) openReview();
    else openScene(position+direction,variant,returnToReview,frame);
  }
}

function attachVideo(clip: LessonClip, image: string, media: HTMLElement, tools: HTMLElement,
  align?: () => void, advance?: () => void) {
  const background = clip.mode === 'loop';
  const video = element('video');
  video.src = mediaAssets[clip.key+'-video'];
  video.poster = mediaAssets[image];
  video.preload = 'auto';
  video.muted = clip.mode !== 'opening';
  video.playsInline = true;
  video.loop = background;
  video.hidden = true;
  media.querySelector('.scene-spotlight')!.before(video);
  let generation = 0;
  let intent: VideoState = {mode:'static',time:0};
  let posterFade: Animation | undefined;
  const startLabel = clip.mode === 'transition' ? '播放备桥短片' : '播放短片';
  const cutLabel = clip.mode === 'transition' ? element('span','scene-shot-label',clip.caption.text) : undefined;
  if (cutLabel && clip.mode === 'transition') {
    cutLabel.hidden = true;
    media.append(cutLabel);
    const {start,end} = clip.caption;
    video.addEventListener('timeupdate',()=>{
      cutLabel.hidden = video.hidden || video.currentTime < start || video.currentTime >= end;
    });
  }
  function targetTimeOf(state: VideoState) {
    if (state.mode !== 'playing' || typeof state.at !== 'number' || !Number.isFinite(state.at)) return state.time;
    const raw = state.time + Math.max(0, (sceneNow() - state.at) / 1000);
    if (Number.isFinite(video.duration) && video.duration > 0) {
      return background ? raw % video.duration : Math.min(video.duration, raw);
    }
    return raw;
  }
  function waitMediaEvent(name: 'loadeddata' | 'seeked', timeoutMs = 350) {
    return new Promise<void>(resolve => {
      const done = () => {
        clearTimeout(timer);
        video.removeEventListener(name, done);
        video.removeEventListener('error', done);
        resolve();
      };
      const timer = window.setTimeout(done, timeoutMs);
      video.addEventListener(name, done, { once: true });
      video.addEventListener('error', done, { once: true });
    });
  }
  const play = background ? undefined : control('',()=>{
    const playing = !(intent.mode === 'playing' && !video.ended);
    const time = intent.mode === 'static' || video.hidden || video.ended ? 0 : video.currentTime;
    const state: VideoState = playing ? {mode:'playing',time,at:sceneNow()} : {mode:'paused',time};
    void setVideo(state);
  });
  async function setVideo(state: VideoState) {
    if (background && reducedMotion.matches) state = {mode:'static',time:0};
    const request = ++generation;
    intent = state;
    video.playbackRate = 1;
    if (state.mode === 'static') { showPoster(clip.key === 'xiang'); return; }
    if (posterFade) {
      video.hidden = true;
      video.classList.remove('is-visible');
      posterFade.cancel();
      posterFade = undefined;
    }
    const entering = video.hidden;
    if (still) still.disabled = false;
    if (play) {
      if (clip.mode === 'transition') {
        play.classList.remove('icon-button');
        setButtonContent(play, state.mode === 'paused' ? '继续播放' : '暂停短片', state.mode === 'paused' ? 'play' : 'pause');
      } else {
        setIconButton(play,state.mode === 'paused' ? '继续播放' : '暂停短片',state.mode === 'paused' ? 'play' : 'pause');
      }
    }
    if (clip.mode === 'opening') soundscape.setVideoDuck(state.mode === 'playing');
    if (entering && clip.mode === 'transition') {
      align?.();
      getComputedStyle(media).transform;
      await Promise.allSettled(media.getAnimations().map(animation=>animation.finished));
      if (request !== generation || !video.isConnected) return;
    }
    video.hidden = false;
    if (state.mode === 'paused') {
      video.pause();
      if (entering && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        await waitMediaEvent('loadeddata', 350);
        if (request !== generation || !video.isConnected) return;
      }
      const needSeek = entering ? video.currentTime !== state.time : Math.abs(video.currentTime - state.time) > .02;
      if (needSeek) {
        const sought = entering ? waitMediaEvent('seeked', 350) : undefined;
        video.currentTime = state.time;
        if (sought) {
          await sought;
          if (request !== generation || !video.isConnected) return;
        }
      }
      video.classList.add('is-visible');
      return;
    }
    try {
      if (entering && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        // The original image stays on screen while the frame decodes.
        await waitMediaEvent('loadeddata', 4000);
        if (request !== generation || !video.isConnected) return;
      }
      const target = targetTimeOf(state);
      const shouldSeek = entering ? Math.abs(video.currentTime - target) > .04 : Math.abs(video.currentTime - target) > .12;
      if (shouldSeek) {
        const sought = entering && target > .04 ? waitMediaEvent('seeked', 350) : undefined;
        video.currentTime = target;
        if (sought) {
          await sought;
          if (request !== generation || !video.isConnected) return;
        }
      }
      if (entering && clip.mode === 'transition') video.classList.add('is-visible');
      await video.play();
      if (request === generation && video.isConnected && !video.hidden && !video.paused) {
        video.classList.add('is-visible');
      }
      if (!video.isConnected) video.pause();
    } catch {
      if (request === generation && video.isConnected) showPoster();
    }
  }
  const still = clip.mode === 'transition' ? control('',()=>{
    const state:VideoState = {mode:'static',time:0};
    void setVideo(state);
  }) : undefined;
  function resumeBackground() {
    if (!background || reducedMotion.matches || !video.isConnected || intent.mode === 'playing' ||
      dialog.open || video.closest('[data-exploration]')) return;
    void setVideo({mode:'playing',time:intent.mode === 'paused' ? intent.time : 0,at:sceneNow()});
  }
  const player = {set: setVideo, read: (): VideoState => {
    const time = video.hidden || intent.mode === 'static' ? intent.time : video.currentTime;
    return intent.mode === 'playing' ? {mode:'playing',time,at:sceneNow()} : {mode:intent.mode,time};
  },
    pause() {
      if (intent.mode !== 'playing') return;
      void setVideo({mode:'paused',time:video.currentTime});
    },
    resumeBackground,
    applyMotionPreference() {
      if (!background || !video.isConnected) return;
      if (reducedMotion.matches) void setVideo({mode:'static',time:0});
      else resumeBackground();
    },
  };
  currentVideo = player;
  video.addEventListener('ended',()=>{
    if (!video.isConnected || !video.ended || intent.mode!=='playing') return;
    if (clip.mode==='transition') advance?.();
    if (clip.mode==='opening') {
      intent = {mode:'paused',time:video.currentTime};
      if (play) setIconButton(play,'重播','reset');
      {
        soundscape.setVideoDuck(false);
      }
    }
  });
  video.addEventListener('error',()=>showPoster());
  if (play) {
    if (clip.mode === 'transition') {
      play.classList.add('primary');
      setButtonContent(play, startLabel, 'play');
    } else {
      setIconButton(play,startLabel,'play');
    }
    tools.append(play);
  }
  if (still) {
    setIconButton(still,'静态画面','image');
    still.disabled = true;
    tools.append(still);
  }
  function showPoster(fade = false) {
    const request = ++generation;
    intent = {mode:'static',time:0};
    video.playbackRate = 1;
    video.pause();
    if (clip.mode === 'opening') soundscape.setVideoDuck(false);
    if (cutLabel) cutLabel.hidden = true;
    if (still) {
      if (document.activeElement === still) play?.focus({preventScroll:true});
      still.disabled = true;
    }
    if (play) {
      if (clip.mode === 'transition') {
        play.classList.remove('icon-button');
        setButtonContent(play, startLabel, 'play');
      } else {
        setIconButton(play,startLabel,'play');
      }
    }
    const finish = () => {
      if (request !== generation) return;
      video.hidden = true;
      video.classList.remove('is-visible');
      posterFade?.cancel();
      posterFade = undefined;
      if (video.readyState) video.currentTime = 0;
    };
    if (fade && !reducedMotion.matches && !video.hidden && video.classList.contains('is-visible')) {
      const opacity = getComputedStyle(video).opacity;
      posterFade?.cancel();
      posterFade = video.animate([{opacity}, {opacity: 0}], {duration: 160, easing: 'ease-out', fill: 'forwards'});
      void posterFade.finished.then(finish, () => {});
    } else finish();
  }
  if (background && !reducedMotion.matches) void setVideo({mode:'playing',time:0,at:sceneNow()});
  return player;
}
