import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { assertDemoTemplate, assertPresentationDirectory } from '../page-policy.mjs';

const assetsRoot = new URL('../assets/', import.meta.url);
const mimeTypes = { glb: 'application/gzip', jpg: 'image/jpeg', png: 'image/png' };
const riverFiles = [
  'river-boat.glb', 'river-people.glb', 'river-crowd.glb',
  'river-tree.glb', 'river-tree-far.glb', 'river-grass.glb', 'river-rock.glb',
  'river-ground.jpg', 'river-ground-normal.jpg', 'river-timber.jpg', 'river-timber-normal.jpg',
  'river-timber-rough.jpg', 'river-soil.jpg', 'water-normal.png',
];
const hallFiles = [
  'hall-model.glb', 'furniture.glb', 'folio.glb',
  'brick.jpg', 'brick-normal.jpg', 'wood.jpg', 'wood-normal.jpg', 'plaster.jpg', 'plaster-normal.jpg',
];
const notebook = JSON.parse(await readFile(new URL('notebook.json', import.meta.url), 'utf8'));
for (let page = 2; page <= notebook.length; page++) hallFiles.push('folio-page-' + page + '.jpg');

export async function readExplorationAssets() {
  const paths = ['terrain.jpg', ...riverFiles.map(file => 'yudu-river/' + file),
    ...hallFiles.map(file => 'zunyi-hall/' + file)];
  const entries = await Promise.all(paths.map(async path => {
    const [name, extension] = path.split('/').at(-1).split('.');
    const bytes = await readFile(new URL(path, assetsRoot));
    const data = extension === 'glb' ? gzipSync(bytes) : bytes;
    return [name, 'data:' + mimeTypes[extension] + ';base64,' + data.toString('base64')];
  }));
  return Object.fromEntries(entries);
}

export function readLessonRailStyle() {
  return readFile(new URL('lesson-rails.css', import.meta.url), 'utf8');
}

export async function readExplorationStyle() {
  await assertPresentationDirectory(new URL('./',import.meta.url));
  const [css, rails, grain] = await Promise.all([
    readFile(new URL('exploration-stage.css', import.meta.url), 'utf8'),
    readLessonRailStyle(),
    readFile(new URL('yudu-river/frost-grain.jpg', assetsRoot)),
  ]);
  return css.replace('/* FROST_GRAIN */', 'data:image/jpeg;base64,' + grain.toString('base64')) + '\n' + rails;
}

export async function buildExplorationStage() {
  for (const file of ['walk-controls.html', 'river-controls.html', 'exploration-reading.html']) {
    assertDemoTemplate(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  const [bundle, notice] = await Promise.all([
    build({
      entryPoints: [fileURLToPath(new URL('exploration-stage.js', import.meta.url))],
      bundle: true, minify: true, write: false, format: 'iife', globalName: 'explorationStage',
      target: 'edge120', legalComments: 'inline', loader: { '.html': 'text' },
    }),
    readFile(new URL('node_modules/three/LICENSE', import.meta.url), 'utf8'),
  ]);
  return ('/* Three.js r180\n' + notice.trim() + '\n*/\n' + bundle.outputFiles[0].text)
    .replace(/[^\S\r\n]+$/gm, '')
    .replace(/<\/script/gi, '<\\/script');
}
