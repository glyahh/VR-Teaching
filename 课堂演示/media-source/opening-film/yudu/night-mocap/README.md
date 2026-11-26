# 于都夜渡动捕与复建

本镜头使用 CMU Graphics Lab 的 120 Hz 全身动捕。两段原始 ASF/AMC 归档在 `cmu-35-and-37.zip`，渲染时从包内直接读取。其中 `35_01` 是常速步行，用于提灯和空手过桥，`37_01` 是慢步，用于背重包和扶肩带。 [常速步行试验](https://mocap.cs.cmu.edu/search.php?subjectnumber=35&trinum=1) · [慢步试验](https://mocap.cs.cmu.edu/search.php?subjectnumber=37)

CMU 允许复制、修改和再分发动捕数据，也允许在销售产品中纳入这些数据。项目主页的条款禁止单独转卖原始或转换后的数据。人物模型和贴图来自同一课件的 `opening-film/cast/performance` 制作链。 [CMU 数据使用条款和单位](https://mocap.cs.cmu.edu/faqs.php) · [CMU 项目主页](https://mocap.cs.cmu.edu/) · [演员素材与复建](../../cast/performance/素材与复建.md)

| 官方输入 | SHA-256 |
| --- | --- |
| [35.asf](https://mocap.cs.cmu.edu/subjects/35/35.asf) | `2a8e2eda3c0d7d828566b2a9a8ab36b2b8b3864110574e8b73c8f069fded416c` |
| [35_01.amc](https://mocap.cs.cmu.edu/subjects/35/35_01.amc) | `4bfb933cb06f77146cde21b48f42df8be4773e9e3d657956830dc51fb4ed510d` |
| [37.asf](https://mocap.cs.cmu.edu/subjects/37/37.asf) | `b1c80e8095954a86da9e2685a314d6fae258c905850044c03c4387757b2449a6` |
| [37_01.amc](https://mocap.cs.cmu.edu/subjects/37/37_01.amc) | `ab4792e3c0052d35133106964fab991640b53e715335cba4936a547badd80c72` |

把同一人的骨盆、胸椎、锁骨和头部转动与肘膝方向映射至共同 MPFB 骨架。两段采集分别截取步态周期和左右脚的落脚、抬脚时点。人物身高、步幅、相位和速度各自调整。脚着地时锁住水平方向的承重点，起落脚跟和脚掌沿鞋底翻滚。全镜头从正式木板、坡板和河岸网格求鞋底高度。袖口沿前臂分担转动，空手、扶肩带和提灯分别采用不同指形。提灯把随指间握点移动。肩带沿裁片表面走线，上衣下摆依步幅放量。

## 复建

从仓库根目录运行，使用 Blender 4.5.4 LTS 和 PATH 中的 FFmpeg。正式镜头为 1280 × 720、24 fps、69 帧，保留原夜渡透视机位和灯光。

```powershell
$blender = '.march-build/blender-4.5.4-windows-x64/blender.exe'
$common = '课堂演示/media-source/opening-film/yudu/render.py'
$night = '课堂演示/media-source/opening-film/yudu/render_night.py'
$out = '.march-build/人物动作复修/night'
& $blender -b --gpu-backend vulkan -t 3 --python-exit-code 1 --python $common -- --shot night --output "$out/actual-surface" --preview-first
& $blender -b --gpu-backend vulkan -t 3 --python-exit-code 1 --python $night -- --output "$out/strap-detail" --frame 22 --grip-review 1
& $blender -b --gpu-backend vulkan -t 3 --python-exit-code 1 --python $common -- --shot night --output "$out/matched" --matched
```

`--measure-only` 跑完所有关节与接触数据。完整渲染输出 `night.mp4`、逐帧 PNG 和 `night-metrics.json`。后者记录每帧的全员鞋底距离与承重点、近人骨骼屏幕位置、腕部夹角、肩带与手和灯把间距。`--matched` 使用旧正交机位，默认输出第 30 帧的诊断定格。`--grip-review` 从指定人物前侧拍肩带和手，需同时指定帧号。
