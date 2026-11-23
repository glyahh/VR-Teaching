import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const cwd = fileURLToPath(new URL('../', import.meta.url));

function git(...args) {
  return execFileSync('git', ['--literal-pathspecs', ...args], { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function commit(ref) {
  return git('rev-parse', '--verify', '--end-of-options', ref + '^{commit}').trim();
}

function filePath(value) {
  const path = value.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!path || /^[A-Za-z]:|^\//.test(path) || path.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('范围请使用仓库内的文件路径。收到 ' + value);
  }
  return path;
}

function parseRanges(values) {
  const ranges = new Map();
  for (const value of values) {
    const match = /^(.+):([1-9]\d*)-([1-9]\d*)$/.exec(value);
    if (!match || Number(match[2]) > Number(match[3])) {
      throw new Error('--range 需要文件名和基线行号，例如 课堂演示/src/app.ts:775-828');
    }
    const path = filePath(match[1]);
    const intervals = ranges.get(path) ?? [];
    intervals.push([Number(match[2]), Number(match[3])]);
    ranges.set(path, intervals);
  }
  return ranges;
}

function checkScope({ base, target, allow, range }) {
  const paths = new Set(allow.map(filePath));
  const ranges = parseRanges(range);
  if (!paths.size && !ranges.size) throw new Error('请用 --allow 或 --range 声明这次要改的文件或区段。');
  for (const path of ranges.keys()) {
    if (paths.has(path)) throw new Error(path + ' 同时声明了整文件和区段。请按实际范围保留一种。');
  }

  const start = commit(base);
  const comparisons = (target ? [[start, commit(target)]] : [[start], ['--cached', start]]).map(refs => ({
    refs,
    files: new Set(git('diff', '--no-renames', '--no-ext-diff', '--name-only', '-z', ...refs, '--').split('\0').filter(Boolean)),
  }));
  const untracked = new Set(target ? [] : git('ls-files', '--others', '--exclude-standard', '-z').split('\0').filter(Boolean));
  const problems = new Set();
  const files = new Set([...comparisons.flatMap(item => [...item.files]), ...untracked]);
  for (const path of files) {
    if (paths.has(path)) continue;
    const intervals = ranges.get(path);
    if (!intervals || untracked.has(path)) {
      problems.add(path + ' 超出声明范围。');
      continue;
    }
    for (const comparison of comparisons) {
      if (!comparison.files.has(path)) continue;
      const patch = git('diff', '--no-renames', '--no-ext-diff', '--unified=0', ...comparison.refs, '--', path);
      const hunks = [...patch.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)];
      if (!hunks.length) problems.add(path + ' 有无法按文本行核对的改动。');
      for (const [, line, count] of hunks) {
        const length = Number(count ?? 1);
        const first = length ? Number(line) : Number(line) + 1;
        const last = first + Math.max(0, length - 1);
        if (!intervals.some(([lo, hi]) => lo <= first && last <= hi)) {
          problems.add(path + ' 的基线行 ' + first + '–' + last + ' 超出声明范围。');
        }
      }
    }
  }
  if (problems.size) throw new Error([...problems].join('\n'));
  console.log('改动范围通过，共核对 ' + files.size + ' 个文件。');
}

try {
  const { values } = parseArgs({
    options: {
      base: { type: 'string', default: 'HEAD' },
      target: { type: 'string' },
      allow: { type: 'string', multiple: true, default: [] },
      range: { type: 'string', multiple: true, default: [] },
    },
  });
  checkScope(values);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
