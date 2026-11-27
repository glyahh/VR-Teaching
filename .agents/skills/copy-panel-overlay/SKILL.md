---
name: copy-panel-overlay
description: 调整长征课左下短讲述、沿用讲述框呈现的热点说明或片头四站时间轴的布局、内容和进度时使用。现有底色的选用见项目的《长征课 UI 背景与状态规范》。
---

# 10%透明度文案装用背景板

片头四站时间轴和课页左下讲述框使用课件的 `.copy-panel`。左下讲述框也负责展示同一位置的热点说明。底色与状态统一按[长征课 UI 背景与状态规范](<../../../项目文档/规范/长征课 UI 背景与状态规范.md>)选用。若任务涉及重新排列章节和翻页按钮，用[课件贴底导航栏](../lesson-bottom-rail/SKILL.md)判断底栏布局。

- 由对应组件负责位置、内容和状态。讲述框沿用 [narration.ts](../../../课堂演示/src/narration.ts) 的排版与进度，片头时间轴沿用 [opening-overlay.ts](../../../课堂演示/src/opening-overlay.ts) 的视频时钟。
- 在实际明暗课页和窄窗检查文字、进度标记、背景透出及面板边界。沿用 `Test/course_cli.py run opening`、`run entry`、`run narration` 中与本次入口对应的检查。
