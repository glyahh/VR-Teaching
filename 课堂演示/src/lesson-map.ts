const places: [string, number, number][] = [
  ['贵州',106.37,26.22],['湖南',112.15,28.3],['江西',116.6,27.35],['广西',109.2,24.58],['广东',114.1,24.54],
];

let savedMapCamera: {zoom: number; pan: Point; angle: TerrainAngle} = {
  zoom: 1, pan: [0,0], angle: mapHomeAngle,
};

function mountLessonMap({root, chapter, restoreFocus, onSelect, onEnter, onStart, onReview}: {
  root: HTMLElement;
  chapter: number;
  restoreFocus: boolean;
  onSelect: (index: number) => void;
  onEnter: (index: number) => void;
  onStart: () => void;
  onReview: () => void;
}) {
  let selected = chapter;
  let {zoom, pan, angle: mapAngle} = savedMapCamera;
  const shell = element('section','shell');
  const header = element('header','top');
  const actions = element('div','top-actions');
  actions.append(lessonControl('review','课堂回顾',onReview));
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
  const enterScene = lessonControl('enter-scene','进入场景',()=>onEnter(selected),'','arrowRight',true);
  const start = lessonControl('start','开始授课',onStart,'primary','arrowRight',true);
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
    moveCamera();
  });
  function resetMapCamera() {
    zoom=1;
    pan=[0,0];
    mapAngle=mapHomeAngle;
    cardMotion.reset();
    moveCamera(true);
  }
  const resetView = control('',resetMapCamera);
  setIconButton(zoomOut,'缩小地图（快捷键 -）','minus');
  setIconButton(zoomIn,'放大地图（快捷键 +）','plus');
  setIconButton(resetView,'重置地图视角（快捷键 0）','reset');
  zoomTools.append(zoomOut,zoomReadout,zoomIn,view,resetView);
  tools.append(zoomTools);
  const timeline = element('nav','timeline chapter-rail chapter-rail--tabs');
  timeline.setAttribute('aria-label','时间轴');
  const times = events.map((e,i) => {
    const node = lessonControl('time-'+i,'',()=>select(i,'timeline'),'time-button chapter-link');
    node.append(element('time','',e.timeline),element('strong','',e.name));
    timeline.append(node);
    return node;
  });
  const mapFooter = element('div','map-footer bottom-rail');
  mapFooter.append(timeline,tools);
  map.append(mapFooter);
  shell.append(header,map);
  root.replaceChildren(shell);
  const cardMotion = mountMapCard(map,card,mapFooter);
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
  function moveCamera(animate = false) {
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
    moveCamera(animate);
  }
  const resize = new ResizeObserver(layout);
  resize.observe(map);
  resize.observe(mapFooter);
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
      resetMapCamera();
    }
  });
  function select(index: number, focus?: 'pin' | 'timeline') {
    selected = index;
    onSelect(index);
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
  }
  select(chapter);
  layout();
  if (restoreFocus) times[selected].focus({preventScroll:true});
  startPageEntry(shell, [[header,'top'],[card,'left'],[mapFooter,'bottom']],thumb);
  return {
    start,
    dispose() {
      savedMapCamera = {zoom, pan, angle: mapAngle};
      resize.disconnect();
      cardMotion.dispose();
    },
  };
}

function captureMapExit(root: HTMLElement): HTMLCanvasElement | undefined {
  if (reducedMotion.matches) return;
  const map = root.querySelector<HTMLElement>('.map');
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
