type DeskTarget = 'left'|'right'|'page-forward'|'page-back'|'cord'|'cover'|'before-sheet'|'discussion-sheet'|'map'|'overlay'|'table';
type DeskWorld = {
  draw:(view:DeskView, time?:number)=>void;
  resize:(width:number,height:number)=>void;
  project:(target:DeskTarget,view:DeskView)=>readonly number[] | undefined;
  pick:(u:number,v:number,view:DeskView)=>DeskTarget|null|undefined;
  tablePoint:(u:number,v:number,view:DeskView)=>DeskPoint|null|undefined;
  focusPoint:(target:DeskObject | DeskMaterial, view:DeskView)=>DeskPoint;
  setHover:(target:DeskTarget|null)=>boolean;
  dispose:()=>void;
};

type DeskLeaf = Extract<DeskGesture,{kind:'page'}>;
type DeskLeafDirection = DeskLeaf['direction'];
type DeskLeafDrag = {leaf:DeskLeaf; reverse:boolean};
type DeskPhysicalGesture = Exclude<DeskGesture,{kind:'inspect'|'camera'|'page'}>;
type DeskPointer = {
  id:number; x:number; y:number; target?:DeskTarget; moved:boolean; shift:DeskPoint;
  pose:DeskPose; leaf?:DeskLeafDrag; original?:DeskPhysicalGesture;
};

