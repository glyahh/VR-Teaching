export function createExplorationOverlay({ stage, canvas, docks, header, reduced, projection = false }) {
  const reading = stage.querySelector('#reading');
  const title = reading.querySelector('#reading-title');
  const close = reading.querySelector('#close');
  const finding = reading.querySelector('#finding');
  const detail = reading.querySelector('#detail');
  const comparison = reading.querySelector('#comparison');
  const recall = reading.querySelector('#river-recall');
  const animations = new WeakMap();
  let closing = null;
  let opener = null;

  function positionReading() {
    const dock = docks.find(node => !node.hidden);
    if (!dock) return;
    const bounds = stage.getBoundingClientRect();
    stage.style.setProperty('--reading-bottom', (bounds.bottom - dock.getBoundingClientRect().top + 12) + 'px');
    if (header) stage.style.setProperty('--reading-top', (header.getBoundingClientRect().bottom - bounds.top + 12) + 'px');
  }

  const dockSize = new ResizeObserver(positionReading);
  for (const dock of docks) dockSize.observe(dock);
  if (header) dockSize.observe(header);

  function animate(node, frames, duration) {
    animations.get(node)?.cancel();
    if (reduced.matches) return null;
    const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.18,.72,.21,1)' });
    animations.set(node, animation);
    const clear = () => { if (animations.get(node) === animation) animations.delete(node); };
    animation.finished.then(clear, clear);
    return animation;
  }

  function currentPose() {
    const { opacity, transform } = getComputedStyle(reading);
    return { opacity, transform };
  }

  function drawerPose() {
    const rect = reading.getBoundingClientRect();
    const trigger = opener?.getBoundingClientRect();
    const bounded = (offset, limit) => Math.max(-limit, Math.min(limit, offset));
    const x = trigger ? bounded(trigger.left + trigger.width / 2 - rect.left - rect.width / 2, 34) : 0;
    const y = trigger ? bounded(trigger.top + trigger.height / 2 - rect.top - rect.height / 2, 42) : 18;
    return { opacity: 0, transform: 'translate(' + x + 'px,' + y + 'px) scale(.965)' };
  }

  function read(item, explanation, background, context) {
    const from = reading.hidden ? null : currentPose();
    if (reading.hidden || reading.inert) opener = document.activeElement;
    closing = null;
    title.textContent = item.title;
    finding.textContent = explanation;
    detail.textContent = background;
    detail.hidden = !background;
    comparison.textContent = context;
    comparison.hidden = !context;
    recall.hidden = true;
    reading.scrollTop = 0;
    reading.hidden = reading.inert = false;
    positionReading();
    animate(reading, [from ?? drawerPose(), { opacity: 1, transform: 'none' }], 285);
    if (!projection) close.focus({ preventScroll: true });
  }

  function closeReading({ immediate = false, restoreFocus = true } = {}) {
    if (reading.hidden || (reading.inert && !immediate)) return;
    if (restoreFocus && !projection && !reading.inert) {
      const target = opener?.isConnected && opener.getClientRects().length ? opener : canvas;
      target.focus({ preventScroll: true });
    }
    reading.inert = true;
    const finish = () => {
      reading.hidden = true;
      reading.inert = false;
      closing = opener = null;
    };
    if (immediate || reduced.matches) {
      animations.get(reading)?.cancel();
      finish();
      return;
    }
    const run = animate(reading, [currentPose(), drawerPose()], 185);
    closing = run;
    run.finished.then(() => { if (closing === run) finish(); }, () => {});
  }

  const finishReducedMotion = () => {
    if (reduced.matches) closing?.finish();
  };
  reduced.addEventListener('change', finishReducedMotion);

  return {
    reading, animate, read, closeReading, positionReading,
    dispose() {
      dockSize.disconnect();
      reduced.removeEventListener('change', finishReducedMotion);
      animations.get(reading)?.cancel();
    },
  };
}
