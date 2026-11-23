# 长征课片头分镜及素材

放映入口是于都备桥原图，收尾画面接于都集结。人物与地点延续正课的讲述顺序。片头以水声提前引导视线，再从于都旧地的纪念活动切到湘江环境。地图线承接向西、向北的进军方向，随后进入遵义会议的舞台复原。

| 成片位置 | 画面和动作 | 声音与段末 |
| --- | --- | --- |
| 0.00–0.75 秒 | 备桥原图。首帧保留现有光线、画幅和构图。 | 环境水声先出，为切向实拍做准备。 |
| 0.75–2.67 秒 | 于都烈士纪念园当代实拍。低速航拍，山脊和前景队列交代地点。 | 保留水声，衔接湘江。 |
| 2.67–5.25 秒 | 课件原有湘江情境片段。沿河谷推进。 | 复用原导览「湘江战役中，中央红军损失重大」。 |
| 5.25–6.50 秒 | 浅水流经石底的近景。 | 湘江旁白持续，画面收至地图。 |
| 6.50–11.46 秒 | 沿用导览的地形和路线示意，从黎平沿进军方向显现至遵义。 | 复用黎平改向黔北的旁白。 |
| 11.46–16.08 秒 | 山间急流近景，观察地形与水势。 | 复用渡过乌江的旁白。现场水声衔接下一幕。 |
| 16.08–22.21 秒 | 遵义实景剧场会议坐席，人物由站立走向讨论桌。明确标为情景演绎。 | 复用遵义会议时间与地点的旁白。 |
| 22.21–22.79 秒 | 回到于都集结原图，尾帧受课件实际画幅约束。 | 轻收水声，保留可直接接回课堂的画面。 |

片长约 22.79 秒，按 24 帧/秒共 547 帧剪辑。四段外部实拍或演绎占 334 帧，约 61%。水面镜头承担环境过场，具体渡口、队伍和事件由旁白、原有再现和路线示意交代。

## 片源与许可

| 用途 | 原发布页与许可 | 成片使用 |
| --- | --- | --- |
| 于都烈士纪念园 | 中国新闻社《清明祭英烈：中央红军长征集结出发地为百名烈士画像》。在[发布视频](https://www.youtube.com/watch?v=L3Sc2_nUj30)的许可字段核对允许复用。[发布方网页](https://www.chinanews.com.cn/shipin/cns/2026/04-04/news1050741.shtml)提供同题高清片源。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 截取开头航拍，统一帧率和影调，静音并替换为自然水声。保留原台标，标注为当代实拍。 |
| 浅水近景 | [Clear Water Rippling Over Rocky Riverbed](https://www.pexels.com/video/clear-water-rippling-over-rocky-riverbed-31810558/)，Physical Pixel，[Pexels License](https://www.pexels.com/license/) | 节选，中心裁为 16∶9，调暗，与旁白组合。 |
| 急流和水声 | [A Close-Up Shot of the Cascading Water in the River](https://www.pexels.com/video/a-close-up-shot-of-the-cascading-water-in-the-river-4058993/)，João Pavese，[Pexels License](https://www.pexels.com/license/) | 节选画面和环境声，降幅并混入课内旁白。 |
| 遵义会议舞台演绎 | 中国新闻社《超两千场演绎峥嵘岁月 特型演员王广胜以戏传承红色精神》。在[发布视频](https://www.youtube.com/watch?v=_N1ep0cNYr0)的许可字段核对允许复用。[发布方网页](https://www.chinanews.com.cn/yl/shipin/cns/2026/10-21/news1072573.shtml)提供同题高清片源。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | 节选室内镜头，调色，静音，配课内旁白。保留原台标，标注为情景演绎。 |

片源地址和校验值由 `make-opening.py` 记录。源码和成片一并分发时保留本页。成片本身的注释字段带有片源、作者、许可及编辑说明。

中国新闻社两条观看页的公开 `License` 字段均显示 `Creative Commons Attribution license (reuse allowed)`。在发布方原页核对视频标题和高清地址，并将每支观看页的三张缩略帧与对应高清片段比对。水面素材用画面和水声承接镜头，画面上的短标识用于区分当代实拍和情景演绎。

## 重剪与核对

从仓库根目录执行 `python -B "课堂演示/media-source/make-opening.py" --download`，首次把外部片源放在 `.march-build/opening-sources/`。缓存就绪后去掉 `--download` 可离线重剪。依赖当前导览的 Pillow、NumPy 和字体，以及 FFmpeg 与 FFprobe。正式课件打包时只内嵌 `opening.mp4`，运行与播放无需片源缓存。

正式课件重建后，用 `python -B "Test/verify-dual.py" --check-join opening yudu-bank yudu-assembly` 检查实际解码首尾。再从「开始授课」播放，观察进入和收尾、暂停续播以及主控和投影窗口。
