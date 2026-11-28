# 课堂 AI 网关

网关在本机运行，使用 Vercel AI SDK 调用支持 JSON 输出的 OpenAI 兼容模型。当前课堂提供副导、黎平沙盘和课尾复盘。副导用流式响应逐步显示正文，课件在收到完整、已校验的动作后显示确认卡。

## 首次配置

1. 在仓库根目录运行 `npm --prefix "课堂演示/harness" ci`。网关使用 Node.js 22.13 或更新版本内置的 SQLite，课件按项目构建版本 Node.js 22.21.0 验收。
2. 复制 [配置示例](course-ai.config.example.json) 为 `course-ai.config.json`，填写 `baseUrl`、`model` 和服务需要的 `apiKey`。模型地址填写 API 基址，例如以 `/v1` 结尾的地址。配置文件和运行日志均由 Git 忽略。
3. 从 [系统启动入口](../../启动入口/AGENTS.md) 一键开课。没有 AI 配置或直接打开正式 HTML 时，课件进入纯离线课堂。

配置可通过 `COURSE_AI_BASE_URL`、`COURSE_AI_MODEL`、`COURSE_AI_API_KEY` 和 `COURSE_AI_PORT` 提供。命令行支持 `--base-url`、`--model` 和 `--port`。换模型后重启网关，再从启动入口进入课件。

网关默认使用 JSON 对象模式，把字段约束写入提示，并校验返回结果。端点明确支持原生 JSON Schema 时，可在配置中设置 `jsonSchemaOutput: true`。`disableThinking` 是可选的模型参数，只有上游支持该参数时才启用。

模型密钥由网关发送给模型端点。课件拿到的是本机网关的访问凭据，用于限制其他网页调用已配置密钥的网关。浏览器离开当前场景并取消请求时，网关会取消上游请求。

课件通过 `/api/course-ai/ready` 检查当前连接和访问权限，检查通过后显示 AI 按钮。使用中断线时按钮会收起，连接恢复后重新显示。

## 调试和验收

同一标签页的一堂课使用一个课堂 ID。原始事件、摘要和副导历史保存在本机 SQLite `.director-memory/sessions.sqlite`，由 Git 忽略。课件在 `sessionStorage` 保留当前课页与待同步事件。跨页、刷新后可恢复。重新开课建立新课堂，旧课事件仍留在数据库。SQLite 随磁盘容量增长，无课堂内自动删减。浏览器快照受 Edge 存储配额约束。写入失败时，该进程或标签页继续使用内存并输出诊断，进程或标签页关闭前未持久化的记录可能丢失。损坏的浏览器快照退回新会话，网关保留原有数据库记录。

网关授权请求 `POST /api/course-ai/context/events` 可用 `{ sessionId, eventId }` 查回具体原始事件。同步请求每批最多 8 个事件，每个事件最多 16 KiB。发给模型的请求只包含该入口选择的事件、课件状态及必要的摘要。

`context.inputLimit` 是业务输入上限，实际使用它与 `modelWindow - maxOutputTokens - safetyMargin` 的较小值。默认输入上限 16000，模型窗口配置 32768，安全余量 1024。兼容端点未提供可确认的 tokenizer 时，按 UTF-8 字节、消息封装及 Schema 保守估算。可用 `COURSE_AI_CONTEXT_METRICS=1` 记录估算、上游 usage 和耗时，无须记录对话正文。

`recentTurns` 默认保留最近两组完整交互。行迹副导完成回复并同步对话后，会在后台检查 `summaryThreshold`。只有压缩结果成功保存后，聊天区才显示「上下文已经完成压缩」。`summaryTarget` 限定摘要模型所读旧事件的输入量，`summaryTimeoutMs` 默认 5000。设置 `context.summaryEnabled: false` 可关闭语义摘要。修改配置后重启网关。

沙盘使用精简的模型响应。网关补齐镜头、计时和路线样式，并校验完整地图剧本。当前轮失败时最多恢复一次，课堂取消会立即中止。网关的沙盘请求总上限为 56 秒。沙盘摘要独立运行，`context.sandboxSummaryTimeoutMs` 默认 26000 毫秒。如配置了共用的 `context.summaryTimeoutMs`，可用沙盘专用项覆盖。后台摘要完成后才显示分隔条，摘要失败时原始记录仍在。

点「清空」删除本堂副导对话和对应的摘要，保留课页进度及其他课堂活动。输入区的加号可选 UTF-8 的 TXT、Markdown、CSV 和 JSON。每条消息最多选 3 份资料，内容合计不超过 4 KB。文件内容仅随本轮问题传给模型。

Windows Edge 中可直接打开工程目录里的正式 HTML。先双击 [注册课堂开发入口](../../启动入口/Windows/注册课堂开发入口.vbs) 完成当前用户的一次性注册。在地图、正课或回顾按 `Ctrl+Alt+Shift+D`，打开「开发者模式」并点「启动后端」。遇到 Edge 确认弹窗时允许打开本机启动器。连接成功后在当前标签页继续授课。工程移动后重新注册。刷新会结束这次手动接入，课堂进度按平时的方式恢复。

```powershell
node "课堂演示/harness/course-ai-server.mjs"
node "课堂演示/harness/launch-course.mjs" --dry-run
node "Test/verify-course-ai.mjs"
node "Test/verify-course-context.mjs"
node "Test/verify-course-context.mjs" --live
node "Test/verify-sandbox-agent.mjs"
node "Test/verify-sandbox-agent.mjs" --live
python -B "Test/verify-harness-e2e.py"
python -B "Test/verify-harness-e2e.py" --live
```

`--dry-run` 会预热网关并显示去除访问凭据的地址。`--live` 使用本机配置真实调用模型。沙盘 `--live` 在同一课堂连续发出五轮，降低该验收会话的摘要触发阈值，并检查 SQLite 中的摘要和原始事件。默认 Edge 验收使用本地模拟响应。
