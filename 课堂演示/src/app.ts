type LessonMode = 'lesson' | 'trial' | 'revisit';
type Point = [number, number];
type IconName = 'plus'|'minus'|'reset'|'play'|'pause'|'image'|'check'|'info'|'arrowLeft'|'arrowRight'|'expand'|'compress'|'compass'|'layers'|'sliders';

const app = document.querySelector<HTMLElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
const closeDialog = document.querySelector<HTMLButtonElement>('#close-dialog')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const route: Point[] = [[115.41,25.95],[114.94,25.39],[113.95,25.55],[112.95,25.40],
  [110.73,25.83],[109.67,26.16],[109.14,26.23],[107.47,27.32],[106.93,27.69]];
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
function syncScenePoint(id: string, name: string, action: () => void, className: string) {
  return explorationStage.markScenePoint(syncControl(id, '', action, className), name);
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
  for (const animation of runningMotion) {
    const target = (animation.effect as KeyframeEffect | null)?.target;
    if (scope && !scope.contains(target ?? null)) continue;
    animation.cancel();
    runningMotion.delete(animation);
  }
}

function animatePart(node: Element, frames: Keyframe[], duration: number, delay = 0) {
  if (reducedMotion.matches || !node.isConnected || typeof node.animate !== 'function') return;
  const animation = node.animate(frames,{duration,delay,easing:motionEasing,fill:'backwards'});
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

reducedMotion.addEventListener('change',event=>{ if (event.matches) { stopMotion(); stopCinemagraphs(); } });

function modal(title: string, ...nodes: HTMLElement[]) {
  stopMotion();
  if (!dialog.open) {
    dialogOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  document.querySelector('#dialog-title')!.textContent = title;
  document.querySelector('#dialog-content')!.replaceChildren(...nodes);
  if (!dialog.open) dialog.showModal();
  closeDialog.focus();
}
closeDialog.onclick = () => closeMaterial();
dialog.addEventListener('click', e => {
  if (!projectionMode && e.target === dialog) closeMaterial();
});
dialog.addEventListener('cancel',event=>{
  event.preventDefault();
  if (!projectionMode) closeMaterial();
});
dialog.addEventListener('close', () => {
  if (dialog.open) return;
  stopMotion(dialog);
  dialog.classList.remove('comparison');
  if (dialogOpener?.isConnected) dialogOpener.focus({preventScroll:true});
  dialogOpener = null;
});

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
    setButtonContent(button, active ? '退出全屏' : '全屏', active ? 'compress' : 'expand');
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
  if (projectionMode || event.defaultPrevented || dialog.open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  if (event.key === 'Escape' && currentPractice?.close()) {
    event.preventDefault();
    return;
  }
  if (event.key === 'Escape' && onStageDismiss) {
    event.preventDefault();
    if (!currentDesk) sendAction('stage-dismiss');
    onStageDismiss();
    return;
  }
  if (event.target instanceof Element && event.target.closest('input,select,textarea,[contenteditable]')) return;
  if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && event.target instanceof Element &&
    event.target.closest('.lesson-exploration[data-scene="zunyi-hall"]')) return;
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
    const button = syncControl('chapter-'+index,event.name, () => jump(index),'chapter-link');
    if (index === current) button.setAttribute('aria-current','step');
    nav.append(button);
  });
  return nav;
}

function mountStoryRail(label: string, steps: readonly StepItem[], onSelect: (step: StepItem) => void, expandable = false) {
  const list = element('ol','story-rail');
  list.setAttribute('aria-label',label);
  const rows = steps.map(step => {
    const row = element('li','story-stop');
    const button = syncControl(step.id,'',()=>onSelect(step),'story-step');
    if (step.date) button.append(element('time','',step.date));
    button.append(element('strong','',step.title));
    row.append(button);
    const detail = expandable ? element('p','story-detail',step.detail) : undefined;
    if (detail) row.append(detail);
    list.append(row);
    return {id: step.id,row,button,detail};
  });
  return {
    list,
    refresh(showDetails = false) {
      for (const {id,row,button,detail} of rows) {
        row.dataset.revealed = String(revealed.has(id));
        button.setAttribute('aria-pressed',String(activeSceneCue === id));
        if (detail) detail.hidden = !showDetails;
      }
    },
  };
}

