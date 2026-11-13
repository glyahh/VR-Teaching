import { readFile, writeFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

const read = (path, encoding) => readFile(new URL(path, import.meta.url), encoding);
const assets = {};
for (const name of ['terrain','yudu','xiang','zunyi']) {
  assets[name] = 'data:image/png;base64,' + (await read('./assets/'+name+'.png')).toString('base64');
  if (name !== 'terrain') {
    assets[name+'-video'] = 'data:video/mp4;base64,' + (await read('./assets/'+name+'.mp4')).toString('base64');
  }
}
const content = (await read('./src/content.ts','utf8')).replace(/^export /gm,'');
const script = stripTypeScriptTypes(await read('./src/app.ts','utf8'));
const css = await read('./src/style.css','utf8');
const html = (await read('./src/index.html','utf8'))
  .replace('/* COURSE_STYLES */',()=>css)
  .replace('/* COURSE_SCRIPT */',()=>'const mediaAssets = '+JSON.stringify(assets)+';\n'+content+'\n'+script);
await writeFile(new URL('./从于都到遵义-课堂演示.html',import.meta.url),html);
