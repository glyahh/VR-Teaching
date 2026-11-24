let mapCardOffset: Point = [0,0];
let releaseMapCard: (() => void) | undefined;
let resetMapCard: (() => void) | undefined;

function mountMapCard(map: HTMLElement, card: HTMLElement, footer: HTMLElement) {
  const life = new AbortController();
  const { signal } = life;
  const margin = 12;
  let bounds = { left: 0, right: 0, top: 0, bottom: 0 };
  let frame = 0;
  let drag: { id: number; start: Point; origin: Point; recent: { at: number; offset: Point }[] } | undefined;
  card.dataset.movable = '';

  function place(x: number, y: number) {
    mapCardOffset = [
      Math.max(bounds.left, Math.min(bounds.right,x)),
      Math.max(bounds.top, Math.min(bounds.bottom,y)),
    ];
    card.style.setProperty('--card-x', mapCardOffset[0] + 'px');
    card.style.setProperty('--card-y', mapCardOffset[1] + 'px');
  }

  function measure() {
    const left = card.offsetLeft;
    const center = parseFloat(getComputedStyle(card).getPropertyValue('--card-center'));
    const top = card.offsetTop + card.offsetHeight * center / 100;
    bounds = {
      left: margin - left,
      right: Math.max(margin, map.clientWidth - card.offsetWidth - margin) - left,
      top: margin - top,
      bottom: Math.max(margin, footer.offsetTop - card.offsetHeight - margin) - top,
    };
    place(...mapCardOffset);
  }

  function glide(vx: number, vy: number) {
    let last = performance.now();
    const speed = Math.hypot(vx, vy);
    if (speed < .08 || reducedMotion.matches) return;
    const limit = Math.min(1, 2 / speed);
    vx *= limit;
    vy *= limit;
    function tick(now: number) {
      frame = 0;
      if (reducedMotion.matches || signal.aborted) return;
      const friction = Math.exp(-Math.min(40, now - last) / 155);
      const x = mapCardOffset[0] + vx * 155 * (1 - friction);
      const y = mapCardOffset[1] + vy * 155 * (1 - friction);
      place(x,y);
      vx = x === mapCardOffset[0] ? vx * friction : 0;
      vy = y === mapCardOffset[1] ? vy * friction : 0;
      last = now;
      if (Math.hypot(vx,vy) > .035) frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }

  card.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    cancelAnimationFrame(frame);
    if (event.target instanceof Element && event.target.closest('button,a,input,select,label')) return;
    measure();
    drag = { id: event.pointerId, start: [event.clientX,event.clientY], origin: mapCardOffset,
      recent: [{ at: performance.now(), offset: mapCardOffset }] };
    card.setPointerCapture(event.pointerId);
    event.preventDefault();
  }, { signal });
  card.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const x = event.clientX - drag.start[0], y = event.clientY - drag.start[1];
    if (!card.hasAttribute('data-dragging') && Math.hypot(x,y) < 4) return;
    card.dataset.dragging = '';
    place(drag.origin[0]+x,drag.origin[1]+y);
    const at = performance.now();
    drag.recent = drag.recent.filter(sample => at - sample.at < 105);
    drag.recent.push({ at, offset: mapCardOffset });
  }, { signal });

  function end(event: PointerEvent) {
    if (!drag || drag.id !== event.pointerId) return;
    const first = drag.recent[0], last = drag.recent.at(-1);
    drag = undefined;
    delete card.dataset.dragging;
    if (event.type !== 'pointerup' || !last || last === first || performance.now() - last.at > 85) return;
    const time = Math.max(16,last.at - first.at);
    glide((last.offset[0]-first.offset[0])/time,(last.offset[1]-first.offset[1])/time);
  }
  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    drag = undefined;
    delete card.dataset.dragging;
    measure();
    place(0,0);
  }
  resetMapCard = reset;
  card.addEventListener('dblclick', event => {
    if (event.target instanceof Element && event.target.closest('button,a,input,select,label')) return;
    reset();
  }, { signal });
  card.addEventListener('pointerup', end, { signal });
  card.addEventListener('pointercancel', end, { signal });
  card.addEventListener('lostpointercapture', end, { signal });
  card.addEventListener('dragstart', event => event.preventDefault(), { signal });
  const resize = new ResizeObserver(measure);
  for (const node of [map,card,footer]) resize.observe(node);
  measure();
  return () => {
    if (resetMapCard === reset) resetMapCard = undefined;
    life.abort();
    resize.disconnect();
    cancelAnimationFrame(frame);
  };
}
