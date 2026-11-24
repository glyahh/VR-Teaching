type LessonView = {kind:'map'} | {kind:'opening'} | {kind:'review'; conclusionPage:boolean}
  | {kind:'scene'; position:number; variant:LessonMode};
type VideoState = {mode:'static'|'paused'|'playing'; time:number; at?:number};
type CameraPosition = [zoom:number, x:number, y:number, azimuth:number, tilt:number];
type LessonSnapshot = {
  view:LessonView;
  selected:number;
  revealed:string[];
  lastViewed:[number,number][];
  reviewSteps:number[];
  reviewAnswer:boolean;
  reviewBack:boolean;
  camera:CameraPosition;
  comparisonOpen:boolean;
  sceneLesson?:SceneLessonFrame;
  wujiangCue?:string;
  video?:VideoState;
  desk?:DeskFrame;
  exploration?:ExplorationFrame;
  scrub?:number;
  routeOffset?:number;
  hallClue?:HallClue;
  practice?:PracticeState;
};
type ProjectionMessage = {type:'ready'} | {type:'snapshot'; state:LessonSnapshot}
  | {type:'action'; id:string} | {type:'video'; state:VideoState}
  | {type:'camera'; position:CameraPosition; animate:boolean}
  | {type:'scene-lesson'; frame:SceneLessonFrame; entered:boolean}
  | {type:'desk-visit'; address:DeskAddress}
  | {type:'desk'; frame:DeskFrame}
  | {type:'exploration'; update:ExplorationUpdate}
  | {type:'practice'; position:number; state:PracticeState}
  | {type:'scrub'; value:number}
  | {type:'route-offset'; position:number; value:number}
  | {type:'hall-clue'; clue:HallClue | undefined};

const projectionToken = /^#projection=([a-f0-9]{32})$/.exec(location.hash)?.[1];
const projectionMode = Boolean(projectionToken);
const teacherPanel = document.querySelector<HTMLElement>('#presenter')!;
let projectionWindow: Window | null = null;
let sessionToken = '';
let projectionReady = false;
let presenterTimer: number | undefined;
let currentView: LessonView = {kind:'map'};
let reviewBack = false;
let activeSceneCue: string | undefined;
let cameraPosition: CameraPosition = [1,0,0,...mapHomeAngle];
let applyCamera: (position:CameraPosition,animate:boolean)=>void;
let currentVideo: ReturnType<typeof attachVideo> | undefined;
let scrubValue = 50;
let applyScrub: ((value:number)=>void) | undefined;
let routeOffset = 0;
let applyRouteOffset: ((value:number)=>void) | undefined;
let onStageDismiss: (()=>void) | undefined;
type DeskAddress = {position:number; visit:number};
type DeskFrame = DeskAddress & {revision:number; view:DeskView};
let deskAddress:DeskAddress | undefined;
let deskVisit = 0;
let deskRevision = 0;
let receivedDeskVisit = 0;
let receivedDeskRevision = 0;

function syncControl(id:string,label:string,act:()=>void,className = '',icon?:IconName,iconAfter = false) {
  const button = control(label,()=>{
    if (!projectionMode) sendAction(id);
    act();
  },className,icon,iconAfter);
  button.dataset.lessonAction = id;
  if (projectionMode) button.tabIndex = -1;
  return button;
}

function sendProjection(message: ProjectionMessage) {
  if (projectionReady && projectionWindow && !projectionWindow.closed) {
    projectionWindow.postMessage({...message,token:sessionToken},'*');
  }
}

function sendAction(id:string) {
  sendProjection({type:'action',id});
}

function beginDeskVisit(position:number) {
  if (projectionMode) return;
  deskAddress = {position,visit:++deskVisit};
  sendProjection({type:'desk-visit',address:deskAddress});
}

function readDeskFrame(view = currentDesk?.read()):DeskFrame | undefined {
  if (!projectionMode && view && deskAddress) return {...deskAddress,revision:++deskRevision,view};
}

function publishDesk(view:DeskView) {
  const frame=readDeskFrame(view);
  if (frame) sendProjection({type:'desk',frame});
}

function acceptDeskVisit(address:DeskAddress | undefined) {
  if (!address || !currentDesk || currentView.kind!=='scene' || currentView.position!==address.position ||
    !Number.isSafeInteger(address.visit) || address.visit<=receivedDeskVisit) return;
  deskAddress={position:address.position,visit:address.visit};
  receivedDeskVisit=address.visit;
}

function applyDeskFrame(frame:DeskFrame | undefined, reconnect = false) {
  if (!frame || !currentDesk || currentView.kind!=='scene' || frame.position!==currentView.position ||
    !Number.isSafeInteger(frame.revision) || frame.revision<=receivedDeskRevision || !isDeskView(frame.view)) return;
  if (reconnect) acceptDeskVisit(frame);
  if (deskAddress?.position!==frame.position || deskAddress.visit!==frame.visit) return;
  receivedDeskRevision=frame.revision;
  currentDesk.restore(frame.view);
}

