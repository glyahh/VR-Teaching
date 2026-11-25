# 长征课片头分镜及素材

放映入口衔接总览地形原图（`terrain.jpg`），收尾画面回到于都集结原图（`yudu-assembly.jpg`），再由教师点击「进入课堂」进入第一课页。片头按纪录片结构铺陈 1934 年秋至 1935 年 1 月的历史背景与四站因果：第五次反“围剿”受挫、于都夜渡、血战湘江、黎平改向、强渡乌江、遵义会议召开与全线四站时空回望，最后破晓转折回到于都起点。

全片由 7 支经核验的外部横屏 1080p 实拍视频、5 支本课高精 3D 实时场景电影级运镜（由 `record-opening-3d.py` 离线录制）、4 支课内动态短片、3 段全安全区内收的暗调 3D 动态沙盘地图与极少量历史实景过渡构成，全片动态镜头占比超过 92%。视频本身不硬烧字幕、边角地标、兵力对比卡或底部时间轴；上述信息层均由前端 `opening-overlay.ts` 按真实视口安全边距随 `video.currentTime` 实时渲染，确保 16:9、16:10、3:2 及双屏主控窗下均零裁切、零重影、暂停同步定格。配音为沉稳纪实男声（`zh-CN-YunjianNeural`，文本稿见 `opening-narration.tsv`），配以独奏大提琴弦乐与河段限定水声，相邻镜头均使用 0.50 秒柔和叠化。

