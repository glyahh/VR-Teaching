type SceneAddress = { position: number; variant: LessonMode };
type SceneLessonFrame = SceneAddress & {
  visit: number;
  revision: number;
  narration: NarrationView;
  items: { open: string | null; seen: readonly string[] };
  journey?: SpatialJourney;
};

type SceneCue = {
  text?: string;
  enter?: (animate: boolean) => void;
  leave?: () => void;
};

const lessonItemsSeen = new Set<string>();
const trialItemsSeen = new Set<string>();
let sceneVisit = 0;
let sceneRevision = 0;
let receivedSceneVisit = 0;
let receivedSceneRevision = 0;
let currentSceneLesson: ReturnType<typeof mountSceneLesson> | undefined;

function releaseSceneLesson() {
  currentSceneLesson?.dispose();
  currentSceneLesson = undefined;
}

function applySceneLesson(frame: SceneLessonFrame | undefined, entered = false) {
  const lesson = currentSceneLesson;
  if (!frame || !lesson || !lesson.matches(frame) ||
    !Number.isSafeInteger(frame.visit) || frame.visit < 1 ||
    !Number.isSafeInteger(frame.revision) || frame.revision <= receivedSceneRevision) return;
  if (entered) {
    if (frame.visit <= receivedSceneVisit) return;
    receivedSceneVisit = frame.visit;
    lesson.acceptVisit(frame.visit);
  }
  if (!lesson.accepts(frame.visit)) return;
  receivedSceneRevision = frame.revision;
  lesson.restore(frame,!entered);
}

