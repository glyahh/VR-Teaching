const get = id => document.getElementById(id);
const stage = get('stage');
const plate = get('plate');
const space = get('space');
const film = get('film');
const route = LAB.route;
const liveScene = route !== 'A';
const usesFilm = route !== 'B';
const baseCamera = LAB.scene.camera;
const anchor = {yaw: baseCamera.yaw, pitch: baseCamera.pitch, radius: baseCamera.radius};
const pageModel = LAB.scene.object;
const publicKey = new URLSearchParams(location.hash.slice(1)).get('p');
const projecting = Boolean(publicKey && /^[0-9a-f]{32}$/.test(publicKey));
document.body.classList.toggle('projecting', projecting);

const state = {
  pose: {...anchor, yaw: -16},
  phase: 'browse',
  paused: false,
  finished: false,
  time: 0,
  duration: 4,
};
let renderer;
let strips = [];
let loaded = false;
let dirty = true;
let epoch = 0;
let transition = null;
let previousTick = 0;
let animationFrame = 0;
let popup = null;
let sessionKey = '';
let recipientReady = false;
let sequence = 0;
let lastReceived = 0;
let lastPublish = 0;
let remoteClock = null;
let pointer = null;
let comparisonEpoch = 0;
let seamPair = null;
let actualCut = null;
let publicMediaEpoch = 0;
let filmSurfaceReady = false;

const limit = (value, low, high) => Math.max(low, Math.min(high, value));
const ease = value => value * value * (3 - 2 * value);
const radians = degrees => degrees * Math.PI / 180;
const lerp = (start, end, fraction) => start + (end - start) * fraction;
const hints = {
  A: '左右拖动切换预渲染机位，点桌上的卷宗翻阅。',
  B: '拖动绕桌，滚轮拉近。翻页时也可以换角度。',
  C: '拖动绕桌，滚轮拉近。点卷宗后镜头归位，再进入短片。',
};

function imageReady(src) {
  return new Promise((resolve, reject) => {
    const picture = new Image();
    picture.onload = () => resolve(picture);
    picture.onerror = () => reject(new Error('内嵌画面读取失败'));
    picture.src = src;
  });
}

function waitMedia(element, eventName, satisfied) {
  if (satisfied()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const clear = () => {
      clearTimeout(timer);
      element.removeEventListener(eventName, success);
      element.removeEventListener('error', failure);
    };
    const success = () => {
      if (!satisfied()) return;
      clear();
      resolve();
    };
    const failure = () => {
      clear();
      reject(new Error('本机未能解码内嵌短片'));
    };
    const timer = setTimeout(failure, 8000);
    element.addEventListener(eventName, success);
    element.addEventListener('error', failure);
  });
}

async function positionFilm(element, seconds, valid = () => true) {
  await waitMedia(element, 'loadeddata', () => element.readyState >= 2);
  if (!valid()) return;
  if (Math.abs(element.currentTime - seconds) > .007) element.currentTime = seconds;
  await waitMedia(element, 'seeked', () => !element.seeking && element.readyState >= 2);
}

function viewIndex(yaw) {
  return limit(Math.round((yaw + 32) / 4), 0, 16);
}

function projectStill(point, pose) {
  const angle = radians(pose.yaw);
  const tilt = radians(pose.pitch);
  const offset = point.map((value, index) => value - baseCamera.target[index]);
  const depth = pose.radius - offset[0] * Math.sin(angle) * Math.cos(tilt)
    - offset[1] * Math.sin(tilt) - offset[2] * Math.cos(angle) * Math.cos(tilt);
  const across = offset[0] * Math.cos(angle) - offset[2] * Math.sin(angle);
  const above = -offset[0] * Math.sin(angle) * Math.sin(tilt) + offset[1] * Math.cos(tilt)
    - offset[2] * Math.cos(angle) * Math.sin(tilt);
  const height = 2 * depth * Math.tan(radians(baseCamera.fov) / 2);
  return [.5 + across / (height * 16 / 9), .5 - above / height];
}

function targetPoint(across, deep) {
  const [left, height, center] = pageModel.hinge;
  return [left + pageModel.width * across, height, center + pageModel.depth * deep];
}

function visiblePose() {
  if (liveScene) return state.pose;
  return {...anchor, yaw: viewIndex(state.pose.yaw) * 4 - 32};
}

