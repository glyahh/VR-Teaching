# 湘江涉水镜头

`crossing.mp4` 从第 0 帧剪入《从于都到遵义》片头的 38.20–43.30 秒。分辨率 1280×720，24 帧/秒，H.264，BT.709，共 134 帧，只有视频轨。`round(43.30 × 24) - round(38.20 × 24)` 得到 122 个正片帧，原片头剪辑另取首尾各 6 帧叠化。数字卡、旁白和声音由现有片头播放与剪辑系统处理。

## 分镜

| 片源时间 | 实际可见动作 |
| --- | --- |
| 第 0–27 帧 | 左前人物减速屈膝，低头试下一步。右后人物看见对方放低重心，先转头和肩。 |
| 第 28–49 帧 | 右后人物放慢步子，从左前人物的袖外伸出右手。掌落在左前臂近肘处，拇指和四指接着收拢。 |
| 第 50–74 帧 | 左前人物抬起上身一点，回头看扶持者。两双脚错开探步。水沫从膝侧分开，沿江流拉长。 |
| 第 75–133 帧 | 左前人物走稳。右后人物先沿袖面法向减力抬掌，拇指和其余手指依次舒开。两人继续向画面左侧走。右侧河面和岸坡留给兵力卡，片尾接黎平瓦檐的雨。 |

## 实际取景范围内的模型

