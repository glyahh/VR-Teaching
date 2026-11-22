import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { assertDemoTemplate, assertPresentationDirectory } from './page-policy.mjs';
import { buildExplorationStage, readExplorationStyle, readExplorationAssets, readLessonRailStyle } from './自由探索实验/exploration-assets.mjs';

const read = (path, encoding) => readFile(new URL(path, import.meta.url), encoding);
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
  ['desk-left','desk-view-left.jpg','image/jpeg'],
  ['desk-right','desk-view-right.jpg','image/jpeg'],
  ['desk-mesh','desk-space.bin.gz','application/gzip'],
  ['opening-video','opening.mp4','video/mp4'],
]) {
  assets[key] = 'data:'+mime+';base64,'+(await read('./assets/'+filename)).toString('base64');
}
const deskManifest = JSON.parse(await read('./assets/desk-space.json','utf8'));
if (!['left','right'].every(side => deskManifest.anchorUV?.[side]?.length === 2 &&
  deskManifest.anchorUV[side].every(value => Number.isFinite(value) && value >= 0 && value <= 1))) {
  throw new Error('精修场景缺少两册材料的机位坐标');
}
assets['desk-manifest'] = JSON.stringify(deskManifest);
const leafLayout = JSON.parse(await read('./assets/desk-leaf.json','utf8'));
if (!Number.isInteger(leafLayout.count) || leafLayout.count<2 || !Number.isInteger(leafLayout.columns) ||
    leafLayout.columns<1 || ![leafLayout.size, leafLayout.cell].every(pair=>Array.isArray(pair) &&
      pair.length===2 && pair.every(value=>Number.isInteger(value)&&value>0)) ||
    !Array.isArray(leafLayout.crop) || leafLayout.crop.length!==4 ||
    !leafLayout.crop.every(value=>Number.isInteger(value)&&value>=0) ||
    leafLayout.crop[0]>=leafLayout.crop[2] || leafLayout.crop[1]>=leafLayout.crop[3] ||
    leafLayout.crop[2]>leafLayout.size[0] || leafLayout.crop[3]>leafLayout.size[1]) {
  throw new Error('手记开合图的尺寸或索引不正确');
}
if (leafLayout.sourceSha256 !== createHash('sha256').update(await read('./assets/desk-action.mp4')).digest('hex')) {
  throw new Error('翻页短片已更新，请先运行 make_leaf_strip.py');
}
assets['desk-leaf-layout'] = JSON.stringify(leafLayout);
assets['desk-leaf'] = 'data:image/webp;base64,'+(await read('./assets/desk-leaf.webp')).toString('base64');
const readScript = async path => stripTypeScriptTypes(await read(path,'utf8')).replace(/[^\S\r\n]+$/gm,'');
const content = (await readScript('./src/content.ts')).replace(/^export /gm,'');
const terrain = await readScript('./src/terrain.ts');
const cinemagraph = await readScript('./src/cinemagraph.ts');
const deskSpace = await readScript('./src/desk-space.ts');
const deskInquiry = await readScript('./src/desk-inquiry.ts');
const deskPlayer = await readScript('./src/desk-player.ts');
const practice = await readScript('./src/practice.ts');
const teaching = await readScript('./src/teaching.ts');
const explorationPage = await readScript('./src/exploration-page.ts');
const script = await readScript('./src/app.ts');
const presenter = await readScript('./src/presenter.ts');
const [exploration, explorationCss, pageCss] = await Promise.all([
  buildExplorationStage(), readExplorationStyle(), read('./src/exploration-page.css', 'utf8'),
]);
const css = [(await read('./src/style.css','utf8')), (await read('./src/desk-player.css','utf8')), explorationCss, pageCss].join('\n');
const template = await read('./src/index.html','utf8');
assertDemoTemplate(template);
const html = template
  .replace('/* COURSE_STYLES */',()=>css)
  .replace('/* COURSE_SCRIPT */',()=>'const mediaAssets = '+JSON.stringify(assets)+';\n'+[exploration,content,terrain,cinemagraph,deskSpace,deskInquiry,deskPlayer,practice,teaching,explorationPage,script,presenter].join('\n'));
async function writeArtifact(destination, content) {
  const staging = new URL('./.course-'+randomUUID()+'.tmp',destination);
  try {
    await writeFile(staging,content,{flag:'wx'});
    await rename(staging,destination);
  } finally {
    await rm(staging,{force:true});
  }
}

const showcase = new URL('../展示材料/成果展示/',import.meta.url);
const showcasePage = new URL('成果与计划.html',showcase);
const showcaseHtml = await readFile(showcasePage,'utf8');
const railMarker = /(\/\* BEGIN LESSON RAILS \*\/)[\s\S]*?(\/\* END LESSON RAILS \*\/)/;
if (!railMarker.test(showcaseHtml)) throw new Error('成果展示缺少共用导航样式的打包标记');
const lessonRailStyle = (await readLessonRailStyle()).trim();
const updatedShowcase = showcaseHtml.replace(railMarker,(_,start,end)=>start+'\n'+lessonRailStyle+'\n'+end);
await writeArtifact(new URL('./从于都到遵义-课堂演示.html',import.meta.url),html);
await writeArtifact(new URL('课堂预览.html',showcase),html);
if (updatedShowcase !== showcaseHtml) await writeArtifact(showcasePage,updatedShowcase);
