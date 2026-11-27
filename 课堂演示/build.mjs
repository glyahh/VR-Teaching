import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { randomUUID } from 'node:crypto';
import { courseAssetGroups, readCourseAssets } from './course-assets.mjs';
import { assertDemoTemplate, assertPresentationDirectory } from './page-policy.mjs';
import { buildExplorationStage, readExplorationStyle, readLessonRailStyle } from './自由探索实验/exploration-assets.mjs';

const read = (path, encoding) => readFile(new URL(path, import.meta.url), encoding);
const args = process.argv.slice(2);
const mode = args[0];
if (args.length > 1 || (mode && mode !== '--preview' && mode !== '--check')) {
  throw new Error('用法 node 课堂演示/build.mjs [--preview | --check]');
}
const normalize = text => text.replace(/\r\n/g, '\n');
await assertPresentationDirectory(new URL('./src/',import.meta.url));
const assets = await readCourseAssets();
// The standalone HTML runs these classic scripts in order. lesson-session starts the course.
const scriptNames = [
  'course-media', 'soundscape', 'content', 'terrain', 'cinemagraph', 'desk-state', 'desk-live-session',
  'desk-reader', 'desk-player', 'harness-bridge', 'course-developer', 'practice', 'exploration-page', 'page-entry', 'narration',
  'scene-lesson', 'story-scenes', 'map-card', 'recap-stage', 'opening-overlay',
  'lesson-map', 'lesson-page', 'scene-video', 'app', 'route-scenes', 'lesson-session',
];
const scripts = await Promise.all(scriptNames.map(async name => {
  const source = await read(`./src/${name}.ts`, 'utf8');
  return stripTypeScriptTypes(source).replace(/[^\S\r\n]+$/gm, '');
}));
const [exploration, explorationCss, pageCss] = await Promise.all([
  buildExplorationStage(), readExplorationStyle(), read('./src/exploration-page.css', 'utf8'),
]);
const css = [(await read('./src/style.css','utf8')), (await read('./src/recap-finale.css','utf8')),
  (await read('./src/story-scenes.css','utf8')), (await read('./src/desk-player.css','utf8')), explorationCss, pageCss].join('\n');
const template = await read('./src/index.html','utf8');
assertDemoTemplate(template);
const onDemand = new Set(['elevation', 'opening-video', ...courseAssetGroups.desk,
  ...Object.values(courseAssetGroups).flat(), 'river-crowd']);
for (const [key, value] of Object.entries(assets)) {
  if (value.startsWith('data:video/')) onDemand.add(key);
}
const mediaTypes = {};
const chunks = [];
for (const key of onDemand) {
  const [header, data] = assets[key].split(',', 2);
  mediaTypes[key] = header.slice('data:'.length, -';base64'.length);
  const chunkSize = 256 * 1024;
  for (let offset = 0; offset < data.length; offset += chunkSize) {
    const id = offset === 0 ? ` id="course-data-${key}"` : '';
    chunks.push(`<script type="application/x-course-asset"${id}>${data.slice(offset, offset + chunkSize)}</script>`);
  }
  chunks.push(`<span hidden id="course-end-${key}"></span>`);
  delete assets[key];
}
const script = `const mediaAssets = ${JSON.stringify(assets)};\n` +
  `const courseMediaTypes = ${JSON.stringify(mediaTypes)};\nconst courseAssetGroups = ${JSON.stringify(courseAssetGroups)};\n` +
  [exploration, ...scripts].join('\n');
if (Buffer.byteLength(script) >= 20 * 1024 ** 2) throw new Error('课件启动脚本须小于 20 MiB。');
const html = normalize(template
  .replace('/* COURSE_STYLES */',()=>css)
  .replace('/* COURSE_SCRIPT */',()=>script)
  .replace('<!-- COURSE_ASSETS -->',()=>chunks.join('\n')));
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
