/**
 * 课堂 AI 网关前端桥接与 4 项课页联动。
 * 原则：
 * - 直接打开单文件课件时跳过 AI 网关。
 * - 从一键开课进入并检测到网关后，激活以下功能。
 *   1. AI 实景副导（语音/口令直控切页、高亮构件、对照路线、调取史料）
 *   2. 黎平「1934 战地推演沙盘」（SVG 动态假设路径、受阻红区与历史对照）
 *   3. 遵义会议桌 3D 现场「1935 会场质询 / 持证辩论」（驱动 3D 卷宗与破晓光影）
 *   4. 课尾「千班千面」实训复盘简报生成与单页 HTML 导出归档
 */

type DirectorAction =
  | { type: 'navigate_page'; pageTitle: string }
  | { type: 'focus_hotspot'; key: string }
  | { type: 'compare_liping_routes'; side: 'east' | 'west' | 'both' }
  | { type: 'open_archive'; archiveId: string }
  | { type: 'open_desk_object'; object: DeskObject }
  | { type: 'open_review'; conclusion?: boolean };

type DirectorResponse = {
  ok: true;
  narration: string;
  actions: DirectorAction[];
  citedSources: string[];
};

type SandboxResponse = {
  ok: true;
  hypothesisTag: string;
  trajectory: string;
  riskLevel: 'critical' | 'high' | 'viable';
  mapPath: [number, number][];
  chokePoint: { x: number; y: number; label: string };
  telegramTitle: string;
  battlefieldOutcome: string;
  historicalContrast: string;
  citedSources: string[];
};

type ZunyiDebateResponse = {
  ok: true;
  stage: 'challenge' | 'rebuttal';
  verdictTitle: string;
  message: string;
  followUpPrompt: string;
  accepted: boolean;
  highlightDeskObject: 'journal' | 'dossier' | 'map' | 'both';
  dawnProgress: number;
  citedSources: string[];
};

type RecapReportPayload = {
  title: string;
  subtitle: string;
  executiveSummary: string;
  journeyHighlights: string[];
  decisionComparison: string;
  gridMapping: { topic: string; principle: string; action: string }[];
  discussionQuestions: string[];
  citedSources: string[];
};

type CourseSessionTrace = {
  visitedPages: string[];
  directorRuns: { utterance: string; narration: string }[];
  sandboxRuns: { proposal: string; telegramTitle: string; riskLevel: string }[];
  zunyiDebates: { argument: string; verdictTitle: string; accepted: boolean }[];
};

type HarnessHealth = {
  ok: boolean;
  engine?: string;
  model?: string;
  capabilities?: string[];
};

type SpeechRecognitionCtor = new () => {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};

type ActiveSceneBridge = {
  pageTitle: string;
  focusHotspot?: (key: string) => void;
  compareLiping?: (side: 'east' | 'west' | 'both') => void;
  openTroopRecords?: () => void;
  showDirectorBanner?: (text: string, cites: string[]) => void;
};

