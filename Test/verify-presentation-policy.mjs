import assert from 'node:assert/strict';
import { assertPresentationDirectory, assertPresentationSource } from '../课堂演示/page-policy.mjs';

const previousMarkup = [
  "tools.append(zoomTools,element('p','','路线示意'));",
  "preview.append(thumb,element('span','','情境示意'));",
  "const num = element('span','probe-num',String(idx + 1));",
  "const hintBar = page.hint ? element('p','scene-hint',page.hint) : undefined;",
  "const credit = element('span','desk-live-credit','教学情境复原');",
  '.evidence-chip[data-locked=true] strong::after{content:"  ✓ 已拼入";}',
  "const callout = element('article','probe-callout');",
  "const expandAll = syncControl(allKey,'展开全部',()=>{},'panel-all-btn');",
  "const revealAll = syncControl('reveal-result','直接揭示全部结论',()=>{});",
  '<progress id="river-time" max="1" value="0" aria-label="本段演示进度" hidden></progress>',
];
for (const source of previousMarkup) {
  assert.throws(()=>assertPresentationSource('旧课件片段',source), /删除画面|共用圆点|课页的 addHotspot|逐项展开|步骤箭头/);
}
assert.doesNotThrow(()=>assertPresentationSource('必要材料和提示',
  "element('p','','两组数字对应不同统计时点。'); syncScenePoint('boat','船体',open,'hotspot');"));
assert.throws(()=>assertPresentationSource('文献引用', "element('p','','依据《中国共产党简史》整理。')"),
  /删除历史文献引用/);
await assertPresentationDirectory(new URL('../课堂演示/src/',import.meta.url));
await assertPresentationDirectory(new URL('../课堂演示/自由探索实验/',import.meta.url));
console.log(`旧课件的 ${previousMarkup.length} 个回归片段均被拦截，当前两套界面源码通过检查。`);
