type LessonView = {kind:'map'} | {kind:'opening'} | {kind:'review'; conclusionPage:boolean}
  | {kind:'scene'; position:number; variant:LessonMode};
let currentView: LessonView = {kind:'map'};
let activeSceneCue: string | undefined;
let currentVideo: ReturnType<typeof attachVideo> | undefined;
let routeOffset = 0;
let onStageDismiss: (()=>void) | undefined;
let releaseLessonMap: (() => void) | undefined;
let releasePageSound: (() => void) | undefined;
let pageResize: ResizeObserver | undefined;

function releaseCurrentPage({keepDeskPrewarm = false} = {}) {
  releaseSceneLesson();
  disposePageEntry();
  releaseLessonMap?.();
  releaseLessonMap = undefined;
  releasePageSound?.();
  releasePageSound = undefined;
  releaseExplorationPage();
  releaseDesk();
  if (!keepDeskPrewarm) releaseDeskPrewarm();
  releaseRecap();
  releaseOpeningOverlay();
  currentPractice = undefined;
  activeSceneCue = undefined;
  currentVideo?.dispose();
  currentVideo = undefined;
  onStageDismiss = undefined;
  stopMotion();
  stopCinemagraphs();
  pageResize?.disconnect();
  pageResize = undefined;
  soundscape.setVideoDuck(false);
}

function lessonControl(id:string,label:string,act:()=>void,className = '',icon?:IconName,iconAfter = false) {
  const button = control(label,act,className,icon,iconAfter);
  button.dataset.lessonAction = id;
  return button;
}

function closeMaterial() {
  dialog.close();
}

function displayView(view:LessonView) {
  currentView = view;
  if (view.kind==='opening') resetDeskHistory();
}

if (location.hash==='#desk') openDeskPage();
else renderMap();
