type OpeningCaptionCue = readonly [start: number, end: number, text: string];
type OpeningBadgeCue = readonly [start: number, end: number, title: string, sub: string, side: 'left' | 'right'];

const openingCaptions: readonly OpeningCaptionCue[] = [
  [1.2, 2.95, '第五次反围剿失败，'],
  [2.95, 5.4619, '中央红军不得不离开苏区。'],
  [5.9019, 7.8695, '第一道关，是于都河。'],
  [10.45, 14.2809, '没有桥，乡亲们卸下门板，划来渔船。'],
  [14.6809, 16.2809, '门板铺在上面，'],
  [16.2809, 18.5924, '木船在桥下稳稳托着。'],
  [19.4, 21.4875, '入夜，队伍走上浮桥。'],
  [21.9075, 24.8778, '长征，从这片夜色里开始了。'],
  [26.05, 29.6752, '一路向西，红军连着冲过三道封锁线。'],
  [30.1152, 34.2865, '十一月底走到湘江，迎面撞上了第四道封锁线。'],
  [35.35, 39.5458, '主力拼死过了江，可太多人，留在了江边。'],
  [41.15, 46.2286, '出发时八万六千余人，渡过湘江后只剩三万余人。'],
  [46.6786, 49.377, '再这么硬打，部队撑不住了。'],
  [50.45, 55.2632, '原本要北上湘西北，和红二、红六军团会合。'],
  [55.6832, 58.4816, '可敌军重兵，早就等在前面。'],
  [59.7, 62.7051, '刚闯过湘江，北路又被堵死。'],
  [63.1051, 65.2779, '部队，还能往哪里走？'],
  [66.2, 68.6427, '到了黎平，会上还在争论。'],
  [69.0427, 73.399, '毛泽东主张放弃北上，转向敌军薄弱的贵州。'],
  [74.45, 76.9474, '这一次，多数同志赞成。'],
  [77.3274, 79.6574, '黎平会议决定改向黔北，'],
  [79.6574, 83.4501, '在以遵义为中心的川黔边开辟新根据地。'],
  [84.35, 88.62, '转眼到了元旦，猴场会议再次敲定北进方向，'],
  [88.62, 90.0102, '部队直抵乌江。'],
  [91.15, 95.1872, '寒冬里，红军强渡乌江，进了遵义城。'],
  [95.5672, 97.5657, '往哪里走，终于定了。'],
  [98.7, 101.4289, '可一路受挫的根子，还没解开。'],
  [101.8689, 105.9589, '油灯下，遵义会议解决军事和组织问题，'],
  [105.9589, 108.1812, '定下怎么打、由谁指挥。'],
  [109.8, 113.6849, '三个月里，这支队伍是怎么走向转折的？'],
  [114.1849, 117.5333, '回到于都，从出发的那个夜晚看起。'],
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
