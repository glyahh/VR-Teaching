const wujiangApproach = route.slice(7);
const journeyLegs: Record<string, [number, number] | undefined> = {
  'liping-table/wujiang': [7, 8],
  'wujiang/zunyi': [8, 9],
};
const spatialJourneys = [
  { id: 'yudu-xiang', from: 'yudu', to: 'xiang', first: 0, last: 4 },
  { id: 'xiang-liping', from: 'xiang-aftermath', to: 'liping-street', first: 4, last: 6 },
] as const;
type SpatialJourney = { id: typeof spatialJourneys[number]['id']; startedAt: number };

function findSpatialJourney(from: string, to: string) {
  return spatialJourneys.find(leg => leg.from === from && leg.to === to)?.id;
}

function routeCanvas() {
  const svg = document.createElementNS(svgNamespace,'svg');
  svg.classList.add('map-route','journey-route');
  svg.setAttribute('viewBox','0 0 100 100');
  svg.setAttribute('preserveAspectRatio','none');
  svg.setAttribute('aria-hidden','true');
  return svg;
}

function routePath(points: readonly Point[]) {
  return 'M ' + points.map(point => point.join(' ')).join(' L ');
}

function sampleTerrainPath(path: readonly Point[]) {
  if (!path.length) return [];
  const segments = path.slice(1).flatMap(([x,y], index) => {
    const [left,top] = path[index];
    return Array.from({length: 12}, (_, step): Point => [
      left + (x - left) * step / 12, top + (y - top) * step / 12,
    ]);
  });
  return [...segments, path[path.length - 1]];
}

