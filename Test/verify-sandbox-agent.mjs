import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { createCourseHarnessServer, resolveCourseAIConfig } from '../课堂演示/harness/course-ai-server.mjs';

const streamType = 'application/x-ndjson';
if (process.argv.includes('--live')) {
  await runLiveSandbox();
  process.exit(0);
}

const sessionId = randomUUID();
const origin = [109.14, 26.23];
const analysis = '先核对分队的行进方向，再比较不同方案。';
const pathEntry = (id, role, waypoints, phase) =>
  ({ id, role, label: id, waypoints, phase, style: 'solid-gold', outcome: 'advance' });
const fixture = {
  mode: 'simulate', title: '分路试探', analysis, riskLevel: 'high',
  historicalContrast: '黎平会议决定改向贵州北部。',
  camera: { center: [109.14, 26.23], zoom: 5, azimuth: -90, tilt: 90 },
  phases: [
    { caption: '分路', durationMs: 200, redForces: [pathEntry('main', 'main', [origin, [108.52, 25.93]], 0),
      pathEntry('feint', 'feint', [origin, [109.78, 26.16]], 0)], enemyForces: [], zones: [], pins: [] },
    { durationMs: 5000, redForces: [pathEntry('main', 'main', [[108.52, 25.93], [140, 50]], 1)],
      enemyForces: [], zones: [], pins: [] },
  ],
  citedSourceIds: ['invented-archive', 'src-liping-turn', 'src-liping-turn'],
};
const gate = Promise.withResolvers();
const upstreamCancelled = Promise.withResolvers();
const summaryGate = Promise.withResolvers();
const summaryStarted = Promise.withResolvers();
const modelRequests = [];
let interruptedPlans = 0;
const upstream = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  modelRequests.push(body);
  const prompt = body.messages.at(-1).content;
  let output = fixture;
  if (body.messages[0].content.includes('将旧课堂交互归纳')) {
    const { turns } = JSON.parse(prompt);
    if (turns.flat().some(([, , content]) => content?.includes('清空竞态'))) {
      summaryStarted.resolve();
      await summaryGate.promise;
    }
    output = { items: [{ kind: 'choice', text: '学员提出分路假设。', refs: [turns[0][0][0]] }] };
  } else if (body.messages[0].content.includes('复盘架构师')) {
    output = { title: '课堂复盘', subtitle: '课程', executiveSummary: '记录了分路假设。',
      journeyHighlights: ['黎平沙盘'], decisionComparison: '贵州北部',
      gridMapping: [{ topic: '现场', principle: '查证', action: '复核' }, { topic: '材料', principle: '对照', action: '记录' }],
      discussionQuestions: ['怎样复核？', '怎样对照？'] };
  } else if (body.messages[0].content.includes('你是课件的【行迹副导】')) {
    output = { narration: '可以查看路线。', actions: [] };
  } else if (prompt.includes('精简剧本')) {
    output = { analysis, title: '精简分路', mode: 'simulate', riskLevel: 'high',
      phases: [{ redForces: [{ role: 'main', label: '主力', waypoints: [origin, [108.52, 25.93]] }] }] };
  } else if (prompt.includes('越界目标边界投影')) {
    output = { ...fixture, offMapTarget: [135, 26.23], phases: [
      { ...fixture.phases[1], redForces: [pathEntry('main', 'main', [origin, [113.9, 26.23]], 0)] },
    ] };
  } else if (prompt.includes('虚报越界说明')) {
    output = { ...fixture, outOfBoundsNote: '已触及战区东缘。', phases: [fixture.phases[0]] };
  } else if (prompt.includes('畸形坐标')) {
    output = { ...fixture, camera: { ...fixture.camera, center: ['NaN', 26] } };
  }
  if (!body.stream) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'fixture', model: 'fixture-model', object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(output) }, finish_reason: 'stop' }] }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finishReason = null, separator = '\n\n') => res.write(`data: ${JSON.stringify({
    id: 'fixture', model: 'fixture-model', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}${separator}`);
  send({ role: 'assistant', reasoning_content: 'PRIVATE_REASONING' }, null, '\n');
  if (output.items) {
    send({ content: JSON.stringify(output) });
    send({}, 'stop');
    res.end('data: [DONE]\n\n');
    return;
  }
  const first = '{"analysis":"' + analysis.slice(0, 8);
  send({ content: first });
  if (prompt.includes('主动取消')) {
    res.once('close', upstreamCancelled.resolve);
    return;
  }
  if (prompt.includes('等待流式')) await gate.promise;
  if (prompt.includes('一次截断恢复') && interruptedPlans++ === 0) {
    send({}, 'length');
    res.end('data: [DONE]\n\n');
    return;
  }
  if (prompt.includes('畸形流式')) {
    res.end('data: [DONE]\n\n');
    return;
  }
  send({ content: JSON.stringify({ analysis, ...output }).slice(first.length) });
  if (prompt.includes('完整对象后断流')) {
    res.end('data: {"error":{"message":"fixture disconnected"}}\n\ndata: [DONE]\n\n');
    return;
  }
  if (prompt.includes('完整对象后截断')) {
    send({ content: '\n{"analysis":"' });
    send({}, 'length');
  } else {
    send({}, 'stop');
  }
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));

