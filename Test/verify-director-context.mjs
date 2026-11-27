import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createCourseHarnessServer, resolveCourseAIConfig } from '../课堂演示/harness/course-ai-server.mjs';

const narration = '可核对上一轮课堂材料。';
const conversations = [];
let summaryCalls = 0;
let pendingSummary;
let pendingGeneration;
const stub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const bytes of req) chunks.push(bytes);
  const request = JSON.parse(Buffer.concat(chunks).toString());
  const prompt = request.messages.at(-1).content;
  let result = { narration, actions: [], citedSourceIds: [] };
  if (request.messages[0].content.includes('将旧课堂交互归纳')) {
    summaryCalls++;
    const { coverage, exchanges } = JSON.parse(prompt);
    const feedback = exchanges.at(-1).events.find(event => event.kind === 'feedback');
    result = { ...coverage, items: [{
      kind: 'choice', text: '学员追问了课堂材料。', eventIds: [feedback.eventId], sourceIds: [],
    }] };
    if (pendingSummary) {
      const held = pendingSummary;
      pendingSummary = undefined;
      held.entered.resolve();
      await held.release.promise;
      held.finished.resolve();
    }
  } else {
    conversations.push(prompt);
    if (pendingGeneration) {
      const held = pendingGeneration;
      pendingGeneration = undefined;
      held.entered.resolve();
      await held.release.promise;
    }
  }
  if (!res.destroyed) res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
    id: 'director-context-fixture', model: 'fixture', object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(result) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1 },
  }));
});

function deferred() {
  return Promise.withResolvers();
}
async function reached(promise) {
  const timer = new AbortController();
  try {
    return await Promise.race([promise, delay(3000, undefined, { signal: timer.signal }).then(() => {
      throw new Error('等待测试操作超时');
    })]);
  } finally {
    timer.abort();
  }
}
function newClassroom() {
  const sessionId = randomUUID();
  let sequence = 0;
  return {
    sessionId,
    event(route, kind, interactionId, data) {
      const seq = ++sequence;
      return { sessionId, seq, eventId: `${sessionId}:${seq}`, route, kind, interactionId, data };
    },
  };
}

