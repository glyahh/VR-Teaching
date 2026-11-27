import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import {
  assembleCourseContext, contextSettings, createCourseEventStore, estimateInput,
} from '../课堂演示/harness/course-context.mjs';
import { COURSE_ARCHIVE, archivePromptBlock } from '../课堂演示/harness/archive-knowledge.mjs';
import { createCourseHarnessServer, resolveCourseAIConfig } from '../课堂演示/harness/course-ai-server.mjs';

const earlyError = '首次误解：只改变进军方向就足够';
const laterCorrection = '后续修正：军事纠偏需要组织调整保障';
const originalQuestion = '军事指挥与组织调整如何共同起作用？';
const makeClass = () => {
  const sessionId = randomUUID();
  const events = [];
  function append(route, kind, interactionId, data) {
    const seq = events.length + 1;
    const event = { sessionId, seq, eventId: `${sessionId}:${seq}`, route, kind, interactionId, data };
    events.push(event);
    return event;
  }
  function pair(route, input, feedback, id = randomUUID()) {
    return [append(route, 'input', id, input), append(route, 'feedback', id, feedback)];
  }
  const questionId = randomUUID();
  const [, question] = pair('zunyi-debate', { stage: 'challenge' }, { stage: 'challenge', message: originalQuestion }, questionId);
  const [error] = pair('zunyi-debate', { questionId, question: originalQuestion, argument: earlyError },
    { stage: 'rebuttal', accepted: false, message: '组织依据不足', sourceIds: ['src-zunyi-resolution'] });
  for (let i = 0; i < 55; i++) {
    const route = ['sandbox', 'director', 'zunyi-debate'][i % 3];
    if (route === 'sandbox') pair(route, { proposal: `方案 ${i}，按教学习题复核湘西北。 `.repeat(6) },
      { hypothesisTag: '假设推演 · 非真实史实', battlefieldOutcome: '需要比对地形、敌军态势和会合安排。'.repeat(8),
        sourceIds: ['src-liping-turn'] });
    else if (route === 'director') pair(route, { utterance: `第 ${i} 次操作：查看路线与补给材料。`.repeat(7) },
      { narration: '正在对照已阅材料与课堂路线。'.repeat(5) });
    else pair(route, { argument: `第 ${i} 次发言：请结合当时两个阶段考虑。`.repeat(6) },
      { stage: 'rebuttal', accepted: false, message: '说明实际指挥与组织机构如何配合。'.repeat(8) });
  }
  const [correction] = pair('zunyi-debate',
    { questionId, question: originalQuestion, argument: laterCorrection, seenObjects: ['journal', 'dossier'] },
    { stage: 'rebuttal', accepted: true, message: '结合材料说明了两个方面。', sourceIds: ['src-zunyi-resolution'] });
  const navigation = pair('director', { utterance: '进入课堂回顾' }, { narration: '可以进入课堂回顾' });
  const action = { type: 'open_review', conclusion: false };
  append('director', 'operations', navigation[0].interactionId, { results: [{ action, outcome: 'failed' }] });
  return { identity: { sessionId, interactionId: randomUUID(), state: { debate: { question: originalQuestion } } },
    events, append, pair, anchors: [question, error, correction] };
};
const chunks = (events, accept) => {
  for (let i = 0; i < events.length; i += 8) accept(events.slice(i, i + 8));
};
function oneNote(prompt) {
  const input = JSON.parse(prompt);
  const group = input.exchanges.find(exchange => exchange.route === 'sandbox') ?? input.exchanges[0];
  const event = group.events.find(item => item.kind === 'feedback');
  return {
    ...input.coverage,
    items: [{ kind: 'choice', text: '沙盘里的方案属于学员假设。', eventIds: [event.eventId],
      sourceIds: event.data.sourceIds ?? [] }],
  };
}

const db = new DatabaseSync(':memory:');
const store = createCourseEventStore(db, () => {});
const lesson = makeClass();
const id = lesson.identity.sessionId;
chunks(lesson.events, events => assert.equal(store.append(id, events), true));
assert.equal(store.read(id).length, lesson.events.length);
assert.equal(store.append(id, [lesson.events[0]]), true);
assert.equal(store.append(id, [Object.fromEntries(Object.entries(lesson.events[0]).reverse())]), true);
assert.throws(() => store.append(id, [{ ...lesson.events[0], data: { bad: true } }]), { statusCode: 409 });
db.prepare('INSERT INTO course_events VALUES (?, ?, ?)').run(id, 990, 'null');
assert.equal(store.read(id).length, lesson.events.length);
assert.deepEqual(store.read(randomUUID()), []);

