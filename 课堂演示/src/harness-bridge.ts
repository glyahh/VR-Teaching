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
  sourceIds?: string[];
};

type SandboxAttachment = { name: string; text: string };
type SandboxHistoryExchange = {
  id?: string;
  proposal: string;
  narration: string;
  plan: SandboxScenePlan;
  sourceIds?: string[];
};
type SandboxHistoryState = {
  turns: SandboxHistoryExchange[];
  compressionVersion: number;
  compressionTurnCount: number;
};
type SandboxTurnRequestPayload = {
  sessionId: string;
  proposal: string;
  attachments?: SandboxAttachment[];
  mapContext: SandboxTurnContext;
};
type SandboxTurnReply = {
  plan: SandboxScenePlan;
  narration: string;
  sourceIds: string[];
  interactionId: string;
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
  const sandboxCompaction = new Map<string, Promise<void>>();
  const directorEpochs = new WeakMap<CourseLedger, number>();
  const sandboxEpochs = new WeakMap<CourseLedger, number>();

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

  function buildClassroomState() {
    const page = activeScene?.pageTitle ?? (currentView.kind === 'sandbox' ? '黎平战地沙盘' : currentView.kind);
    return {
      page,
      revealed: [...revealed],
      seen: [...lessonItemsSeen],
      visitedPages: [...trace.visitedPages],
      completedPractices: [...completedPractices],
      deskMaterials: [...courseDeskMaterials],
    };
  }

  async function courseRequest<T extends object>(route: CourseRoute, payload: Record<string, unknown>,
    signal: AbortSignal, interactionId: string = crypto.randomUUID(),
    onProgress?: (event: DirectorProgress) => void): Promise<T> {
    const current = getLedger();
    const epoch = directorEpochs.get(current) ?? 0;
    const sameTurn = () => ledger === current && (route !== 'director' || (directorEpochs.get(current) ?? 0) === epoch);
    const previous = current.events.slice().reverse().find(event => event.route === route && event.kind === 'feedback');
    const state = buildClassroomState();
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

  async function* readNdjsonResponse(response: Response) {
    if (!response.body) throw new Error('课堂服务的回复提前中断。');
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
    yield* readNdjsonResponse(response);
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
   * ② 黎平「进军方向」居中沙盘入口与前向兼容三维沙盘 AI 客户端
   */
  const sandboxChatStorageKey = 'long-march-sandbox-chat';
  const sandboxLipingOrigin: GeoPoint = [109.14, 26.23];
  const sandboxLandmarkCatalog: readonly { keys: readonly string[]; name: string; point: GeoPoint; risk: 'blockade' | 'weak' | 'neutral' }[] = [
    { keys: ['遵义南翼', '遵义南'], name: '遵义南翼', point: [106.95, 27.48], risk: 'weak' },
    { keys: ['遵义'], name: '遵义', point: [106.93, 27.69], risk: 'weak' },
    { keys: ['乌江'], name: '乌江', point: [107.47, 27.32], risk: 'weak' },
    { keys: ['猴场', '瓮安'], name: '猴场', point: [107.47, 27.07], risk: 'weak' },
    { keys: ['黔北', '贵州北部', '贵州'], name: '黔北', point: [107.68, 27.15], risk: 'weak' },
    { keys: ['施秉'], name: '施秉', point: [108.12, 27.03], risk: 'weak' },
    { keys: ['黄平'], name: '黄平', point: [107.90, 26.90], risk: 'weak' },
    { keys: ['镇远'], name: '镇远', point: [108.42, 27.05], risk: 'weak' },
    { keys: ['凯里'], name: '凯里', point: [107.98, 26.58], risk: 'weak' },
    { keys: ['独山'], name: '独山', point: [107.54, 25.83], risk: 'weak' },
    { keys: ['榕江'], name: '榕江', point: [108.52, 25.93], risk: 'weak' },
    { keys: ['从江'], name: '从江', point: [108.91, 25.75], risk: 'weak' },
    { keys: ['锦屏'], name: '锦屏', point: [109.20, 26.67], risk: 'neutral' },
    { keys: ['清水江'], name: '清水江', point: [108.95, 26.78], risk: 'neutral' },
    { keys: ['通道'], name: '通道', point: [109.63, 26.32], risk: 'blockade' },
    { keys: ['靖县'], name: '靖县', point: [109.69, 26.58], risk: 'blockade' },
    { keys: ['怀化'], name: '怀化', point: [110.00, 27.56], risk: 'blockade' },
    { keys: ['沅陵'], name: '沅陵', point: [110.39, 28.45], risk: 'blockade' },
    { keys: ['永顺'], name: '永顺', point: [109.85, 29.00], risk: 'blockade' },
    { keys: ['桑植'], name: '桑植', point: [110.16, 29.40], risk: 'blockade' },
    { keys: ['湘西北', '湘西', '湖南', '二六军团', '会合'], name: '湘西北', point: [110.18, 28.28], risk: 'blockade' },
    { keys: ['湘江', '全州', '兴安'], name: '湘江', point: [110.73, 25.83], risk: 'blockade' },
    { keys: ['桂林', '桂北', '广西'], name: '桂林', point: [110.29, 25.27], risk: 'blockade' },
    { keys: ['黎平'], name: '黎平', point: [109.14, 26.23], risk: 'neutral' },
  ];
  const sandboxOobCatalog: readonly { pattern: RegExp; target: GeoPoint; title: string; note: string }[] = [
    {
      pattern: /印度|西藏|缅甸|拉萨|喜马拉雅/,
      target: [84.0, 27.2],
      title: '向西南方向超图幅远征推演',
      note: '所指方向超出湘桂黔战区西界，西侧横断山脉与高山深谷阻隔、缺乏补给与根据地依托，推演截停于战区西缘。',
    },
    {
      pattern: /新疆|青海|甘肃|宁夏/,
      target: [94.0, 35.5],
      title: '向西北方向超图幅机动推演',
      note: '所指方向超出战区西北边界，远距穿插缺乏前沿粮弹接应与立足依托，推演截停于西北缘边界。',
    },
    {
      pattern: /北京|华北|东北|沈阳|哈尔滨/,
      target: [116.4, 38.0],
      title: '向正北方向超图幅远征推演',
      note: '所指方向超出战区北界，沿途需强穿多道敌军封锁防线且补给线过长，推演截停于战区北缘。',
    },
    {
      pattern: /太平洋|上海|南京|东海|浙江|福建/,
      target: [124.5, 29.5],
      title: '向正东方向超图幅突进推演',
      note: '所指方向超出战区东界，东向直入敌军重兵腹地与沿海防线，兵力悬殊，推演截停于战区东缘。',
    },
    {
      pattern: /南海|广东|广州|海南/,
      target: [113.5, 20.5],
      title: '向正南方向超图幅机动推演',
      note: '所指方向超出战区南界，南下回旋空间受限且直面粤桂重兵堵截，推演截停于战区南缘。',
    },
  ];

  function roundGeo3(value: number) {
    return Math.round(value * 1000) / 1000;
  }

  function sampleCompactWaypoints(points: GeoPoint[], maxPoints = 6): GeoPoint[] {
    if (points.length <= maxPoints) return points.map(([lon, lat]) => [roundGeo3(lon), roundGeo3(lat)]);
    const sampled: GeoPoint[] = [];
    for (let i = 0; i < maxPoints; i++) {
      const idx = i === maxPoints - 1 ? points.length - 1 : Math.floor(i * (points.length - 1) / (maxPoints - 1));
      sampled.push([roundGeo3(points[idx][0]), roundGeo3(points[idx][1])]);
    }
    return sampled;
  }

  function compactSandboxMapContext(ctx: SandboxTurnContext): SandboxTurnContext {
    const trim = (s: string, max: number) => s.trim().slice(0, max);
    const compacted: SandboxTurnContext = {
      revision: Number.isSafeInteger(ctx.revision) ? ctx.revision : 0,
      isInitial: Boolean(ctx.isInitial),
      actionSinceLastTurn: ctx.actionSinceLastTurn === 'rolled_back' || ctx.actionSinceLastTurn === 'restored'
        ? ctx.actionSinceLastTurn : 'continue',
      activeSummary: trim(ctx.activeSummary || '', 220),
      activeRoutes: (Array.isArray(ctx.activeRoutes) ? ctx.activeRoutes : []).slice(0, 4).map(route => ({
        label: trim(String(route.label || ''), 18),
        role: trim(String(route.role || ''), 16),
        waypoints: sampleCompactWaypoints(Array.isArray(route.waypoints) ? route.waypoints : [], 6),
      })),
      activeZones: (Array.isArray(ctx.activeZones) ? ctx.activeZones : []).slice(0, 4).map(zone => ({
        label: trim(String(zone.label || ''), 18),
        center: [roundGeo3(zone.center?.[0] ?? sandboxLipingOrigin[0]), roundGeo3(zone.center?.[1] ?? sandboxLipingOrigin[1])],
        kind: trim(String(zone.kind || ''), 16),
      })),
    };
    const encoder = new TextEncoder();
    while (encoder.encode(JSON.stringify(compacted)).length > 2500
      && (compacted.activeRoutes.length > 0 || compacted.activeZones.length > 0)) {
      if (compacted.activeZones.length > 0) compacted.activeZones.pop();
      else compacted.activeRoutes.pop();
    }
    return compacted;
  }

  function readSandboxChatMirror(sessionId: string): SandboxHistoryState {
    const empty: SandboxHistoryState = { turns: [], compressionVersion: 0, compressionTurnCount: 0 };
    try {
      const raw = sessionStorage.getItem(sandboxChatStorageKey);
      if (!raw) return empty;
      const parsed = JSON.parse(raw) as unknown;
      if (!object(parsed) || parsed.version !== 1 || parsed.sessionId !== sessionId || !Array.isArray(parsed.turns)) {
        return empty;
      }
      const turns: SandboxHistoryExchange[] = [];
      for (const entry of parsed.turns) {
        if (!object(entry) || typeof entry.proposal !== 'string' || typeof entry.narration !== 'string') continue;
        turns.push({
          ...(typeof entry.id === 'string' && uuid.test(entry.id) ? { id: entry.id } : {}),
          proposal: entry.proposal,
          narration: entry.narration,
          plan: sanitizeSandboxScenePlan(entry.plan),
          ...(Array.isArray(entry.sourceIds) ? { sourceIds: entry.sourceIds.filter((s): s is string => typeof s === 'string') } : {}),
        });
      }
      return {
        turns: turns.slice(-24),
        compressionVersion: typeof parsed.compressionVersion === 'number' && Number.isSafeInteger(parsed.compressionVersion)
          ? parsed.compressionVersion : 0,
        compressionTurnCount: typeof parsed.compressionTurnCount === 'number' && Number.isSafeInteger(parsed.compressionTurnCount)
          ? parsed.compressionTurnCount : 0,
      };
    } catch {
      return empty;
    }
  }

  function writeSandboxChatMirror(sessionId: string, state: SandboxHistoryState) {
    try {
      sessionStorage.setItem(sandboxChatStorageKey, JSON.stringify({
        version: 1,
        sessionId,
        turns: state.turns.slice(-24),
        compressionVersion: state.compressionVersion,
        compressionTurnCount: state.compressionTurnCount,
      }));
    } catch {}
  }

  function resetSandboxLedgerView(current: CourseLedger) {
    current.events = current.events.filter(event => event.route !== 'sandbox');
    synced = 0;
    persistLedger(current);
  }

  function matchProposalLandmarks(proposal: string) {
    const hits: { index: number; name: string; point: GeoPoint; risk: 'blockade' | 'weak' | 'neutral' }[] = [];
    const seen = new Set<string>();
    for (const entry of sandboxLandmarkCatalog) {
      let earliest = -1;
      for (const key of entry.keys) {
        const pos = proposal.indexOf(key);
        if (pos >= 0 && (earliest < 0 || pos < earliest)) earliest = pos;
      }
      if (earliest >= 0 && !seen.has(entry.name)) {
        seen.add(entry.name);
        hits.push({ index: earliest, name: entry.name, point: entry.point, risk: entry.risk });
      }
    }
    return hits.sort((a, b) => a.index - b.index);
  }

  function computeSandboxCameraForPoints(points: GeoPoint[], defaultTilt = 35): SandboxCameraCue {
    if (!points.length) return { center: [108.9, 26.75], zoom: 1.55, azimuth: -10, tilt: defaultTilt };
    let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
    for (const [lon, lat] of points) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    const cx = Math.max(105.2, Math.min(117.6, (minLon + maxLon) / 2));
    const cy = Math.max(24.3, Math.min(30.1, (minLat + maxLat) / 2));
    const span = Math.max(maxLon - minLon, (maxLat - minLat) * 1.4, 0.7);
    const zoom = Math.max(1.12, Math.min(2.05, 2.55 - span * 0.32));
    const azimuth = cx < 108.4 ? -14 : cx > 109.8 ? 10 : -8;
    return { center: [roundGeo3(cx), roundGeo3(cy)], zoom: Math.round(zoom * 100) / 100, azimuth, tilt: defaultTilt };
  }

  function adaptLegacySandboxResponse(
    res: SandboxResponse,
    proposal: string,
    mapContext: SandboxTurnContext
  ): SandboxScenePlan {
    const clean = proposal.trim();
    const hits = matchProposalLandmarks(clean);
    const isFollowUp = !mapContext.isInitial && mapContext.activeRoutes.length > 0
      && /继续|再|改道|折向|刚才|随后|接着|然后|下一步|延伸/.test(clean)
      && !/黎平|重新/.test(clean);
    const priorMainRoute = mapContext.activeRoutes.find(r => r.role === 'main' || r.role === 'flank')
      ?? mapContext.activeRoutes[0];
    const priorEnd = priorMainRoute?.waypoints.at(-1);
    const startPoint: GeoPoint = isFollowUp && priorEnd ? priorEnd : sandboxLipingOrigin;
    const retainedPriorPhase = (isFollowUp && priorMainRoute && priorMainRoute.waypoints.length >= 2)
      ? [{
        id: 'prior-leg',
        role: (priorMainRoute.role === 'flank' ? 'flank' : 'main') as SandboxForcePath['role'],
        label: priorMainRoute.label.slice(0, 14) || '前期推进',
        waypoints: priorMainRoute.waypoints.slice(-6),
        phase: 0,
        style: 'solid-gold' as const,
        outcome: 'advance' as const,
      }] : [];

    const historicalContrast = (res.historicalContrast || '').trim()
      || '黎平会议果断放弃北上湘西北原计划，决定转向敌军防备薄弱的贵州北部，为战略转折争取了宝贵空间。';
    const baseOutcome = (res.battlefieldOutcome || '').trim();
    const oobMatch = sandboxOobCatalog.find(item => item.pattern.test(clean));

    if (oobMatch) {
      const mid: GeoPoint = [
        roundGeo3((startPoint[0] + oobMatch.target[0]) / 2),
        roundGeo3((startPoint[1] + oobMatch.target[1]) / 2),
      ];
      const compatibleOutcome = baseOutcome && !/湘西北|口袋阵/.test(baseOutcome)
        ? baseOutcome
        : '远距穿插缺乏前沿粮弹接应与群众根据地依托，孤军拉长战线后极易陷入高山深谷或外围阻击阵地。';
      return sanitizeSandboxScenePlan({
        mode: 'simulate',
        title: oobMatch.title,
        analysis: compatibleOutcome,
        riskLevel: 'critical',
        historicalContrast,
        outOfBoundsNote: oobMatch.note,
        camera: computeSandboxCameraForPoints([startPoint, mid], 32),
        phases: [{
          caption: '超图幅边际约束',
          durationMs: 1400,
          redForces: [{
            id: 'oob-main', role: 'main', label: oobMatch.title.slice(0, 14),
            waypoints: [startPoint, oobMatch.target], phase: 0, style: 'dashed-vermilion', outcome: 'blocked',
          }],
          enemyForces: [{
            id: 'oob-enemy', label: '外围重兵阻击', from: [110.15, 27.65], to: startPoint, phase: 0, posture: 'intercept',
          }],
          zones: [{ id: 'oob-zone', label: '战区边际受阻', center: startPoint, radiusDeg: 0.45, kind: 'enemy-blockade', phase: 0 }],
          pins: [{ label: '边界受阻', point: startPoint, tone: 'vermilion', phase: 0 }],
        }],
        citedSourceIds: Array.isArray(res.sourceIds) ? res.sourceIds : [],
      });
    }

    const isHold = /固守|休整|原地|不动|驻扎|待机|防御/.test(clean)
      && !/西进|北上|绕道|分兵|佯攻|直插|前往/.test(clean);
    if (isHold) {
      const holdCenter = hits.find(h => h.name !== '黎平')?.point ?? sandboxLipingOrigin;
      const analysis = /湘西北/.test(baseOutcome)
        ? `若在黎平周边原地固守休整，渡过湘江后的疲惫主力将在原地滞留，给湘、桂、黔三路敌军合拢时间窗口，外线机动优势迅速丧失。`
        : (baseOutcome || '原地固守休整虽可短暂喘息，但将给敌军留出合围布防的时间窗口，主力易在黎平周边陷入被动。');
      return sanitizeSandboxScenePlan({
        mode: 'simulate',
        title: '黎平原地固守待机推演',
        analysis,
        riskLevel: 'high',
        historicalContrast,
        camera: computeSandboxCameraForPoints([holdCenter, [109.63, 26.32], [108.52, 25.93]], 37),
        phases: [
          {
            caption: '黎平集结布防',
            durationMs: 1050,
            redForces: [{
              id: 'hold-rally', role: 'hold', label: '黎平待机防线',
              waypoints: [holdCenter, [roundGeo3(holdCenter[0] - 0.14), roundGeo3(holdCenter[1] + 0.08)]],
              phase: 0, style: 'dotted-slate', outcome: 'stalled',
            }],
            enemyForces: [],
            zones: [{ id: 'hold-zone', label: '原地固守区', center: holdCenter, radiusDeg: 0.34, kind: 'rally', phase: 0 }],
            pins: [{ label: '原地待机', point: holdCenter, tone: 'neutral', phase: 0 }],
          },
          {
            caption: '敌军合围压缩',
            durationMs: 1350,
            redForces: [{
              id: 'hold-rally-2', role: 'hold', label: '黎平滞留受压',
              waypoints: [holdCenter, [roundGeo3(holdCenter[0] - 0.14), roundGeo3(holdCenter[1] + 0.08)]],
              phase: 1, style: 'dotted-slate', outcome: 'stalled',
            }],
            enemyForces: [
              { id: 'enc-ne', label: '湘敌东线压缩', from: [110.00, 27.56], to: [109.32, 26.44], phase: 1, posture: 'encircle' },
              { id: 'enc-e', label: '通道驻军逼近', from: [109.69, 26.58], to: [109.30, 26.28], phase: 1, posture: 'encircle' },
              { id: 'enc-se', label: '桂北敌军北堵', from: [110.29, 25.27], to: [109.26, 26.05], phase: 1, posture: 'encircle' },
            ],
            zones: [{ id: 'hold-press', label: '周边封锁收紧', center: [109.42, 26.38], radiusDeg: 0.42, kind: 'enemy-blockade', phase: 1 }],
            pins: [{ label: '窗口收窄', point: [109.42, 26.38], tone: 'vermilion', phase: 1 }],
          },
        ],
        citedSourceIds: Array.isArray(res.sourceIds) ? res.sourceIds : [],
      });
    }

    const isSplitFeint = /分兵|佯攻|牵制|诱敌|两路|牵扯/.test(clean);
    if (isSplitFeint) {
      const feintTargets = hits.filter(h => h.risk === 'blockade');
      const mainTargets = hits.filter(h => h.name !== '黎平' && h.risk !== 'blockade');
      const feintTarget = feintTargets[0]?.point ?? [109.63, 26.32];
      const feintLabel = feintTargets[0]?.name ? `佯攻${feintTargets[0].name}` : '通道佯攻分队';
      const defaultMain: GeoPoint[] = /西南|榕江/.test(clean)
        ? [[108.52, 25.93], [107.98, 26.58]]
        : [[108.52, 25.93], [107.90, 26.90], [107.47, 27.07]];
      const mainWaypoints: GeoPoint[] = mainTargets.length
        ? [startPoint, ...mainTargets.map(t => t.point)]
        : [startPoint, ...defaultMain];
      const mainDestName = mainTargets.at(-1)?.name ?? (/西南|榕江/.test(clean) ? '榕江西南' : '黔北猴场');
      const mainBlocked = !mainTargets.length && feintTargets.length > 1;
      const allPts = [startPoint, feintTarget, ...mainWaypoints];
      const analysis = !/贵州|黔北|榕江|猴场|乌江|遵义|镇远/.test(clean) && /北上/.test(clean)
        ? (baseOutcome || '分兵佯攻牵制通道湘敌后，受限于兵力减员，北上湘西北主力仍面临重兵纵深堵截，难以改变兵力悬殊格局。')
        : `先遣分队${feintLabel}牵制湘敌重兵，主力随即西向${mainDestName}兵力薄弱区穿插转移，主动避开湘西北重兵口袋阵。`;
      return sanitizeSandboxScenePlan({
        mode: 'simulate',
        title: `分兵牵制与主力${mainBlocked ? '受阻' : '西进'}${mainDestName}`.slice(0, 24),
        analysis,
        riskLevel: mainBlocked ? 'high' : 'viable',
        historicalContrast,
        camera: computeSandboxCameraForPoints(allPts, 34),
        phases: [
          {
            caption: `${feintLabel}牵制湘敌`,
            durationMs: 1150,
            redForces: [{
              id: 'feint-force', role: 'feint', label: feintLabel.slice(0, 14),
              waypoints: [startPoint, feintTarget], phase: 0, style: 'dashed-vermilion', outcome: 'blocked',
            }],
            enemyForces: [{
              id: 'enemy-drawn', label: '湘敌被牵制南调', from: [110.00, 27.56], to: feintTarget, phase: 0, posture: 'intercept',
            }],
            zones: [{ id: 'feint-zone', label: '牵制交火区', center: feintTarget, radiusDeg: 0.35, kind: 'enemy-blockade', phase: 0 }],
            pins: [{ label: feintTargets[0]?.name ?? '通道', point: feintTarget, tone: 'vermilion', phase: 0 }],
          },
          {
            caption: `主力转进${mainDestName}`,
            durationMs: 1400,
            redForces: [
              {
                id: 'feint-hold', role: 'feint', label: feintLabel.slice(0, 14),
                waypoints: [startPoint, feintTarget], phase: 1, style: 'dashed-vermilion', outcome: 'stalled',
              },
              {
                id: 'main-west', role: 'main', label: `主力转进${mainDestName}`.slice(0, 14),
                waypoints: mainWaypoints, phase: 1, style: 'solid-gold', outcome: mainBlocked ? 'blocked' : 'breakthrough',
              },
            ],
            enemyForces: [],
            zones: [{
              id: 'weak-corridor', label: '黔北薄弱走廊', center: mainWaypoints.at(-1)!,
              radiusDeg: 0.48, kind: mainBlocked ? 'enemy-blockade' : 'weak-gap', phase: 1,
            }],
            pins: [{ label: mainDestName, point: mainWaypoints.at(-1)!, tone: 'gold', phase: 1 }],
          },
        ],
        citedSourceIds: Array.isArray(res.sourceIds) ? res.sourceIds : [],
      });
    }

    const targets = hits.filter(h => !(h.name === '黎平' && !isFollowUp && hits.length > 1));
    if (targets.length > 0) {
      const dest = targets[targets.length - 1];
      const touchesBlockade = targets.some(t => t.risk === 'blockade');
      const waypoints: GeoPoint[] = [startPoint, ...targets.map(t => t.point)];
      if (waypoints.length === 1) waypoints.push(dest.point);
      const routeNames = targets.map(t => t.name).join('→');
      const title = `${isFollowUp ? '续进' : '转向'}${routeNames}`.slice(0, 24);
      const analysis = touchesBlockade
        ? (baseOutcome && /湘|重兵|堵截|封锁/.test(baseOutcome)
          ? baseOutcome
          : `沿${routeNames}一线推进直接撞入湘西北与通道重兵布防纵深，渡江后主力兵力受限，极易遭到前沿拦截与侧翼合围。`)
        : (baseOutcome && /黔|贵州|乌江|遵义|薄弱/.test(baseOutcome)
          ? baseOutcome
          : `沿${routeNames}一线穿插敌军兵力相对薄弱的黔东南至黔北腹地，避开了湘西北重兵封锁带，为后续展开赢得机动主动。`);
      const enemyVectors: SandboxEnemyVector[] = touchesBlockade
        ? [
          { id: 'blk-1', label: '湘西北主力拦截', from: [110.16, 29.40], to: dest.point, phase: retainedPriorPhase.length ? 1 : 0, posture: 'intercept' },
          { id: 'blk-2', label: '湘中重兵侧击', from: [110.73, 25.83], to: waypoints[Math.min(1, waypoints.length - 1)], phase: retainedPriorPhase.length ? 1 : 0, posture: 'encircle' },
        ]
        : [
          { id: 'chase-1', label: '湘敌东线尾追', from: [110.00, 27.56], to: [109.25, 26.65], phase: retainedPriorPhase.length ? 1 : 0, posture: 'intercept' },
        ];
      const activePhaseIndex = retainedPriorPhase.length ? 1 : 0;
      const phases: SandboxScenePlan['phases'] = [
        ...(retainedPriorPhase.length ? [{
          caption: '承接前序进军态势',
          durationMs: 950,
          redForces: retainedPriorPhase,
          enemyForces: [],
          zones: [],
          pins: [],
        }] : []),
        {
          caption: title.slice(0, 20),
          durationMs: 1450,
          redForces: [{
            id: 'directed-main',
            role: 'main',
            label: title.slice(0, 14),
            waypoints,
            phase: activePhaseIndex,
            style: touchesBlockade ? 'dashed-vermilion' : 'solid-gold',
            outcome: touchesBlockade ? 'blocked' : 'breakthrough',
          }],
          enemyForces: enemyVectors,
          zones: [{
            id: 'directed-zone',
            label: touchesBlockade ? '敌军重兵拦截区' : '敌军防备薄弱带',
            center: dest.point,
            radiusDeg: touchesBlockade ? 0.56 : 0.45,
            kind: touchesBlockade ? 'enemy-blockade' : 'weak-gap',
            phase: activePhaseIndex,
          }],
          pins: targets.slice(0, 4).map(t => ({
            label: t.name,
            point: t.point,
            tone: (t.risk === 'blockade' ? 'vermilion' : 'gold') as 'vermilion' | 'gold',
            phase: activePhaseIndex,
          })),
        },
      ];
      return sanitizeSandboxScenePlan({
        mode: 'simulate',
        title,
        analysis,
        riskLevel: touchesBlockade ? 'critical' : 'viable',
        historicalContrast,
        camera: computeSandboxCameraForPoints(waypoints, 35),
        phases,
        citedSourceIds: Array.isArray(res.sourceIds) ? res.sourceIds : [],
      });
    }

    const isExplainQuestion = /[？?]|为什么|为何|怎么看|如何评价|敌情|兵力对比|分析一下/.test(clean)
      && !/去|攻|走|转|进军|渡|突围|固守|分兵|北上|南下|西进|东进/.test(clean);
    if (isExplainQuestion) {
      return sanitizeSandboxScenePlan({
        mode: 'explain',
        title: (res.telegramTitle || '黎平战前敌我态势解析').slice(0, 24),
        analysis: baseOutcome || '1934年12月红军抵黎平后，湘西北有敌军重兵堵截，而贵州北部敌军兵力相对薄弱。',
        riskLevel: res.riskLevel || 'high',
        historicalContrast,
        camera: { center: [108.95, 26.95], zoom: 1.48, azimuth: -10, tilt: 34 },
        phases: [{
          caption: '战区态势解析',
          durationMs: 1100,
          redForces: [],
          enemyForces: [],
          zones: [
            { id: 'exp-blk', label: '湘西北重兵封锁', center: [110.15, 27.65], radiusDeg: 0.72, kind: 'enemy-blockade', phase: 0 },
            { id: 'exp-gap', label: '黔北兵力薄弱带', center: [107.65, 27.15], radiusDeg: 0.52, kind: 'weak-gap', phase: 0 },
          ],
          pins: [
            { label: '黎平', point: sandboxLipingOrigin, tone: 'gold', phase: 0 },
            { label: '黔北薄弱', point: [107.47, 27.07], tone: 'gold', phase: 0 },
          ],
        }],
        citedSourceIds: Array.isArray(res.sourceIds) ? res.sourceIds : [],
      });
    }

    const goWest = res.trajectory === 'west-breakthrough'
      || (/西|黔|贵|遵义|猴场|乌江/.test(clean) && !/湘西北|北上|强攻/.test(clean));
    if (goWest) {
      const westPts: GeoPoint[] = [startPoint, [108.58, 26.62], [107.90, 26.90], [107.47, 27.07], [106.93, 27.69]];
      return sanitizeSandboxScenePlan({
        mode: 'simulate',
        title: (res.telegramTitle || '转向黔北进军推演').slice(0, 24),
        analysis: baseOutcome || '主力避开湘西北重兵封锁，西向转入敌军防备薄弱的贵州北部，经猴场、乌江直指遵义地区。',
        riskLevel: 'viable',
        historicalContrast,
        camera: computeSandboxCameraForPoints(westPts, 34),
        phases: [
          {
            caption: '西出黔东经猴场',
            durationMs: 1150,
            redForces: [{
              id: 'west-1', role: 'main', label: '主力西出黔北',
              waypoints: westPts.slice(0, 4), phase: 0, style: 'solid-gold', outcome: 'advance',
            }],
            enemyForces: [],
            zones: [{ id: 'west-gap', label: '黔北薄弱地带', center: [107.68, 27.15], radiusDeg: 0.55, kind: 'weak-gap', phase: 0 }],
            pins: [{ label: '猴场', point: [107.47, 27.07], tone: 'gold', phase: 0 }],
          },
          {
            caption: '强渡乌江进逼遵义',
            durationMs: 1300,
            redForces: [{
              id: 'west-2', role: 'main', label: '北渡乌江取遵义',
              waypoints: westPts, phase: 1, style: 'solid-gold', outcome: 'breakthrough',
            }],
            enemyForces: [],
            zones: [],
            pins: [{ label: '遵义', point: [106.93, 27.69], tone: 'gold', phase: 1 }],
          },
        ],
        citedSourceIds: Array.isArray(res.sourceIds) ? res.sourceIds : [],
      });
    }

    const northPts: GeoPoint[] = [startPoint, [109.20, 26.67], [110.00, 27.56], [110.39, 28.45]];
    return sanitizeSandboxScenePlan({
      mode: 'simulate',
      title: (res.telegramTitle || '北上湘西北风险推演').slice(0, 24),
      analysis: baseOutcome || '若沿原计划强行北上湘西北，渡江后的主力将直撞国民党军重兵口袋阵，补给受阻且有全线被围风险。',
      riskLevel: res.riskLevel || 'critical',
      historicalContrast,
      camera: computeSandboxCameraForPoints(northPts, 35),
      phases: [
        {
          caption: '北出锦屏试探怀化',
          durationMs: 1100,
          redForces: [{
            id: 'north-1', role: 'main', label: '北上湘西北主力',
            waypoints: northPts.slice(0, 3), phase: 0, style: 'dashed-vermilion', outcome: 'advance',
          }],
          enemyForces: [],
          zones: [],
          pins: [{ label: '怀化', point: [110.00, 27.56], tone: 'vermilion', phase: 0 }],
        },
        {
          caption: '湘西北重兵封锁受阻',
          durationMs: 1350,
          redForces: [{
            id: 'north-2', role: 'main', label: '北进受阻于湘西',
            waypoints: northPts, phase: 1, style: 'dashed-vermilion', outcome: 'blocked',
          }],
          enemyForces: [
            { id: 'n-blk-1', label: '桑植重兵南截', from: [110.16, 29.40], to: [110.39, 28.45], phase: 1, posture: 'intercept' },
            { id: 'n-blk-2', label: '沅陵东翼合围', from: [110.92, 28.10], to: [110.18, 27.92], phase: 1, posture: 'encircle' },
          ],
          zones: [{ id: 'n-blk-zone', label: '湘西北口袋阵', center: [110.22, 28.15], radiusDeg: 0.72, kind: 'enemy-blockade', phase: 1 }],
          pins: [{ label: '沅陵受阻', point: [110.39, 28.45], tone: 'vermilion', phase: 1 }],
        },
      ],
      citedSourceIds: Array.isArray(res.sourceIds) ? res.sourceIds : [],
    });
  }

  async function emitLocalStreamChunks(text: string, signal: AbortSignal, onProgress?: (event: DirectorProgress) => void) {
    if (!onProgress || !text) return;
    const chars = Array.from(text);
    const step = Math.max(5, Math.ceil(chars.length / 10));
    for (let i = step; i < chars.length; i += step) {
      await new Promise<void>((resolve, reject) => {
        if (signal.aborted) { reject(signal.reason); return; }
        const timer = window.setTimeout(() => {
          signal.removeEventListener('abort', onAbort);
          resolve();
        }, 20);
        const onAbort = () => {
          window.clearTimeout(timer);
          reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
      });
      onProgress({ type: 'text', text: chars.slice(0, i).join('') });
    }
    if (!signal.aborted) onProgress({ type: 'text', text });
  }

  async function postSandboxDual(
    path: string,
    payload: Record<string, unknown>,
    signal: AbortSignal,
    onProgress?: (event: DirectorProgress) => void
  ): Promise<{ streamed: boolean; data: Record<string, unknown> }> {
    const timeout = AbortSignal.timeout(62000);
    const mergedSignal = AbortSignal.any([signal, timeout]);
    let response: Response;
    try {
      response = await fetch(`${gatewayBase}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/x-ndjson, application/json',
          ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        },
        body: JSON.stringify(payload),
        signal: mergedSignal,
      });
    } catch {
      signal.throwIfAborted();
      if (timeout.aborted) throw new Error('AI 响应超时，请重试。');
      throw new Error('教学网关连接中断，请检查一键开课服务后重试。');
    }

    if (!response.ok) {
      const errData = await response.json().catch(() => null);
      throw Object.assign(new Error(errData?.message || `推演服务请求失败 (${response.status})`), { status: response.status });
    }

    const contentType = response.headers.get('Content-Type') ?? '';
    if (contentType.includes('application/x-ndjson')) {
      try {
        let finalResult: Record<string, unknown> | undefined;
        for await (const event of readNdjsonResponse(response)) {
          if (event.type === 'text' && typeof event.text === 'string') {
            onProgress?.({ type: 'text', text: event.text });
          }
          if (event.type === 'error' && typeof event.message === 'string') throw new Error(event.message);
          if (event.type === 'result' && object(event.result) && event.result.ok === true) {
            finalResult = event.result;
          }
        }
        if (!finalResult) throw new Error('推演结果提前中断，请重试。');
        return { streamed: true, data: finalResult };
      } catch (error) {
        signal.throwIfAborted();
        if (timeout.aborted) throw new Error('AI 响应超时，请重试。');
        throw error;
      }
    }

    const data = await response.json().catch(() => null);
    if (!object(data) || data.ok !== true) {
      throw Object.assign(new Error(String(object(data) ? data.message ?? '' : '') || '推演服务响应异常，请重试。'), {
        status: response.status,
      });
    }
    return { streamed: false, data };
  }

  function scheduleSandboxCompaction(current: CourseLedger) {
    const sessionId = current.sessionId;
    const epoch = sandboxEpochs.get(current) ?? 0;
    const active = () => ledger === current && (sandboxEpochs.get(current) ?? 0) === epoch;
    const previous = sandboxCompaction.get(sessionId) ?? Promise.resolve();
    const task = previous.then(async () => {
      if (!active() || !online) return;
      await syncEvents(current);
      if (!active() || !online) return;
      const response = await fetch(`${gatewayBase}/api/course-ai/sandbox/compact`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        },
        body: JSON.stringify({ sessionId, through: current.sequence }),
        signal: AbortSignal.timeout(35000),
      });
      if (response.status === 404 || !response.ok) return;
      const result = await response.json().catch(() => null);
      if (active() && object(result) && result.ok === true && typeof result.version === 'number' && result.version > 0) {
        const turnCount = typeof result.turnCount === 'number' ? result.turnCount : 0;
        const mirror = readSandboxChatMirror(sessionId);
        writeSandboxChatMirror(sessionId, {
          ...mirror,
          compressionVersion: result.version,
          compressionTurnCount: turnCount,
        });
        window.dispatchEvent(new CustomEvent('course-sandbox-compressed', {
          detail: { sessionId, version: result.version, turnCount },
        }));
      }
    }).catch(() => {});
    sandboxCompaction.set(sessionId, task);
    void task.finally(() => {
      if (sandboxCompaction.get(sessionId) === task) sandboxCompaction.delete(sessionId);
    });
  }

  async function runSandboxTurn(
    req: SandboxTurnRequestPayload,
    signal: AbortSignal,
    onProgress?: (event: DirectorProgress) => void
  ): Promise<SandboxTurnReply> {
    const current = getLedger();
    const epoch = sandboxEpochs.get(current) ?? 0;
    const sameTurn = () => ledger === current && (sandboxEpochs.get(current) ?? 0) === epoch;
    const interactionId = crypto.randomUUID();
    const state = buildClassroomState();
    const compactContext = compactSandboxMapContext(req.mapContext);
    const previous = current.events.slice().reverse().find(event => event.route === 'sandbox' && event.kind === 'feedback');
    const recordedInput = {
      theater: 'liping',
      proposal: req.proposal,
      classification: 'hypothesis',
      mapContext: compactContext,
      ...(req.attachments?.length ? { attachmentNames: req.attachments.map(file => file.name) } : {}),
      page: state.page,
      previousInteractionId: previous?.interactionId,
    };
    recordEvent(current, 'sandbox', interactionId, 'input', recordedInput);

    try {
      if (await syncEvents(current) === 'conflict') {
        throw new Error('本机课堂记录与网关不一致。原记录已保留，请重新开课后继续使用 AI。');
      }
      signal.throwIfAborted();
      if (!sameTurn()) throw new DOMException('课堂或对话已更换', 'AbortError');

      const body = {
        sessionId: current.sessionId,
        theater: 'liping',
        proposal: req.proposal,
        classification: 'hypothesis',
        mapContext: compactContext,
        ...(req.attachments?.length ? {
          attachments: req.attachments,
          attachmentNames: req.attachments.map(file => file.name),
        } : {}),
        classroom: { sessionId: current.sessionId, interactionId, state },
      };

      const { streamed, data } = await postSandboxDual('/api/course-ai/sandbox', body, signal, onProgress);
      signal.throwIfAborted();
      if (!sameTurn()) throw new DOMException('课堂或对话已更换', 'AbortError');

      let plan: SandboxScenePlan;
      let narration = '';
      if (object(data.plan)) {
        plan = sanitizeSandboxScenePlan(data.plan);
        narration = typeof data.narration === 'string' && data.narration.trim()
          ? data.narration.trim() : plan.analysis;
        if (!streamed && narration) {
          await emitLocalStreamChunks(narration, signal, onProgress);
        }
      } else {
        const legacyRes = data as unknown as SandboxResponse;
        plan = adaptLegacySandboxResponse(legacyRes, req.proposal, compactContext);
        narration = plan.analysis;
        if (!streamed && narration) {
          await emitLocalStreamChunks(narration, signal, onProgress);
        }
      }
      signal.throwIfAborted();
      if (!sameTurn()) throw new DOMException('课堂或对话已更换', 'AbortError');

      const sourceIds = Array.isArray(data.sourceIds)
        ? data.sourceIds.filter((s): s is string => typeof s === 'string') : plan.citedSourceIds;
      recordEvent(current, 'sandbox', interactionId, 'feedback', {
        title: plan.title,
        riskLevel: plan.riskLevel,
        battlefieldOutcome: narration.slice(0, 220),
        historicalContrast: plan.historicalContrast.slice(0, 180),
        classification: 'hypothesis',
        sourceIds,
      });

      const mirror = readSandboxChatMirror(current.sessionId);
      mirror.turns.push({ id: interactionId, proposal: req.proposal, narration, plan, sourceIds });
      writeSandboxChatMirror(current.sessionId, mirror);

      if (!signal.aborted) scheduleSandboxCompaction(current);
      return { plan, narration, sourceIds, interactionId };
    } catch (error) {
      if (sameTurn()) {
        recordEvent(current, 'sandbox', interactionId, signal.aborted ? 'cancelled' : 'failed',
          { message: signal.aborted ? '请求已取消' : error instanceof Error ? error.message : '推演失败' });
      }
      throw error;
    } finally {
      void syncEvents(current);
    }
  }

  async function loadSandboxHistory(sessionId: string): Promise<SandboxHistoryState> {
    const localState = readSandboxChatMirror(sessionId);
    if (!online || !gatewayBase) return localState;
    try {
      const response = await fetch(`${gatewayBase}/api/course-ai/sandbox/history`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
        },
        body: JSON.stringify({ sessionId }),
        signal: AbortSignal.timeout(4000),
      });
      if (response.status === 404 || !response.ok) return localState;
      const data = await response.json().catch(() => null);
      if (!object(data) || data.ok !== true || !Array.isArray(data.turns)) return localState;
      const turns: SandboxHistoryExchange[] = [];
      for (const item of data.turns) {
        if (!object(item)) continue;
        const proposal = typeof item.proposal === 'string' ? item.proposal : '';
        const plan = sanitizeSandboxScenePlan(item.plan);
        const narration = typeof item.narration === 'string' && item.narration.trim()
          ? item.narration.trim() : typeof item.analysis === 'string' ? item.analysis.trim() : plan.analysis;
        if (!proposal && !narration) continue;
        turns.push({
          ...(typeof item.interactionId === 'string' && uuid.test(item.interactionId) ? { id: item.interactionId } : {}),
          proposal,
          narration,
          plan,
        });
      }
      const nextState: SandboxHistoryState = {
        turns: turns.length ? turns : localState.turns,
        compressionVersion: typeof data.compressionVersion === 'number' ? data.compressionVersion : localState.compressionVersion,
        compressionTurnCount: typeof data.compressionTurnCount === 'number' ? data.compressionTurnCount : localState.compressionTurnCount,
      };
      writeSandboxChatMirror(sessionId, nextState);
      return nextState;
    } catch {
      return localState;
    }
  }

  async function clearSandboxHistory(sessionId: string) {
    const current = getLedger();
    sandboxEpochs.set(current, (sandboxEpochs.get(current) ?? 0) + 1);
    if (online && gatewayBase) {
      await syncEvents(current);
      try {
        const response = await fetch(`${gatewayBase}/api/course-ai/sandbox/clear`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(accessToken && { Authorization: `Bearer ${accessToken}` }),
          },
          body: JSON.stringify({ sessionId, through: current.sequence }),
          signal: AbortSignal.timeout(4000),
        });
        if (!response.ok && response.status !== 404) {
          const errData = await response.json().catch(() => null);
          throw Object.assign(new Error(errData?.message || '清空沙盘记录失败'), { status: response.status });
        }
      } catch (error) {
        if (object(error) && typeof error.status === 'number' && error.status !== 404) {
          throw error;
        }
      }
    }
    try { sessionStorage.removeItem(sandboxChatStorageKey); } catch {}
    if (ledger === current) resetSandboxLedgerView(current);
  }

  function recordSandboxAction(interactionId: string, actionType: string, outcome: 'succeeded' | 'failed') {
    const current = getLedger();
    const id = typeof interactionId === 'string' && uuid.test(interactionId) ? interactionId : crypto.randomUUID();
    recordEvent(current, 'sandbox', id, 'operations',
      { results: [{ action: { type: actionType }, outcome }] });
    void syncEvents(current);
  }

  function mountLipingSandboxEntry(deck: HTMLElement, beforeNode: HTMLElement, onOpen: () => void) {
    const trigger = lessonControl('liping-sandbox', '沙盘推演', () => {
      if (!online) return;
      soundscape.playSfx('route');
      onOpen();
    }, 'deck-btn is-harness', 'layers');
    trigger.hidden = !online;
    deck.insertBefore(trigger, beforeNode);
    const sync = () => {
      trigger.hidden = !online;
    };
    window.addEventListener('course-harness-status', sync);
    return () => window.removeEventListener('course-harness-status', sync);
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
        output.replaceChildren(element('p', 'harness-status-line', '正在综合本场探索与推演轨迹生成复盘简报…'));
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
          const errLine = element('p', 'harness-status-line', err instanceof Error ? err.message : '生成简报失败');
          errLine.dataset.error = 'true';
          output.replaceChildren(errLine);
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
    getSessionId: getDirectorSessionId,
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
    mountLipingSandboxEntry,
    runSandboxTurn,
    loadSandboxHistory,
    clearSandboxHistory,
    recordSandboxAction,
    mountRecapReportButton,
  };
})();
