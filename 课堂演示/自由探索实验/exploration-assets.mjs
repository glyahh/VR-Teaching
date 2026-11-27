import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { assertDemoTemplate, assertPresentationDirectory } from '../page-policy.mjs';

const assetsRoot = new URL('../assets/', import.meta.url);
const mimeTypes = {
  glb: 'application/gzip', jpg: 'image/jpeg', png: 'image/png',
  mp4: 'video/mp4', mp3: 'audio/mpeg',
};
const riverFiles = [
  'river-boat.glb', 'river-crowd.glb',
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

export async function readEmbeddedAsset(path) {
  const extension = path.split('.').at(-1);
  const mime = mimeTypes[extension];
  if (!mime) throw new Error(`无法内嵌未知格式的资源：${path}`);
  const bytes = await readFile(new URL(path, assetsRoot));
  const data = extension === 'glb' ? gzipSync(bytes) : bytes;
  return `data:${mime};base64,${data.toString('base64')}`;
}

function explorationFiles(riverExplorationOnly) {
  const riverExtras = riverExplorationOnly
    ? ['river-meadow.jpg', 'river-meadow-normal.jpg', 'river-reflections.jpg', 'river-calm-normal.png'] : ['river-people.glb'];
  return {
    river: [...riverFiles, ...riverExtras].map(file => 'yudu-river/' + file),
    hall: hallFiles.map(file => 'zunyi-hall/' + file),
  };
}

function assetKey(path) {
  return path.split('/').at(-1).split('.')[0];
}

export function courseExplorationGroups() {
  const {river, hall} = explorationFiles(true);
  return {
    'yudu-river': river.map(assetKey).filter(key => key !== 'river-crowd'),
    'zunyi-hall': [...hall.map(assetKey), 'river-tree-far', 'river-grass'],
  };
}

export async function readExplorationAssets({ riverExplorationOnly = false } = {}) {
  const {river, hall} = explorationFiles(riverExplorationOnly);
  const paths = ['terrain.jpg', ...river, ...hall];
  const entries = await Promise.all(paths.map(async path => {
    return [assetKey(path), await readEmbeddedAsset(path)];
  }));
  return Object.fromEntries(entries);
}

export function readLessonRailStyle() {
  return readFile(new URL('lesson-rails.css', import.meta.url), 'utf8');
}

export const explorationHtml = {
  name: 'exploration-html',
  setup(bundle) {
    bundle.onLoad({filter:/\.html$/}, async ({path}) => ({
      contents: (await readFile(path,'utf8')).replace(/\r\n/g,'\n'),
      loader: 'text',
    }));
  },
};

export async function readExplorationStyle() {
  await assertPresentationDirectory(new URL('./',import.meta.url));
  const [css, rails, grain] = await Promise.all([
    readFile(new URL('exploration-stage.css', import.meta.url), 'utf8'),
    readLessonRailStyle(),
    readEmbeddedAsset('yudu-river/frost-grain.jpg'),
  ]);
  return css.replace('/* FROST_GRAIN */', grain) + '\n' + rails;
}

export async function buildExplorationStage() {
  for (const file of ['walk-controls.html', 'river-controls.html', 'exploration-reading.html']) {
    assertDemoTemplate(await readFile(new URL(file, import.meta.url), 'utf8'));
  }
  const [bundle, notice] = await Promise.all([
    build({
      entryPoints: [fileURLToPath(new URL('exploration-stage.js', import.meta.url))],
      bundle: true, minify: true, write: false, format: 'iife', globalName: 'explorationStage',
      target: 'edge120', legalComments: 'inline', plugins: [explorationHtml],
    }),
    readFile(new URL('node_modules/three/LICENSE', import.meta.url), 'utf8'),
  ]);
  return ('/* Three.js r180\n' + notice.trim() + '\n*/\n' + bundle.outputFiles[0].text)
    .replace(/[^\S\r\n]+$/gm, '')
    .replace(/<\/script/gi, '<\\/script');
}