- 前六人使用共享的完整 MPFB 演员、实裁上衣裤鞋、原 UV 肤色与眉眼发片。前方试探者和扶助者用不同的脸型、头部外形和着衣颜色。布帽前冠按所用头部的横截面调整，近处背带沿裁片上衣贴合。队伍的负重动作、步幅、肩线和视线各有变化。
- 前两人共用[于都的原生骨架控制](../yudu/board_ik.py)、极向校准、分段扭转蒙皮、鞋底权重及肘衣褶校形。涉水脚步、踩床、转肩应答和抓袖在 [wading.py](wading.py) 中编排。支撑脚的鞋底按河床高度锁住，另一个脚探向下一踏点。
- 右手腕从实际受力袖面的外侧进出。掌根、拇指和各指末节按原始骨权重取真实皮肤采样。袖面在浅抓压力下局部收缩。逐帧记录最近的有符号距离、2 mm 以上穿入、接触网格面片对及脚底位置。
- 保留原河道走向。近处重建浅滩高度和泥石湿边，远侧立着原课件雾岭画面的投影面。近岸树、草与滩石使用共享 CC0 扫描件。水面由斜流波、短波法线、雨点涟漪和跟随腿部水线的尾迹叠加。
- 画中是 1934 年湘江上游情境的教学复原。人数、步态、降雨与具体河汊按课堂画面组织。历史背景以兴安、全州之间的实际渡江记录为依据。[中央纪委网站湘江战役资料](https://m.ccdi.gov.cn/content/ee/10/12201.html) · [广西纪检监察网纪念园资料](https://www.gxjjw.gov.cn/staticpages/20240102/gxjjw6593df4b-187292.shtml)

## 来源和许可

| 内容 | 来源和版本 |
| --- | --- |
| 前六人的全身模型和两款肤色 | `../cast/performance/` 下的 `performer-final.glb`、`skin-young.jpg` 和 `skin-middle.jpg`。MakeHuman 系统 CC0 服装和人体资产沿仓库 MPFB 骨架绑定。 [来源与复建](../cast/performance/素材与复建.md) |
| 远处队伍 | 仓库 `课堂演示/assets/yudu-river/river-people.glb`，可选原 `于都人物.blend`。骨架 MPFB `v2.0.18`，粗布基于 Poly Haven `rough_linen`。 [MPFB 图形许可证](https://github.com/makehumancommunity/mpfb2/blob/v2.0.18/LICENSE.ASSETS.md) · [粗麻贴图](https://polyhaven.com/a/rough_linen) |
| 岸坡、苔石、草、树 | 复用仓库 `课堂演示/assets/yudu-river/`，版本取任务基线 `ca262cc01d35d980bb5df2398d147af8a42da6c6`。 [Poly Haven 地表](https://polyhaven.com/a/aerial_grass_rock) · [泥地](https://polyhaven.com/a/dirt) · [苔石](https://polyhaven.com/a/rock_moss_set_01) · [草丛](https://polyhaven.com/a/grass_medium_01) · [树木](https://polyhaven.com/a/island_tree_02) · [CC0](https://polyhaven.com/license) |
| 阴天 HDRI | Poly Haven `overcast_soil_puresky` 的 1K HDR，文件 MD5 `7fbca6264f4618a787092b9e1679a578`。 [作品及 CC0](https://polyhaven.com/a/overcast_soil_puresky) · [原始 HDR](https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/overcast_soil_puresky_1k.hdr) |
| 雾岭 | 裁取项目原 `课堂演示/assets/xiang.png`，它由 `make-xiang-poster.py` 取本课 `xiang.mp4` 首帧。旧片头已在 32.55–36.15 秒露出同一河谷，素材用于远处山林。 |

## 复建与同机位对照

在仓库根目录运行。使用 Blender 4.5.4 LTS、Vulkan 和可从 PATH 调用的 FFmpeg。命令中的 `blender` 可换成本机可执行文件路径。

```powershell
blender -b --factory-startup --gpu-backend vulkan -t 4 --python-exit-code 1 --python '课堂演示/media-source/opening-film/xiang/render.py' -- --output '.march-build/片头模型制作/xiang/sequence' --samples 5 --clip '课堂演示/media-source/opening-film/xiang/crossing.mp4'
```

`--preview 24 64 88` 生成试探、扶持与松手三个正课机位定格。加上 `--contact-camera` 可用近机位查袖口和掌指；`--kinematics` 运行全部 134 帧并写逐帧报告。`--cast-assets` 可指定包含共享人物和两款贴图的目录，`--rig <于都人物.blend>` 可为远处队伍选用编辑工程。`--blend <路径>` 将首帧或第一个预览帧的姿态和贴图打包保存。

固定对照采用基线 `ca262cc01d35d980bb5df2398d147af8a42da6c6` 的 `record-opening-3d.py` 第 76 帧，视场为垂直 44°，进度为 0.493488。旧图在 Edge 减少动态效果模式中锁定原 `idle` 网格。新图投影换算到 Blender `(X, -Z, Y)` 坐标，保持网格、人数和队伍脚位，用近岸拐点、江心石与人物脚位复核。动态片采用靠近扶持者的新镜头。前后对照所用证据记录与序列在 `.march-build/片头模型制作/xiang/`。

```powershell
python -B '课堂演示/media-source/opening-film/xiang/capture_baseline.py' '.march-build/片头模型制作/xiang/fixed-old-076.png' --course '<基线的课堂演示 HTML>'
blender -b --factory-startup --gpu-backend vulkan -t 4 --python-exit-code 1 --python '课堂演示/media-source/opening-film/xiang/render.py' -- --output '.march-build/片头模型制作/xiang/fixed' --fixed
```

## 在旧机位核对新版人物

旧正式片第 979 帧（40.7917 秒）对应原录屏第 76 帧，用来复核定格前后的相机位置、观察目标与垂直 44° 视场。新版取片源第 56 帧（2.3333 秒），使用正式镜头中的裁片、袖口、皮肤、背包和握袖蒙皮。新裁切把相同的远景画面铺到旧机位的视野。队伍脚位和动作阶段沿用两版各自的成片安排。

下面的命令读取任务基线的正式片头，并生成同机位的新版定格。`--baseline-camera` 与 `--preview` 一起使用。

```powershell
ffmpeg -i '<基线的 opening.mp4>' -an -vf 'select=eq(n\,979)' -frames:v 1 '.march-build/片头模型制作/xiang/official-old-0979.png'
blender -b --factory-startup --gpu-backend vulkan -t 2 --python-exit-code 1 --python '课堂演示/media-source/opening-film/xiang/render.py' -- --output '.march-build/片头模型制作/xiang/fixed-cast' --samples 5 --preview 56 --baseline-camera
```
