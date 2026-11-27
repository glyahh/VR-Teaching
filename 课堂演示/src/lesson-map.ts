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
  mountCourseDeveloperButton(actions);
  header.append(element('h1','course-title','从于都到遵义'),actions);
  const map = element('section','map');
  map.setAttribute('aria-label','长征阶段地图');
  const world = element('div','map-world');
  const terrain = createTerrainSurface(() => scheduleCamera());
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
    scheduleCamera(false);
  });
  view.hidden = !terrain.ready;
  function resetMapCamera() {
    zoom=1;
    pan=[0,0];
    mapAngle=mapHomeAngle;
    cardMotion.reset();
    scheduleCamera(true);
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
  const life = new AbortController();
  const { signal } = life;
  let mapWidth = 0;
  let mapHeight = 0;
  let viewportOrigin: Point = [0,0];
  let narrow = false;
  let width = 0;
  let height = 0;
  let origin: Point = [0,0];
  let footerHeight = 0;
  let cameraFrame = 0;
  let animateCamera = false;
  let projectedAngle: TerrainAngle | undefined;
  let projectedRelief: boolean | undefined;
  let renderedZoom = 0;
  let renderedTransform = '';

  function measureMapPosition() {
    const {left, top} = map.getBoundingClientRect();
    viewportOrigin = [left,top];
  }

  function layout() {
    measureMapPosition();
    const nextWidth = map.clientWidth;
    const nextHeight = map.clientHeight;
    const nextFooterHeight = mapFooter.offsetHeight;
    if (footerHeight !== nextFooterHeight) {
      footerHeight = nextFooterHeight;
      map.style.setProperty('--map-rail-height',footerHeight+'px');
    }
    if (mapWidth !== nextWidth || mapHeight !== nextHeight) {
      mapWidth = nextWidth;
      mapHeight = nextHeight;
      narrow = mapWidth <= 720;
      width = Math.max(mapWidth * (narrow ? 1.02 : .96), mapHeight * (narrow ? .56 : .93) * terrainAspect);
      height = width / terrainAspect;
      origin = narrow
        ? [(mapWidth-width)/2, mapHeight*.18]
        : [mapWidth*.60-width*.52, (mapHeight-height)/2];
      world.style.width = width+'px';
      world.style.height = height+'px';
      setPan(pan);
      scheduleCamera(false);
    }
  }

  function projectGeometry() {
    if (projectedAngle === mapAngle && projectedRelief === terrain.ready) return;
    projectedAngle = mapAngle;
    projectedRelief = terrain.ready;
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
  }

  function renderCamera() {
    cameraFrame = 0;
    projectGeometry();
    world.classList.toggle('ease-camera',animateCamera);
    const transform = `translate(${origin[0]+pan[0]}px, ${origin[1]+pan[1]}px) scale(${zoom})`;
    if (renderedTransform !== transform) {
      renderedTransform = transform;
      world.style.transform = transform;
    }
    if (renderedZoom === zoom) return;
    renderedZoom = zoom;
    world.style.setProperty('--inverse-zoom',String(1/zoom));
    zoomOut.disabled = zoom <= .85;
    zoomIn.disabled = zoom >= 2.5;
    zoomReadout.textContent = Math.round(zoom * 100) + '%';
  }

  function scheduleCamera(animate?: boolean) {
    if (animate !== undefined) animateCamera = animate && !reducedMotion.matches;
    if (!cameraFrame) cameraFrame = requestAnimationFrame(renderCamera);
  }

  function flushCamera() {
    if (!cameraFrame) return;
    cancelAnimationFrame(cameraFrame);
    animateCamera = false;
    renderCamera();
  }

  function setPan([x,y]: Point) {
    const limitX = Math.max(0,mapWidth*.28 + width*(zoom-1)/2);
    const limitY = Math.max(0,mapHeight*.24 + height*(zoom-1)/2);
    pan = [Math.max(-limitX,Math.min(limitX,x)), Math.max(-limitY,Math.min(limitY,y))];
  }

  function zoomAt(next: number, from: Point, to = from) {
    const previous = zoom;
    zoom = Math.max(.85,Math.min(2.5,next));
    if (zoom === previous && to === from) return;
    const ratio = zoom/previous;
    setPan([
      to[0]-origin[0]-(from[0]-origin[0]-pan[0])*ratio,
      to[1]-origin[1]-(from[1]-origin[1]-pan[1])*ratio,
    ]);
  }

  function changeZoom(next: number, anchor: Point = [mapWidth*.65,mapHeight*.48], animate = false) {
    zoomAt(next,anchor);
    scheduleCamera(animate);
  }

  function toMapPoint([x,y]: Point): Point {
    return [x-viewportOrigin[0],y-viewportOrigin[1]];
  }

  const resize = new ResizeObserver(layout);
  resize.observe(map);
  resize.observe(mapFooter);
  window.addEventListener('scroll',measureMapPosition,{passive:true,signal});

  type MapPointer = {id: number; touch: boolean; point: Point};
  type MapDrag = {kind: 'pan' | 'orbit'; pointer: MapPointer; start: Point; camera: Point};
  type MapPinch = {kind: 'pinch'; pointers: [MapPointer, MapPointer]};
  let gesture: MapDrag | MapPinch | undefined;

  function controlTarget(target: EventTarget | null) {
    return target instanceof Element && target.closest('button,.event-card,.map-tools,.timeline');
  }

  function startDrag(pointer: MapPointer, kind: MapDrag['kind']): MapDrag {
    return {kind,pointer,start:pointer.point,camera:kind === 'orbit' ? mapAngle : pan};
  }

  function pinchPosition([a,b]: MapPinch['pointers']) {
    return {
      center: toMapPoint([(a.point[0]+b.point[0])/2,(a.point[1]+b.point[1])/2]),
      distance: Math.max(1,Math.hypot(b.point[0]-a.point[0],b.point[1]-a.point[1])),
    };
  }

  map.addEventListener('wheel', event => {
    if (event.target instanceof Element && event.target.closest('.event-card,.map-tools,.timeline')) return;
    event.preventDefault();
    changeZoom(zoom*Math.exp(-Math.sign(event.deltaY)*.12),toMapPoint([event.clientX,event.clientY]));
  }, {passive:false,signal});
  map.addEventListener('contextmenu', event => {
    if (terrain.ready && !controlTarget(event.target)) event.preventDefault();
  }, {signal});
  map.addEventListener('pointerdown', event => {
    if (controlTarget(event.target)) return;
    const touch = event.pointerType === 'touch';
    const rightOrbit = event.pointerType === 'mouse' && event.button === 2 && terrain.ready;
    if (event.button !== 0 && !rightOrbit) return;
    const pointer: MapPointer = {id:event.pointerId,touch,point:[event.clientX,event.clientY]};
    if (gesture) {
      if (!touch || gesture.kind === 'pinch' || !gesture.pointer.touch) return;
      gesture = {kind:'pinch',pointers:[gesture.pointer,pointer]};
    } else {
      const orbit = rightOrbit || (terrain.ready && !touch && !event.shiftKey && zoom <= 1);
      gesture = startDrag(pointer,orbit ? 'orbit' : 'pan');
    }
    map.setPointerCapture(event.pointerId);
    map.classList.add('dragging');
  }, {signal});

  function movePointer(event: PointerEvent) {
    if (!gesture) return;
    const {pointerId, clientX, clientY} = event;
    if (gesture.kind === 'pinch') {
      const pointer = gesture.pointers.find(({id}) => id === pointerId);
      if (!pointer || (pointer.point[0] === clientX && pointer.point[1] === clientY)) return;
      const before = pinchPosition(gesture.pointers);
      pointer.point = [clientX,clientY];
      const after = pinchPosition(gesture.pointers);
      zoomAt(zoom * after.distance/before.distance,before.center,after.center);
    } else {
      const {pointer, start, camera} = gesture;
      if (pointer.id !== pointerId || (pointer.point[0] === clientX && pointer.point[1] === clientY)) return;
      pointer.point = [clientX,clientY];
      const dx = clientX-start[0], dy = clientY-start[1];
      if (gesture.kind === 'orbit') {
        const azimuth = Math.max(-38,Math.min(38,camera[0]+dx*.14));
        const tilt = Math.max(0,Math.min(55,camera[1]+dy*.16));
        if (azimuth === mapAngle[0] && tilt === mapAngle[1]) return;
        mapAngle = [azimuth,tilt];
      } else {
        setPan([camera[0]+dx,camera[1]+dy]);
      }
    }
    scheduleCamera(false);
  }

  function endPointer(event: PointerEvent) {
    if (!gesture) return;
    if (event.type === 'pointerup') movePointer(event);
    if (gesture.kind === 'pinch') {
      const [first, second] = gesture.pointers;
      if (event.pointerId === first.id) gesture = startDrag(second,'pan');
      else if (event.pointerId === second.id) gesture = startDrag(first,'pan');
    } else if (event.pointerId === gesture.pointer.id) {
      gesture = undefined;
      map.classList.remove('dragging');
    }
  }

  map.addEventListener('pointermove',movePointer,{signal});
  map.addEventListener('pointerup',endPointer,{signal});
  map.addEventListener('pointercancel',endPointer,{signal});
  map.addEventListener('lostpointercapture',endPointer,{signal});
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
  }, {signal});
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
      terrain.orient(mapAngle);
      const [x,y] = terrain.project(position(route[e.routeEnd]));
      const targetX = mapWidth*(narrow ? .5 : .65);
      const targetY = mapHeight*(narrow ? .33 : .47);
      const focusAmount = Math.max(.14,Math.min(1,(zoom-1)*2));
      setPan([(targetX-origin[0]-width*zoom*x/100)*focusAmount,
        (targetY-origin[1]-height*zoom*y/100)*focusAmount]);
      scheduleCamera(true);
      (focus==='pin'?pins:times)[selected].focus({preventScroll:true});
    }
  }
  select(chapter);
  layout();
  flushCamera();
  if (restoreFocus) times[selected].focus({preventScroll:true});
  startPageEntry(shell, [[header,'top'],[card,'left'],[mapFooter,'bottom']],thumb);
  return {
    start,
    capture() {
      if (reducedMotion.matches) return;
      flushCamera();
      return captureMapExit(map,terrain);
    },
    dispose() {
      savedMapCamera = {zoom, pan, angle: mapAngle};
      life.abort();
      cancelAnimationFrame(cameraFrame);
      terrain.onChange = () => {};
      resize.disconnect();
      cardMotion.dispose();
    },
  };
}

function captureMapExit(map: HTMLElement, terrain: TerrainSurface): HTMLCanvasElement | undefined {
  if (!terrain.ready) return;
  const canvas = terrain.element.querySelector('canvas');
  if (!canvas) return;
  const mapRect = map.getBoundingClientRect();
  const glRect = canvas.getBoundingClientRect();
  if (!mapRect.width || !mapRect.height || !glRect.width || !glRect.height) return;
  const shot = element('canvas', 'outgoing-image');
  shot.width = Math.max(1, Math.round(mapRect.width));
  shot.height = Math.max(1, Math.round(mapRect.height));
  shot.setAttribute('aria-hidden', 'true');
  const ctx = shot.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#161f19';
  ctx.fillRect(0, 0, shot.width, shot.height);
  const glCanvas = terrain.captureFrame();
  if (!glCanvas) return;
  try {
    ctx.drawImage(glCanvas, glRect.left - mapRect.left, glRect.top - mapRect.top, glRect.width, glRect.height);
  } catch {
    return;
  }
  return shot;
}