function hitPaper(horizontal, vertical) {
  const pose = visiblePose();
  if (liveScene) return renderer.pick(horizontal, vertical, pose, state.phase === 'clip' ? state.time/state.duration : 0);
  const corners = [[0,-.5],[1,-.5],[1,.5],[0,.5]].map(([across, deep]) => projectStill(targetPoint(across, deep),pose));
  const products = corners.map(([startX,startY],index) => {
    const [endX,endY] = corners[(index + 1) % corners.length];
    return (endX - startX) * (vertical - startY) - (endY - startY) * (horizontal - startX);
  });
  return products.every(value => value >= 0) || products.every(value => value <= 0);
}

function matchAmount(pose) {
  if (route !== 'C') return 0;
  const distance = Math.hypot((pose.yaw-anchor.yaw)/16, (pose.pitch-anchor.pitch)/12, (pose.radius-anchor.radius)/.62);
  return ease(limit(1-distance,0,1));
}

function drawScene() {
  if (!loaded) return;
  const pose = visiblePose();
  const isMovie = usesFilm && state.phase === 'clip' && filmSurfaceReady;
  stage.classList.toggle('video-on', isMovie);
  if (liveScene && !isMovie) {
    const progress = !usesFilm && state.phase === 'clip' ? state.time/state.duration : 0;
    renderer.draw(pose, progress, matchAmount(pose), state.finished);
  } else if (!liveScene && !isMovie) {
    plate.getContext('2d').drawImage(strips[viewIndex(pose.yaw)],0,0,plate.width,plate.height);
  }
  const pin = get('pin');
  pin.hidden = projecting || state.phase !== 'browse';
  if (!pin.hidden) {
    const point = targetPoint(.5,0);
    const [horizontal, vertical] = liveScene ? renderer.project(point,pose) : projectStill(point,pose);
    pin.style.left = (horizontal * 100)+'%';
    pin.style.top = (vertical * 100)+'%';
  }
  dirty = false;
}

function showControls() {
  const browse = state.phase === 'browse';
  const canLook = browse || (route === 'B' && state.phase === 'clip');
  stage.dataset.phase = state.phase;
  stage.dataset.paused = String(state.paused);
  stage.dataset.finished = String(state.finished);
  const pose = visiblePose();
  for (const field of ['yaw','pitch','radius']) stage.dataset[field] = pose[field].toFixed(4);
  get('play').textContent = browse ? (state.finished ? '再翻一次' : '翻阅卷宗') : state.paused ? '继续' : '暂停';
  get('reset').hidden = browse;
  for (const id of ['front','left','right']) get(id).disabled = !loaded || !canLook;
  get('seek').disabled = state.phase !== 'clip';
  get('seek').max = state.duration;
  get('seek').value = state.time;
  get('time').textContent = state.time.toFixed(1)+' / '+state.duration.toFixed(1)+' 秒';
  get('hint').textContent = state.phase === 'align'
    ? (state.paused ? '镜头已暂停。' : '正在回到入片机位。')
    : state.phase === 'clip' ? (route === 'B' ? '动作由浏览器绘制，仍可旋转观察。' : '正在观看固定机位短片。')
    : hints[route];
}

function refresh(publish = false) {
  dirty = true;
  drawScene();
  showControls();
  if (publish) publishView(true);
}

function resizeScene() {
  if (liveScene) {
    const width = Math.max(320, Math.min(1280, Math.round(stage.clientWidth * Math.min(devicePixelRatio,1.5) / 16) * 16));
    if (space.width !== width) {
      space.width = width;
      space.height = width * 9/16;
    }
  }
  if (loaded) refresh();
}

function setPose(next) {
  if (projecting || !loaded || (state.phase !== 'browse' && !(route === 'B' && state.phase === 'clip'))) return;
  state.pose = {
    yaw: limit(next.yaw,-32,32),
    pitch: liveScene ? limit(next.pitch,12,37) : anchor.pitch,
    radius: liveScene ? limit(next.radius,1.83,3.45) : anchor.radius,
  };
  if (!liveScene) state.pose.yaw = viewIndex(state.pose.yaw)*4-32;
  refresh(true);
}

function backToDesk(completed = false) {
  epoch++;
  transition = null;
  filmSurfaceReady = false;
  if (usesFilm) film.pause();
  state.phase = 'browse';
  state.paused = false;
  state.finished = completed;
  state.time = completed ? state.duration : 0;
  refresh(true);
}

function problem(message) {
  get('notice').hidden = false;
  get('notice').textContent = message;
}

function playVideo(run) {
  return film.play().catch(() => {
    if (run !== epoch || state.phase !== 'clip' || state.paused) return;
    state.paused = true;
    refresh(true);
    problem('播放被浏览器暂停，可点击继续。');
  });
}