function playSpatialJourney(scene: HTMLElement, journey: SpatialJourney, signal: AbortSignal) {
  const leg = spatialJourneys.find(route => route.id === journey.id);
  const traceEnd = 1460, pullbackStart = 1680, overviewStart = 2500, fadeStart = 3410, end = 3670;
  if (!leg || reducedMotion.matches || sceneNow() - journey.startedAt >= end || signal.aborted) return;
  const layer = element('div','journey-layer spatial-journey');
  layer.setAttribute('aria-hidden','true');
  const before = photo(leg.from);
  before.className = 'journey-departure';
  const atlas = element('div','journey-atlas');
  const world = element('div','journey-world');
  const svg = routeCanvas();
  const full = diagramPath('','route spatial-full');
  const earlier = diagramPath('','route spatial-prior');
  const trace = diagramPath('','route past');
  for (const line of [full, earlier, trace]) line.setAttribute('vector-effect','non-scaling-stroke');
  svg.append(full, earlier, trace);

  const names = element('div','spatial-map-names');
  const labels = routeStops.flatMap(({ name, point, side }, index) => {
    if (!name) return [];
    const node = element('span','spatial-station',name);
    const pin = element('span','spatial-map-pin');
    names.append(pin,node);
    return [{ name, node, pin, point: position(point), side, close: index >= leg.first && index <= leg.last }];
  });
  const labelRank = (item: typeof labels[number]) => item.close ? 0 : item.name === '遵义' ? 1 : item.name === '于都' ? 2 : 3;
  const labelOrder = labels.map((_, index) => index).sort((a, b) => labelRank(labels[a]) - labelRank(labels[b]) || a - b);
  const chosenSlot = labels.map(() => -1);
  const points = route.map(position);
  const section = points.slice(leg.first, leg.last + 1);
  const past = sampleTerrainPath(points.slice(0, leg.first + 1));
  const total = sampleTerrainPath(points);
  const line = sampleTerrainPath(section);
  const relief = createTerrainSurface(projectGeometry);
  let anchors: Point[] = [];
  let far: Point[] = [];
  let near: Point[] = [];
  let projectedLine: Point[] = [];
  let distances: number[] = [];
  let sizes: { width: number; height: number }[] = [];
  let layout = { width: 0, height: 0 };
  world.append(relief.element,svg);
  atlas.append(world,names);
  layer.append(before,atlas);
  scene.dataset.journey = leg.id;
  scene.append(layer);
  relief.orient([-8,34]);
  projectGeometry();

  function projectGeometry() {
    anchors = labels.map(label => relief.project(label.point));
    far = points.map(relief.project);
    near = section.map(relief.project);
    full.setAttribute('d',routePath(total.map(relief.project)));
    if (past.length > 1) earlier.setAttribute('d',routePath(past.map(relief.project)));
    projectedLine = line.map(relief.project);
    let distance = 0;
    distances = projectedLine.map(([x,y], index) => {
      if (index) {
        const [px,py] = projectedLine[index - 1];
        distance += Math.hypot((x - px) * terrainAspect, y - py);
      }
      return distance;
    });
    layer.dataset.terrain = relief.ready ? 'relief' : 'raster';
  }

  function tracedPath(fraction: number) {
    if (fraction <= 0) return '';
    if (fraction >= 1) return routePath(projectedLine);
    const distance = distances[distances.length - 1] * fraction;
    const next = distances.findIndex(value => value > distance);
    if (next < 1) return '';
    const [x,y] = projectedLine[next - 1], [toX,toY] = projectedLine[next];
    const t = (distance - distances[next - 1]) / (distances[next] - distances[next - 1]);
    return routePath([...projectedLine.slice(0,next), [x+(toX-x)*t,y+(toY-y)*t]]);
  }

  function fit(path: readonly Point[], roomX: number, roomY: number) {
    const x = path.map(point => point[0]), y = path.map(point => point[1]);
    const left = Math.min(...x), right = Math.max(...x), top = Math.min(...y), bottom = Math.max(...y);
    const width = Math.min(layout.width * roomX / Math.max(10, right - left),
      layout.height * terrainAspect * roomY / Math.max(7, bottom - top)) * 100;
    return { x: (left + right) / 2, y: (top + bottom) / 2, width };
  }

  function paint(elapsed: number) {
    const clamp = (value: number) => Math.max(0, Math.min(1, value));
    const t = clamp((elapsed - pullbackStart) / (overviewStart - pullbackStart));
    const pull = t * t * (3 - 2 * t);
    const blend = (a: number, b: number) => a + (b - a) * pull;
    const width = layer.clientWidth, height = layer.clientHeight;
    if (!width || !height) return;
    if (width !== layout.width || height !== layout.height || sizes.some(size => !size.width || !size.height)) {
      layout = { width, height };
      sizes = labels.map(({node}) => ({ width: node.offsetWidth, height: node.offsetHeight }));
    }
    const overview = fit(far,.73,.66), close = fit(near,.57,.63);
    const worldWidth = blend(Math.max(overview.width * 1.20, close.width), overview.width);
    const worldHeight = worldWidth / terrainAspect;
    const left = width / 2 - worldWidth * blend(close.x, overview.x) / 100;
    const top = height / 2 - worldHeight * blend(close.y, overview.y) / 100;
    Object.assign(world.style, { width: worldWidth + 'px', height: worldHeight + 'px', left: left + 'px', top: top + 'px' });
    const reveal = clamp((elapsed - 220) / (traceEnd - 220));
    atlas.style.opacity = String(clamp(elapsed / 205) * (1 - clamp((elapsed - fadeStart) / (end - fadeStart))));
    before.style.opacity = String(1 - clamp(elapsed / 205));
    full.style.opacity = String(.14 + .37 * pull);
    earlier.style.opacity = '.53';
    trace.setAttribute('d',tracedPath(reveal));

    type Box = { x: number; y: number; w: number; h: number };
    const used: Box[] = [];
    const inBounds = (rect: Box) =>
      rect.x >= 8 && rect.y >= 8 && rect.x + rect.w <= width - 8 && rect.y + rect.h <= height - 8;
    const clearOfUsed = (rect: Box) => used.every(box =>
      rect.x + rect.w + 5 < box.x || box.x + box.w + 5 < rect.x ||
      rect.y + rect.h + 4 < box.y || box.y + box.h + 4 < rect.y);
    const overlapArea = (rect: Box) => used.reduce((sum, box) => {
      const ox = Math.max(0, Math.min(rect.x + rect.w + 5, box.x + box.w + 5) - Math.max(rect.x, box.x));
      const oy = Math.max(0, Math.min(rect.y + rect.h + 4, box.y + box.h + 4) - Math.max(rect.y, box.y));
      return sum + ox * oy;
    }, 0);
    const clampRect = (rect: Box): Box => ({
      x: Math.max(8, Math.min(Math.max(8, width - rect.w - 8), rect.x)),
      y: Math.max(8, Math.min(Math.max(8, height - rect.h - 8), rect.y)),
      w: rect.w, h: rect.h,
    });
    const slotsFor = (w: number, h: number, side?: 'left' | 'bottom'): [number, number][] => {
      const aboveRight: [number, number] = [9, -h - 11];
      const aboveCenter: [number, number] = [-w / 2, -h - 13];
      const aboveLeft: [number, number] = [-9 - w, -h - 11];
      const belowRight: [number, number] = [9, 11];
      const belowCenter: [number, number] = [-w / 2, 13];
      const belowLeft: [number, number] = [-9 - w, 11];
      const toLeft: [number, number] = [-11 - w, -h / 2];
      const toRight: [number, number] = [11, -h / 2];
      if (side === 'bottom') return [belowCenter, belowRight, belowLeft, aboveCenter, aboveRight, toLeft, toRight, aboveLeft];
      if (side === 'left') return [toLeft, aboveLeft, belowLeft, aboveCenter, belowCenter, aboveRight, belowRight, toRight];
      return [aboveRight, aboveCenter, aboveLeft, toRight, belowRight, belowCenter, toLeft, belowLeft];
    };

    for (const index of labelOrder) {
      const { name, node, pin, side, close: isClose } = labels[index];
      const level = isClose ? clamp((elapsed - 120) / 160) : clamp((pull - .34) / .25);
      const [u,v] = anchors[index];
      const x = left + worldWidth * u / 100, y = top + worldHeight * v / 100;
      const pinVisible = level > 0 && x >= 4 && x <= width - 4 && y >= 4 && y <= height - 4;
      pin.style.opacity = String(pinVisible ? level : 0);
      if (pinVisible) Object.assign(pin.style, { left: x + 'px', top: y + 'px' });
      if (level <= 0) {
        node.style.opacity = '0';
        chosenSlot[index] = -1;
        continue;
      }
      const { width: w, height: h } = sizes[index];
      const candidates = slotsFor(w, h, side).map(([dx, dy]): Box => ({ x: x + dx, y: y + dy, w, h }));
      let picked: Box | undefined;
      const locked = chosenSlot[index];
      if (locked >= 0 && locked < candidates.length && inBounds(candidates[locked]) && clearOfUsed(candidates[locked])) {
        picked = candidates[locked];
      }
      if (!picked) {
        const hit = candidates.findIndex(rect => inBounds(rect) && clearOfUsed(rect));
        if (hit >= 0) {
          chosenSlot[index] = hit;
          picked = candidates[hit];
        }
      }
      if (!picked) {
        const clamped = candidates.map(clampRect);
        const hit = clamped.findIndex(clearOfUsed);
        if (hit >= 0) {
          chosenSlot[index] = hit;
          picked = clamped[hit];
        } else if (isClose || name === '遵义') {
          let bestIndex = 0, bestArea = Infinity;
          clamped.forEach((rect, slotIndex) => {
            const area = overlapArea(rect);
            if (area < bestArea) { bestArea = area; bestIndex = slotIndex; }
          });
          chosenSlot[index] = bestIndex;
          picked = clamped[bestIndex];
        }
      }
      node.style.opacity = String(picked ? level : 0);
      if (picked) {
        Object.assign(node.style, { left: picked.x + 'px', top: picked.y + 'px' });
        used.push(picked);
      }
    }
    layer.dataset.phase = elapsed < pullbackStart ? 'near' : elapsed < overviewStart ? 'pullback' : 'overview';
    layer.dataset.routeProgress = reveal.toFixed(3);
  }

  return new Promise<void>(resolve => {
    let frame = 0;
    function finish() {
      cancelAnimationFrame(frame);
      reducedMotion.removeEventListener('change', motionChanged);
      signal.removeEventListener('abort', finish);
      if (relief.onChange === projectGeometry) relief.onChange = () => {};
      layer.remove();
      delete scene.dataset.journey;
      resolve();
    }
    function motionChanged() { if (reducedMotion.matches) finish(); }
    function tick() {
      const elapsed = sceneNow() - journey.startedAt;
      if (elapsed >= end || !layer.isConnected) finish();
      else {
        paint(elapsed);
        frame = requestAnimationFrame(tick);
      }
    }
    signal.addEventListener('abort', finish, { once: true });
    reducedMotion.addEventListener('change', motionChanged);
    tick();
  });
}