| 成片位置 | 画面和动作 | 声音与转场 |
| --- | --- | --- |
| 0.00–1.85 秒 | 东亚深墨绿立体地形原图（`terrain.jpg`）。首 0.58 秒保持原图静止以对齐课件入片，随后向中央苏区缓推并亮起定位暖金波纹。 | 大提琴弦乐轻起，1.20 秒男声开讲第五次反“围剿”失败。 |
| 1.85–10.45 秒 | 苍茫云雾群山航拍（Mixkit 实拍），压暗冷青色调；前端安全区依次呈现动态纪年 `1934 · 秋` 与 `中央苏区 · 1934.10`。 | 交代中央红军主力被迫撤离苏区、踏上战略转移之路。 |
| 10.45–16.05 秒 | 自绘暗调立体全线动态地图（上篇，基于 `elevation.png`，全部地名收进中央水平安全区）。于都亮起双环扩散波纹与滚动人数计数 `8.6 万余人`，带暖金彗尾与切线箭头的暗朱红路线稳步西进。 | 交代十月中旬八万六千余名将士在于都集结。 |
| 16.05–18.00 秒 | 课内于都备桥纯动作段（`yudu-preparation.mp4`），乡亲抬门板走向木船。 | 河流水声柔缓切入，对应“于都河上无固定桥，乡亲们卸下门板”。 |
| 18.00–21.10 秒 | 本课 3D 于都河岸黄昏架桥近景航拍（`3d-yudu-bridge.mp4`），军民合力抬板落梁架起浮桥。 | 水声延续，衔接夜渡浮桥。 |
| 21.10–23.45 秒 | 本课 3D 于都河岸星月夜渡低空滑移（`3d-yudu-night.mp4`），与下游近景浮桥形成双机位衔接。 | 对应“连夜架起的浮桥上”。 |
| 23.45–26.45 秒 | 明月浮桥夜渡（`yudu.mp4`），大部队提灯悄然过桥。 | 对应“大部队悄悄踏出长征第一步”。 |
| 26.45–32.55 秒 | 桂北喀斯特群山与宽阔大江实拍（Pexels），阴雨冷灰青调。 | 江水声略深，交代十一月底在广西全州、兴安之间血战湘江。 |
| 32.55–36.15 秒 | 雾锁湘江河谷（`xiang.mp4`），沿雾气江面推进。 | 交代拼死突破第四道封锁线。 |
| 36.15–38.20 秒 | 细雨砸落暗色江面泛起层层涟漪（Mixkit 实拍），冷青阴郁色调。 | 承接“却付出惨重代价”的沉痛氛围。 |
| 38.20–43.30 秒 | 本课 3D 湘江寒江抢渡高空俯冲（`3d-xiang-crossing.mp4`），红军涉水队列与两翼合围脉冲红弧实时演进；前端右侧安全区同步弹出动态兵力对照卡（`8.6 万余人` 骤缩至 `3 万余人`）。 | 水声在 38.3 秒平稳淡出，大提琴低沉承托减员数字。 |
| 43.30–46.20 秒 | 青瓦老墙屋檐落雨动态实拍（Mixkit 实拍），前端左下安全区浮现 `贵州黎平 · 1934.12`。 | 交代沉重损失迫使红军重新审视眼前去路。 |
| 46.20–48.75 秒 | 黎平翘街暮色（`liping-street.jpg`）叠加三处灯笼暖光呼吸与暖尘漂浮。 | 暮色灯火承接，引向黎平会议决策地图。 |
| 48.75–60.25 秒 | 自绘暗调立体动态地图（下篇，全安全区内收）。先以流动冷灰虚线标出原定北上湘西北与动态脉冲红弧防线 `前方重兵阻截`；54.6 秒后虚线淡暗，黎平绽放决策波纹，朱红主线改向黔北经猴场、乌江直指遵义。 | 对应北上受阻与黎平会议改向黔北的战略抉择。 |
| 60.25–65.95 秒 | 深谷悬崖江流航拍（Mixkit 实拍），低饱和冷青深冬影调。 | 交代 1935 年元旦猴场会议重申方针、催促北进。 |
| 65.95–69.50 秒 | 山间急流近景（Pexels 实拍），压暗冷青水浪。 | 急流声自然抬升，切入顶着天险急流强渡乌江。 |
| 69.50–72.25 秒 | 乌江悬崖行军（`wujiang.jpg`）叠加深谷漂移寒雾并缓拉揭示悬崖队伍，前端左下安全区浮现 `乌江天险 · 1935.01`。 | 水声在 72.4 秒前彻底收尽，留出庄重静气。 |
| 72.25–76.65 秒 | 本课 3D 遵义材料厅一镜穿门运镜（`3d-zunyi-hall.mp4`）：暮色双宫灯青砖庭院平滑穿过红木格扇门，步入室内煤油灯摇曳书桌；前端右下安全区浮现 `贵州遵义 · 遵义会议会址`。 | 交代 1 月 15 日至 17 日中央政治局在遵义召开扩大会议。 |
| 76.65–79.85 秒 | 课内二楼油灯长桌会议（`zunyi.mp4`），由穿门暖灯自然叠入议事现场。 | 承接会议商讨的庄重氛围。 |
| 79.85–83.15 秒 | 本课精修 3D 遵义会议桌实景特写（`3d-zunyi-desk.mp4`）：煤油灯下弧线推近，手记翻开、卷宗解绳揭封、行军路线图展开并叠显改向线。 | 对应“危急关头，会议集中解决军事和组织问题”。 |
| 83.15–88.55 秒 | 自绘暗调全线四站时空回望动态沙盘（全安全区内收）：暖金流光沿路线依次点亮于都、湘江、黎平、遵义四站波纹，前端底部安全区同步推进四站细金时间轴。 | 提出核心问题：一路受挫之后，这支队伍如何一步步走向转折？ |
| 88.55–91.60 秒 | 晨雾山林破晓日出航拍实拍（Mixkit 实拍），暖金晨光破雾照亮群山。 | 寓意破晓转折，引出时空回环。 |
| 91.60–95.00 秒 | 回到于都集结原图（`yudu-assembly.jpg`），前段门檐马灯微光柔收，末尾 1.40 秒保持原图静止且无字幕无遮罩，与第一课页像素对齐。 | 男声收束“亲手翻开这段历史”，大提琴尾音自然落幕。 |

片长 95.00 秒，按 24 帧/秒共 2280 帧剪辑。全片无台标、无白闪、无硬烧边缘叠层，所有外部片源均为宽松商用/教育复用许可，不含 ShareAlike 传染条款。

## 片源与许可

