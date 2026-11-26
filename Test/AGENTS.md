# 课件验收

- 可从命令行直接运行的验收入口放在本目录，复用的 Python 操作与断言放在 `support/`。需要随代码分发的测试输入随对应验收保存。
- [course_cli.py](course_cli.py) 用真实课页执行课堂操作。改课页时用 `python -B "Test/course_cli.py" run <功能名>`，改媒体或三维时选相应的 `verify-*.py`。
- 正式课件与预览的选择、证据目录和离线要求见[长征课验收技能](../.agents/skills/verify-long-march-course/SKILL.md)。本轮报告、截图、录屏和临时试验放在仓库根目录的 `.march-build/`。