function centerRouteWorld(world: HTMLElement, focus: Point, zoom: number) {
  world.style.width = world.style.height = (zoom * 100) + '%';
  world.style.left = (50 - focus[0] * zoom) + '%';
  world.style.top = (50 - focus[1] * zoom) + '%';
}

function playJourney(scene: HTMLElement, departing: HTMLImageElement | null, leg: [number, number], terrain: HTMLElement | null) {
  if (reducedMotion.matches || (!terrain && (!departing?.complete || !departing.naturalWidth))) return;
  const layer = element('div','journey-layer');
  layer.setAttribute('aria-hidden','true');
  const before = terrain ?? element('img','journey-departure');
  if (before instanceof HTMLImageElement && departing) {
    before.src = departing.currentSrc || departing.src;
    before.alt = '';
  }
  const atlas = element('div','journey-atlas');
  const world = element('div','journey-world');
  const backdrop = element('div','terrain-surface');
  backdrop.style.backgroundImage = 'url(' + mediaAssets.terrain + ')';
  const svg = routeCanvas();
  const [start,end] = leg;
  const points = route.slice(start,end+1).map(position);
  const begin = points[0], finish = points.at(-1)!;
  const zoom = Math.min(5.2, 54 / Math.max(10, Math.abs(begin[0]-finish[0]), Math.abs(begin[1]-finish[1])));
  centerRouteWorld(world,[(begin[0]+finish[0])/2,(begin[1]+finish[1])/2],zoom);
  const previous = route.slice(0,start+1).map(position);
  if (previous.length > 1) svg.append(diagramPath(routePath(previous),'route'));
  const path = routePath(points);
  svg.append(diagramPath(path,'route'));
  const advance = diagramPath(path,'route past');
  svg.append(advance);
  world.append(backdrop,svg);
  atlas.append(world);
  layer.append(before,atlas);
  scene.append(layer);
  before.style.zIndex = '0';
  before.style.opacity = '0';
  const trip = animatePart(atlas,[
    {opacity:0},{opacity:1,offset:.21},{opacity:1,offset:.8},{opacity:0},
  ],1150,0,'linear');
  animatePart(before,[{opacity:1},{opacity:1,offset:.94},{opacity:0}],265,0,'linear');
  drawLine(advance,210,665);
  const remove = () => layer.remove();
  if (trip) void trip.finished.then(remove,remove);
  else remove();
}

