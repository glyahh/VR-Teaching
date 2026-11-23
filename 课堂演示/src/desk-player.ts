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
  setClue:(clue:HallClue | undefined)=>void;
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
  const materials=element('div','desk-live-evidence');
  const guide=element('p','desk-inquiry-cue scene-note');
  guide.setAttribute('role','status');
  const transport=element('div','desk-live-transport');
  const frontUV=JSON.parse(mediaAssets['desk-manifest']).anchorUV as Record<'left'|'right',Point>;
  let clue=retainedHallClue;
  let shownClue:HallClue | undefined;
  let disposed=false;

  const entries=(['left','right'] as const).map((side,index)=>{
    const pin=explorationStage.markScenePoint(control('',()=>select(side),'desk-live-pin'),
      side==='left'?'翻阅左册 · 会前形势':'翻阅右册 · 会议讨论');
    pin.dataset.side=side;
    pinLayer.append(pin);
    const slot=element('div','dossier-slot is-'+side);
    const paper=element('article','folio-card');
    slot.append(paper);
    materials.append(slot);
    fillArticle(paper,zunyiMaterials[index]);
    return {side,pin,slot,paper};
  });

  const investigate=control('动手查证',()=>session.investigate(),'desk-investigate','compass');
  const compare=control('桌面并排对照',()=>session.cue(session.read().evidence==='both'?'none':'both',session.read().carried),'desk-live-compare','layers');
  const recenter=control('回正',()=>session.edit(old=>({...old,camera:deskHome()})),'desk-live-home','compass');
  recenter.setAttribute('aria-label','回到正面机位');
  const close=control('收起材料',()=>session.cue('none'),'desk-live-close');
  const bring=control('',()=>{
    if (!clue) return;
    if (session.read().carried) {session.cue('none');return;}
    if (clue.kind==='route' && session.read().saved.map==='stored') {
      session.edit(old=>({...old,map:'original'}));
    }
    const before=session.read().evidence;
    session.cue(before==='right' || before==='both'?'both':'left',true);
  },'desk-live-clue','layers');
  const mapToggle=control('展开行军图',()=>session.toggleMap(),'desk-live-map','layers');
  const previousLeaf=control('',()=>session.turn('back'),'desk-page-turn','arrowLeft');
  const nextLeaf=control('',()=>session.turn('forward'),'desk-page-turn','arrowRight');
  previousLeaf.setAttribute('aria-label','前一张手记');
  nextLeaf.setAttribute('aria-label','后一张手记');
  transport.append(investigate,previousLeaf,nextLeaf,mapToggle,compare,bring,recenter,close);

  const targets=(['page-forward','page-back','cord','cover','before-sheet','discussion-sheet','map','overlay','table'] as const)
    .map(target=>{
      const anchor=element('span','desk-object-position');
      anchor.dataset.deskTarget=target;
      anchor.setAttribute('aria-hidden','true');
      anchor.hidden=true;
      pinLayer.append(anchor);
      return {target,anchor};
    });

  frame.append(poster,canvas,pinLayer,materials,guide);
  stage.append(frame);
  const session=mountDeskSession(frame,canvas,projectionMode?freshDesk():deskHistory.get(historyKey)??freshDesk(),
    (view,publish)=>{paint(view);if(publish) publishDesk(view);});
  if (handoff) requestAnimationFrame(()=>{
    if (frame.isConnected) playDeskHandoff(frame,handoff,poster,frontUV.right);
  });

  function fillArticle(paper:HTMLElement,item:{title:string;lines:readonly string[]}) {
    paper.replaceChildren(element('h3','',item.title),...item.lines.map(line=>element('p','',line)));
  }
  function select(side:'left'|'right') {
    const view=session.read();
    if (side==='left' && view.investigating && session.world) {session.turn('forward');return;}
    if (side==='right' && view.carried) {session.cue('both',true);return;}
    session.cue(side);
  }
  function setPosition(node:HTMLElement,point:readonly number[]) {
    node.style.left=(point[0]*100)+'%';
    node.style.top=(point[1]*100)+'%';
  }
  function usablePoint(point:readonly number[]|undefined):point is readonly number[] {
    return !!point && point.length===2 && point.every(value=>Number.isFinite(value) && value>=0 && value<=1);
  }
  function guidance(view:DeskView) {
    if (view.preview?.kind==='inspect') return '再点纸页，放回桌面。';
    if (view.preview?.kind==='sheet') return '移到桌面，松手放下。';
    if (view.saved.map==='both') return '对照从黎平分开的两条路线。';
    if (view.saved.sheets.some(sheet=>sheet.id==='discussion') && view.saved.spread>0) return '把手记与会议讨论摆在一起。';
    if (view.saved.dossier==='open') return '抽出会议讨论页，放到桌上。';
    if (view.saved.dossier==='untied') return '抬起右册封面。';
    if (view.saved.spread>0) return '继续翻阅，或松开右册扎绳。';
    return '抓住书角翻阅，也可以先解开卷宗。';
  }

  function paint(view:DeskView) {
    if (disposed) return;
    const {saved,preview}=view;
    const drawnView=session.renderView();
    const camera=drawnView.saved.camera;
    const usable=!!session.world;
    frame.dataset.yaw=camera.yaw.toFixed(3);
    frame.dataset.pitch=camera.pitch.toFixed(3);
    frame.dataset.zoom=camera.zoom.toFixed(4);
    frame.dataset.spread=String(saved.spread);
    frame.dataset.dossier=saved.dossier;
    frame.dataset.map=saved.map;
    frame.dataset.gesture=preview?.kind??'';
    frame.dataset.progress=preview && 'progress' in preview?preview.progress.toFixed(3):'';
    for (const id of deskMaterials) {
      const sheet=saved.sheets.find(candidate=>candidate.id===id);
      frame.setAttribute('data-sheet-'+id,sheet ? [sheet.at.x.toFixed(4),sheet.at.z.toFixed(4)].join(',') : '');
    }

    const left=saved.spread>0 || view.evidence==='left' || view.evidence==='both';
    const right=saved.sheets.some(sheet=>sheet.id==='discussion') || view.evidence==='right' || view.evidence==='both';
    const finished=left && right;
    frame.dataset.inquiry=view.investigating?(finished?'done':'active'):'off';
    frame.dataset.evidence=view.evidence;
    if (!projectionMode && finished) revealed.add('materials-compared');
    const showLeft=view.evidence==='left' || view.evidence==='both' || (!usable && saved.spread>0);
    const showRight=view.evidence==='right' || view.evidence==='both' || (!usable && right);
    materials.hidden=!showLeft&&!showRight;
    for (const {side,pin,slot,paper} of entries) {
      const projected=session.world?.project(side,drawnView);
      const point=usablePoint(projected)?projected:frontUV[side];
      pin.hidden=projectionMode || (side==='left'?showLeft:showRight) || !!preview || usable && view.investigating;
      if (!pin.hidden) {
        const dragClearance=usable ? side==='left'?-.062:.062 : 0;
        setPosition(pin,[deskClamp(point[0]+dragClearance,.025,.975),point[1]]);
      }
      slot.hidden=side==='left'?!showLeft:!showRight;
      if (!slot.hidden) {
        const paired=showLeft && showRight;
        const lower=paired && side==='right'?.73:.24;
        const upper=paired && side==='left'?.27:.76;
        setPosition(slot,[deskClamp(point[0],lower,upper),deskClamp(point[1],.30,.64)]);
      }
      if (side==='left') {
        const choice=view.carried?clue:undefined;
        if (shownClue!==choice) {
          fillArticle(paper,choice??zunyiMaterials[0]);
          shownClue=choice;
        }
      }
    }
    for (const {target,anchor} of targets) {
      const point=session.world?.project(target,drawnView);
      anchor.hidden=!usablePoint(point);
      if (usablePoint(point)) setPosition(anchor,point);
    }

    guide.hidden=!usable || (!view.investigating && !preview);
    const message=guide.hidden?'':guidance(view);
    if (guide.textContent!==message) guide.textContent=message;
    const investigationLabel=view.investigating?(finished?'结束查证':'退出查证'):'动手查证';
    if (investigate.textContent!==investigationLabel) setButtonContent(investigate,investigationLabel,'compass');
    investigate.hidden=!usable;
    previousLeaf.hidden=nextLeaf.hidden=!usable||!view.investigating;
    previousLeaf.disabled=saved.spread===0;
    nextLeaf.disabled=saved.spread===deskSpreads;
    mapToggle.hidden=!usable;
    const mapLabel=saved.map==='stored'?'展开行军图':saved.map==='both'?'揭开改向线':'叠看两条路线';
    if (mapToggle.textContent!==mapLabel) setButtonContent(mapToggle,mapLabel,'layers');
    compare.hidden=view.investigating;
    bring.hidden=!clue || view.investigating;
    if (clue && bring.textContent!==clue.title) setButtonContent(bring,clue.title,'layers');
    bring.setAttribute('aria-pressed',String(view.carried));
    recenter.hidden=!usable;
    close.hidden=view.evidence==='none';
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
    paint(session.read());
  }
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();fallback();});
  explorationStage.createDeskWorld(canvas,mediaAssets).then(world=>{
    if (disposed) {world.dispose();return;}
    canvas.hidden=false;
    frame.dataset.space='ready';
    session.connect(world as DeskWorld);
    resize();
  }).catch(fallback);
  paint(session.read());
  beginDeskVisit(position);
  queueMicrotask(()=>{if (!disposed) publishDesk(session.read());});
  return {
    transport,read:session.read,restore:session.restore,
    setClue(next) {clue=next;paint(session.read());},
    dismiss:()=>session.cue('none'),
    dispose() {
      disposed=true;
      observer.disconnect();
      const saved=session.leave();
      if (!projectionMode) deskHistory.set(historyKey,saved);
    },
  };
}
