import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createCourseHarnessServer, resolveCourseAIConfig } from '../课堂演示/harness/course-ai-server.mjs';

const streamType = 'application/x-ndjson';
const jsonType = 'application/json';
const prefix = '可以并排查看';
const narration = `${prefix}原计划和会议决定。`;
const actions = [{ type: 'compare_liping_routes', side: 'both' }];
const modelActions = [...actions, { type: 'other' }, { type: 'open_review', conclusion: 'true' }];
const sourceIds = [];
const upstreamRequests = [];
const gate = new Map();
const abortedUpstream = Promise.withResolvers();
const stub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString());
  upstreamRequests.push(request);
  const prompt = request.messages.at(-1).content;
  if (prompt.includes('限流')) {
    res.writeHead(429, { 'Content-Type': jsonType });
    res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
    return;
  }
  if (!request.stream) {
    res.writeHead(200, { 'Content-Type': jsonType });
    res.end(JSON.stringify({
      id: 'fixture', model: 'fixture-model', object: 'chat.completion',
      choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify({ narration, actions: modelActions }) }, finish_reason: 'stop' }],
    }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finishReason = null) => res.write(`data: ${JSON.stringify({
    id: 'fixture', model: 'fixture-model', object: 'chat.completion.chunk',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`);
  send({ role: 'assistant', reasoning_content: 'PRIVATE_MODEL_TRACE' });
  send({ content: `{"narration":"${prefix}` });
  if (prompt.includes('主动取消')) {
    res.once('close', abortedUpstream.resolve);
    return;
  }
  const requestGate = [...gate].find(([utterance]) => prompt.includes(utterance))?.[1];
  if (requestGate) await requestGate.promise;
  if (prompt.includes('上游事件故障')) {
    res.end('data: {"error":{"message":"PRIVATE_UPSTREAM_ERROR"}}\n\ndata: [DONE]\n\n');
    return;
  }
  if (prompt.includes('格式不完整')) {
    send({ content: '结束' });
  } else {
    send({ content: '原计划和' });
    send({ content: `会议决定。","actions":${JSON.stringify(modelActions)},"citedSourceIds":["unknown"]}` });
  }
  send({}, 'stop');
  res.end('data: [DONE]\n\n');
});
await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));

async function* readEvents(response) {
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^application\/x-ndjson\b/);
  let pending = '';
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    pending += chunk;
    const lines = pending.split('\n');
    pending = lines.pop();
    for (const line of lines) yield JSON.parse(line);
  }
  assert.equal(pending, '');
}

async function collectEvents(response) {
  const events = [];
  for await (const event of readEvents(response)) events.push(event);
  return events;
}

const config = {
  port: 0,
  baseUrl: `http://127.0.0.1:${stub.address().port}/v1`,
  model: 'fixture-model',
  apiKey: 'fixture-key',
  directorMemoryPath: ':memory:',
};
const { accessToken } = resolveCourseAIConfig(config);
function post(gateway, route, body, { accept = streamType, signal, token = accessToken } = {}) {
  const headers = { Accept: accept, 'Content-Type': jsonType };
  if (token) headers.Authorization = `Bearer ${token}`;
  return fetch(`${gateway.url}/api/course-ai/${route}`, {
    method: 'POST', headers, body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
  });
}

async function history(gateway, sessionId) {
  const response = await post(gateway, 'director/history', { sessionId });
  assert.equal(response.status, 200);
  return (await response.json()).turns;
}

function assertSuccess(events) {
  assert.deepEqual(events.slice(0, 2), [
    { type: 'status', stage: 'context' }, { type: 'status', stage: 'generating' },
  ]);
  const textEvents = events.slice(2, -2);
  assert.ok(textEvents.length > 1);
  let previousText = '';
  for (const event of textEvents) {
    assert.deepEqual(Object.keys(event), ['type', 'text']);
    assert.equal(event.type, 'text');
    assert.ok(event.text.startsWith(previousText) && event.text.length > previousText.length);
    previousText = event.text;
  }
  assert.deepEqual(events.at(-2), { type: 'status', stage: 'validating' });
  assert.equal(events.at(-1).type, 'result');
  assert.equal(events.at(-1).result.narration, previousText);
}

