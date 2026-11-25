import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { assertDemoTemplate, assertPresentationDirectory } from './page-policy.mjs';
import { buildExplorationStage, readExplorationStyle, readExplorationAssets, readLessonRailStyle } from './自由探索实验/exploration-assets.mjs';

const read = (path, encoding) => readFile(new URL(path, import.meta.url), encoding);
const args = process.argv.slice(2);
const mode = args[0];
if (args.length > 1 || (mode && mode !== '--preview' && mode !== '--check')) {
  throw new Error('用法 node 课堂演示/build.mjs [--preview | --check]');
}
const normalize = text => text.replace(/\r\n/g, '\n');
await assertPresentationDirectory(new URL('./src/',import.meta.url));
const assets = await readExplorationAssets();
assets.elevation = 'data:image/png;base64,' + (await read('./assets/elevation.png')).toString('base64');
for (const name of ['yudu','xiang','zunyi']) {
  assets[name] = 'data:image/png;base64,' + (await read('./assets/'+name+'.png')).toString('base64');
  assets[name+'-video'] = 'data:video/mp4;base64,' + (await read('./assets/'+name+'.mp4')).toString('base64');
}
assets['yudu-preparation-video'] = 'data:video/mp4;base64,' + (await read('./assets/yudu-preparation.mp4')).toString('base64');
for (const name of ['yudu-bank','yudu-bridge','xiang-ford','liping-street','liping-table','yudu-assembly','xiang-aftermath','wujiang','zunyi-dawn']) {
  assets[name] = 'data:image/jpeg;base64,' + (await read('./assets/'+name+'.jpg')).toString('base64');
}
for (const [key, filename, mime] of [
  ['desk-front','desk-front.jpg','image/jpeg'],
  ['desk-world-front','desk-world-front.jpg','image/jpeg'],
  ['desk-world-left','desk-world-left.jpg','image/jpeg'],
  ['desk-world-right','desk-world-right.jpg','image/jpeg'],
  ['desk-world-top','desk-world-top.jpg','image/jpeg'],
  ['opening-video','opening.mp4','video/mp4'],
  ['ambient-river','ambient-river.mp3','audio/mpeg'],
  ['recap-cello','recap-cello.mp3','audio/mpeg'],
]) {
  assets[key] = 'data:'+mime+';base64,'+(await read('./assets/'+filename)).toString('base64');
}
assets['desk-world'] = 'data:application/gzip;base64,'+gzipSync(await read('./assets/desk-world.glb')).toString('base64');
assets['desk-props'] = 'data:application/gzip;base64,'+gzipSync(await read('./assets/desk-props.glb')).toString('base64');
const deskManifest = JSON.parse(await read('./assets/desk-space.json','utf8'));
if (!['left','right'].every(side => deskManifest.anchorUV?.[side]?.length === 2 &&
  deskManifest.anchorUV[side].every(value => Number.isFinite(value) && value >= 0 && value <= 1))) {
  throw new Error('精修场景缺少两册材料的机位坐标');
}
assets['desk-manifest'] = JSON.stringify(deskManifest);
const readScript = async path => stripTypeScriptTypes(await read(path,'utf8')).replace(/[^\S\r\n]+$/gm,'');
const soundscapeScript = await readScript('./src/soundscape.ts');
const content = await readScript('./src/content.ts');
const terrain = await readScript('./src/terrain.ts');
const cinemagraph = await readScript('./src/cinemagraph.ts');
const deskState = await readScript('./src/desk-state.ts');
const deskSession = await readScript('./src/desk-live-session.ts');
const deskReader = await readScript('./src/desk-reader.ts');
const deskPlayer = await readScript('./src/desk-player.ts');
const practice = await readScript('./src/practice.ts');
const teaching = await readScript('./src/teaching.ts');
const explorationPage = await readScript('./src/exploration-page.ts');
const pageEntry = await readScript('./src/page-entry.ts');
const narration = await readScript('./src/narration.ts');
const sceneLesson = await readScript('./src/scene-lesson.ts');
const mapCard = await readScript('./src/map-card.ts');
const recapStage = await readScript('./src/recap-stage.ts');
const openingOverlay = await readScript('./src/opening-overlay.ts');
const script = await readScript('./src/app.ts');
const routeScenes = await readScript('./src/route-scenes.ts');
const presenter = await readScript('./src/presenter.ts');
const [exploration, explorationCss, pageCss] = await Promise.all([
  buildExplorationStage(), readExplorationStyle(), read('./src/exploration-page.css', 'utf8'),
]);
const css = [(await read('./src/style.css','utf8')), (await read('./src/desk-player.css','utf8')), explorationCss, pageCss].join('\n');
const template = await read('./src/index.html','utf8');
assertDemoTemplate(template);
const html = normalize(template
  .replace('/* COURSE_STYLES */',()=>css)
  .replace('/* COURSE_SCRIPT */',()=>'const mediaAssets = '+JSON.stringify(assets)+';\n'+[
    exploration,soundscapeScript,content,terrain,cinemagraph,deskState,deskSession,deskReader,deskPlayer,practice,teaching,explorationPage,
    pageEntry,narration,sceneLesson,mapCard,recapStage,openingOverlay,script,routeScenes,presenter,
  ].join('\n')));
async function writeArtifact(destination, content) {
  const staging = new URL('./.course-'+randomUUID()+'.tmp',destination);
  try {
    await writeFile(staging,content,{flag:'wx'});
    await rename(staging,destination);
  } finally {
    await rm(staging,{force:true});
  }
}

if (mode === '--preview') {
  const preview = new URL('../.march-build/课件预览/',import.meta.url);
  await mkdir(preview,{recursive:true});
  await writeArtifact(new URL('课堂预览.html',preview),html);
} else {
  const showcase = new URL('../展示材料/成果展示/',import.meta.url);
  const showcasePage = new URL('成果与计划.html',showcase);
  const showcaseHtml = await readFile(showcasePage,'utf8');
  const railMarker = /(\/\* BEGIN LESSON RAILS \*\/)[\s\S]*?(\/\* END LESSON RAILS \*\/)/;
  if (!railMarker.test(showcaseHtml)) throw new Error('成果展示缺少共用导航样式的打包标记');
  const lessonRailStyle = normalize(await readLessonRailStyle()).trim();
  const updatedShowcase = showcaseHtml.replace(railMarker,(_,start,end)=>start+'\n'+lessonRailStyle+'\n'+end);
  const coursePage = new URL('./从于都到遵义-课堂演示.html',import.meta.url);
  const classroomPreview = new URL('课堂预览.html',showcase);
  if (mode === '--check') {
    for (const path of [coursePage,classroomPreview]) {
      if (normalize(await readFile(path,'utf8')) !== html) {
        throw new Error(decodeURIComponent(path.pathname) + ' 与源码构建不符。请运行 node "课堂演示/build.mjs"。');
      }
    }
    if (normalize(updatedShowcase) !== normalize(showcaseHtml)) {
      throw new Error('成果页的共用导航样式与源码不符。请运行 node "课堂演示/build.mjs"。');
    }
    console.log('正式课件和成果预览与源码构建一致。');
  } else {
    await writeArtifact(coursePage,html);
    await writeArtifact(classroomPreview,html);
    if (normalize(updatedShowcase) !== normalize(showcaseHtml)) await writeArtifact(showcasePage,updatedShowcase);
  }
}
