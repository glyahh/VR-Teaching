#!/usr/bin/env node
/**
 * 一键开课。检测正式课件，按模型配置启动本机课堂网关，然后打开浏览器。
 */

import { execFileSync, spawn } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { DEV_GRANT_TTL, DEV_REQUEST_ID, resolveCourseAIConfig, signDeveloperGrant } from './course-ai-server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COURSE_DIR = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(COURSE_DIR, '..');
const HTML_PATH = path.join(COURSE_DIR, '从于都到遵义-课堂演示.html');
const BUILD_SCRIPT = path.join(COURSE_DIR, 'build.mjs');
const SERVER_SCRIPT = path.join(HERE, 'course-ai-server.mjs');
const LOG_PATH = path.join(HERE, '.harness.log');

const argv = process.argv.slice(2);
const flag = name => {
  const idx = argv.indexOf(name);
  return idx >= 0 ? argv[idx + 1] : undefined;
};
const dryRun = argv.includes('--dry-run');
const mockHarness = argv.includes('--mock-harness');
const developerStart = argv.includes('--developer-start');
const requestId = flag('--developer-start');
const baseUrl = flag('--base-url');
const model = flag('--model');
const config = resolveCourseAIConfig({ baseUrl, model, port: flag('--port') });
const { port } = config;
const gatewayUrl = `http://127.0.0.1:${port}`;

async function probeHealth() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 500);
  try {
    const res = await fetch(`${gatewayUrl}/api/course-ai/health`, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    const engine = mockHarness ? 'course-ai-mock' : 'vercel-ai-sdk';
    return data?.ok && data.engine === engine && (mockHarness || data.model === config.model) ? data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function ensureCourseBuilt() {
  if (existsSync(HTML_PATH)) return false;
  execFileSync(process.execPath, [BUILD_SCRIPT], { cwd: REPO_ROOT, stdio: 'inherit' });
  return true;
}

async function ensureHarnessRunning() {
  if (!mockHarness && (!config.baseUrl || !config.model)) {
    return { ready: false, spawned: false, reason: 'no-model-config' };
  }
  const existing = await probeHealth();
  if (existing) return { ready: true, spawned: false, pid: existing.pid };

  if (developerStart) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return { ready: false, spawned: false, reason: 'invalid-port' };
    }
    const occupied = await new Promise(resolve => {
      const socket = createConnection({ host: '127.0.0.1', port });
      const finish = result => { socket.destroy(); resolve(result); };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(500, () => finish(false));
    });
    if (occupied) {
      const ready = await probeHealth();
      return ready ? { ready: true, spawned: false, pid: ready.pid }
        : { ready: false, spawned: false, reason: 'port-in-use' };
    }
    try {
      import.meta.resolve('ai');
      import.meta.resolve('@ai-sdk/openai-compatible');
    } catch {
      return { ready: false, spawned: false, reason: 'missing-dependencies' };
    }
  }

  const serverArgs = [SERVER_SCRIPT, '--port', String(port)];
  if (model) serverArgs.push('--model', model);
  if (baseUrl) serverArgs.push('--base-url', baseUrl);
  if (mockHarness) serverArgs.push('--mock-harness');

  const logFd = openSync(LOG_PATH, 'a');
  let child;
  try {
    child = spawn(process.execPath, serverArgs, {
      cwd: REPO_ROOT,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', logFd, logFd],
    });
  } finally {
    closeSync(logFd);
  }
  let startFailed = false;
  child.once('error', () => { startFailed = true; });
  child.unref();

  const deadline = Date.now() + 6500;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 250));
    const health = await probeHealth();
    if (health) return { ready: true, spawned: true, pid: child.pid ?? health.pid };
    if (startFailed || child.exitCode !== null) return { ready: false, spawned: false, reason: 'start-failed' };
  }
  return { ready: false, spawned: true, pid: child.pid, reason: 'timeout' };
}

function openBrowser(targetUrl) {
  if (process.platform === 'win32') {
    const child = spawn('cmd.exe', ['/c', 'start', '', targetUrl], {
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
    });
    child.unref();
  } else if (process.platform === 'darwin') {
    const child = spawn('open', [targetUrl], { detached: true, stdio: 'ignore' });
    child.unref();
  } else {
    const child = spawn('xdg-open', [targetUrl], { detached: true, stdio: 'ignore' });
    child.unref();
  }
}

async function main() {
  if (developerStart) {
    if (argv.length !== 2 || argv[0] !== '--developer-start' || !DEV_REQUEST_ID.test(requestId ?? '')) {
      process.exitCode = 1;
      return;
    }
    const dir = path.join(HERE, '.activation');
    mkdirSync(dir, { recursive: true });
    for (const name of readdirSync(dir)) {
      if (!/^[a-f0-9]{32}\.(js|tmp)$/.test(name)) continue;
      const entry = path.join(dir, name);
      try {
        if (Date.now() - statSync(entry).mtimeMs > DEV_GRANT_TTL) rmSync(entry, { force: true });
      } catch {}
    }
    const result = await ensureHarnessRunning().catch(() => ({ ready: false, reason: 'start-failed' }));
    const expiresAt = Date.now() + DEV_GRANT_TTL;
    const response = result.ready
      ? { gatewayUrl, expiresAt, proof: config.accessToken ? signDeveloperGrant(config.accessToken, requestId, expiresAt) : '' }
      : { reason: result.reason };
    const file = path.join(dir, `${requestId}.js`);
    const pending = path.join(dir, `${requestId}.tmp`);
    writeFileSync(pending, `window.dispatchEvent(new CustomEvent("course-ai-dev-handoff", {detail:${JSON.stringify({ nonce: requestId, ...response })}}));\n`, { flag: 'wx' });
    renameSync(pending, file);
    setTimeout(() => { try { rmSync(file, { force: true }); } catch {} }, DEV_GRANT_TTL);
    return;
  }
  const rebuilt = ensureCourseBuilt();
  const harness = await ensureHarnessRunning();
  const page = pathToFileURL(HTML_PATH);
  if (harness.ready || harness.spawned) page.searchParams.set('ai', gatewayUrl);
  if (dryRun) {
    console.log(JSON.stringify({ rebuilt, harness, pageUrl: page.href }, null, 2));
    return;
  }
  if (page.search && config.accessToken && !mockHarness) page.hash = `ai-access=${config.accessToken}`;
  openBrowser(page.href);
}

main().catch(err => {
  console.error('[一键开课] 启动失败:', err?.message || err);
  if (existsSync(HTML_PATH) && !dryRun) openBrowser(pathToFileURL(HTML_PATH).href);
  process.exitCode = 1;
});