const work = path.resolve('.march-build');
mkdirSync(work, { recursive: true });
const scratch = mkdtempSync(path.join(work, 'sandbox-agent-'));
const options = {
  port: 0, baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, model: 'fixture-model', apiKey: 'sandbox-test',
  directorMemoryPath: path.join(scratch, 'sessions.sqlite'),
  context: { inputLimit: 28000, summaryThreshold: 1, recentTurns: 1 },
};
const token = resolveCourseAIConfig(options).accessToken;
let gateway;
function post(route, body, { accept = 'application/json', signal } = {}) {
  return fetch(`${gateway.url}/api/course-ai/${route}`, {
    method: 'POST', headers: { Accept: accept, 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000),
  });
}
async function json(route, body, expected = 200) {
  const response = await post(route, body);
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
}
async function* eventsOf(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/x-ndjson\b/);
  let pending = '';
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    const lines = (pending + chunk).split('\n');
    pending = lines.pop();
    for (const line of lines) yield JSON.parse(line);
  }
  assert.equal(pending, '');
}
const collect = async stream => {
  const result = [];
  for await (const event of stream) result.push(event);
  return result;
};
const mapContext = { revision: 0, isInitial: true, actionSinceLastTurn: 'continue', activeSummary: '',
  activeRoutes: [], activeZones: [] };
let seq = 0;
async function ledgerEvent(interactionId, kind, data) {
  const event = { sessionId, seq: ++seq, eventId: `${sessionId}:${seq}`, interactionId, route: 'sandbox', kind, data };
  await json('context/events', { sessionId, events: [event] });
  return event;
}
async function trackedTurn(proposal, extra = {}) {
  const interactionId = randomUUID();
  await ledgerEvent(interactionId, 'input', { proposal, classification: 'hypothesis' });
  const result = await json('sandbox', { sessionId, proposal, mapContext, classroom: { sessionId, interactionId }, ...extra });
  await ledgerEvent(interactionId, 'feedback', { battlefieldOutcome: result.narration,
    historicalContrast: result.plan.historicalContrast, classification: 'hypothesis', sourceIds: result.sourceIds });
  return result;
}