function sendCamera(position:CameraPosition,animate:boolean) {
  sendProjection({type:'camera',position,animate});
}

function sendScrub(value:number) {
  scrubValue = value;
  sendProjection({type:'scrub',value});
}

function closeMaterial() {
  if (dialog.open && dialog.classList.contains('comparison')) sendAction('close-material');
  dialog.close();
}

function displayView(view:LessonView) {
  if (view.kind !== 'map') {
    releaseMapCard?.();
    releaseMapCard = undefined;
  }
  currentView = view;
  if (view.kind==='opening' && !projectionMode) resetDeskHistory();
  if (view.kind === 'review') reviewBack = view.conclusionPage;
  if (!teacherPanel.hidden) updatePresenterNotes();
}

function updatePresenterNotes() {
  const schedule = lessonSchedule(teachingPace);
  let heading = '地图导入';
  let timing = schedule.map;
  let time: string | undefined;
  let practice: PracticeId | undefined;
  if (currentView.kind === 'scene') {
    const {page} = chapterPages[currentView.position];
    heading = page.title;
    timing = schedule.scenes[currentView.position];
    practice = page.practice;
    if (currentView.variant === 'trial') {
      const last = currentView.position === chapterPages.length-1;
      const first = currentView.position === chapterStarts[events.length-1];
      time = first ? '0:00–0:45' : last ? '2:15–3:00' : '0:45–2:15';
    } else if (currentView.variant === 'revisit') {
      time = '回看';
    }
  } else if (currentView.kind === 'review') {
    heading = currentView.conclusionPage ? '全课结论' : '课堂回顾';
    timing = schedule.review[currentView.conclusionPage ? 1 : 0];
  } else if (currentView.kind === 'opening') {
    heading = '开场导览';
  }
  const area = teacherPanel.querySelector('.presenter-notes')!;
  const {beat} = timing;
  area.replaceChildren(element('h2','',heading),element('p','presenter-time',time ?? teachingRange(timing)),
    ...beatCopy(beat,practice).map(line => element('p','',line)));
  if (beat.question) area.append(element('h3','','可选提问'),element('p','presenter-question',beat.question));
  teacherPanel.scrollTop = 0;
}

function updateProjectionStatus() {
  const status = teacherPanel.querySelector('.presenter-status');
  const reopen = teacherPanel.querySelector<HTMLButtonElement>('.presenter-reopen');
  if (!status || !reopen) return;
  const closed = !projectionWindow || projectionWindow.closed;
  if (closed) projectionReady = false;
  status.textContent = closed ? '投影窗口已关闭' : projectionReady ? '投影已连接' : '正在连接投影窗口…';
  reopen.hidden = !closed;
}