try {
  for (const jsonSchemaOutput of [false, true]) {
    const gateway = await createCourseHarnessServer({ ...config, jsonSchemaOutput });
    const utterance = jsonSchemaOutput ? '结构化输出流' : 'JSON 输出流';
    const release = Promise.withResolvers();
    gate.set(utterance, release);
    try {
      const sessionId = randomUUID();
      const response = await post(gateway, 'director', { sessionId, utterance });
      const events = [];
      for await (const event of readEvents(response)) {
        events.push(event);
        if (events.length === 3) {
          assert.deepEqual(event, { type: 'text', text: prefix });
          assert.deepEqual(await history(gateway, sessionId), []);
          assert.equal((await post(gateway, 'director', { sessionId, utterance })).status, 409);
          release.resolve();
        }
      }
      assertSuccess(events);
      assert.deepEqual(events.at(-1), { type: 'result', result: { ok: true, narration, actions, sourceIds } });
      assert.deepEqual(await history(gateway, sessionId), [{ utterance, narration }]);
      assert.equal(upstreamRequests.at(-1).stream, true);
      assert.equal(upstreamRequests.at(-1).response_format.type, jsonSchemaOutput ? 'json_schema' : 'json_object');

      if (!jsonSchemaOutput) {
        const legacy = await post(gateway, 'director', { utterance: '兼容 JSON' }, { accept: jsonType });
        assert.match(legacy.headers.get('content-type'), /^application\/json\b/);
        assert.deepEqual(await legacy.json(), { ok: true, narration, actions, sourceIds });
        assert.equal(upstreamRequests.at(-1).stream, undefined);
        const denied = await post(gateway, 'director', { utterance: '身份检查' }, { token: '' });
        assert.equal(denied.status, 401);
        assert.equal((await denied.json()).code, 'GATEWAY_ACCESS');

        for (const [input, code] of [['格式不完整', 'MODEL_FORMAT'], ['上游事件故障', 'MODEL_ERROR'], ['限流', 'MODEL_QUOTA']]) {
          const failedSessionId = randomUUID();
          const failed = await collectEvents(await post(gateway, 'director', { sessionId: failedSessionId, utterance: input }));
          assert.equal(failed.at(-1).type, 'error');
          assert.equal(failed.at(-1).code, code);
          assert.match(failed.at(-1).message, /AI/);
          assert.equal(failed.some(event => event.type === 'result'), false);
          assert.equal(JSON.stringify(failed).includes('PRIVATE_'), false);
          assert.deepEqual(await history(gateway, failedSessionId), []);
        }

        const cancelledSessionId = randomUUID();
        const controller = new AbortController();
        const cancelResponse = await post(gateway, 'director', { sessionId: cancelledSessionId, utterance: '主动取消' }, { signal: controller.signal });
        for await (const event of readEvents(cancelResponse)) {
          if (event.type === 'text') {
            controller.abort();
            break;
          }
        }
        await Promise.race([abortedUpstream.promise, delay(4000).then(() => { throw new Error('上游没有收到中断'); })]);
        assert.deepEqual(await history(gateway, cancelledSessionId), []);
        const retried = await post(gateway, 'director', { sessionId: cancelledSessionId, utterance: '中断后继续' }, { accept: jsonType });
        assert.equal(retried.status, 200);
      }
    } finally {
      release.resolve();
      await gateway.close();
    }
  }

  const mock = await createCourseHarnessServer({ port: 0, mockHarness: true });
  try {
    const response = await post(mock, 'director', { utterance: '黎平路线' });
    const events = await collectEvents(response);
    assertSuccess(events);
    assert.deepEqual(events.at(-1).result.actions, [
      { type: 'navigate_page', pageTitle: '进军方向' }, ...actions,
    ]);
  } finally {
    await mock.close();
  }
} finally {
  stub.closeAllConnections();
  await new Promise(resolve => stub.close(resolve));
}
console.log('verify-director-stream PASS');
