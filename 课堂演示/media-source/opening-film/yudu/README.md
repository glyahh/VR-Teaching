# 于都河岸片头两镜

这两支素材用于《从于都到遵义》95 秒开场片。每支均为 1280 × 720、24 fps 的 H.264 无声视频，剪辑从片源首帧开始读取。每个镜头在表中切点前后各延伸 6 帧，与相邻镜头形成 12 帧叠化。

| 片源 | 片头区间 | 帧数 | 画面 |
| --- | --- | ---: | --- |
| bridge.mp4 | 18.00–21.10 秒 | 86 | 船上两人托住旧门板，先贴左梁，放平至右梁，板落稳后依次收手。 |
| night.mp4 | 21.10–23.45 秒 | 69 | 低机位沿桥面靠近，跟随负重不同的队伍过桥，接到下一镜的夜色、桥和灯。 |

于都群众提供了船、门板和木材。作业按船舷承住纵梁、桥板铺于梁上的关系呈现。夜间分批过河，灯仅布置在需要引路的位置。画面是教学情境复原。渡口宽度、船数、灯位和人物服饰用于说明过程。

## 镜头内使用的模型

本次人物复修以正式片 `4dbccab95b86c2a61f2d80c0d698e6d2ba9a5476523a1ddbdc8e43e745657345` 为起点。近景人物和夜渡队伍采用共用的完整手腕、掌指和可形变布鞋。[人物来源与复建](../cast/performance/素材与复建.md)

**架桥。** 同一套船、灯、摄影机和木板运动分别拍了两遍。一版用卡内基梅隆大学的两段拾箱动捕，另一版在 Blender 中为两人各设脚底、肘膝方向和掌部抓点，用前臂扭转骨及上衣矫正形态承接屈肘。正式片采用后一版。四组抓法写在 `board-grip.json`。肩、上臂、前臂、腕和三节手指由 `board_ik.py` 驱动；`board_shot.py` 在原场景拍摄，按实际蒙皮和板件表面测接触。需要在 Blender 内编辑时可向专用入口传 `--save-scene --save-deform`，在输出目录取得打包工程及视觉烘焙动作。

**夜渡。** 队伍使用真人行走记录和逐人设定的步态、负重与手部任务。鞋底着板、跟趾滚动与肩带抓握在实际网格上核对，提灯者另有稳定灯把的动作。正常 CLI 将夜渡交给 `render_night.py`。[两种于都抬板样片与人物验收](../../../../展示材料/片头人物动作复修/选型与验收.md)

| 镜头 | 保留 | 替换与重建 | 精修 |
| --- | --- | --- | --- |
| 架桥 | 课件中的于都木船、MPFB 头手和 53 骨骼、两处渡口的相对位置 | 单独生成纵梁、门板缺口、船内站板、门板合页残迹、绑扎和岸边木料。以两人协作的近景替换旧高俯拍。 | 给两人换裁片上衣和原 UV 肤色，补头巾、短发、眼眉、翻袖口和布腰带。用实网格确定手与门板的贴合，以站板约束双脚。两侧承托完成后再收手。 |
| 夜渡 | 同一桥梁、船体和人物骨架，远处保留原服装 | 改用从近岸沿桥观察的低角度。用同一骨架驱动 18 人的不同步态，加入布包、铺盖和引路灯。 | 近镜换裁片上衣，沿衣面布置背带。单脚承重期间留在同一点，鞋底依照桥面和岸坡定高。灯光影响周边人物和桥面。两组水面法线以不同速度移动，岸树缓慢运动。 |

两镜都给船舷、船肋和坐板配旧木颜色、粗糙度和顺纹 UV。远山和天空取自课件备桥参考图右上无人区域，裁取 1600 × 900 原图的 x 1007–1598、y 0–315。夜渡用同一山线和更低的夜间亮度。渡口、泥岸、草石、河面、船桥和走动的人仍由实时三维场景生成。 [于都备桥情境图](../../../assets/yudu-bank.jpg)

源模型与贴图取自同一仓库的课件资产目录。人物为 MPFB v2.0.18 人体基础网格和游戏骨架，经项目裁切、着装和绑定，人体基础资产许可为 CC0。植被、苔石、旧木、粗麻和地表的扫描资产也使用 CC0。船、水面法线和桥梁为项目制作。 [MPFB v2.0.18](https://github.com/makehumancommunity/mpfb2/releases/tag/v2.0.18) · [MPFB 基础资产许可](https://github.com/makehumancommunity/mpfb2/blob/v2.0.18/LICENSE.ASSETS.md) · [Poly Haven 许可](https://polyhaven.com/license)

- 船和桥使用课件内的船体 GLB 和 Brown Planks 03 的 1K 颜色、法线和粗糙度。人物 GLB 结合粗麻贴图。 [Brown Planks 03](https://polyhaven.com/a/brown_planks_03) · [Rough Linen](https://polyhaven.com/a/rough_linen)
- 树、草与石头用现有 Island Tree 02 简化版、Grass Medium 01 和 Rock Moss Set 01。地表用 Aerial Grass Rock 和 Dirt。 [Island Tree 02](https://polyhaven.com/a/island_tree_02) · [Grass Medium 01](https://polyhaven.com/a/grass_medium_01) · [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01) · [Aerial Grass Rock](https://polyhaven.com/a/aerial_grass_rock) · [Dirt](https://polyhaven.com/a/dirt)
- 两张面部和手部贴图、裁片上衣和衣料纹理来自 MakeHuman 官方 CC0 系统资产包，经项目裁切和骨架绑定。 [近景人物素材与复建](../cast/素材来源.md)

## 离线复建

从仓库根目录运行。使用 Blender 4.5.4 LTS，并将 FFmpeg 放到 PATH。以下命令采用 Vulkan 和 EEVEE，场景读入 Git 内的模型和贴图，不依赖个人 Blender 工程或下载缓存。输出目录保存逐帧 PNG、MP4 和接触测量 JSON。正式剪辑索取两支 MP4。

~~~powershell
$blender = ".march-build/blender-4.5.4-windows-x64/blender.exe"
$render = "课堂演示/media-source/opening-film/yudu/render.py"
& $blender -b --gpu-backend vulkan -t 4 --python-exit-code 1 --python $render -- --shot bridge --output ".march-build/片头模型制作/yudu/rebuild"
& $blender -b --gpu-backend vulkan -t 4 --python-exit-code 1 --python $render -- --shot night --output ".march-build/片头模型制作/yudu/rebuild"
~~~

逐帧复看时加上 `--frame 0 24 48 54 59 65 73`。从 0 起数，第 48–49 帧左端接梁，第 54 帧两端落稳。用 `--measure-only` 导出整段的接触测量。也可直接运行 `board_shot.py --view hands --frame 24 54 63 --output <目录>` 诊断手部的遮挡和接触。

## 原机位对照

早期桥形的正交对照起点为 ca262cc01d35d980bb5df2398d147af8a42da6c6。其摄影参数沿用原录制源第 30 帧的 eye、target、zoom 和五次缓动。同为 16∶9，Blender 坐标采用 (Three.x, -Three.z, Three.y)，视宽为 2 × 33.5 × 16/9 ÷ zoom。当前入口加 `--matched` 会使用当前演员，从这台正交机位输出定格。人物复修和两版抬板的正式对照则使用原成片的透视摄影机，架桥第 24 帧、夜渡第 22 帧与用户的截图对应。