function startAction() {
  if (!loaded || projecting || state.phase !== 'browse') return;
  const run = ++epoch;
  state.time = 0;
  state.finished = false;
  state.paused = false;
  get('notice').hidden = true;
  if (usesFilm) {
    filmSurfaceReady = false;
    state.phase = 'align';
    transition = {
      from: {...state.pose}, elapsed: 0, ready: false, heldAtAnchor: 0,
      duration: .32 + Math.min(.61, Math.hypot(state.pose.yaw, state.pose.pitch-anchor.pitch)*.015 + Math.abs(state.pose.radius-anchor.radius)*.21),
    };
    film.pause();
    positionFilm(film,0,()=>run===epoch).then(()=>{
      if (run === epoch && transition) transition.ready = true;
    }).catch(()=>{
      if (run === epoch) {backToDesk();problem('短片未就绪，可以继续观察或重试。');}
    });
  } else {
    state.phase = 'clip';
  }
  refresh(true);
}

function togglePlay() {
  if (state.phase === 'browse') {startAction();return;}
  if (projecting || !loaded) return;
  get('notice').hidden = true;
  state.paused = !state.paused;
  if (usesFilm && state.phase === 'clip') {
    if (state.paused) {film.pause();state.time = film.currentTime;}
    else playVideo(epoch);
  }
  refresh(true);
}

function tick(now) {
  const delta = previousTick ? Math.min((now-previousTick)/1000,.20) : 0;
  previousTick = now;
  if (!projecting && state.phase === 'align' && transition && !state.paused) {
    const move = transition;
    move.elapsed += delta;
    const fraction = Math.min(1,move.elapsed/move.duration);
    for (const key of ['yaw','pitch','radius']) state.pose[key] = lerp(move.from[key],anchor[key],ease(fraction));
    if (fraction === 1) {
      move.heldAtAnchor += delta;
      if (move.ready && move.heldAtAnchor >= .09) {
        drawScene();
        actualCut = {from: move.from.yaw, before:copyFrame(liveScene ? space : plate), after:copyFrame(film)};
        transition = null;
        filmSurfaceReady = true;
        state.phase = 'clip';
        const run = epoch;
        requestAnimationFrame(() => {
          if (run===epoch && state.phase==='clip' && !state.paused) playVideo(run);
        });
      }
    }
    dirty = true;
  } else if (state.phase === 'clip' && !state.paused) {
    if (usesFilm) state.time = film.currentTime;
    else if (projecting && remoteClock) state.time = Math.min(state.duration,remoteClock.time + (performance.now()-remoteClock.stamp)/1000);
    else state.time = Math.min(state.duration,state.time+delta);
    if (!projecting && !usesFilm && state.time >= state.duration) backToDesk(true);
    dirty = true;
  }
  if (dirty) {drawScene();showControls();}
  if (!projecting && state.phase !== 'browse' && !state.paused) publishView(false);
  animationFrame = requestAnimationFrame(tick);
}

film.addEventListener('ended',() => {
  if (!projecting && state.phase === 'clip') backToDesk(true);
});
get('play').onclick = togglePlay;
get('pin').onclick = startAction;
get('reset').onclick = () => backToDesk();
get('left').onclick = () => setPose({...state.pose,yaw:state.pose.yaw-8});
get('right').onclick = () => setPose({...state.pose,yaw:state.pose.yaw+8});
get('front').onclick = () => setPose({...anchor});
get('seek').oninput = event => {
  if (projecting || state.phase !== 'clip') return;
  state.time = Number(event.target.value);
  if (usesFilm) film.currentTime = state.time;
  refresh(true);
};
film.addEventListener('seeked',() => {
  if (state.phase === 'clip' && !projecting) {state.time = film.currentTime;refresh(true);}
});

