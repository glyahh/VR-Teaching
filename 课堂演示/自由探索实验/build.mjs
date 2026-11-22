import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertDemoTemplate } from '../page-policy.mjs';
import { readExplorationStyle, readExplorationAssets } from './exploration-assets.mjs';

const here = new URL('./', import.meta.url);
const root = new URL('../../', here);
const output = new URL('展示材料/遵义自由探索原型/', root);
const read = (path, encoding) => readFile(new URL(path, here), encoding);
const assets = await readExplorationAssets();

const [template, css, hallControls, riverControls, reading, sharedStyle, threeNotice, bundle] = await Promise.all([
  read('index.html', 'utf8'),
  read('style.css', 'utf8'),
  read('walk-controls.html', 'utf8'),
  read('river-controls.html', 'utf8'),
  read('exploration-reading.html', 'utf8'),
  readExplorationStyle(),
  read('node_modules/three/LICENSE', 'utf8'),
  build({
    entryPoints: [fileURLToPath(new URL('main.js', here))],
    bundle: true, minify: true, write: false, format: 'iife',
    target: 'edge120', legalComments: 'inline', loader: { '.html': 'text' },
  }),
]);

const license = 'Three.js r180\n' + threeNotice.trim();
const markup = template
  .replace('    <!-- WALK_CONTROLS -->', () => hallControls.trimEnd())
  .replace('    <!-- RIVER_CONTROLS -->', () => riverControls.trimEnd())
  .replace('    <!-- EXPLORATION_READING -->', () => reading.trimEnd());
assertDemoTemplate(markup);
await mkdir(output, { recursive: true });
const file = '室内与河岸-交互原型.html';
const code = 'const __ASSETS__ = ' + JSON.stringify(assets) + ';\n' + bundle.outputFiles[0].text;
const html = markup.replace('/* STYLES */', () => sharedStyle + '\n' + css)
  .replace('/* SCRIPT */', () => code.replace(/<\/script/gi, '<\\/script'));
const artifact = html + '\n<!--\n' + license.replaceAll('-->', '-- >') + '\n-->\n';
await writeFile(new URL(file, output), artifact);
console.log(file, Buffer.byteLength(artifact).toLocaleString(), '字节');
