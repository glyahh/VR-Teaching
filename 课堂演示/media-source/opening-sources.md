# 长征课片头分镜及素材

## 正式版 120 秒纪实导览

2026 年 11 月 27 日，将 OpenMotion 试剪接入「开始授课」并重混配音。压缩前的成片 SHA-256 为 `8731a7b1a0d9b301f091510b42e1f73f7f020391c73bea31327ccc70fa3b2b7c`。画面母版 OpenMotion 可编辑工程 ID 为 `af6dcd19-1f77-47fc-8ac7-830146db76cc`，导出版本为 `75c69a70-6124-41db-8b57-73e43d9d1933`。

课堂运行资产 `课堂演示/assets/opening.mp4` 沿用 1280×720、24 fps、2880 帧和原 AAC 音轨，SHA-256 为 `d4b8fdfe88a582d22e7805b254e5d1f480fa407a24089d86e61df94cfdbc65b9`。用 `libx264` 的 `slow`、CRF 23 和 BT.709 转码，首尾帧所在区间用 `zones=0,24,q=17/2832,2879,q=17` 保留更多细节。成片启用 `+faststart`，大小 23.98 MiB。断网 Edge 解码片头首尾平均 RGB 差分别为 1.78/255 和 1.89/255。

旁白沿用云健 `zh-CN-YunjianNeural`，以语速 −8% 至 −11%、音高 −3 Hz 至 −4 Hz 随段落情绪微调呼吸，按意群分句合成并配平各句响度（全片零加速，集成响度 −17.1 LUFS、真峰值 −1.6 dBFS）。`src/opening-overlay.ts` 按视频时钟显示 31 条单行字幕、地点角标及原四站时间轴。底部进度条悬停或键盘聚焦时出现，拖动使用同一个视频时钟。总览地形和于都集结原图用于首尾对齐。片中路线为示意，教学复原、实拍和地图在下文标记来源。

### 正式版逐镜分镜

表中的 `opening.mp4` 源片是旧版 95 秒混剪，SHA-256 为 `17ccae8c03ba59a8dab44fc149679203f7e594bad2975914975a724d3334cc4b`。

