# 课堂 AI 网关

[上级：正式课件与三维样课](../AGENTS.md)

- [course-ai-server.mjs](course-ai-server.mjs) 通过 Vercel AI SDK 调用可配置的 OpenAI 兼容端点。网关解析并校验结构化输出。模型仅提出教学动作，课件处理白名单内的动作。
- 修改 [archive-knowledge.mjs](archive-knowledge.mjs) 中的课页、热点或档案白名单时，需与 [content.ts](../src/content.ts) 和 [harness-bridge.ts](../src/harness-bridge.ts) 保持同步。
- 本地私钥/环境变量配置文件 `course-ai.config.json` 与运行日志 `.harness.log` 已在 `.gitignore` 中忽略，禁止提交入库。
- 安装与验收入口见 [README](README.md)。