function openReview(conclusionPage = false) {
  releaseExplorationPage();
  releaseDesk();
  currentPractice = undefined;
  activeSceneCue = undefined;
  currentVideo = undefined;
  applyScrub = undefined;
  onStageDismiss = undefined;
  stopMotion();
  stopCinemagraphs();
  mapResize?.disconnect();
  const shell = element('section','shell review');
  const header = element('header','top');
  const actions = element('div','top-actions');
  actions.append(fullscreenButton(),syncControl('map','地图',()=>renderMap(true),'','arrowLeft'));
  const title = element('h1','course-title',conclusionPage ? '全课结论' : '课堂回顾');
  title.tabIndex = -1;
  header.append(title,actions);

  const lesson = element('section','review-body');
  const rail = element('ol','story-rail review-rail');
  rail.setAttribute('aria-label','从于都到遵义');
  const heading = element('h2','','遵义会议的历史意义');
  const conclusion = element('p','review-conclusion',lessonConclusion);
  conclusion.hidden = !reviewAnswer;
  conclusion.setAttribute('aria-live','polite');
  events.forEach((event, index) => {
    const row = element('li','story-stop review-stop');
    const detail = element('p','story-detail review-step',event.review);
    detail.hidden = !(conclusionPage || reviewSteps.has(index));
    detail.setAttribute('aria-live','polite');
    const label = element('span','review-label');
    label.append(element('time','',event.timeline),element('strong','',event.name));
    const image = photo(event.id === 'liping' ? event.pages[0].image : event.id);
    if (conclusionPage) {
      const summary = element('div','story-step review-choice');
      summary.append(label,image);
      row.append(summary);
    } else {
      const choice = syncControl('review-step-'+index,'',()=>{
        if (reviewSteps.has(index)) return;
        stopMotion();
        reviewSteps.add(index);
        detail.hidden = false;
        choice.setAttribute('aria-pressed','true');
        animatePart(image,[{opacity:.72},{opacity:1}],260);
        appear(detail,160,270);
      },'story-step review-choice');
      choice.setAttribute('aria-label',event.name+'，揭示阶段要点');
      choice.setAttribute('aria-pressed',String(!detail.hidden));
      choice.append(label,image);
      row.append(choice);
    }
    const revisit = syncControl('revisit-'+index,'回看',()=>openChapter(index,'revisit',()=>{
      openReview(conclusionPage);
      app.querySelector<HTMLButtonElement>('[data-revisit="'+event.id+'"]')?.focus({preventScroll:true});
    }),'review-revisit','arrowRight',true);
    revisit.dataset.revisit = event.id;
    revisit.setAttribute('aria-label','回看'+event.name);
    row.append(revisit,detail);
    rail.append(row);
  });
  const previous = syncControl('previous','上一页',()=>conclusionPage ? openReview() : openScene(chapterPages.length-1),'','arrowLeft');
  const footer = element('div','review-tools');
  const next = conclusionPage ? undefined : syncControl('next','下一页',()=>openReview(true),'primary','arrowRight',true);
  footer.append(previous);
  if (next) footer.append(next);
  if (conclusionPage) {
    const reveal = syncControl('reveal-review','揭示结论',()=>{
      stopMotion();
      reviewAnswer = true;
      conclusion.hidden = false;
      reveal.hidden = true;
      conclusion.tabIndex = -1;
      conclusion.focus({preventScroll:true});
      rail.querySelectorAll('.review-step').forEach((detail,i)=>{
        animatePart(detail,[{opacity:.45},{opacity:1,color:'#fff2cb'},{opacity:1}],330,i*140);
      });
      appear(conclusion,610,410);
    },'primary');
    reveal.hidden = reviewAnswer;
    footer.append(reveal);
  }
  if (conclusionPage) lesson.append(heading);
  lesson.append(rail);
  if (conclusionPage) lesson.append(conclusion);
  lesson.append(footer);
  shell.append(header,lesson);
  app.replaceChildren(shell);
  displayView({kind:'review',conclusionPage});
  pageButtons = {previous,next};
  if (!projectionMode) title.focus({preventScroll:true});
  rail.querySelectorAll('.story-stop').forEach((row,i)=>appear(row,70+i*50,240));
}