| 镜头 | 成片时码 | 画面、动作和衔接 | 声音 | 来源与入点 |
| --- | --- | --- | --- | --- |
| 01 | 00:00.00–00:09.25 | 课件地形首帧接入，云层掠过群山 | 先听压低的弦乐，末尾提前引入河声 | `opening.mp4`，00:00.00–00:09.25 |
| 02 | 00:09.25–00:12.00 | 岸边中景，乡亲把门板抬向浮桥 | 近处水声压过配乐 | `yudu-preparation.mp4`，00:00.00–00:02.75 |
| 03 | 00:12.00–00:16.00 | 抬门板、落梁、手离开，把群众支援落到一个动作 | 近岸水声连续并随旁白轻度闪避 | `deck.mp4`，00:00.00–00:04.00 |
| 04 | 00:16.00–00:19.00 | 切船侧近景，看清纵梁把桥面重量传到船上 | 从桥上木声切近水线 | `under-bridge.mp4`，00:00.00–00:03.00 |
| 05 | 00:19.00–00:25.00 | 从船侧切到队伍由近向远踏上桥面 | 夜水声渐退 | `yudu.mp4`，00:01.00–00:07.00 |
| 06 | 00:25.00–00:30.00 | 换成桂北江谷远景，保留江面在构图里的方向 | 更开阔的江水声提前进入 | `pexels-karst-river-36932826.mp4`，00:02.00–00:07.00 |
| 07 | 00:30.00–00:35.00 | 负重队伍涉水，画面看得到队员在移动 | 涉水声贴近，音乐压低 | `02-crossing.mp4`，00:00.00–00:05.00 |
| 08 | 00:35.00–00:39.00 | 从渡江动作切守候者望江，交代渡口仍有人守 | 水声继续，降低弦乐 | `03-guard.mp4`，00:00.00–00:04.00 |
| 09 | 00:39.00–00:43.25 | 岸坡休整远景，让视线落在坐下来的人身上 | 江水逐渐退到远处 | `04-after-clean.mp4`，00:00.00–00:04.25 |
| 09b | 00:43.25–00:48.00 | 近看放下行囊和停下来喘息的动作 | 旁白交代两个时点，江声留在远处 | `湘江休整-补镜.mp4`，00:00.25–00:05.00 |
| 10 | 00:48.00–01:00.00 | 同一张区域图标出湘江、原定会合方向和受阻区域 | 保留低弦，旁白问原路是否还能继续 | OpenMotion 地形路线动画，沿用课件坐标与地形数据 |
| 11 | 01:00.00–01:06.00 | 雨檐接黎平街巷，让路线争论回到一个地点 | 雨声从地图末段先入 | `opening.mp4`，00:42.75–00:48.75 |
| 12 | 01:06.00–01:24.00 | 恢复同尺度地图，先保留原线，再从黎平描出黔北新方向 | 配音讲争议和决定，新旧线对比有辨认时间 | OpenMotion 地形路线动画，沿用课件坐标与地形数据 |
| 13 | 01:24.00–01:31.50 | 保留图幅，猴场亮起后按照猴场与乌江的次序推进 | 江流提前进入下一镜 | OpenMotion 地形路线动画，沿用课件坐标与地形数据 |
| 14 | 01:31.50–01:35.50 | 从地图里的乌江切到有水势的近景 | 急流打开，旁白继续 | `opening.mp4`，01:05.75–01:09.75 |
| 15 | 01:35.50–01:38.00 | 从急流接乌江岸侧行军，队伍继续向前 | 水声延续，进室前渐退 | `opening.mp4`，01:09.75–01:12.25 |
| 16 | 01:38.00–01:43.00 | 沿会址门口进入室内，冷色退到暖灯 | 江水声渐退，让旁白接过注意力 | `opening.mp4`，01:12.25–01:17.25 |
| 17 | 01:43.00–01:48.50 | 议事场面接会议桌上的材料，交代要处理的问题 | 降低配乐，让旁白落在材料画面 | `opening.mp4`，01:17.00–01:22.50 |
| 18 | 01:48.50–01:55.00 | 破晓航拍接过桌面的问题，亮处引向于都 | 让弦乐和晨雾先接住镜头，旁白随后回到于都 | `mixkit-sunrise-mist-28339.mp4`，00:06.17–00:12.67 |
| 19 | 01:55.00–02:00.00 | 晨雾自然叠到于都集结原图，按正式课页机位落下 | 水岸气息回来，尾音轻收 | `opening.mp4`，01:30.00–01:35.00 |

### 正式版史料与素材

