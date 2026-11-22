import { readFile, readdir } from 'node:fs/promises';

export function assertDemoTemplate(template) {
  if (/<(?:a|area)\b[^>]*\bhref\s*=|<form\b[^>]*\baction\s*=/i.test(template)) {
    throw new Error('演示模板含页面跳转入口。场景和材料请使用课件内的按钮。');
  }
}

const presentationRules = [
  {
    matches: /(?:情[境景]|场景|路线|构图)示意|(?:教学)?情[境景]复原|已探查|已拼入/u,
    fix: '删除画面里的说明性标签，将来源与制作类型记录到素材说明。',
  },
  {
    matches: /\b(?:scene-hint|probe-progress|probe-num|probe-label|scene-illustration|review-illustration|desk-live-credit)\b/u,
    fix: '场景使用主提示条。可点击热点通过共用圆点组件提供无障碍名称。',
  },
];

export function assertPresentationSource(name, source) {
  const problems = presentationRules.flatMap(({matches, fix}) => {
    const example = source.match(matches)?.[0];
    return example ? [name + ' 包含「' + example + '」。' + fix] : [];
  });
  if (problems.length) throw new Error(problems.join('\n'));
}

export async function assertPresentationDirectory(directory) {
  for (const entry of await readdir(directory, {withFileTypes:true})) {
    if (!entry.isFile() || !/\.(?:ts|js|html|css)$/i.test(entry.name)) continue;
    assertPresentationSource(entry.name, await readFile(new URL(entry.name,directory), 'utf8'));
  }
}
