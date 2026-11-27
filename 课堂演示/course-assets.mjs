import { readFile } from 'node:fs/promises';
import { readEmbeddedAsset, readExplorationAssets } from './自由探索实验/exploration-assets.mjs';

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
}

export async function readCourseAssets() {
  const assets = await readExplorationAssets({riverExplorationOnly: true});
  assets.elevation = await readEmbeddedAsset('elevation.png');
  for (const name of ['yudu', 'xiang', 'zunyi']) {
    assets[name] = await readEmbeddedAsset(name + '.png');
    assets[name + '-video'] = await readEmbeddedAsset(name + '.mp4');
  }

  const [riverCaptions, riverShots, riverTourOrder] = await Promise.all([
    readJson('./media-source/yudu-voice-captions.json'),
    readJson('./media-source/yudu-shorts-qa.json'),
    readJson('./media-source/yudu-river-tour-order.json'),
  ]);
  let riverFrames = 0;
  assets['river-tour-cues'] = JSON.stringify(riverTourOrder.map(key => {
    const shot = riverShots.find(item => item.key === key);
    const text = riverCaptions[key];
    if (shot?.fps !== 24 || !text) throw new Error(`于都河岸分镜缺少字幕或帧率不一致：${key}`);
    riverFrames += shot.source_out_exclusive - shot.source_in;
    return {until: riverFrames / 24, text};
  }));
  assets['river-tour-video'] = await readEmbeddedAsset('yudu-river/shorts/river-tour.mp4');
  assets['river-tour-poster'] = await readEmbeddedAsset(`yudu-river/shorts/${riverTourOrder[0]}-start.jpg`);
  assets['river-tour-end-poster'] = await readEmbeddedAsset(`yudu-river/shorts/${riverTourOrder.at(-1)}-end.jpg`);

  let xiangSeconds = 0;
  const xiangShots = await readJson('./media-source/xiang-crossing-tour.json');
  assets['xiang-tour-cues'] = JSON.stringify(xiangShots.map(({seconds, text}) => {
    xiangSeconds += seconds;
    return {until: xiangSeconds, text};
  }));
  for (const [key, file] of [['video', 'tour.mp4'], ['poster', 'start.jpg'], ['end-poster', 'end.jpg']]) {
    assets[`xiang-tour-${key}`] = await readEmbeddedAsset('xiang-crossing/' + file);
  }
  assets['yudu-preparation-video'] = await readEmbeddedAsset('yudu-preparation.mp4');
  for (const name of ['yudu-bank', 'yudu-bridge', 'xiang-ford', 'liping-street', 'liping-table',
    'yudu-assembly', 'xiang-aftermath', 'wujiang', 'zunyi-dawn', 'desk-front', 'desk-world-front',
    'desk-world-left', 'desk-world-right', 'desk-world-top']) {
    assets[name] = await readEmbeddedAsset(name + '.jpg');
  }
  for (const [key, file] of [
    ['opening-video', 'opening.mp4'], ['ambient-river', 'ambient-river.mp3'],
    ['recap-cello', 'recap-cello.mp3'], ['desk-world', 'desk-world.glb'], ['desk-props', 'desk-props.glb'],
  ]) {
    assets[key] = await readEmbeddedAsset(file);
  }
  const deskManifest = await readJson('./assets/desk-space.json');
  if (!['left', 'right'].every(side => deskManifest.anchorUV?.[side]?.length === 2 &&
    deskManifest.anchorUV[side].every(value => Number.isFinite(value) && value >= 0 && value <= 1))) {
    throw new Error('精修场景缺少两册材料的机位坐标');
  }
  assets['desk-manifest'] = JSON.stringify(deskManifest);
  return assets;
}
