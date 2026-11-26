# 遵义桌边翻页

成片的 79.85–83.15 秒由多人围桌切到桌边的一本手记。书页先由外角带起，弯过书脊后落到另一侧，露出“遵义会前”。结绳、折图和灯的位置给观众提供静止的参照。片源为 1280×720、24 fps 的无声视频，共 92 帧，包含两端叠化的余量。

| 资产 | 在片头副本中的处理 |
| --- | --- |
| 手记 | 保留原模型中的书口、装订位置和磨损书衣。将一张内页变为可变形网格，沿纸面弧长积分弯折，约 14 毫米的装订带保持固定。分别为翻动页的正面、反面、已读页和新露出的内页排字。文字来自课内的四组手记摘要。 |
| 卷宗与折图 | 卷宗采用原精修工程中的编绳和折入包角。桌前沿的行军图重建为四层折纸，沿用课内桌景中折图的大小和摆放位置。 |
| 灯、椅、桌面 | 复用精修工程内的薄壁玻璃、灯芯、木器和椅子，保留光穿过灯罩以及纸页在桌面的投影。木材纹理、粗糙度和磨痕随原工程打包。 |

固定机位取自旧正式片 81.50 秒。用原录屏第 66 帧（从零计）的偏航、俯仰、缩放量，结合 `desk-space.json` 中的相机、投影与旋转中心复原；窗棂、灯、椅背和桌缘都可作为对照。完整片源在同机位图像上做 3.4% 的缓推。固定对照保留原画幅。

本机先试了 EEVEE。小样里的玻璃与桌面有明显颗粒，最终用 Cycles CPU、固定采样种子、8 个采样和降噪。同一机位只完整渲染一次，逐帧重渲翻页和它的投影经过的 672×576 像素区域。两端静止时直接使用相同姿态底片。

## 本地复建

需要 Blender 4.5.4、FFmpeg、Python、Pillow 和 NumPy。以下命令使用 PowerShell，在仓库根目录执行。Blender 全程只读原工程。

```powershell
$project = (Get-Location).Path
$scene = '展示材料/遵义会议室精修场景/会前的桌边.blend'
$scripts = '课堂演示/media-source/opening-film/desk'
$cache = (New-Item -ItemType Directory -Force '.march-build/桌边片头复建').FullName
python -B "$scripts/print-leaves.py" $project $cache
blender -b $scene --disable-autoexec -t 12 --python-exit-code 1 -P "$scripts/render.py" -- $project $cache --frames 0
$frames = 8..74
blender -b $scene --disable-autoexec -t 12 --python-exit-code 1 -P "$scripts/render.py" -- $project $cache --frames $frames --crop
python -B "$scripts/finish.py" $cache "$scripts/desk.mp4"
```

[原工程、家具和贴图的来源与许可](../../../../展示材料/遵义会议室精修场景/场景与素材.md) · [现有手记摘要](../../../自由探索实验/notebook.json)
