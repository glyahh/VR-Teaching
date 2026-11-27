type EntryEdge = 'left' | 'right' | 'bottom' | 'top';

type EntryNarrationRun = { letters: HTMLSpanElement[]; count: number; start?: number };
type EntryNarration = { line: HTMLElement; observer: MutationObserver; run?: EntryNarrationRun };

let currentPageEntry: {
  settle: () => void;
  dispose: () => void;
  watchNarration: (line: HTMLElement) => (() => void) | undefined;
} | undefined;

function settlePageEntry() {
  currentPageEntry?.settle();
}

function disposePageEntry() {
  currentPageEntry?.dispose();
  currentPageEntry = undefined;
}

function watchPageEntryNarration(line: HTMLElement | null) {
  if (line) return currentPageEntry?.watchNarration(line);
}

function startPageEntry(root: HTMLElement, edges: readonly (readonly [HTMLElement, EntryEdge])[], picture?: HTMLImageElement,
  { after, onLayoutReady }: { after?: Promise<void>; onLayoutReady?: () => void } = {}) {
  disposePageEntry();
  const life = new AbortController();
  const entrance = new AbortController();
  const shown = new WeakMap<HTMLElement, string>();
  const chrome: Animation[] = [];
  const phases = { picture: 'picture', layout: 'layout', narration: 'narration', ready: 'ready' };
  let narration: EntryNarration | undefined;
  let pendingFrame = 0;
  let awaitingScene = !!after;
  let layoutReady = false;

  for (const [node, side] of edges) node.dataset.entryEdge = side;

  function finishNarration() {
    if (!narration) return;
    for (const letter of narration.run?.letters ?? []) letter.dataset.typed = 'true';
    narration.run = undefined;
    shown.set(narration.line, narration.line.textContent ?? '');
  }

  function unwatchNarration() {
    narration?.observer.disconnect();
    finishNarration();
    narration = undefined;
  }

  function settle() {
    if (awaitingScene && !reducedMotion.matches) return;
    stop();
    finishNarration();
    root.dataset.entryPhase = phases.ready;
    announceLayout();
  }

  function stop() {
    entrance.abort();
    for (const move of chrome) move.cancel();
    chrome.length = 0;
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = 0;
  }

  function announceLayout() {
    if (layoutReady) return;
    layoutReady = true;
    onLayoutReady?.();
  }

  currentPageEntry = {
    settle,
    watchNarration,
    dispose() {
      life.abort();
      unwatchNarration();
      stop();
    },
  };
  const { signal } = life;
  function revealForInput() {
    if (root.dataset.entryPhase !== phases.ready) settle();
  }
  root.addEventListener('pointerdown', revealForInput, { capture: true, signal });
  root.addEventListener('keydown', revealForInput, { capture: true, signal });
  root.addEventListener('focusin', revealForInput, { capture: true, signal });
  reducedMotion.addEventListener('change', event => {
    if (event.matches) settle();
  }, { signal });

  if (reducedMotion.matches) {
    settle();
  } else {
    root.dataset.entryPhase = phases.picture;
    void revealLayout();
  }

  function watchNarration(line: HTMLElement) {
    if (!root.contains(line)) return;
    unwatchNarration();
    const observer = new MutationObserver(() => prepareNarration(watch));
    const watch: EntryNarration = { line, observer };
    narration = watch;
    observer.observe(line, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    prepareNarration(watch);
    return () => {
      if (narration === watch) unwatchNarration();
    };
  }

  function prepareNarration(watch: EntryNarration) {
    const { line, observer } = watch;
    if (narration !== watch || !line.isConnected || reducedMotion.matches) return;
    const text = line.textContent ?? '';
    if (shown.get(line) === text || line.hidden || !line.getClientRects().length) return;
    const characters = Array.from(text);
    if (!text.trim() || characters.length > 96 ||
      Array.from(line.children).some(child => !child.hasAttribute('data-narration-line'))) {
      watch.run = undefined;
      return;
    }
    const letters = characters.map(character => {
      const span = document.createElement('span');
      span.dataset.typed = 'false';
      span.textContent = character;
      return span;
    });
    const textLine = document.createElement('span');
    textLine.dataset.narrationLine = '';
    textLine.append(...letters);
    shown.set(line, text);
    line.replaceChildren(textLine);
    observer.takeRecords();
    watch.run = { letters, count: 0 };
    requestWriting();
  }

  function requestWriting() {
    const phase = root.dataset.entryPhase;
    if (phase !== phases.narration && phase !== phases.ready) return;
    if (narration?.run || phase === phases.narration) {
      if (!pendingFrame) pendingFrame = requestAnimationFrame(write);
    }
  }

  function write(now: number) {
    pendingFrame = 0;
    const run = narration?.run;
    if (narration && run) {
      const { line } = narration;
      if (!root.contains(line) || !line.contains(run.letters[0])) narration.run = undefined;
      else {
        run.start ??= now;
        const step = Math.min(26, 880 / run.letters.length);
        const count = Math.min(run.letters.length, 1 + Math.floor((now - run.start) / step));
        while (run.count < count) run.letters[run.count++].dataset.typed = 'true';
        if (run.count === run.letters.length) narration.run = undefined;
      }
    }
    if (!narration?.run) root.dataset.entryPhase = phases.ready;
    else requestWriting();
  }

  async function revealLayout() {
    const { signal: entering } = entrance;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (entering.aborted || !root.isConnected) return;

    const handoffs = root.getAnimations({ subtree: true }).filter(move => {
      const target = (move.effect as KeyframeEffect | null)?.target;
      return target && (target === picture || !!target.closest('.journey-layer, .outgoing-image'));
    });
    const decode = picture && (!picture.complete || !picture.naturalWidth)
      ? picture.decode().catch(() => {})
      : undefined;
    const lead = new Promise<void>(resolve => {
      const timer = window.setTimeout(finish, decode ? 280 : 128);
      function finish() {
        clearTimeout(timer);
        entering.removeEventListener('abort', finish);
        resolve();
      }
      entering.addEventListener('abort', finish, { once: true });
      if (decode) void decode.then(() => {
        if (!entering.aborted) requestAnimationFrame(finish);
      });
    });
    await Promise.allSettled([lead, after, ...handoffs.map(move => move.finished)]);
    awaitingScene = false;
    if (entering.aborted || !root.isConnected) return;

    if (narration) prepareNarration(narration);
    root.dataset.entryPhase = phases.layout;
    const offset: Record<EntryEdge, string> = { left: '-16px 0', right: '16px 0', bottom: '0 12px', top: '0 -9px' };
    for (const [node, side] of edges) {
      chrome.push(node.animate([{ opacity: 0, translate: offset[side] }, { opacity: 1, translate: 'none' }],
        { duration: 170, easing: motionEasing }));
    }
    await Promise.allSettled(chrome.map(move => move.finished));
    chrome.length = 0;
    if (entering.aborted || !root.isConnected) return;

    root.dataset.entryPhase = phases.narration;
    announceLayout();
    requestWriting();
  }
}