function mountDeskSession(frame:HTMLElement, canvas:HTMLCanvasElement, starting:DeskSaved,
  onChange:(view:DeskView)=>void) {
  const ambientLife=new AbortController();
  let saved=starting;
  let preview:DeskGesture|undefined;
  let reading:DeskReading|undefined;
  let pose=saved.camera;
  let focus:DeskFocus|undefined;
  let pointer:DeskPointer|undefined;
  let world:DeskWorld|undefined;
  let pageGoal=saved.spread;
  let objectFrame=0;
  let cameraFrame=0;
  let paintFrame=0;
  let ambientFrame=0;
  let ambientElapsed=0;
  let ambientStart:number|undefined;
  let hovered:DeskTarget|null=null;
  let completeObject:(()=>void)|undefined;
  let disposed=false;

  const read=():DeskView=>({saved,preview,reading,camera:pose,focus});
  function ambientSeconds(now:number) {
    return (ambientElapsed+(ambientStart===undefined ? 0 : Math.max(0,now-ambientStart)))*.001;
  }
  function redraw() {
    if (disposed) return;
    cancelAnimationFrame(paintFrame);
    paintFrame=0;
    const view=read();
    world?.draw(view,reducedMotion.matches ? 0 : ambientSeconds(performance.now()));
    onChange(view);
  }
  function queueDraw() {
    if (!paintFrame) paintFrame=requestAnimationFrame(()=>redraw());
  }
  function startAmbientLoop() {
    if (ambientFrame || disposed || !world || document.hidden || reducedMotion.matches) return;
    ambientStart=performance.now();
    let lastDraw=-Infinity;
    const step=(now:number)=>{
      ambientFrame=0;
      if (disposed || !world || document.hidden || reducedMotion.matches) {
        stopAmbientLoop();
        return;
      }
      if (!reading && !objectFrame && !cameraFrame && !pointer && now-lastDraw>=65) {
        lastDraw=now;
        world.draw(read(),ambientSeconds(now));
      }
      ambientFrame=requestAnimationFrame(step);
    };
    ambientFrame=requestAnimationFrame(step);
  }
  function stopAmbientLoop() {
    if (ambientFrame) cancelAnimationFrame(ambientFrame);
    ambientFrame=0;
    if (ambientStart !== undefined) {
      ambientElapsed+=performance.now()-ambientStart;
      ambientStart=undefined;
    }
  }
  function syncAmbientLoop() {
    if (document.hidden || reducedMotion.matches) stopAmbientLoop();
    else startAmbientLoop();
  }

  function clearObjectAnimation(commit=false) {
    cancelAnimationFrame(objectFrame);
    objectFrame=0;
    if (commit) completeObject?.();
    completeObject=undefined;
  }
  function playPaper(gesture:DeskLeaf | DeskPhysicalGesture) {
    if (gesture.kind==='page' || gesture.kind==='cover') soundscape.playSfx('paper-turn');
    else if (gesture.kind==='cord') soundscape.playSfx('rope-untie');
    else soundscape.playSfx('paper-slide');
  }
  function settleObject(gesture:DeskPhysicalGesture, commit:boolean, from:number,
    options:{then?:()=>void; returnTo?:DeskPoint}={}) {
    if (preview?.kind==='page') {
      pageGoal=saved.spread;
      preview=undefined;
    }
    clearObjectAnimation(true);
    const next=commit ? settleDesk(saved,gesture) : saved;
    if (next!==saved) playPaper(gesture);
    const finish=()=>{
      saved={...next,camera:saved.camera,seen:saved.seen};
      preview=undefined;
    };
    if (reducedMotion.matches || !world) {finish();redraw();options.then?.();return;}
    completeObject=finish;
    const started=performance.now();
    const goal=gesture.kind==='sheet' ? 0 : Number(next!==saved);
    const tick=(now:number)=>{
      const progress=deskClamp((now-started)/(gesture.kind==='sheet' ? 175 : 245),0,1);
      const eased=1-(1-progress)**3;
      const current=from+(goal-from)*eased;
      if (gesture.kind==='sheet') {
        const target=options.returnTo;
        const at=target ? {x:gesture.at.x+(target.x-gesture.at.x)*eased,z:gesture.at.z+(target.z-gesture.at.z)*eased} : gesture.at;
        preview={...gesture,at,lift:current};
      } else preview={...gesture,progress:current};
      if (progress===1) {
        clearObjectAnimation(true);
        redraw();
        options.then?.();
      } else {
        objectFrame=requestAnimationFrame(tick);
        queueDraw();
      }
    };
    preview=gesture.kind==='sheet' ? {...gesture,lift:from} : {...gesture,progress:from};
    objectFrame=requestAnimationFrame(tick);
    redraw();
  }

  const leafStep=(direction:DeskLeafDirection)=>direction==='forward' ? 1 : -1;
  function steerLeaf() {
    const active=preview?.kind==='page' ? preview : undefined;
    const difference=pageGoal-saved.spread;
    if (!active && !difference) return;
    const leaf:DeskLeaf=active ?? {kind:'page',direction:difference>0 ? 'forward' : 'back',progress:0};
    const destination=Number(difference*leafStep(leaf.direction)>0);
    const from=leaf.progress;
    const started=performance.now();
    const duration=(Math.abs(difference)>1 ? 205 : 285)*Math.max(.24,Math.abs(destination-from));
    clearObjectAnimation();
    if (!active && destination===1) playPaper(leaf);
    function finish() {
      if (destination===1) saved=settleDesk(saved,{...leaf,progress:1});
      preview=undefined;
      objectFrame=0;
      steerLeaf();
      redraw();
    }
    if (reducedMotion.matches || !world) {finish();return;}
    preview=leaf;
    const tick=(now:number)=>{
      const elapsed=deskClamp((now-started)/duration,0,1);
      const eased=elapsed*elapsed*(3-2*elapsed);
      preview={...leaf,progress:from+(destination-from)*eased};
      if (elapsed===1) finish();
      else {objectFrame=requestAnimationFrame(tick);queueDraw();}
    };
    objectFrame=requestAnimationFrame(tick);
    redraw();
  }
  function turn(direction:DeskLeafDirection) {
    if (disposed) return;
    clearPointer();
    if (preview?.kind!=='page') {
      clearObjectAnimation(true);
      preview=undefined;
    }
    if (direction==='back' && reading?.kind==='journal' && pageGoal<=1) return;
    const limit=deskClamp(pageGoal+leafStep(direction),0,deskSpreads);
    if (limit===pageGoal) return;
    pageGoal=limit;
    steerLeaf();
  }
  function beginLeaf(direction:DeskLeafDirection):DeskLeafDrag|undefined {
    if (disposed) return;
    const current=preview?.kind==='page' ? preview : undefined;
    if (!current && direction==='back' && reading?.kind==='journal' && saved.spread<=1) return;
    if (!current && deskClamp(saved.spread+leafStep(direction),0,deskSpreads)===saved.spread) return;
    clearObjectAnimation(!current);
    pageGoal=saved.spread;
    const leaf=current ?? {kind:'page',direction,progress:0};
    const reverse=leaf.direction!==direction;
    preview=leaf;
    return {leaf,reverse};
  }
  function dragLeaf(drag:DeskLeafDrag, displacement:number) {
    preview={...drag.leaf,progress:deskClamp(drag.leaf.progress+(drag.reverse?-1:1)*displacement,0,1)};
    queueDraw();
  }
  function releaseLeaf(drag:DeskLeafDrag, cancel=false) {
    if (preview?.kind!=='page') return;
    const commit=!cancel && preview.progress>=(drag.reverse ? .59 : .37);
    pageGoal=saved.spread+(commit ? leafStep(drag.leaf.direction) : 0);
    if (commit) playPaper(drag.leaf);
    steerLeaf();
  }
  function cancelLeaf() {
    if (preview?.kind!=='page') return;
    pageGoal=saved.spread;
    steerLeaf();
  }

  function travelCamera(target:DeskPose, nextFocus:DeskFocus|undefined, duration:number) {
    cancelAnimationFrame(cameraFrame);
    cameraFrame=0;
    const start=pose;
    const startFocus=focus ?? (nextFocus && {...nextFocus,amount:0});
    const endFocus=nextFocus ?? (focus && {...focus,amount:0});
    if (!world || reducedMotion.matches || (start===target && !startFocus?.amount && !endFocus?.amount)) {
      pose=target;
      focus=nextFocus;
      redraw();
      return;
    }
    const began=performance.now();
    const blend=(a:number,b:number,t:number)=>a+(b-a)*t;
    const tick=(now:number)=>{
      const fraction=deskClamp((now-began)/duration,0,1);
      const eased=fraction*fraction*(3-2*fraction);
      if (start!==target) {
        pose=fraction===1 ? target : {
          yaw:blend(start.yaw,target.yaw,eased),pitch:blend(start.pitch,target.pitch,eased),zoom:blend(start.zoom,target.zoom,eased),
        };
      }
      focus=fraction===1 || !startFocus || !endFocus ? nextFocus : {
        x:blend(startFocus.x,endFocus.x,eased),z:blend(startFocus.z,endFocus.z,eased),
        amount:blend(startFocus.amount,endFocus.amount,eased),
      };
      cameraFrame=fraction===1 ? 0 : requestAnimationFrame(tick);
      if (fraction===1) redraw();
      else queueDraw();
    };
    cameraFrame=requestAnimationFrame(tick);
  }
  function setHover(target:DeskTarget|null) {
    frame.dataset.hover=target ?? '';
    if (target!==hovered) {
      hovered=target;
      if (world?.setHover(target)) redraw();
    }
  }
  function clearPointer() {
    const id=pointer?.id;
    pointer=undefined;
    if (id!==undefined && frame.hasPointerCapture(id)) frame.releasePointerCapture(id);
    canvas.style.cursor='';
  }
  function selectedKind(value:DeskReading):DeskObject | DeskMaterial {
    if (value.kind==='sheet') return value.id;
    if (value.kind==='compare') return 'dossier';
    if (value.kind==='clue') return value.source;
    return value.kind;
  }
  function openReading(next:DeskReading) {
    if (disposed) return;
    clearPointer();
    const previous=reading;
    if (!previous && cameraFrame) saved={...saved,camera:pose};
    reading=next;
    setHover(null);
    const object=selectedKind(next);
    const seen=saved.seen ?? [];
    if (next.kind==='compare') saved={...saved,seen:[...new Set<DeskObject>([...seen,'journal','dossier'])]};
    else if (object!=='before' && object!=='discussion' && !seen.includes(object)) saved={...saved,seen:[...seen,object]};
    if (!previous || selectedKind(previous)!==object) {
      const point=world?.focusPoint(object,read());
      if (point) travelCamera(saved.camera,{...point,amount:next.kind==='compare' ? .45 : 1},375);
      soundscape.playSfx('point');
    }
    if (next.kind==='journal' && pageGoal===0) turn('forward');
    if (next.kind==='dossier' && saved.dossier!=='open' && world) {
      const openCover=()=>settleObject({kind:'cover',progress:1},true,0);
      if (saved.dossier==='sealed') settleObject({kind:'cord',progress:1},true,0,{then:openCover});
      else openCover();
    }
    if ((next.kind==='map' || next.kind==='clue' && next.source==='map') && saved.map==='stored' && world) {
      settleObject({kind:'map',progress:1},true,0);
    }
    redraw();
  }
  function chooseMap(mode:DeskRouteMode) {
    if (disposed || reading?.kind!=='map' || reading.mode===mode) return;
    clearObjectAnimation(true);
    saved={...saved,map:mode==='parallel' ? 'both' : mode,routeReading:mode};
    reading={kind:'map',mode,drawAt:Date.now()};
    redraw();
  }
  function openMap() {
    const mode=saved.routeReading ?? (saved.map==='stored' ? 'original' : saved.map);
    openReading({kind:'map',mode,drawAt:saved.routeReading ? 0 : Date.now()});
  }

  function dismiss() {
    if (disposed) return;
    const active=pointer;
    clearPointer();
    if (active) cancelPointerMotion(active);
    else if (preview?.kind==='page') cancelLeaf();
    if (reading) {
      reading=undefined;
      travelCamera(saved.camera,undefined,315);
    }
    redraw();
  }
  function switchCamera(target:DeskPose,duration:number) {
    if (disposed || !world) return;
    if (pointer?.moved) {
      if (preview?.kind==='page') cancelLeaf();
      else preview=undefined;
    }
    clearPointer();
    reading=undefined;
    saved={...saved,camera:deskCamera(target)};
    travelCamera(saved.camera,undefined,duration);
    redraw();
  }
  function zoom(factor:number) {
    switchCamera({...saved.camera,zoom:saved.camera.zoom*factor},155);
  }

  const pointerAt=(event:PointerEvent):Point=>{
    const bounds=canvas.getBoundingClientRect();
    return [(event.clientX-bounds.left)/bounds.width,(event.clientY-bounds.top)/bounds.height];
  };
  function targetAt(uv:Point) {return world?.pick(...uv,read()) ?? undefined;}
  function start(event:PointerEvent) {
    if (!world || reading || !event.isPrimary || event.button!==0 ||
      (event.target instanceof Element && event.target.closest('button'))) return;
    const uv=pointerAt(event), target=targetAt(uv);
    let original:DeskPhysicalGesture|undefined;
    let shift={x:0,z:0};
    if (target==='cord' || target==='cover' || target==='map' || target==='overlay') original={kind:target,progress:0};
    if (target==='before-sheet' || target==='discussion-sheet') {
      const id=target==='before-sheet'?'before':'discussion';
      const cursor=world.tablePoint(...uv,read());
      const at=world.focusPoint(id,read());
      if (cursor) {
        original={kind:'sheet',id,at,lift:0};
        shift={x:at.x-cursor.x,z:at.z-cursor.z};
      }
    }
    pointer={id:event.pointerId,x:event.clientX,y:event.clientY,target,moved:false,original,shift,pose};
    frame.focus({preventScroll:true});
    frame.setPointerCapture(event.pointerId);
  }
  function move(event:PointerEvent) {
    if (!world || reading) return;
    if (!pointer || pointer.id!==event.pointerId) {
      const target=event.target instanceof Element && event.target.closest('button') ? null : targetAt(pointerAt(event)) ?? null;
      canvas.style.cursor=target ? 'pointer' : 'grab';
      setHover(target);
      return;
    }
    const dx=event.clientX-pointer.x, dy=event.clientY-pointer.y;
    if (!pointer.moved) {
      if (Math.hypot(dx,dy)<6) return;
      pointer.moved=true;
      if (pointer.original?.kind==='overlay' && dx>0 && dx>Math.abs(dy)*1.4) {
        pointer.original={kind:'map',progress:0};
      }
      const direction=pointer.target==='page-forward' ? 'forward' : pointer.target==='page-back' ? 'back' : undefined;
      if (direction) pointer.leaf=beginLeaf(direction);
      if (!pointer.leaf && pointer.original) {
        if (preview?.kind==='page') pageGoal=saved.spread;
        clearObjectAnimation(true);
        preview=undefined;
      } else if (!pointer.leaf) {
        cancelAnimationFrame(cameraFrame);
        cameraFrame=0;
        pointer.pose=pose;
        if (focus?.amount) travelCamera(pose,undefined,185);
      }
      canvas.style.cursor='grabbing';
      setHover(null);
    }
    const width=canvas.clientWidth, height=canvas.clientHeight;
    const original=pointer.original;
    if (pointer.leaf) {
      dragLeaf(pointer.leaf,(pointer.target==='page-forward' ? -dx : dx)/Math.max(60,width*.155));
      return;
    }
    if (original?.kind==='sheet') {
      const at=world.tablePoint(...pointerAt(event),read());
      if (at) preview={...original,at:{
        x:deskClamp(at.x+pointer.shift.x,-.71,.71),z:deskClamp(at.z+pointer.shift.z,-.31,.31),
      },lift:deskClamp(Math.hypot(dx,dy)/90,.15,.88)};
    } else if (original) {
      preview={...original,progress:deskClamp(Math.max(Math.abs(dx)/(width*.115),-dy/(height*.15)),0,1)};
    } else {
      const start=pointer.pose;
      pose=deskCamera({...start,yaw:start.yaw-dx*57/width,pitch:start.pitch+dy*22/height});
    }
    queueDraw();
  }
  function end(event:PointerEvent) {
    const active=pointer;
    if (!active || active.id!==event.pointerId) return;
    clearPointer();
    if (active.moved) {
      if (active.leaf) releaseLeaf(active.leaf);
      else if (active.original && preview && preview.kind!=='page' && preview.kind!=='inspect' && preview.kind!=='camera') {
        settleObject(preview,preview.kind==='sheet' || preview.progress>=.43,preview.kind==='sheet' ? preview.lift : preview.progress);
      } else {
        saved={...saved,camera:pose};
        redraw();
      }
      return;
    }
    switch (active.target) {
      case 'left': case 'page-forward': case 'page-back': openReading({kind:'journal'});break;
      case 'right': case 'cord': case 'cover': openReading({kind:'dossier'});break;
      case 'map': case 'overlay': openMap();break;
      case 'before-sheet': case 'discussion-sheet': {
        const id=active.target==='before-sheet'?'before':'discussion';
        if (!saved.sheets.some(item=>item.id===id) && active.original?.kind==='sheet') {
          const at=id==='before' ? {x:-.11,z:.26} : {x:.19,z:.24};
          settleObject({...active.original,at,lift:.44},true,.44);
        }
        openReading({kind:'sheet',id});
        break;
      }
    }
  }
  function cancel(event:PointerEvent) {
    const active=pointer;
    if (!active || active.id!==event.pointerId) return;
    clearPointer();
    cancelPointerMotion(active);
  }
  function cancelPointerMotion(active:DeskPointer) {
    if (active.leaf) releaseLeaf(active.leaf,true);
    else if (!active.moved) return;
    else if (preview?.kind==='sheet' && active.original?.kind==='sheet') {
      settleObject(preview,false,preview.lift,{returnTo:active.original.at});
    } else if (active.original && preview && 'progress' in preview && preview.kind!=='page') {
      settleObject(preview,false,preview.progress);
    } else {
      travelCamera(saved.camera,undefined,205);
    }
  }

  frame.addEventListener('pointerdown',start);
  frame.addEventListener('pointermove',move);
  frame.addEventListener('pointerup',end);
  frame.addEventListener('pointercancel',cancel);
  frame.addEventListener('lostpointercapture',cancel);
  frame.addEventListener('pointerleave',()=>{if (!pointer) setHover(null);});
  frame.addEventListener('wheel',event=>{
    if (!world || reading) return;
    event.preventDefault();
    const delta=event.deltaY*(event.deltaMode===1 ? 16 : event.deltaMode===2 ? 360 : 1);
    zoom(Math.exp(-deskClamp(delta,-200,200)*.0016));
  },{passive:false});
  frame.addEventListener('keydown',event=>{
    if (reading || event.target!==frame) return;
    const target={...saved.camera};
    switch (event.key) {
      case 'ArrowLeft': target.yaw-=4;break;
      case 'ArrowRight': target.yaw+=4;break;
      case 'ArrowUp': target.pitch+=2;break;
      case 'ArrowDown': target.pitch-=2;break;
      case 'Home': Object.assign(target,deskHome());break;
      case '+': case '=': target.zoom*=1.13;break;
      case '-': target.zoom/=1.13;break;
      case '[': case ']': event.preventDefault();turn(event.key==='['?'back':'forward');return;
      default: return;
    }
    event.preventDefault();
    switchCamera(target,195);
  });
  const blur=()=>{if (pointer) dismiss();};
  window.addEventListener('blur',blur);
  const {signal}=ambientLife;
  document.addEventListener('visibilitychange',syncAmbientLoop,{signal});
  reducedMotion.addEventListener('change',syncAmbientLoop,{signal});

  return {
    read, turn, beginLeaf, dragLeaf, releaseLeaf, openReading, openMap, chooseMap, dismiss,
    get world() {return world;},
    connect(next:DeskWorld) {
      stopAmbientLoop();
      ambientElapsed=0;
      world=next;
      if (reading) {
        const point=world.focusPoint(selectedKind(reading),read());
        travelCamera(saved.camera,{...point,amount:reading.kind==='compare' ? .45 : 1},375);
      }
      redraw();
      startAmbientLoop();
    },
    resize(width:number,height:number) {world?.resize(width,height);redraw();},
    leave() {
      window.removeEventListener('blur',blur);
      ambientLife.abort();
      stopAmbientLoop();
      cancelAnimationFrame(cameraFrame);
      cancelAnimationFrame(paintFrame);
      clearPointer();
      clearObjectAnimation(true);
      disposed=true;
      world?.dispose();
      world=undefined;
      return saved;
    },
    releaseWorld() {
      stopAmbientLoop();
      world?.dispose();
      world=undefined;
    },
  };
}