| 用途 | 原发布页、作者与许可 | 成片使用 |
| --- | --- | --- |
| 苍茫云山航拍 | [Misty mountains and clouds](https://mixkit.co/free-stock-video/misty-mountains-and-clouds-100190/)，Mixkit，[Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree) | 节选 1.2 秒起片段，压暗冷青调，静音。 |
| 桂北喀斯特江山 | [Scenic View of Karst Mountains and River](https://www.pexels.com/video/scenic-view-of-karst-mountains-and-river-36932826/)，Cfq938888 Chen，[Pexels License](https://www.pexels.com/license/) | 节选 2.0 秒起片段，统一 24 fps，阴雨冷色调色，静音。 |
| 细雨落水涟漪 | [Rain falling on the water of a lake seen up](https://mixkit.co/free-stock-video/rain-falling-on-the-water-of-a-lake-seen-up-18312/)，Mixkit，[Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree) | 节选 2.5 秒起片段，低饱和冷青调色，静音。 |
| 青瓦老墙落雨 | [Cabin on rainy day](https://mixkit.co/free-stock-video/cabin-on-rainy-day-2738/)，Mixkit，[Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree) | 节选 0.3 秒起片段，冷暗暮雨调色，静音。 |
| 深谷悬崖江流 | [Fly over a huge canyon covered in vegetation](https://mixkit.co/free-stock-video/fly-over-a-huge-canyon-covered-in-vegetation-41401/)，Mixkit，[Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree) | 节选 4.0 秒起片段，低饱和冷青冬谷调色，静音。 |
| 急流近景与水声 | [A Close-Up Shot of the Cascading Water in the River](https://www.pexels.com/video/a-close-up-shot-of-the-cascading-water-in-the-river-4058993/)，João Pavese，[Pexels License](https://www.pexels.com/license/) | 节选 2.0 秒起画面压暗调色；音轨经高通/低通滤波，仅在于都、湘江、乌江河段平滑混入。 |
| 晨雾山林破晓日出 | [Forest covered by mist at sunrise from the heights](https://mixkit.co/free-stock-video/forest-covered-by-mist-at-sunrise-from-the-heights-28339/)，Mixkit，[Mixkit Stock Video Free License](https://mixkit.co/license/#videoFree) | 节选 11.0 秒起片段，暖金破晓调色，静音。 |
| 纪实弦乐配乐 | [Hiraeth](https://www.scottbuckley.com.au/library/hiraeth/)，Scott Buckley，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。署名：`'Hiraeth' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au` | 节选 238–333 秒黄金后段与自然落幕段，加旁白侧链闪避混音。 |
| 本课 3D 现场运镜 | 自制课件实时三维场景（于都河岸、湘江渡口、遵义材料厅、遵义精修会议桌），由 `record-opening-3d.py` 离线录制 | 输出至 `.march-build/opening-sources/recorded-3d/`，经统一冷暖调色无缝剪入成片。 |

所有外部片源文件名、URL 与 SHA-256 校验值记录在 `make-opening.py` 的 `SOURCES` 清单中，并写入成片 `opening.mp4` 的 `comment` 元数据。源码与成片一并分发时保留本页。

## 重剪与核对

外部素材缓存放在 `.march-build/opening-sources/`，本课 3D 现场运镜缓存放在 `.march-build/opening-sources/recorded-3d/`，旁白分句缓存放在 `.march-build/opening-sources/voice-v2/`（对应文本稿 `课堂演示/media-source/opening-narration.tsv`）。缓存就绪后在仓库根目录依次执行：

```powershell
python -B "课堂演示/media-source/record-opening-3d.py"
python -B "课堂演示/media-source/make-opening.py"
```

如需修改 `opening-narration.tsv` 并重合成男声旁白，加 `--synthesize` 参数。重剪依赖 Python（Pillow、NumPy、Playwright）、系统微软雅黑/宋体字体以及 FFmpeg/FFprobe。正式课件打包时只内嵌 `课堂演示/assets/opening.mp4`，离线运行无需片源缓存。

正式课件重建后，用 `python -B "Test/verify-course-media.py" --check-join opening terrain yudu-assembly` 核对 Edge 实际解码首尾帧误差，并在 16:9 与 16:10/3:2 窗口下检查响应式安全区信息层零裁切、暂停续播与进入课堂衔接。
