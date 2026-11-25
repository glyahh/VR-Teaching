type LessonView = {kind:'map'} | {kind:'opening'} | {kind:'review'; conclusionPage:boolean}
  | {kind:'scene'; position:number; variant:LessonMode};
type VideoState = {mode:'static'|'paused'|'playing'; time:number; at?:number};

let currentView: LessonView = {kind:'map'};
let activeSceneCue: string | undefined;
let currentVideo: ReturnType<typeof attachVideo> | undefined;
let scrubValue = 50;
let routeOffset = 0;
let onStageDismiss: (()=>void) | undefined;

function lessonControl(id:string,label:string,act:()=>void,className = '',icon?:IconName,iconAfter = false) {
  const button = control(label,act,className,icon,iconAfter);
  button.dataset.lessonAction = id;
  return button;
}

function closeMaterial() {
  dialog.close();
}

function displayView(view:LessonView) {
  if (view.kind !== 'map') {
    releaseMapCard?.();
    releaseMapCard = undefined;
  }
  currentView = view;
  if (view.kind==='opening') resetDeskHistory();
}

if (location.hash==='#desk') openDeskPage();
else renderMap();
