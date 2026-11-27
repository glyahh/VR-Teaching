import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync, spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCourseHarnessServer, resolveCourseAIConfig, signDeveloperGrant } from '../课堂演示/harness/course-ai-server.mjs';
import { filterVerifiedSources, sanitizeDirectorActions } from '../课堂演示/harness/archive-knowledge.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sources = ['fake-source', 'src-liping-turn', 'src-liping-turn'];
assert.equal(filterVerifiedSources(sources).length, 1);
assert.deepEqual(sanitizeDirectorActions([
  { type: 'navigate_page', pageTitle: '不存在的页面' },
  { type: 'open_desk_object', object: 'dossier' },
  { type: 'open_desk_object', object: 'other' },
]), [{ type: 'open_desk_object', object: 'dossier' }]);

const replies = {
  director: {
    narration: '现在对照黎平的两条路线。',
    actions: [{ type: 'compare_liping_routes', side: 'both' }, { type: 'other' }],
    citedSourceIds: sources,
  },
  sandbox: {
    trajectory: 'west-breakthrough', riskLevel: 'viable', chokeLabel: '方向节点', telegramTitle: '比较路线',
    battlefieldOutcome: '比较当时条件。', historicalContrast: '黎平会议决定转向贵州北部。', citedSourceIds: sources,
  },
  debate: {
    stage: 'rebuttal', verdictTitle: '核对证据', message: '结合两册卷宗回应原问题。',
    followUpPrompt: '回看右册。', accepted: true, highlightDeskObject: 'dossier', dawnProgress: 1, citedSourceIds: sources,
  },
  recap: {
    title: '课堂复盘', subtitle: '课堂笔记', executiveSummary: '按实际轨迹查证。', journeyHighlights: [],
    decisionComparison: '比较既定安排与现场情况。',
    gridMapping: ['现场', '复核'].map(topic => ({ topic, principle: '现场查证', action: '补全证据' })),
    discussionQuestions: ['如何查证？', '如何复核？'], citedSourceIds: sources,
  },
};