function openProjection() {
  if (projectionWindow && !projectionWindow.closed) {
    projectionWindow.focus();
    return;
  }
  const token = Array.from(crypto.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
  const url = new URL(location.href);
  url.hash = 'projection='+token;
  const child = window.open(url.href,'projection-'+token,'popup,width=1120,height=720');
  if (!child) {
    modal('无法打开投影窗口',element('p','','请在 Edge 中允许弹出窗口，再点击「开始双屏授课」。'));
    return;
  }
  projectionWindow = child;
  sessionToken = token;
  projectionReady = false;
  if (teacherPanel.hidden) {
    const heading = element('div','presenter-head');
    heading.append(element('strong','','教师视图'),element('p','presenter-status'));
    heading.lastElementChild!.setAttribute('role','status');
    const actions = element('div','presenter-actions');
    actions.append(control('重新打开投影',openProjection,'presenter-reopen'),control('结束双屏',stopProjection));
    const clock = lessonClock();
    teacherPanel.replaceChildren(heading,
      element('p','presenter-setup','Win + P 选择「扩展」，将投影窗口拖到大屏后按 F11。'),
      pacePicker('live-pace',updatePresenterNotes),clock.row,
      element('section','presenter-notes'),actions);
    teacherPanel.hidden = false;
    document.body.classList.add('presenter-mode');
    updatePresenterNotes();
    presenterTimer = window.setInterval(()=>{updateProjectionStatus();clock.update();},1000);
  }
  updateProjectionStatus();
}

function stopProjection() {
  projectionWindow?.close();
  projectionWindow = null;
  projectionReady = false;
  window.clearInterval(presenterTimer);
  teacherPanel.hidden = true;
  document.body.classList.remove('presenter-mode');
}

function snapshot(): LessonSnapshot {
  return {
    view:currentView, selected, revealed:[...revealed], lastViewed:[...lastViewed],
    reviewSteps:[...reviewSteps], reviewAnswer, reviewBack, camera:cameraPosition,
    comparisonOpen:dialog.open && dialog.classList.contains('comparison'), sceneLesson:currentSceneLesson?.read(),
    wujiangCue:activeSceneCue?.startsWith('wujiang-') ? activeSceneCue : undefined,
    video:currentVideo?.read(), desk:readDeskFrame(),
    scrub:scrubValue, routeOffset, hallClue:retainedHallClue,
    practice:currentPractice?.read(), exploration:readExplorationUpdate(),
  };
}

function openTrial() {
  trialItemsSeen.clear();
  openChapter(events.findIndex(event=>event.id==='zunyi'),'trial');
}

function applySnapshot(state:LessonSnapshot) {
  if (dialog.open) closeMaterial();
  selected = state.selected;
  revealed.clear();
  state.revealed.forEach(key=>revealed.add(key));
  lastViewed.clear();
  state.lastViewed.forEach(([index,position])=>lastViewed.set(index,position));
  reviewSteps.clear();
  state.reviewSteps.forEach(index=>reviewSteps.add(index));
  reviewAnswer = state.reviewAnswer;
  reviewBack = state.reviewBack;
  if (typeof state.scrub === 'number') scrubValue = state.scrub;
  routeOffset = typeof state.routeOffset === 'number' && Number.isFinite(state.routeOffset) ? state.routeOffset : 0;
  retainedHallClue = state.hallClue;
  if (state.view.kind === 'scene') {
    const back = state.reviewBack;
    openScene(state.view.position,state.view.variant,state.view.variant === 'revisit' ? ()=>openReview(back) : undefined,
      undefined, !!state.sceneLesson?.journey);
    if (typeof state.scrub === 'number') applyScrub?.(state.scrub);
    applySceneLesson(state.sceneLesson,true);
    if (state.wujiangCue) applyAction(state.wujiangCue);
  } else if (state.view.kind === 'opening') {
    renderOpening(false);
  } else if (state.view.kind === 'review') {
    openReview(state.view.conclusionPage);
  } else {
    renderMap();
    applyCamera(state.camera,false);
  }
  if (state.video) currentVideo?.set(state.video);
  applyDeskFrame(state.desk,true);
  currentPractice?.restore(state.practice ?? null);
  if (state.comparisonOpen) showZunyiMaterials();
  applyExplorationUpdate(state.exploration,true);
  stopMotion();
}

function applyAction(id:string) {
  if (id === 'close-material') { closeMaterial(); return; }
  if (id === 'trial') { openTrial(); return; }
  if (id === 'stage-dismiss') { onStageDismiss?.(); return; }
  const buttons = (dialog.open ? dialog : app).querySelectorAll<HTMLButtonElement>('[data-lesson-action]');
  Array.from(buttons).find(button=>button.dataset.lessonAction === id)?.click();
}

window.addEventListener('message',event=>{
  const message = event.data as (ProjectionMessage & {token:string}) | null;
  if (!message || typeof message !== 'object') return;
  // Local file windows have opaque origins. Only the paired window and its random session token are accepted.
  if (projectionMode) {
    if (!window.opener || event.source !== window.opener || message.token !== projectionToken) return;
    if (message.type === 'snapshot') applySnapshot(message.state);
    else if (message.type === 'action' && typeof message.id === 'string') applyAction(message.id);
    else if (message.type === 'scene-lesson') applySceneLesson(message.frame,message.entered);
    else if (message.type === 'video') currentVideo?.set(message.state);
    else if (message.type === 'desk-visit') acceptDeskVisit(message.address);
    else if (message.type === 'desk') applyDeskFrame(message.frame);
    else if (message.type === 'exploration') applyExplorationUpdate(message.update);
    else if (message.type === 'practice' && currentView.kind === 'scene' && message.position === currentView.position) {
      currentPractice?.restore(message.state);
    }
    else if (message.type === 'camera' && currentView.kind === 'map') applyCamera(message.position,message.animate);
    else if (message.type === 'scrub') applyScrub?.(message.value);
    else if (message.type === 'route-offset' && currentView.kind === 'scene' &&
      currentView.position === message.position && Number.isFinite(message.value)) applyRouteOffset?.(message.value);
    else if (message.type === 'hall-clue') {
      retainedHallClue = message.clue;
      currentDesk?.setClue(message.clue);
    }
  } else if (projectionWindow && event.source === projectionWindow && message.token === sessionToken && message.type === 'ready') {
    projectionReady = true;
    sendProjection({type:'snapshot',state:snapshot()});
    updateProjectionStatus();
  }
});

if (projectionMode) {
  document.body.classList.add('projection-mode');
  document.title = '从于都到遵义 · 投影';
  window.opener?.postMessage({type:'ready',token:projectionToken},'*');
} else {
  window.addEventListener('pagehide',()=>projectionWindow?.close());
  if (location.hash==='#desk') openDeskPage();
  else renderMap();
}
