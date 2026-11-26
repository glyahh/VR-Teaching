type SceneCue = {
  text?: string;
  enter?: (animate: boolean) => void;
  leave?: () => void;
};

const lessonItemsSeen = new Set<string>();
let currentSceneLesson: ReturnType<typeof mountSceneLesson> | undefined;

function releaseSceneLesson() {
  currentSceneLesson?.dispose();
  currentSceneLesson = undefined;
}

function mountSceneLesson(scene: HTMLElement, host: HTMLElement, page: LessonPage) {
  const life = new AbortController();
  const { signal } = life;
  const paragraphs = page.narration;
  const renderer = page.activity === 'materials' ? undefined : mountNarration(host, paragraphs.length, signal);
  const cues = new Map<string, SceneCue>();
  const steps: readonly StepItem[] = page.activity === 'military' || page.activity === 'organization' ||
    page.activity === 'result' ? page.steps : [];
  let narration: NarrationView = { kind: 'main', progress: { kind: 'waiting' } };
  let openItem: string | null = null;
  let drawItems: (() => void) | undefined;
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

  function speak(index: number, previousFinishedAt = 0) {
    setNarration({ kind: 'main', progress: { kind: 'typing', index, startedAt: sceneNow(), previousFinishedAt } });
  }

  function start() {
    if (renderer && narration.kind === 'main' && narration.progress.kind === 'waiting') speak(0);
  }

  function advance() {
    if (!renderer) return;
    const now = sceneNow();
    const progress = narration.kind === 'point' ? narration.resume : narration.progress;
    if (progress.kind === 'waiting') {
      speak(0);
    } else if (narration.kind === 'main' && renderer.isWriting()) {
      setNarration({ kind: 'main', progress: { kind: 'complete', index: progress.index, finishedAt: now } });
    } else if (narration.kind === 'point' && progress.kind === 'typing') {
      // 主讲句尚未打完即被圆点打断：点空白先补完原句而不跳过
      setNarration({ kind: 'main', progress: { kind: 'complete', index: progress.index, finishedAt: now } });
    } else if (progress.index + 1 < paragraphs.length) {
      const finished = narration.kind === 'point' ? narration.interruptedAt
        : progress.kind === 'complete' ? progress.finishedAt : now;
      speak(progress.index + 1, finished);
    } else if (narration.kind === 'point') {
      setNarration({ kind: 'main', progress: { kind: 'complete', index: progress.index, finishedAt: now } });
    }
  }

  function explain(id: string) {
    if (!cues.has(id)) return;
    soundscape.playSfx('point');
    const now = sceneNow();
    const resume = narration.kind === 'point'
      ? narration.resume
      : narration.progress.kind === 'typing' && !renderer?.isWriting()
        ? { kind: 'complete' as const, index: narration.progress.index, finishedAt: now }
        : narration.progress;
    const interruptedAt = narration.kind === 'point' ? narration.interruptedAt : now;
    setNarration({ kind: 'point', id, startedAt: now, interruptedAt, resume });
  }

  function dismissPoint() {
    if (narration.kind !== 'point') return false;
    const { resume, interruptedAt } = narration;
    const progress = resume.kind === 'typing'
      ? { ...resume, startedAt: resume.startedAt + (sceneNow() - interruptedAt) } : resume;
    setNarration({ kind: 'main', progress });
    return true;
  }

  function canAdvance(target: EventTarget | null) {
    return target instanceof Element && scene.contains(target) && !!target.closest('.scene-stage') &&
      !target.closest('button,input,a,select,textarea,[contenteditable],.story-panel,.houchang-map,.tabletop-deck,.folio-card') &&
      !dialog.open && !scene.matches('[data-exploration],[data-practicing=true],[data-journey]') &&
      scene.dataset.entryPhase === 'ready';
  }

  if (renderer) {
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
    document.addEventListener('keydown', event => {
      if (event.key !== ' ' || event.repeat || event.defaultPrevented ||
        event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
        scene.dataset.entryPhase !== 'ready' || dialog.open ||
        scene.matches('[data-exploration],[data-practicing=true],[data-journey]')) return;
      if (event.target instanceof Element &&
        event.target.closest('button,input,select,textarea,a,[contenteditable],.desk-live-frame,.lesson-exploration')) return;
      event.preventDefault();
      advance();
    }, { signal });
  }

  function mountItems(stage: HTMLElement, story: InlineStoryPage, show: (step?: StepItem) => void) {
    const panel = element('aside', 'story-panel inline-disclosure ' +
      (story.activity === 'organization' ? 'story-panel--left' : 'story-panel--right'));
    const list = element('ol', 'story-rail');
    list.setAttribute('aria-label', page.title);
    const rows = story.steps.map(step => {
      const row = element('li', 'story-stop');
      const detail = element('p', 'story-detail', step.detail);
      detail.id = 'detail-' + step.id;
      const button = control('', () => selectItem(step.id), 'story-step');
      button.tabIndex = 0;
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

    function selectItem(id: string) {
      openItem = openItem === id ? null : id;
      if (openItem) lessonItemsSeen.add(openItem);
      soundscape.playSfx('point');
      drawItems?.();
    }

    function fitSummary() {
      if (!summary || summary.hidden) return;
      const overflow = summary.getBoundingClientRect().bottom - panel.getBoundingClientRect().bottom;
      if (overflow > 0) panel.scrollTop += overflow + 3;
    }
    drawItems = () => {
      for (const { id, row, button, detail } of rows) {
        row.dataset.revealed = String(lessonItemsSeen.has(id));
        button.setAttribute('aria-expanded', String(openItem === id));
        detail.hidden = openItem !== id;
      }
      if (summary) {
        const count = rows.filter(row => lessonItemsSeen.has(row.id)).length;
        summary.hidden = count !== rows.length;
        stage.style.setProperty('--dawn-brightness', String(.84 + count * .09 + (summary.hidden ? 0 : .08)));
        fitSummary();
      }
      show(story.steps.find(step=>step.id===openItem));
      syncReadingState();
    };
    if (summary) {
      const resized = new ResizeObserver(fitSummary);
      resized.observe(panel);
      signal.addEventListener('abort', () => resized.disconnect(), { once: true });
    }
    drawItems();
    return selectItem;
  }

  return {
    signal, start, explain, dismissPoint, mountItems,
    addCue(id: string, cue: SceneCue) { cues.set(id, cue); },
    enter(run: (journey?: SpatialJourney) => void, spatial?: SpatialJourney) { run(spatial); },
    dispose() {
      life.abort();
      delete scene.dataset.reading;
      window.dispatchEvent(new Event('lesson-reading'));
    },
  };
}