try {
  gateway = await createCourseHarnessServer(options);
  const firstResponse = await post('sandbox', { sessionId, proposal: '等待流式', mapContext }, { accept: streamType });
  const received = [];
  for await (const event of eventsOf(firstResponse)) {
    received.push(event);
    if (event.type === 'text' && received.filter(item => item.type === 'text').length === 1) {
      assert.equal((await json('sandbox/history', { sessionId })).turns.length, 0);
      await json('sandbox', { sessionId, proposal: '重复提交', mapContext }, 409);
      gate.resolve();
    }
  }
  assert.deepEqual(received.filter(event => event.type === 'status').map(event => event.stage), ['context', 'generating', 'validating']);
  assert.ok(received.filter(event => event.type === 'text').length >= 2);
  assert.doesNotMatch(JSON.stringify(received), /PRIVATE_REASONING/);
  const { result } = received.at(-1);
  assert.equal(result.narration, analysis);
  assert.equal(result.hypothesisTag, '假设推演 · 非真实史实');
  assert.equal(result.plan.phases[0].redForces.length, 2);
  assert.deepEqual(result.plan.citedSourceIds, ['src-liping-turn']);
  const boundary = result.plan.phases[1].redForces[0].waypoints[1];
  assert.ok(boundary[0] <= 118.5 && boundary[1] <= 30.65);
  assert.ok(boundary[0] < 118.49 || boundary[1] < 30.64, '越界点沿射线截断');
  assert.match(result.plan.outOfBoundsNote, /边界|战区/);
  assert.deepEqual(result.plan.camera, { center: origin, zoom: 2.35, azimuth: -38, tilt: 55 });
  assert.deepEqual(result.plan.phases.map(phase => phase.durationMs), [900, 2200]);

  const compactPlan = await json('sandbox', { proposal: '精简剧本', mapContext });
  assert.equal(compactPlan.plan.phases[0].redForces[0].style, 'solid-gold');
  assert.equal(compactPlan.plan.phases[0].redForces[0].phase, 0);
  assert.deepEqual(compactPlan.plan.phases[0].enemyForces, []);
  assert.match(compactPlan.plan.historicalContrast, /贵州北部/);
  const recovered = await collect(eventsOf(await post('sandbox',
    { proposal: '一次截断恢复', mapContext }, { accept: streamType })));
  assert.equal(interruptedPlans, 2);
  assert.equal(recovered.at(-1).type, 'result');
  assert.ok(recovered.filter(event => event.type === 'text').length >= 1);
  const beforeTrailing = modelRequests.length;
  const trailing = await collect(eventsOf(await post('sandbox',
    { proposal: '完整对象后截断', mapContext }, { accept: streamType })));
  assert.equal(trailing.at(-1).type, 'result');
  assert.equal(modelRequests.length - beforeTrailing, 1);
  const beforeDisconnect = modelRequests.length;
  const disconnected = await collect(eventsOf(await post('sandbox',
    { proposal: '完整对象后断流', mapContext }, { accept: streamType })));
  assert.equal(disconnected.at(-1).type, 'result');
  assert.equal(modelRequests.length - beforeDisconnect, 1);

  const invalidStart = modelRequests.length;
  for (const attachments of [[{ name: 'a.exe', text: '资料' }], [{ name: 'a.txt', text: '兵'.repeat(1334) }]]) {
    await json('sandbox', { sessionId, proposal: '校验附件', attachments, mapContext }, attachments[0].name.endsWith('exe') ? 400 : 413);
  }
  await json('sandbox', { sessionId, proposal: '非法状态', mapContext: { ...mapContext, actionSinceLastTurn: 'invalid' } }, 400);
  assert.equal(modelRequests.length, invalidStart);
  await json('sandbox', { sessionId, proposal: '畸形坐标', mapContext }, 502);
  const broken = await collect(eventsOf(await post('sandbox', { sessionId, proposal: '畸形流式', mapContext }, { accept: streamType })));
  assert.equal(broken.at(-1).type, 'error');

  const offMap = await json('sandbox', { proposal: '越界目标边界投影', mapContext });
  assert.deepEqual(offMap.plan.phases[0].redForces[0].waypoints.at(-1), [118.485, 26.23]);
  assert.match(offMap.plan.outOfBoundsNote, /战区东缘/);
  assert.equal(Object.hasOwn(offMap.plan, 'offMapTarget'), false);
  const falseBoundary = await json('sandbox', { proposal: '虚报越界说明', mapContext });
  assert.equal(falseBoundary.plan.outOfBoundsNote, undefined);

  const controller = new AbortController();
  const cancelling = await post('sandbox', { sessionId, proposal: '主动取消', mapContext }, { accept: streamType, signal: controller.signal });
  await assert.rejects(async () => {
    for await (const event of eventsOf(cancelling)) if (event.type === 'text') controller.abort();
  }, { name: 'AbortError' });
  await Promise.race([upstreamCancelled.promise, delay(2000).then(() => assert.fail('取消未传至上游'))]);
  assert.equal((await json('sandbox/history', { sessionId })).turns.length, 1);

  await json('director', { sessionId, utterance: '副导独立记录' });
  const firstTracked = await trackedTurn('课堂分路唯一记录');
  const beforeReplay = modelRequests.length;
  const retryBody = { sessionId, proposal: '课堂分路唯一记录', mapContext,
    classroom: { sessionId, interactionId: firstTracked.interactionId } };
  assert.deepEqual(await json('sandbox', retryBody), firstTracked);
  assert.equal(modelRequests.length, beforeReplay);
  assert.equal((await json('sandbox', { ...retryBody, proposal: '相同身份不同方案' }, 409)).code, 'SANDBOX_TURN_CONFLICT');
  await trackedTurn('还原重演', { attachments: [{ name: '备忘.txt', text: '本轮资料独有标识' }],
    mapContext: { ...mapContext, actionSinceLastTurn: 'restored' } });
  const prompt = modelRequests.at(-1).messages.at(-1).content;
  assert.match(prompt, /restored/);
  assert.match(prompt, /本轮资料独有标识/);
  assert.doesNotMatch(prompt, /副导独立记录/);
  await trackedTurn('回档以后继续', { mapContext: { ...mapContext, revision: 1, isInitial: false,
    actionSinceLastTurn: 'rolled_back', activeSummary: '回档地图独有标识',
    activeRoutes: [{ label: '原分队', role: 'main', waypoints: [origin, [108.52, 25.93]] }] } });
  assert.match(modelRequests.at(-1).messages.at(-1).content, /rolled_back.*回档地图独有标识/);
  assert.doesNotMatch(modelRequests.at(-1).messages.at(-1).content, /本轮资料独有标识/);

  await trackedTurn('摘要前最新一轮');
  const compression = await json('sandbox/compact', { sessionId, through: seq });
  assert.ok(compression.version > 0 && compression.turnCount > 0);
  const attempted = modelRequests.length;
  await json('sandbox/compact', { sessionId, through: seq });
  assert.equal(modelRequests.length, attempted);
  await json('recap-report', { classroom: { sessionId, interactionId: randomUUID(), state: {} } });
  assert.match(modelRequests.at(-1).messages.at(-1).content, /课堂分路唯一记录|学员提出分路假设/);
  assert.match(modelRequests.at(-1).messages.at(-1).content, /hypothesis/);

  await gateway.close();
  gateway = await createCourseHarnessServer(options);
  const history = await json('sandbox/history', { sessionId });
  assert.equal(history.turns.length, 5);
  assert.equal(history.compressionVersion, compression.version);
  const other = await json('sandbox/history', { sessionId: randomUUID() });
  assert.deepEqual(other.turns, []);

  await trackedTurn('清空竞态');
  const afterCompression = modelRequests.at(-1).messages.at(-1).content;
  assert.match(afterCompression, /"notes":\[/);
  assert.match(afterCompression, /学员提出分路假设。/);
  assert.match(afterCompression, /回档以后继续/, '摘要未引用的旧轮仍应进入后续上下文');
  assert.match(afterCompression, /"classification":"hypothesis"/);
  await trackedTurn('保留一轮以触发压缩');
  const db = new DatabaseSync(options.directorMemoryPath);
  try {
    db.exec(`CREATE TRIGGER fail_clear_sandbox BEFORE DELETE ON sandbox_turns
      BEGIN SELECT RAISE(ABORT, 'fixture clear failure'); END`);
    await json('sandbox/clear', { sessionId, through: seq }, 500);
    assert.equal((await json('sandbox/history', { sessionId })).turns.length, 7);
    assert.equal((await json('sandbox/history', { sessionId })).compressionVersion, compression.version);
    assert.ok((await json('context/events', { sessionId, eventId: sessionId + ':1' })).event);
    db.exec('DROP TRIGGER fail_clear_sandbox');
  } finally {
    db.close();
  }
  const inFlight = json('sandbox/compact', { sessionId, through: seq });
  await Promise.race([summaryStarted.promise, delay(2500).then(() => assert.fail('摘要未进入预期竞态'))]);
  await json('sandbox/clear', { sessionId, through: seq });
  summaryGate.resolve();
  await inFlight;
  assert.deepEqual(await json('sandbox/history', { sessionId }),
    { ok: true, turns: [], compressionVersion: 0, compressionTurnCount: 0 });
  assert.deepEqual((await json('director/history', { sessionId })).turns, [{ utterance: '副导独立记录', narration: '可以查看路线。' }]);
  assert.equal((await json('sandbox', retryBody, 409)).code, 'SANDBOX_TURN_CLEARED');
  await trackedTurn('清空后提交全新方案');
  assert.equal((await json('sandbox/history', { sessionId })).turns.length, 1);

  await gateway.close();
  gateway = await createCourseHarnessServer(options);
  const volatileId = randomUUID();
  const failingStore = new DatabaseSync(options.directorMemoryPath);
  try {
    failingStore.exec(`CREATE TRIGGER fail_write_sandbox BEFORE INSERT ON sandbox_turns
      BEGIN SELECT RAISE(ABORT, 'fixture write failure'); END`);
    await json('sandbox', { sessionId: volatileId, proposal: '存储中断时的方案' });
    assert.equal((await json('sandbox/history', { sessionId: volatileId })).turns[0].proposal, '存储中断时的方案');
    failingStore.exec('DROP TRIGGER fail_write_sandbox');
    await json('sandbox', { sessionId: volatileId, proposal: '存储恢复后的方案' });
  } finally {
    failingStore.close();
  }
  await gateway.close();
  gateway = await createCourseHarnessServer(options);
  assert.deepEqual((await json('sandbox/history', { sessionId: volatileId })).turns.map(turn => turn.proposal),
    ['存储中断时的方案', '存储恢复后的方案']);
  await gateway.close();
  for (const jsonSchemaOutput of [false, true]) {
    gateway = await createCourseHarnessServer({ ...options, directorMemoryPath: ':memory:', context: {}, jsonSchemaOutput });
    for (let n = 0; n < 3; n++) {
      const proposal = `第${n}轮方案` + '条件'.repeat(114);
      const interactionId = randomUUID();
      const currentMap = { ...mapContext, revision: n + 1, isInitial: false, activeSummary: '补给和行军态势'.repeat(30),
        activeRoutes: Array.from({ length: 4 }, () => ({ label: '保留分队', role: 'main',
          waypoints: [origin, [108.52, 25.93], [107.9, 26.9], [107.47, 27.32], [106.93, 27.69]] })) };
      await ledgerEvent(interactionId, 'input', { proposal, mapContext: currentMap, attachmentNames: ['备忘.txt'] });
      const result = await json('sandbox', { sessionId, proposal, mapContext: currentMap,
        attachments: [{ name: '备忘.txt', text: '材'.repeat(1333) }], classroom: { sessionId, interactionId } });
      await ledgerEvent(interactionId, 'feedback', { battlefieldOutcome: '分路待核实'.repeat(35),
        historicalContrast: result.plan.historicalContrast, sourceIds: result.sourceIds });
    }
    await gateway.close();
  }
  gateway = await createCourseHarnessServer({ mockHarness: true, port: 0 });
  const split = await json('sandbox', { proposal: '分出一支小分队佯攻通道，主力绕道榕江' });
  const hold = await json('sandbox', { proposal: '在黎平原地固守休整七天' });
  assert.ok(split.plan.phases.flatMap(phase => phase.redForces).some(force => force.role === 'feint'));
  assert.ok(hold.plan.phases.flatMap(phase => phase.redForces).some(force => force.role === 'hold'));
  assert.notDeepEqual(split.plan.phases, hold.plan.phases);
  console.log('黎平沙盘网关：流式、地理校验、取消、附件、读写恢复、增量压缩、清空竞态和复盘隔离通过。');
} finally {
  gate.resolve();
  summaryGate.resolve();
  await gateway?.close();
  upstream.closeAllConnections();
  await new Promise(resolve => upstream.close(resolve));
  rmSync(scratch, { recursive: true, force: true });
}

async function runLiveSandbox() {
  const config = resolveCourseAIConfig();
  assert.ok(config.baseUrl && config.model, '请先配置模型端点与模型 ID。');
  const root = path.resolve('.march-build');
  mkdirSync(root, { recursive: true });
  const scratch = mkdtempSync(path.join(root, 'live-sandbox-'));
  const sqlite = path.join(scratch, 'sessions.sqlite');
  const usage = [];
  // 只降低验收会话的触发阈值，保留生产的最近两轮和摘要时限。
  const gateway = await createCourseHarnessServer({
    port: 0, directorMemoryPath: sqlite, context: { ...config.sandboxContext, summaryThreshold: 1 },
    onUsage: item => usage.push(item),
  });
  const id = randomUUID();
  const headers = { 'Content-Type': 'application/json',
    ...(config.accessToken && { Authorization: 'Bearer ' + config.accessToken }) };
  const report = [];
  let sequence = 0;
  let map = { revision: 0, isInitial: true, actionSinceLastTurn: 'continue', activeSummary: '',
    activeRoutes: [], activeZones: [] };
  async function livePost(route, payload, stream = false) {
    const response = await fetch(gateway.url + '/api/course-ai/' + route, {
      method: 'POST', headers: stream ? { ...headers, Accept: streamType } : headers,
      body: JSON.stringify(payload), signal: AbortSignal.timeout(stream ? 62000 : 35000),
    });
    if (!response.ok) throw new Error('模型验收请求失败：' + (await response.text()));
    return stream ? response : response.json();
  }
  async function sync(interactionId, kind, data) {
    const seq = ++sequence;
    const result = await livePost('context/events', { sessionId: id, events: [{
      sessionId: id, seq, eventId: id + ':' + seq, interactionId, route: 'sandbox', kind, data,
    }] });
    assert.equal(result.durable, true);
  }
  const scenarios = [
    { proposal: '分出小分队到通道方向佯攻，主力沿榕江方向转移。分别画出两路。', role: 'feint' },
    { proposal: '沿用当前地图。让主力在现在的位置就地固守，说明补给限制。', role: 'hold' },
    { proposal: '继续推演，主力向贵州北部行进。画出下一段并说明地形限制。', role: 'main' },
    { proposal: '沿用当前地图，主力接下来只走一段到黄平附近，在图上标出终点。', role: 'main' },
    { proposal: '根据前面几轮，简要解释分兵和固守各在什么条件下可行。此轮只讲解。' },
  ];
  const only = process.argv.find(arg => arg.startsWith('--scenario='))?.split('=')[1];
  if (only) assert.match(only, /^[1-5]$/);
  const failures = [];
  let compression;
  try {
    for (const [index, scenario] of scenarios.entries()) {
      const round = index + 1;
      if (only && Number(only) !== round) continue;
      const { proposal, role } = scenario;
      const interactionId = randomUUID();
      await sync(interactionId, 'input', { proposal, mapContext: map, classification: 'hypothesis' });
      const started = performance.now();
      let firstTextMs;
      let pieces = 0;
      let result;
      try {
        const response = await livePost('sandbox', { sessionId: id, proposal, mapContext: map,
          classroom: { sessionId: id, interactionId, state: { page: '黎平战地沙盘' } } }, true);
        for await (const event of eventsOf(response)) {
          if (event.type === 'text') { firstTextMs ??= Math.round(performance.now() - started); pieces++; }
          if (event.type === 'error') throw new Error(event.code + ' ' + event.message);
          if (event.type === 'result') result = event.result;
        }
        assert.ok(result?.ok && firstTextMs !== undefined && pieces >= 1);
        const { plan } = result;
        const forces = plan.phases.flatMap(phase => phase.redForces);
        if (role) assert.ok(forces.some(force => force.role === role), '缺少预期的分队角色 ' + role);
        else assert.equal(plan.mode, 'explain');
        const timing = { round, firstTextMs, totalMs: Math.round(performance.now() - started),
          textEvents: pieces, phases: plan.phases.length, roles: [...new Set(forces.map(force => force.role))],
          boundary: Boolean(plan.outOfBoundsNote) };
        report.push(timing);
        console.log(JSON.stringify({ turn: timing }));
        await sync(interactionId, 'feedback', { battlefieldOutcome: result.narration, title: plan.title,
          riskLevel: plan.riskLevel, classification: 'hypothesis', sourceIds: result.sourceIds });
        if (plan.mode === 'simulate') {
          map = { revision: map.revision + 1, isInitial: false, actionSinceLastTurn: 'continue',
            activeSummary: result.narration, activeRoutes: forces.slice(-4).map(({ role, label, waypoints }) => ({ role, label, waypoints })),
            activeZones: plan.phases.at(-1).zones.map(({ label, center, kind }) => ({ label, center, kind })) };
        }
      } catch (error) {
        const failure = { round, firstTextMs, totalMs: Math.round(performance.now() - started), textEvents: pieces, error: error.message };
        failures.push(failure);
        console.error(JSON.stringify({ failure }));
        await sync(interactionId, 'failed', { message: '推演未通过' });
      }
      if (!only && round >= 4) {
        const started = performance.now();
        const result = await livePost('sandbox/compact', { sessionId: id, through: sequence });
        compression = { ...result, elapsedMs: Math.round(performance.now() - started) };
        console.log(JSON.stringify({ compression }));
      }
    }
    const history = await livePost('sandbox/history', { sessionId: id });
    let persisted;
    const db = new DatabaseSync(sqlite, { readOnly: true });
    try {
      const row = db.prepare("SELECT value FROM course_summaries WHERE session = ? AND route = 'sandbox'").get(id);
      if (row) {
        const note = JSON.parse(row.value);
        persisted = { version: note.version, through: note.through, covered: note.covered, items: note.items.length,
          hypotheses: note.items.every(item => item.basis.every(event => event.classification === 'hypothesis')) };
        const evidence = note.items.flatMap(item => item.eventIds);
        for (const eventId of new Set(evidence)) {
          const { event } = await livePost('context/events', { sessionId: id, eventId });
          assert.equal(event.route, 'sandbox');
          assert.ok(['input', 'feedback'].includes(event.kind));
        }
      }
    } finally { db.close(); }
    console.log(JSON.stringify({ model: gateway.model, report, failures, compression, persisted,
      historyTurns: history.turns.length, usage }));
    assert.equal(failures.length, 0, '真实模型有推演未通过。');
    assert.equal(history.turns.length, only ? 1 : scenarios.length);
    if (!only) {
      assert.ok(compression?.version > 0 && persisted?.items > 0 && persisted.hypotheses);
      assert.equal(history.compressionVersion, persisted.version);
    }
  } finally {
    await gateway.close();
    rmSync(scratch, { recursive: true, force: true });
  }
}