- 于都群众提供门板、船只，架浮桥支援红军过河。
- 两组兵力数字的时点分别为长征出发时和渡过湘江后，反映沿途减员。路线线条是课堂示意。
- 黎平会议改向贵州，决定拟在以遵义为中心的川黔边地区建立根据地。猴场重申黎平决定，随后强渡乌江。遵义会议集中解决军事和组织问题。
- 桂北江谷实拍，Cfq938888 Chen，Pexels License。乌江段急流为空间气氛近景，João Pavese，Pexels License。[桂北江谷](https://www.pexels.com/video/scenic-view-of-karst-mountains-and-river-36932826/) · [急流](https://www.pexels.com/video/a-close-up-shot-of-the-cascading-water-in-the-river-4058993/) · [Pexels License](https://www.pexels.com/license/)
- 晨雾航拍，Mixkit Stock Video Free License。复用的 95 秒版镜头的出处见下方旧版记录。[晨雾航拍](https://mixkit.co/free-stock-video/forest-covered-in-mist-at-sunrise-from-the-heights-28339/) · [Mixkit Free License](https://mixkit.co/license/#videoFree)
- 配乐为 Scott Buckley 的 Hiraeth，取原曲 03:35–05:35，分句压低配乐。'Hiraeth' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au。[原曲](https://www.scottbuckley.com.au/library/hiraeth/) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- 环境声复用课件江水音频并按场景调节远近，人声频段（2.1–2.4 kHz）作避让均衡并随旁白柔和闪避；移除旧版 `deck-sound.m4a`（实为旧旁白人声串扰）。补镜是根据课件湘江河岸图制作的教学复原，模型为 MiniMax H3 High，任务为 `task_2f6890b171ac490c8213ef044a2586d5`，参考图为 `assets/xiang-aftermath.jpg`。

## 历史制作记录，95 秒片头

下表使用旧版时间。现行运行文件以上方 120 秒版和校验值为准。

放映入口衔接总览地形原图（`terrain.jpg`），收尾画面回到于都集结原图（`yudu-assembly.jpg`），再由教师点击「进入课堂」进入第一课页。片头按纪录片结构铺陈 1934 年秋至 1935 年 1 月的历史背景与四站因果：第五次反“围剿”受挫、于都夜渡、血战湘江、黎平改向、强渡乌江、遵义会议召开与全线四站时空回望，最后破晓转折回到于都起点。

全片由 7 支经核验的外部横屏 1080p 实拍视频、5 支本课高精 3D 实时场景电影级运镜（由 `record-opening-3d.py` 离线录制）、4 支课内动态短片、3 段全安全区内收的暗调 3D 动态沙盘地图与极少量历史实景过渡构成，全片动态镜头占比超过 92%。字幕、地点角标和四站时间轴由 `opening-overlay.ts` 随 `video.currentTime` 渲染，暂停时同步定格。时间轴与字幕共用底部区域，线条走到圆点中心时点亮该站。配音为沉稳纪实男声（`zh-CN-YunjianNeural`，文本稿见 `opening-narration.tsv`），配以独奏大提琴弦乐与河段限定水声，相邻镜头均使用 0.50 秒柔和叠化。

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
| 38.20–43.30 秒 | 本课 3D 湘江寒江抢渡高空俯冲（`3d-xiang-crossing.mp4`），红军涉水队列与两翼合围脉冲红弧实时演进，配贴底字幕。 | 水声在 38.3 秒平稳淡出，大提琴低沉承托减员数字。 |
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

### 旧版片源与许可

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

### 旧版 OpenMotion 混剪

上面的分镜表和 `make-opening.py` 保留原版制作基线；直接运行该脚本会重制原版，不会重现本次混剪。

- 六处视频替换：18.00–21.10 秒于都架桥、21.10–23.45 秒于都夜渡、38.20–43.30 秒湘江涉水、72.25–76.65 秒遵义入室、76.65–79.85 秒遵义会议、79.85–83.15 秒遵义桌面。采用 SRAPI MiniMax H3 High 文生视频，均为教学情境示意，不作为历史影像或实体陈设的证据。
- 46.20–48.75 秒黎平翘街与 69.50–72.25 秒乌江行军改为 H3 High 动态镜头；未上传课件原图，原有代码地图照旧。
- 结尾延长上表所列 Mixkit 28339 山林晨雾实拍（沿用 Free License），从第 2188 帧延续，叠化回原于都落地画面；从第 2246 帧起保留原版最后 34 帧（帧号从零起算）。实拍素材 SHA-256：`9ffdb5956a027eb86ed4a9c8d2723a1d151e67ea5a02deddd967d94fca0cf2e4`。
- `assets/opening.mp4` 为无烧录字幕的 1280×720、24 fps、95.000 秒（2280 帧）课堂母版。为避免重编码色差，起始 14 帧、收尾 34 帧直接取自原片解码画面再编码，并保持版式和时长。原旁白及配乐不变，字幕与信息层仍由课件渲染；不调用网络或生成接口。本版入库的是成片，不依赖审阅 MP4、生成缓存或凭据。

### 重建旧版

外部素材缓存放在 `.march-build/opening-sources/`，本课 3D 现场运镜缓存放在 `.march-build/opening-sources/recorded-3d/`，旁白分句缓存放在 `.march-build/opening-sources/voice-v2/`（对应文本稿 `课堂演示/media-source/opening-narration.tsv`）。缓存就绪后在仓库根目录依次执行：

```powershell
python -B "课堂演示/media-source/record-opening-3d.py"
python -B "课堂演示/media-source/make-opening.py" --output ".march-build/opening-sources/opening-legacy.mp4"
```

如需修改旧版 `opening-narration.tsv` 并重合成男声旁白，加 `--synthesize` 参数。重剪依赖 Python（Pillow、NumPy、Playwright）、系统微软雅黑/宋体字体以及 FFmpeg/FFprobe。正式课件打包时只内嵌 `课堂演示/assets/opening.mp4`，离线运行无需片源缓存。

正式课件重建后，用 `python -B "Test/verify-course-media.py" --check-join opening terrain yudu-assembly` 核对 Edge 实际解码首尾帧误差，并在 16:9 与 16:10/3:2 窗口下检查响应式安全区信息层零裁切、暂停续播与进入课堂衔接。