function openTeacher() {
  if (projectionMode) return;
  const outline = element('ol','teacher-outline');
  function renderOutline() {
    const schedule = lessonSchedule(teachingPace);
    const sections = [
      {name:'地图导入',pages:[{name:'开场',timing:schedule.map}]},
      ...events.map((event,index)=>({name:event.name,pages:event.pages.map((page,i)=>({
        name:page.title, timing:schedule.chapters[index][i], practice:page.practice,
      }))})),
      {name:'课堂回顾',pages:schedule.review.map((timing,index)=>({name:index ? '全课结论' : '回顾四站',timing}))},
    ];
    outline.replaceChildren(...sections.map(({name,pages})=>{
      const item = element('li');
      const details = element('details');
      details.append(element('summary','',teachingRange(pages[0].timing,pages[pages.length-1].timing)+'  '+name));
      const notes = element('ul');
      pages.forEach(page=>{
        const {timing} = page;
        const turn = element('li');
        turn.append(element('strong','',teachingRange(timing)+'  '+page.name),
          ...beatCopy(timing.beat,'practice' in page ? page.practice : undefined).map(line=>element('p','',line)));
        if (timing.beat.question) turn.append(element('p','presenter-question',timing.beat.question));
        notes.append(turn);
      });
      details.append(notes);
      item.append(details);
      return item;
    }));
  }
  renderOutline();
  const picker = pacePicker('prep-pace',()=>{
    renderOutline();
    if (!teacherPanel.hidden) updatePresenterNotes();
  });
  const refs = element('div','dialog-split');
  refs.append(...['于都渡河', '湘江战役', '中国共产党一百年大事记', '黎平会议', '猴场会议', '遵义会议',
    '长征专题', '地形晕渲 · Mapzen / USGS / NOAA'].map(title => element('span', '', title)));
  modal('教师备课', picker, outline, control('开始遵义 3 分钟试讲', () => {
    sendAction('trial');
    dialogOpener = null;
    dialog.close();
    openTrial();
  }, 'primary', 'arrowRight', true), refs);
}
let updateMapSelection: (focus?: 'pin'|'timeline') => void;
function select(index: number, focus?: 'pin'|'timeline') {
  selected = index;
  updateMapSelection(focus);
}
function renderMap(restoreFocus = false) {
  releaseExplorationPage();
  releaseDesk();
  currentPractice = undefined;
  activeSceneCue = undefined;
  currentVideo = undefined;
  applyScrub = undefined;
  onStageDismiss = undefined;
  stopMotion();
  stopCinemagraphs();
  mapResize?.disconnect();
  const shell = element('section','shell');
  const header = element('header','top');
  const actions = element('div','top-actions');
  actions.append(syncControl('review','课堂回顾',()=>openReview()));
  actions.append(syncControl('open-desk','遵义实景',openDeskPage,'','layers'));
  if (!projectionMode) actions.append(control('教师备课',openTeacher), control('开始双屏授课',openProjection));
  actions.append(fullscreenButton());
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
  const pins = events.map((e,i) => {
    const node = syncScenePoint('pin-'+i,e.name, () => select(i,'pin'), 'pin');
    geoLabels.push({node,point:position([e.lon,e.lat])});
    world.append(node);
    return node;
  });
  const card = element('article','event-card');
  const thumb = photo(events[selected].pages[0].image, events[selected].name);
  const copy = element('div','event-copy');
  const date = element('time');
  const title = element('h2');
  const enterScene = syncControl('enter-scene','进入场景',()=>openChapter(selected),'','arrowRight',true);
  const start = syncControl('start','开始授课',()=>{
    explorationActivity?.reset();
    revealed.clear();
    reviewSteps.clear();
    reviewAnswer = false;
    lastViewed.clear();
    renderOpening();
  },'primary','arrowRight',true);
  copy.append(date,title,start,enterScene);
  const preview = element('div','event-preview');
  preview.append(thumb);
  card.append(preview,copy);
  map.append(card);
  const tools = element('div','map-tools');
  const zoomTools = element('div','zoom');
  const zoomOut = control('',()=>changeZoom(zoom / 1.25, undefined, true),'','minus');
  const zoomReadout = element('span','zoom-readout','100%');
  zoomReadout.setAttribute('aria-live','polite');
  const zoomIn = control('',()=>changeZoom(zoom * 1.25, undefined, true),'','plus');
  const view = control('俯视',()=>{
    mapAngle = mapAngle[1] === 0 ? mapHomeAngle : [0,0];
    moveCamera(false,true);
  },'','compass');
  function resetMapCamera() {
    zoom=1;
    pan=[0,0];
    mapAngle=mapHomeAngle;
    moveCamera(true,true);
  }
  const resetView = control('重置视角',resetMapCamera,'','reset');
  zoomOut.setAttribute('aria-label','缩小地图（快捷键 -）');
  zoomIn.setAttribute('aria-label','放大地图（快捷键 +）');
  resetView.setAttribute('aria-label','重置地图视角（快捷键 0）');
  zoomTools.append(zoomOut,zoomReadout,zoomIn,view,resetView);
  tools.append(zoomTools);
  map.append(tools);
  const timeline = element('nav','timeline chapter-rail');
  timeline.setAttribute('aria-label','时间轴');
  const times = events.map((e,i) => {
    const node = syncControl('time-'+i,'',()=>select(i,'timeline'),'time-button chapter-link');
    node.append(element('time','',e.timeline),element('strong','',e.name));
    timeline.append(node);
    return node;
  });
  map.append(timeline);
  shell.append(header,map);
  app.replaceChildren(shell);
  displayView({kind:'map'});
  let width = 0;
  let height = 0;
  let origin: Point = [0,0];
  function layout() {
    map.style.setProperty('--map-rail-height',timeline.offsetHeight+'px');
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
    if (view.textContent !== label) setButtonContent(view,label,'compass');
    const limitX = map.clientWidth*.28 + width*(zoom-1)/2;
    const limitY = map.clientHeight*.24 + height*(zoom-1)/2;
    pan = [Math.max(-limitX,Math.min(limitX,pan[0])), Math.max(-limitY,Math.min(limitY,pan[1]))];
    world.classList.toggle('ease-camera',animate);
    world.style.transform = `translate(${origin[0]+pan[0]}px, ${origin[1]+pan[1]}px) scale(${zoom})`;
    world.style.setProperty('--inverse-zoom',String(1/zoom));
    zoomOut.disabled = zoom <= .85;
    zoomIn.disabled = zoom >= 2.5;
    zoomReadout.textContent = Math.round(zoom * 100) + '%';
    cameraPosition = [zoom,pan[0]/Math.max(1,width),pan[1]/Math.max(1,height),...mapAngle];
    if (broadcast) sendCamera(cameraPosition,animate);
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
  mapResize.observe(timeline);
  let drag: {id:number;x:number;y:number;start:Point; orbit:boolean} | undefined;
  map.addEventListener('wheel', e => {
    if (projectionMode || (e.target as Element).closest('.event-card,.map-tools,.timeline')) return;
    e.preventDefault();
    const rect = map.getBoundingClientRect();
    changeZoom(zoom*Math.exp(-Math.sign(e.deltaY)*.12),[e.clientX-rect.left,e.clientY-rect.top],false);
  }, {passive:false});
  map.addEventListener('pointerdown', e => {
    if (projectionMode || !e.isPrimary || e.button!==0 || (e.target as Element).closest('button,.event-card,.map-tools,.timeline')) return;
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
    if (projectionMode || dialog.open || ev.altKey || ev.ctrlKey || ev.metaKey) return;
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
      const [x,y] = terrain.project(position([e.lon,e.lat]));
      const targetX = map.clientWidth*(map.clientWidth<=720 ? .5 : .65);
      const targetY = map.clientHeight*(map.clientWidth<=720 ? .33 : .47);
      const focusAmount = Math.max(.14,Math.min(1,(zoom-1)*2));
      pan = [(targetX-origin[0]-width*zoom*x/100)*focusAmount,
        (targetY-origin[1]-height*zoom*y/100)*focusAmount];
      moveCamera(!reducedMotion.matches);
      if (!projectionMode) (focus==='pin'?pins:times)[selected].focus({preventScroll:true});
    }
  };
  updateMapSelection();
  layout();
  applyCamera = ([nextZoom,x,y,azimuth,tilt],animate)=>{
    zoom = nextZoom;
    pan = [x*width,y*height];
    mapAngle = [azimuth,tilt];
    moveCamera(animate);
  };
  pageButtons = {next: start};
  if (restoreFocus && !projectionMode) times[selected].focus({preventScroll:true});
}
function showZunyiMaterials(index?: number) {
  activeMaterial = index === undefined ? 'comparison' : index === 0 ? 'material-before' : 'material-during';
  const columns = element('div','materials');
  const items = index === undefined ? zunyiMaterials : [zunyiMaterials[index]];
  for (const item of items) {
    const card = element('article','material');
    if (index === undefined) card.append(element('h3','',item.title));
    item.lines.forEach(line=>card.append(element('p','',line)));
    columns.append(card);
  }
  dialog.classList.toggle('comparison',index === undefined);
  if (index === undefined) {
    modal('两份材料对照',columns);
    if (!revealed.has('materials-compared')) {
      Array.from(columns.children).forEach((card,index)=>{
        animatePart(card,[{opacity:0,translate:index ? '18px 0' : '-18px 0'},{opacity:1,translate:'0 0'}],360,140+index*180);
      });
      revealed.add('materials-compared');
    }
  }
  else {
    const footer = element('div','dialog-split');
    footer.append(syncControl('compare','并排对照',()=>showZunyiMaterials(),'primary'));
    modal(items[0].title,columns,footer);
  }
}

function revealControl(key: string, label: string, output: HTMLElement, onReveal: () => void) {
  const button = syncControl(key,label,()=>{
    if (revealed.has(key)) return;
    stopMotion();
    revealed.add(key);
    sync();
    onReveal();
  });
  function sync() {
    const visible = revealed.has(key);
    output.hidden = !visible;
    button.setAttribute('aria-expanded',String(visible));
  }
  sync();
  return button;
}

function showTroops() {
  activeMaterial = 'troops';
  const chart = element('div','troop-chart');
  const footer = element('div','dialog-split');
  const note = element('p','source','两数的差额涵盖这段行程中的多种减员。');
  const rows = [
    { label: '长征出发时', count: '8.6 万余人', percent: 100 },
    { label: '渡过湘江后', count: '3 万余人', percent: 35 },
  ];
  rows.forEach(({label,count,percent},index)=>{
    const row = element('div','troop-row');
    const text = element('div','troop-label');
    text.append(element('span','',label),element('strong','',count));
    const track = element('div','troop-track');
    track.setAttribute('aria-hidden','true');
    const bar = element('span','troop-bar');
    bar.style.width = percent+'%';
    track.append(bar);
    row.append(text,track);
    chart.append(row);
    footer.append(revealControl('troops-'+index,label,row,()=>{
      animatePart(bar,[{scale:'0 1'},{scale:'1 1'}],430);
      appear(text,340,260);
      updateNote();
      if (!note.hidden) appear(note,520,230);
    }));
  });
  function updateNote() { note.hidden = !rows.every((_,i)=>revealed.has('troops-'+i)); }
  updateNote();
  modal('兵力对照',chart,footer,note);
}

function showDirections() {
  activeMaterial = 'directions';
  const diagram = element('div','directions');
  const lines = document.createElementNS(svgNamespace,'svg');
  lines.setAttribute('viewBox','0 0 100 100');
  lines.setAttribute('preserveAspectRatio','none');
  lines.setAttribute('aria-hidden','true');
  diagram.append(lines,element('strong','direction-origin','黎平'));
  const footer = element('div','dialog-split');
  const options = [
    { label:'原计划', destination:'湘西北', direction:'east', line:'M 50 86 Q 63 78 74 43 L 69 47 M 74 43 L 74 55' },
    { label:'会议决定', destination:'贵州北部', direction:'west', line:'M 50 86 Q 37 78 26 43 L 26 55 M 26 43 L 31 47' },
  ];
  options.forEach(({label,destination,direction,line})=>{
    const branch = element('div','direction-branch '+direction);
    const path = diagramPath(line,'direction-line '+direction);
    const key = 'direction-'+direction;
    path.classList.toggle('is-drawn',revealed.has(key));
    lines.append(path);
    branch.append(element('span','direction-name',label),element('strong','',destination));
    diagram.append(branch);
    footer.append(revealControl(key,label,branch,()=>{
      path.classList.add('is-drawn');
      drawLine(path,0,460);
      appear(branch,390,270);
    }));
  });
  modal('进军方向示意',diagram,footer);
}

function showCrossing() {
  activeMaterial = 'crossing';
  const firstVisit = !revealed.has('crossing-diagram');
  revealed.add('crossing-diagram');
  const chart = element('div','crossing-chart');
  const svg = document.createElementNS(svgNamespace,'svg');
  svg.setAttribute('viewBox','0 0 100 100');
  svg.setAttribute('preserveAspectRatio','none');
  svg.setAttribute('aria-hidden','true');
  svg.append(diagramPath('M 51 -5 Q 31 22 49 52 T 49 106','river-line'));
  const crossing = diagramPath('M 85 49 Q 70 45 55 51 T 19 60 L 24 54 M 19 60 L 25 63','crossing-line');
  svg.append(crossing);
  chart.append(svg,element('span','crossing-quanzhou','全州'),element('span','crossing-xingan','兴安'),
    element('span','crossing-river','湘江'),element('span','crossing-label','渡江区域'));
  modal('湘江渡江区域示意',chart);
  if (firstVisit) {
    drawLine(crossing,120,430);
    appear(chart.querySelector('.crossing-label')!,490,260);
  }
}

const issueSteps = {
  military: ['回顾两段经历','总结第五次反“围剿”失败与长征初期受挫','纠正军事领导上的错误'],
  organization: ['调整中央领导机构','毛泽东当选中央政治局常委','调整军事指挥安排'],
};

function showIssue(issue: keyof typeof issueSteps) {
  activeMaterial = issue;
  const firstVisit = !revealed.has(issue+'-diagram');
  revealed.add(issue+'-diagram');
  const flow = element('ol','story-rail');
  for (const step of issueSteps[issue]) {
    const row = element('li','story-stop');
    row.append(element('p','story-step story-fact',step));
    flow.append(row);
  }
  modal(issue === 'military' ? '军事问题' : '组织问题',flow);
  if (firstVisit) Array.from(flow.children).forEach((step,index)=>appear(step,110+index*165,300));
}

function openChapter(index: number, variant: LessonMode = 'lesson', returnToReview?: () => void) {
  const first = chapterStarts[index];
  openScene(variant === 'trial' ? first : (lastViewed.get(index) ?? first), variant, returnToReview);
}

function openDeskPage() {
  const position = chapterPages.findIndex(entry=>entry.page.activity==='materials');
  if (position>=0) openScene(position);
}

function renderOpening(autoplay = true) {
  releaseExplorationPage();
  releaseDesk();
  mapResize?.disconnect();
  currentPractice = undefined;
  activeSceneCue = undefined;
  currentVideo = undefined;
  applyScrub = undefined;
  onStageDismiss = undefined;
  stopMotion();
  stopCinemagraphs();
  const scene = element('section','scene opening-page');
  const stage = element('div','scene-stage');
  const media = element('div','scene-media');
  const camera = element('div','scene-camera');
  const heading = element('header','scene-head');
  const title = element('h1','course-title','从于都到遵义');
  const actions = element('div','scene-actions');
  const controls = element('div','opening-controls');
  const landing = photo('yudu-assembly','于都集结');
  void landing.decode().catch(()=>{});
  title.tabIndex = -1;
  camera.append(photo('yudu-bank','于都河岸'),element('div','scene-spotlight'));
  media.append(camera,element('div','scene-shade'));
  stage.append(media);
  const player = attachVideo({mode:'opening',key:'opening'},'yudu-bank',camera,controls);
  actions.append(controls,fullscreenButton(),syncControl('map','地图',()=>{
    player.pause();
    renderMap(true);
  },'','arrowLeft'));
  heading.append(title,actions);
  const next = syncControl('opening-next','进入课堂',()=>{
    player.pause();
    openScene(0,'lesson',undefined,landing.complete && landing.naturalWidth ? landing : undefined);
  },'primary','arrowRight',true);
  controls.append(next);
  scene.append(stage,heading);
  app.replaceChildren(scene);
  const sizeMedia = ()=>{media.style.width=Math.max(stage.clientWidth,stage.clientHeight*16/9)+'px';};
  mapResize = new ResizeObserver(sizeMedia);
  mapResize.observe(stage);
  sizeMedia();
  pageButtons = {next};
  displayView({kind:'opening'});
  if (!projectionMode) {
    title.focus({preventScroll:true});
    if (autoplay) {
      const state: VideoState = {mode:'playing',time:0};
      void player.set(state);
      sendProjection({type:'video',state});
    }
  }
}

function openScene(position: number, variant: LessonMode = 'lesson', returnToReview?: () => void, matchedFrame?: HTMLImageElement) {
  releaseExplorationPage();
  releaseDesk();
  currentPractice = undefined;
  activeSceneCue = undefined;
  currentVideo = undefined;
  applyScrub = undefined;
  onStageDismiss = undefined;
  stopMotion();
  stopCinemagraphs();
  const priorImage = app.querySelector<HTMLImageElement>('.scene-media img');
  const priorChapter = app.querySelector<HTMLElement>('.classroom-slide')?.dataset.chapter;
  mapResize?.disconnect();
  const { event, chapter, page } = chapterPages[position];
  selected = chapter;
  if (variant !== 'trial') lastViewed.set(chapter,position);

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
  scene.addEventListener('click', (e) => {
    if (projectionMode || liveDesk || scene.hasAttribute('data-exploration')) return;
    const target = e.target as Element | null;
    if (!target?.isConnected || target.closest('button,input,a,.probe-callout,.troop-hud,.story-panel,.folio-card,.lesson-footer')) return;
    if (onStageDismiss) {
      sendAction('stage-dismiss');
      onStageDismiss();
    }
  });

  let pauseVideo = () => {};
  const tools = element('div','scene-actions');
  if (liveDesk && !projectionMode) tools.append(control('双屏授课',openProjection,'desk-project','expand'));
  if (page.video) {
    let movieAdvance: HTMLButtonElement | undefined;
    if (page.video.mode === 'transition') {
      const destination = chapterPages[position+1].page;
      const landing = photo(destination.image,destination.title);
      const decoded = landing.decode().then(()=>landing,()=>undefined);
      movieAdvance = syncControl('clip-next','',async()=>{
        const frame = await decoded;
        if (movieAdvance?.isConnected && currentVideo?.read().mode === 'playing') turn(1,frame);
      });
      movieAdvance.hidden = true;
      tools.append(movieAdvance);
    }
    pauseVideo = attachVideo(page.video,page.image,camera,tools,()=>onStageDismiss?.(),()=>movieAdvance?.click()).pause;
  }
  if (page.video?.key==='zunyi') {
    camera.append(syncControl('visit-meeting-desk','进入会议桌实景',()=>{
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
  tools.append(fullscreenButton(),syncControl('map',returnToReview ? '返回回顾' : '地图',leave,'','arrowLeft'));
  heading.append(identity,tools);

  const narration = element('p','slide-line',page.line);
  narration.setAttribute('aria-live','polite');
  let practiceFocus = '';
  let showPracticeReference: ((focus: PracticeQuestion['focus']) => void) | undefined;

  function setCamera(fx = 50, fy = 50, scale = 1, spot = false) {
    const tx = Math.min(0, Math.max(100 * (1 - scale), 50 - fx * scale));
    const ty = Math.min(0, Math.max(100 * (1 - scale), 48 - fy * scale));
    camera.style.transform = `translate(${tx}%, ${ty}%) scale(${scale})`;
    spotlight.style.setProperty('--spot-x', fx + '%');
    spotlight.style.setProperty('--spot-y', fy + '%');
    spotlight.classList.toggle('is-active', spot);
    return { sx: tx + scale * fx, sy: ty + scale * fy };
  }

  if (page.camera) {
    setCamera(page.camera.x, page.camera.y, page.camera.scale, true);
  }

  // ---- 1. In-scene Focus Probes (于都集结 / 岸边备桥 / 渡江之后 / 黎平翘街 / 渡过乌江) ----
  if (page.probes?.length) {
    const probes = page.probes;
    const callout = element('article','probe-callout');
    callout.hidden = true;
    const calloutTitle = element('h3');
    const calloutDetail = element('p');
    const pinButtons: HTMLButtonElement[] = [];
    const resetProbes = () => {
      callout.hidden = true;
      setCamera(50,50,1,false);
      narration.textContent = page.line;
      pinButtons.forEach(b=>{
        b.dataset.active = 'false';
        b.dataset.dismissed = 'false';
      });
    };
    callout.append(calloutTitle,calloutDetail);
    media.append(callout);

    probes.forEach(probe => {
      const btn = syncScenePoint(probe.id, `${probe.label}：${probe.title}`, () => {
        stopMotion();
        activeSceneCue = probe.id;
        revealed.add(probe.id);
        btn.dataset.visited = 'true';
        pinButtons.forEach(b=>{
          const isCurrent = b === btn;
          b.dataset.active = String(isCurrent);
          b.dataset.dismissed = String(isCurrent);
        });
        const { sx, sy } = setCamera(probe.x, probe.y, probe.zoom ?? 1.38, true);
        calloutTitle.textContent = probe.title;
        calloutDetail.textContent = probe.detail;
        callout.hidden = false;
        callout.dataset.side = sx > 54 ? 'left' : 'right';
        callout.style.left = Math.max(18, Math.min(82, sx)) + '%';
        callout.style.top = Math.max(25, Math.min(64, sy)) + '%';
        appear(callout, 120, 260);
      }, 'probe-pin');
      btn.style.left = probe.x + '%';
      btn.style.top = probe.y + '%';
      btn.dataset.visited = String(revealed.has(probe.id));
      btn.dataset.active = 'false';
      camera.append(btn);
      pinButtons.push(btn);
    });
    registerDismiss(resetProbes);
  }

  // ---- 2. Bridge structural outlines (浮桥近景) ----
  if (page.activity === 'bridge') {
    const bridgeLabels = new Map<string,string>([['boat','木船托住桥面'],['plank','木板铺成通道']]);
    const bridgeLine = () => {
      const active = [...bridgeLabels].filter(([key])=>revealed.has(key));
      narration.textContent = active.length === 2 ? '木船托桥，木板铺面。于都群众捐出门板等木料。'
        : active[0]?.[1] ?? page.line;
    };
    const outlines = document.createElementNS(svgNamespace,'svg');
    outlines.setAttribute('class','bridge-outlines');
    outlines.setAttribute('viewBox','0 0 100 100');
    outlines.setAttribute('preserveAspectRatio','none');
    outlines.setAttribute('aria-hidden','true');
    camera.append(outlines);
    const parts: [string,string,Point,string][] = [
      ['船体','boat',[28,65],'M 9 42 Q 11 57 32 59 L 57 61 Q 49 78 39 84 Q 13 79 9 54 Z'],
      ['桥板','plank',[73,46],'M 41 39 L 97 36 L 99 57 Q 70 49 45 45 Z'],
    ];
    parts.forEach(([label,key,point,shape])=>{
      const outline = diagramPath(shape,'bridge-outline');
      outline.dataset.part = key;
      outline.classList.toggle('is-drawn',revealed.has(key));
      outlines.append(outline);
      addHotspot(label,key,point,()=>{
        practiceFocus = key;
        outline.classList.add('is-drawn');
        setCamera(point[0], point[1], 1.14, true);
        drawLine(outline,0,450);
        bridgeLine();
        appear(narration,360,250);
      });
    });
    bridgeLine();
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
    addHotspot('标绘渡江区域','crossing',[56,57],()=>{
      overlay.classList.add('is-active');
      setCamera(54, 58, 1.15, true);
      drawLine(crossingPath, 0, 520);
      narration.textContent = '中央红军在全州、兴安之间抢渡湘江（灌阳也在战役涉及范围内），成功突破第四道封锁线。';
      appear(narration, 320, 260);
    });
  }

  // ---- 4. Xiang River Force Curtain & Live Gauge (兵力对照) ----
  if (page.activity === 'troops') {
    const afterImg = photo('xiang-aftermath','渡过湘江后回望江面');
    afterImg.className = 'curtain-after';
    camera.querySelector('.scene-spotlight')!.before(afterImg);
    attachCinemagraph('xiang-aftermath', afterImg, 'curtain-after-motion');

    const divider = element('div','curtain-divider');
    divider.setAttribute('aria-hidden','true');
    const handle = element('div','curtain-handle');
    handle.append(svgIcon('sliders'));
    divider.append(handle);
    camera.append(divider);

    const hud = element('aside','troop-hud classroom-sheet');
    hud.setAttribute('aria-label','湘江前后兵力');
    const troopRow = (term: 'before'|'after', date: string, label: string, amount: string, snap: number) => {
      const row = syncControl('scrub-'+term,'',()=>updateSplit(snap,true),'troop-hud-row');
      row.dataset.term = term;
      row.setAttribute('aria-label',label+' '+amount);
      const top = element('span','troop-row-top');
      const period = element('span','troop-period');
      period.append(element('time','',date),element('span','',label));
      top.append(period,element('strong','',amount));
      const track = element('span','troop-track');
      const bar = element('span','troop-bar');
      bar.style.width = term === 'before' ? '100%' : '35%';
      track.setAttribute('aria-hidden','true');
      track.append(bar);
      row.append(top,track);
      return row;
    };
    const barBefore = troopRow('before','1934.10','长征出发','8.6 万余人',86);
    const barAfter = troopRow('after','1934.12','渡过湘江','3 万余人',14);
    const rangeInput = document.createElement('input');
    rangeInput.type = 'range';
    rangeInput.min = '8';
    rangeInput.max = '92';
    rangeInput.value = String(scrubValue);
    rangeInput.className = 'curtain-range';
    rangeInput.setAttribute('aria-label','对比长征出发与渡过湘江后兵力滑杆');

    function updateSplit(val: number, broadcast = false) {
      const clamped = Math.max(8, Math.min(92, Math.round(val)));
      scrubValue = clamped;
      rangeInput.value = String(clamped);
      media.style.setProperty('--split', clamped + '%');
      barBefore.dataset.focus = String(clamped >= 45);
      barAfter.dataset.focus = String(clamped <= 55);
      barBefore.setAttribute('aria-pressed',barBefore.dataset.focus);
      barAfter.setAttribute('aria-pressed',barAfter.dataset.focus);
      if (broadcast && !projectionMode) sendScrub(clamped);
    }
    applyScrub = (v)=>updateSplit(v,false);

    const comparison = element('div','troop-controls');
    comparison.append(rangeInput,syncControl('scrub-mid','并排',()=>updateSplit(50,true),'troop-center'));
    rangeInput.addEventListener('input',()=>updateSplit(Number(rangeInput.value),true));

    let draggingCurtain = false;
    const scrubPointer = (clientX: number) => {
      const rect = media.getBoundingClientRect();
      if (!rect.width) return;
      updateSplit(((clientX - rect.left) / rect.width) * 100, true);
    };
    media.addEventListener('pointerdown', e => {
      if (projectionMode || (e.target as Element).closest('button,input,.troop-hud')) return;
      draggingCurtain = true;
      media.setPointerCapture(e.pointerId);
      scrubPointer(e.clientX);
    });
    media.addEventListener('pointermove', e => {
      if (draggingCurtain) scrubPointer(e.clientX);
    });
    for (const ev of ['pointerup','pointercancel','lostpointercapture']) {
      media.addEventListener(ev, ()=>{ draggingCurtain = false; });
    }

    hud.append(barBefore,barAfter,comparison);
    stage.append(hud);
    narration.hidden = true;
    updateSplit(scrubValue, false);
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

    paper.append(svg, originNode, eastNode, westNode);
    camera.append(paper);

    const deck = element('div','tabletop-deck');
    const syncDirText = () => {
      if (revealed.has('direction-west') && revealed.has('direction-east')) {
        narration.textContent = '放弃赴湘西北与红二、六军团会合的危险原计划，会议决定改向敌兵力薄弱的贵州北部进军。';
      } else if (revealed.has('direction-west')) {
        narration.textContent = '会议决定：改向贵州北部进军，避实击虚，争取战略主动。';
      } else if (revealed.has('direction-east')) {
        narration.textContent = '原计划：北上湘西北与红二、红六军团会合（敌军重兵堵截）。';
      }
    };
    const btnEast = syncControl('direction-east','推演原计划 · 湘西北',()=>{
      revealed.add('direction-east');
      paintRoutes();
      btnEast.setAttribute('aria-pressed','true');
      btnEast.dataset.dismissed = 'true';
      drawLine(eastLine,0,480);
      appear(eastNode,350,240);
      syncDirText();
    },'deck-btn','compass');
    const btnWest = syncControl('direction-west','推演新方向 · 贵州北部',()=>{
      revealed.add('direction-west');
      paintRoutes();
      btnWest.setAttribute('aria-pressed','true');
      btnWest.dataset.dismissed = 'true';
      drawLine(westLine,0,480);
      appear(westNode,350,240);
      syncDirText();
    },'deck-btn is-gold','compass');
    btnEast.setAttribute('aria-pressed', String(revealed.has('direction-east')));
    btnWest.setAttribute('aria-pressed', String(revealed.has('direction-west')));
    deck.append(btnEast, btnWest);
    stage.append(deck);
    registerDismiss(()=>{
      btnEast.dataset.dismissed = 'false';
      btnWest.dataset.dismissed = 'false';
    });
    syncDirText();
  }

  if (liveDesk) {
    currentDesk = mountDesk(stage);
    registerDismiss(()=>currentDesk?.dismiss());
  }

  if ((page.activity === 'military' || page.activity === 'organization') && page.steps) {
    const steps = page.steps;
    const allKey = page.activity + '-all';
    const panel = element('aside','story-panel ' + (page.activity === 'organization' ? 'story-panel--left' : 'story-panel--right'));
    const rail = mountStoryRail(page.title,steps,step=>{
      activeSceneCue = step.id;
      revealed.add(step.id);
      revealed.delete(allKey);
      narration.textContent = step.detail;
      syncSteps();
    },true);
    const expandAll = syncControl(allKey,'展开全部',()=>{
      if (revealed.has(allKey)) revealed.delete(allKey);
      else {
        revealed.add(allKey);
        steps.forEach(step=>revealed.add(step.id));
      }
      activeSceneCue = undefined;
      narration.textContent = page.line;
      syncSteps();
    },'panel-all-btn');
    function syncSteps() {
      const all = revealed.has(allKey);
      rail.refresh(all);
      setButtonContent(expandAll,all ? '收起全部' : '展开全部');
      expandAll.setAttribute('aria-expanded',String(all));
    }
    syncSteps();
    panel.append(rail.list,expandAll);
    stage.append(panel);
  }

  if (page.activity === 'houchang' && page.steps) {
    const panel = element('aside','story-panel story-panel--right story-panel--chronology');
    const rail = mountStoryRail('黎平至乌江',page.steps,step=>{
      activeSceneCue = step.id;
      revealed.add(step.id);
      narration.textContent = step.detail;
      rail.refresh();
    });
    rail.refresh();
    panel.append(rail.list);
    stage.append(panel);
  }

  if (page.activity === 'result' && page.steps) {
    const steps = page.steps;
    const resultKey = variant === 'trial' ? 'trial-result' : 'zunyi-result';
    const panel = element('aside','story-panel story-panel--right');
    const conclusion = element('p','assembly-conclusion','会议集中解决军事和组织问题，事实上确立了毛泽东在党中央和红军的领导地位，开启了党独立自主解决中国革命实际问题的新阶段。');
    const rail = mountStoryRail('转折依据',steps,step=>{
      activeSceneCue = step.id;
      revealed.add(step.id);
      narration.textContent = step.detail;
      syncResult();
      if (!conclusion.hidden) appear(conclusion,90,240);
    });
    const revealAll = syncControl('reveal-result','直接揭示全部结论',()=>{
      steps.forEach(step=>revealed.add(step.id));
      revealed.add(resultKey);
      activeSceneCue = undefined;
      syncResult();
      appear(conclusion,90,240);
    },'panel-all-btn');

    function syncResult() {
      const count = steps.filter(step=>revealed.has(step.id)).length;
      if (count === steps.length) revealed.add(resultKey);
      const done = revealed.has(resultKey);
      stage.style.setProperty('--dawn-brightness', String(0.84 + count * 0.09 + (done ? 0.08 : 0)));
      conclusion.hidden = !done;
      revealAll.hidden = done;
      narration.hidden = done;
      rail.refresh();
    }

    syncResult();
    panel.append(rail.list,conclusion,revealAll);
    stage.append(panel);
  }

  const navigation = element('div','scene-navigation');
  const previous = syncControl('previous','上一页',()=>turn(-1),'','arrowLeft');
  const finalPage = position === chapterPages.length-1;
  const lastInChapter = chapterPages[position+1]?.chapter !== chapter;
  previous.disabled = variant !== 'lesson' && position === chapterStarts[chapter];
  const nextLabel = variant === 'trial' && finalPage ? '结束试讲'
    : variant === 'revisit' && lastInChapter ? '返回回顾'
    : finalPage ? '课堂回顾' : '下一页';
  const next = syncControl('next',nextLabel,()=>turn(1),'primary','arrowRight',true);
  navigation.append(previous);
  if (page.video?.key === 'zunyi') {
    navigation.append(syncControl('compare','并排对照',()=>{
      pauseVideo();
      showZunyiMaterials();
    }));
  }
  navigation.append(next);

  if (liveDesk) {
    stage.setAttribute('aria-label','精修会议桌实景');
  } else {
    stage.append(media);
  }

  const captionText = element('div','caption-copy');
  captionText.append(narration);

  const bottom = element('section','slide-caption');
  const footer = element('footer','lesson-footer');
  const caption = liveDesk && currentDesk ? currentDesk.transport : captionText;
  bottom.append(caption);
  if (page.practice && variant !== 'trial') {
    currentPractice = mountPractice(page.practice,position,scene,caption,()=>practiceFocus,showPracticeReference);
    bottom.append(currentPractice.panel);
    navigation.insertBefore(currentPractice.entry,next);
  }
  bottom.append(navigation);
  footer.append(bottom);
  if (variant === 'lesson') footer.append(chapterNav(chapter,jump));
  scene.append(stage, heading, footer);
  app.replaceChildren(scene);
  if (page.exploration) {
    const backdrop = page.video?.mode === 'loop' ? undefined : {key: page.image, image: picture};
    mountExplorationPage({id: page.exploration, position, scene, stage, tools, bottom:footer, pauseMedia: pauseVideo, backdrop});
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
  if (!projectionMode) title.focus({preventScroll:true});
  if (!matchedFrame && !liveDesk && priorImage?.complete && priorImage.naturalWidth && priorImage.getAttribute('src') !== picture.getAttribute('src') && !reducedMotion.matches) {
    const old = element('img','outgoing-image');
    old.src = priorImage.src;
    old.alt = '';
    old.setAttribute('aria-hidden','true');
    spotlight.before(old);
    const fade = animatePart(old,[{opacity:1},{opacity:0}],380);
    const remove = ()=>old.remove();
    if (fade) fade.finished.then(remove,remove);
    else remove();
  } else if (!matchedFrame && !liveDesk && priorImage?.getAttribute('src') !== picture.getAttribute('src')) {
    animatePart(picture,[{opacity:.62},{opacity:1}],340);
  }
  if (!liveDesk) {
    appear(identity,110,270);
    appear(narration,220,280);
    camera.querySelectorAll('.hotspot,.probe-pin').forEach((spot,index)=>appear(spot,220+index*75,260));
    const activeChapter = footer.querySelector('[aria-current="step"]');
    if (activeChapter && priorChapter !== String(chapter)) {
      animatePart(activeChapter,[{backgroundColor:'#e8c48552'},{backgroundColor:'#e8c48514'}],380,220);
    }
  }

  function addHotspot(label: string, key: string, [x,y]: Point, action: () => void) {
    const spot = syncScenePoint(key,label,()=>{
      stopMotion();
      pauseVideo();
      activeSceneCue = key;
      revealed.add(key);
      spot.dataset.dismissed = 'true';
      update();
      action();
    },'hotspot');
    function update() {
      const active = revealed.has(key);
      spot.dataset.visited = String(active);
    }
    spot.style.left = x+'%';
    spot.style.top = y+'%';
    update();
    camera.append(spot);
    registerDismiss(()=>{
      spot.dataset.dismissed = 'false';
      setCamera(50,50,1,false);
    });
  }

  function turn(direction: number, frame?: HTMLImageElement) {
    if (direction < 0 && previous.disabled) return;
    pauseVideo();
    if (position+direction < 0 || (direction > 0 && variant === 'revisit' && lastInChapter)) leave();
    else if (direction > 0 && finalPage) {
      if (variant === 'trial') leave();
      else openReview();
    } else {
      const trialMaterials = chapterStarts[chapter]+1;
      const target = variant === 'trial' && direction > 0 && position === trialMaterials
        ? chapterPages.length-1
        : variant === 'trial' && direction < 0 && finalPage ? trialMaterials : position+direction;
      openScene(target,variant,returnToReview,frame);
    }
  }
}

function attachVideo(clip: LessonClip, image: string, media: HTMLElement, tools: HTMLElement,
  align?: () => void, advance?: () => void) {
  const video = element('video');
  video.src = mediaAssets[clip.key+'-video'];
  video.poster = mediaAssets[image];
  video.preload = 'auto';
  video.muted = projectionMode || clip.mode !== 'opening';
  video.playsInline = true;
  video.loop = clip.mode === 'loop';
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
  const play = control(startLabel,()=>{
    const state: VideoState = {mode:intent.mode === 'playing' && !video.ended ? 'paused' : 'playing',
      time:intent.mode === 'static' || video.hidden || video.ended ? 0 : video.currentTime};
    void setVideo(state);
    sendProjection({type:'video',state});
  },'','play');
  async function setVideo(state: VideoState) {
    const request = ++generation;
    intent = state;
    if (state.mode === 'static') { showPoster(clip.key === 'xiang'); return; }
    if (posterFade) {
      video.hidden = true;
      video.classList.remove('is-visible');
      posterFade.cancel();
      posterFade = undefined;
    }
    const entering = video.hidden;
    still.disabled = false;
    setButtonContent(play,state.mode === 'paused' ? '继续播放' : '暂停短片',state.mode === 'paused' ? 'play' : 'pause');
    if (entering && clip.mode === 'transition') {
      align?.();
      getComputedStyle(media).transform;
      await Promise.allSettled(media.getAnimations().map(animation=>animation.finished));
      if (request !== generation || !video.isConnected) return;
    }
    if (entering ? video.currentTime !== state.time : Math.abs(video.currentTime-state.time) > .12) {
      video.currentTime = state.time;
    }
    video.hidden = false;
    if (state.mode === 'paused') {
      video.pause();
      video.classList.add('is-visible');
      return;
    }
    try {
      if (entering && clip.mode === 'transition') {
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
          // The original image stays on screen while the frame decodes.
          await new Promise<void>(resolve=>{
            const ready = () => {
              video.removeEventListener('loadeddata',ready);
              video.removeEventListener('error',ready);
              resolve();
            };
            video.addEventListener('loadeddata',ready);
            video.addEventListener('error',ready);
          });
        }
        if (request !== generation || !video.isConnected) return;
        video.classList.add('is-visible');
      }
      await video.play();
      if (request === generation && video.isConnected && !video.hidden && !video.paused) video.classList.add('is-visible');
      if (!video.isConnected) video.pause();
    } catch {
      if (request === generation && video.isConnected) showPoster();
    }
  }
  const still = control('静态画面',()=>{
    const state:VideoState = {mode:'static',time:0};
    void setVideo(state);
    sendProjection({type:'video',state});
  },'','image');
  const player = {set: setVideo, read: ()=>({
    mode: intent.mode, time:video.hidden || intent.mode === 'static' ? intent.time : video.currentTime,
  }), pause() {
    if (intent.mode !== 'playing') return;
    void setVideo({mode:'paused',time:video.currentTime});
  }};
  currentVideo = player;
  still.disabled = true;
  video.addEventListener('ended',()=>{
    if (!video.isConnected || !video.ended || intent.mode!=='playing') return;
    if (clip.mode==='transition' && !projectionMode) advance?.();
    if (clip.mode==='opening') {
      intent = {mode:'paused',time:video.currentTime};
      setButtonContent(play,'重播','play');
      if (!projectionMode) sendProjection({type:'video',state:intent});
    }
  });
  video.addEventListener('error',()=>showPoster());
  tools.append(play);
  if (clip.mode!=='opening') tools.append(still);
  function showPoster(fade = false) {
    const request = ++generation;
    intent = {mode:'static',time:0};
    video.pause();
    if (cutLabel) cutLabel.hidden = true;
    if (document.activeElement === still) play.focus({preventScroll:true});
    still.disabled = true;
    setButtonContent(play,startLabel,'play');
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
  if (clip.mode === 'loop') void setVideo({mode:'playing',time:0});
  return player;
}
