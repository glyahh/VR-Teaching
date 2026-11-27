type DeskPlayer = {
  transport:HTMLElement;
  openObject:(object:DeskObject)=>boolean;
  dismiss:()=>void;
  dispose:()=>void;
};

let currentDesk:DeskPlayer|undefined;
let standaloneDesk=location.hash==='#desk';
const deskHistory=new Map<string,DeskSaved>();
const courseDeskMaterials = new Set<DeskObject>();

function resetDeskHistory() {
  releaseDeskPrewarm();
  deskHistory.clear();
  standaloneDesk=false;
}

function releaseDesk() {
  currentDesk?.dispose();
  currentDesk=undefined;
}

function deskPixels(stage:HTMLElement):[number,number] {
  const width=Math.max(1,stage.clientWidth), height=Math.max(1,stage.clientHeight);
  const scale=Math.min(devicePixelRatio,1.5,1600/width,1000/height);
  return [Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale))];
}

function prepareDesk(position:number, stage?:HTMLElement) {
  const canvas=element('canvas','desk-live-canvas');
  let pending:Promise<DeskWorld>|undefined;
  let idle=0;
  let released=false;
  function start() {
    if (idle) window.cancelIdleCallback(idle);
    idle=0;
    return pending ??= withCourseAssetGroup('desk', assets => explorationStage.createDeskWorld(canvas,assets)).catch(error => {
      pending = undefined;
      throw error;
    });
  }
  if (stage) {
    idle=window.requestIdleCallback(()=>{
      void start().then(world=>{
        if (released || !stage.isConnected || !stage.clientWidth || !stage.clientHeight) return;
        world.resize(...deskPixels(stage));
        world.draw({saved:deskHistory.get('lesson:'+position)??freshDesk()});
      }).catch(()=>{});
    },{timeout:400});
  }
  return {position,canvas,start,dispose() {
    released=true;
    if (idle) window.cancelIdleCallback(idle);
    if (pending) void pending.then(world=>world.dispose(),()=>{});
  }};
}

let deskPrewarm:ReturnType<typeof prepareDesk>|undefined;
function releaseDeskPrewarm() {
  deskPrewarm?.dispose();
  deskPrewarm=undefined;
}
function prewarmDesk(stage:HTMLElement, position:number) {
  if (deskPrewarm?.position===position) return;
  releaseDeskPrewarm();
  deskPrewarm=prepareDesk(position,stage);
}

const deskHoverLabels:Readonly<Record<string,string|undefined>> = {
  left:'会前手记',right:'会议材料','page-forward':'会前手记 · 点击读，拖动翻页',
  'page-back':'会前手记 · 点击读，拖动翻页',cord:'会议材料 · 点击读，拖动解绳',
  cover:'会议材料 · 点击读，拖动揭封','before-sheet':'会前摘录 · 点击读，拖动移放',
  'discussion-sheet':'会议讨论 · 点击读，拖动移放',map:'行军图 · 点击看路线',
  overlay:'行军图 · 点击看路线，向右拖可折起',table:'',
};

