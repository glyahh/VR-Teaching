type LessonView = {kind:'map'} | {kind:'opening'} | {kind:'review'; conclusionPage:boolean}
  | {kind:'scene'; position:number; variant:LessonMode};
let currentView: LessonView = {kind:'map'};
let activeSceneCue: string | undefined;
let currentVideo: ReturnType<typeof attachVideo> | undefined;
let routeOffset = 0;
let onStageDismiss: (()=>void) | undefined;
let releaseLessonMap: (() => void) | undefined;
let captureLessonMap: (() => HTMLCanvasElement | undefined) | undefined;
let releasePageSound: (() => void) | undefined;
let pageResize: ResizeObserver | undefined;
let reviewConclusion = false;
const lessonProgressKey = 'long-march-lesson';

function releaseCurrentPage({keepDeskPrewarm = false} = {}) {
  releaseSceneLesson();
  disposePageEntry();
  releaseLessonMap?.();
  releaseLessonMap = undefined;
  captureLessonMap = undefined;
  releasePageSound?.();
  releasePageSound = undefined;
  releaseExplorationPage();
  releaseDesk();
  if (!keepDeskPrewarm) releaseDeskPrewarm();
  releaseRecap();
  releaseOpeningOverlay();
  openingKeyAction = undefined;
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
  saveLessonProgress();
}

function saveLessonProgress() {
  if (location.hash === '#desk') return;
  try {
    sessionStorage.setItem(lessonProgressKey, JSON.stringify({
      version: 1, view: currentView, selectedChapter, reviewConclusion, reviewAnswer, recapFocusIndex,
      lastViewed: [...lastViewed], revealed: [...revealed], seen: [...lessonItemsSeen],
      practices: [...completedPractices], harnessTrace: courseHarness.getTrace(), explorations: [...visitedExplorations],
      halls: retainedHallClues, reviewSteps: [...reviewSteps],
    }));
  } catch {}
}

function recordLessonProgress<T>(state: Set<T>, value: T) {
  if (state.has(value)) return;
  state.add(value);
  saveLessonProgress();
}

function restoreLessonProgress() {
  const record = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);
  const list = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
  const string = (value: unknown): value is string => typeof value === 'string';
  const index = (value: unknown, upper: number): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < upper;
  const practiceId = (value: unknown): value is PracticeId => string(value) && Object.hasOwn(practices, value);
  const explorationId = (value: unknown): value is ExplorationId => value === 'yudu-river' || value === 'zunyi-hall';

  let data: unknown;
  try {
    const saved = sessionStorage.getItem(lessonProgressKey);
    if (saved) data = JSON.parse(saved);
  } catch {}
  if (!record(data) || data.version !== 1 || !record(data.view)) { renderMap(); return; }

  const view = data.view;
  const scene = view.kind === 'scene' && index(view.position, chapterPages.length);
  const valid = scene || view.kind === 'map' || view.kind === 'opening' || view.kind === 'review';
  if (!valid) { renderMap(); return; }

  if (index(data.selectedChapter, events.length)) selectedChapter = data.selectedChapter;
  if (index(data.recapFocusIndex, events.length)) recapFocusIndex = data.recapFocusIndex;
  reviewConclusion = data.reviewConclusion === true;
  reviewAnswer = data.reviewAnswer === true;
  for (const [chapter, position] of list(data.lastViewed).map(list)) {
    if (index(chapter, events.length) && index(position, chapterPages.length) && chapterPages[position].chapter === chapter) {
      lastViewed.set(chapter, position);
    }
  }
  for (const key of list(data.revealed).filter(string)) revealed.add(key);
  for (const key of list(data.seen).filter(string)) lessonItemsSeen.add(key);
  for (const id of list(data.practices).filter(practiceId)) completedPractices.add(id);
  courseHarness.restoreTrace(data.harnessTrace);
  for (const id of list(data.explorations).filter(explorationId)) visitedExplorations.add(id);
  for (const i of list(data.reviewSteps)) if (index(i, events.length)) reviewSteps.add(i);
  for (const item of list(data.halls)) {
    if (!record(item) || (item.kind !== 'route' && item.kind !== 'record') || !string(item.title)) continue;
    const lines = list(item.lines).filter(string);
    if (lines.length && !retainedHallClues.some(clue => clue.kind === item.kind)) {
      retainedHallClues.push({kind: item.kind, title: item.title, lines});
    }
  }

  if (view.kind === 'opening') renderOpening(false);
  else if (view.kind === 'review') openReview(view.conclusionPage === true);
  else if (view.kind === 'scene' && index(view.position, chapterPages.length)) {
    if (view.variant === 'revisit') openScene(view.position,'revisit',() => openReview(reviewConclusion));
    else openScene(view.position);
  } else renderMap();
}

if (location.hash === '#desk') openDeskPage();
else restoreLessonProgress();
