# 单屏章节和课堂回顾

地图点「开始授课」及「进入课堂」可走完整课序。课堂中可用章节导航或翻页键，结尾进入「课堂回顾」。也可从地图选站进入对应章节。

`python -B "Test/course_cli.py" run single_screen` 检查首页、遵义章节、桌景和旧版投影链接的落点。要看讲述、条目、路线与课堂回顾，分别运行 `narration`、`disclosures`、`journeys` 和 `controls`。

把以下数组写入临时 `flow.json`，用 `python -B "Test/course_cli.py" play flow.json` 复跑。用 `click` 选按钮或选择器，`expect` 核对页面，`shot` 保存截图。

```json
[
  {"do":"click","button":"开始授课"},
  {"do":"click","button":"进入课堂"},
  {"do":"expect","selector":".scene-head h1","text":"于都集结"},
  {"do":"shot","name":"于都集结"}
]
```
