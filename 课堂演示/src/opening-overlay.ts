type OpeningCaptionCue = readonly [start: number, end: number, text: string];
type OpeningBadgeCue = readonly [start: number, end: number, title: string, sub: string, side: 'left' | 'right'];

const openingCaptions: readonly OpeningCaptionCue[] = [
  [1.20, 4.59, '1934 年秋，第五次反“围剿”失败。'],
  [4.98, 10.08, '中央红军主力被迫撤离苏区，踏上战略转移之路。'],
  [10.88, 16.04, '十月中旬，八万六千余名将士在江西于都集结。'],
  [16.38, 21.14, '于都河上无固定桥，乡亲们卸下门板、划来渔船。'],
  [21.43, 26.04, '连夜架起的浮桥上，大部队悄悄踏出长征第一步。'],
  [26.98, 32.46, '十一月底，红军在广西全州、兴安之间血战湘江。'],
  [32.85, 37.62, '部队拼死突破第四道封锁线，却付出惨重代价。'],
  [38.11, 42.85, '出发时八万六千余人，过江后锐减至三万余人。'],
  [43.84, 48.63, '沉重的损失，迫使红军重新审视眼前的去路。'],
  [49.02, 54.27, '原定北上湘西北与友军会合，前方却已布满重兵。'],
  [54.66, 59.86, '12 月 18 日，黎平会议果断决定，改向黔北进军。'],
  [60.70, 65.95, '1935 年元旦，猴场会议重申方针，催促部队北进。'],
  [66.35, 71.77, '几天后，红军顶着天险急流强渡乌江，直指遵义。'],
  [72.71, 78.11, '1 月 15 日至 17 日，中央政治局在遵义召开扩大会议。'],
  [78.55, 82.76, '危急关头，会议集中解决军事和组织问题。'],
  [83.65, 88.47, '一路受挫之后，这支队伍如何一步步走向转折？'],
  [88.96, 93.45, '现在，我们回到于都河畔，亲手翻开这段历史。'],
];

const openingBadges: readonly OpeningBadgeCue[] = [
  [6.60, 10.05, '中央苏区', '1934.10 · 战略转移', 'right'],
  [43.65, 46.05, '贵州黎平', '1934.12', 'left'],
  [69.75, 72.10, '乌江天险', '1935.01', 'left'],
  [72.65, 76.35, '贵州遵义', '遵义会议会址', 'right'],
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
    const active = !video.hidden && t >= 0.55 && t <= 93.55;
    if (!active) {
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
      if (t >= s && t <= e) { subText = text; break; }
    }
    if (subText !== lastCaption) {
      lastCaption = subText;
      caption.textContent = subText;
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

    if (t >= 83.35 && t <= 88.45) {
      const tLocal = t - 83.15;
      const inP = easeOutCubic((tLocal - 0.20) / 0.45);
      const outP = 1 - clamp01((t - 88.00) / 0.45);
      const a = inP * outP;
      timeline.hidden = a <= 0.01;
      timeline.style.opacity = a.toFixed(3);
      const elapsed = (tLocal - 0.45) / 3.70;
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
