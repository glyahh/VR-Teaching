type DeskPose = {yaw:number; pitch:number; zoom:number};
type DeskEvidence = 'none' | 'left' | 'right' | 'both';
type DeskState = {pose:DeskPose; evidence:DeskEvidence; inquiry:DeskInquiry|null};
type DeskSnapshot = DeskState & {revision:number};
type DeskPlayer = {
  transport:HTMLElement;
  read:()=>DeskSnapshot;
  restore:(state:DeskSnapshot)=>void;
  dismiss:()=>void;
  dispose:()=>void;
};

let currentDesk:DeskPlayer|undefined;
let deskRevision = 0;

function releaseDesk() {
  currentDesk?.dispose();
  currentDesk = undefined;
}

function mountDesk(stage:HTMLElement):DeskPlayer {
  const home = ():DeskPose => ({yaw:0, pitch:0, zoom:1});
  const clamp = (value:number, low:number, high:number) => Math.max(low, Math.min(value, high));
  const state:DeskState = {pose:home(), evidence:'none', inquiry:null};
  const frame = element('div','desk-live-frame');
  frame.tabIndex = projectionMode ? -1 : 0;
  frame.setAttribute('aria-label','会前的桌边，三维观察区');
  const poster = photo('desk-front','遵义会议室桌边');
  poster.className = 'desk-live-still';
  const canvas = element('canvas','desk-live-canvas');
  canvas.hidden = true;
  const pins = element('div','desk-live-pins');
  const materials = element('div','desk-live-evidence');
  const transport = element('div','desk-live-transport');
  const frontUV = JSON.parse(mediaAssets['desk-manifest']).anchorUV as Record<'left'|'right',[number,number]>;
  let space:Awaited<ReturnType<typeof createMeetingSpace>> | undefined;
  let disposed = false;
  let lastSend = -Infinity;
  let lastRevision = -1;
  let revision = ++deskRevision;
  let drag:{id:number;x:number;y:number;pose:DeskPose;moved:boolean}|undefined;
  let leafDrag:{id:number;x:number;y:number;opening:number}|undefined;

  const inquiryView = mountDeskInquiry(frame,opening=>adjustLeaf(opening,true),settleLeaf);
  const investigate = control('动手查证',()=>{
    if (state.inquiry) back('none');
    else back('none',{step:'choose',opening:0,needsClue:false,meetingRead:false});
  },'desk-investigate','compass');
  const compare = control('桌面并排对照',()=>reveal(state.evidence==='both'?'none':'both'),'desk-live-compare','layers');
  const recenter = control('回正',()=>changePose(home()),'desk-live-home','compass');
  recenter.setAttribute('aria-label','回到正面机位');
  const hideMaterial = control('收起材料',()=>reveal('none'),'desk-live-close');
  transport.append(investigate,inquiryView.range,compare,recenter,hideMaterial);
  const entries = (['left','right'] as const).map(side => {
    const item = zunyiMaterials[side==='left'?0:1];
    const label = side==='left'?'翻阅左册 · 会前形势':'翻阅右册 · 会议讨论';
    const pin = explorationStage.markScenePoint(control('',()=>select(side),'desk-live-pin'),label);
    pin.dataset.side = side;
    pins.append(pin);
    const slot = element('div','dossier-slot is-'+side);
    const paper = element('article','folio-card');
    paper.append(element('h3','',item.title),...item.lines.map(line=>element('p','',line)));
    slot.append(paper);
    materials.append(slot);
    return {side,pin,slot,paper};
  });
  frame.append(poster,canvas,pins,materials);
  stage.append(frame);
  frame.dataset.space = 'loading';
  frame.addEventListener('click',event=>event.stopPropagation());
  frame.addEventListener('keydown',event=>{
    if (projectionMode || event.target!==frame) return;
    if (state.inquiry && ['leaf','found'].includes(state.inquiry.step)) {
      const delta=event.key==='ArrowLeft'||event.key==='ArrowUp'?3:event.key==='ArrowRight'||event.key==='ArrowDown'?-3:0;
      if (delta) {
        adjustLeaf(state.inquiry.opening+delta,true);
        settleLeaf();
        event.preventDefault();
        return;
      }
    }
    const pose = state.pose;
    if (event.key==='ArrowLeft') changePose({...pose,yaw:pose.yaw-4});
    else if (event.key==='ArrowRight') changePose({...pose,yaw:pose.yaw+4});
    else if (event.key==='ArrowUp') changePose({...pose,pitch:pose.pitch+2});
    else if (event.key==='ArrowDown') changePose({...pose,pitch:pose.pitch-2});
    else if (event.key==='Home') changePose(home());
    else return;
    event.preventDefault();
  });

  function read():DeskSnapshot {
    return {...state,pose:{...state.pose},revision};
  }
  function send(force=true) {
    if (disposed || projectionMode) return;
    const now=performance.now();
    if (!force && now-lastSend < 45) return;
    lastSend=now;
    revision=++deskRevision;
    sendProjection({type:'desk',state:read()});
  }
  function paint(draw:boolean) {
    if (disposed) return;
    frame.dataset.evidence=state.evidence;
    frame.dataset.yaw=state.pose.yaw.toFixed(3);
    frame.dataset.pitch=state.pose.pitch.toFixed(3);
    frame.dataset.zoom=state.pose.zoom.toFixed(4);
    const handling=!!state.inquiry && state.inquiry.step!=='choose';
    const meetingFirst=state.inquiry?.step==='choose' && state.inquiry.meetingRead;
    if (space && draw && !canvas.hidden) space.draw(state.pose);
    for (const {side,pin,slot,paper} of entries) {
      const point=space && !canvas.hidden ? space.project(side,state.pose) : frontUV[side];
      pin.hidden=projectionMode || state.evidence!=='none' || (handling && side==='left') ||
        (meetingFirst && side==='right') || !point.every(value=>Number.isFinite(value)&&value>=0&&value<=1);
      if (!pin.hidden) {
        pin.style.left=point[0]*100+'%';
        pin.style.top=point[1]*100+'%';
      }
      paper.hidden=!(state.evidence===side || state.evidence==='both' || (meetingFirst && side==='right'));
      slot.hidden=paper.hidden;
      if (!paper.hidden) {
        const paired=state.evidence==='both';
        const lower=paired && side==='right' ? .73 : .24;
        const upper=paired && side==='left' ? .27 : .76;
        slot.style.left=clamp(point[0],lower,upper)*100+'%';
        slot.style.top=clamp(point[1],.30,.64)*100+'%';
      }
    }
    inquiryView.paint(state.inquiry,space && !canvas.hidden ? space.project('right',state.pose) : frontUV.right);
    materials.hidden=state.evidence==='none' && !meetingFirst;
    const taskLabel=state.inquiry ? (state.inquiry.step==='done'?'结束查证':'退出查证') : '动手查证';
    if (investigate.textContent!==taskLabel) setButtonContent(investigate,taskLabel,'compass');
    compare.hidden=!!state.inquiry;
    recenter.hidden=!space || handling;
    hideMaterial.hidden=state.evidence==='none' || !!state.inquiry;
  }
  function resize() {
    const width=Math.min(stage.clientWidth,stage.clientHeight*16/9);
    if (width<=0 || disposed) return;
    frame.style.width=width+'px';
    const pixels=Math.max(320,Math.min(1600,Math.round(width*Math.min(devicePixelRatio,1.5)/16)*16));
    if (canvas.width!==pixels) {canvas.width=pixels;canvas.height=pixels*9/16;}
    paint(true);
  }
  const observer=new ResizeObserver(resize);
  observer.observe(stage);

  function back(evidence:DeskEvidence,inquiry:DeskInquiry|null=null) {
    if (disposed || projectionMode) return;
    drag=leafDrag=undefined;
    state.evidence=evidence;
    state.inquiry=inquiry;
    if (evidence==='left'||evidence==='both') revealed.add('material-before');
    if (evidence==='right'||evidence==='both') revealed.add('material-during');
    if (evidence==='both') revealed.add('materials-compared');
    paint(true);
    send();
  }
  function reveal(which:DeskEvidence) {
    back(which);
  }
  function select(which:'left'|'right') {
    if (projectionMode || disposed) return;
    const task=state.inquiry;
    if (!task) {reveal(which);return;}
    if (which==='left' && task.step==='choose') {
      state.pose=home();
      back('none',{...task,step:'leaf',opening:0,needsClue:false});
    } else if (which==='right' && task.step==='found') {
      back('both',{...task,step:'done',needsClue:false,meetingRead:true});
    } else if (which==='right' && task.step!=='done') {
      state.inquiry={...task,needsClue:true,meetingRead:true};
      revealed.add('material-during');
      paint(false);send();
    }
  }
  function adjustLeaf(value:number,force:boolean) {
    const task=state.inquiry;
    if (projectionMode || !task || (task.step!=='leaf' && task.step!=='found')) return;
    const opening=clamp(Math.round(value),0,inquiryView.last);
    if (opening===task.opening) return;
    const found=task.step==='found' || opening>=Math.ceil(inquiryView.last*.8);
    state.inquiry={...task,step:found?'found':'leaf',opening,needsClue:false};
    if (found) revealed.add('material-before');
    paint(false);send(force);
  }
  function settleLeaf() {
    const task=state.inquiry;
    if (!projectionMode && task?.step==='found' && task.meetingRead) back('both',{...task,step:'done'});
  }
  function changePose(next:DeskPose,push=true) {
    if (projectionMode || !space || (state.inquiry && state.inquiry.step!=='choose')) return;
    state.pose={yaw:clamp(next.yaw,-18,18),pitch:clamp(next.pitch,-5,6),zoom:clamp(next.zoom,.92,1.28)};
    state.evidence='none';
    paint(true);send(push);
  }
  frame.addEventListener('pointerdown',event=>{
    if (projectionMode || !event.isPrimary || event.button!==0 || (event.target as Element).closest('button,article')) return;
    const task=state.inquiry;
    if (task && (task.step==='leaf' || task.step==='found')) {
      const rect=frame.getBoundingClientRect();
      if (inquiryView.overPage((event.clientX-rect.x)/rect.width,(event.clientY-rect.y)/rect.height)) {
        leafDrag={id:event.pointerId,x:event.clientX,y:event.clientY,opening:task.opening};
        frame.setPointerCapture(event.pointerId);
        return;
      }
    }
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,pose:{...state.pose},moved:false};
    frame.setPointerCapture(event.pointerId);
  });
  frame.addEventListener('pointermove',event=>{
    if (leafDrag && leafDrag.id===event.pointerId) {
      const delta=(leafDrag.x-event.clientX)/(.25*frame.clientWidth)+(leafDrag.y-event.clientY)/(.39*frame.clientHeight);
      adjustLeaf(leafDrag.opening+delta*inquiryView.last,false);
      return;
    }
    if (!drag || drag.id!==event.pointerId) return;
    const horizontal=event.clientX-drag.x, vertical=event.clientY-drag.y;
    if (Math.hypot(horizontal,vertical)>4) drag.moved=true;
    if (drag.moved) changePose({...drag.pose,yaw:drag.pose.yaw-horizontal*60/frame.clientWidth,pitch:drag.pose.pitch+vertical*21/frame.clientHeight},false);
  });
  frame.addEventListener('pointerup',event=>{
    if (leafDrag?.id===event.pointerId) {leafDrag=undefined;settleLeaf();send();return;}
    if (!drag || drag.id!==event.pointerId) return;
    const tap=!drag.moved;
    drag=undefined;
    if (!tap) {send();return;}
    const box=frame.getBoundingClientRect();
    const horizontal=(event.clientX-box.x)/box.width,vertical=(event.clientY-box.y)/box.height;
    const picked=space?.pick(horizontal,vertical,state.pose);
    if (picked) select(picked); else if(state.evidence!=='none' && !state.inquiry)reveal('none');
  });
  frame.addEventListener('pointercancel',()=>{drag=undefined;leafDrag=undefined;send();});
  frame.addEventListener('wheel',event=>{
    if (projectionMode || !space) return;
    event.preventDefault();changePose({...state.pose,zoom:state.pose.zoom*Math.exp(-clamp(event.deltaY,-220,220)*.0013)});
  },{passive:false});

  function restore(remote:DeskSnapshot) {
    if (!projectionMode || disposed || !remote || remote.revision<=lastRevision) return;
    lastRevision=remote.revision;
    const moved=state.pose.yaw!==remote.pose.yaw || state.pose.pitch!==remote.pose.pitch || state.pose.zoom!==remote.pose.zoom;
    state.pose={...remote.pose};
    state.evidence=remote.evidence;
    state.inquiry=remote.inquiry?{...remote.inquiry}:null;
    paint(moved);
  }

  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();
    if (disposed) return;
    canvas.hidden=true;frame.dataset.space='fixed';
    if (!projectionMode) state.pose=home();
    space?.dispose();space=undefined;paint(false);send();
  });
  createMeetingSpace(canvas,{
    manifest:mediaAssets['desk-manifest'], mesh:mediaAssets['desk-mesh'],
    front:mediaAssets['desk-front'], left:mediaAssets['desk-left'], right:mediaAssets['desk-right'],
  }).then(result=>{
    if (disposed) {result.dispose();return;}
    space=result;canvas.hidden=false;frame.dataset.space='ready';resize();paint(true);
  }).catch(()=>{
    if(!disposed){frame.dataset.space='fixed';paint(false);}
  });
  paint(false);
  return {
    transport,read,restore,
    dismiss:()=>back('none'),
    dispose:()=>{
      disposed=true;
      observer.disconnect();
      inquiryView.dispose();
      space?.dispose();
      space=undefined;
    },
  };
}
