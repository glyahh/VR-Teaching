type OpeningCaptionCue = readonly [start: number, end: number, text: string];
type OpeningBadgeCue = readonly [start: number, end: number, title: string, sub: string, side: 'left' | 'right'];

const openingCaptions: readonly OpeningCaptionCue[] = [
  [1.15, 3.11, '第五次反围剿失败后，'],
  [3.11, 6.1351, '中央红军主力被迫撤离苏区。'],
  [6.5551, 9.0392, '走之前，先要过于都河。'],
  [10.55, 14.6298, '河上没有固定桥，乡亲们送来门板和木船。'],
  [14.9698, 16.6197, '门板铺成桥面，'],
  [16.6197, 18.7405, '木船在桥下托住纵梁。'],
  [19.65, 24.155, '趁着夜色，大部队分批走上浮桥，开始了长征。'],
  [25.85, 29.6866, '一路向西，红军接连突破三道封锁线。'],
  [30.0866, 34.0792, '十一月底到了湘江，第四道封锁线就在面前。'],
  [35.25, 38.0341, '主力拼死过了江，损失惨重。'],
  [41.15, 46.0803, '出发时八万六千余人，渡过湘江后只剩三万余人。'],
  [46.5403, 49.2909, '一路打下来，减员超过一半。'],
  [50.45, 55.2881, '原定北上湘西北，同红二、红六军团会合。'],
  [55.6881, 58.0179, '可敌军已在那里布下重兵。'],
  [59.6, 62.4432, '刚闯过湘江，前面又被堵死。'],
  [62.8232, 65.1953, '原来的路，还走得通吗？'],
  [66.15, 69.3761, '十二月到了黎平，会上仍有争论。'],
  [69.7761, 73.2239, '毛泽东主张改向敌军力量薄弱的贵州。'],
  [74.6, 76.2212, '多数同志赞成。'],
  [76.5612, 79.0012, '黎平会议决定向黔北进军，'],
  [79.0012, 82.6081, '在以遵义为中心的川黔边建立根据地。'],
  [84.35, 87.61, '元旦，猴场会议重申了这一决定，'],
  [87.61, 89.5842, '部队随即向乌江推进。'],
  [91.45, 94.1728, '红军强渡乌江，进驻遵义。'],
  [94.5728, 97.1491, '行军方向，总算定下来了。'],
  [98.4, 101.1951, '可一路受挫的根源，还没理清。'],
  [101.6151, 105.0951, '遵义会议集中解决军事和组织问题，'],
  [105.0951, 107.6733, '明确今后怎么打、由谁指挥。'],
  [109.9, 113.8495, '三个月间，红军怎样一步步走向转折？'],
  [114.3295, 117.6949, '现在回到于都，从出发的那一夜看起。'],
];

const openingBadges: readonly OpeningBadgeCue[] = [
  [6.6, 9.15, '中央苏区', '1934.10 · 战略转移', 'right'],
  [60.6, 65.95, '贵州黎平', '1934.12', 'left'],
  [93, 97.75, '乌江天险', '1935.01', 'left'],
  [99.1, 104.7, '贵州遵义', '遵义会议会址', 'right'],
];

const openingTimelineStops = [
  { date: '1934.10', label: '于都 · 集结', frac: 0.00 },
  { date: '1934.11', label: '湘江 · 血战', frac: 0.44 },
  { date: '1934.12', label: '黎平 · 改向', frac: 0.64 },
  { date: '1935.01', label: '遵义 · 转折', frac: 1.00 },
] as const;

let currentOpeningOverlayDispose: (() => void) | undefined;

function releaseOpeningOverlay() {
  currentOpeningOverlayDispose?.();
  currentOpeningOverlayDispose = undefined;
}

