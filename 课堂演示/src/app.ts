type CourseEvent = typeof events[number];
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
const visitedHotspots = new Set<string>();
let selected = 0;
let caption = 0;
let mode: 'map'|'scene'|'review' = 'map';
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
function replayAnimation(node: HTMLElement, className: string) {
  if (reducedMotion.matches) return;
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}
function modal(title: string, ...nodes: HTMLElement[]) {
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
function openReview() {
  mapResize?.disconnect();
  mode = 'review';
  const shell = element('section','shell review');
  const header = element('header','top');
  const title = element('h1','','课堂回顾');
  const actions = element('div','top-actions');
  actions.append(fullscreenButton(),control('返回地图',()=>renderMap(true),'','arrowLeft'));
  header.append(title,actions);

  const lesson = element('section','review-body');
  const heading = element('h2','','按时间顺序选出三个事件');
  heading.tabIndex = -1;
  const cards = element('div','review-cards');
  const feedback = element('p','review-feedback');
  feedback.setAttribute('role','status');
  const order: number[] = [];
  const choices = [2,0,1].map(index => {
    const event = events[index];
    const button = control('',()=>{
      const previous = order.indexOf(index);
      if (previous===-1) order.push(index);
      else order.splice(previous,1);
      update();
    },'review-choice');
    const label = element('span','review-label');
    const number = element('span','review-number');
    number.setAttribute('aria-hidden','true');
    label.append(element('strong','',event.name),number);
    button.append(photo(event.id, event.name+'情境示意'),label);
    cards.append(button);
    return { index, button, number };
  });
  const toolbar = element('div','review-tools');
  const reset = control('清空重选',()=>{order.length=0;update();choices[0].button.focus();},'','reset');
  const check = control('核对时间顺序',()=>{
    const correct = order.every((index,i)=>index===i);
    feedback.dataset.correct = String(correct);
    feedback.replaceChildren(
      svgIcon(correct ? 'check' : 'info'),
      element('span','',correct
        ? '顺序正确：于都出发 → 湘江战役 → 遵义会议，下方已展开史料因果链。'
        : '顺序有误：请想一想哪一事件最先出发，哪一事件在最后总结转折？')
    );
    if (!correct) replayAnimation(feedback,'is-shaking');
    evidence.hidden = !correct;
  },'primary','check');
  toolbar.append(feedback,reset,check);

  const evidence = element('section','review-evidence');
  const chain = element('div','review-chain');
  events.forEach((event,index)=>{
    const item = element('article');
    const revisit = control('重看场景',()=>{
      openScene(index,()=>{
        mode = 'review';
        mapResize?.disconnect();
        actions.firstElementChild?.replaceWith(fullscreenButton());
        app.replaceChildren(shell);
        revisit.focus();
      });
    },'','arrowRight',true);
    revisit.setAttribute('aria-label','重看'+event.name+'场景');
    item.append(element('time','',event.date),element('h3','',event.name),element('p','',event.review),revisit);
    chain.append(item);
  });
  const liping = element('p','review-bridge','湘江与遵义之间，黎平会议决定改变进军方向。');
  const discussion = element('div','review-discussion');
  const answer = element('p','','湘江战役的损失让总结经验、调整方向更紧迫。黎平会议改变进军方向，随后召开的遵义会议集中解决了当时的军事和组织问题。');
  answer.hidden = true;
  const reveal = control('查看参考讲解',()=>{
    answer.hidden = !answer.hidden;
    reveal.textContent = answer.hidden ? '查看参考讲解' : '收起参考讲解';
    reveal.setAttribute('aria-expanded',String(!answer.hidden));
  });
  reveal.setAttribute('aria-expanded','false');
  discussion.append(element('h3','','湘江战役之后，为什么还需要召开遵义会议？'),reveal,answer);
  evidence.append(chain,liping,discussion);
  lesson.append(heading,cards,toolbar,evidence);
  shell.append(header,lesson);
  app.replaceChildren(shell);
  update();
  heading.focus({preventScroll:true});

  function update() {
    choices.forEach(({index,button,number})=>{
      const position = order.indexOf(index)+1;
      number.textContent = position ? String(position) : '';
      button.setAttribute('aria-pressed',String(position>0));
      button.setAttribute('aria-label',events[index].name+(position ? `，第 ${position} 项` : ''));
    });
    evidence.hidden = true;
    answer.hidden = true;
    reveal.textContent = '查看参考讲解';
    reveal.setAttribute('aria-expanded','false');
    delete feedback.dataset.correct;
    feedback.classList.remove('is-shaking');
    feedback.textContent = order.length ? `已选 ${order.length} / ${events.length}` : '';
    check.disabled = order.length!==events.length;
    reset.disabled = order.length===0;
  }
}
function openTeacher() {
  const lesson = element('ol');
  for (const text of [
    '地图导入（约 2 分钟）：定位三个关键节点，提出核心问题。',
    '场景精讲（各约 3 分钟）：观察情境画面，打开史料与互动环节，逐句讲解。',
    '课堂回顾（约 4 分钟）：梳理时间顺序，结合史料解释转折意义。',
  ]) lesson.append(element('li','',text));
  const refs = element('div','dialog-split');
  refs.append(citation('长征专题', history), citation('中国共产党一百年大事记', chronology),
    citation('黎平会议',lipingSource),citation('地形晕渲 · Mapzen / USGS / NOAA',terrainSource));
  modal('教师备课', lesson, control('开始遵义会议 3 分钟试讲', () => {
    dialogOpener = null;
    dialog.close();
    openScene(2);
  }, 'primary', 'arrowRight', true), refs);
}
let updateMapSelection: (focus?: 'pin'|'timeline') => void;
function select(index: number, focus?: 'pin'|'timeline') {
  selected = index;
  updateMapSelection(focus);
}
function renderMap(restoreFocus = false) {
  mapResize?.disconnect();
  mode = 'map';
  const shell = element('section','shell');
  const header = element('header','top');
  const actions = element('div','top-actions');
  actions.append(control('课堂回顾',openReview),control('教师备课',openTeacher),fullscreenButton());
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
  const segments = route.slice(1).map(() => element('span','route'));
  world.append(...segments);
  const pins = events.map((e,i) => {
    const node = control(e.name, () => select(i,'pin'), 'pin');
    place(node,[e.lon,e.lat]);
    world.append(node);
    return node;
  });
  const card = element('article','event-card');
  const thumb = photo(events[selected].id, events[selected].name+'情境缩略图');
  const copy = element('div','event-copy');
  const date = element('time');
  const title = element('h2');
  const question = element('p');
  const enterScene = control('进入场景',()=>openScene(selected),'primary','arrowRight',true);
  copy.append(date,title,question,enterScene);
  card.append(thumb,copy);
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
    segments.forEach((segment,i) => {
      const [ax,ay]=position(route[i]);
      const [bx,by]=position(route[i+1]);
      const dx=(bx-ax)*width/100,dy=(by-ay)*height/100;
      Object.assign(segment.style,{left:ax+'%',top:ay+'%',width:Math.hypot(dx,dy)+'px',
        transform:'rotate('+Math.atan2(dy,dx)+'rad)'});
    });
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
    const e=events[selected];
    thumb.src=mediaAssets[e.id];
    thumb.alt=e.name+'情境缩略图';
    date.textContent=e.date;
    title.textContent=e.name;
    question.textContent=e.intro;
    enterScene.setAttribute('aria-label','进入「'+e.name+'」场景');
    pins.forEach((node,i)=>node.setAttribute('aria-pressed',String(i===selected)));
    times.forEach((node,i)=>node.setAttribute('aria-current',String(i===selected)));
    segments.forEach((node,i)=>node.classList.toggle('past',i<[0,4,8][selected]));
    if (focus) {
      replayAnimation(card,'is-switching');
      const [x,y] = position([e.lon,e.lat]);
      const targetX = map.clientWidth*(map.clientWidth<=720 ? .5 : .65);
      const targetY = map.clientHeight*(map.clientWidth<=720 ? .33 : .47);
      const focusAmount = Math.max(.14,Math.min(1,(zoom-1)*2));
      pan = [(targetX-origin[0]-width*zoom*x/100)*focusAmount,
        (targetY-origin[1]-height*zoom*y/100)*focusAmount];
      moveCamera(true);
      (focus==='pin'?pins:times)[selected].focus({preventScroll:true});
    }
  };
  updateMapSelection();
  layout();
  if (restoreFocus) times[selected].focus({preventScroll:true});
}
function showZunyiMaterials(index?: number) {
  const columns = element('div','materials');
  const items = index===undefined ? zunyiMaterials : [zunyiMaterials[index]];
  for (const item of items) {
    const card = element('article','material');
    if (index===undefined) card.append(element('h3','',item.title));
    for (const line of item.lines) card.append(element('p','',line));
    const source = element('p','source');
    source.append(citation(item.source,item.url));
    card.append(source);
    columns.append(card);
  }
  const footer = element('div','dialog-split');
  if (index!==undefined) footer.append(control('并排对照',()=>showZunyiMaterials(),'primary'));
  else footer.append(element('p','comparison-prompt','结合两份材料，说说遵义会议为什么成为转折点。'));
  dialog.classList.toggle('comparison',index===undefined);
  modal(index===undefined ? '两份史料对照' : items[0].title,columns,footer);
}
function showEvidence(e: CourseEvent, title: string) {
  const list=element('ul');
  e.card.forEach(line=>list.append(element('li','',line)));
  const source=element('p','source');
  source.append(citation(e.source,e.url));
  modal(title,list,source);
}
function showBridgeMaterials() {
  const form = element('form','bridge-form');
  const view = photo('yudu','浮桥近景，桥面下可见船体');
  view.className = 'bridge-view';
  const choices = element('fieldset','bridge-choices');
  const legend = element('legend','','观察画面，哪两种材料用来搭这座浮桥？');
  const inputs = ['木船','石块','木板'].map(material=>{
    const label = element('label');
    const input = element('input');
    input.type = 'checkbox';
    label.append(input,element('span','',material));
    choices.append(label);
    return input;
  });
  choices.prepend(legend);
  const feedback = element('p','activity-feedback');
  feedback.setAttribute('role','status');
  const footer = element('div','dialog-split');
  const check = control('核对材料',()=>{
    const wrong = inputs[1].checked;
    feedback.dataset.state = wrong ? 'hint' : 'ok';
    feedback.replaceChildren(
      svgIcon(wrong ? 'info' : 'check'),
      element('span','',wrong
        ? '再观察画面：桥面铺设的是什么材料？桥下又靠什么托浮在水面上？'
        : '回答正确：木船和木板。船体托住桥面，木板铺成通道——当地群众拿出门板、床板等木料支援架桥。')
    );
  },'primary','check');
  check.disabled = true;
  footer.append(check);
  const source = element('p','source');
  source.append(citation('于都县人民政府 · 长征渡河资料',bridgeSource));
  form.append(view,choices,footer,feedback,source);
  form.addEventListener('submit',event=>event.preventDefault());
  form.addEventListener('change',()=>{
    delete feedback.dataset.state;
    feedback.replaceChildren();
    const count = inputs.filter(input=>input.checked).length;
    check.disabled = count!==2;
  });
  modal('搭桥材料',form);
}
function showTroopComparison() {
  const chart = element('div','troop-chart');
  [
    ['长征出发时','8.6 万余人',100],['渡过湘江后','3 万余人',35],
  ].forEach(([label,count,ratio], idx)=>{
    const row = element('div','troop-row');
    const text = element('div','troop-label');
    text.append(element('span','',label),element('strong','',String(count)));
    const track = element('div','troop-track');
    track.setAttribute('aria-hidden','true');
    const bar = element('span','troop-bar');
    bar.style.width = ratio+'%';
    bar.style.animationDelay = (idx * 90) + 'ms';
    track.append(bar);
    row.append(text,track);
    chart.append(row);
  });
  const explanation = element('p','activity-feedback','这两组数字分别对应长征出发和渡过湘江两个时点。两者的差额包含这段行程中的多种减员，不能直接当作湘江战役阵亡人数。');
  explanation.hidden = true;
  const reveal = control('查看口径说明',()=>{
    explanation.hidden = !explanation.hidden;
    reveal.textContent = explanation.hidden ? '查看口径说明' : '收起口径说明';
    reveal.setAttribute('aria-expanded',String(!explanation.hidden));
  });
  reveal.setAttribute('aria-expanded','false');
  const footer = element('div','dialog-split');
  footer.append(reveal);
  const source = element('p','source');
  source.append(citation('中国共产党一百年大事记',chronology));
  modal('兵力对照',chart,footer,explanation,source);
}
function openScene(index: number, returnToReview?: () => void) {
  mapResize?.disconnect();
  mode='scene';
  selected=index;
  caption=0;
  const e=events[index];
  const scene=element('section','scene');
  const stage=element('div','scene-stage');
  const media=element('div','scene-media');
  const poster=photo(e.id,e.name+'情境示意');
  const video=element('video');
  video.src=mediaAssets[e.id+'-video'];
  video.poster=mediaAssets[e.id];
  video.preload='metadata';
  video.muted=true;
  video.loop=true;
  video.playsInline=true;
  video.hidden=true;
  let hotspotOrder = 0;
  function addHotspot(label: string, [x,y]: number[], open: () => void) {
    const key = e.id+':'+label;
    const visited = visitedHotspots.has(key);
    const hotspot=control(label,()=>{
      visitedHotspots.add(key);
      hotspot.dataset.visited='true';
      setButtonContent(hotspot,label,'check');
      video.pause();
      open();
    },'hotspot',visited?'check':'plus');
    if (visited) hotspot.dataset.visited='true';
    hotspot.setAttribute('aria-label',label+(visited?'（已查看）':''));
    hotspot.style.left=x+'%';
    hotspot.style.top=y+'%';
    hotspot.style.setProperty('--delay',(hotspotOrder++ * 65)+'ms');
    media.append(hotspot);
  }
  media.append(poster,video,element('div','scene-shade'));
  if (e.id==='zunyi') {
    zunyiMaterials.forEach((item,i)=>addHotspot(item.title,item.spot,()=>showZunyiMaterials(i)));
  } else {
    const {hotspot,spot} = e;
    addHotspot(hotspot,spot,()=>showEvidence(e,hotspot));
    if (e.id==='yudu') addHotspot('搭桥材料',[74,63],showBridgeMaterials);
    else addHotspot('兵力对照',[65,58],showTroopComparison);
  }
  stage.append(media);
  const heading=element('header','scene-head');
  const name=element('div');
  name.append(element('h1','',e.name),element('p','scene-date',e.place+' · '+e.date));
  const tools=element('div','scene-actions');
  const play=control('播放短片',async () => {
    if (!video.paused) {video.pause();return;}
    try {
      video.hidden=false;
      await video.play();
      if (!video.hidden && mode==='scene' && selected===index) {
        requestAnimationFrame(()=>{
          if (!video.hidden) video.classList.add('is-visible');
        });
      }
    } catch {
      if (!video.hidden && mode==='scene' && selected===index) usePoster(true);
    }
  },'','play');
  const still=control('静态画面',()=>usePoster(),'','image');
  still.disabled=true;
  still.setAttribute('aria-pressed','true');
  const playStatus=element('span','status-text');
  playStatus.setAttribute('aria-live','polite');
  const back=()=>{video.pause();renderMap(true);};
  const finish=()=>{
    video.pause();
    if (returnToReview || e.id==='zunyi') (returnToReview ?? openReview)();
    else back();
  };
  const backLabel = returnToReview ? '返回回顾' : '返回地图';
  tools.append(play,still,fullscreenButton(),control(backLabel,returnToReview ? finish : back,'','arrowLeft'));
  heading.append(name,tools);
  const captionBox=element('section','caption');
  const meta=element('div','caption-meta');
  const progress=element('span');
  meta.append(progress,element('span','','情境示意'));
  const track=element('div','caption-track');
  track.setAttribute('aria-hidden','true');
  const fill=element('span','caption-fill');
  track.append(fill);
  const narration=element('p');
  narration.setAttribute('aria-live','polite');
  const navigation=element('div','scene-navigation');
  const prev=control('上一句',()=>step(-1),'','arrowLeft');
  const next=control('下一句',()=>caption===e.captions.length-1?finish():step(1),'primary','arrowRight',true);
  navigation.append(prev,control('教师提示',()=>{video.pause();modal('教师提示',element('p','',e.notes[caption]));},'','info'),next);
  if (e.id==='zunyi') navigation.insertBefore(control('对照材料',()=>{
    video.pause();
    showZunyiMaterials();
  }),next);
  captionBox.append(meta,track,narration,navigation,playStatus);
  scene.append(stage,heading,captionBox);
  app.replaceChildren(scene);
  const sizeMedia=()=>{
    media.style.width=Math.max(scene.clientWidth,scene.clientHeight*16/9)+'px';
  };
  mapResize=new ResizeObserver(sizeMedia);
  mapResize.observe(scene);
  sizeMedia();
  function syncMediaState() {
    still.disabled = video.hidden;
    still.setAttribute('aria-pressed', String(video.hidden));
  }
  function usePoster(failed=false) {
    video.pause();
    video.classList.remove('is-visible');
    video.hidden=true;
    if (video.readyState>0) video.currentTime=0;
    setButtonContent(play,'播放短片','play');
    syncMediaState();
    playStatus.textContent=failed?'短片无法播放。':'';
  }
  video.addEventListener('play',()=>{
    setButtonContent(play,'暂停短片','pause');
    syncMediaState();
    playStatus.textContent='';
  });
  video.addEventListener('pause',()=>{
    if (video.hidden) return;
    if (video.ended) {
      setButtonContent(play,'重播短片','play');
    } else {
      setButtonContent(play,'继续播放','play');
    }
  });
  video.addEventListener('ended',()=>{
    setButtonContent(play,'重播短片','play');
  });
  video.addEventListener('error',()=>usePoster(true));
  function step(direction: number) {
    caption=Math.min(e.captions.length-1,Math.max(0,caption+direction));
    progress.textContent='教师讲解  '+(caption+1)+' / '+e.captions.length;
    fill.style.transform='scaleX('+((caption+1)/e.captions.length)+')';
    narration.textContent=e.captions[caption];
    if (direction!==0) replayAnimation(narration,'is-stepping');
    prev.disabled=caption===0;
    const isLast = caption===e.captions.length-1;
    const nextLabel = isLast
      ? (returnToReview ? '完成并返回回顾' : e.id==='zunyi' ? '进入课堂回顾' : '完成本节，返回地图')
      : '下一句';
    setButtonContent(next,nextLabel,'arrowRight',true);
  }
  step(0);
  if (reducedMotion.matches) usePoster();
  scene.addEventListener('keydown',ev=>{
    if (dialog.open || ev.altKey || ev.ctrlKey || ev.metaKey) return;
    if (ev.key==='ArrowRight' || ev.key==='ArrowLeft') {
      ev.preventDefault();
      step(ev.key==='ArrowRight'?1:-1);
    }
  });
  next.focus({preventScroll:true});
}
renderMap();