const settings = contextSettings({ inputLimit: 9800, summaryTarget: 6500, summaryTimeoutMs: 20 });
const request = { system: archivePromptBlock(), schema: { type: 'object' }, prompt: '保留本轮原题和完整输入。',
  maxOutputTokens: 1600 };
const assemble = overrides => assembleCourseContext({ request, route: 'recap-report', identity: lesson.identity,
  store, settings, ...overrides });
let started;
let release;
const entered = new Promise(resolve => { started = resolve; });
const gate = new Promise(resolve => { release = resolve; });
let attempts = 0;
const summarize = async ({ prompt }) => { attempts++; started(); await gate; return oneNote(prompt); };
const first = assemble({ summarize, settings: { ...settings, summaryTimeoutMs: 2000 } });
await entered;
const late = lesson.pair('director', { utterance: '摘要进行时的新事件' }, { narration: '保留' });
store.append(id, late);
const other = { ...lesson.identity, sessionId: randomUUID() };
await assemble({ summarize, identity: other });
await assemble({ summarize });
assert.equal(attempts, 1);
release();
const fitted = await first;
assert.equal(store.summary(id, 'recap-report').version, 1);
assert.equal(store.summary(other.sessionId, 'recap-report'), undefined);
assert.deepEqual(store.read(id).slice(-2), late);
assert.ok(estimateInput(fitted) <= settings.inputLimit);
for (const anchor of lesson.anchors) assert.match(fitted.prompt, new RegExp(anchor.eventId));
assert.match(fitted.prompt, /"classification":"hypothesis"/);
assert.match(fitted.prompt, /"outcome":"failed"/);
assert.doesNotMatch(fitted.prompt, /"outcome":"succeeded"/);
assert.ok(COURSE_ARCHIVE.every(item => fitted.system.includes(item.fact)));
assert.match(fitted.prompt, /保留本轮原题和完整输入/);
const next = await assemble({ summarize: async ({ prompt }) => oneNote(prompt) });
assert.ok(estimateInput(next) <= settings.inputLimit);
assert.equal(store.summary(id, 'recap-report').version, 2);
await assert.rejects(assemble({ settings: { ...settings, inputLimit: 20 } }), { upstreamCode: 'CONTEXT_BUDGET' });

for (const failure of ['invalid', 'timeout', 'cancel', 'no-benefit', 'disabled']) {
  const separate = makeClass();
  const controller = new AbortController();
  chunks(separate.events, events => store.append(separate.identity.sessionId, events));
  let calls = 0;
  const options = {
    identity: separate.identity,
    request: { ...request, requestSignal: controller.signal },
    settings: { ...settings, summaryEnabled: failure !== 'disabled' },
    summarize: async ({ prompt, requestSignal }) => {
      calls++;
      if (failure === 'cancel') controller.abort();
      if (failure === 'timeout') {
        await new Promise(resolve => setTimeout(resolve, 30));
        requestSignal.throwIfAborted();
      }
      if (failure === 'invalid') return '非法 JSON';
      if (failure === 'no-benefit') {
        const note = oneNote(prompt);
        const ids = JSON.parse(prompt).exchanges.flatMap(group => group.events.map(event => event.eventId)).slice(0, 8);
        return { ...note, items: Array.from({ length: 12 }, () => ({
          kind: 'choice', text: '课堂教学中的假设需要随后再核验。'.repeat(9), eventIds: ids, sourceIds: [],
        })) };
      }
      return oneNote(prompt);
    },
  };
  if (failure === 'cancel') await assert.rejects(assemble(options), { name: 'AbortError' });
  else {
    assert.ok(estimateInput(await assemble(options)) <= settings.inputLimit);
    await assemble(options);
  }
  assert.equal(calls, failure === 'disabled' ? 0 : 1);
  assert.equal(store.summary(separate.identity.sessionId, 'recap-report'), undefined);
  assert.equal(store.read(separate.identity.sessionId).length, separate.events.length);
}
const failingDb = new DatabaseSync(':memory:');
const fallback = createCourseEventStore(failingDb, () => {});
failingDb.exec('DROP TABLE course_events');
assert.equal(fallback.append(id, [lesson.events[0]]), false);
assert.deepEqual(fallback.read(id), [lesson.events[0]]);
failingDb.close();
db.close();

