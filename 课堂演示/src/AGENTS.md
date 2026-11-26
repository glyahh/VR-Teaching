# 正式课件源码

- `content.ts` 管理场景、讲稿、时长和史料出处，`practice.ts` 管理课堂练习。`app.ts` 管理授课入口，`lesson-session.ts` 管理单屏课页状态。
- `terrain.ts` 渲染三维地图，`cinemagraph.ts` 处理场景静帧动效。HTML 模板和主体样式分别在 `index.html` 和 `style.css`。
- 修改后按[课件构建说明](../AGENTS.md) 生成预览，用 `npm --prefix "课堂演示/自由探索实验" run check:course` 检查类型，并在实际课页验收。
