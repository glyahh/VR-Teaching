# 课件验收

- 可从命令行直接运行的验收入口放在本目录，复用的 Python 操作与断言放在 `support/`。需要随代码分发的测试输入随对应验收保存。
- [course_cli.py](course_cli.py) 用真实课页执行课堂操作。改课页时用 `python -B "Test/course_cli.py" run <功能名>`，改媒体或三维时选相应的 `verify-*.py`。
- 正式课件与预览的选择、证据目录和离线要求见[长征课验收技能](../.agents/skills/verify-long-march-course/SKILL.md)。本轮报告、截图、录屏和临时试验放在仓库根目录的 `.march-build/`。
- 流程回归优先用稳定的操作标识定位控件，验点击、键盘操作和状态结果。按钮文案、字号、形状和样式可随设计调整。涉及布局时验证控件可见、可操作和不遮挡主要内容。字幕、史料文字等教学内容仍按各自要求核对。
- 用 `python -B "Test/run-course-ci.py" plan --full` 生成全量验收清单，再用同脚本的 `run` 执行。普通 CI 默认使用短清单，多尺寸和三维专项可按场景单独运行。
