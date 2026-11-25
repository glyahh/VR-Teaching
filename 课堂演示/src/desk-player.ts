function playDeskHandoff(frame:HTMLElement, handoff:HallHandoff, poster:HTMLImageElement, target:[number,number]) {
  const layer = element('div','desk-handoff');
  layer.setAttribute('aria-hidden','true');
  const outgoing = handoff.closeup ?? handoff.frame;
  const landing = element('img');
  landing.src = poster.src;
  landing.alt = '';
  landing.hidden = !handoff.anchor;
  if (handoff.closeup) layer.append(handoff.frame);
  layer.append(outgoing,landing);
  frame.append(layer);
  const point = (at: number[]) => (100*at[0])+'% '+(100*at[1])+'%';
  const align = ([x,y]: number[]) => {
    const scale = Math.max(1.46, .5 / Math.min(x,1-x,y,1-y));
    return 'translate('+(50-x*100)+'%, '+(50-y*100)+'%) scale('+scale+')';
  };
  const remove = () => layer.remove();
  if (handoff.anchor) {
    outgoing.style.transformOrigin = point(handoff.anchor);
    landing.style.transformOrigin = point(target);
    animatePart(landing,[
      {opacity:0,transform:align(target)}, {opacity:0,transform:align(target),offset:.3},
      {opacity:1,transform:align(target),offset:.63},{opacity:1,transform:'none'},
    ],820,0,'linear');
  }
  const motion = handoff.anchor ? [
    {opacity:handoff.closeup ? 0 : 1,transform:'none'},
    {opacity:1,transform:'none',offset:.21}, {opacity:1,transform:align(handoff.anchor),offset:.36},
    {opacity:0,transform:align(handoff.anchor),offset:.64}, {opacity:0,transform:align(handoff.anchor)},
  ] : [{opacity:1},{opacity:0}];
  const fade = animatePart(outgoing,motion,handoff.anchor ? 820 : 320,0,'linear');
  if (fade) void fade.finished.then(remove,remove);
  else remove();
}


type DeskPlayer = {
  transport:HTMLElement;
  read:()=>DeskView;
  restore:(state:DeskView)=>void;
  setClues:(clues:HallClue[])=>void;
  dismiss:()=>void;
  dispose:()=>void;
};

let currentDesk:DeskPlayer|undefined;
let standaloneDesk=location.hash==='#desk';
const deskHistory=new Map<string,DeskSaved>();

function resetDeskHistory() {
  deskHistory.clear();
  standaloneDesk=false;
}

function releaseDesk() {
  currentDesk?.dispose();
  currentDesk=undefined;
  deskAddress=undefined;
}

const deskHoverLabels:Readonly<Record<string,string|undefined>> = {
  left:'会前手记',right:'会议材料','page-forward':'会前手记 · 点击读，拖动翻页',
  'page-back':'会前手记 · 点击读，拖动翻页',cord:'会议材料 · 点击读，拖动解绳',
  cover:'会议材料 · 点击读，拖动揭封','before-sheet':'会前摘录 · 点击读，拖动移放',
  'discussion-sheet':'会议讨论 · 点击读，拖动移放',map:'行军图 · 点击看路线',
  overlay:'行军图 · 点击看路线，向右拖可折起',table:'',
};

