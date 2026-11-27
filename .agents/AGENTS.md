# 仓库技能

[上级：仓库指南](../AGENTS.md)

- 项目专用技能放在 `skills/<技能名>/SKILL.md`。技能引用的操作示例和功能说明放在同一技能目录。
- `skill-packages/` 保存由 CC Switch 安装的普通技能源码。Generate Video 的说明、调用脚本和显示配置同放在 [generate-video](skill-packages/generate-video/SKILL.md)。
- [长征课验收技能](skills/verify-long-march-course/SKILL.md) 说明怎么走实际课页和保留证据。可执行验收脚本放在 [Test](../Test/AGENTS.md)。
- 课件界面按组件和状态查阅[长征课 UI 背景与状态规范](<../项目文档/规范/长征课 UI 背景与状态规范.md>)。
- [文案叠层实现](skills/copy-panel-overlay/SKILL.md)
- [课件贴底导航栏](skills/lesson-bottom-rail/SKILL.md) 适用于正课章节、翻页操作和地图站点工具共用的常驻底栏。
- 修改技能引用后，从仓库根目录执行涉及的命令，核对路径和实际用法。
