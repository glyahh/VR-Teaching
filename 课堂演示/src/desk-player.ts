type DeskPose = {yaw:number; pitch:number; zoom:number};
type DeskReel = 'action' | 'guide';
type DeskEvidence = 'none' | 'left' | 'right' | 'both';
type DeskState = {
  phase:'browse'|'align'|'film';
  pose:DeskPose;
  reel:DeskReel;
  paused:boolean;
  time:number;
  evidence:DeskEvidence;
  inquiry:DeskInquiry|null;
};
type DeskSnapshot = DeskState & {revision:number; stamp:number};
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
  const state:DeskState = {phase:'browse', pose:home(), reel:'action', paused:false, time:0, evidence:'none', inquiry:null};
  const frame = element('div','desk-live-frame');
  frame.tabIndex = projectionMode ? -1 : 0;
  frame.setAttribute('aria-label','会前的桌边，三维观察区');
  const poster = photo('desk-front','遵义会议室桌边教学情境复原');
  poster.className = 'desk-live-still';
  const canvas = element('canvas','desk-live-canvas');
  canvas.hidden = true;
  const video = element('video','desk-live-video');
  video.playsInline = true;
  video.muted = true;
  video.preload = 'auto';
  const pins = element('div','desk-live-pins');
  const materials = element('div','desk-live-evidence');
  const transport = element('div','desk-live-transport');
  const message = element('span','desk-live-message');
  message.setAttribute('role','status');
  const seek = element('input','desk-live-seek');
  seek.type = 'range';
  seek.min = '0';
  seek.step = '.04';
  seek.setAttribute('aria-label','镜头进度');
  const counter = element('output','desk-live-clock');
  const credit = element('span','desk-live-credit','教学情境复原');
  const frontUV = JSON.parse(mediaAssets['desk-manifest']).anchorUV as Record<'left'|'right',[number,number]>;
  const surfaces:Partial<Record<'left'|'right',HTMLButtonElement>> = {};
  const papers:Partial<Record<'left'|'right',HTMLElement>> = {};
  let space:Awaited<ReturnType<typeof createMeetingSpace>> | undefined;
  let boundReel:DeskReel|undefined;
  let disposed = false;
  let visibleFilm = false;
  let mediaReady = false;
  let waitingRemote = false;
  let request = new AbortController();
  let raf = 0;
  let lastFrame = 0;
  let lastSend = -Infinity;
  let lastRevision = -1;
  let lastRemote:DeskSnapshot|undefined;
  let generation = 0;
  let revision = ++deskRevision;
  let alignFrom = home();
  let elapsed = 0;
  let alignmentSeconds = .6;
  let anchorPresentedAt:number|undefined;
  let drag:{id:number;x:number;y:number;pose:DeskPose;moved:boolean}|undefined;
  let hasOrbited = false;
  let leafDrag:{id:number; x:number; y:number; opening:number}|undefined;
  let closeFrom=0;

  const inquiryView=mountDeskInquiry(frame,opening=>adjustLeaf(opening,true),settleLeaf);
  const investigate=control('动手查证',()=>{
    if (state.inquiry) leaveInquiry();
    else back('none',{step:'choose',opening:0,needsClue:false,meetingRead:false});
  },'desk-investigate','compass');
  const playGuide = control('播放90秒导览',()=>begin('guide'),'desk-guide','play');
  const playback = control('暂停',togglePause,'desk-live-play','pause');
  const leaveMovie = control('返回桌面',()=>back('none'),'desk-live-return','arrowLeft');
  const compare = control('桌面并排对照',()=>reveal(state.evidence==='both'?'none':'both'),'desk-live-compare','layers');
  const recenter = control('回正',()=>changePose(home()),'desk-live-home','compass');
  recenter.setAttribute('aria-label','回到正面机位');
  const hideMaterial = control('收起材料',()=>reveal('none'),'desk-live-close');
  transport.append(investigate, inquiryView.range, playGuide, compare, recenter, playback, seek, counter, leaveMovie, hideMaterial, message);
  for (const side of ['left','right'] as const) {
    const item = zunyiMaterials[side==='left'?0:1];
    const pin = control('',()=>select(side),'desk-live-pin');
    pin.append(element('span','',side==='left'?'会前手记':'会议卷宗'));
    pin.setAttribute('aria-label',side==='left'?'翻阅左册 · 会前形势':'翻阅右册 · 会议讨论');
    pin.dataset.side = side;
    pins.append(pin);
    surfaces[side] = pin;
    const slot = element('div','dossier-slot is-'+side);
    const paper = element('article','folio-card');
    paper.append(element('h3','',item.title),...item.lines.map(line=>element('p','',line)));
    slot.append(paper);
    materials.append(slot);
    papers[side] = paper;
  }
  frame.append(poster, canvas, video, pins, materials, credit);
  stage.append(frame);
  frame.dataset.space = 'loading';
  frame.addEventListener('click',event=>event.stopPropagation());
  frame.addEventListener('keydown',event=>{
    if (projectionMode || event.target!==frame) return;
    if (state.inquiry && ['leaf','found'].includes(state.inquiry.step) && state.phase==='browse') {
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
    else if (event.code==='Space' && !state.inquiry) state.phase==='browse' ? begin('guide') : togglePause();
    else return;
    event.preventDefault();
  });

  function seconds() {
    return state.phase==='film' && visibleFilm && !video.seeking && Number.isFinite(video.currentTime) ? video.currentTime : state.time;
  }
  function read():DeskSnapshot {
    return {...state, pose:{...state.pose}, time:seconds(), revision, stamp:Date.now()};
  }
  function send(force=true) {
    if (disposed || projectionMode) return;
    const now=performance.now();
    if (!force && now-lastSend < (state.inquiry ? 32 : 110)) return;
    lastSend=now;
    revision=++deskRevision;
    sendProjection({type:'desk',state:read()});
  }
  function schedule() {
    if (!raf && !disposed) raf=requestAnimationFrame(tick);
  }
  function duration() {
    return Number.isFinite(video.duration) && video.duration>0 ? video.duration : state.reel==='guide'?90:6;
  }
  function refreshTime() {
    const total=duration();
    seek.max=String(total);
    seek.value=String(state.time);
    const asClock=(time:number)=>Math.floor(time/60)+':'+String(Math.floor(time%60)).padStart(2,'0');
    const value=asClock(state.time)+' / '+asClock(total);
    if (counter.textContent!==value) counter.textContent=value;
  }
  function paint(draw:boolean) {
    if (disposed) return;
    frame.dataset.phase=state.phase;
    frame.dataset.paused=String(state.paused);
    frame.dataset.evidence=state.evidence;
    frame.dataset.reel=state.reel;
    frame.dataset.yaw=state.pose.yaw.toFixed(3);
    frame.dataset.pitch=state.pose.pitch.toFixed(3);
    frame.dataset.zoom=state.pose.zoom.toFixed(4);
    frame.classList.toggle('is-filming',visibleFilm);
    const browsing=state.phase==='browse';
    const handling=!!state.inquiry && state.inquiry.step!=='choose';
    const meetingFirst=state.inquiry?.step==='choose' && state.inquiry.meetingRead;
    if (space && draw && !visibleFilm && !canvas.hidden) space.draw(state.pose);
    for (const side of ['left','right'] as const) {
      const point=space && !canvas.hidden ? space.project(side,state.pose) : frontUV[side];
      const pin=surfaces[side]!;
      pin.hidden=projectionMode || !browsing || state.inquiry?.step==='closing' || state.evidence!=='none' || (handling&&side==='left') || (meetingFirst&&side==='right') || !point.every(value=>Number.isFinite(value)&&value>=0&&value<=1);
      if (!pin.hidden) {pin.style.left=point[0]*100+'%';pin.style.top=point[1]*100+'%';}
      const paper=papers[side]!;
      const previouslyHidden=paper.hidden || paper.parentElement!.hidden;
      paper.hidden=!browsing || !(state.evidence===side || state.evidence==='both' || (meetingFirst&&side==='right'));
      const slot=paper.parentElement!;
      slot.hidden=paper.hidden;
      if (!paper.hidden) {
        const paired=state.evidence==='both';
        const lower = paired && side === 'right' ? .73 : .24;
        const upper = paired && side === 'left' ? .27 : .76;
        const horizontal = clamp(point[0],lower,upper);
        slot.style.left=horizontal*100+'%';
        slot.style.top=clamp(point[1],.30,.64)*100+'%';
        if (previouslyHidden && !reducedMotion.matches && slot.isConnected) {
          paper.animate([{opacity:0,transform:'translateY(8px) scale(.98)'},{opacity:1,transform:'none'}],{duration:210,easing:'ease-out'});
        }
      }
    }
    inquiryView.paint(state.inquiry,state.phase==='align',space && !canvas.hidden ? space.project('right',state.pose) : frontUV.right);
    materials.hidden=!browsing || (state.evidence==='none' && !meetingFirst);
    investigate.hidden=!state.inquiry && !browsing;
    investigate.disabled=state.inquiry?.step==='closing';
    const taskLabel=state.inquiry ? (state.inquiry.step==='done'?'结束查证':'退出查证') : '动手查证';
    if (investigate.textContent!==taskLabel) setButtonContent(investigate,taskLabel,'compass');
    playGuide.hidden=compare.hidden=!browsing || !!state.inquiry;
    recenter.hidden=!browsing || !space || handling;
    hideMaterial.hidden=!browsing || state.evidence==='none' || !!state.inquiry;
    playback.hidden=leaveMovie.hidden=browsing || !!state.inquiry;
    seek.hidden=counter.hidden=state.phase!=='film';
    if (!browsing) {
      const label=state.paused?'继续':'暂停';
      if (playback.textContent!==label) setButtonContent(playback,label,state.paused?'play':'pause');
    }
    refreshTime();
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

  function invalidate() {
    leafDrag=undefined;
    drag=undefined;
    request.abort();
    request=new AbortController();
    generation++;
    mediaReady=false;
    waitingRemote=false;
    visibleFilm=false;
    video.pause();
  }
  function bind(reel:DeskReel) {
    if (boundReel!==reel) {
      boundReel=reel;
      video.src=mediaAssets['desk-'+reel];
      video.load();
    }
    video.muted=projectionMode || reel==='action';
  }
  function until(predicate:()=>boolean, signal:AbortSignal):Promise<void> {
    if (signal.aborted) return Promise.reject(new Error('镜头已切换'));
    if (predicate()) return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const watched=['loadeddata','canplay','seeked'];
      const cleanup=()=>{
        clearTimeout(timer);
        watched.forEach(name=>video.removeEventListener(name,ready));
        video.removeEventListener('error',fail);
        signal.removeEventListener('abort',fail);
      };
      const ready=()=>{if (predicate()) {cleanup();resolve();}};
      const fail=()=>{cleanup();reject(new Error('镜头尚未就绪'));};
      const timer=window.setTimeout(fail,15000);
      watched.forEach(name=>video.addEventListener(name,ready));
      video.addEventListener('error',fail);
      signal.addEventListener('abort',fail,{once:true});
    });
  }
  async function decode(time:number, signal:AbortSignal) {
    await until(()=>video.readyState>=2,signal);
    if (signal.aborted) throw new Error('镜头已切换');
    const target=clamp(time,0,Math.max(0,duration()-.001));
    if (Math.abs(video.currentTime-target)>.012) video.currentTime=target;
    await until(()=>video.readyState>=2 && !video.seeking,signal);
  }
  function failMovie() {
    const fallback:DeskEvidence=state.reel==='action'?'left':'none';
    back(fallback);
    message.textContent='此设备未能播放该镜头，已返回桌面。';
  }
  function play() {
    const run=generation;
    video.play().catch(()=>{
      if (disposed || run!==generation || state.phase!=='film' || state.paused) return;
      if (!projectionMode) {
        state.paused=true;
        message.textContent='请点击继续播放。';
        paint(false);send();
      }
    });
  }
  function begin(reel:DeskReel, inquiry:DeskInquiry|null=null) {
    if (projectionMode || disposed) return;
    invalidate();
    const signal=request.signal;
    state.reel=reel;
    state.inquiry=inquiry;
    state.evidence='none';
    state.phase='align';
    state.paused=false;
    state.time=0;
    alignFrom={...state.pose};
    elapsed=0;anchorPresentedAt=undefined;
    alignmentSeconds=reducedMotion.matches?0:Math.min(.9,.23+Math.abs(alignFrom.yaw)*.025+Math.abs(alignFrom.pitch)*.022+Math.abs(alignFrom.zoom-1)*.5);
    message.textContent='';
    if (inquiry) {
      mediaReady=true;
    } else {
      bind(reel);
      decode(0,signal).then(()=>{
        if (!signal.aborted && !disposed) {mediaReady=true;schedule();}
      }).catch(()=>{if(!signal.aborted&&!disposed)failMovie();});
    }
    lastFrame=performance.now();
    paint(true);send();schedule();
  }
  function back(evidence:DeskEvidence, inquiry:DeskInquiry|null=null) {
    if (disposed) return;
    invalidate();
    state.phase='browse';
    state.paused=false;
    state.time=0;
    state.evidence=evidence;
    state.inquiry=inquiry;
    if (evidence==='left'||evidence==='both') revealed.add('material-before');
    if (evidence==='right'||evidence==='both') revealed.add('material-during');
    if (evidence==='both') revealed.add('materials-compared');
    message.textContent='';
    paint(true);
    send();
  }
  function reveal(which:DeskEvidence) {
    if (projectionMode) return;
    back(which);
  }
  function select(which:'left'|'right') {
    if (projectionMode || state.phase!=='browse') return;
    const task=state.inquiry;
    if (task) {
      if (which==='left' && task.step==='choose') {
        const next:DeskInquiry={...task,step:'leaf',opening:0,needsClue:false};
        if (Math.abs(state.pose.yaw)+Math.abs(state.pose.pitch)+Math.abs(state.pose.zoom-1)<.001) back('none',next);
        else begin('action',next);
      } else if (which==='right' && task.step==='found') {
        back('both',{...task,step:'done',needsClue:false,meetingRead:true});
      } else if (which==='right' && task.step!=='done') {
        state.inquiry={...task,needsClue:true,meetingRead:true};
        revealed.add('material-during');
        paint(false);send();
      }
      return;
    }
    if (which==='left') begin('action');
    else reveal('right');
  }
  function adjustLeaf(value:number, force:boolean) {
    const task=state.inquiry;
    if (projectionMode || state.phase!=='browse' || !task || (task.step!=='leaf' && task.step!=='found')) return;
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
  function leaveInquiry() {
    const task=state.inquiry;
    if (!task || task.step==='closing' || !task.opening || reducedMotion.matches) {back('none');return;}
    closeFrom=task.opening;
    elapsed=0;lastFrame=performance.now();
    state.evidence='none';
    state.inquiry={...task,step:'closing',needsClue:false};
    paint(false);send();schedule();
  }
  function togglePause() {
    if (projectionMode || state.phase==='browse') return;
    state.paused=!state.paused;
    if (state.phase==='film') {
      if (state.paused) {video.pause();state.time=video.currentTime;}
      else play();
    }
    lastFrame=performance.now();
    paint(false);send();schedule();
  }
  function tick(now:number) {
    raf=0;
    if (disposed) return;
    const delta=Math.min(.20,Math.max(0,(now-lastFrame)/1000));
    lastFrame=now;
    if (!projectionMode && state.inquiry?.step==='closing') {
      elapsed+=delta;
      const progress=Math.min(1,elapsed/.32);
      if (progress===1) {back('none');return;}
      state.inquiry={...state.inquiry,opening:Math.round(closeFrom*(1-progress*progress*(3-2*progress)))};
      paint(false);send(false);schedule();
    } else if (!projectionMode && state.phase==='align' && !state.paused) {
      elapsed+=delta;
      const fraction=alignmentSeconds===0?1:Math.min(1,elapsed/alignmentSeconds);
      const amount=fraction*fraction*(3-2*fraction);
      state.pose={yaw:alignFrom.yaw*(1-amount),pitch:alignFrom.pitch*(1-amount),zoom:alignFrom.zoom+(1-alignFrom.zoom)*amount};
      paint(true);
      if (fraction===1 && mediaReady) {
        if (anchorPresentedAt === undefined) {
          anchorPresentedAt=now;
          send();
        } else if (now-anchorPresentedAt>=100) {
          if (state.inquiry) {
            state.phase='browse';paint(true);send();return;
          }
          state.phase='film';visibleFilm=true;state.time=0;
          paint(false);send();
          play();
        }
      }
      send(false);schedule();
    } else if (state.phase==='film' && !state.paused && visibleFilm) {
      state.time=video.currentTime;
      refreshTime();send(false);schedule();
    }
  }
  function changePose(next:DeskPose, push=true) {
    if (projectionMode || state.phase!=='browse' || !space || (state.inquiry && state.inquiry.step!=='choose')) return;
    if (!hasOrbited) {hasOrbited=true;message.textContent='';}
    state.pose={yaw:clamp(next.yaw,-18,18),pitch:clamp(next.pitch,-5,6),zoom:clamp(next.zoom,.92,1.28)};
    state.evidence='none';
    paint(true);send(push);
  }
  frame.addEventListener('pointerdown',event=>{
    if (projectionMode || state.phase!=='browse' || !event.isPrimary || event.button!==0 || (event.target as Element).closest('button,article')) return;
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
    if (projectionMode || state.phase!=='browse' || !space) return;
    event.preventDefault();changePose({...state.pose,zoom:state.pose.zoom*Math.exp(-clamp(event.deltaY,-220,220)*.0013)});
  },{passive:false});
  seek.addEventListener('input',()=>{
    if (projectionMode || state.phase!=='film') return;
    state.time=Number(seek.value);
    video.currentTime=state.time;
    refreshTime();send();
  });
  seek.addEventListener('keydown',event=>{
    if (['ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(event.key)) event.stopPropagation();
  });
  video.addEventListener('seeked',()=>{
    if (disposed || state.phase!=='film') return;
    if (projectionMode) syncRemoteClock();
    else {state.time=video.currentTime;refreshTime();send();}
  });
  video.addEventListener('timeupdate',()=>{
    if (!disposed && state.phase==='film' && visibleFilm) {state.time=video.currentTime;refreshTime();send(false);}
  });
  video.addEventListener('ended',()=>{
    if (!disposed && !projectionMode && video.ended && state.phase==='film') back(state.reel==='action'?'left':'none');
  });
  video.addEventListener('error',()=>{if(!disposed && !projectionMode && state.phase==='film')failMovie();});

  function remoteTime(snapshot:DeskSnapshot) {
    const drift=snapshot.phase==='film'&&!snapshot.paused?clamp((Date.now()-snapshot.stamp)/1000,0,.75):0;
    return clamp(snapshot.time+drift,0,Math.max(0,duration()-.001));
  }
  function syncRemoteClock() {
    const remote=lastRemote;
    if (!remote || state.phase!=='film' || !visibleFilm) return;
    const target=remoteTime(remote);
    const tolerance = remote.paused ? .045 : .24;
    if (!video.seeking && Math.abs(video.currentTime-target)>tolerance) video.currentTime=target;
    if (remote.paused) video.pause(); else if(video.paused && !video.ended)play();
  }
  function restore(remote:DeskSnapshot) {
    if (!projectionMode || disposed || remote.revision<lastRevision) return;
    lastRevision=remote.revision;
    lastRemote=remote;
    const replaced=state.phase!==remote.phase || state.reel!==remote.reel;
    const moved=replaced || state.pose.yaw!==remote.pose.yaw || state.pose.pitch!==remote.pose.pitch || state.pose.zoom!==remote.pose.zoom;
    if (replaced) invalidate();
    state.phase=remote.phase;state.pose={...remote.pose};state.reel=remote.reel;
    state.evidence=remote.evidence;state.paused=remote.paused;state.time=remote.time;
    state.inquiry=remote.inquiry?{...remote.inquiry}:null;
    if (state.phase==='align' && replaced && !state.inquiry) {
      bind(state.reel);
      const signal=request.signal;
      decode(0,signal).catch(()=>{});
    } else if (state.phase==='film') {
      bind(state.reel);
      if (!visibleFilm && !waitingRemote) {
        const signal=request.signal;
        waitingRemote=true;
        decode(remoteTime(remote),signal).then(()=>{
          if (disposed || signal.aborted || state.phase!=='film') return;
          waitingRemote=false;visibleFilm=true;
          syncRemoteClock();paint(false);schedule();
        }).catch(()=>{
          if(!signal.aborted && !disposed){waitingRemote=false;message.textContent='投影视频未就绪。';}
        });
      } else syncRemoteClock();
    }
    paint(moved);schedule();
  }

  canvas.addEventListener('webglcontextlost',event=>{
    event.preventDefault();
    if (disposed) return;
    canvas.hidden=true;frame.dataset.space='fixed';
    if (!projectionMode) {state.pose=home();message.textContent='固定机位';}
    space?.dispose();space=undefined;paint(false);send();
  });
  createMeetingSpace(canvas,{
    manifest:mediaAssets['desk-manifest'], mesh:mediaAssets['desk-mesh'],
    front:mediaAssets['desk-front'], left:mediaAssets['desk-left'], right:mediaAssets['desk-right'],
  }).then(result=>{
    if (disposed) {result.dispose();return;}
    if (!projectionMode && state.phase==='browse' && !state.inquiry && !message.textContent) message.textContent='点选卷宗 · 拖动绕桌';
    space=result;canvas.hidden=false;frame.dataset.space='ready';resize();paint(true);
  }).catch(()=>{
    if(!disposed){frame.dataset.space='fixed';message.textContent='固定机位';paint(false);}
  });
  paint(false);
  return {
    transport,read,restore,
    dismiss:()=>{if(!projectionMode)leaveInquiry();},
    dispose:()=>{
      disposed=true;
      invalidate();
      observer.disconnect();
      cancelAnimationFrame(raf);
      if (boundReel) {video.removeAttribute('src');video.load();}
      inquiryView.dispose();
      space?.dispose();space=undefined;
    },
  };
}