function mountOpeningProgress(scene: HTMLElement, video: HTMLVideoElement, seek: (time: number) => void) {
  const dock = element('div', 'opening-progress');
  const range = element('input', 'opening-progress-range');
  range.type = 'range';
  range.min = '0';
  range.step = '0.1';
  range.setAttribute('aria-label', '片头播放进度');
  dock.append(range);
  scene.append(dock);

  function sync() {
    const available = !video.error && !video.hidden && Number.isFinite(video.duration) && video.duration > 0;
    range.disabled = !available;
    if (!available) return;
    range.max = String(video.duration);
    range.valueAsNumber = video.currentTime;
    range.style.setProperty('--opening-progress-value', `${range.valueAsNumber / video.duration * 100}%`);
  }

  range.addEventListener('input', () => {
    if (range.valueAsNumber !== video.currentTime) seek(range.valueAsNumber);
    sync();
  });
  for (const event of ['durationchange', 'timeupdate', 'seeked', 'error']) video.addEventListener(event, sync);
  sync();
}

function clamp01(v: number) {
  return v <= 0 ? 0 : v >= 1 ? 1 : v;
}

function easeOutCubic(v: number) {
  const t = clamp01(v);
  return 1 - (1 - t) ** 3;
}

function easeInOutCubic(v: number) {
  const t = clamp01(v);
  return t < 0.5 ? 4 * t * t * t : 1 - ((-2 * t + 2) ** 3) / 2;
}

