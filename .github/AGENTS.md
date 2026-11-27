# GitHub Actions

- 持续集成配置放在 `workflows/`。[长征课工作流](workflows/long-march-course.yml) 调用仓库现有的类型检查、构建检查和离线 Edge 验收。
- 每次从源码生成正式课件和成果预览，再检查类型、界面规则和打包产物，并在断网 Edge 实走单屏入口、片头、进场、遵义桌景和回顾。[`Test/run-course-ci.py`](../Test/run-course-ci.py) 检查发布成品是否误入 Git，并按路径加跑专项。共享播放器改动加跑界面控件、于都河岸和湘江渡口。共用构建、未映射的运行路径或无法比较 Git 基线时跑全量检查。
- Pull request 比较基线提交到实际检出的合并结果，push 比较更新前后的提交。浅检出缺少基线时按提交补取。断网回归使用 Ubuntu runner 预装的 Microsoft Edge，选中的检查分三组并行执行。任一检查失败时标记任务失败，其余组继续完成，并各自上传选测清单、课件 SHA-256、构建日志和浏览器证据。
- 更新路径或依赖后，从仓库根目录复跑受影响的命令。可复用的检查代码放在 [Test](../Test/AGENTS.md)。
- Ubuntu runner 在断网验收前安装 Noto CJK 字体。软件渲染使用半倍像素密度，测试窗口的布局尺寸照原值执行。正式课件画质和教室投影用 Windows Edge 核验。
