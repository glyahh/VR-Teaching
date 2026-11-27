# 湘江渡口短片

本次重做湘江战役章节的「湘江渡口」。上一页「湘江河谷」的首图作为入片锚点，下一页「湘江留下的启示」的河岸暂歇图作为出片锚点。自然播完后，课件保留解码尾帧并自动淡接下一页。窄窗先从完整画幅平滑过渡到下一页的铺满构图。

用 Generate Video 向 SRAPI 提交四个参考图生视频任务。模型为账号可用的 `minimax-h3-f-high`，请求 768p、16:9。画面在 OpenMotion 本地可编辑工程排成 17 秒，960×540、24 帧/秒、408 帧，沿用课件江水环境声。表中帧号从零计，右端不含。

| 成片帧 | 画面和片源 | SRAPI 任务 |
| --- | --- | --- |
| 0–96 | 参考 `xiang.png` 的河湾全景，远处队伍沿岸出现。首帧从实际上一页图接入。 | `task_fb3fbd40d63c4256b44bf8b382ac0291` |
| 96–216 | 参考 `xiang-ford.jpg`，跟随负重队伍沿浅滩石头走向对岸，保留落脚与水流。 | `task_022a26c0b0354c0a894dbc523d989012` |
| 216–312 | 参考 `xiang-aftermath.jpg` 的岸坡左侧裁图，切到守候者望向江面。 | `task_61de383190d54ac088db6ed814bebb77` |
| 312–408 | 参考完整的 `xiang-aftermath.jpg`，队伍在岸上暂歇。将源片裁为 1184×666，移除画幅下缘的生成字样。片尾叠回实际后一页图。 | `task_634e7921222b4ea88e3cb2824659f7ea` |

四段视频分别从各自首帧取 96、120、96、96 帧。OpenMotion 工程为 `cca11ebf-03c3-4ae7-b2d6-d2215e8f11ba`，导出任务为 `9a38fb71-c5f5-4c3e-89ce-15aa0a52bce2`。原始参考图、提示词、片源哈希、截取区间和审片记录保存在任务目录 `.march-build/xiang-video-remake/`。OpenMotion 导出和课件内嵌 MP4 的 SHA-256 均为 `236732583a1382c2b8cc9730f4c80c61e5eb9ae0a5dcd5ebb2ef9e1a8c24ee22`。

画面、人物和队伍数量为教学情境复原。中央红军在全州、兴安之间渡过湘江，突破第四道封锁线并付出重大代价。界首等处曾使用浮桥。涉水画面用于观察渡江的处境和行动。[中央党史和文献研究院](https://www.dswxyjy.org.cn/n1/2020/0305/c219021-31618260.html) · [国防部资料](https://www.mod.gov.cn/gfbw/gfjy_index/js_214151/4852696.html) · [界首渡口资料](https://m.ccdi.gov.cn/content/ee/10/12201.html)

经审片的 OpenMotion MP4 用 `python -B "课堂演示/media-source/make-xiang-crossing-tour.py" <导出文件>` 转为离线运行资源。脚本对照 [分镜清单](xiang-crossing-tour.json) 验证规格、时长和解码帧数。课件原样打包 MP4，以 Edge 解码生成开场和结尾静图。正课字幕在 4、9、13 秒随镜头切换，烧录字幕的文件另外用于审片。

重建后运行 `python -B "Test/verify-xiang-crossing.py" <课件>`，并用 `python -B "Test/verify-course-media.py" --html <课件> --check-join xiang-tour xiang xiang-aftermath` 对照解码首尾帧与实际前后课页。
