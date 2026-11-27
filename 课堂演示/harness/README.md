# 课堂 AI 网关

网关在本机运行，使用 Vercel AI SDK 调用支持 JSON 输出的 OpenAI 兼容模型。它向课件提供副导、黎平沙盘、遵义质询和课尾复盘四个接口。

## 首次配置

1. 在仓库根目录运行 `npm --prefix "课堂演示/harness" ci`。需要 Node.js 22 或更新版本。
2. 复制 [配置示例](course-ai.config.example.json) 为 `course-ai.config.json`，填写 `baseUrl`、`model` 和服务需要的 `apiKey`。模型地址填写 API 基址，例如以 `/v1` 结尾的地址。配置文件和运行日志均由 Git 忽略。
3. 从 [系统启动入口](../../启动入口/AGENTS.md) 一键开课。没有 AI 配置或直接打开正式 HTML 时，课件进入纯离线课堂。

配置可通过 `COURSE_AI_BASE_URL`、`COURSE_AI_MODEL`、`COURSE_AI_API_KEY` 和 `COURSE_AI_PORT` 提供。命令行支持 `--base-url`、`--model` 和 `--port`。换模型后重启网关，再从启动入口进入课件。

网关默认使用 JSON 对象模式，把字段约束写入提示，并校验返回结果。端点明确支持原生 JSON Schema 时，可在配置中设置 `jsonSchemaOutput: true`。`disableThinking` 是可选的模型参数，只有上游支持该参数时才启用。

模型密钥由网关发送给模型端点。课件拿到的是本机网关的访问凭据，用于限制其他网页调用已配置密钥的网关。浏览器离开当前场景并取消请求时，网关会取消上游请求。

## 调试和验收

Windows Edge 中可直接打开工程目录里的正式 HTML。先双击 [注册课堂开发入口](../../启动入口/Windows/注册课堂开发入口.vbs) 完成当前用户的一次性注册。在地图、正课或回顾按 `Ctrl+Alt+Shift+D`，打开「开发者模式」并点「启动后端」。遇到 Edge 确认弹窗时允许打开本机启动器。连接成功后在当前标签页继续授课。工程移动后重新注册。刷新会结束这次手动接入，课堂进度按平时的方式恢复。

```powershell
node "课堂演示/harness/course-ai-server.mjs"
node "课堂演示/harness/launch-course.mjs" --dry-run
node "Test/verify-course-ai.mjs"
python -B "Test/verify-harness-e2e.py"
python -B "Test/verify-harness-e2e.py" --live
```

`--dry-run` 会预热网关并显示去除访问凭据的地址。`--live` 使用本机配置真实调用模型。默认 Edge 验收使用本地模拟响应。
