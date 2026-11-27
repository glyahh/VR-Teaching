/**
 * 课堂 AI 网关前端桥接与课页联动。
 * 原则：
 * - 直接打开单文件课件时跳过 AI 网关。
 * - 从一键开课进入并检测到网关后，激活以下功能。
 *   1. 行迹副导（根据文字提出课页动作，确认后执行）
 *   2. 黎平「1934 战地推演沙盘」（SVG 动态假设路径、受阻红区与历史对照）
 *   3. 课尾「千班千面」实训复盘简报生成与单页 HTML 导出归档
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
};

type DirectorExchange = { utterance: string; narration: string };
type DirectorAttachment = { name: string; text: string };
type DirectorCompression = { version: number; turnCount: number };
type DirectorProgress = { type: 'text'; text: string };

type DirectorTurn =
  | { kind: 'idle' }
  | { kind: 'working'; request: AbortController; narration: string }
  | ({ kind: 'reply'; actions: DirectorAction[]; interactionId: string } & DirectorExchange)
  | { kind: 'error'; message: string };

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
};

type RecapReportPayload = {
  title: string;
  subtitle: string;
  executiveSummary: string;
  journeyHighlights: string[];
  decisionComparison: string;
  gridMapping: { topic: string; principle: string; action: string }[];
  discussionQuestions: string[];
};

type CourseSessionTrace = {
  visitedPages: string[];
};

type CourseRoute = 'director' | 'sandbox' | 'zunyi-debate' | 'recap-report';
type CourseEvent = {
  sessionId: string;
  seq: number;
  eventId: string;
  interactionId: string;
  route: CourseRoute;
  kind: 'input' | 'feedback' | 'failed' | 'cancelled' | 'operations' | 'legacy';
  data: Record<string, unknown>;
};
type CourseLedger = {
  version: 1;
  sessionId: string;
  events: CourseEvent[];
  sequence: number;
};

type ActiveSceneBridge = {
  pageTitle: string;
  focusHotspot?: (key: string) => boolean;
  compareLiping?: (side: 'east' | 'west' | 'both') => boolean;
  openTroopRecords?: () => boolean;
  showDirectorBanner?: (text: string) => void;
};

const courseHarness = (() => {
  const params = new URLSearchParams(location.search);
  let gatewayBase = params.get('ai')?.trim().replace(/\/+$/, '') || '';
  let accessToken = new URLSearchParams(location.hash.slice(1)).get('ai-access');

  let online = false;
  let connectionCheck = 0;
  let monitorTimer: number | undefined;
  let monitoring = false;
  let activeScene: ActiveSceneBridge | undefined;
  const directorSessionKey = 'long-march-director-session';
  const ledgerKey = 'long-march-classroom-events';
  let directorSessionId: string | undefined;
  let ledger: CourseLedger | undefined;
  let synced = 0;
  let syncInFlight: Promise<'conflict' | void> | undefined;
  let pendingClear: { sessionId: string; task: Promise<void> } | undefined;
  const backgroundCompaction = new Map<string, Promise<void>>();
  const directorEpochs = new WeakMap<CourseLedger, number>();

  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
  const isRoute = (value: unknown): value is CourseRoute => typeof value === 'string'
    && ['director', 'sandbox', 'zunyi-debate', 'recap-report'].includes(value);
  const isEventKind = (value: unknown): value is CourseEvent['kind'] => typeof value === 'string'
    && ['input', 'feedback', 'failed', 'cancelled', 'operations', 'legacy'].includes(value);

  function getDirectorSessionId() {
    if (directorSessionId) return directorSessionId;
    try {
      const id = sessionStorage.getItem(directorSessionKey);
      if (id && uuid.test(id)) directorSessionId = id;
    } catch (error) { console.warn('[课堂上下文] 无法读取课堂身份。', error); }
    directorSessionId ??= crypto.randomUUID();
    try { sessionStorage.setItem(directorSessionKey, directorSessionId); } catch {}
    return directorSessionId;
  }

  function resetDirectorSession() {
    directorSessionId = crypto.randomUUID();
    ledger = undefined;
    synced = 0;
    syncInFlight = undefined;
    try {
      sessionStorage.setItem(directorSessionKey, directorSessionId);
      sessionStorage.removeItem(ledgerKey);
    } catch (error) { console.warn('[课堂上下文] 无法清除旧会话快照。', error); }
  }

  function getLedger() {
    if (ledger) return ledger;
    const sessionId = getDirectorSessionId();
    let saved: unknown;
    try {
      const stored = sessionStorage.getItem(ledgerKey);
      if (stored) saved = JSON.parse(stored);
    } catch (error) {
      console.warn('[课堂上下文] 无法读取会话快照。', error);
      saved = null;
    }
    ledger = { version: 1, sessionId, events: [], sequence: 0 };
    if (saved === undefined) return ledger;
    if (!object(saved) || saved.version !== 1 || saved.sessionId !== sessionId || !Array.isArray(saved.events)) {
      console.warn('[课堂上下文] 已忽略损坏或不匹配的会话快照。');
      resetDirectorSession();
      ledger = { version: 1, sessionId: getDirectorSessionId(), events: [], sequence: 0 };
      return ledger;
    }
    for (const event of saved.events) {
      if (!object(event) || event.sessionId !== sessionId || typeof event.seq !== 'number'
        || !Number.isSafeInteger(event.seq) || event.seq <= (ledger.events.at(-1)?.seq ?? 0)
        || event.eventId !== `${sessionId}:${event.seq}` || !object(event.data)
        || typeof event.interactionId !== 'string' || !uuid.test(event.interactionId)
        || !isRoute(event.route) || !isEventKind(event.kind)) continue;
      ledger.events.push({ sessionId, seq: event.seq, eventId: event.eventId, route: event.route,
        interactionId: event.interactionId, kind: event.kind, data: event.data });
    }
    ledger.sequence = Math.max(ledger.events.at(-1)?.seq ?? 0,
      typeof saved.sequence === 'number' && Number.isSafeInteger(saved.sequence) ? saved.sequence : 0);
    return ledger;
  }

  function persistLedger(current: CourseLedger) {
    if (ledger !== current) return;
    try {
      sessionStorage.setItem(ledgerKey, JSON.stringify(current));
      if (sessionStorage.getItem(directorSessionKey) !== current.sessionId) {
        sessionStorage.setItem(directorSessionKey, current.sessionId);
      }
    } catch (error) {
      console.warn('[课堂上下文] 浏览器保存失败，本堂课继续使用内存。', error);
      // 快照落后于网关时继续使用同一身份会重用事件顺序号。
      try {
        sessionStorage.removeItem(ledgerKey);
        sessionStorage.removeItem(directorSessionKey);
      } catch (cleanup) { console.warn('[课堂上下文] 无法移除过期快照。', cleanup); }
    }
  }

  function recordEvent(current: CourseLedger, route: CourseRoute, interactionId: string,
    kind: CourseEvent['kind'], data: Record<string, unknown>) {
    if (ledger !== current) return;
    const seq = ++current.sequence;
    current.events.push({ sessionId: current.sessionId, seq, eventId: `${current.sessionId}:${seq}`,
      interactionId, route, kind, data });
    persistLedger(current);
  }

  function recordDeskMaterial(material: DeskObject) {
    if (courseDeskMaterials.has(material)) return;
    recordLessonProgress(courseDeskMaterials, material);
    const current = getLedger();
    recordEvent(current, 'zunyi-debate', crypto.randomUUID(), 'operations',
      { results: [{ action: { type: 'open_desk_object', object: material }, outcome: 'succeeded' }] });
    void syncEvents(current);
  }

  async function syncEvents(current: CourseLedger) {
    if (ledger !== current || !online) return;
    if (syncInFlight) return syncInFlight;
    const work = async () => {
      const deadline = AbortSignal.timeout(2000);
      while (ledger === current && synced < current.events.length) {
        const events = current.events.slice(synced, synced + 8);
        const result = await postJson<{ ok: true; durable: boolean }>('/api/course-ai/context/events',
          { sessionId: current.sessionId, events }, deadline);
        if (ledger !== current) return;
        if (!result.durable) {
          console.warn('[课堂上下文] 网关仅保存到内存，浏览器保留待同步事件。');
          return;
        }
        synced += events.length;
      }
    };
    const task = work().catch(error => {
      if (error?.status === 409) return 'conflict' as const;
      console.warn('[课堂上下文] 同步延后，将在下次交互补传。', error);
    });
    syncInFlight = task;
    const result = await task;
    if (syncInFlight === task) syncInFlight = undefined;
    return result;
  }

  async function courseRequest<T extends object>(route: CourseRoute, payload: Record<string, unknown>,
    signal: AbortSignal, interactionId: string = crypto.randomUUID(),
    onProgress?: (event: DirectorProgress) => void): Promise<T> {
    const current = getLedger();
    const epoch = directorEpochs.get(current) ?? 0;
    const sameTurn = () => ledger === current && (route !== 'director' || (directorEpochs.get(current) ?? 0) === epoch);
    const previous = current.events.slice().reverse().find(event => event.route === route && event.kind === 'feedback');
    const state = {
      page: activeScene?.pageTitle ?? currentView.kind,
      revealed: [...revealed],
      seen: [...lessonItemsSeen],
      visitedPages: [...trace.visitedPages],
      completedPractices: [...completedPractices],
      deskMaterials: [...courseDeskMaterials],
    };
    const { attachments: _attachments, ...recorded } = payload;
    recordEvent(current, route, interactionId, 'input', { ...recorded, page: state.page, previousInteractionId: previous?.interactionId });
    try {
      if (await syncEvents(current) === 'conflict') {
        throw new Error('本机课堂记录与网关不一致。原记录已保留，请重新开课后继续使用 AI。');
      }
      signal.throwIfAborted();
      if (!sameTurn()) throw new DOMException('课堂或对话已更换', 'AbortError');
      const path = `/api/course-ai/${route}`;
      const body = { ...payload, classroom: { sessionId: current.sessionId, interactionId, state } };
      const reply = onProgress ? await streamDirector<T>(path, body, signal, onProgress) : await postJson<T>(path, body, signal);
      signal.throwIfAborted();
      if (!sameTurn()) throw new DOMException('课堂或对话已更换', 'AbortError');
      recordEvent(current, route, interactionId, 'feedback', {
        ...reply, questionId: payload.questionId,
      });
      if (route === 'director' && !signal.aborted) scheduleCompaction(current);
      return reply;
    } catch (error) {
      if (sameTurn()) {
        recordEvent(current, route, interactionId, signal.aborted ? 'cancelled' : 'failed',
          { message: signal.aborted ? '请求已取消' : error instanceof Error ? error.message : '请求失败' });
      }
      throw error;
    } finally {
      void syncEvents(current);
    }
  }

  function scheduleCompaction(current: CourseLedger) {
    const sessionId = current.sessionId;
    const epoch = directorEpochs.get(current) ?? 0;
    const active = () => ledger === current && pendingClear?.sessionId !== sessionId && (directorEpochs.get(current) ?? 0) === epoch;
    const previous = backgroundCompaction.get(sessionId) ?? Promise.resolve();
    const task = previous.then(async () => {
      if (!active()) return;
      await syncEvents(current);
      if (!active()) return;
      const result = await postJson<DirectorCompression & { ok: true }>('/api/course-ai/director/compact',
        { sessionId, through: current.sequence });
      if (active() && result.version > 0) {
        window.dispatchEvent(new CustomEvent('course-director-compressed', { detail: { sessionId, ...result } }));
      }
    }).catch(error => console.warn('[行迹副导] 后台压缩未完成。', error));
    backgroundCompaction.set(sessionId, task);
    void task.finally(() => {
      if (backgroundCompaction.get(sessionId) === task) backgroundCompaction.delete(sessionId);
    });
  }

  function clearDirectorHistory(current: CourseLedger) {
    const sessionId = current.sessionId;
    if (pendingClear?.sessionId === sessionId) return pendingClear.task;
    directorEpochs.set(current, (directorEpochs.get(current) ?? 0) + 1);
    const task = (async () => {
      await syncEvents(current);
      for (let attempt = 0; ; ++attempt) {
        try {
          await postJson('/api/course-ai/director/clear', { sessionId, through: current.sequence });
          break;
        } catch (error) {
          if (!object(error) || error.status !== 409 || attempt >= 4) throw error;
          await new Promise(resolve => window.setTimeout(resolve, 180));
        }
      }
      if (ledger !== current) return;
      await syncInFlight;
      current.events = current.events.filter(event => event.route !== 'director');
      synced = 0;
      persistLedger(current);
    })();
    pendingClear = { sessionId, task };
    const finish = () => {
      if (pendingClear?.task === task) pendingClear = undefined;
    };
    void task.then(finish, finish);
    return task;
  }

  let trace: CourseSessionTrace = { visitedPages: [] };

  function setOnline(connected: boolean) {
    if (online === connected) return;
    online = connected;
    window.dispatchEvent(new CustomEvent('course-harness-status', { detail: { online } }));
  }

  async function probe(base = gatewayBase, token = accessToken) {
    if (!base) return false;
    const check = ++connectionCheck;
    window.clearTimeout(monitorTimer);
    let ready = false;
    try {
      const res = await fetch(`${base}/api/course-ai/ready`, {
        method: 'GET',
        signal: AbortSignal.timeout(1500),
        cache: 'no-store',
        ...(token && { headers: { Authorization: `Bearer ${token}` } }),
      });
      if (res.ok) ready = (await res.json())?.ready === true;
    } catch {}
    if (check !== connectionCheck) return false;
    if (ready) {
      gatewayBase = base;
      accessToken = token;
      monitoring = true;
      setOnline(true);
    } else if (base === gatewayBase && token === accessToken) {
      setOnline(false);
    }
    if (monitoring) monitorTimer = window.setTimeout(() => void probe(), 3000);
    return ready;
  }

  async function postJson<T>(path: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(path.endsWith('/recap-report') ? 65000 : 45000);
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
      throw Object.assign(new Error(data?.message || `服务请求失败 (${res.status})`), { status: res.status });
    }
    return data as T;
  }

  async function* courseStream(path: string, payload: Record<string, unknown>, signal: AbortSignal) {
    const response = await fetch(`${gatewayBase}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json', Accept: 'application/x-ndjson',
        ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
      },
      body: JSON.stringify(payload),
      signal,
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.message || `课堂服务请求失败 (${response.status})`);
    }
    if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
      throw new Error('请重启本机课堂网关，以启用新版副导。');
    }
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += value;
        const lines = buffered.split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const event: unknown = JSON.parse(line);
          if (!object(event)) throw new Error('课堂服务返回了无效的进度。');
          if (event.type === 'error') {
            throw new Error(typeof event.message === 'string' ? event.message : '课堂服务暂不可用。');
          }
          yield event;
        }
        if (buffered.length > 64 * 1024) throw new Error('课堂服务返回了过长的消息。');
      }
      if (buffered.trim()) throw new Error('课堂服务的回复提前中断。');
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }

  async function streamDirector<T extends object>(path: string, body: Record<string, unknown>, signal: AbortSignal,
    onProgress: (event: DirectorProgress) => void): Promise<T> {
    const timeout = AbortSignal.timeout(45000);
    try {
      for await (const event of courseStream(path, body, AbortSignal.any([signal, timeout]))) {
        if (event.type === 'text' && typeof event.text === 'string') onProgress({ type: 'text', text: event.text });
        if (event.type === 'result' && object(event.result) && event.result.ok === true
          && typeof event.result.narration === 'string' && Array.isArray(event.result.actions)) return event.result as T;
      }
    } catch (error) {
      signal.throwIfAborted();
      if (timeout.aborted) throw new Error('AI 响应超时，请重试。');
      throw error;
    }
    throw new Error('AI 回复提前结束，请重试。');
  }

  function recordVisit(pageTitle: string) {
    if (!pageTitle || trace.visitedPages.includes(pageTitle)) return;
    trace.visitedPages.push(pageTitle);
  }

  function resetTrace() {
    trace = { visitedPages: [] };
  }

  function getTrace(): CourseSessionTrace {
    return { visitedPages: [...trace.visitedPages] };
  }

  function restoreTrace(raw: unknown) {
    resetTrace();
    if (!raw || typeof raw !== 'object') return;
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.visitedPages)) {
      trace.visitedPages = obj.visitedPages.filter((x): x is string => typeof x === 'string');
    }
    const current = getLedger();
    if (!current.events.length) {
      for (const [key, route] of [['directorRuns', 'director'], ['sandboxRuns', 'sandbox'], ['zunyiDebates', 'zunyi-debate']] as const) {
        const entries = obj[key];
        if (!Array.isArray(entries)) continue;
        for (const entry of entries.filter(object)) {
          recordEvent(current, route, crypto.randomUUID(), 'legacy', { ...entry, verification: 'unknown' });
        }
      }
    }
  }

  function waitFrame(ms = 160) {
    return new Promise<void>(resolve => window.setTimeout(resolve, ms));
  }

  function executeDirectorActions(actions: DirectorAction[], narration: string) {
    const goTo = (matches: (page: LessonPage) => boolean) => {
      const idx = chapterPages.findIndex(entry => matches(entry.page));
      if (idx >= 0 && (currentView.kind !== 'scene' || currentView.position !== idx)) openScene(idx, 'lesson');
      return idx >= 0 && currentView.kind === 'scene' && currentView.position === idx;
    };
    function execute(action: DirectorAction) {
      if (action.type === 'navigate_page') {
        return goTo(page => page.title === action.pageTitle);
      } else if (action.type === 'compare_liping_routes') {
        return goTo(page => page.activity === 'directions') && activeScene?.compareLiping?.(action.side);
      } else if (action.type === 'focus_hotspot') {
        const {key} = action;
        return goTo(page => page.probes?.some(probe => probe.id === key) === true
          || (['boat', 'plank'].includes(key) && page.activity === 'bridge')
          || (key === 'xiang-reflection' && page.activity === 'troops')) && activeScene?.focusHotspot?.(action.key);
      } else if (action.type === 'open_archive' && action.archiveId === 'troop-records') {
        return goTo(page => page.activity === 'troops') && activeScene?.openTroopRecords?.();
      } else if (action.type === 'open_desk_object') {
        return goTo(page => page.activity === 'materials') && currentDesk?.openObject(action.object);
      } else if (action.type === 'open_review') {
        openReview(Boolean(action.conclusion));
        return currentView.kind === 'review' && currentView.conclusionPage === Boolean(action.conclusion);
      }
      return false;
    }
    const results = actions.map(action => {
      try { return { action, outcome: execute(action) ? 'succeeded' : 'failed' }; }
      catch (error) {
        console.warn('[课堂上下文] 副导操作未能完成。', error);
        return { action, outcome: 'failed' };
      }
    });
    if (narration) activeScene?.showDirectorBanner?.(narration);
    return results;
  }

  function directorActionLabel(action: DirectorAction) {
    switch (action.type) {
      case 'navigate_page':
        return `前往${action.pageTitle}`;
      case 'focus_hotspot': {
        const probe = chapterPages.flatMap(({ page }) => page.probes ?? []).find(({ id }) => id === action.key);
        if (probe) return `查看${probe.label}`;
        if (action.key === 'boat') return '查看浮桥船体';
        if (action.key === 'plank') return '查看浮桥门板';
        return '查看课页线索';
      }
      case 'compare_liping_routes':
        return { east: '查看湘西北路线', west: '查看黔北路线', both: '对照黎平路线' }[action.side];
      case 'open_archive':
        return '查看湘江兵力记录';
      case 'open_desk_object':
        return { journal: '翻看遵义左册', dossier: '翻看遵义右册', map: '查看遵义行军路线图' }[action.object];
      case 'open_review':
        return action.conclusion ? '查看课程结语' : '打开课堂回顾';
    }
  }

  function directorIcon(name: 'send' | 'pin') {
    const paths = {
      send: 'M12 20V4m-6 6 6-6 6 6',
      pin: 'M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 1 1 14 0Zm-4 0a3 3 0 1 0-6 0 3 3 0 0 0 6 0Z',
    };
    const icon = document.createElementNS(svgNamespace, 'svg');
    icon.setAttribute('class', 'icon');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', paths[name]);
    icon.append(path);
    return icon;
  }

  function openDirectorDock(host: HTMLElement, trigger: HTMLButtonElement, onClose: () => void) {
    const sessionId = getLedger().sessionId;
    let loadingHistory = true;
    let clearing = false;
    let hasHistory = false;
    let compression: DirectorCompression = { version: 0, turnCount: 0 };
    let turn: DirectorTurn = { kind: 'idle' };
    const lifetime = new AbortController();
    const dock = element('section', 'harness-director-bar copy-panel');
    dock.id = 'course-director-dock';
    dock.setAttribute('aria-labelledby', 'course-director-title');

    function recordUnconfirmed(reply: Extract<DirectorTurn, { kind: 'reply' }>) {
      if (!reply.actions.length) return;
      const current = getLedger();
      if (current.sessionId !== sessionId) return;
      recordEvent(current, 'director', reply.interactionId, 'operations',
        { results: reply.actions.map(action => ({ action, outcome: 'cancelled' })) });
      void syncEvents(current);
    }

    function close(restoreFocus = false, confirmation = false) {
      if (turn.kind === 'working') turn.request.abort();
      if (!confirmation && !clearing && turn.kind === 'reply') recordUnconfirmed(turn);
      turn = { kind: 'idle' };
      lifetime.abort();
      dock.remove();
      trigger.setAttribute('aria-expanded', 'false');
      onClose();
      if (restoreFocus && trigger.isConnected && !trigger.hidden) trigger.focus({ preventScroll: true });
    }

    const head = element('div', 'harness-director-head');
    const badge = element('h2', 'harness-badge', '行迹副导');
    badge.id = 'course-director-title';
    const headActions = element('div', 'harness-director-head-actions');
    const clearBtn = lessonControl('director-clear', '清空', () => void emptyConversation(), 'harness-mini-btn');
    headActions.append(clearBtn, control('收起', () => close(true), 'harness-mini-btn'));
    head.append(svgIcon('compass'), badge, headActions);

    const chat = element('div', 'harness-director-chat');
    const userLine = element('p', 'harness-director-user');
    const reply = element('div', 'harness-director-reply');
    userLine.dataset.currentMessage = '';
    reply.dataset.currentMessage = '';
    const statusLine = element('p', 'harness-status-line');
    const replyCopy = element('div', 'harness-director-reply-copy');
    replyCopy.append(statusLine);
    reply.append(svgIcon('compass'), replyCopy);
    const actionSlot = element('div', 'harness-director-actions');
    const divider = element('p', 'harness-director-divider', '上下文已经完成压缩');
    divider.setAttribute('role', 'status');
    chat.append(userLine, reply, actionSlot);

    function placeCompression() {
      if (!compression.version || !compression.turnCount) {
        divider.remove();
        return;
      }
      const position = chat.querySelectorAll('.harness-director-reply')[compression.turnCount - 1];
      if (position === reply && turn.kind === 'reply') actionSlot.after(divider);
      else if (position && position !== reply) position.after(divider);
      else divider.remove();
    }

    window.addEventListener('course-director-compressed', event => {
      const { detail } = event as CustomEvent<DirectorCompression & { sessionId: string }>;
      if (detail.sessionId !== sessionId || clearing || detail.version <= compression.version) return;
      const follow = nearLatest();
      compression = detail;
      placeCompression();
      if (follow) chat.scrollTop = chat.scrollHeight;
    }, { signal: lifetime.signal });

    function appendHistory(turns: DirectorExchange[]) {
      const fragment = document.createDocumentFragment();
      for (const { utterance, narration } of turns) {
        const answer = element('div', 'harness-director-reply');
        answer.append(svgIcon('compass'), element('p', 'harness-status-line', narration));
        fragment.append(element('p', 'harness-director-user', utterance), answer);
      }
      userLine.before(fragment);
      if (turns.length) hasHistory = true;
    }

    const quickItems = ['查看湘江兵力', '打开遵义会议桌'];
    const presets = element('div', 'harness-presets');
    const chips = quickItems.map(label => control(label, () => void runUtterance(label), 'harness-chip'));
    presets.append(...chips);

    const form = element('form', 'harness-director-form');
    const composer = element('div', 'harness-director-composer');
    const filePicker = element('input', '');
    filePicker.type = 'file';
    filePicker.accept = '.txt,.md,.csv,.json';
    filePicker.multiple = true;
    filePicker.hidden = true;
    const attachmentsBox = element('div', 'harness-director-attachments');
    const attachmentError = element('p', 'harness-director-file-error');
    attachmentError.setAttribute('role', 'alert');
    attachmentError.hidden = true;
    let attachments: DirectorAttachment[] = [];
    let readingFiles = false;
    const attachBtn = lessonControl('director-attach', '', () => filePicker.click(), 'harness-director-attach', 'plus');
    attachBtn.setAttribute('aria-label', '添加资料');
    attachBtn.title = '添加资料，支持 TXT、Markdown、CSV、JSON';
    const input = element('textarea', 'harness-input');
    input.rows = 1;
    input.maxLength = 240;
    input.placeholder = '输入课堂指令…';
    input.setAttribute('aria-label', '行迹副导指令');
    composer.append(attachBtn, input);
    const submitBtn = element('button', 'primary harness-submit');
    submitBtn.type = 'submit';
    submitBtn.setAttribute('aria-label', '发送课堂指令');
    submitBtn.append(directorIcon('send'));
    form.append(composer, submitBtn);

    function renderAttachments() {
      attachmentsBox.replaceChildren(...attachments.map(file => {
        const chip = element('span', 'harness-director-file');
        const name = element('span', '', file.name);
        name.title = file.name;
        const remove = control('×', () => {
          attachments = attachments.filter(item => item !== file);
          renderAttachments();
        }, '');
        remove.setAttribute('aria-label', `移除 ${file.name}`);
        chip.append(name, remove);
        return chip;
      }));
    }

    filePicker.addEventListener('change', async () => {
      const selected = [...(filePicker.files ?? [])];
      filePicker.value = '';
      if (!selected.length || readingFiles || clearing) return;
      readingFiles = true;
      updateDirectorControls();
      attachmentError.hidden = true;
      try {
        const encode = new TextEncoder();
        const bytes = attachments.reduce((total, file) => total + encode.encode(file.text).length, 0);
        if (attachments.length + selected.length > 3 || selected.reduce((total, file) => total + file.size, bytes) > 4000) {
          throw new Error('每条消息最多添加 3 份资料，合计不超过 4 KB。');
        }
        const next = await Promise.all(selected.map(async file => {
          if (!/\.(txt|md|csv|json)$/i.test(file.name) || file.name.length > 120) throw new Error('请选择 TXT、Markdown、CSV 或 JSON 文件。');
          const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).trim();
          if (!text || text.includes('\0')) throw new Error('请选择含文字的 UTF-8 文件。');
          return { name: file.name, text };
        }));
        if (!lifetime.signal.aborted) {
          attachments.push(...next);
          renderAttachments();
          input.focus({ preventScroll: true });
        }
      } catch (error) {
        if (!lifetime.signal.aborted) {
          attachmentError.textContent = error instanceof TypeError ? '文件无法按 UTF-8 读取。'
            : error instanceof Error ? error.message : '无法打开资料。';
          attachmentError.hidden = false;
        }
      } finally {
        readingFiles = false;
        updateDirectorControls();
      }
    });

    const nearLatest = () => chat.scrollHeight - chat.clientHeight - chat.scrollTop <= 12;

    function renderProgress(working: Extract<DirectorTurn, { kind: 'working' }>) {
      const follow = nearLatest();
      statusLine.textContent = working.narration;
      if (follow) chat.scrollTop = chat.scrollHeight;
    }

    function updateDirectorControls() {
      submitBtn.disabled = loadingHistory || clearing || readingFiles || turn.kind === 'working';
      for (const chip of chips) chip.disabled = submitBtn.disabled;
      attachBtn.disabled = clearing || readingFiles;
      clearBtn.disabled = loadingHistory || clearing || readingFiles || (!hasHistory && turn.kind === 'idle');
    }

    async function emptyConversation() {
      if (clearBtn.disabled) return;
      clearing = true;
      if (turn.kind === 'working') turn.request.abort();
      updateDirectorControls();
      try {
        await clearDirectorHistory(getLedger());
        if (lifetime.signal.aborted) return;
        compression = { version: 0, turnCount: 0 };
        hasHistory = false;
        turn = { kind: 'idle' };
        userLine.textContent = '';
        chat.replaceChildren(userLine, reply, actionSlot);
        input.focus({ preventScroll: true });
      } catch {
        if (!lifetime.signal.aborted) turn = { kind: 'error', message: '清空失败，请重试。' };
      } finally {
        clearing = false;
        if (!lifetime.signal.aborted) renderTurn(true);
      }
    }

    function renderTurn(pinToLatest = false) {
      const follow = pinToLatest || nearLatest();
      dock.dataset.turn = turn.kind;
      chat.hidden = !hasHistory && turn.kind === 'idle';
      userLine.hidden = turn.kind === 'idle' || !userLine.textContent;
      reply.hidden = turn.kind === 'idle';
      updateDirectorControls();
      statusLine.dataset.error = String(turn.kind === 'error');
      actionSlot.replaceChildren();
      switch (turn.kind) {
        case 'idle':
          statusLine.textContent = '';
          break;
        case 'working':
          renderProgress(turn);
          break;
        case 'error':
          statusLine.textContent = turn.message;
          break;
        case 'reply': {
          const proposal = turn;
          const { actions, narration, interactionId } = proposal;
          const action = actions.find(({ type }) => type === 'open_desk_object' || type === 'open_archive')
            ?? actions.find(({ type }) => type === 'navigate_page') ?? actions[0];
          statusLine.textContent = narration || (action ? '可以查看相关内容。' : '请指定要查看的课页或材料。');
          if (!action) break;
          const confirm = lessonControl('director-confirm', '', () => {
            if (clearing || turn !== proposal || !dock.isConnected) return;
            const current = getLedger();
            if (current.sessionId !== sessionId) return;
            close(true, true);
            soundscape.playSfx('route');
            const results = executeDirectorActions(actions, narration);
            recordEvent(current, 'director', interactionId, 'operations', { results });
            void syncEvents(current);
            saveLessonProgress();
          }, 'harness-director-confirm');
          const text = element('span', 'harness-director-action-copy', directorActionLabel(action));
          const accompanying = actions.filter(item => item !== action).map(directorActionLabel);
          if (accompanying.length) text.append(element('small', '', accompanying.join(' · ')));
          confirm.append(directorIcon('pin'), text, svgIcon('arrowRight'));
          actionSlot.append(confirm);
          break;
        }
      }
      placeCompression();
      if (follow) chat.scrollTop = chat.scrollHeight;
    }

    async function runUtterance(text: string) {
      const files = attachments;
      const utterance = text.trim() || (files.length ? '请概述所附资料。' : '');
      if (!utterance || submitBtn.disabled || !dock.isConnected) return;
      if (turn.kind === 'reply') {
        recordUnconfirmed(turn);
        appendHistory([turn]);
      }
      attachments = [];
      renderAttachments();
      attachmentError.hidden = true;
      const request = new AbortController();
      const interactionId = crypto.randomUUID();
      const working: Extract<DirectorTurn, { kind: 'working' }> = { kind: 'working', request, narration: '' };
      turn = working;
      userLine.textContent = utterance;
      userLine.getAnimations().forEach(animation => animation.cancel());
      input.value = '';
      renderTurn(true);
      if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
        userLine.animate([
          { transform: 'translateY(9px) scale(.96)', opacity: .55, offset: 0 },
          { transform: 'translateY(-3px) scale(1.025)', opacity: 1, offset: .55 },
          { transform: 'none', opacity: 1, offset: 1 },
        ], { duration: 290, easing: 'cubic-bezier(.2,.75,.3,1)' });
      }
      try {
        const currentPageTitle = activeScene?.pageTitle
          ?? (currentView.kind === 'review' ? (currentView.conclusionPage ? '全课结论' : '课堂回顾') : '');
        const { narration, actions } = await courseRequest<DirectorResponse>('director', {
          sessionId,
          utterance,
          ...(files.length && { attachments: files, attachmentNames: files.map(file => file.name) }),
          currentView: currentView.kind,
          currentPageTitle,
          revealedKeys: [...revealed],
        }, request.signal, interactionId, event => {
          if (turn !== working || request.signal.aborted || !dock.isConnected) return;
          working.narration = event.text;
          renderProgress(working);
        });
        if (request.signal.aborted || !dock.isConnected) return;
        turn = { kind: 'reply', utterance, narration, actions, interactionId };
      } catch (err) {
        if (request.signal.aborted || !dock.isConnected) return;
        turn = { kind: 'error', message: err instanceof Error ? err.message : '课堂指令发送失败，请重试。' };
        if (!input.value) input.value = utterance;
        if (!attachments.length) {
          attachments = files;
          renderAttachments();
        }
      }
      renderTurn();
    }

    async function loadHistory() {
      try {
        if (pendingClear?.sessionId === sessionId) await pendingClear.task.catch(() => {});
        const { turns, compressionVersion, compressionTurnCount } = await postJson<{
          ok: true; turns: DirectorExchange[]; compressionVersion?: number; compressionTurnCount?: number;
        }>(
          '/api/course-ai/director/history', { sessionId }, lifetime.signal,
        );
        if (lifetime.signal.aborted) return;
        appendHistory(turns);
        if ((compressionVersion ?? 0) > compression.version) {
          compression = { version: compressionVersion ?? 0, turnCount: compressionTurnCount ?? 0 };
        }
      } catch {
        if (lifetime.signal.aborted) return;
        turn = { kind: 'error', message: '无法读取之前的对话，请收起副导后重试。' };
      }
      loadingHistory = false;
      renderTurn(true);
    }

    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      form.requestSubmit();
    });
    form.addEventListener('submit', ev => {
      ev.preventDefault();
      void runUtterance(input.value);
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || event.defaultPrevented || dialog.open) return;
      event.preventDefault();
      close(true);
    }, { capture: true, signal: lifetime.signal });

    dock.append(head, chat, presets, attachmentsBox, attachmentError, form, filePicker);
    host.append(dock);
    trigger.setAttribute('aria-expanded', 'true');
    renderTurn();
    input.focus({ preventScroll: true });
    void loadHistory();
    return close;
  }

  function mountDirectorTrigger(view: HTMLElement, tools: HTMLElement) {
    let closeDock: ((restoreFocus?: boolean) => void) | undefined;
    const btn = lessonControl('ai-director', '行迹副导', () => {
      if (closeDock) {
        closeDock(true);
        return;
      }
      if (!online || !view.contains(tools)) return;
      closeDock = openDirectorDock(tools, btn, () => { closeDock = undefined; });
    }, 'harness-director-btn', 'compass');
    btn.hidden = !online;
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'course-director-dock');
    tools.prepend(btn);
    const sync = () => {
      btn.hidden = !online;
      if (!online) closeDock?.();
    };
    window.addEventListener('course-harness-status', sync);
    return () => {
      window.removeEventListener('course-harness-status', sync);
      closeDock?.();
    };
  }

  function mountDirectorBanner(stage: HTMLElement) {
    const banner = element('aside', 'harness-director-banner');
    banner.hidden = true;
    const textNode = element('p', 'harness-director-banner-text');
    const dismiss = control('关闭', () => { banner.hidden = true; }, 'harness-mini-btn');
    const body = element('div', 'harness-director-banner-body');
    body.append(textNode);
    banner.append(body, dismiss);
    stage.append(banner);
    let hideTimer = 0;
    return {
      show(text: string) {
        window.clearTimeout(hideTimer);
        textNode.textContent = text;
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
    onRestoreRealRoute: () => boolean;
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
    let lastSimulation: { response: SandboxResponse; interactionId: string } | undefined;

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
      const restoreBtn = control('对照真实历史抉择 · 转向黔北', () => {
        const simulation = lastSimulation;
        lastSimulation = undefined;
        resultBox.hidden = true;
        closePanel();
        const succeeded = opts.onRestoreRealRoute();
        if (simulation) {
          const current = getLedger();
          recordEvent(current, 'sandbox', simulation.interactionId, 'operations',
            { results: [{ action: { type: 'compare_liping_routes', side: 'west' }, outcome: succeeded ? 'succeeded' : 'failed' }] });
          void syncEvents(current);
        }
      }, 'primary sandbox-restore-btn', 'compass');
      resultBox.append(tag, title, outcome, contrast);
      resultBox.append(restoreBtn);
    }

    async function runProposal(proposal: string) {
      const clean = proposal.trim();
      if (!clean || pending || panel.hidden) return;
      const request = pending = new AbortController();
      const interactionId = crypto.randomUUID();
      runBtn.disabled = true;
      clearOverlay();
      lastSimulation = undefined;
      resultBox.hidden = false;
      resultBox.replaceChildren(element('p', 'sandbox-loading', '正在结合 1934 年敌我态势进行沙盘推演…'));
      try {
        const res = await courseRequest<SandboxResponse>('sandbox', {
          theater: 'liping',
          proposal: clean,
          classification: 'hypothesis',
        }, request.signal, interactionId);
        if (request.signal.aborted) return;
        saveLessonProgress();
        soundscape.playSfx('route');
        lastSimulation = { response: res, interactionId };
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
        if (lastSimulation) paintSimulation(lastSimulation.response);
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
   * ③ 课尾「千班千面」实训复盘简报生成 + 单页 HTML 导出归档
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
</main>
</body>
</html>`;
  }

  function mountRecapReportButton(footer: HTMLElement) {
    let selectedRole = '电力调度';
    let lastReport: { report: RecapReportPayload; role: string } | undefined;
    let reportSheet: HTMLElement | undefined;

    function openReportModal() {
      const wrap = element('div', 'report-sheet');
      reportSheet = wrap;
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
          const res = await courseRequest<{ ok: true; report: RecapReportPayload }>('recap-report', {
            roleTrack: role,
            teamChallenge: challengeInput.value.trim(),
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

    const sync = () => {
      btn.hidden = !online;
      if (!online && reportSheet?.isConnected && dialog.contains(reportSheet)) dialog.close();
    };
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
    recordDeskMaterial,
    resetTrace,
    resetDirectorSession,
    getTrace,
    restoreTrace,
    setActiveScene(bridge?: ActiveSceneBridge) { activeScene = bridge; },
    mountDirectorTrigger,
    mountDirectorBanner,
    mountLipingSandbox,
    mountRecapReportButton,
  };
})();
