type LessonView = {kind:'map'} | {kind:'review'; conclusionPage:boolean}
  | {kind:'scene'; position:number; variant:LessonMode};
type VideoState = {mode:'static'|'paused'|'playing'; time:number};
type CameraPosition = [number,number,number];
type LessonSnapshot = {
  view:LessonView;
  selected:number;
  revealed:string[];
  lastViewed:[number,number][];
  reviewSteps:number[];
  reviewAnswer:boolean;
  reviewBack:boolean;
  camera:CameraPosition;
  material?:string;
  video?:VideoState;
};
type ProjectionMessage = {type:'ready'} | {type:'snapshot'; state:LessonSnapshot}
  | {type:'action'; id:string} | {type:'video'; state:VideoState}
  | {type:'camera'; position:CameraPosition; animate:boolean};

const projectionToken = /^#projection=([a-f0-9]{32})$/.exec(location.hash)?.[1];
const projectionMode = Boolean(projectionToken);
const teacherPanel = document.querySelector<HTMLElement>('#presenter')!;
let projectionWindow: Window | null = null;
let sessionToken = '';
let projectionReady = false;
let presenterTimer: number | undefined;
let currentView: LessonView = {kind:'map'};
let reviewBack = false;
let activeMaterial: string | undefined;
let cameraPosition: CameraPosition = [1,0,0];
let applyCamera: (position:CameraPosition,animate:boolean)=>void;
let currentVideo: {set:(state:VideoState)=>void; read:()=>VideoState} | undefined;

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

function sendCamera(position:CameraPosition,animate:boolean) {
  sendProjection({type:'camera',position,animate});
}

function closeMaterial() {
  if (activeMaterial) sendAction('close-material');
  activeMaterial = undefined;
  dialog.close();
}

function displayView(view:LessonView) {
  currentView = view;
  if (view.kind === 'review') reviewBack = view.conclusionPage;
  if (!teacherPanel.hidden) updatePresenterNotes();
}

function updatePresenterNotes() {
  let heading = '地图导入';
  let minutes = '3 分钟';
  let notes = '依次点亮四站。按课堂节奏介绍这段行程。';
  let question = lessonQuestion;
  if (currentView.kind === 'scene') {
    const {page} = chapterPages[currentView.position];
    heading = page.title;
    minutes = page.minutes+' 分钟';
    notes = page.notes;
    question = page.question ?? '';
    if (currentView.variant === 'trial') {
      const last = currentView.position === chapterPages.length-1;
      const first = currentView.position === chapterStarts[events.length-1];
      minutes = first || last ? '45 秒' : '90 秒';
    }
  } else if (currentView.kind === 'review') {
    heading = currentView.conclusionPage ? '全课结论' : '课堂回顾';
    minutes = '2 分钟';
    notes = currentView.conclusionPage ? '可请学员引用一份材料，再揭示全课结论。' : '按需要点亮四站要点，可随时回看对应场景。';
    question = currentView.conclusionPage ? reviewQuestion : '这四站分别带来了哪些变化？';
  }
  const area = teacherPanel.querySelector('.presenter-notes')!;
  area.replaceChildren(element('h2','',heading),element('p','presenter-time',minutes),element('p','',notes));
  if (question) area.append(element('h3','','可选提问'),element('p','presenter-question',question));
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
    teacherPanel.replaceChildren(heading,
      element('p','presenter-setup','Win + P 选择「扩展」，将投影窗口拖到大屏后按 F11。'),
      element('section','presenter-notes'),actions);
    teacherPanel.hidden = false;
    document.body.classList.add('presenter-mode');
    updatePresenterNotes();
    presenterTimer = window.setInterval(updateProjectionStatus,1000);
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
    material:dialog.open ? activeMaterial : undefined, video:currentVideo?.read(),
  };
}

function openTrial() {
  revealed.delete('trial-result');
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
  if (state.view.kind === 'scene') {
    const back = state.reviewBack;
    openScene(state.view.position,state.view.variant,state.view.variant === 'revisit' ? ()=>openReview(back) : undefined);
  } else if (state.view.kind === 'review') {
    openReview(state.view.conclusionPage);
  } else {
    renderMap();
    applyCamera(state.camera,false);
  }
  if (state.video) currentVideo?.set(state.video);
  const materials: Record<string,()=>void> = {
    comparison:()=>showZunyiMaterials(),
    'material-before':()=>showZunyiMaterials(0),
    'material-during':()=>showZunyiMaterials(1),
    troops:showTroops, directions:showDirections, crossing:showCrossing,
    military:()=>showIssue('military'), organization:()=>showIssue('organization'),
  };
  if (state.material) materials[state.material]?.();
  stopMotion();
}

function applyAction(id:string) {
  if (id === 'close-material') { closeMaterial(); return; }
  if (id === 'trial') { openTrial(); return; }
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
    else if (message.type === 'video') currentVideo?.set(message.state);
    else if (message.type === 'camera' && currentView.kind === 'map') applyCamera(message.position,message.animate);
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
}
renderMap();
