type RecapStationVisual = {
  index: number;
  id: string;
  shortName: string;
  tag: string;
  metric?: string;
  glyph: string[];
  imageKey: string;
  point: Point;
  badgeCount: () => { lit: number; total: number };
};

let recapFocusIndex: number | null = null;
let currentRecapDispose: (() => void) | undefined;

const recapMemories = [
  { image: 'yudu', caption: '乡亲们搭起浮桥，红军从这里出发。', start: 0, end: 2800 },
  { image: 'xiang-aftermath', caption: '许多人牺牲了。渡过江的队伍还要继续走。', start: 4500, end: 8000 },
  { image: 'liping-table', caption: '黎平会议决定改向黔北。', start: 9300, end: 11900 },
  { image: 'zunyi-dawn', caption: '', start: 13700, end: 17600 },
];
const recapDuration = 17600;

type RecapPlayback = { kind: 'ready' } | { kind: 'playing'; startedAt: number }
  | { kind: 'paused'; elapsed: number } | { kind: 'finished' };

function recapEase(elapsed: number, start: number, end: number) {
  const progress = Math.max(0, Math.min(1, (elapsed - start) / (end - start)));
  return progress * progress * (3 - 2 * progress);
}

function mountRecapFinale(stage: HTMLElement, onStart: () => void, paintRoute: (progress: number) => void) {
  const frames = element('div', 'recap-memory-frames');
  const memories = recapMemories.map((memory, index) => {
    const frame = element('figure', 'recap-memory');
    frame.dataset.station = events[index].id;
    frame.hidden = true;
    frame.style.setProperty('--memory-image', `url("${mediaAssets[memory.image]}")`);
    const image = photo(memory.image);
    frame.append(image);
    if (memory.caption) {
      const caption = element('figcaption', 'recap-memory-caption');
      caption.append(element('strong', '', events[index].name), element('span', '', memory.caption));
      frame.append(caption);
    }
    frames.append(frame);
    return { ...memory, frame, routeEnd: events[index].routeEnd };
  });

  const endCopy = element('section', 'recap-end-copy');
  const title = element('h2', 'recap-end-title', '从于都到遵义');
  const conclusion = element('p', 'review-conclusion', lessonConclusion);
  conclusion.setAttribute('aria-live', 'polite');
  endCopy.hidden = true;
  endCopy.append(title, conclusion);

  let playback: RecapPlayback = { kind: 'ready' };
  let frameRequest = 0;
  const transport = lessonControl('reveal-review', '播放片尾', togglePlayback, 'primary', 'play');

  function setPlayback(next: RecapPlayback) {
    playback = next;
    stage.dataset.playback = next.kind;
    transport.hidden = next.kind === 'finished' && reducedMotion.matches;
    switch (next.kind) {
      case 'ready':
        setButtonContent(transport, '播放片尾', 'play');
        break;
      case 'playing':
        setButtonContent(transport, '暂停', 'pause');
        break;
      case 'paused':
        setButtonContent(transport, '继续播放', 'play');
        break;
      case 'finished':
        setButtonContent(transport, '重播串联', 'reset');
        break;
    }
  }

  function paint(elapsed: number) {
    let routeIndex = 0;
    for (const [index, memory] of memories.entries()) {
      const previous = memories[index - 1];
      if (previous) {
        const leg = recapEase(elapsed, previous.end - 160, memory.start);
        routeIndex += (memory.routeEnd - previous.routeEnd) * leg;
      }
      const entered = recapEase(elapsed, memory.start, memory.start + 600);
      const left = index === memories.length - 1 ? 0 : recapEase(elapsed, memory.end - 480, memory.end);
      const opacity = entered * (1 - left);
      memory.frame.hidden = opacity === 0;
      memory.frame.style.opacity = String(opacity);
    }

    const titleOpacity = recapEase(elapsed, 14900, 15800);
    endCopy.hidden = titleOpacity === 0;
    endCopy.style.opacity = String(titleOpacity);
    paintRoute(routeIndex / (route.length - 1));
  }

  function finish() {
    cancelAnimationFrame(frameRequest);
    soundscape.stopFinale();
    reviewAnswer = true;
    saveLessonProgress();
    stage.dataset.finale = 'true';
    const restoreFocus = reducedMotion.matches && document.activeElement === transport;
    setPlayback({ kind: 'finished' });
    paint(recapDuration);
    if (restoreFocus) {
      stage.parentElement?.querySelector<HTMLButtonElement>('[data-lesson-action="map"]')?.focus();
    }
  }

  function tick(now: number) {
    if (playback.kind !== 'playing') return;
    const elapsed = now - playback.startedAt;
    if (elapsed >= recapDuration) {
      finish();
      return;
    }
    paint(elapsed);
    frameRequest = requestAnimationFrame(tick);
  }

  function pause() {
    if (playback.kind !== 'playing') return;
    const elapsed = performance.now() - playback.startedAt;
    if (elapsed >= recapDuration) {
      finish();
      return;
    }
    cancelAnimationFrame(frameRequest);
    soundscape.stopFinale();
    setPlayback({ kind: 'paused', elapsed });
    paint(elapsed);
  }

  function togglePlayback() {
    if (playback.kind === 'playing') {
      pause();
      return;
    }
    const elapsed = playback.kind === 'paused' ? playback.elapsed : 0;
    setPlayback({ kind: 'playing', startedAt: performance.now() - elapsed });
    if (elapsed === 0) onStart();
    if (reducedMotion.matches) {
      finish();
      return;
    }
    soundscape.playFinale(elapsed / 1000, recapDuration / 1000);
    paint(elapsed);
    frameRequest = requestAnimationFrame(tick);
  }

  const lifecycle = new AbortController();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) pause();
  }, { signal: lifecycle.signal });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches && playback.kind !== 'ready') finish();
    else setPlayback(playback);
  }, { signal: lifecycle.signal });

  return {
    frames, endCopy, transport,
    restore() {
      if (reviewAnswer) {
        setPlayback({ kind: 'finished' });
        onStart();
        paint(recapDuration);
      } else {
        setPlayback({ kind: 'ready' });
      }
    },
    dispose() {
      lifecycle.abort();
      cancelAnimationFrame(frameRequest);
      soundscape.stopFinale();
    },
  };
}

