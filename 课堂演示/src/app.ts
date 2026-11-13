type CourseEvent = typeof events[number];
type Point = [number, number];
const app = document.querySelector<HTMLElement>('#app')!;
const dialog = document.querySelector<HTMLDialogElement>('#dialog')!;
const closeDialog = document.querySelector<HTMLButtonElement>('#close-dialog')!;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const route: Point[] = [[115.41,25.95],[114.94,25.39],[113.95,25.55],[112.95,25.40],
  [110.73,25.83],[109.67,26.16],[109.14,26.23],[107.47,27.32],[106.93,27.69]];
const places: [string, number, number][] = [
  ['贵州',106.37,26.22],['湖南',112.15,28.3],['江西',116.6,27.35],['广西',109.2,24.58],['广东',114.1,24.54],
];
let selected = 0;
let caption = 0;
let mode: 'map'|'scene' = 'map';
let mapResize: ResizeObserver | undefined;
let zoom = 1;
let pan: Point = [0,0];

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', content = '') {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = content;
  return node;
}
function control(label: string, act: () => void, className = '') {
  const node = element('button', className, label);
  node.type = 'button';
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
function modal(title: string, ...nodes: HTMLElement[]) {
  document.querySelector('#dialog-title')!.textContent = title;
  document.querySelector('#dialog-content')!.replaceChildren(...nodes);
  dialog.showModal();
}
closeDialog.onclick = () => dialog.close();

function fullscreenButton() {
  const button = control('全屏', async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      modal('全屏显示', element('p', '', '浏览器未切换全屏。可按 F11 全屏显示。'));
    }
  });
  const update = () => button.textContent = document.fullscreenElement ? '退出全屏' : '全屏';
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
  const controls = element('div', 'dialog-split');
  events.forEach((e,i) => controls.append(control(e.name, () => {dialog.close(); select(i);})));
  modal('课堂回顾', element('p','', '用一条史料，说明于都出发、湘江战役与遵义会议之间的关系。'),
    element('p','source','提示：从哪里出发？经历了什么挫折？会议集中解决了哪些问题？'), controls);
}
function openTeacher() {
  const lesson = element('ol');
  for (const text of ['地图导入 2 分钟','三个场景各讲 3 分钟','课堂回顾 4 分钟']) lesson.append(element('li','',text));
  const refs = element('div','dialog-split');
  refs.append(citation('长征专题', history), citation('中国共产党一百年大事记', chronology), citation('地形底图',terrainSource));
  modal('教师备课', lesson, control('遵义会议 3 分钟试讲', () => {dialog.close(); openScene(2);}, 'primary'), refs);
}
let updateMapSelection: (focus?: 'pin'|'timeline') => void;
function select(index: number, focus?: 'pin'|'timeline') {
  selected = index;
  updateMapSelection(focus);
}
function renderMap() {
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
  world.append(photo('terrain','长征阶段所经区域的地形晕渲'));
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
  const thumb = photo(events[selected].id);
  const copy = element('div','event-copy');
  const date = element('time');
  const title = element('h2');
  const question = element('p');
  copy.append(date,title,question,control('进入场景',()=>openScene(selected),'primary'));
  card.append(thumb,copy);
  map.append(card);
  const tools = element('div','map-tools');
  const zoomTools = element('div','zoom');
  zoomTools.append(control('缩小',()=>changeZoom(-.25)),control('放大',()=>changeZoom(.25)),
    control('复位',()=>{zoom=1;pan=[0,0];layout();}));
  tools.append(zoomTools,element('p','','阶段节点示意'));
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
  function layout() {
    const narrow = map.clientWidth < 721;
    const width = map.clientWidth * (narrow ? 1.06 : .77);
    const height = map.clientHeight * (narrow ? .66 : .92);
    world.style.width = width+'px';
    world.style.height = height+'px';
    const x = (narrow ? 0 : map.clientWidth*.23) - (zoom-1)*width/2 + pan[0];
    const y = map.clientHeight*(narrow?.025:.035) - (zoom-1)*height/2 + pan[1];
    world.style.transform = 'translate('+x+'px,'+y+'px) scale('+zoom+')';
    segments.forEach((segment,i) => {
      const [ax,ay]=position(route[i]);
      const [bx,by]=position(route[i+1]);
      const dx=(bx-ax)*width/100,dy=(by-ay)*height/100;
      Object.assign(segment.style,{left:ax+'%',top:ay+'%',width:Math.hypot(dx,dy)+'px',
        transform:'rotate('+Math.atan2(dy,dx)+'rad)'});
    });
  }
  function changeZoom(amount: number) {
    zoom = Math.max(1,Math.min(2,zoom+amount));
    if (zoom === 1) pan = [0,0];
    layout();
  }
  mapResize=new ResizeObserver(layout);
  mapResize.observe(map);
  let drag: {id:number;x:number;y:number;start:Point} | undefined;
  map.addEventListener('pointerdown', e => {
    if ((e.target as HTMLElement).closest('button,.event-card,.map-tools') || zoom===1) return;
    drag={id:e.pointerId,x:e.clientX,y:e.clientY,start:[...pan]};
    map.setPointerCapture(e.pointerId);
  });
  map.addEventListener('pointermove', e => {
    if (!drag || drag.id!==e.pointerId) return;
    const dx=world.clientWidth*(zoom-1)/2,dy=world.clientHeight*(zoom-1)/2;
    pan=[Math.max(-dx,Math.min(dx,drag.start[0]+e.clientX-drag.x)),
      Math.max(-dy,Math.min(dy,drag.start[1]+e.clientY-drag.y))];
    layout();
  });
  for (const type of ['pointerup','pointercancel','lostpointercapture']) map.addEventListener(type,()=>drag=undefined);
  updateMapSelection = (focus) => {
    const e=events[selected];
    thumb.src=mediaAssets[e.id];
    date.textContent=e.date;
    title.textContent=e.name;
    question.textContent=e.intro;
    pins.forEach((node,i)=>node.setAttribute('aria-pressed',String(i===selected)));
    times.forEach((node,i)=>node.setAttribute('aria-current',String(i===selected)));
    segments.forEach((node,i)=>node.classList.toggle('past',i<[0,4,8][selected]));
    if (focus) (focus==='pin'?pins:times)[selected].focus({preventScroll:true});
  };
  updateMapSelection();
  layout();
}
function showEvidence(e: CourseEvent) {
  const list=element('ul');
  e.card.forEach(line=>list.append(element('li','',line)));
  const source=element('p','source');
  source.append(citation(e.source,e.url));
  modal(e.hotspot,list,source);
}
function openScene(index: number) {
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
  video.playsInline=true;
  video.hidden=true;
  const hotspot=control(e.hotspot,()=>{video.pause();showEvidence(e);},'hotspot');
  hotspot.setAttribute('aria-label',e.hotspot);
  hotspot.style.left=e.spot[0]/12.8+'%';
  hotspot.style.top=e.spot[1]/7.2+'%';
  media.append(poster,video,element('div','scene-shade'),hotspot);
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
    } catch {
      if (!video.hidden && mode==='scene' && selected===index) usePoster(true);
    }
  });
  const still=control('静态讲解',()=>usePoster());
  const playStatus=element('span','');
  playStatus.setAttribute('aria-live','polite');
  const back=()=>{video.pause();renderMap();};
  tools.append(play,still,fullscreenButton(),control('返回地图',back));
  heading.append(name,tools);
  const captionBox=element('section','caption');
  const meta=element('div','caption-meta');
  const progress=element('span');
  meta.append(progress,element('span','','情境示意'));
  const narration=element('p');
  narration.setAttribute('aria-live','polite');
  const navigation=element('div','scene-navigation');
  const prev=control('上一句',()=>step(-1));
  const next=control('下一句',()=>caption===e.captions.length-1?back():step(1),'primary');
  navigation.append(prev,control('教师提示',()=>{video.pause();modal('教师提示',element('p','',e.notes[caption]));}),next);
  captionBox.append(meta,narration,navigation,playStatus);
  scene.append(stage,heading,captionBox);
  app.replaceChildren(scene);
  const sizeMedia=()=>{
    media.style.width=Math.max(scene.clientWidth,scene.clientHeight*16/9)+'px';
  };
  mapResize=new ResizeObserver(sizeMedia);
  mapResize.observe(scene);
  sizeMedia();
  function usePoster(failed=false) {
    video.pause();
    video.hidden=true;
    play.textContent='播放短片';
    playStatus.textContent=failed?'短片暂无法播放，已切到静态画面。':'';
  }
  video.addEventListener('play',()=>{play.textContent='暂停';playStatus.textContent='';});
  video.addEventListener('pause',()=>play.textContent=video.ended?'重播短片':video.hidden?'播放短片':'继续播放');
  video.addEventListener('ended',()=>play.textContent='重播短片');
  video.addEventListener('error',()=>usePoster(true));
  function step(direction: number) {
    caption=Math.min(e.captions.length-1,Math.max(0,caption+direction));
    progress.textContent='教师讲解  '+(caption+1)+' / '+e.captions.length;
    narration.textContent=e.captions[caption];
    prev.disabled=caption===0;
    next.textContent=caption===e.captions.length-1?'返回地图':'下一句';
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
