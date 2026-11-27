---
name: lesson-bottom-rail
description: 调整长征课正式课页或地图的常驻底部导航时使用，适用于四站章节、上下页、练习入口或地图工具。影片字幕、播放进度和临时场内控件各有自己的布局。
---

# 课件贴底导航栏

章节与翻页底栏见 [lesson-page.ts](../../../课堂演示/src/lesson-page.ts)，地图站点和工具底栏见 [lesson-map.ts](../../../课堂演示/src/lesson-map.ts)。两处共用 [style.css](../../../课堂演示/src/style.css) 的 `.bottom-rail`。

- 章节或站点在左，翻页、练习入口或地图工具在右。分隔线到控件与控件到底边使用相同的留白。空间不足时在底栏内换行。
- 讲述框和展开的练习位于分隔线上方。回看课页沿用底栏承载其可用操作。沉浸短片的章节显隐及字幕避让沿用 [exploration-page.css](../../../课堂演示/src/exploration-page.css)。
- 从正常入口核对宽屏、窄窗和当前任务涉及的特殊状态。按入口选用 `Test/course_cli.py run entry`、`run controls`、`run narration` 或 `run recap`。
