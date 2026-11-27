# 一键开课启动入口

[上级：仓库指南](../AGENTS.md)

| 操作系统 | 启动入口 | 说明 |
| --- | --- | --- |
| Windows | `Windows/一键开课.vbs` · `Windows/启动-从于都到遵义.cmd` | 配置模型后，`.vbs` 后台启动课堂网关并开课。`.cmd` 支持命令行传参。 |
| macOS | `macOS/启动-从于都到遵义.command` | 双击自动按需构建、拉起网关并调用默认浏览器开课 |
| Linux | `Linux/启动-从于都到遵义.sh` | 执行后自动调用 `launch-course.mjs` 开课 |

- 所有入口均基于相对路径定位 [课堂演示/harness/launch-course.mjs](../课堂演示/harness/launch-course.mjs)，未安装 Node.js 时自动回退为直接打开已构建的离线课件 HTML。
- Windows Edge 可双击「注册课堂开发入口.vbs」为当前用户启用 HTML 内的后端启动。工程移动后重新注册。使用方式见[课堂 AI 网关说明](../课堂演示/harness/README.md)。
