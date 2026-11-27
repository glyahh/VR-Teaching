---
name: generate-video
description: 为指定镜头查找有明确授权的外部片源，或调用 SRAPI 生成文生视频、参考图视频和首尾帧视频。可交付本地 MP4，按需交给 OpenMotion 剪辑。
---

# Generate Video

1. 先核对分镜、实际入片画面和下一张课页图或接回机位。查项目已有画面；若用户允许外部素材，再查官方史料和授权素材库。记录片源链接、许可、署名和截取区间。没有合适的片源，或用户指定生成时，用下列 SRAPI 流程。教学复原镜头按项目要求标注。
2. 用 Node.js 22 或以上运行本技能目录内的 `scripts/video.mjs`。脚本从 Windows 当前用户加密凭据或 `SRAPI_API_KEY` 读取密钥，仅随鉴权发往 `https://sraiapi.com`。发起生成前明确镜头、模型、时长、参考素材和输出路径。一次提交后记录任务 ID。超时未收到 ID 时，先查原任务受理记录。
3. 用同一任务 ID 查到 `completed` 后下载 MP4。用户要求剪辑时，将本地片源交给 OpenMotion 工作流，按剪辑区间和字幕时码导入。课件镜头用实际解码首尾帧与前后画面对照，重点核对尾帧与下一张图，再原速检查两处衔接。

默认模型 `MiniMax-H3`，4 秒，480p，854×480。模型、分辨率和尺寸按 [SRAPI 视频文档](https://sraiapi.com/video-docs) 调整。

| 操作 | 脚本参数 |
| --- | --- |
| 文生视频 | `submit --prompt "<动作和机位>"` |
| 参考图生视频 | `submit --mode reference --image "<本地图>" --prompt "<动作和机位>"` |
| 首尾帧生视频 | `submit --mode frames --first-frame "<入片图>" --last-frame "<出片图>" --prompt "<动作和机位>"` |
| 查询 | `status --id <任务ID>` |
| 下载 | `download --id <任务ID> --output "<本地路径.mp4>"` |

长征课中间片段放在 `.march-build/`；通过验收的运行素材再按仓库规则接入离线课件。

需要轮换 Windows 凭据时，在 PowerShell 用隐藏输入保存新密钥。只在对应用户下执行。

```powershell
$file = Join-Path $env:LOCALAPPDATA 'VR Teaching/SRAPI/api-key.dpapi'
New-Item -ItemType Directory -Path (Split-Path -Parent $file) -Force | Out-Null
Read-Host 'SRAPI API Key' -AsSecureString | ConvertFrom-SecureString | Set-Content -LiteralPath $file
```