function playRiverExit(scene: HTMLElement, departing: HTMLCanvasElement) {
  const layer = element('div','journey-layer');
  layer.setAttribute('aria-hidden','true');
  departing.className = 'journey-departure';
  layer.append(departing);
  scene.append(layer);
  const dissolve = animatePart(departing,[{opacity:1,transform:'none'},{opacity:0,transform:'scale(1.1)'}],460);
  const remove = () => layer.remove();
  if (dissolve) void dissolve.finished.then(remove,remove);
  else remove();
}

type WujiangView = 'shore' | 'top' | 'slope';

function mountWujiangView(stage: HTMLElement, tools: HTMLElement) {
  const lens = element('div','wujiang-lens journey-atlas');
  const world = element('div','journey-world');
  const svg = routeCanvas();
  const line = diagramPath('','route past');
  svg.append(line);
  lens.append(world);
  lens.hidden = true;
  stage.append(lens);
  let mode: WujiangView = 'shore';
  let terrain: TerrainSurface | undefined;
  const nearby = wujiangApproach.map(position);
  const focus = nearby[1];

  function draw() {
    if (!terrain || mode === 'shore') return;
    slope.disabled = !terrain.ready;
    terrain.orient(mode === 'top' ? [0,0] : [-16,43]);
    centerRouteWorld(world,terrain.project(focus),3.4);
    line.setAttribute('d',routePath(nearby.map(terrain.project)));
  }

  function select(next: WujiangView) {
    mode = next;
    lens.hidden = next === 'shore';
    top.hidden = slope.hidden = shore.hidden = next === 'shore';
    open.hidden = next !== 'shore';
    top.setAttribute('aria-pressed',String(next === 'top'));
    slope.setAttribute('aria-pressed',String(next === 'slope'));
    if (next === 'shore') {
      activeSceneCue = undefined;
      return;
    }
    activeSceneCue = 'wujiang-' + next;
    if (!terrain) {
      terrain = createTerrainSurface(draw);
      world.append(terrain.element,svg);
    }
    draw();
  }
  const open = syncControl('wujiang-open','看地形',() => select('top'),'journey-control','compass');
  const top = syncControl('wujiang-top','俯视',() => select('top'),'journey-control');
  const slope = syncControl('wujiang-slope','斜视',() => select('slope'),'journey-control');
  const shore = syncControl('wujiang-shore','江岸',() => select('shore'),'journey-control');
  top.hidden = slope.hidden = shore.hidden = true;
  tools.append(open,top,slope,shore);
}
