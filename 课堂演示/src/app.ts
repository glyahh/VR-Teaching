type LessonMode = 'lesson' | 'trial' | 'revisit';
type Point = [number, number];
type IconName = 'plus'|'minus'|'reset'|'play'|'pause'|'image'|'check'|'info'|'arrowLeft'|'arrowRight'|'expand'|'compress';

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
function photo(key: string, alt = '') {
  const node = element('img');
  node.src = mediaAssets[key];
  node.alt = alt;
  return node;
}
function citation(label: string, url: string) {
  const a = element('a', '', label);
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
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

reducedMotion.addEventListener('change',event=>{ if (event.matches) stopMotion(); });

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
closeDialog.onclick = () => dialog.close();
dialog.addEventListener('click', e => {
  if (e.target === dialog) dialog.close();
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
function place(node: HTMLElement, point: Point) {
  const [x,y] = position(point);
  node.style.left = x + '%';
  node.style.top = y + '%';
}
let pageButtons: {previous?: HTMLButtonElement; next?: HTMLButtonElement} = {};
document.addEventListener('keydown', event => {
  if (event.defaultPrevented || dialog.open || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
  const button = ['ArrowLeft', 'PageUp'].includes(event.key) ? pageButtons.previous
    : ['ArrowRight', 'PageDown'].includes(event.key) ? pageButtons.next : undefined;
  if (!button?.isConnected) return;
  event.preventDefault();
  if (!event.repeat && !button.disabled) button.click();
});

function chapterNav(current: number, jump: (index: number) => void) {
  const nav = element('nav','chapter-nav');
  nav.setAttribute('aria-label','时间轴');
  events.forEach((event, index) => {
    const button = control(event.name, () => jump(index));
    if (index === current) button.setAttribute('aria-current','step');
    nav.append(button);
  });
  return nav;
}

function openReview(conclusionPage = false) {
  stopMotion();
  mapResize?.disconnect();
  const shell = element('section','shell review');
  const header = element('header','top');
  const actions = element('div','top-actions');
  actions.append(fullscreenButton(),control('地图',()=>renderMap(true),'','arrowLeft'));
  const title = element('h1','',conclusionPage ? '全课结论' : '课堂回顾');
  title.tabIndex = -1;
  header.append(title,actions);

  const lesson = element('section','review-body');
  const cards = element('div','review-cards');
  const heading = element('h2','',conclusionPage ? reviewQuestion : '从出发到转折，四站发生了什么？');
  const conclusion = element('p','review-conclusion',lessonConclusion);
  conclusion.hidden = !reviewAnswer;
  conclusion.setAttribute('aria-live','polite');
  events.forEach((event, index) => {
    const card = element('article','review-card');
    const detail = element('span','review-step',event.review);
    detail.hidden = !(conclusionPage || reviewSteps.has(index));
    detail.setAttribute('aria-live','polite');
    const label = element('span','review-label');
    label.append(element('time','',event.timeline),element('strong','',event.name),detail);
    const image = photo(event.id === 'liping' ? event.pages[0].image : event.id);
    if (conclusionPage) {
      const summary = element('div','review-choice');
      summary.append(image,label);
      card.append(summary);
    } else {
      const choice = control('',()=>{
        if (reviewSteps.has(index)) return;
        stopMotion();
        reviewSteps.add(index);
        detail.hidden = false;
        choice.setAttribute('aria-pressed','true');
        animatePart(image,[{opacity:.72},{opacity:1}],260);
        appear(detail,160,270);
      },'review-choice');
      choice.setAttribute('aria-label',event.name+'，揭示阶段要点');
      choice.setAttribute('aria-pressed',String(!detail.hidden));
      choice.append(image,label);
      card.append(choice);
    }
    const revisit = control('回看',()=>openChapter(index,'revisit',()=>{
      openReview(conclusionPage);
      app.querySelector<HTMLButtonElement>('[data-revisit="'+event.id+'"]')?.focus({preventScroll:true});
    }),'review-revisit','arrowRight',true);
    revisit.dataset.revisit = event.id;
    revisit.setAttribute('aria-label','回看'+event.name);
    card.append(revisit);
    cards.append(card);
  });
  const previous = control('上一页',()=>conclusionPage ? openReview() : openScene(chapterPages.length-1),'','arrowLeft');
  const footer = element('div','review-tools');
  const next = conclusionPage ? undefined : control('下一页',()=>openReview(true),'primary','arrowRight',true);
  footer.append(previous);
  if (next) footer.append(next);
  if (conclusionPage) {
    const reveal = control('揭示结论',()=>{
      stopMotion();
      reviewAnswer = true;
      conclusion.hidden = false;
      reveal.hidden = true;
      conclusion.tabIndex = -1;
      conclusion.focus({preventScroll:true});
      cards.querySelectorAll('.review-step').forEach((detail,i)=>{
        animatePart(detail,[{opacity:.45},{opacity:1,color:'#fff2cb'},{opacity:1}],330,i*140);
      });
      appear(conclusion,610,410);
    },'primary');
    reveal.hidden = reviewAnswer;
    footer.append(reveal);
  }
  lesson.append(heading,cards,element('p','review-illustration','情境示意'));
  if (conclusionPage) lesson.append(conclusion);
  lesson.append(footer);
  shell.append(header,lesson);
  app.replaceChildren(shell);
  pageButtons = {previous,next};
  title.focus({preventScroll:true});
  cards.querySelectorAll('.review-card').forEach((card,i)=>appear(card,100+i*75,320));
}

function openTeacher() {
  const outline = element('ol','teacher-outline');
  const start = element('li');
  start.append(element('strong','','地图导入 · 3 分钟'),element('p','',lessonQuestion+' 依次点亮四站，请学员先预测哪一站调整方向、哪一站集中处理军事和组织问题。'));
  outline.append(start);
  events.forEach(event=>{
    const item = element('li');
    const notes = element('ul');
    event.pages.forEach(page=>notes.append(element('li','',page.title+' · '+page.minutes+' 分钟。'+page.notes)));
    const duration = event.pages.reduce((sum,page)=>sum+page.minutes,0);
    item.append(element('strong','',event.name+' · '+duration+' 分钟'),notes);
    outline.append(item);
  });
  const end = element('li');
  end.append(element('strong','','课堂回顾 · 4 分钟'),element('p','','前 2 分钟逐张揭示四站要点，后 2 分钟请学员引用材料回答，再揭示结论。'));
  outline.append(end);
  const trialNotes = element('p','','遵义单讲 · 3 分钟。用 45 秒交代会前形势，90 秒对照两份材料，45 秒请学员回答并揭示结论。');
  const refs = element('div','dialog-split');
  refs.append(citation('于都渡河', bridgeSource),citation('湘江战役',xiangSource),
    citation('中国共产党一百年大事记', chronology),citation('黎平会议',lipingSource),
    citation('猴场会议',houchangSource),citation('遵义会议',zunyiSource),citation('长征专题',history),citation('地形晕渲 · Mapzen / USGS / NOAA',terrainSource));
  modal('教师备课 · 42 分钟', control('开始遵义 3 分钟试讲', () => {
    dialogOpener = null;
    dialog.close();
    revealed.delete('trial-result');
    openChapter(events.findIndex(event=>event.id==='zunyi'),'trial');
  }, 'primary', 'arrowRight', true), trialNotes, outline, refs);
}
let updateMapSelection: (focus?: 'pin'|'timeline') => void;
function select(index: number, focus?: 'pin'|'timeline') {
  selected = index;
  updateMapSelection(focus);
}
function renderMap(restoreFocus = false) {
  stopMotion();
  mapResize?.disconnect();
  const shell = element('section','shell');
  const header = element('header','top');
  const actions = element('div','top-actions');
  actions.append(control('课堂回顾',()=>openReview()),control('教师备课',openTeacher),fullscreenButton());
  header.append(element('h1','','从于都到遵义'),actions);
  const map = element('section','map');
  map.setAttribute('aria-label','长征阶段地图');
  const world = element('div','map-world');
  world.append(createTerrainSurface());
  map.append(world);
  for (const [label,lon,lat] of places) {
    const node = element('span','place',label);
    place(node,[lon,lat]);
    world.append(node);
  }
  const routeDiagram = document.createElementNS(svgNamespace,'svg');
  routeDiagram.setAttribute('class','map-route');
  routeDiagram.setAttribute('viewBox','0 0 100 100');
  routeDiagram.setAttribute('preserveAspectRatio','none');
  routeDiagram.setAttribute('aria-hidden','true');
  const segments = route.slice(1).map((point,index)=>{
    const start = position(route[index]);
    const end = position(point);
    return diagramPath('M '+start.join(' ')+' L '+end.join(' '),'route');
  });
  routeDiagram.append(...segments);
  world.append(routeDiagram);
  let displayedRouteEnd = events[selected].routeEnd;
  const pins = events.map((e,i) => {
    const node = control(e.name, () => select(i,'pin'), 'pin');
    place(node,[e.lon,e.lat]);
    world.append(node);
    return node;
  });
  const card = element('article','event-card');
  const thumb = photo(events[selected].pages[0].image, events[selected].name+'情境示意');
  const copy = element('div','event-copy');
  const date = element('time');
  const title = element('h2');
  const question = element('p');
  const enterScene = control('进入场景',()=>openChapter(selected),'','arrowRight',true);
  const start = control('开始授课',()=>{
    revealed.clear();
    reviewSteps.clear();
    reviewAnswer = false;
    lastViewed.clear();
    openScene(0);
  },'primary','arrowRight',true);
  copy.append(date,title,question,start,enterScene);
  const preview = element('div','event-preview');
  preview.append(thumb,element('span','','情境示意'));
  card.append(preview,copy);
  map.append(card);
  const tools = element('div','map-tools');
  const zoomTools = element('div','zoom');
  const zoomOut = control('',()=>changeZoom(zoom / 1.25, undefined, true),'','minus');
  const zoomReadout = element('span','zoom-readout','100%');
  zoomReadout.setAttribute('aria-live','polite');
  const zoomIn = control('',()=>changeZoom(zoom * 1.25, undefined, true),'','plus');
  const resetView = control('重置视角',()=>{
    zoom=1;
    pan=[0,0];
    moveCamera(true);
  },'','reset');
  zoomOut.setAttribute('aria-label','缩小地图（快捷键 -）');
  zoomIn.setAttribute('aria-label','放大地图（快捷键 +）');
  resetView.setAttribute('aria-label','重置地图视角（快捷键 0）');
  zoomTools.append(zoomOut,zoomReadout,zoomIn,resetView);
  tools.append(zoomTools,element('p','','路线示意'));
  map.append(tools);
  const timeline = element('nav','timeline');
  timeline.setAttribute('aria-label','时间轴');
  const times = events.map((e,i) => {
    const node = control('',()=>select(i,'timeline'),'time-button');
    node.append(element('time','',e.timeline),element('strong','',e.name));
    timeline.append(node);
    return node;
  });
  shell.append(header,map,timeline);
  app.replaceChildren(shell);
  let width = 0;
  let height = 0;
  let origin: Point = [0,0];
  function layout() {
    const narrow = map.clientWidth <= 720;
    width = Math.max(map.clientWidth * (narrow ? 1.02 : .96), map.clientHeight * (narrow ? .56 : .93) * 1784/952);
    height = width * 952/1784;
    origin = narrow
      ? [(map.clientWidth-width)/2, map.clientHeight*.18]
      : [map.clientWidth*.60-width*.52, (map.clientHeight-height)/2];
    world.style.width = width+'px';
    world.style.height = height+'px';
    moveCamera();
  }
  function moveCamera(animate = false) {
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
    moveCamera(animate);
  }
  mapResize=new ResizeObserver(layout);
  mapResize.observe(map);
  let drag: {id:number;x:number;y:number;start:Point} | undefined;
  map.addEventListener('wheel', e => {
    if ((e.target as Element).closest('.event-card,.map-tools')) return;
    e.preventDefault();
    const rect = map.getBoundingClientRect();
    changeZoom(zoom*Math.exp(-Math.sign(e.deltaY)*.12),[e.clientX-rect.left,e.clientY-rect.top],false);
  }, {passive:false});
  map.addEventListener('pointerdown', e => {
    if (!e.isPrimary || e.button!==0 || (e.target as Element).closest('button,.event-card,.map-tools')) return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:[...pan]};
    map.setPointerCapture(e.pointerId);
    map.classList.add('dragging');
  });
  map.addEventListener('pointermove', e => {
    if (!drag || drag.id!==e.pointerId) return;
    pan=[drag.start[0]+e.clientX-drag.x, drag.start[1]+e.clientY-drag.y];
    moveCamera();
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
      zoom = 1;
      pan = [0,0];
      moveCamera(true);
    }
  });
  updateMapSelection = (focus) => {
    stopMotion();
    const e=events[selected];
    const previousEnd = displayedRouteEnd;
    displayedRouteEnd = e.routeEnd;
    thumb.src=mediaAssets[e.pages[0].image];
    thumb.alt=e.name+'情境缩略图';
    date.textContent=e.date;
    title.textContent=e.name;
    question.textContent=lessonQuestion;
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
      const [x,y] = position([e.lon,e.lat]);
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
}
function showZunyiMaterials(index?: number) {
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
    footer.append(control('并排对照',()=>showZunyiMaterials(),'primary'));
    modal(items[0].title,columns,footer);
  }
}

function revealControl(key: string, label: string, output: HTMLElement, onReveal: () => void) {
  const button = control(label,()=>{
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
  const firstVisit = !revealed.has(issue+'-diagram');
  revealed.add(issue+'-diagram');
  const flow = element('ol','issue-flow');
  issueSteps[issue].forEach(step=>flow.append(element('li','',step)));
  modal(issue === 'military' ? '军事问题' : '组织问题',flow);
  if (firstVisit) Array.from(flow.children).forEach((step,index)=>appear(step,110+index*165,300));
}

function openChapter(index: number, variant: LessonMode = 'lesson', returnToReview?: () => void) {
  const first = chapterStarts[index];
  openScene(variant === 'trial' ? first : (lastViewed.get(index) ?? first), variant, returnToReview);
}

function openScene(position: number, variant: LessonMode = 'lesson', returnToReview?: () => void) {
  stopMotion();
  const priorImage = app.querySelector<HTMLImageElement>('.scene-media > img');
  const priorChapter = app.querySelector<HTMLElement>('.classroom-slide')?.dataset.chapter;
  mapResize?.disconnect();
  const { event, chapter, page } = chapterPages[position];
  selected = chapter;
  if (variant !== 'trial') lastViewed.set(chapter,position);
  const scene = element('section','scene classroom-slide');
  scene.dataset.chapter = String(chapter);
  const media = element('div','scene-media');
  const shade = element('div','scene-shade');
  const picture = photo(page.image,page.title+'情境示意');
  media.append(picture,shade);

  let pauseVideo = () => {};
  const tools = element('div','scene-actions');
  if (page.video) pauseVideo = attachVideo(page.video,media,tools);

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
  const title = element('h1','',page.title);
  title.tabIndex = -1;
  const location = page.title === '猴场会议' ? '贵州瓮安 · 1935 年 1 月 1 日'
    : page.image === 'wujiang' ? '贵州乌江 · 1935 年 1 月初' : event.place+' · '+event.date;
  identity.append(title,element('p','scene-date',location));
  tools.append(fullscreenButton(),control(returnToReview ? '返回回顾' : '地图',leave,'','arrowLeft'));
  heading.append(identity,tools);

  const narration = element('p','slide-line',page.line);
  const evidence = element('ol','result-evidence');
  if (page.activity === 'result') {
    evidence.append(...['长征初期受挫','黎平改变方向','军事与组织调整'].map(text=>element('li','',text)));
    evidence.setAttribute('aria-label','已讲材料');
  }
  narration.setAttribute('aria-live','polite');
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
    media.append(outlines);
    const parts: [string,string,Point,string][] = [
      ['船体','boat',[28,65],'M 9 42 Q 11 57 32 59 L 57 61 Q 49 78 39 84 Q 13 79 9 54 Z'],
      ['桥板','plank',[73,46],'M 41 39 L 97 36 L 99 57 Q 70 49 45 45 Z'],
    ];
    parts.forEach(([label,key,point,shape])=>{
      const outline = diagramPath(shape,'bridge-outline');
      outline.classList.toggle('is-drawn',revealed.has(key));
      outlines.append(outline);
      addHotspot(label,key,point,()=>{
        outline.classList.add('is-drawn');
        drawLine(outline,0,450);
        bridgeLine();
        appear(narration,400,250);
      });
    });
    bridgeLine();
  }
  if (page.activity === 'crossing') addHotspot('渡江区域','crossing',[59,55],showCrossing);
  if (page.activity === 'military' || page.activity === 'organization') {
    const issue = page.activity;
    addHotspot('展开图解',issue,[49,54],()=>showIssue(issue));
  }
  if (page.activity === 'troops') addHotspot('兵力对照','troops',[59,55],showTroops);
  if (page.activity === 'directions') addHotspot('进军方向','directions',[53,62],showDirections);
  if (page.activity === 'materials') {
    addHotspot('会前形势','material-before',[32,47],()=>showZunyiMaterials(0));
    addHotspot('会议讨论','material-during',[67,47],()=>showZunyiMaterials(1));
  }

  const navigation = element('div','scene-navigation');
  const previous = control('上一页',()=>turn(-1),'','arrowLeft');
  const finalPage = position === chapterPages.length-1;
  const lastInChapter = chapterPages[position+1]?.chapter !== chapter;
  previous.disabled = variant !== 'lesson' && position === chapterStarts[chapter];
  const nextLabel = variant === 'trial' && finalPage ? '结束试讲'
    : variant === 'revisit' && lastInChapter ? '返回回顾'
    : finalPage ? '课堂回顾' : '下一页';
  const next = control(nextLabel,()=>turn(1),'primary','arrowRight',true);
  navigation.append(previous);
  if (page.activity === 'materials' || page.video === 'zunyi') {
    navigation.append(control('并排对照',()=>{
      pauseVideo();
      showZunyiMaterials();
    }));
  }
  if (page.activity === 'result') {
    const result = '会议集中解决军事和组织问题，事实上确立了毛泽东在党中央和红军的领导地位。';
    const resultKey = variant === 'trial' ? 'trial-result' : 'zunyi-result';
    const revealResult = control('揭示结论',()=>{
      stopMotion();
      revealed.add(resultKey);
      displayResult();
      Array.from(evidence.children).forEach((item,index)=>appear(item,index*160,320));
      appear(narration,520,400);
      next.focus({preventScroll:true});
    });
    function displayResult() {
      const shown = revealed.has(resultKey);
      narration.textContent = shown ? result : page.line;
      revealResult.hidden = shown;
      evidence.hidden = !shown;
    }
    displayResult();
    navigation.append(revealResult);
  }
  navigation.append(next);

  const stage = element('div','scene-stage');
  const figureLabel = element('span','scene-illustration','情境示意');
  stage.append(media,figureLabel);
  const bottom = element('section','caption slide-caption');
  if (page.activity === 'result') bottom.append(evidence);
  bottom.append(narration,navigation);
  if (variant === 'lesson') bottom.append(chapterNav(chapter,jump));
  scene.append(stage,heading,bottom);
  app.replaceChildren(scene);
  const sizeMedia = ()=>{
    media.style.width = Math.max(stage.clientWidth,stage.clientHeight*16/9)+'px';
  };
  mapResize = new ResizeObserver(sizeMedia);
  mapResize.observe(stage);
  sizeMedia();
  pageButtons = {previous,next};
  title.focus({preventScroll:true});
  if (priorImage?.complete && priorImage.naturalWidth && priorImage.src !== picture.src && !reducedMotion.matches) {
    const old = element('img','outgoing-image');
    old.src = priorImage.src;
    old.alt = '';
    old.setAttribute('aria-hidden','true');
    shade.before(old);
    const fade = animatePart(old,[{opacity:1},{opacity:0}],400);
    const remove = ()=>old.remove();
    if (fade) fade.finished.then(remove,remove);
    else remove();
  } else if (priorImage?.src !== picture.src) {
    animatePart(picture,[{opacity:.62},{opacity:1}],360);
  }
  appear(identity,120,290);
  appear(narration,280,300);
  media.querySelectorAll('.hotspot').forEach((spot,index)=>appear(spot,280+index*85,290));
  const activeChapter = bottom.querySelector('[aria-current="step"]');
  if (activeChapter && priorChapter !== String(chapter)) {
    animatePart(activeChapter,[{backgroundColor:'#e8c48552'},{backgroundColor:'#e8c48514'}],380,220);
  }

  function addHotspot(label: string, key: string, [x,y]: Point, action: () => void) {
    const spot = control(label,()=>{
      stopMotion();
      pauseVideo();
      revealed.add(key);
      update();
      action();
    },'hotspot');
    function update() {
      const active = revealed.has(key);
      spot.dataset.visited = String(active);
      setButtonContent(spot,label,active ? 'check' : 'plus');
      spot.setAttribute('aria-label',label);
    }
    spot.style.left = x+'%';
    spot.style.top = y+'%';
    update();
    media.append(spot);
  }

  function turn(direction: number) {
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
      openScene(target,variant,returnToReview);
    }
  }
}

function attachVideo(key: string, media: HTMLElement, tools: HTMLElement) {
  const video = element('video');
  video.src = mediaAssets[key+'-video'];
  video.poster = mediaAssets[key];
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  video.hidden = true;
  media.querySelector('.scene-shade')!.before(video);
  const play = control('播放短片',async ()=>{
    if (!video.paused) { video.pause(); return; }
    video.hidden = false;
    try {
      await video.play();
      if (video.isConnected && !video.hidden && !video.paused) video.classList.add('is-visible');
      else if (!video.isConnected) video.pause();
    } catch {
      if (video.isConnected) showPoster();
    }
  },'','play');
  const still = control('静态画面',showPoster,'','image');
  still.disabled = true;
  video.addEventListener('play',()=>{
    setButtonContent(play,'暂停短片','pause');
    still.disabled = false;
  });
  video.addEventListener('pause',()=>{
    if (!video.hidden) setButtonContent(play,'继续播放','play');
  });
  video.addEventListener('error',showPoster);
  tools.append(play,still);
  function showPoster() {
    video.pause();
    video.hidden = true;
    video.classList.remove('is-visible');
    if (video.readyState) video.currentTime = 0;
    if (document.activeElement === still) play.focus({preventScroll:true});
    still.disabled = true;
    setButtonContent(play,'播放短片','play');
  }
  return ()=>video.pause();
}

renderMap();
