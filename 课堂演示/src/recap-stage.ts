type RecapStationVisual = {
  index: number;
  id: string;
  shortName: string;
  tag: string;
  metric: string;
  glyph: string[];
  imageKey: string;
  point: Point;
  badgeCount: () => { lit: number; total: number };
};

let recapFocusIndex: number | null = null;
let currentRecapDispose: (() => void) | undefined;

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
      index: 1, id: 'xiang', shortName: '湘江', tag: '渡江受挫', metric: '8.6 万 → 3 万',
      glyph: ['M5 19 V6', 'M9 19 V14', 'M14 10 L19 15 M19 10 L14 15'],
      imageKey: 'xiang-ford',
      point: position(route[4]),
      badgeCount: () => ({
        lit: Number(revealed.has('crossing')) +
          Number(visitedExplorations.has('xiang-crossing')) +
          Number(completedPractices.has('troop-dates') || completedPractices.has('crossing-evidence')),
        total: 3,
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

  // 可开合的极简图形化微卡（以实景缩略图、微型视觉图签和点亮徽章为主，极少文字）
  const card = element('aside', 'recap-card');
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
  const cardRevisit = syncControl('recap-revisit', '回看现场', () => {
    if (recapFocusIndex !== null) onOpenRevisit(recapFocusIndex);
  }, 'recap-revisit-btn', 'arrowRight', true);
  const cardClose = syncControl('recap-card-close', '', () => selectStation(null), 'recap-close-btn');
  cardClose.setAttribute('aria-label', '收起站点卡片');
  cardClose.textContent = '×';
  cardMeta.append(cardTime, cardTitle, cardMetric);
  cardActions.append(cardRevisit, cardClose);
  cardBody.append(cardMeta, cardVisual, cardTag, cardActions);
  card.append(cardPhoto, cardBody);

  // 课尾高潮定格：纯图形四阶转折弧 + 一句话核心结论（保持 .review-conclusion 类名以兼容双屏断言）
  const finalePanel = element('section', 'recap-finale');
  const arcRow = element('div', 'recap-arc');
  stations.forEach((st, idx) => {
    if (idx > 0) arcRow.append(element('span', 'recap-arc-link'));
    const pill = element('div', 'recap-arc-stop');
    pill.dataset.index = String(idx);
    pill.append(createRecapGlyph(st.glyph), element('strong', '', st.shortName), element('span', '', st.tag));
    arcRow.append(pill);
  });
  const conclusion = element('p', 'review-conclusion', lessonConclusion);
  conclusion.hidden = !reviewAnswer;
  conclusion.setAttribute('aria-live', 'polite');
  finalePanel.hidden = !(conclusionPage && reviewAnswer);
  finalePanel.append(arcRow, conclusion);

  // 四站交互圆镜节点（兼顾 .review-choice 与无障碍定位）
  const nodeElements = stations.map(st => {
    const ev = events[st.index];
    const btn = syncControl('review-step-' + st.index, '', () => {
      const next = recapFocusIndex === st.index ? null : st.index;
      selectStation(next);
    }, 'recap-node review-choice');
    btn.setAttribute('aria-label', ev.name + '，查看视觉回顾');
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

  // 底部极简图形导航与操作栏
  const footer = element('div', 'review-tools recap-footer');
  const previous = syncControl('previous', '上一页', () => conclusionPage ? openReview() : openScene(chapterPages.length - 1), '', 'arrowLeft');
  const next = conclusionPage ? undefined : syncControl('next', '全景总结', () => openReview(true), 'primary', 'arrowRight', true);
  const reveal = conclusionPage ? syncControl('reveal-review', '揭示结论', () => startFinaleAnimation(), 'primary', 'play') : undefined;
  if (reveal) reveal.hidden = reviewAnswer;
  const replay = conclusionPage ? syncControl('replay-finale', '重播串联', () => startFinaleAnimation(true), '', 'reset') : undefined;
  if (replay) replay.hidden = !reviewAnswer;
  footer.append(previous);
  if (next) footer.append(next);
  if (reveal) footer.append(reveal);
  if (replay) footer.append(replay);

  stage.append(world, nodeLayer, card, finalePanel, footer);
  shell.append(stage);

  let width = 0, height = 0, worldW = 0, worldH = 0, originX = 0, originY = 0;
  let currentYaw = -6, currentTilt = 35, targetYaw = -6, targetTilt = 35;
  let currentZoom = 1, targetZoom = 1;
  const restPan: Point = conclusionPage ? [0, -14] : [0, -2];
  let currentPan: Point = [...restPan], targetPan: Point = [...restPan];
  let rafId = 0;
  let disposed = false;
  let finaleProgress = reviewAnswer ? 1 : 0;
  let finaleRunning = false;
  let finaleStartedAt = 0;

  function renderMiniVisual(st: RecapStationVisual) {
    cardVisual.replaceChildren();
    if (st.id === 'xiang') {
      const bars = element('div', 'recap-mini-bars');
      const b1 = element('div', 'recap-mini-bar is-before');
      b1.innerHTML = '<span>1934.10</span><i></i><b>8.6万</b>';
      const b2 = element('div', 'recap-mini-bar is-after');
      b2.innerHTML = '<span>1934.12</span><i></i><b>3万</b>';
      bars.append(b1, b2);
      cardVisual.append(bars);
    } else {
      const { lit, total } = st.badgeCount();
      const row = element('div', 'recap-mini-badges');
      for (let i = 0; i < total; i++) {
        const pip = element('span', 'recap-mini-pip');
        pip.dataset.lit = String(i < lit);
        row.append(pip);
      }
      cardVisual.append(createRecapGlyph(st.glyph), row);
    }
  }

  function selectStation(index: number | null) {
    recapFocusIndex = index;
    if (index !== null) {
      reviewSteps.add(index);
      soundscape.playSfx('point');
    }
    nodeElements.forEach((btn, i) => {
      btn.setAttribute('aria-pressed', String(i === index));
      btn.dataset.visited = String(reviewSteps.has(i));
    });
    if (index === null) {
      card.hidden = true;
      targetZoom = 1;
      targetPan = [...restPan];
      targetYaw = -6;
      targetTilt = 35;
      return;
    }
    const st = stations[index];
    const ev = events[index];
    cardPhoto.src = mediaAssets[st.imageKey];
    cardPhoto.alt = ev.name;
    cardTime.textContent = ev.timeline;
    cardTitle.textContent = ev.name;
    cardMetric.textContent = st.metric;
    cardTag.textContent = st.tag;
    renderMiniVisual(st);
    card.hidden = false;
    appear(card, 0, 240);
    const pt = projectedNodes[index] ?? st.point;
    targetZoom = 1.42;
    targetYaw = -10 + index * 5.5;
    targetTilt = 40;
    targetPan = [(50 - pt[0]) * 0.65, (46 - pt[1]) * 0.65];
  }

  function startFinaleAnimation(isReplay = false) {
    recapFocusIndex = null;
    card.hidden = true;
    targetZoom = 0.96;
    targetPan = [0, -18];
    targetYaw = -8;
    targetTilt = 36;
    reviewAnswer = true;
    stage.dataset.finale = 'true';
    if (reveal) reveal.hidden = true;
    if (replay) replay.hidden = false;
    finalePanel.hidden = false;
    conclusion.hidden = false;
    if (!projectionMode) soundscape.playFinale();
    if (reducedMotion.matches) {
      finaleProgress = 1;
      finaleRunning = false;
      paintGlow(1);
      return;
    }
    if (isReplay) soundscape.playSfx('route');
    finaleRunning = true;
    finaleProgress = 0;
    finaleStartedAt = performance.now();
    appear(conclusion, 1800, 480);
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
    if (progress <= 0.005) {
      glowPath.setAttribute('d', '');
      comet.style.opacity = '0';
      dawnHalo.style.opacity = '0';
      return;
    }
    const count = Math.max(2, Math.round(projectedLine.length * Math.min(1, progress)));
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
      const litByFinale = finaleProgress >= idx / 3.15;
      node.dataset.lit = String(litByFinale || reviewSteps.has(idx));
    });
    if (finaleProgress > 0.005 && projectedLine.length) {
      const count = Math.max(2, Math.round(projectedLine.length * Math.min(1, finaleProgress)));
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

  const ro = new ResizeObserver(layout);
  ro.observe(stage);

  // 点击空白背景收起当前展开的站点卡片
  stage.addEventListener('click', event => {
    if (projectionMode) return;
    if (recapFocusIndex !== null && !(event.target as Element).closest('.recap-node,.recap-card,.review-tools')) {
      sendAction('recap-card-close');
      selectStation(null);
    }
  });

  function tick(now: number) {
    if (disposed) return;
    const breathYaw = recapFocusIndex === null && !reducedMotion.matches ? Math.sin(now * 0.00035) * 4.5 : 0;
    const goalYaw = targetYaw + breathYaw;
    const k = reducedMotion.matches ? 1 : 0.09;
    const moved = Math.abs(goalYaw - currentYaw) > 0.02 || Math.abs(targetTilt - currentTilt) > 0.02 ||
      Math.abs(targetZoom - currentZoom) > 0.002 || Math.abs(targetPan[0] - currentPan[0]) > 0.05;
    currentYaw += (goalYaw - currentYaw) * k;
    currentTilt += (targetTilt - currentTilt) * k;
    currentZoom += (targetZoom - currentZoom) * k;
    currentPan = [currentPan[0] + (targetPan[0] - currentPan[0]) * k, currentPan[1] + (targetPan[1] - currentPan[1]) * k];

    if (finaleRunning) {
      finaleProgress = Math.min(1, (now - finaleStartedAt) / 4800);
      paintGlow(finaleProgress);
      arcRow.querySelectorAll<HTMLElement>('.recap-arc-stop').forEach((el, i) => {
        el.dataset.active = String(finaleProgress >= i * 0.28);
      });
      if (finaleProgress >= 1) finaleRunning = false;
      placeNodes();
    } else if (moved) {
      projectAll();
    }
    if (!reducedMotion.matches) rafId = requestAnimationFrame(tick);
  }

  layout();
  if (recapFocusIndex !== null) selectStation(recapFocusIndex);
  else if (conclusionPage && reviewAnswer) {
    finaleProgress = 1;
    arcRow.querySelectorAll<HTMLElement>('.recap-arc-stop').forEach(el => { el.dataset.active = 'true'; });
    projectAll();
  }
  if (!reducedMotion.matches) rafId = requestAnimationFrame(tick);

  currentRecapDispose = () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    ro.disconnect();
    if (terrain.onChange === projectAll) terrain.onChange = () => {};
  };

  return { previous, next, footer };
}