const upstreamCalls = [];
const stub = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const request = JSON.parse(Buffer.concat(chunks).toString());
  upstreamCalls.push({ request, authorization: req.headers.authorization, url: req.url });
  const prompt = request.messages.at(-1).content;
  if (prompt.includes('额度故障')) {
    res.writeHead(429, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'Rate limit exceeded' } }));
    return;
  }
  const system = request.messages[0].content;
  const type = system.includes('1934 战地推演参谋') ? 'sandbox'
    : system.includes('会场历史质询员') ? 'debate'
      : system.includes('复盘架构师') ? 'recap' : 'director';
  const value = prompt.includes('格式故障') ? { actions: [] } : replies[type];
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    id: 'chatcmpl-test', model: 'fixture-model', object: 'chat.completion',
    choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
  }));
});
await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
const options = {
  port: 0,
  baseUrl: `http://127.0.0.1:${stub.address().port}/v1`,
  model: 'fixture-model',
  apiKey: 'fixture-key',
  disableThinking: true,
};
const gateway = await createCourseHarnessServer(options);
const { accessToken } = resolveCourseAIConfig(options);
try {
  const health = await (await fetch(`${gateway.url}/api/course-ai/health`)).json();
  assert.equal(health.engine, 'vercel-ai-sdk');
  assert.equal(health.model, options.model);
  const attach = (nonce, expiresAt, token = accessToken) => fetch(`${gateway.url}/api/course-ai/dev/attach`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ nonce, expiresAt, proof: signDeveloperGrant(token, nonce, expiresAt) }),
  });
  const expiresAt = Date.now() + 20000;
  const nonce = 'a'.repeat(32);
  assert.equal((await attach(nonce, expiresAt, 'untrusted')).status, 401);
  const attached = await attach(nonce, expiresAt);
  assert.equal(attached.status, 200);
  assert.equal((await attached.json()).accessToken, accessToken);
  assert.equal((await attach(nonce, expiresAt)).status, 401);
  assert.equal((await attach('b'.repeat(32), Date.now() - 1000)).status, 401);
  assert.equal((await attach('c'.repeat(32), Date.now() + 60000)).status, 401);
  const post = (route, data, authorization = `Bearer ${accessToken}`) =>
    fetch(`${gateway.url}/api/course-ai/${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(5000),
    });
  const unauthorized = await post('director', { utterance: '开始' }, '');
  assert.equal(unauthorized.status, 401);
  assert.equal(upstreamCalls.length, 0);

  const director = await (await post('director', { utterance: '对照路线' })).json();
  assert.deepEqual(director.actions, [{ type: 'compare_liping_routes', side: 'both' }]);
  assert.equal(director.citedSources.length, 1);
  const sandbox = await (await post('sandbox', { proposal: '比较历史约束' })).json();
  assert.equal(sandbox.hypothesisTag, '假设推演 · 非真实史实');
  assert.equal(sandbox.historicalContrast, replies.sandbox.historicalContrast);
  assert.ok(sandbox.mapPath.length >= 2);
  const debate = await (await post('zunyi-debate', {
    stage: 'rebuttal', argument: '说明组织保障', question: '原问题', seenObjects: ['journal', 'dossier'],
  })).json();
  assert.equal(debate.accepted, true);
  assert.equal(debate.dawnProgress, 1);
  assert.match(upstreamCalls.at(-1).request.messages.at(-1).content, /本轮质询：原问题/);
  const report = await (await post('recap-report', {
    roleTrack: '特高压运维', trace: { visitedPages: ['于都集结'] },
  })).json();
  assert.equal(report.report.decisionComparison, replies.recap.decisionComparison);
  assert.match(upstreamCalls.at(-1).request.messages.at(-1).content, /于都集结/);
  const malformed = await post('director', { utterance: '格式故障' });
  assert.equal(malformed.status, 502);
  assert.equal((await malformed.json()).code, 'MODEL_FORMAT');
  const limited = await post('director', { utterance: '额度故障' });
  assert.equal(limited.status, 429);
  assert.equal((await limited.json()).code, 'MODEL_QUOTA');
  assert.equal(upstreamCalls.length, 6);
  for (const call of upstreamCalls) {
    assert.equal(call.authorization, 'Bearer fixture-key');
    assert.equal(call.url, '/v1/chat/completions');
    assert.equal(call.request.response_format.type, 'json_object');
    assert.deepEqual(call.request.thinking, { type: 'disabled' });
    assert.match(call.request.messages[0].content, /JSON Schema/);
    assert.equal(call.request.tools, undefined);
  }
} finally {
  await gateway.close();
  stub.closeAllConnections();
  await new Promise(resolve => stub.close(resolve));
}

// 隔离启动器文件和日志，避免影响本机正在运行的课堂网关。
const work = path.join(root, '.march-build');
mkdirSync(work, { recursive: true });
const scratch = mkdtempSync(path.join(work, 'course-ai-launch-'));
let launchedPid;
try {
  const course = path.join(scratch, '课堂演示');
  const harness = path.join(course, 'harness');
  mkdirSync(harness, { recursive: true });
  for (const name of ['launch-course.mjs', 'course-ai-server.mjs', 'archive-knowledge.mjs']) {
    copyFileSync(path.join(root, '课堂演示', 'harness', name), path.join(harness, name));
  }
  const windowsEntry = path.join(scratch, '启动入口', 'Windows');
  mkdirSync(windowsEntry, { recursive: true });
  const cmdName = '启动-从于都到遵义.cmd';
  copyFileSync(path.join(root, '启动入口', 'Windows', cmdName), path.join(windowsEntry, cmdName));
  writeFileSync(path.join(course, '从于都到遵义-课堂演示.html'), '');
  const env = { ...process.env, COURSE_AI_BASE_URL: '', COURSE_AI_MODEL: '', COURSE_AI_API_KEY: '' };
  const launch = path.join(harness, 'launch-course.mjs');
  const launchOptions = { cwd: scratch, env, encoding: 'utf8' };
  const offline = JSON.parse(execFileSync(process.execPath, [launch, '--dry-run'], launchOptions));
  assert.equal(offline.harness.reason, 'no-model-config');
  assert.equal(new URL(offline.pageUrl).search, '');

  async function expectLaunchFailure(nonce, reason, overrides = {}) {
    const worker = spawn(process.execPath, [launch, '--developer-start', nonce], {
      cwd: scratch, env: { ...env, ...overrides }, stdio: 'ignore', windowsHide: true,
    });
    const exited = once(worker, 'exit');
    try {
      const file = path.join(harness, '.activation', `${nonce}.js`);
      const deadline = Date.now() + 6000;
      while (!existsSync(file) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 60));
      assert.match(readFileSync(file, 'utf8'), new RegExp(`"reason":"${reason}"`));
    } finally {
      worker.kill();
      await exited;
    }
  }
  await expectLaunchFailure('d'.repeat(32), 'no-model-config');
  const configured = { COURSE_AI_BASE_URL: 'http://127.0.0.1:9/v1', COURSE_AI_MODEL: 'fixture-model' };
  const occupied = http.createServer((_req, res) => { res.writeHead(404).end(); });
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  try {
    await expectLaunchFailure('e'.repeat(32), 'port-in-use', {
      ...configured, COURSE_AI_PORT: String(occupied.address().port),
    });
  } finally {
    await new Promise(resolve => occupied.close(resolve));
  }
  const vacant = http.createServer();
  await new Promise(resolve => vacant.listen(0, '127.0.0.1', resolve));
  const vacantPort = vacant.address().port;
  await new Promise(resolve => vacant.close(resolve));
  await expectLaunchFailure('f'.repeat(32), 'missing-dependencies', {
    ...configured, COURSE_AI_PORT: String(vacantPort),
  });

  const portProbe = http.createServer();
  await new Promise(resolve => portProbe.listen(0, '127.0.0.1', resolve));
  const port = portProbe.address().port;
  await new Promise(resolve => portProbe.close(resolve));
  const args = ['--dry-run', '--mock-harness', '--port', String(port)];
  const cmd = path.join(windowsEntry, cmdName);
  assert.ok(existsSync(cmd));
  const result = JSON.parse(process.platform === 'win32'
    ? execFileSync('cmd.exe', ['/c', cmd, ...args], launchOptions)
    : execFileSync(process.execPath, [launch, ...args], launchOptions));
  if (result.harness.spawned) launchedPid = result.harness.pid;
  assert.equal(result.harness.ready, true);
  assert.equal(new URL(result.pageUrl).searchParams.get('ai'), `http://127.0.0.1:${port}`);
} finally {
  if (launchedPid) {
    try { process.kill(launchedPid); } catch {}
  }
  assert.equal(path.dirname(realpathSync(scratch)), realpathSync(work));
  try {
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 });
  } catch (error) {
    if (error.code !== 'EBUSY') throw error;
  }
}
console.log('verify-course-ai PASS');