function mountOpeningOverlay(scene: HTMLElement, video: HTMLVideoElement) {
  releaseOpeningOverlay();
  const hud = element('div', 'opening-hud');
  hud.setAttribute('aria-hidden', 'true');

  // 1. 序幕纪年主视觉
  const prologue = element('div', 'opening-prologue');
  prologue.hidden = true;
  const pLineTop = element('span', 'opening-prologue-line');
  const pMain = element('div', 'opening-prologue-main');
  const pYear = element('span', 'opening-prologue-year', '1934');
  const pDot = element('i', 'opening-prologue-dot');
  const pSeason = element('span', 'opening-prologue-season', '秋');
  pMain.append(pYear, pDot, pSeason);
  const pLineBot = element('span', 'opening-prologue-line');
  const pSub = element('p', 'opening-prologue-sub', '中央红军战略转移');
  prologue.append(pLineTop, pMain, pLineBot, pSub);

  // 2. 响应式地点标牌（贴近真实视口安全内边距，任何窗口比例零裁切）
  const badge = element('aside', 'opening-badge');
  badge.hidden = true;
  const badgeBar = element('span', 'opening-badge-bar');
  const badgeBody = element('div', 'opening-badge-body');
  const badgeTitle = element('strong', 'opening-badge-title');
  const badgeSub = element('span', 'opening-badge-sub');
  badgeBody.append(badgeTitle, badgeSub);
  badge.append(badgeBar, badgeBody);

  // 四站地图的进度轴与字幕共用底部排版。
  const timeline = element('div', 'opening-timeline');
  timeline.hidden = true;
  const tlTrack = element('div', 'opening-tl-track');
  const tlFill = element('span', 'opening-tl-fill');
  tlTrack.append(tlFill);
  const tlList = element('div', 'opening-tl-stops');
  tlList.style.setProperty('--opening-stop-count', String(openingTimelineStops.length));
  tlList.append(tlTrack);
  const tlNodes = openingTimelineStops.map((stop, idx) => {
    const item = element('div', 'opening-tl-stop');
    item.dataset.major = String(idx === openingTimelineStops.length - 1);
    item.style.gridColumn = String(idx + 1);
    item.append(
      element('time', '', stop.date),
      element('i', 'opening-tl-dot'),
      element('strong', '', stop.label),
    );
    tlList.append(item);
    return item;
  });
  timeline.append(tlList);

  // 5. 底部高清响应式单行字幕
  const caption = element('p', 'film-subtitle opening-sub');
  caption.hidden = true;

  const bottom = element('div', 'opening-bottom');
  bottom.append(timeline, caption);
  hud.append(prologue, badge, bottom);
  scene.append(hud);

  let rafId = 0;
  let disposed = false;
  let lastCaption = '';

  function renderAt(t: number) {
    if (video.hidden) {
      prologue.hidden = true;
      badge.hidden = true;
      timeline.hidden = true;
      caption.hidden = true;
      lastCaption = '';
      return;
    }

    // 1. 字幕同步
    let subText = '';
    for (const [s, e, text] of openingCaptions) {
      if (t >= s && t < e) { subText = text; break; }
    }
    if (subText !== lastCaption) {
      lastCaption = subText;
      caption.textContent = subText;
      caption.style.setProperty('--opening-cue-glyph-scale', String(1 / (Math.max(1, [...subText].length) * 1.045)));
    }
    caption.hidden = !subText;

    // 2. 序幕主纪年（2.30s – 6.45s）
    if (t >= 2.30 && t <= 6.45) {
      const inP = easeOutCubic((t - 2.35) / 0.85);
      const outP = 1 - clamp01((t - 5.55) / 0.85);
      const a = inP * outP;
      prologue.hidden = a <= 0.01;
      prologue.style.opacity = a.toFixed(3);
      const spread = 14 + 14 * easeOutCubic((t - 2.35) / 2.6);
      pMain.style.gap = spread.toFixed(1) + 'px';
      const lineScale = (easeOutCubic((t - 2.30) / 0.72) * outP).toFixed(3);
      pLineTop.style.transform = `scaleX(${lineScale})`;
      pLineBot.style.transform = `scaleX(${lineScale})`;
      pSub.style.opacity = (clamp01((t - 2.90) / 0.55) * outP).toFixed(3);
    } else {
      prologue.hidden = true;
    }

    // 3. 地点角标
    let activeBadge: OpeningBadgeCue | undefined;
    for (const b of openingBadges) {
      if (t >= b[0] && t <= b[1]) { activeBadge = b; break; }
    }
    if (activeBadge) {
      const [s, e, title, sub, side] = activeBadge;
      const inP = easeOutCubic((t - s) / 0.42);
      const outP = 1 - clamp01((t - (e - 0.40)) / 0.40);
      const a = inP * outP;
      badge.hidden = a <= 0.01;
      badge.dataset.side = side;
      if (badgeTitle.textContent !== title) badgeTitle.textContent = title;
      if (badgeSub.textContent !== sub) badgeSub.textContent = sub;
      badge.style.opacity = a.toFixed(3);
      const shift = (1 - inP) * (side === 'right' ? 16 : -16);
      badgeBody.style.transform = `translateX(${shift.toFixed(1)}px)`;
    } else {
      badge.hidden = true;
    }

    if (t >= 108.70 && t <= 114.65) {
      const tLocal = t - 108.50;
      const inP = easeOutCubic((tLocal - 0.20) / 0.45);
      const outP = 1 - clamp01((t - 114.20) / 0.45);
      const a = inP * outP;
      timeline.hidden = a <= 0.01;
      timeline.style.opacity = a.toFixed(3);
      const elapsed = (tLocal - 0.45) / 4.50;
      const next = openingTimelineStops.findIndex(stop => elapsed < stop.frac);
      let progress = next < 0 ? 1 : 0;
      if (next > 0) {
        const start = openingTimelineStops[next - 1].frac;
        const end = openingTimelineStops[next].frac;
        const leg = easeInOutCubic((elapsed - start) / (end - start));
        progress = (next - 1 + leg) / (openingTimelineStops.length - 1);
      }
      tlFill.style.width = `${progress * 100}%`;
      openingTimelineStops.forEach((stop, idx) => {
        tlNodes[idx].dataset.lit = String(elapsed >= stop.frac);
      });
    } else {
      timeline.hidden = true;
    }
  }

  function tick() {
    rafId = 0;
    if (disposed || !video.isConnected) return;
    renderAt(video.currentTime);
    if (!video.paused && !video.ended) rafId = requestAnimationFrame(tick);
  }

  function sync() {
    if (disposed) return;
    renderAt(video.currentTime);
    if (!video.paused && !video.ended && !rafId) rafId = requestAnimationFrame(tick);
  }

  for (const ev of ['play', 'pause', 'seeked', 'timeupdate', 'loadeddata', 'ended']) {
    video.addEventListener(ev, sync);
  }
  sync();

  currentOpeningOverlayDispose = () => {
    disposed = true;
    cancelAnimationFrame(rafId);
    for (const ev of ['play', 'pause', 'seeked', 'timeupdate', 'loadeddata', 'ended']) {
      video.removeEventListener(ev, sync);
    }
    hud.remove();
  };
}