function mountDesk(stage:HTMLElement, position:number, outgoing?:HTMLCanvasElement|HTMLImageElement):DeskPlayer {
  const historyKey=(standaloneDesk?'standalone:':'lesson:')+position;
  const prepared=deskPrewarm?.position===position ? deskPrewarm : prepareDesk(position);
  if (prepared===deskPrewarm) deskPrewarm=undefined;
  const frame=element('div','desk-live-frame');
  frame.tabIndex=0;
  frame.dataset.space='loading';
  frame.setAttribute('aria-label','会前的桌边，三维观察区');
  const poster=photo('desk-front','遵义会议室桌边');
  poster.className='desk-live-still';
  frame.style.setProperty('--desk-poster','url("'+poster.src+'")');
  const {canvas}=prepared;
  canvas.hidden=true;
  if (outgoing) {
    outgoing.className='desk-live-outgoing';
    outgoing.setAttribute('aria-hidden','true');
  }
  const pinLayer=element('div','desk-live-pins');
  const guide=element('p','desk-inquiry-cue scene-note');
  guide.hidden=true;
  const transport=element('div','desk-live-transport');
  const cluesGroup=element('div','desk-clue-pills');
  cluesGroup.hidden=true;
  transport.append(cluesGroup);
  const manifest=JSON.parse(mediaAssets['desk-manifest']);
  const anchors:Record<DeskObject,Point>={journal:manifest.anchorUV.left,dossier:manifest.anchorUV.right,map:[.707,.80]};
  const clues:HallClue[]=retainedHallClues.slice();
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

  frame.append(poster,canvas,pinLayer,guide);
  if (outgoing) frame.append(outgoing);
  stage.append(frame);
  const savedDesk = deskHistory.get(historyKey) ?? freshDesk();
  const session=mountDeskSession(frame,canvas,standaloneDesk ? savedDesk
    : { ...savedDesk, seen: [...new Set([...(savedDesk.seen ?? []), ...courseDeskMaterials])] },paint);
  const reader=mountDeskReader(stage,session,dismiss);
  const openObject=(object:DeskObject)=>{
    if (object === 'map') session.openMap();
    else session.openReading({kind:object});
    return session.read().reading?.kind === object;
  };

  function renderClues() {
    cluesGroup.hidden=!clues.length;
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
    if (!wasOpen) return;
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
    if (usablePoint(result)) return result;
    if (session.world) return undefined;
    const scale=Math.min(frame.clientWidth/16,frame.clientHeight/9);
    const [x,y]=anchors[object];
    return [.5+(x-.5)*16*scale/Math.max(1,frame.clientWidth),.5+(y-.5)*9*scale/Math.max(1,frame.clientHeight)];
  }
  function readerAnchor(view:DeskView):Point {
    const reading=view.reading;
    if (!reading || reading.kind==='compare') return [.5,.52];
    const object=reading.kind==='map' || reading.kind==='clue' && reading.source==='map' ? 'map'
      : reading.kind==='dossier' || reading.kind==='sheet' && reading.id==='discussion' ? 'dossier' : 'journal';
    const target=object==='map' ? 'map' : object==='dossier' ? 'right' : 'left';
    const point=pinPoint(object,target,view);
    if (!point) return [.5,.55];
    const bounds=frame.getBoundingClientRect(), outer=stage.getBoundingClientRect();
    return outer.width && outer.height ? [
      (bounds.left-outer.left+point[0]*bounds.width)/outer.width,
      (bounds.top-outer.top+point[1]*bounds.height)/outer.height,
    ] : [.5,.55];
  }

  function showGuide() {
    const {reading,preview}=session.read();
    const target=focusedPin??frame.dataset.hover??'';
    const message=reading || preview ? '' : deskHoverLabels[target]??'';
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
    if (!standaloneDesk) for (const object of seen) courseHarness.recordDeskMaterial(object);
    const right=seen.includes('dossier') || saved.sheets.some(sheet=>sheet.id==='discussion');
    const left=seen.includes('journal') || saved.spread>0;
    const finished=left && right;
    frame.dataset.inquiry=finished?'done':'active';
    if (finished) recordLessonProgress(revealed,'materials-compared');

    const moving=!!preview && preview.kind!=='inspect';
    for (const {object,target,pin} of pins) {
      const point=reading || moving || frame.dataset.space==='loading' ? undefined : pinPoint(object,target,view);
      pin.hidden=!usablePoint(point);
      pin.dataset.seen=String(seen.includes(object));
      if (seen.includes(object)) pin.setAttribute('aria-description','已查看，可再次打开');
      else pin.removeAttribute('aria-description');
      if (!pin.hidden && point) {
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

    clueButtons.forEach((button,index)=>button.setAttribute('aria-pressed',String(
      reading?.kind==='clue' && reading.index===index || reading?.kind==='compare' && reading.clueIndex===index,
    )));
    showGuide();
    const changing=shownReading?.kind!==reading?.kind;
    reader.paint(view,clues,changing ? readerAnchor(view) : [.5,.5]);
    shownReading=reading;
  }

  function resize() {
    if (!stage.clientWidth || !stage.clientHeight || disposed) return;
    session.resize(...deskPixels(stage));
  }
  const observer=new ResizeObserver(resize);
  observer.observe(stage);
  function fallback() {
    if (disposed) return;
    frame.dataset.space='fixed';
    canvas.hidden=true;
    poster.hidden=false;
    outgoing?.remove();
    session.releaseWorld();
    for (const {anchor} of targets) anchor.hidden=true;
    paint(session.read());
  }
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fallback();});
  void prepared.start().then(world=>{
    if (disposed) {world.dispose();return;}
    world.resize(...deskPixels(stage));
    session.connect(world);
    canvas.hidden=false;
    frame.dataset.space='ready';
    paint(session.read());
    if (outgoing) {
      const remove=()=>outgoing.remove();
      const fade=animatePart(outgoing,[{opacity:1},{opacity:0}],160);
      if (fade) void fade.finished.then(remove,remove);
      else remove();
    }
    poster.hidden=true;
  }).catch(fallback);
  renderClues();
  paint(session.read());
  return {
    transport,
    openObject,
    dismiss,
    dispose() {
      disposed=true;
      observer.disconnect();
      reader.dispose();
      const saved=session.leave();
      deskHistory.set(historyKey,saved);
    },
  };
}