function mountSceneLesson(address: SceneAddress, scene: HTMLElement, host: HTMLElement, page: LessonPage) {
  const life = new AbortController();
  const { signal } = life;
  const paragraphs = page.narration;
  const renderer = page.activity === 'materials' ? undefined : mountNarration(host, signal);
  const cues = new Map<string, SceneCue>();
  const seenItems = address.variant === 'trial' ? trialItemsSeen : lessonItemsSeen;
  const steps: readonly StepItem[] = page.activity === 'military' || page.activity === 'organization' ||
    page.activity === 'result' ? page.steps : [];
  let narration: NarrationView = { kind: 'main', progress: { kind: 'waiting' } };
  let openItem: string | null = null;
  let drawItems: (() => void) | undefined;
  let visit = projectionMode ? 0 : ++sceneVisit;
  let journey: SpatialJourney | undefined;
  let enterPage: ((journey?: SpatialJourney) => void) | undefined;
  let pointer: { id: number; x: number; y: number } | undefined;
  renderer?.show(undefined,narration);

  function display(view: NarrationView): NarrationDisplay | undefined {
    if (view.kind === 'point') {
      const text = cues.get(view.id)?.text;
      if (text) return { previous: [], text, time: { startedAt: view.startedAt, previousFinishedAt: 0 } };
      return display({ kind: 'main', progress: view.resume });
    }
    const { progress } = view;
    if (progress.kind === 'waiting') return;
    const text = paragraphs[progress.index];
    if (!text) return;
    return { previous: paragraphs.slice(Math.max(0, progress.index - 2), progress.index), text,
      time: progress.kind === 'typing' ? progress : undefined };
  }

  function syncReadingState() {
    const reading = narration.kind === 'point' || openItem !== null;
    if (reading) scene.dataset.reading = 'true';
    else delete scene.dataset.reading;
    window.dispatchEvent(new Event('lesson-reading'));
  }

  function setNarration(next: NarrationView, animate = true) {
    const previousPoint = narration.kind === 'point' ? narration.id : undefined;
    const nextPoint = next.kind === 'point' ? next.id : undefined;
    if (previousPoint && previousPoint !== nextPoint) cues.get(previousPoint)?.leave?.();
    if (nextPoint && (previousPoint !== nextPoint || next !== narration)) cues.get(nextPoint)?.enter?.(animate);
    narration = next;
    renderer?.show(display(next), next);
    syncReadingState();
  }

  function read(): SceneLessonFrame {
    return { ...address, visit, revision: ++sceneRevision, narration, journey,
      items: { open: openItem, seen: steps.filter(step => seenItems.has(step.id)).map(step => step.id) } };
  }

  function publish(entered = false) {
    if (!projectionMode) sendProjection({ type: 'scene-lesson', frame: read(), entered });
  }

  function speak(index: number, previousFinishedAt = 0) {
    setNarration({ kind: 'main', progress: { kind: 'typing', index, startedAt: sceneNow(), previousFinishedAt } });
    publish();
  }

  function start() {
    if (!projectionMode && renderer && narration.kind === 'main' && narration.progress.kind === 'waiting') speak(0);
  }

  function advance() {
    if (projectionMode || !renderer) return;
    const now = sceneNow();
    const progress = narration.kind === 'point' ? narration.resume : narration.progress;
    if (progress.kind === 'waiting') {
      speak(0);
    } else if (narration.kind === 'main' && renderer.isWriting()) {
      setNarration({ kind: 'main', progress: { kind: 'complete', index: progress.index, finishedAt: now } });
      publish();
    } else if (progress.index + 1 < paragraphs.length) {
      const finished = narration.kind === 'point' ? narration.interruptedAt
        : progress.kind === 'complete' ? progress.finishedAt : now;
      speak(progress.index + 1, finished);
    } else if (narration.kind === 'point') {
      setNarration({ kind: 'main', progress: { kind: 'complete', index: progress.index, finishedAt: now } });
      publish();
    }
  }

  function explain(id: string) {
    if (projectionMode || !cues.has(id)) return;
    const now = sceneNow();
    const resume = narration.kind === 'point' ? narration.resume : narration.progress;
    const interruptedAt = narration.kind === 'point' ? narration.interruptedAt : now;
    setNarration({ kind: 'point', id, startedAt: now, interruptedAt, resume });
    publish();
  }

  function dismissPoint() {
    if (projectionMode || narration.kind !== 'point') return false;
    const { resume, interruptedAt } = narration;
    const progress = resume.kind === 'typing'
      ? { ...resume, startedAt: resume.startedAt + (sceneNow() - interruptedAt) } : resume;
    setNarration({ kind: 'main', progress });
    publish();
    return true;
  }

  function canAdvance(target: EventTarget | null) {
    return target instanceof Element && scene.contains(target) && !!target.closest('.scene-stage') &&
      !target.closest('button,input,a,select,textarea,[contenteditable],.story-panel,.troop-hud,.curtain-handle,.tabletop-deck,.folio-card') &&
      !dialog.open && !scene.matches('[data-exploration],[data-practicing=true],[data-journey]') &&
      scene.dataset.entryPhase === 'ready';
  }

  if (!projectionMode && renderer) {
    scene.addEventListener('pointerdown', e => {
      pointer = e.isPrimary && e.button === 0 && canAdvance(e.target) ? { id: e.pointerId, x: e.clientX, y: e.clientY } : undefined;
    }, { capture: true, signal });
    scene.addEventListener('pointermove', e => {
      if (pointer?.id === e.pointerId && Math.hypot(pointer.x - e.clientX, pointer.y - e.clientY) > 7) pointer = undefined;
    }, { capture: true, signal });
    scene.addEventListener('pointerup', e => {
      if (pointer?.id !== e.pointerId) return;
      const { x, y } = pointer;
      pointer = undefined;
      if (Math.hypot(x - e.clientX, y - e.clientY) <= 7 && canAdvance(document.elementFromPoint(e.clientX, e.clientY))) advance();
    }, { capture: true, signal });
    scene.addEventListener('pointercancel', () => { pointer = undefined; }, { signal });
    scene.addEventListener('keydown', event => {
      if (event.target instanceof HTMLHeadingElement && event.key === ' ' && !event.repeat &&
        scene.dataset.entryPhase === 'ready' && !dialog.open) {
        event.preventDefault();
        advance();
      }
    }, { signal });
  }

  function mountItems(stage: HTMLElement, story: InlineStoryPage) {
    const panel = element('aside', 'story-panel inline-disclosure ' +
      (story.activity === 'organization' ? 'story-panel--left' : 'story-panel--right'));
    const list = element('ol', 'story-rail');
    list.setAttribute('aria-label', page.title);
    const rows = story.steps.map(step => {
      const row = element('li', 'story-stop');
      const detail = element('p', 'story-detail', step.detail);
      detail.id = 'detail-' + step.id;
      const button = control('', () => {
        if (projectionMode) return;
        openItem = openItem === step.id ? null : step.id;
        if (openItem) seenItems.add(openItem);
        drawItems?.();
        publish();
      }, 'story-step');
      button.tabIndex = projectionMode ? -1 : 0;
      button.setAttribute('aria-controls', detail.id);
      button.append(element('strong', '', step.title));
      row.append(button, detail);
      list.append(row);
      return { id: step.id, row, button, detail };
    });
    const summary = story.activity === 'result' ? element('p', 'assembly-conclusion', story.conclusion) : undefined;
    panel.append(list);
    if (summary) panel.append(summary);
    stage.append(panel);

    function fitSummary() {
      if (!summary || summary.hidden) return;
      const overflow = summary.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom;
      if (overflow > 0) panel.scrollTop += overflow + 3;
    }
    drawItems = () => {
      for (const { id, row, button, detail } of rows) {
        row.dataset.revealed = String(seenItems.has(id));
        button.setAttribute('aria-expanded', String(openItem === id));
        detail.hidden = openItem !== id;
      }
      if (summary) {
        const count = rows.filter(row => seenItems.has(row.id)).length;
        summary.hidden = count !== rows.length;
        stage.style.setProperty('--dawn-brightness', String(.84 + count * .09 + (summary.hidden ? 0 : .08)));
        fitSummary();
      }
      syncReadingState();
    };
    if (summary) {
      const resized = new ResizeObserver(fitSummary);
      resized.observe(panel);
      signal.addEventListener('abort', () => resized.disconnect(), { once: true });
    }
    drawItems();
  }

  return {
    signal, start, explain, dismissPoint, mountItems, read,
    addCue(id: string, cue: SceneCue) { cues.set(id, cue); },
    enter(run: (journey?: SpatialJourney) => void, spatial?: SpatialJourney, awaitJourney = false) {
      journey = spatial;
      if (projectionMode && awaitJourney) {
        scene.dataset.entryPhase = 'picture';
        enterPage = run;
      }
      else run(journey);
      if (!projectionMode) publish(true);
    },
    matches(frame: SceneAddress) { return frame.position === address.position && frame.variant === address.variant; },
    acceptVisit(value: number) { visit = value; },
    accepts(value: number) { return visit === value; },
    restore(frame: SceneLessonFrame, animate: boolean) {
      if (enterPage) {
        enterPage(frame.journey);
        enterPage = undefined;
      }
      const previousCue = narration.kind === 'point' && frame.narration.kind === 'point' &&
        narration.id === frame.narration.id && narration.startedAt === frame.narration.startedAt;
      setNarration(previousCue ? narration : frame.narration, animate);
      for (const step of steps) seenItems.delete(step.id);
      for (const id of frame.items.seen) if (steps.some(step => step.id === id)) seenItems.add(id);
      openItem = frame.items.open;
      drawItems?.();
    },
    dispose() {
      life.abort();
      delete scene.dataset.reading;
      window.dispatchEvent(new Event('lesson-reading'));
    },
  };
}