stage.addEventListener('pointerdown',event=>{
  if (projecting || !loaded || !event.isPrimary || event.button !== 0 || event.target.closest('button')) return;
  pointer = {id:event.pointerId,x:event.clientX,y:event.clientY,pose:{...state.pose},drag:false};
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointermove',event=>{
  if (!pointer || event.pointerId !== pointer.id) return;
  const dx = event.clientX - pointer.x, dy = event.clientY - pointer.y;
  if (Math.hypot(dx,dy) > 4) pointer.drag = true;
  if (pointer.drag) setPose({...pointer.pose,yaw:pointer.pose.yaw-dx*80/stage.clientWidth,pitch:pointer.pose.pitch+dy*42/stage.clientHeight});
});
stage.addEventListener('pointerup',event=>{
  if (!pointer || event.pointerId !== pointer.id) return;
  const tap = !pointer.drag;
  pointer = null;
  if (tap && state.phase === 'browse') {
    const rect = stage.getBoundingClientRect();
    if (hitPaper((event.clientX-rect.x)/rect.width,(event.clientY-rect.y)/rect.height)) startAction();
  }
});
stage.addEventListener('pointercancel',()=>{pointer=null;});
stage.addEventListener('wheel',event=>{
  if (!liveScene || projecting) return;
  event.preventDefault();
  setPose({...state.pose,radius:state.pose.radius*Math.exp(limit(event.deltaY,-180,180)*.0015)});
},{passive:false});
stage.addEventListener('keydown',event=>{
  if (projecting || event.target !== stage) return;
  const pose = state.pose;
  if (event.key === 'ArrowLeft') setPose({...pose,yaw:pose.yaw-4});
  else if (event.key === 'ArrowRight') setPose({...pose,yaw:pose.yaw+4});
  else if (event.key === 'ArrowUp') setPose({...pose,pitch:pose.pitch+3});
  else if (event.key === 'ArrowDown') setPose({...pose,pitch:pose.pitch-3});
  else if (event.key === 'Home') setPose({...anchor});
  else if (event.key === ' ' || event.key === 'Enter') togglePlay();
  else return;
  event.preventDefault();
});

function publishView(force) {
  if (!recipientReady || !popup || popup.closed) return;
  if (!force && performance.now()-lastPublish<110) return;
  lastPublish=performance.now();
  popup.postMessage({type:'scene',token:sessionKey,seq:++sequence,stamp:Date.now(),view:{...state,pose:{...state.pose}}},'*');
}