const courseHarness = (() => {
  const params = new URLSearchParams(location.search);
  let gatewayBase = params.get('ai')?.trim().replace(/\/+$/, '') || '';
  let accessToken = new URLSearchParams(location.hash.slice(1)).get('ai-access');

  let online = false;
  let healthInfo: HarnessHealth = { ok: false };
  let activeScene: ActiveSceneBridge | undefined;
  let directorDock: HTMLElement | undefined;
  let directorRequest: AbortController | undefined;

  let trace: CourseSessionTrace = {
    visitedPages: [],
    directorRuns: [],
    sandboxRuns: [],
    zunyiDebates: [],
  };

  function emitStatus() {
    window.dispatchEvent(new CustomEvent('course-harness-status', { detail: { online, healthInfo } }));
  }

  async function probe(base = gatewayBase, token = accessToken) {
    if (!base) return false;
    try {
      const res = await fetch(`${base}/api/course-ai/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(1500),
        cache: 'no-store',
      });
      if (!res.ok) return false;
      const data = await res.json() as HarnessHealth;
      if (data?.ok) {
        gatewayBase = base;
        accessToken = token;
        online = true;
        healthInfo = data;
        emitStatus();
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  async function postJson<T>(path: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(path.endsWith('/recap-report') ? 59000 : 39000);
    let res: Response;
    try {
      res = await fetch(`${gatewayBase}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        },
        body: JSON.stringify(payload),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch {
      signal?.throwIfAborted();
      if (timeout.aborted) throw new Error('AI 响应超时，请重试。');
      throw new Error('教学网关连接中断，请检查一键开课服务后重试。');
    }
    const data = await res.json().catch(() => ({ ok: false, message: '教学服务响应异常，请重试。' }));
    if (!res.ok || !data?.ok) {
      throw new Error(data?.message || `服务请求失败 (${res.status})`);
    }
    return data as T;
  }

  function recordVisit(pageTitle: string) {
    if (!pageTitle || trace.visitedPages.includes(pageTitle)) return;
    trace.visitedPages.push(pageTitle);
    if (trace.visitedPages.length > 24) trace.visitedPages.shift();
  }

  function resetTrace() {
    trace = { visitedPages: [], directorRuns: [], sandboxRuns: [], zunyiDebates: [] };
  }

  function addTrace<T>(entries: T[], entry: T) {
    entries.push(entry);
    if (entries.length > 12) entries.shift();
  }

  function getTrace(): CourseSessionTrace {
    return {
      visitedPages: [...trace.visitedPages],
      directorRuns: [...trace.directorRuns],
      sandboxRuns: [...trace.sandboxRuns],
      zunyiDebates: [...trace.zunyiDebates],
    };
  }

  function restoreTrace(raw: unknown) {
    resetTrace();
    if (!raw || typeof raw !== 'object') return;
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.visitedPages)) {
      trace.visitedPages = obj.visitedPages.filter((x): x is string => typeof x === 'string').slice(0, 24);
    }
    if (Array.isArray(obj.directorRuns)) {
      trace.directorRuns = obj.directorRuns.slice(-12) as CourseSessionTrace['directorRuns'];
    }
    if (Array.isArray(obj.sandboxRuns)) {
      trace.sandboxRuns = obj.sandboxRuns.slice(-12) as CourseSessionTrace['sandboxRuns'];
    }
    if (Array.isArray(obj.zunyiDebates)) {
      trace.zunyiDebates = obj.zunyiDebates.slice(-12) as CourseSessionTrace['zunyiDebates'];
    }
  }

  function speechCtor(): SpeechRecognitionCtor | undefined {
    const win = window as unknown as {
      SpeechRecognition?: SpeechRecognitionCtor;
      webkitSpeechRecognition?: SpeechRecognitionCtor;
    };
    return win.SpeechRecognition || win.webkitSpeechRecognition;
  }

  function createVoiceButton(onTranscript: (text: string) => void): HTMLButtonElement | undefined {
    const Ctor = speechCtor();
    if (!Ctor) return undefined;
    let rec: InstanceType<SpeechRecognitionCtor> | undefined;
    const btn = control('语音', () => {
      if (rec) {
        rec.stop();
        return;
      }
      rec = new Ctor();
      rec.lang = 'zh-CN';
      rec.interimResults = false;
      rec.maxAlternatives = 1;
      btn.setAttribute('aria-pressed', 'true');
      btn.classList.add('is-listening');
      rec.onresult = ev => {
        const text = ev.results?.[0]?.[0]?.transcript?.trim();
        if (text) onTranscript(text);
      };
      const done = () => {
        btn.setAttribute('aria-pressed', 'false');
        btn.classList.remove('is-listening');
        rec = undefined;
      };
      rec.onerror = done;
      rec.onend = done;
      try { rec.start(); } catch { done(); }
    }, 'harness-voice-btn');
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', '语音收音输入');
    return btn;
  }

  function waitFrame(ms = 160) {
    return new Promise<void>(resolve => window.setTimeout(resolve, ms));
  }

  function executeDirectorActions(actions: DirectorAction[], narration: string, cites: string[]) {
    const goTo = (matches: (page: LessonPage) => boolean) => {
      const idx = chapterPages.findIndex(entry => matches(entry.page));
      if (idx >= 0 && (currentView.kind !== 'scene' || currentView.position !== idx)) openScene(idx, 'lesson');
    };
    for (const action of actions) {
      if (action.type === 'navigate_page') {
        goTo(page => page.title === action.pageTitle);
      } else if (action.type === 'compare_liping_routes') {
        goTo(page => page.activity === 'directions');
        activeScene?.compareLiping?.(action.side);
      } else if (action.type === 'focus_hotspot') {
        const {key} = action;
        goTo(page => page.probes?.some(probe => probe.id === key) === true
          || (['boat', 'plank'].includes(key) && page.activity === 'bridge')
          || (key === 'xiang-reflection' && page.activity === 'troops'));
        activeScene?.focusHotspot?.(action.key);
      } else if (action.type === 'open_archive' && action.archiveId === 'troop-records') {
        goTo(page => page.activity === 'troops');
        activeScene?.openTroopRecords?.();
      } else if (action.type === 'open_desk_object') {
        goTo(page => page.activity === 'materials');
        currentDesk?.openObject(action.object);
      } else if (action.type === 'open_review') {
        openReview(Boolean(action.conclusion));
      }
    }
    if (narration) activeScene?.showDirectorBanner?.(narration, cites);
  }

  function closeDirectorDock() {
    directorRequest?.abort();
    directorRequest = undefined;
    directorDock?.remove();
    directorDock = undefined;
  }

  function toggleDirectorDock(host: HTMLElement) {
    if (!online) return;
    if (directorDock?.isConnected) {
      closeDirectorDock();
      return;
    }
    closeDirectorDock();
    const dock = element('section', 'harness-director-bar');
    dock.setAttribute('aria-label', 'AI 实景副导');

    const head = element('div', 'harness-director-head');
    const badge = element('span', 'harness-badge', 'AI 实景副导');
    const closeBtn = control('收起', closeDirectorDock, 'harness-mini-btn');
    head.append(badge, closeBtn);

    const presets = element('div', 'harness-presets');
    const quickItems = [
      '对照黎平双线与转向贵州',
      '调出湘江兵力记录核对口径',
      '查看于都浮桥承托船体',
      '进入遵义会议桌翻看卷宗',
    ];
    const form = element('form', 'harness-director-form');
    const input = element('input', 'harness-input');
    input.type = 'text';
    input.maxLength = 180;
    input.placeholder = '口述或输入指令…';
    input.setAttribute('aria-label', 'AI 实景副导指令');
    const submitBtn = element('button', 'primary harness-submit', '执行');
    submitBtn.type = 'submit';
    const statusLine = element('p', 'harness-status-line');
    statusLine.hidden = true;

    async function runUtterance(text: string) {
      const clean = text.trim();
      if (!clean || directorRequest || !dock.isConnected) return;
      const request = directorRequest = new AbortController();
      submitBtn.disabled = true;
      statusLine.hidden = false;
      statusLine.dataset.error = 'false';
      statusLine.textContent = '正在调度场景与史料…';
      try {
        const res = await postJson<DirectorResponse>('/api/course-ai/director', {
          utterance: clean,
          currentView: currentView.kind,
          currentPageTitle: activeScene?.pageTitle || '',
          revealedKeys: [...revealed],
        }, request.signal);
        if (request.signal.aborted) return;
        addTrace(trace.directorRuns, { utterance: clean, narration: res.narration });
        saveLessonProgress();
        statusLine.textContent = res.narration || '请指定要查看的课页或材料。';
        if (!res.actions.length) return;
        soundscape.playSfx('route');
        closeDirectorDock();
        executeDirectorActions(res.actions, res.narration, res.citedSources);
      } catch (err) {
        if (!dock.isConnected) return;
        statusLine.dataset.error = 'true';
        statusLine.textContent = err instanceof Error ? err.message : '调度失败，请检查服务连接后重试。';
      } finally {
        if (directorRequest === request) directorRequest = undefined;
        submitBtn.disabled = false;
      }
    }

    for (const label of quickItems) {
      presets.append(control(label, () => {
        input.value = label;
        void runUtterance(label);
      }, 'harness-chip'));
    }

    const voiceBtn = createVoiceButton(transcript => {
      input.value = transcript;
      void runUtterance(transcript);
    });
    if (voiceBtn) form.append(voiceBtn);
    form.append(input, submitBtn);
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      void runUtterance(input.value);
    });

    dock.append(head, presets, form, statusLine);
    host.append(dock);
    directorDock = dock;
    appear(dock, 0, 220);
    input.focus({ preventScroll: true });
  }

  function mountDirectorTrigger(scene: HTMLElement, tools: HTMLElement) {
    const btn = lessonControl('ai-director', 'AI 副导', () => toggleDirectorDock(scene), 'harness-director-btn', 'compass');
    btn.hidden = !online;
    tools.prepend(btn);
    const sync = () => {
      btn.hidden = !online;
      if (!online) closeDirectorDock();
    };
    window.addEventListener('course-harness-status', sync);
    return () => {
      window.removeEventListener('course-harness-status', sync);
      closeDirectorDock();
    };
  }

  function mountDirectorBanner(stage: HTMLElement) {
    const banner = element('aside', 'harness-director-banner');
    banner.hidden = true;
    const textNode = element('p', 'harness-director-banner-text');
    const citeNode = element('cite', 'harness-director-banner-cite');
    const dismiss = control('关闭', () => { banner.hidden = true; }, 'harness-mini-btn');
    const body = element('div', 'harness-director-banner-body');
    body.append(textNode, citeNode);
    banner.append(body, dismiss);
    stage.append(banner);
    let hideTimer = 0;
    return {
      show(text: string, cites: string[]) {
        window.clearTimeout(hideTimer);
        textNode.textContent = text;
        citeNode.textContent = cites.join(' · ');
        citeNode.hidden = !cites.length;
        banner.hidden = false;
        appear(banner, 0, 240);
        hideTimer = window.setTimeout(() => { banner.hidden = true; }, 11000);
      },
      dispose() { window.clearTimeout(hideTimer); },
    };
  }

  /**
   * ② 黎平「进军方向」：1934 战地推演沙盘（叠加 SVG 假设路径 + 敌军阻击红区 + 密电简报）
   */
  function mountLipingSandbox(opts: {
    stage: HTMLElement;
    paper: HTMLElement;
    svg: SVGSVGElement;
    deck: HTMLElement;
    onRestoreRealRoute: () => void;
  }) {
    const simGroup = document.createElementNS(svgNamespace, 'g');
    simGroup.setAttribute('class', 'sandbox-svg-layer');
    opts.svg.append(simGroup);

    const chokeBadge = element('span', 'sandbox-choke-badge');
    chokeBadge.hidden = true;
    opts.paper.append(chokeBadge);

    const panel = element('section', 'sandbox-panel');
    panel.hidden = true;
    const panelHead = element('div', 'sandbox-head');
    panelHead.append(element('strong', '', '1934 战地推演沙盘'));
    const closeBtn = control('收起', closePanel, 'harness-mini-btn');
    panelHead.append(closeBtn);

    const presets = element('div', 'harness-presets');
    const form = element('form', 'harness-director-form');
    const input = element('input', 'harness-input');
    input.type = 'text';
    input.maxLength = 220;
    input.placeholder = '提出假设方案（如：强攻湘西北与二六军团会合）';
    input.setAttribute('aria-label', '黎平战地沙盘推演方案');
    const runBtn = element('button', 'primary harness-submit', '推演');
    runBtn.type = 'submit';
    const resultBox = element('div', 'sandbox-result');
    resultBox.hidden = true;
    let pending: AbortController | undefined;
    let lastSimulation: SandboxResponse | undefined;

    function closePanel() {
      pending?.abort();
      pending = undefined;
      runBtn.disabled = false;
      panel.hidden = true;
      clearOverlay();
    }

    function clearOverlay() {
      simGroup.replaceChildren();
      chokeBadge.hidden = true;
    }

    function paintSimulation(res: SandboxResponse) {
      clearOverlay();
      if (res.mapPath.length >= 2) {
        const d = 'M ' + res.mapPath.map(([x, y]) => `${x} ${y}`).join(' L ');
        const pathEl = diagramPath(d, `sandbox-sim-path is-${res.riskLevel}`);
        simGroup.append(pathEl);
        drawLine(pathEl, 0, 560);
      }
      const ring = document.createElementNS(svgNamespace, 'circle');
      ring.setAttribute('cx', String(res.chokePoint.x));
      ring.setAttribute('cy', String(res.chokePoint.y));
      ring.setAttribute('r', '5.5');
      ring.setAttribute('class', `sandbox-choke-ring is-${res.riskLevel}`);
      simGroup.append(ring);

      chokeBadge.textContent = res.chokePoint.label;
      chokeBadge.style.left = res.chokePoint.x + '%';
      chokeBadge.style.top = Math.max(10, res.chokePoint.y - 8) + '%';
      chokeBadge.dataset.risk = res.riskLevel;
      chokeBadge.hidden = false;
      appear(chokeBadge, 240, 240);

      resultBox.hidden = false;
      resultBox.replaceChildren();
      const tag = element('span', 'sandbox-hypothesis-tag', res.hypothesisTag);
      const title = element('h3', 'sandbox-telegram-title', res.telegramTitle);
      const outcome = element('p', 'sandbox-outcome', res.battlefieldOutcome);
      const contrast = element('p', 'sandbox-contrast', `历史对照：${res.historicalContrast}`);
      const cites = element('cite', 'sandbox-cite', res.citedSources.join(' · '));
      const restoreBtn = control('对照真实历史抉择 · 转向黔北', () => {
        lastSimulation = undefined;
        resultBox.hidden = true;
        closePanel();
        opts.onRestoreRealRoute();
      }, 'primary sandbox-restore-btn', 'compass');
      resultBox.append(tag, title, outcome, contrast);
      if (res.citedSources.length) resultBox.append(cites);
      resultBox.append(restoreBtn);
    }

    async function runProposal(proposal: string) {
      const clean = proposal.trim();
      if (!clean || pending || panel.hidden) return;
      const request = pending = new AbortController();
      runBtn.disabled = true;
      clearOverlay();
      lastSimulation = undefined;
      resultBox.hidden = false;
      resultBox.replaceChildren(element('p', 'sandbox-loading', '正在结合 1934 年敌我态势进行沙盘推演…'));
      try {
        const res = await postJson<SandboxResponse>('/api/course-ai/sandbox', {
          theater: 'liping',
          proposal: clean,
        }, request.signal);
        if (request.signal.aborted) return;
        addTrace(trace.sandboxRuns, { proposal: clean, telegramTitle: res.telegramTitle, riskLevel: res.riskLevel });
        saveLessonProgress();
        soundscape.playSfx('route');
        lastSimulation = res;
        paintSimulation(res);
      } catch (err) {
        if (request.signal.aborted) return;
        resultBox.replaceChildren(element('p', 'sandbox-error', err instanceof Error ? err.message : '推演服务暂不可用'));
      } finally {
        if (pending === request) {
          pending = undefined;
          runBtn.disabled = false;
        }
      }
    }

    const sampleProposals = [
      '按原计划强攻湘西北与二六军团会合',
      '分兵佯攻牵制敌军，主力再尝试北上',
      '果断放弃原计划，改向敌军薄弱的黔北',
    ];
    for (const sample of sampleProposals) {
      presets.append(control(sample, () => {
        input.value = sample;
        void runProposal(sample);
      }, 'harness-chip'));
    }

    const voiceBtn = createVoiceButton(transcript => {
      input.value = transcript;
      void runProposal(transcript);
    });
    if (voiceBtn) form.append(voiceBtn);
    form.append(input, runBtn);
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      void runProposal(input.value);
    });

    panel.append(panelHead, presets, form, resultBox);
    opts.stage.append(panel);

    const trigger = lessonControl('liping-sandbox', '沙盘推演', () => {
      if (panel.hidden) {
        panel.hidden = false;
        if (lastSimulation) paintSimulation(lastSimulation);
        else resultBox.hidden = true;
        const banner = opts.stage.querySelector<HTMLElement>('.harness-director-banner');
        if (banner) banner.hidden = true;
        appear(panel, 0, 220);
        input.focus({ preventScroll: true });
      } else {
        closePanel();
      }
    }, 'deck-btn is-harness', 'layers');
    trigger.hidden = !online;
    opts.deck.append(trigger);

    const sync = () => {
      trigger.hidden = !online;
      if (!online) closePanel();
    };
    window.addEventListener('course-harness-status', sync);
    return () => {
      window.removeEventListener('course-harness-status', sync);
      closePanel();
    };
  }

  /**
   * ③ 遵义会议桌 3D 现场：1935 会场质询 / 持证辩论
   */
  function mountZunyiDebate(opts: {
    frame: HTMLElement;
    stage: HTMLElement;
    transport: HTMLElement;
    getSeenObjects: () => readonly DeskObject[];
    openObject: (obj: DeskObject) => void;
    highlightPin: (obj: DeskObject | 'both' | null) => void;
  }) {
    const panel = element('section', 'debate-panel');
    panel.hidden = true;
    const head = element('div', 'debate-head');
    const titleEl = element('strong', '', '1935 会场质询');
    const closeBtn = control('收起', closePanel, 'harness-mini-btn');
    head.append(titleEl, closeBtn);

    const promptBox = element('div', 'debate-prompt');
    const form = element('form', 'harness-director-form');
    const input = element('input', 'harness-input');
    input.type = 'text';
    input.maxLength = 260;
    input.placeholder = '结合桌上卷宗回应质询…';
    input.setAttribute('aria-label', '遵义会场持证辩论回应');
    const sendBtn = element('button', 'primary harness-submit', '持证回应');
    sendBtn.type = 'submit';
    const actionsRow = element('div', 'debate-actions');

    let question = '';
    let latest: ZunyiDebateResponse | undefined;
    let pending: AbortController | undefined;
    sendBtn.disabled = true;

    function closePanel() {
      pending?.abort();
      pending = undefined;
      sendBtn.disabled = !question;
      panel.hidden = true;
      opts.highlightPin(null);
    }

    function applyDebateVisual(res: ZunyiDebateResponse) {
      latest = res;
      titleEl.textContent = res.verdictTitle;
      opts.frame.style.setProperty('--desk-dawn', String(res.dawnProgress));
      opts.frame.dataset.dawn = res.accepted ? 'resolved' : 'active';
      opts.highlightPin(res.highlightDeskObject);

      promptBox.replaceChildren();
      const msg = element('p', 'debate-message', res.message);
      msg.dataset.accepted = String(res.accepted);
      const follow = element('p', 'debate-follow', res.followUpPrompt);
      promptBox.append(msg);
      if (res.stage === 'rebuttal') promptBox.prepend(element('p', 'debate-follow', question));
      if (res.followUpPrompt) promptBox.append(follow);
      if (res.citedSources.length) {
        promptBox.append(element('cite', 'sandbox-cite', res.citedSources.join(' · ')));
      }

      actionsRow.replaceChildren();
      const targets = res.highlightDeskObject === 'both' ? ['journal', 'dossier'] as const : [res.highlightDeskObject];
      for (const target of targets) {
        const label = target === 'journal' ? '翻看左册 · 会前形势' : target === 'map' ? '展开行军路线图' : '翻看右册 · 会议讨论';
        actionsRow.append(control(label, () => {
          closePanel();
          opts.openObject(target);
        }, 'harness-chip'));
      }
      if (!res.accepted) {
        actionsRow.append(control('示例论据：纠正军事指挥原则并调整领导机构保落地', () => {
          input.value = '只改行军方向不够，必须批评第五次反“围剿”脱离实际的军事指挥，同时增选毛泽东为常委、取消原“三人团”，从组织机制保障正确主张落地。';
          input.focus();
        }, 'harness-chip'));
      }
    }

    async function loadChallenge() {
      if (pending || panel.hidden) return;
      const request = pending = new AbortController();
      actionsRow.replaceChildren();
      promptBox.replaceChildren(element('p', 'sandbox-loading', '正在生成 1935 会场质询…'));
      try {
        const res = await postJson<ZunyiDebateResponse>('/api/course-ai/zunyi-debate', {
          stage: 'challenge',
          seenObjects: opts.getSeenObjects(),
        }, request.signal);
        if (request.signal.aborted) return;
        question = res.message;
        applyDebateVisual(res);
      } catch (err) {
        if (request.signal.aborted) return;
        promptBox.replaceChildren(element('p', 'sandbox-error', err instanceof Error ? err.message : '质询服务暂不可用'));
        actionsRow.replaceChildren(control('重试质询', () => void loadChallenge(), 'harness-chip'));
      } finally {
        if (pending === request) {
          pending = undefined;
          sendBtn.disabled = !question;
        }
      }
    }

    async function submitRebuttal(argument: string) {
      const clean = argument.trim();
      if (!clean || !question || pending || panel.hidden) return;
      const request = pending = new AbortController();
      sendBtn.disabled = true;
      promptBox.replaceChildren(element('p', 'sandbox-loading', '正在核验桌上史料依据…'));
      try {
        const res = await postJson<ZunyiDebateResponse>('/api/course-ai/zunyi-debate', {
          stage: 'rebuttal',
          seenObjects: opts.getSeenObjects(),
          question,
          argument: clean,
        }, request.signal);
        if (request.signal.aborted) return;
        addTrace(trace.zunyiDebates, { argument: clean, verdictTitle: res.verdictTitle, accepted: res.accepted });
        saveLessonProgress();
        soundscape.playSfx(res.accepted ? 'complete' : 'point');
        applyDebateVisual(res);
        if (res.accepted) input.value = '';
      } catch (err) {
        if (request.signal.aborted) return;
        if (latest) applyDebateVisual(latest);
        promptBox.append(element('p', 'sandbox-error', err instanceof Error ? err.message : '核验失败'));
      } finally {
        if (pending === request) {
          pending = undefined;
          sendBtn.disabled = false;
        }
      }
    }

    const voiceBtn = createVoiceButton(transcript => {
      input.value = transcript;
      void submitRebuttal(transcript);
    });
    if (voiceBtn) form.append(voiceBtn);
    form.append(input, sendBtn);
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      void submitRebuttal(input.value);
    });

    panel.append(head, promptBox, actionsRow, form);
    opts.stage.append(panel);

    const trigger = lessonControl('zunyi-debate', '1935 会场质询', () => {
      if (panel.hidden) {
        panel.hidden = false;
        appear(panel, 0, 220);
        if (latest) applyDebateVisual(latest);
        else void loadChallenge();
        input.focus({ preventScroll: true });
      } else {
        closePanel();
      }
    }, 'desk-live-clue is-harness', 'compass');
    trigger.hidden = !online;
    opts.transport.append(trigger);

    const sync = () => {
      trigger.hidden = !online;
      if (!online) closePanel();
    };
    window.addEventListener('course-harness-status', sync);
    return () => {
      window.removeEventListener('course-harness-status', sync);
      closePanel();
    };
  }

  /**
   * ④ 课尾「千班千面」实训复盘简报生成 + 单页 HTML 导出归档
   */
  function buildPrintableHtml(report: RecapReportPayload, roleTrack: string) {
    const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c));
    return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>${esc(report.title)}</title>