function releaseRecap() {
  currentRecapDispose?.();
  currentRecapDispose = undefined;
}

function createRecapGlyph(paths: string[]) {
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'recap-glyph');
  svg.setAttribute('aria-hidden', 'true');
  for (const d of paths) {
    const p = document.createElementNS(svgNamespace, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}

function buildRecapStations(): RecapStationVisual[] {
  return [
    {
      index: 0, id: 'yudu', shortName: '于都', tag: '集结出发', metric: '8.6 万余人',
      glyph: ['M3 16 Q12 12 21 16', 'M6 15 V11 H18 V15', 'M4 19 Q8 17.5 12 19 T20 19'],
      imageKey: 'yudu-bridge',
      point: position(route[0]),
      badgeCount: () => ({
        lit: Number(revealed.has('boat') || revealed.has('plank')) +
          Number(visitedExplorations.has('yudu-river')) +
          Number(completedPractices.has('bridge-parts')),
        total: 3,
      }),
    },
    {
      index: 1, id: 'xiang', shortName: '湘江', tag: '渡江之后',
      glyph: ['M3 18 Q8 14 13 17 T21 17', 'M3 13 Q8 9 13 12 T21 12', 'M14 8 L18 4 L21 8'],
      imageKey: 'xiang-aftermath',
      point: position(route[4]),
      badgeCount: () => ({
        lit: Number(revealed.has('xiang-tour')) +
          Number(completedPractices.has('troop-dates') || completedPractices.has('crossing-evidence')),
        total: 2,
      }),
    },
    {
      index: 2, id: 'liping', shortName: '黎平', tag: '改变方向', metric: '改向黔北',
      glyph: ['M12 20 V11', 'M12 11 L18 5', 'M12 11 L5 6', 'M5 6 H9 M5 6 V10'],
      imageKey: 'liping-street',
      point: position(route[6]),
      badgeCount: () => ({
        lit: Number(revealed.has('direction-west')) +
          Number(revealed.has('hc-2') || revealed.has('hc-3')) +
          Number(completedPractices.has('turn-evidence')),
        total: 3,
      }),
    },
    {
      index: 3, id: 'zunyi', shortName: '遵义', tag: '总结与调整', metric: '伟大转折',
      glyph: ['M12 4 C10 7 10 9.5 12 11 C14 9.5 14 7 12 4', 'M8 14 H16 L15 20 H9 Z', 'M9 14 V11.5 M15 14 V11.5'],
      imageKey: 'zunyi-dawn',
      point: position(route[9]),
      badgeCount: () => ({
        lit: Number(visitedExplorations.has('zunyi-hall')) +
          Number(revealed.has('materials-compared')) +
          Number(completedPractices.has('zunyi-issues')),
        total: 3,
      }),
    },
  ];
}

function mountRecapStage(shell: HTMLElement, conclusionPage: boolean, onOpenRevisit: (index: number) => void) {
  releaseRecap();
  const stage = element('section', 'recap-stage');
  stage.dataset.mode = conclusionPage ? 'finale' : 'overview';
  stage.dataset.finale = String(reviewAnswer);

  const world = element('div', 'recap-world');
  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('class', 'map-route recap-route');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');

  const basePath = diagramPath('', 'recap-path-base');
  const abandonedPath = diagramPath('', 'recap-path-abandoned');
  const glowPath = diagramPath('', 'recap-path-glow');
  for (const p of [basePath, abandonedPath, glowPath]) p.setAttribute('vector-effect', 'non-scaling-stroke');
  svg.append(basePath, abandonedPath, glowPath);

  const terrain = createTerrainSurface(() => projectAll());
  world.append(terrain.element, svg);

  const comet = element('span', 'recap-comet');
  const dawnHalo = element('div', 'recap-dawn-halo');
  const nodeLayer = element('div', 'recap-nodes');
  nodeLayer.append(dawnHalo, comet);

  const stations = buildRecapStations();
  const totalSampled = sampleTerrainPath(route.map(position));
  const abandonedSampled = sampleTerrainPath(abandonedNorthPlan.map(position));
  let projectedLine: Point[] = [];
  let projectedNodes: Point[] = [];

  const card = element('aside', 'recap-card');
  card.id = 'recap-station-card';
  card.hidden = true;
  const cardPhoto = element('img', 'recap-card-photo');
  const cardBody = element('div', 'recap-card-body');
  const cardMeta = element('div', 'recap-card-meta');
  const cardTime = element('time');
  const cardTitle = element('h2');
  const cardMetric = element('span', 'recap-card-metric');
  const cardVisual = element('div', 'recap-card-visual');
  const cardTag = element('p', 'story-detail review-step recap-card-tag');
  const cardActions = element('div', 'recap-card-actions');
  const cardRevisit = lessonControl('recap-revisit', '回看现场', () => {
    if (recapFocusIndex !== null) onOpenRevisit(recapFocusIndex);
  }, 'recap-revisit-btn', 'arrowRight', true);
  const cardClose = lessonControl('recap-card-close', '', () => {
    const index = recapFocusIndex;
    selectStation(null);
    if (index !== null) nodeElements[index].focus({preventScroll:true});
  }, 'recap-close-btn');
  cardClose.setAttribute('aria-label', '收起站点卡片');
  cardClose.textContent = '×';
  cardMeta.append(cardTime, cardTitle, cardMetric);
  cardActions.append(cardRevisit, cardClose);
  cardBody.append(cardMeta, cardVisual, cardTag, cardActions);
  card.append(cardPhoto, cardBody);

  const nodeElements = stations.map(st => {
    const ev = events[st.index];
    const btn = lessonControl('review-step-' + st.index, '', () => {
      const next = recapFocusIndex === st.index ? null : st.index;
      selectStation(next);
    }, 'recap-node');
    btn.setAttribute('aria-label', ev.name + '，查看视觉回顾');
    btn.setAttribute('aria-controls', card.id);
    btn.dataset.station = st.id;
    const ring = element('span', 'recap-node-ring');
    const thumb = photo(st.imageKey, ev.name);
    thumb.className = 'recap-node-thumb';
    ring.append(thumb, createRecapGlyph(st.glyph));
    const badges = element('span', 'recap-badges');
    const { lit, total } = st.badgeCount();
    for (let i = 0; i < total; i++) {
      const dot = element('i', 'recap-badge');
      dot.dataset.lit = String(i < lit);
      badges.append(dot);
    }
    const label = element('span', 'recap-node-label');
    label.append(element('strong', '', st.shortName), element('em', '', st.tag));
    btn.append(ring, badges, label);
    nodeLayer.append(btn);
    return btn;
  });

  const footer = element('div', 'review-tools recap-footer');
  const previous = lessonControl('previous', '上一页', () => conclusionPage ? openReview() : openScene(chapterPages.length - 1), '', 'arrowLeft');
  const next = conclusionPage ? undefined : lessonControl('next', '全景总结', () => openReview(true), 'primary', 'arrowRight', true);
  const finale = conclusionPage ? mountRecapFinale(stage, () => {
    const selectedStation = recapFocusIndex;
    selectStation(null);
    recapFocusIndex = selectedStation;
    nodeLayer.inert = true;
    tickCamera(performance.now());
  }, progress => {
    finaleProgress = progress;
    paintGlow(progress);
    placeNodes();
  }) : undefined;
  footer.append(previous);
  const disposeRecapReport = courseHarness.mountRecapReportButton(footer);
  if (next) footer.append(next);
  if (finale) footer.append(finale.transport);

  stage.append(world, nodeLayer, card);
  if (finale) stage.append(finale.frames, finale.endCopy);
  stage.append(footer);
  shell.append(stage);

  let width = 0, height = 0, worldW = 0, worldH = 0, originX = 0, originY = 0;
  let currentYaw = -6, currentTilt = 35, targetYaw = -6, targetTilt = 35;
  let currentZoom = 1, targetZoom = 1;
  const restPan: Point = conclusionPage ? [0, -14] : [0, -2];
  let currentPan: Point = [...restPan], targetPan: Point = [...restPan];
  let rafId = 0;
  let disposed = false;
  let finaleProgress = reviewAnswer ? 1 : 0;

  function renderMiniVisual(st: RecapStationVisual) {
    cardVisual.replaceChildren();
    const { lit, total } = st.badgeCount();
    const row = element('div', 'recap-mini-badges');
    for (let i = 0; i < total; i++) {
      const pip = element('span', 'recap-mini-pip');
      pip.dataset.lit = String(i < lit);
      row.append(pip);
    }
    cardVisual.append(createRecapGlyph(st.glyph), row);
  }

  function selectStation(index: number | null) {
    recapFocusIndex = index;
    if (index !== null) {
      reviewSteps.add(index);
      soundscape.playSfx('point');
    }
    saveLessonProgress();
    nodeElements.forEach((btn, i) => {
      btn.setAttribute('aria-pressed', String(i === index));
      btn.setAttribute('aria-expanded', String(i === index));
      btn.dataset.visited = String(reviewSteps.has(i));
    });
    if (index === null) {
      card.hidden = true;
      targetZoom = 1;
      targetPan = [...restPan];
      targetYaw = -6;
      targetTilt = 35;
      if (reducedMotion.matches) tickCamera(performance.now());
      return;
    }
    const st = stations[index];
    const ev = events[index];
    cardPhoto.src = mediaAssets[st.imageKey];
    cardPhoto.alt = ev.name;
    cardTime.textContent = ev.timeline;
    cardTitle.textContent = ev.name;
    cardMetric.textContent = st.metric ?? '';
    cardMetric.hidden = !st.metric;
    cardTag.textContent = st.tag;
    renderMiniVisual(st);
    card.hidden = false;
    appear(card, 0, 240);
    const pt = projectedNodes[index] ?? st.point;
    targetZoom = 1.42;
    targetYaw = -10 + index * 5.5;
    targetTilt = 40;
    targetPan = [(50 - pt[0]) * 0.65, (46 - pt[1]) * 0.65];
    if (reducedMotion.matches) tickCamera(performance.now());
  }

  function projectAll() {
    terrain.orient([currentYaw, currentTilt]);
    projectedLine = totalSampled.map(terrain.project);
    projectedNodes = stations.map(st => terrain.project(st.point));
    basePath.setAttribute('d', routePath(projectedLine));
    abandonedPath.setAttribute('d', routePath(abandonedSampled.map(terrain.project)));
    paintGlow(finaleProgress);
    placeNodes();
  }

  function paintGlow(progress: number) {
    if (!projectedLine.length) return;
    if (progress === 0) {
      glowPath.setAttribute('d', '');
      comet.style.opacity = '0';
      dawnHalo.style.opacity = '0';
      return;
    }
    const count = Math.max(2, Math.floor((projectedLine.length - 1) * progress) + 1);
    const slice = projectedLine.slice(0, count);
    glowPath.setAttribute('d', routePath(slice));
    comet.style.opacity = progress < 0.995 ? '1' : '0';
    if (progress > 0.78) {
      const k = Math.min(1, (progress - 0.78) / 0.22);
      dawnHalo.style.opacity = String(k * 0.92);
    } else {
      dawnHalo.style.opacity = '0';
    }
  }

  function placeNodes() {
    if (!width || !height) return;
    const tx = originX + currentPan[0] * (width / 100) + (worldW * (1 - currentZoom)) / 2;
    const ty = originY + currentPan[1] * (height / 100) + (worldH * (1 - currentZoom)) / 2;
    world.style.width = worldW + 'px';
    world.style.height = worldH + 'px';
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${currentZoom})`;
    world.style.transformOrigin = '0 0';
    projectedNodes.forEach((pt, idx) => {
      const x = tx + worldW * currentZoom * pt[0] / 100;
      const y = ty + worldH * currentZoom * pt[1] / 100;
      const node = nodeElements[idx];
      node.style.left = Math.max(54, Math.min(width - 54, x)) + 'px';
      node.style.top = Math.max(72, Math.min(height - 110, y)) + 'px';
      const litByFinale = finaleProgress > 0 && finaleProgress >= events[idx].routeEnd / (route.length - 1);
      node.dataset.lit = String(litByFinale || reviewSteps.has(idx));
    });
    if (finaleProgress > 0 && projectedLine.length) {
      const count = Math.max(2, Math.floor((projectedLine.length - 1) * finaleProgress) + 1);
      const head = projectedLine[count - 1];
      if (head && finaleProgress < 0.995) {
        comet.style.left = (tx + worldW * currentZoom * head[0] / 100) + 'px';
        comet.style.top = (ty + worldH * currentZoom * head[1] / 100) + 'px';
      }
      const zp = projectedNodes[3];
      if (zp) {
        dawnHalo.style.left = (tx + worldW * currentZoom * zp[0] / 100) + 'px';
        dawnHalo.style.top = (ty + worldH * currentZoom * zp[1] / 100) + 'px';
      }
    }
  }

  function layout() {
    width = stage.clientWidth;
    height = stage.clientHeight;
    if (!width || !height) return;
    worldW = Math.max(width * 0.94, height * 0.86 * terrainAspect);
    worldH = worldW / terrainAspect;
    originX = (width - worldW) / 2;
    originY = (height - worldH) / 2 - height * 0.04;
    projectAll();
  }

  const header = shell.querySelector<HTMLElement>('.recap-top')!;
  const disposeDirectorTrigger = courseHarness.mountDirectorTrigger(shell, header.querySelector<HTMLElement>('.top-actions')!);
  function positionCard() {
    stage.style.setProperty('--recap-card-top', header.offsetHeight + 12 + 'px');
    stage.style.setProperty('--recap-footer-height', footer.offsetHeight + 'px');
  }
  const ro = new ResizeObserver(() => {
    layout();
    positionCard();
  });
  ro.observe(stage);
  ro.observe(header);
  ro.observe(footer);

  stage.addEventListener('click', event => {
    if (!nodeLayer.inert && recapFocusIndex !== null && event.target instanceof Element &&
        !event.target.closest('.recap-node,.recap-card,.review-tools')) {
      selectStation(null);
    }
  });

  function tickCamera(now: number) {
    if (disposed) return;
    const cinema = stage.dataset.playback !== undefined && stage.dataset.playback !== 'ready';
    const immediate = cinema || reducedMotion.matches;
    const breathYaw = recapFocusIndex === null && !immediate ? Math.sin(now * 0.00035) * 4.5 : 0;
    const goalYaw = targetYaw + breathYaw;
    const k = immediate ? 1 : 0.09;
    const moved = Math.abs(goalYaw - currentYaw) > 0.02 || Math.abs(targetTilt - currentTilt) > 0.02 ||
      Math.abs(targetZoom - currentZoom) > 0.002 || Math.abs(targetPan[0] - currentPan[0]) > 0.05 ||
      Math.abs(targetPan[1] - currentPan[1]) > 0.05;
    currentYaw += (goalYaw - currentYaw) * k;
    currentTilt += (targetTilt - currentTilt) * k;
    currentZoom += (targetZoom - currentZoom) * k;
    currentPan = [currentPan[0] + (targetPan[0] - currentPan[0]) * k, currentPan[1] + (targetPan[1] - currentPan[1]) * k];

    if (moved) projectAll();
  }

  function animateCamera(now: number) {
    tickCamera(now);
    if (!disposed && !reducedMotion.matches &&
        (!stage.dataset.playback || stage.dataset.playback === 'ready')) rafId = requestAnimationFrame(animateCamera);
  }

  layout();
  finale?.restore();
  if ((!conclusionPage || !reviewAnswer) && recapFocusIndex !== null) selectStation(recapFocusIndex);
  animateCamera(performance.now());

  currentRecapDispose = () => {
    disposed = true;
    disposeDirectorTrigger();
    disposeRecapReport();
    cancelAnimationFrame(rafId);
    finale?.dispose();
    ro.disconnect();
    if (terrain.onChange === projectAll) terrain.onChange = () => {};
  };

  return { previous, next, footer };
}
