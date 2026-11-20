import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';

const read = (path, encoding) => readFile(new URL(path, import.meta.url), encoding);
const assets = {};
assets.terrain = 'data:image/jpeg;base64,' + (await read('./assets/terrain.jpg')).toString('base64');
assets.elevation = 'data:image/png;base64,' + (await read('./assets/elevation.png')).toString('base64');
for (const name of ['yudu','xiang','zunyi']) {
  assets[name] = 'data:image/png;base64,' + (await read('./assets/'+name+'.png')).toString('base64');
  assets[name+'-video'] = 'data:video/mp4;base64,' + (await read('./assets/'+name+'.mp4')).toString('base64');
}
for (const name of ['yudu-bank','yudu-bridge','xiang-ford','liping-street','liping-table','yudu-assembly','xiang-aftermath','wujiang','zunyi-dawn']) {
  assets[name] = 'data:image/jpeg;base64,' + (await read('./assets/'+name+'.jpg')).toString('base64');
}
for (const [key, filename, mime] of [
  ['desk-front','desk-front.jpg','image/jpeg'],
  ['desk-left','desk-view-left.jpg','image/jpeg'],
  ['desk-right','desk-view-right.jpg','image/jpeg'],
  ['desk-mesh','desk-space.bin.gz','application/gzip'],
  ['desk-action','desk-action.mp4','video/mp4'],
  ['desk-guide','desk-guide.mp4','video/mp4']
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
if (leafLayout.sourceSha256 !== createHash('sha256').update(Buffer.from(assets['desk-action'].split(',')[1],'base64')).digest('hex')) {
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
const script = await readScript('./src/app.ts');
const presenter = await readScript('./src/presenter.ts');
const css = (await read('./src/style.css','utf8'))+'\n'+(await read('./src/desk-player.css','utf8'));
const html = (await read('./src/index.html','utf8'))
  .replace('/* COURSE_STYLES */',()=>css)
  .replace('/* COURSE_SCRIPT */',()=>'const mediaAssets = '+JSON.stringify(assets)+';\n'+[content,terrain,cinemagraph,deskSpace,deskInquiry,deskPlayer,script,presenter].join('\n'));
const staging = new URL('./.course-'+randomUUID()+'.tmp',import.meta.url);
try {
  await writeFile(staging,html,{flag:'wx'});
  await rename(staging,new URL('./从于都到遵义-课堂演示.html',import.meta.url));
} finally {
  await rm(staging,{force:true});
}
