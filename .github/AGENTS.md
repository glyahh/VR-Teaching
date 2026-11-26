# GitHub Actions

- 持续集成配置放在 `workflows/`。[长征课工作流](workflows/long-march-course.yml) 调用仓库现有的类型检查、构建检查和离线 Edge 验收。
- 更新路径或依赖后，从仓库根目录复跑受影响的命令。可复用的检查代码放在 [Test](../Test/AGENTS.md)。
