type MainNarration =
  | { kind: 'waiting' }
  | { kind: 'typing'; index: number; startedAt: number; previousFinishedAt: number }
  | { kind: 'complete'; index: number; finishedAt: number };

type NarrationView =
  | { kind: 'main'; progress: MainNarration }
  | { kind: 'point'; id: string; startedAt: number; interruptedAt: number; resume: MainNarration };

type NarrationDisplay = {
  previous: readonly string[];
  text: string;
  time?: { startedAt: number; previousFinishedAt: number };
};

const sceneNow = () => performance.timeOrigin + performance.now();
const narrationGraphemes = new Intl.Segmenter('zh-Hans', { granularity: 'grapheme' });
const narrationFadeMs = 300;

function mountNarration(host: HTMLElement, signal: AbortSignal) {
  const box = element('p', 'slide-line');
  box.dataset.narrationEmpty = 'true';
  const viewport = element('span', 'narration-viewport');
  viewport.setAttribute('aria-hidden', 'true');
  const measure = element('span', 'narration-measure');
  const rows = [element('span', 'narration-row'), element('span', 'narration-row')];
  viewport.append(measure, ...rows);
  const announcement = element('span', 'visually-hidden');
  announcement.setAttribute('aria-live', 'polite');
  announcement.setAttribute('aria-atomic', 'true');
  box.append(viewport, announcement);
  host.replaceChildren(box);

  let display: NarrationDisplay | undefined;
  let frame = 0;
  let writing = false;
  let cached: { key: string; previous: string[][]; current: string[][] } | undefined;

  function wrap(text: string) {
    const lines: string[][] = [];
    measure.textContent = text;
    const node = measure.firstChild;
    if (!node) return lines;
    const range = document.createRange();
    let row: string[] | undefined;
    let top = -Infinity;
    for (const { index, segment } of narrationGraphemes.segment(text)) {
      range.setStart(node, index);
      range.setEnd(node, index + segment.length);
      const y = range.getBoundingClientRect().top;
      if (!row || y > top + 1) {
        top = y;
        row = [];
        lines.push(row);
      }
      row.push(segment);
    }
    measure.textContent = '';
    return lines;
  }

  function layout({ previous, text }: NarrationDisplay) {
    const font = getComputedStyle(box);
    const key = JSON.stringify([host.clientWidth, font.font, font.letterSpacing, previous, text]);
    if (cached?.key === key) return cached;
    measure.style.width = 'max-content';
    const widths = [...previous, text].map(paragraph => {
      measure.textContent = paragraph;
      return measure.getBoundingClientRect().width;
    });
    measure.textContent = '';
    measure.style.removeProperty('width');
    const widest = Math.max(...widths);
    const fontSize = parseFloat(font.fontSize);
    const preferred = Math.min(widest, Math.max(26 * fontSize, widest / 2));
    const inset = box.offsetWidth - box.clientWidth + parseFloat(font.paddingLeft) + parseFloat(font.paddingRight);
    box.style.setProperty('--narration-width', Math.ceil(preferred + inset + 1) + 'px');
    cached = { key, previous: previous.flatMap(wrap).slice(-2), current: wrap(text) };
    return cached;
  }

  function paint() {
    cancelAnimationFrame(frame);
    frame = 0;
    if (signal.aborted || !host.isConnected || !host.clientWidth) return;
    const shown: string[] = [];
    let fade = 0;
    writing = false;
    if (display) {
      const { previous, current } = layout(display);
      const clock = display.time;
      if (!clock || reducedMotion.matches) {
        shown.push(...[...previous, ...current].slice(-2).map(line => line.join('')));
      } else {
        const elapsed = sceneNow() - clock.startedAt;
        const timeline = previous.map(glyphs => ({ glyphs, finished: clock.previousFinishedAt - clock.startedAt }));
        shown.push(...previous.map(line => line.join('')));
        let start = 0;
        for (const glyphs of current) {
          const leaving = timeline.at(-2);
          if (leaving) {
            const readUntil = leaving.finished + Math.max(950, 260 + 95 * leaving.glyphs.length);
            const fadeAt = Math.max(start, readUntil);
            start = fadeAt + narrationFadeMs;
            if (elapsed < start) {
              fade = Math.max(0, (elapsed - fadeAt) / narrationFadeMs);
              writing = true;
              break;
            }
            shown.shift();
          }
          const perGlyph = Math.min(34, 850 / Math.max(1, glyphs.length));
          const count = Math.max(1, 1 + Math.floor((elapsed - start) / perGlyph));
          shown.push(glyphs.slice(0, count).join(''));
          const finished = start + (glyphs.length - 1) * perGlyph;
          if (elapsed < finished) {
            writing = true;
            break;
          }
          start = finished + perGlyph;
          timeline.push({ glyphs, finished });
        }
      }
    }
    for (const [index, row] of rows.entries()) {
      const text = shown[index] ?? '';
      if (row.textContent !== text) row.textContent = text;
      row.hidden = !text;
    }
    const spoken = writing ? '' : display?.text ?? '';
    if (announcement.textContent !== spoken) announcement.textContent = spoken;
    box.dataset.narrationRows = String(shown.length);
    box.dataset.narrationEmpty = String(!shown.length);
    box.dataset.narrationWriting = String(writing);
    box.style.setProperty('--narration-fade', String(fade));
    if (writing) frame = requestAnimationFrame(paint);
  }

  const resize = new ResizeObserver(paint);
  resize.observe(host);
  const refreshFont = () => {
    cached = undefined;
    paint();
  };
  document.fonts.addEventListener('loadingdone', refreshFont, { signal });
  reducedMotion.addEventListener('change', paint, { signal });
  signal.addEventListener('abort', () => {
    resize.disconnect();
    cancelAnimationFrame(frame);
  }, { once: true });
  return {
    show(next: NarrationDisplay | undefined, view: NarrationView) {
      display = next;
      box.dataset.narrationView = view.kind;
      const progress = view.kind === 'point' ? view.resume : view.progress;
      box.dataset.narrationCount = String(progress.kind === 'waiting' ? 0 : progress.index + 1);
      paint();
    },
    isWriting() {
      paint();
      return writing;
    },
  };
}
