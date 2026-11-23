# 章节和课堂投影

## 子功能

地图入章、主控操作、投影跟随、重连、练习及回顾。四档课时按原有课序核对。

## 如何进入

地图点「开始双屏授课」，然后点「开始授课」。课堂中可使用章节导航、上一页和下一页，结尾进入「课堂回顾」。

## 用 CLI 操作

把以下数组写入临时 `flow.json`，再运行 `python -B "Test/course_cli.py" play flow.json`。可以通过 `window` 选择 `teacher` 或 `projection`。`click` 可用 `button` 名称或 `selector`，`drag` 用 `from` 和 `to` 或 `dx`、`dy`，`wheel` 支持 `selector`、`dy`。检查用 `expect`，截图用 `shot`。

```json
[
  {"do":"project"},
  {"do":"click","button":"开始授课"},
  {"do":"click","button":"进入课堂"},
  {"do":"window","target":"projection"},
  {"do":"expect","selector":".scene-head h1","text":"于都集结"},
  {"do":"shot","name":"投影于都集结"}
]
```

要从头跑到回顾并验四档课时，使用 `python -B "Test/verify-dual.py"`。

## 易错处

投影可视范围只含讲述和教师揭示的材料。关窗后用 `close-projection` 再 `project` 走真实重开入口。观察读页和场景位置恢复，留意上一次进入的消息是否影响当前课页。