<style>
  body{margin:0;padding:40px 24px;background:#101612;color:#f3ede0;font:15px/1.7 "Microsoft YaHei",system-ui,sans-serif}
  main{max-width:860px;margin:0 auto;padding:36px;background:#161f19;border:1px solid #d6c39e44;border-radius:12px}
  h1{margin:0 0 8px;color:#f6d99a;font-size:28px}
  .sub{margin:0 0 24px;color:#b8b09f;font-size:14px}
  h2{margin:24px 0 10px;color:#e8c485;font-size:17px;border-bottom:1px solid #d6c39e33;padding-bottom:6px}
  ul{padding-left:20px}
  .grid{display:grid;gap:12px}
  .card{padding:14px 16px;background:#101813;border:1px solid #d6c39e2b;border-left:3px solid #e8c485;border-radius:8px}
  .card strong{display:block;color:#f6e7c6;margin-bottom:4px}
  .card small{display:block;color:#c7b999;margin-bottom:4px}
  footer{margin-top:28px;padding-top:12px;border-top:1px solid #d6c39e2b;font-size:12px;color:#9ea397}
</style>
</head>
<body>
<main>
  <h1>${esc(report.title)}</h1>
  <p class="sub">${esc(report.subtitle)} · 岗位方向：${esc(roleTrack)}</p>
  <p>${esc(report.executiveSummary)}</p>
  <h2>本场查证与推演轨迹</h2>
  <ul>${report.journeyHighlights.map(item => `<li>${esc(item)}</li>`).join('')}</ul>
  <h2>历史抉择对照</h2>
  <p>${esc(report.decisionComparison)}</p>
  <h2>国网一线岗位实战映射</h2>
  <div class="grid">${report.gridMapping.map(item => `<div class="card"><strong>${esc(item.topic)}</strong><small>${esc(item.principle)}</small><div>${esc(item.action)}</div></div>`).join('')}</div>
  <h2>班组后续研讨题</h2>
  <ul>${report.discussionQuestions.map(q => `<li>${esc(q)}</li>`).join('')}</ul>
  <footer>权威出处：${esc(report.citedSources.join(' · '))}</footer>
</main>
</body>
</html>`;
  }

  function mountRecapReportButton(footer: HTMLElement) {
    let selectedRole = '电力调度';
    let lastReport: { report: RecapReportPayload; role: string } | undefined;

    function openReportModal() {
      const wrap = element('div', 'report-sheet');
      const roleBar = element('div', 'harness-presets');
      const roles = ['电力调度', '特高压运维', '配网抢修', '青年班组长'];
      const roleButtons: HTMLButtonElement[] = [];
      for (const role of roles) {
        const btn = control(role, () => {
          selectedRole = role;
          roleButtons.forEach(b => b.setAttribute('aria-pressed', String(b.textContent === role)));
        }, 'harness-chip');
        btn.setAttribute('aria-pressed', String(role === selectedRole));
        roleButtons.push(btn);
        roleBar.append(btn);
      }

      const form = element('form', 'harness-director-form');
      const challengeInput = element('input', 'harness-input');
      challengeInput.type = 'text';
      challengeInput.maxLength = 160;
      challengeInput.placeholder = '可选：输入班组近期真实处置难题，定向映射到简报…';
      challengeInput.setAttribute('aria-label', '班组真实业务难题');
      const genBtn = element('button', 'primary harness-submit', '生成简报');
      genBtn.type = 'submit';
      form.append(challengeInput, genBtn);

      const output = element('div', 'report-output');
      output.setAttribute('aria-live', 'polite');

      function renderReport(report: RecapReportPayload, role: string) {
        output.replaceChildren();
        const header = element('div', 'report-header');
        header.append(
          element('h3', 'report-title', report.title),
          element('p', 'report-sub', report.subtitle),
          element('p', 'report-exec', report.executiveSummary),
        );
        output.append(header);

        if (report.journeyHighlights.length) {
          const sec = element('section', 'report-section');
          sec.append(element('h4', '', '本场查证与推演轨迹'));
          const ul = element('ul', 'report-list');
          for (const h of report.journeyHighlights) ul.append(element('li', '', h));
          sec.append(ul);
          output.append(sec);
        }

        if (report.decisionComparison) {
          const sec = element('section', 'report-section');
          sec.append(
            element('h4', '', '历史抉择对照'),
            element('p', 'report-exec', report.decisionComparison),
          );
          output.append(sec);
        }
        if (report.gridMapping.length) {
          const sec = element('section', 'report-section');
          sec.append(element('h4', '', `国网「${role}」实战映射`));
          const cards = element('div', 'report-cards');
          for (const item of report.gridMapping) {
            const card = element('article', 'report-card');
            card.append(
              element('strong', '', item.topic),
              element('span', 'report-principle', item.principle),
              element('p', '', item.action),
            );
            cards.append(card);
          }
          sec.append(cards);
          output.append(sec);
        }

        if (report.discussionQuestions.length) {
          const sec = element('section', 'report-section');
          sec.append(element('h4', '', '班组后续研讨题'));
          const ul = element('ul', 'report-list');
          for (const q of report.discussionQuestions) ul.append(element('li', '', q));
          sec.append(ul);
          output.append(sec);
        }

        const foot = element('div', 'report-footer');
        if (report.citedSources.length) {
          foot.append(element('cite', 'sandbox-cite', report.citedSources.join(' · ')));
        }
        const exportBtn = control('导出归档 HTML', () => {
          const html = buildPrintableHtml(report, role);
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const href = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = href;
          link.download = `从于都到遵义-实训复盘简报-${role}.html`;
          document.body.append(link);
          link.click();
          link.remove();
          window.setTimeout(() => URL.revokeObjectURL(href), 1500);
        }, 'primary');
        foot.append(exportBtn);
        output.append(foot);
      }

      form.addEventListener('submit', async ev => {
        ev.preventDefault();
        if (genBtn.disabled) return;
        const request = new AbortController();
        const cancel = () => request.abort();
        dialog.addEventListener('close', cancel, { once: true });
        const role = selectedRole;
        genBtn.disabled = true;
        output.replaceChildren(element('p', 'sandbox-loading', '正在综合本场探索与推演轨迹生成复盘简报…'));
        try {
          const res = await postJson<{ ok: true; report: RecapReportPayload }>('/api/course-ai/recap-report', {
            roleTrack: role,
            teamChallenge: challengeInput.value.trim(),
            trace: {
              ...getTrace(),
              revealedCount: revealed.size + lessonItemsSeen.size,
              completedPractices: [...completedPractices],
            },
          }, request.signal);
          if (!wrap.isConnected || request.signal.aborted) return;
          soundscape.playSfx('complete');
          lastReport = { report: res.report, role };
          renderReport(res.report, role);
        } catch (err) {
          if (!wrap.isConnected || request.signal.aborted) return;
          output.replaceChildren(element('p', 'sandbox-error', err instanceof Error ? err.message : '生成简报失败'));
        } finally {
          dialog.removeEventListener('close', cancel);
          genBtn.disabled = false;
        }
      });

      wrap.append(roleBar, form, output);
      if (lastReport) renderReport(lastReport.report, lastReport.role);
      modal('实训复盘简报', wrap);
    }

    const btn = lessonControl('recap-report', '实训复盘简报', openReportModal, 'is-harness', 'layers');
    btn.hidden = !online;
    footer.append(btn);

    const sync = () => { btn.hidden = !online; };
    window.addEventListener('course-harness-status', sync);
    return () => window.removeEventListener('course-harness-status', sync);
  }

  // 启动时静默异步探测：纯离线零请求；在线环境下做轻量退避重探以无缝衔接一键启动器冷启动
  void (async () => {
    if (!gatewayBase) return;
    if (await probe()) return;
    for (const delay of [1000, 2000, 3000, 5000]) {
      await waitFrame(delay);
      if (online) return;
      if (await probe()) return;
    }
  })();

  return {
    isOnline: () => online,
    probe,
    recordVisit,
    resetTrace,
    getTrace,
    restoreTrace,
    setActiveScene(bridge?: ActiveSceneBridge) { activeScene = bridge; },
    mountDirectorTrigger,
    mountDirectorBanner,
    mountLipingSandbox,
    mountZunyiDebate,
    mountRecapReportButton,
  };
})();