function mountDesk(stage:HTMLElement, position:number, handoff?:HallHandoff):DeskPlayer {
  const historyKey=(standaloneDesk?'standalone:':'lesson:')+position;
  const frame=element('div','desk-live-frame');
  frame.tabIndex=projectionMode?-1:0;
  frame.dataset.space='loading';
  frame.setAttribute('aria-label','会前的桌边，三维观察区');
  const poster=photo('desk-front','遵义会议室桌边');
  poster.className='desk-live-still';
  const canvas=element('canvas','desk-live-canvas');
  canvas.hidden=true;
  const pinLayer=element('div','desk-live-pins');
  const guide=element('p','desk-inquiry-cue scene-note');
  guide.hidden=true;
  const tools=element('div','desk-orbit-tools');
  tools.setAttribute('role','group');
  tools.setAttribute('aria-label','桌面视角');
  const zoomOut=control('−',()=>session.zoom(1/1.13),'desk-orbit-button');
  const zoomIn=control('+',()=>session.zoom(1.13),'desk-orbit-button');
  zoomOut.setAttribute('aria-label','拉远桌面');
  zoomIn.setAttribute('aria-label','拉近桌面');
  const home=control('',()=>session.home(),'desk-orbit-button desk-live-home');
  setIconButton(home,'回到正面机位','reset');
  const overhead=control('俯看',()=>session.overhead(),'desk-orbit-button desk-orbit-overhead');
  overhead.setAttribute('aria-label','俯看桌面');
  tools.append(overhead,zoomOut,zoomIn,home);
  const transport=element('div','desk-live-transport');
  const cluesGroup=element('div','desk-clue-pills');
  cluesGroup.hidden=true;
  transport.append(cluesGroup);
  const manifest=JSON.parse(mediaAssets['desk-manifest']);
  const anchors:Record<DeskObject,Point>={journal:manifest.anchorUV.left,dossier:manifest.anchorUV.right,map:[.707,.80]};
  let clues:HallClue[]=retainedHallClues.slice();
  let disposed=false;
  let focusReturn:HTMLElement|undefined;
  let focusedPin:DeskTarget|undefined;
  let shownReading:DeskReading|undefined;
  let lastPositioned:DeskView|undefined;
  let clueButtons:HTMLButtonElement[]=[];

  const entries=[
    {object:'journal',target:'left',name:'翻阅左册 · 会前形势',open:()=>session.openReading({kind:'journal'})},
    {object:'dossier',target:'right',name:'翻阅右册 · 会议讨论',open:()=>session.openReading({kind:'dossier'})},
    {object:'map',target:'map',name:'查看行军路线图',open:()=>session.openMap()},
  ] satisfies {object:DeskObject;target:DeskTarget;name:string;open:()=>void}[];
  const pins=entries.map(({object,target,name,open})=>{
    const pin=explorationStage.markScenePoint(control('',()=>{focusReturn=pin;open();},'desk-live-pin'),name);
    pin.dataset.object=object;
    for (const event of ['focus','pointerenter']) pin.addEventListener(event,()=>{focusedPin=target;showGuide();});
    for (const event of ['blur','pointerleave']) pin.addEventListener(event,()=>{focusedPin=undefined;showGuide();});
    pinLayer.append(pin);
    return {object,target,pin};
  });
  const targets=(['page-forward','page-back','cord','cover','before-sheet','discussion-sheet','map','overlay','table'] as const)
    .map(target=>{
      const anchor=element('span','desk-object-position');
      anchor.dataset.deskTarget=target;
      anchor.setAttribute('aria-hidden','true');
      anchor.hidden=true;
      pinLayer.append(anchor);
      return {target,anchor};
    });

  frame.append(poster,canvas,pinLayer,guide,tools);
  stage.append(frame);
  const session=mountDeskSession(frame,canvas,projectionMode?freshDesk():deskHistory.get(historyKey)??freshDesk(),
    (view,publish)=>{paint(view);if (publish) publishDesk(view);});
  const reader=mountDeskReader(stage,session,dismiss);
  if (handoff) requestAnimationFrame(()=>{
    if (frame.isConnected) playDeskHandoff(frame,handoff,poster,anchors.dossier);
  });

  function renderClues() {
    cluesGroup.hidden=projectionMode || !clues.length;
    clueButtons=clues.map((item,index)=>{
      const button=control(item.title,()=>{
        focusReturn=button;
        session.openReading({kind:'clue',index,source:item.kind==='route'?'map':'journal'});
      },'desk-live-clue','layers');
      return button;
    });
    cluesGroup.replaceChildren(...clueButtons);
  }
  function dismiss() {
    const wasOpen=!!session.read().reading;
    session.dismiss();
    if (!wasOpen || projectionMode) return;
    const target=focusReturn?.isConnected && !focusReturn.hidden ? focusReturn : frame;
    focusReturn=undefined;
    target.focus({preventScroll:true});
  }

  function setPosition(node:HTMLElement,point:readonly number[]) {
    node.style.left=(point[0]*100)+'%';
    node.style.top=(point[1]*100)+'%';
  }
  function usablePoint(point:readonly number[]|undefined):point is readonly number[] {
    return !!point && point.length===2 && point.every(value=>Number.isFinite(value) && value>=0 && value<=1);
  }
  function pinPoint(object:DeskObject,target:DeskTarget,view:DeskView) {
    const mapTarget=object==='map' && view.saved.map!=='stored' ? 'overlay' : target;
    const result=session.world?.project(mapTarget,view);
    return usablePoint(result) ? result : anchors[object];
  }
  function readerAnchor(view:DeskView):Point {
    const reading=view.reading;
    if (!reading || reading.kind==='compare') return [.5,.52];
    const object=reading.kind==='map' || reading.kind==='clue' && reading.source==='map' ? 'map'
      : reading.kind==='dossier' || reading.kind==='sheet' && reading.id==='discussion' ? 'dossier' : 'journal';
    const target=object==='map' ? 'map' : object==='dossier' ? 'right' : 'left';
    const point=pinPoint(object,target,view);
    const bounds=frame.getBoundingClientRect(), outer=stage.getBoundingClientRect();
    return outer.width && outer.height ? [
      (bounds.left-outer.left+point[0]*bounds.width)/outer.width,
      (bounds.top-outer.top+point[1]*bounds.height)/outer.height,
    ] : [.5,.55];
  }

  function showGuide() {
    const {reading,preview}=session.read();
    const target=focusedPin??frame.dataset.hover??'';
    const message=projectionMode || reading || preview ? '' : deskHoverLabels[target]??'';
    guide.hidden=!message;
    if (guide.textContent!==message) guide.textContent=message;
  }

  function paint(view:DeskView) {
    if (disposed) return;
    const {saved,preview,reading}=view;
    const camera=view.camera??saved.camera;
    const usable=!!session.world;
    frame.dataset.yaw=camera.yaw.toFixed(3);
    frame.dataset.pitch=camera.pitch.toFixed(3);
    frame.dataset.zoom=camera.zoom.toFixed(4);
    frame.dataset.focus=(view.focus?.amount??0).toFixed(3);
    frame.dataset.spread=String(saved.spread);
    frame.dataset.dossier=saved.dossier;
    frame.dataset.map=saved.map;
    frame.dataset.gesture=preview?.kind??'';
    frame.dataset.progress=preview && 'progress' in preview?preview.progress.toFixed(3):'';
    frame.dataset.reading=reading?.kind??'';
    if (preview?.kind==='page') frame.dataset.direction=preview.direction;
    else delete frame.dataset.direction;
    for (const id of deskMaterials) {
      const sheet=saved.sheets.find(candidate=>candidate.id===id);
      frame.setAttribute('data-sheet-'+id,sheet ? [sheet.at.x.toFixed(4),sheet.at.z.toFixed(4)].join(',') : '');
    }

    const seen=saved.seen??[];
    const right=seen.includes('dossier') || saved.sheets.some(sheet=>sheet.id==='discussion');
    const left=seen.includes('journal') || saved.spread>0;
    const finished=left && right;
    frame.dataset.inquiry=finished?'done':'active';
    if (!projectionMode && finished) revealed.add('materials-compared');

    const moving=!!preview && preview.kind!=='inspect';
    for (const {object,target,pin} of pins) {
      pin.hidden=projectionMode || !!reading || moving;
      pin.dataset.seen=String(seen.includes(object));
      if (seen.includes(object)) pin.setAttribute('aria-description','已查看，可再次打开');
      else pin.removeAttribute('aria-description');
      if (!pin.hidden) {
        const point=pinPoint(object,target,view);
        const clearance=object==='map' && usable ? 29/Math.max(1,frame.clientWidth) : 0;
        setPosition(pin,[deskClamp(point[0]+clearance,.028,.972),deskClamp(point[1],.07,.93)]);
      }
    }
    if (usable && (!lastPositioned || lastPositioned.camera!==view.camera || lastPositioned.focus!==view.focus ||
      lastPositioned.saved!==saved || lastPositioned.preview!==preview)) {
      lastPositioned=view;
      for (const {target,anchor} of targets) {
        const point=session.world?.project(target,view);
        anchor.hidden=!usablePoint(point);
        if (usablePoint(point)) setPosition(anchor,point);
      }
    }

    tools.hidden=projectionMode || !usable || !!reading;
    zoomOut.setAttribute('aria-disabled',String(camera.zoom<=.921));
    zoomIn.setAttribute('aria-disabled',String(camera.zoom>=1.279));
    overhead.setAttribute('aria-pressed',String(camera.pitch>=13));
    home.setAttribute('aria-disabled',String(Math.abs(camera.yaw)<.1 && Math.abs(camera.pitch)<.1 && Math.abs(camera.zoom-1)<.01));
    clueButtons.forEach((button,index)=>button.setAttribute('aria-pressed',String(
      reading?.kind==='clue' && reading.index===index || reading?.kind==='compare' && reading.clueIndex===index,
    )));
    showGuide();
    const changing=shownReading?.kind!==reading?.kind;
    reader.paint(view,clues,changing ? readerAnchor(view) : [.5,.5]);
    shownReading=reading;
  }

  function resize() {
    const width=Math.min(stage.clientWidth,stage.clientHeight*16/9);
    if (width<=0 || disposed) return;
    frame.style.width=width+'px';
    const pixels=Math.max(320,Math.min(1600,Math.round(width*Math.min(devicePixelRatio,1.5)/16)*16));
    session.resize(pixels,pixels*9/16);
  }
  const observer=new ResizeObserver(resize);
  observer.observe(stage);
  function fallback() {
    if (disposed) return;
    frame.dataset.space='fixed';
    canvas.hidden=true;
    session.releaseWorld();
    for (const {anchor} of targets) anchor.hidden=true;
    paint(session.read());
  }
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fallback();});
  explorationStage.createDeskWorld(canvas,mediaAssets).then(world=>{
    if (disposed) {world.dispose();return;}
    canvas.hidden=false;
    frame.dataset.space='ready';
    session.connect(world);
    resize();
    animatePart(canvas,[{opacity:0},{opacity:1}],180);
  }).catch(fallback);
  renderClues();
  paint(session.read());
  beginDeskVisit(position);
  queueMicrotask(()=>{if (!disposed) publishDesk(session.read());});
  return {
    transport,read:session.read,restore:session.restore,
    setClues(next) {
      clues=next.slice();
      renderClues();
      paint(session.read());
    },
    dismiss,
    dispose() {
      disposed=true;
      observer.disconnect();
      reader.dispose();
      const saved=session.leave();
      if (!projectionMode) deskHistory.set(historyKey,saved);
    },
  };
}