function applyPublic(message) {
  if (!loaded || message.seq <= lastReceived) return;
  lastReceived = message.seq;
  const next = message.view;
  const previousPhase = state.phase;
  state.pose = {...next.pose};
  state.phase = next.phase;
  state.paused = next.paused;
  state.finished = next.finished;
  const delay = next.phase === 'clip' && !next.paused ? limit((Date.now()-message.stamp)/1000,0,.4) : 0;
  state.time = Math.min(state.duration,next.time+delay);
  remoteClock = {time:state.time,stamp:performance.now()};
  if (usesFilm) {
    if (state.phase !== 'clip') {
      if (previousPhase==='clip') publicMediaEpoch++;
      filmSurfaceReady=false;
      film.pause();
      if (state.phase==='align' && previousPhase!=='align' && film.currentTime>.007) film.currentTime=0;
    } else if (previousPhase!=='clip') {
      const generation=++publicMediaEpoch;
      filmSurfaceReady=false;
      film.pause();
      positionFilm(film,state.time,()=>generation===publicMediaEpoch).then(()=>{
        if(generation!==publicMediaEpoch||state.phase!=='clip') return;
        filmSurfaceReady=true;
        if(!state.paused)film.play().catch(()=>{});
        refresh();
      }).catch(()=>{if(generation===publicMediaEpoch)problem('投影视频未就绪，已保留场景画面。');});
    } else if(filmSurfaceReady) {
      const tolerance = state.paused ? .045 : .20;
      if (!film.seeking && Math.abs(film.currentTime-state.time)>tolerance) film.currentTime = state.time;
      if (state.paused) film.pause();
      else if (film.paused) film.play().catch(()=>{});
    }
  }
  refresh();
}
get('project').onclick=()=>{
  if (popup && !popup.closed) {popup.focus();publishView(true);return;}
  sessionKey=[...crypto.getRandomValues(new Uint8Array(16))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
  const url=new URL(location.href);
  url.hash='p='+sessionKey;
  recipientReady=false;
  popup=window.open(url.href,'desk-'+sessionKey,'popup,width=1060,height=630');
  if (!popup) problem('请允许本页打开投影窗口。');
};
window.addEventListener('message',event=>{
  const data=event.data;
  if (!data || typeof data!=='object') return;
  if (projecting && event.source===window.opener && data.token===publicKey && data.type==='scene') applyPublic(data);
  if (!projecting && event.source===popup && data.token===sessionKey && data.type==='ready') {
    recipientReady=true;get('project').textContent='查看投影';publishView(true);
  }
});

function copyFrame(element) {
  const picture=document.createElement('canvas');
  picture.width=960;picture.height=540;
  picture.getContext('2d').drawImage(element,0,0,960,540);
  return picture;
}
const stagePhoto = element => copyFrame(element).toDataURL('image/png');

function landmarkError() {
  if (!LAB.calibration) return '';
  const points={spine:targetPoint(0,0),tip:targetPoint(1,.5),back:targetPoint(1,-.5),table:[.75,.80,.58]};
  let maxError=0,count=0;
  for (const view of LAB.calibration.views) {
    const pose={...anchor,yaw:view.yaw};
    for (const [key,point] of Object.entries(points)) {
      const ref=view.points[key];
      if(!ref)continue;
      const actual=liveScene?renderer.project(point,pose):projectStill(point,pose);
      maxError=Math.max(maxError,Math.hypot((actual[0]-ref[0])*960,(actual[1]-ref[1])*540));
      count++;
    }
  }
  const precision=maxError<.01?'小于 0.01':'为 '+maxError.toFixed(2);
  return count ? ' 四个定位点与 Blender 坐标最大差'+precision+' px（960 × 540）。' : '';
}
function presentPair(original) {
  if (!seamPair) return;
  get('before').src=original ? LAB.reference : seamPair.before;
  get('after').src=original ? LAB.referenceFirst : seamPair.after;
  get('seam').setAttribute('aria-pressed',String(!original));
  get('original').setAttribute('aria-pressed',String(original));
  get('pair-label').textContent=original
    ? '左：原课件的遵义会场静帧。右：原课件同名短片的解码首帧，两者统一显示画幅。本轮翻页实验另用了同一套桌景和机位。'
    : route==='B' ? '左：静止纸页。右：同一机位的实时翻页。拖动分界线看动作。'
    : (seamPair.from!==undefined ? '上次从 '+seamPair.from.toFixed(0)+'° 进入。左：交接前场景。右：当次解码首帧。' : '左：实验入片机位。右：交付短片实际解码首帧。')+landmarkError();
  get('divider').value='50';
  get('wipe').style.setProperty('--split','50%');
}
get('check').onclick=async()=>{
  if (projecting || !loaded) return;
  if (state.phase!=='browse' && !state.paused) togglePlay();
  const request=++comparisonEpoch;
  get('check').disabled=true;
  let decoder;
  try {
    let before,after,from;
    if (usesFilm && actualCut) {
      before=actualCut.before.toDataURL('image/png');
      after=actualCut.after.toDataURL('image/png');
      from=actualCut.from;
    } else if (liveScene) {
      renderer.draw(anchor,0,matchAmount(anchor),false);
      before=stagePhoto(space);
    } else before=stagePhoto(strips[8]);
    if (usesFilm && !after) {
      decoder=document.createElement('video');
      decoder.muted=true;decoder.playsInline=true;decoder.preload='auto';decoder.src=LAB.clip;
      await positionFilm(decoder,0);
      after=stagePhoto(decoder);
    } else if (!usesFilm) {
      renderer.draw(anchor,.29,0,false);
      after=stagePhoto(space);
    }
    if (request!==comparisonEpoch) return;
    seamPair={before,after,from};
    presentPair(false);
    get('comparison').showModal();
  } catch {problem('此设备未能读取对照帧。');}
  finally {
    if (decoder) {decoder.removeAttribute('src');decoder.load();}
    refresh();get('check').disabled=false;
  }
};
get('original').onclick=()=>presentPair(true);
get('seam').onclick=()=>presentPair(false);
get('divider').oninput=event=>get('wipe').style.setProperty('--split',event.target.value+'%');

async function boot() {
  get('play').disabled=true;
  try {
    if (usesFilm) {film.src=LAB.clip;await positionFilm(film,0);state.duration=film.duration;}
    if (liveScene) {
      space.hidden=false;resizeScene();
      renderer=await createDeskRenderer(space, LAB.scene, LAB.textures, {anchorImage:LAB.anchorImage,tailImage:LAB.tailImage});
    } else {
      strips=await Promise.all(LAB.views.map(imageReady));
      plate.width=strips[8].naturalWidth;plate.height=strips[8].naturalHeight;plate.hidden=false;
    }
    loaded=true;
    for (const id of ['play','check','project']) get(id).disabled=false;
    if(route==='B'){get('check').textContent='动作检查';get('compare-title').textContent='实时动作对照';get('seam').textContent='翻页前后';}
    get('notice').hidden=true;
    refresh();
    new ResizeObserver(resizeScene).observe(stage);
    animationFrame=requestAnimationFrame(tick);
    if(projecting && window.opener) window.opener.postMessage({type:'ready',token:publicKey},'*');
  } catch(error) {problem('会场未能打开：'+String(error.message||error));}
}
window.addEventListener('pagehide',()=>{
  epoch++;comparisonEpoch++;cancelAnimationFrame(animationFrame);film.pause();
  if(renderer)renderer.dispose();
  if(popup && !popup.closed)popup.close();
});
boot();
