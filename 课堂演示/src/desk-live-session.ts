type DeskTarget = 'left'|'right'|'page-forward'|'page-back'|'cord'|'cover'|'before-sheet'|'discussion-sheet'|'map'|'overlay'|'table';
type DeskWorld = {
  draw:(view:DeskView)=>void;
  resize:(width:number,height:number)=>void;
  project:(target:DeskTarget,view:DeskView)=>readonly number[] | undefined;
  pick:(u:number,v:number,view:DeskView)=>DeskTarget|null|undefined;
  tablePoint:(u:number,v:number,view:DeskView)=>DeskPoint|null|undefined;
  dispose:()=>void;
};

type DeskPointer = {id:number;x:number;y:number;target?:DeskTarget;gesture:DeskGesture;offset?:DeskPoint;moved:boolean};

function mountDeskSession(frame:HTMLElement, canvas:HTMLCanvasElement, starting:DeskSaved, onChange:(view:DeskView,publish:boolean)=>void) {
  let saved=starting;
  let preview:DeskGesture | undefined;
  let evidence:DeskEvidence='none';
  let investigating=false;
  let carried=false;
  let pointer:DeskPointer|undefined;
  let world:DeskWorld|undefined;
  let animation=0;
  let pending:DeskSaved|undefined;
  let lastSent=-Infinity;
  let disposed=false;

  const read=():DeskView=>({saved,preview,evidence,investigating,carried});
  function renderView() {
    return preview?.kind==='camera' ? {...read(),saved:{...saved,camera:preview.pose},preview:undefined} : read();
  }
  function redraw(send = false, final = true) {
    if (disposed) return;
    world?.draw(renderView());
    const now = performance.now();
    const publish=send && !projectionMode && (final || now-lastSent>=38);
    if (publish) lastSent=now;
    onChange(read(),publish);
  }
  function finishPending() {
    cancelAnimationFrame(animation);
    animation=0;
    if (pending) {
      saved=pending;
      pending=undefined;
      preview=undefined;
    }
  }

  function edit(change:(previous:DeskSaved)=>DeskSaved) {
    if (projectionMode || disposed) return;
    finishPending();
    preview=undefined;
    saved=change(saved);
    redraw(true);
  }
  function cue(which:DeskEvidence, isCarried=false) {
    if (projectionMode || disposed) return;
    finishPending();
    evidence=which;
    carried=isCarried;
    preview=undefined;
    redraw(true);
  }

  function settle(gesture:DeskGesture, commit:boolean, from?:number) {
    if (gesture.kind==='inspect') return;
    finishPending();
    const next=commit ? settleDesk(saved,gesture) : saved;
    if (gesture.kind==='camera' || reducedMotion.matches) {edit(()=>next);return;}
    pending=next;
    const began=performance.now();
    const duration=gesture.kind==='sheet' ? 190 : 205;
    const distance=next===saved ? 0 : 1;
    const starting=from ?? (gesture.kind==='sheet' ? gesture.lift : gesture.progress);
    const goal=gesture.kind==='sheet' ? 0 : distance;
    const tick=(now:number)=>{
      if (disposed) return;
      const time=deskClamp((now-began)/duration,0,1);
      const progress=starting+(goal-starting)*(1-(1-time)**3);
      preview=gesture.kind==='sheet' ? {...gesture,lift:progress} : {...gesture,progress};
      if (time===1) finishPending();
      else animation=requestAnimationFrame(tick);
      redraw(true,time===1);
    };
    animation=requestAnimationFrame(tick);
  }

  function turn(direction:'forward'|'back') {
    finishPending();
    if (projectionMode || !world || (direction==='back' ? saved.spread===0 : saved.spread===deskSpreads)) return;
    evidence='none';carried=false;
    settle({kind:'page',direction,progress:1},true,0);
  }
  function toggleMap() {
    finishPending();
    if (projectionMode || !world) return;
    evidence='none';carried=false;
    const kind = saved.map==='stored' ? 'map' : 'overlay';
    settle({kind,progress:1},true,0);
  }

  const pointerAt=(event:PointerEvent):Point=>{
    const bounds=canvas.getBoundingClientRect();
    return [(event.clientX-bounds.left)/bounds.width,(event.clientY-bounds.top)/bounds.height];
  };
  function sheetCenter(id:DeskMaterial,target:DeskTarget) {
    const savedPoint=saved.sheets.find(sheet=>sheet.id===id)?.at;
    if (savedPoint) return savedPoint;
    const uv=world?.project(target,renderView());
    if (uv && uv.length===2) return world?.tablePoint(uv[0],uv[1],renderView());
  }
  function targetAt(uv:Point) { return world?.pick(...uv,renderView()) ?? undefined; }

  function start(event:PointerEvent) {
    if (projectionMode || !world || !event.isPrimary || event.button!==0 ||
      (event.target instanceof Element && event.target.closest('button,article'))) return;
    finishPending();
    const uv=pointerAt(event);
    const target=targetAt(uv);
    let gesture:DeskGesture={kind:'camera',pose:saved.camera};
    let offset:DeskPoint|undefined;
    if (target==='page-forward' && saved.spread<deskSpreads) gesture={kind:'page',direction:'forward',progress:0};
    else if (target==='page-back' && saved.spread>0) gesture={kind:'page',direction:'back',progress:0};
    else if (target==='cord' && saved.dossier==='sealed') gesture={kind:'cord',progress:0};
    else if (target==='cover' && saved.dossier==='untied') gesture={kind:'cover',progress:0};
    else if (target==='map' || target==='overlay') gesture={kind:target,progress:0};
    else if (target==='before-sheet' || target==='discussion-sheet') {
      const id=target==='before-sheet'?'before':'discussion';
      const at=sheetCenter(id,target);
      const cursor=world.tablePoint(...uv,renderView());
      if (at && cursor) {
        gesture={kind:'sheet',id,at,lift:.1};
        offset={x:at.x-cursor.x,z:at.z-cursor.z};
      }
    }
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY,target,gesture,offset,moved:false};
    frame.focus({preventScroll:true});
    frame.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent) {
    if (!pointer || pointer.id!==event.pointerId || !world) return;
    const dx=event.clientX-pointer.x,dy=event.clientY-pointer.y;
    pointer.moved ||= Math.hypot(dx,dy)>4;
    if (!pointer.moved) return;
    const box=canvas.getBoundingClientRect();
    const origin=pointer.gesture;
    if (origin.kind==='camera') {
      preview={kind:'camera',pose:deskCamera({...origin.pose,yaw:origin.pose.yaw-dx*60/box.width,
        pitch:origin.pose.pitch+dy*21/box.height})};
    } else if (origin.kind==='sheet') {
      const target=world.tablePoint(...pointerAt(event),renderView());
      if (target) preview={...origin,at:{x:target.x+(pointer.offset?.x??0),z:target.z+(pointer.offset?.z??0)},lift:.76};
    } else if (origin.kind!=='inspect') {
      const horizontal = origin.kind==='page' ? (origin.direction==='forward'?-dx:dx) : Math.abs(dx);
      const progress=origin.kind==='page' ? horizontal/(box.width*.19) : Math.max(horizontal/(box.width*.13),-dy/(box.height*.18));
      preview={...origin,progress:deskClamp(progress,0,1)};
    }
    if (evidence!=='none' && !carried) evidence='none';
    redraw(true,false);
  }
  function end(event:PointerEvent) {
    if (!pointer || pointer.id!==event.pointerId) return;
    const active=pointer;
    pointer=undefined;
    if (active.moved && preview && preview.kind!=='inspect') {settle(preview,true);return;}
    if (active.moved) {preview=undefined;redraw(true);return;}
    const released = active.gesture;
    if (released.kind==='sheet' && saved.sheets.some(item=>item.id===released.id)) {
      preview=preview?.kind==='inspect' && preview.id===released.id ? undefined : {kind:'inspect',id:released.id};
      redraw(true);
    } else if (active.target==='left') cue('left');
    else if (active.target==='right') cue(carried?'both':'right',carried);
    else if (active.gesture.kind!=='camera' && active.gesture.kind!=='sheet' && active.gesture.kind!=='inspect') {
      settle({...active.gesture,progress:1},true,0);
    } else {preview=undefined;redraw(true);}
  }
  function cancel(event:PointerEvent) {
    if (!pointer || pointer.id!==event.pointerId) return;
    pointer=undefined;
    if (preview) settle(preview,false);
    preview=undefined;
    redraw(true);
  }

  frame.addEventListener('pointerdown',start);
  frame.addEventListener('pointermove',move);
  frame.addEventListener('pointerup',end);
  frame.addEventListener('pointercancel',cancel);
  frame.addEventListener('lostpointercapture',cancel);
  frame.addEventListener('wheel',event=>{
    if (projectionMode || !world) return;
    event.preventDefault();
    edit(previous=>({...previous,camera:deskCamera({...previous.camera,zoom:previous.camera.zoom*Math.exp(-deskClamp(event.deltaY,-220,220)*.0013)})}));
  },{passive:false});
  frame.addEventListener('keydown',event=>{
    if (projectionMode || !world || event.target!==frame) return;
    const camera={...saved.camera};
    if (event.key==='ArrowLeft') camera.yaw-=4;
    else if (event.key==='ArrowRight') camera.yaw+=4;
    else if (event.key==='ArrowUp') camera.pitch+=2;
    else if (event.key==='ArrowDown') camera.pitch-=2;
    else if (event.key==='Home') Object.assign(camera,deskHome());
    else if (event.key==='[' || event.key===']') {
      event.preventDefault();
      return turn(event.key==='['?'back':'forward');
    } else return;
    event.preventDefault();
    edit(previous=>({...previous,camera:deskCamera(camera)}));
  });

  return {
    read, renderView, edit, cue, turn, toggleMap,
    get world() { return world; },
    connect(next:DeskWorld) { world=next;redraw(); },
    resize(width:number,height:number) {world?.resize(width,height);redraw();},
    restore(view:DeskView) {
      if (!projectionMode || disposed) return;
      ({saved,preview,evidence,investigating,carried}=view);
      redraw();
    },
    investigate() {
      if (projectionMode || disposed) return;
      finishPending();preview=undefined;evidence='none';carried=false;investigating=!investigating;
      redraw(true);
    },
    leave() {
      finishPending();disposed=true;world?.dispose();world=undefined;
      return saved;
    },
    releaseWorld() {world?.dispose();world=undefined;},
  };
}