await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
const build = new URL('../.march-build/', import.meta.url);
mkdirSync(build, { recursive: true });
const memoryPath = join(mkdtempSync(join(fileURLToPath(build), 'director-context-')), 'sessions.sqlite');
const options = {
  directorMemoryPath: memoryPath, baseUrl: `http://127.0.0.1:${stub.address().port}/v1`,
  apiKey: 'fixture', model: 'fixture', port: 0,
  context: { inputLimit: 22000, summaryThreshold: 1, summaryTarget: 8000, summaryTimeoutMs: 3000 },
};
const { accessToken } = resolveCourseAIConfig(options);
let gateway = await createCourseHarnessServer(options);
const post = (route, body) => fetch(`${gateway.url}/api/course-ai/${route}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
  body: JSON.stringify(body),
});
async function result(route, body, status = 200) {
  const response = await post(route, body);
  assert.equal(response.status, status, `${route} status`);
  return response.json();
}
const compact = (sessionId, through) => result('director/compact', { sessionId, through });
const history = (sessionId) => result('director/history', { sessionId });
const events = (...batch) => result('context/events', { sessionId: batch[0].sessionId, events: batch });
const lookup = (event, status = 200) => result('context/events', { sessionId: event.sessionId, eventId: event.eventId }, status);
const clear = (sessionId, through) => result('director/clear', { sessionId, through });
const emptyCompression = { ok: true, version: 0, turnCount: 0 };
const emptyHistory = { ok: true, turns: [], compressionVersion: 0, compressionTurnCount: 0 };
async function turn(classroom, ordinal, syncFeedback = true) {
  const { sessionId } = classroom;
  const interactionId = randomUUID();
  const utterance = `第 ${ordinal} 次核对课堂材料，` + '请列出路线与补给记录。'.repeat(11);
  const input = classroom.event('director', 'input', interactionId, { utterance });
  await events(input);
  assert.equal((await result('director', { sessionId, utterance, classroom: { sessionId, interactionId } })).narration, narration);
  const feedback = classroom.event('director', 'feedback', interactionId, { narration, actions: [] });
  if (syncFeedback) await events(feedback);
  return { input, feedback };
}
const lesson = newClassroom();
const { sessionId } = lesson;
const otherClassroom = newClassroom();
try {
  const first = await turn(lesson, 1);
  assert.deepEqual(await compact(sessionId), emptyCompression);
  assert.equal(summaryCalls, 0);
  await turn(lesson, 2);
  await turn(lesson, 3);
  const fourth = await turn(lesson, 4);
  const firstJob = { entered: deferred(), release: deferred(), finished: deferred() };
  pendingSummary = firstJob;
  const compacted = compact(sessionId);
  await reached(firstJob.entered.promise);
  const duplicate = compact(sessionId);
  const whilePending = await history(sessionId);
  assert.equal(whilePending.turns.length, 4);
  assert.equal(whilePending.compressionVersion, 0);
  assert.equal(conversations.length, 4);
  firstJob.release.resolve();
  assert.deepEqual(await compacted, { ok: true, version: 1, turnCount: 4 });
  assert.deepEqual(await duplicate, { ok: true, version: 1, turnCount: 4 });
  assert.equal(summaryCalls, 1);
  const after = await history(sessionId);
  assert.equal(after.turns.length, 4);
  assert.equal(after.compressionVersion, 1);
  assert.equal(after.compressionTurnCount, 4);
  const action = { type: 'open_review' };
  await events(lesson.event('director', 'operations', fourth.input.interactionId,
    { results: [{ action, outcome: 'succeeded' }] }));
  assert.deepEqual(await compact(sessionId), { ok: true, version: 1, turnCount: 4 });
  assert.equal(summaryCalls, 1);

  const sandbox = lesson.event('sandbox', 'input', randomUUID(), { proposal: '向西行进' });
  await events(sandbox);
  const other = await turn(otherClassroom, 1);
  await turn(lesson, 5);
  assert.match(conversations.at(-1), /学员追问了课堂材料/);
  const delayed = { entered: deferred(), release: deferred(), finished: deferred() };
  pendingSummary = delayed;
  const cancelled = compact(sessionId);
  await reached(delayed.entered.promise);
  const lateSandbox = lesson.event('sandbox', 'input', randomUUID(), { proposal: '补交课堂推演' });
  const lateDirector = lesson.event('director', 'input', randomUUID(), { utterance: '清空前发出的旧口令' });
  assert.deepEqual(await clear(sessionId, lateDirector.seq), { ok: true });
  delayed.release.resolve();
  await reached(delayed.finished.promise);
  assert.deepEqual(await cancelled, emptyCompression);
  assert.deepEqual(await history(sessionId), emptyHistory);
  assert.equal((await history(otherClassroom.sessionId)).turns.length, 1);
  await lookup(first.input, 404);
  assert.deepEqual((await lookup(sandbox)).event, sandbox);
  await events(lateSandbox, lateDirector);
  assert.deepEqual((await lookup(lateSandbox)).event, lateSandbox);
  await lookup(lateDirector, 404);
  assert.deepEqual((await lookup(other.input)).event, other.input);
  assert.deepEqual(await compact(sessionId), emptyCompression);

  const heldDirector = { entered: deferred(), release: deferred() };
  pendingGeneration = heldDirector;
  const generation = result('director', { sessionId, utterance: '正在生成时清空' });
  await reached(heldDirector.entered.promise);
  assert.equal((await result('director/clear', { sessionId }, 409)).ok, false);
  heldDirector.release.resolve();
  await generation;
  assert.deepEqual(await clear(sessionId), { ok: true });
  await gateway.close();
  gateway = await createCourseHarnessServer(options);
  assert.deepEqual(await history(sessionId), emptyHistory);
  await events(lateDirector);
  await lookup(lateDirector, 404);
  const fresh = await turn(lesson, 6);
  assert.deepEqual((await lookup(fresh.input)).event, fresh.input);
  assert.doesNotMatch(conversations.at(-1), /学员追问了课堂材料/);
  assert.equal((await history(otherClassroom.sessionId)).turns.length, 1);
  assert.deepEqual((await lookup(sandbox)).event, sandbox);
  assert.deepEqual((await lookup(lateSandbox)).event, lateSandbox);

  const overlap = newClassroom();
  for (let i = 1; i <= 3; i++) await turn(overlap, i);
  const acknowledged = await turn(overlap, 4);
  const newer = await turn(overlap, 5, false);
  assert.equal((await history(overlap.sessionId)).turns.length, 5);
  assert.deepEqual(await compact(overlap.sessionId, acknowledged.feedback.seq), { ok: true, version: 1, turnCount: 4 });
  await events(newer.feedback);
  await turn(overlap, 6);
  assert.deepEqual(await compact(overlap.sessionId, newer.feedback.seq), { ok: true, version: 2, turnCount: 5 });
  assert.equal((await history(overlap.sessionId)).compressionTurnCount, 5);
  assert.equal((await result('director/compact', { sessionId: overlap.sessionId, through: -1 }, 400)).ok, false);

  const interrupted = newClassroom();
  await turn(interrupted, 1, false);
  for (let i = 2; i <= 5; i++) await turn(interrupted, i);
  assert.equal((await history(interrupted.sessionId)).turns.length, 5);
  assert.deepEqual(await compact(interrupted.sessionId), { ok: true, version: 1, turnCount: 5 });

  await gateway.close();
  gateway = await createCourseHarnessServer({ ...options, directorMemoryPath: ':memory:',
    context: { ...options.context, summaryThreshold: 21000 } });
  const belowThreshold = newClassroom();
  for (let i = 1; i <= 4; i++) await turn(belowThreshold, i);
  assert.deepEqual(await compact(belowThreshold.sessionId), emptyCompression);
  assert.equal(summaryCalls, 5);
} finally {
  pendingSummary?.release.resolve();
  pendingGeneration?.release.resolve();
  stub.closeAllConnections();
  await gateway.close();
  await new Promise(resolve => stub.close(resolve));
}
console.log('verify-director-context PASS');