const calls = [];
const fixtureReport = {
  title: '课堂复盘', subtitle: '课堂记录', executiveSummary: '按记录复核。',
  journeyHighlights: [], decisionComparison: '核对实际抉择。',
  gridMapping: [{ topic: '现场', principle: '查证', action: '检查' }, { topic: '复盘', principle: '纠正', action: '复核' }],
  discussionQuestions: ['如何查证？', '如何复核？'],
};
const stub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const bytes of req) chunks.push(bytes);
  const input = JSON.parse(Buffer.concat(chunks).toString());
  const prompt = input.messages.at(-1).content;
  const summary = input.messages[0].content.includes('将旧课堂交互归纳');
  calls.push({ input, prompt, summary });
  const result = summary ? oneNote(prompt) : fixtureReport;
  res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
    id: 'context-fixture', model: 'fixture', object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }));
});
await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
const table = [];
const live = process.argv.includes('--live');
const configured = live ? resolveCourseAIConfig() : undefined;
if (live) assert.ok(configured.baseUrl && configured.model, '缺少真实模型配置');
try {
  for (const variant of ['旧截断', '完整轨迹', '新装配']) {
    const before = calls.length;
    const telemetry = [];
    const options = {
      directorMemoryPath: ':memory:',
      ...(live ? configured : { baseUrl: `http://127.0.0.1:${stub.address().port}/v1`, apiKey: 'fixture', model: 'fixture' }),
      port: 0,
      context: variant === '完整轨迹' ? { inputLimit: 260000, modelWindow: 270000, summaryEnabled: false }
        : { inputLimit: 12000, summaryTarget: 7500, summaryTimeoutMs: live ? 8000 : 1500 },
      onUsage: item => telemetry.push(item),
    };
    const gateway = await createCourseHarnessServer(options);
    const { accessToken } = resolveCourseAIConfig(options);
    const post = (route, body) => fetch(`${gateway.url}/api/course-ai/${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}` }, body: JSON.stringify(body),
    });
    try {
      let payload = { roleTrack: '配网抢修' };
      if (variant === '旧截断') {
        payload.trace = { zunyiDebates: lesson.events.filter(event => event.route === 'zunyi-debate' && event.data.argument)
          .map(event => ({ argument: event.data.argument })).slice(-12) };
      } else {
        for (let i = 0; i < lesson.events.length; i += 8) {
          assert.equal((await post('context/events', { sessionId: id, events: lesson.events.slice(i, i + 8) })).status, 200);
        }
        const eventId = lesson.anchors[1].eventId;
        assert.equal((await (await post('context/events', { sessionId: id, eventId })).json()).event.data.argument, earlyError);
        payload.classroom = lesson.identity;
      }
      const started = performance.now();
      const response = await (await post('recap-report', payload)).json();
      const elapsedMs = Math.round(performance.now() - started);
      if (!live) assert.equal(response.report.title, fixtureReport.title);
      const prompt = live ? '' : calls.at(-1).prompt;
      const reportText = JSON.stringify(response.report ?? {});
      table.push({ variant, ...(!live && { earlyError: prompt.includes(earlyError), laterCorrection: prompt.includes(laterCorrection) }),
        validOutput: response.ok, error: response.code, telemetry, elapsedMs,
        ...(live && { outputMentionsCorrection: /纠偏|纠正/.test(reportText) && /组织/.test(reportText) }),
        summaryCalls: live ? new Set(telemetry.filter(call => call.kind.startsWith('context-summary')).map(call => call.estimatedInput)).size
          : calls.slice(before).filter(call => call.summary).length });
    } finally { await gateway.close(); }
  }
  if (!live) {
    assert.equal(table[0].earlyError, false);
    assert.equal(table[1].earlyError, true);
    assert.equal(table[2].earlyError, true);
    assert.ok(table.every(row => row.validOutput && row.laterCorrection));
    assert.equal(table[2].summaryCalls, 1);
    assert.ok(table[2].telemetry.at(-1).estimatedInput < table[1].telemetry.at(-1).estimatedInput);
  }
} finally {
  stub.closeAllConnections();
  await new Promise(resolve => stub.close(resolve));
}
const evidenceDir = new URL('../.march-build/context-acceptance/', import.meta.url);
mkdirSync(evidenceDir, { recursive: true });
writeFileSync(new URL(live ? 'comparison-live.json' : 'comparison.json', evidenceDir),
  JSON.stringify({ mode: live ? 'live' : 'fixture', interactions: 59, table }, null, 2));
console.log('verify-course-context PASS', JSON.stringify(table));
