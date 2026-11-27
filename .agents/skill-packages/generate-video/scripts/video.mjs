import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createWriteStream, openAsBlob } from 'node:fs';
import { link, mkdir, open, rm } from 'node:fs/promises';
import { basename, dirname, extname, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parseArgs } from 'node:util';

const endpoint = 'https://sraiapi.com/v1/videos';
const imageTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

function apiKey() {
  if (process.env.SRAPI_API_KEY?.trim()) return process.env.SRAPI_API_KEY.trim();
  if (process.platform === 'win32') {
    try {
      const windowsKey = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', [
        "$ErrorActionPreference = 'Stop'",
        "$env:PSModulePath = Join-Path $PSHOME 'Modules'",
        "$file = Join-Path $env:LOCALAPPDATA 'VR Teaching/SRAPI/api-key.dpapi'",
        '$value = ConvertTo-SecureString (Get-Content -LiteralPath $file -Raw).Trim()',
        '[Net.NetworkCredential]::new([string]::Empty, $value).Password',
      ].join('; ')], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true }).trim();
      if (windowsKey) return windowsKey;
    } catch {
      // A missing or unreadable credential is reported without its contents.
    }
  }
  throw new Error('缺少可读取的 SRAPI 密钥。请设置 SRAPI_API_KEY 或配置当前用户的 Windows 加密凭据。');
}

async function request(suffix, method, body, contentType) {
  const headers = { Authorization: `Bearer ${apiKey()}` };
  if (contentType) headers['Content-Type'] = contentType;
  let response;
  try {
    response = await fetch(endpoint + suffix, {
      method, headers, body, redirect: 'error', signal: AbortSignal.timeout(120_000),
    });
  } catch {
    const hint = method === 'POST' ? '受理状态未知，先查 SRAPI 任务记录，避免重复计费。' : '请稍后查询或下载原任务。';
    throw new Error(`SRAPI 请求未取得响应。${hint}`);
  }
  if (!response.ok) {
    const uncertain = method === 'POST' && (response.status === 408 || response.status >= 500);
    throw new Error(`SRAPI HTTP ${response.status}。${uncertain ? '受理状态未知，先查任务记录。' : ''}`);
  }
  return response;
}

async function imageFile(form, field, path) {
  const type = imageTypes[extname(path).toLowerCase()];
  if (!type) throw new Error('参考图须为 PNG、JPEG 或 WebP。');
  form.append(field, await openAsBlob(path, { type }), basename(path));
}

function taskPath(id) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,220}$/.test(id)) {
    throw new Error('需要有效的 SRAPI 任务 ID。若提交结果未知，先查原任务记录。');
  }
  return `/${id}`;
}

async function submit(options) {
  const { prompt, model = 'MiniMax-H3', resolution = '480p', size = '854x480' } = options;
  const seconds = Number(options.seconds ?? 4);
  const maxSeconds = /seedance.*2\.5/i.test(model) ? 30 : 15;
  if (!prompt?.trim() || !Number.isInteger(seconds) || seconds < 4 || seconds > maxSeconds) {
    throw new Error(`需要提示词与 4 至 ${maxSeconds} 秒的整数时长。`);
  }
  if (!/^\d+x\d+$/.test(size)) throw new Error('画幅像素须采用 WIDTHxHEIGHT 格式。');
  const mode = options.mode ?? 'text';
  const refs = options.image ?? [];
  const first = options['first-frame'];
  const last = options['last-frame'];
  if (!['text', 'reference', 'frames'].includes(mode)
    || (mode === 'reference' ? !refs.length || first || last : refs.length)
    || (mode === 'frames' ? !first : first || last)) {
    throw new Error('text 只用提示词，reference 需 --image，frames 需 --first-frame 并可加 --last-frame。');
  }
  const fields = { model, prompt, seconds, size };
  let response;
  if (mode === 'text') {
    response = await request('', 'POST', JSON.stringify({ ...fields, resolution }), 'application/json');
  } else {
    const form = new FormData();
    for (const [name, value] of Object.entries({ ...fields, resolution_name: resolution, mode })) {
      form.append(name, String(value));
    }
    for (const path of refs) await imageFile(form, 'image[]', path);
    if (first) await imageFile(form, 'first_frame', first);
    if (last) await imageFile(form, 'last_frame', last);
    response = await request('', 'POST', form);
  }
  const result = await response.json().catch(() => null);
  taskPath(result?.id);
  return { id: result.id, status: result.status };
}

async function download(id, file) {
  if (!file || extname(file).toLowerCase() !== '.mp4') throw new Error('下载需要指定 .mp4 输出路径。');
  const output = resolve(file);
  const temporary = `${output}.${randomUUID()}.part`;
  const response = await request(`${taskPath(id)}/content`, 'GET');
  await mkdir(dirname(output), { recursive: true });
  try {
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary, { flags: 'wx' }));
    const media = await open(temporary, 'r');
    const header = Buffer.alloc(12);
    try {
      await media.read(header, 0, header.length, 0);
      if (header.toString('ascii', 4, 8) !== 'ftyp') throw new Error('SRAPI 返回内容不是 MP4。');
    } finally {
      await media.close();
    }
    await link(temporary, output);
    return { id, output };
  } finally {
    await rm(temporary, { force: true });
  }
}

const [command, ...args] = process.argv.slice(2);
try {
  const { values } = parseArgs({
    args,
    options: {
      prompt: { type: 'string' }, model: { type: 'string' }, seconds: { type: 'string' },
      resolution: { type: 'string' }, size: { type: 'string' }, mode: { type: 'string' },
      image: { type: 'string', multiple: true }, 'first-frame': { type: 'string' },
      'last-frame': { type: 'string' }, id: { type: 'string' }, output: { type: 'string' },
    },
  });
  if (command === 'submit') {
    console.log(JSON.stringify(await submit(values)));
  } else if (command === 'status') {
    const result = await (await request(taskPath(values.id), 'GET')).json();
    console.log(JSON.stringify({ id: values.id, status: result.status, progress: result.progress }));
  } else if (command === 'download') {
    console.log(JSON.stringify(await download(values.id, values.output)));
  } else {
    console.log('用法：video.mjs submit --prompt <描述> [--mode text|reference|frames]，status --id <任务>，download --id <任务> --output <文件.mp4>');
    if (command !== undefined && command !== 'help') process.exitCode = 1;
  }
} catch (error) {
  console.error(error.code ? `操作失败：${error.code}` : error.message);
  process.exitCode = 1;
}
