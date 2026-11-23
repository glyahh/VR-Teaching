type EntryEdge = 'left' | 'right' | 'bottom' | 'top';

const shortNarration = '#instruction, #river-instruction, .desk-inquiry-cue, [data-short-narration]';

let currentPageEntry: { settle: () => void; dispose: () => void } | undefined;

function settlePageEntry() {
  currentPageEntry?.settle();
}

function disposePageEntry() {
  currentPageEntry?.dispose();
  currentPageEntry = undefined;
}

function startPageEntry(root: HTMLElement, edges: readonly (readonly [HTMLElement, EntryEdge])[], picture?: HTMLImageElement,
  { after, onLayoutReady }: { after?: Promise<void>; onLayoutReady?: () => void } = {}) {
  disposePageEntry();
  const life = new AbortController();
  const entrance = new AbortController();
  const writing = new Map<HTMLElement, {
    letters: HTMLSpanElement[];
    count: number;
    start?: number;
  }>();
  const shown = new WeakMap<HTMLElement, string>();
  const chrome: Animation[] = [];
  const phases = { picture: 'picture', layout: 'layout', narration: 'narration', ready: 'ready' };
  let pendingFrame = 0;
  let awaitingScene = !!after;
  let layoutReady = false;

  for (const [node, side] of edges) node.dataset.entryEdge = side;

  function lines() {
    return root.querySelectorAll<HTMLElement>(shortNarration);
  }

  function settle() {
    if (awaitingScene && !reducedMotion.matches) return;
    stop();
    for (const run of writing.values()) {
      for (const letter of run.letters) letter.dataset.typed = 'true';
    }
    writing.clear();
    for (const line of lines()) shown.set(line, line.textContent ?? '');
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

  const observer = new MutationObserver(prepareNarration);
  currentPageEntry = {
    settle,
    dispose() {
      life.abort();
      observer.disconnect();
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
    prepareNarration();
    void revealLayout();
  }
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });

  function prepareNarration() {
    if (life.signal.aborted || !root.isConnected || reducedMotion.matches) return;
    for (const line of lines()) {
      if (line.hidden || !line.getClientRects().length) continue;
      const text = line.textContent ?? '';
      if (shown.get(line) === text) continue;
      const characters = Array.from(text);
      if (!text.trim() || characters.length > 96 ||
        Array.from(line.children).some(child => !child.hasAttribute('data-narration-line'))) {
        writing.delete(line);
        continue;
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
      writing.set(line, { letters, count: 0 });
    }
    requestWriting();
  }

  function requestWriting() {
    const phase = root.dataset.entryPhase;
    if (phase !== phases.narration && phase !== phases.ready) return;
    if (writing.size || phase === phases.narration) {
      if (!pendingFrame) pendingFrame = requestAnimationFrame(write);
    }
  }

  function write(now: number) {
    pendingFrame = 0;
    for (const [line, run] of writing) {
      if (!root.contains(line) || !line.contains(run.letters[0])) {
        writing.delete(line);
        continue;
      }
      run.start ??= now;
      const step = Math.min(26, 880 / run.letters.length);
      const count = Math.min(run.letters.length, 1 + Math.floor((now - run.start) / step));
      while (run.count < count) run.letters[run.count++].dataset.typed = 'true';
      if (run.count === run.letters.length) writing.delete(line);
    }
    if (!writing.size) root.dataset.entryPhase = phases.ready;
    else requestWriting();
  }

  async function revealLayout() {
    const { signal: entering } = entrance;
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    if (entering.aborted || !root.isConnected) return;

    const handoffs = root.getAnimations({ subtree: true }).filter(move => {
      const target = (move.effect as KeyframeEffect | null)?.target;
      return target && (target === picture || !!target.closest('.journey-layer, .outgoing-image, .desk-handoff'));
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

    prepareNarration();
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
