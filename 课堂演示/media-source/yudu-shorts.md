# 于都河岸：OpenMotion 图生视频短片

本版替代「浮桥近景 → 于都河岸」五段固定课堂演示。每段从 OpenAI 原生工具全新生成的写实参考 PNG 出发，输入 MiniMax H3 High（SRAPI，`mode=reference`），用 OpenMotion / OpenMontage 剪辑。当前原生生图入口没有返回可验证的模型版本。成片与静止画面均不使用旧课件截图、WebGL 录屏或上一版插入镜头。画面是教学复原，不是历史影像。

| 段 | 帧数 @24 fps | 镜头 |
| --- | ---: | --- |
| 铺门板 | 96 | 两人降低门板，到梁、放稳，手再放开 |
| 看桥下 | 76 | 水线边横移，看船舷、纵梁与绳结 |
| 到桥头 | 89 | 码头石阶前，队伍前行，灯火低摇 |
| 看夜渡 | 88 | 沿一处浮桥侧面跟拍；不把一条生成镜头当作多处渡口的证据 |
| 看收桥 | 95 | 天将亮，开口处一艘空船缓慢离开 |

正式课页「浮桥近景」点一次「于都河岸」，完整播放 `river-tour.mp4`，总计 444 帧，画面时长 18.5 秒。剪辑脚本和课件共用 [五镜顺序](yudu-river-tour-order.json)。旁白随镜头剪入，课件字幕按镜头帧边界切换。旁白播放时压低环境声，暂停时恢复，课件静音控制该音轨。横屏画面铺满课页，字幕沿用片头的贴底居中样式。窄窗完整显示视频，空余区域以柔化静帧衬底。播放开始即显示「进入河岸」，点击后暂停视频再挂载三维，退出后从原位置等待继续。播完保留最后画面和字幕。另一个课页「岸边备桥」保留按需点播的独立短片。

正式连播成片和片头共用微软云健（`zh-CN-YunjianNeural`），语速 `-8%`，音高 `-3Hz`。人声均衡、动态压缩、配乐闪避和限幅共用 `course_narrator.py` 的参数。每句从对应镜头开头后约 0.14 秒起读，保留自然语速并在切镜前结束。分句合成需联网，成片与字幕全都内嵌在课件中。五个独立镜头及其 QA 清单是原始拼接记录，正式课页使用重配后的连播成片。

配乐沿用 Scott Buckley 的 [Hiraeth](https://www.scottbuckley.com.au/library/hiraeth/)，以现有课尾弦乐节选 `recap-cello.mp3` 连续铺底，随旁白自动压低。署名：'Hiraeth' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au。[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

镜头内人数、视点、服装、灯光及工序细节是教学复原，不是独立的史实证据。

参考图哈希、原片哈希、解码源帧区间和五个单镜头哈希见 [yudu-shorts-qa.json](yudu-shorts-qa.json)。帧号从零开始，区间右端不含。

三维河岸以「到桥头」「看桥下」「看收桥」的片帧和岸边备桥图为参考。现有水面法线铺在细分河面上，靠岸减小起伏，浅处透出河床颜色。岸草沿湿土和小路外侧分布，保留渡口进出路径。草丛继续复用已有 Poly Haven Grass Medium 01 实例模型；近岸新增 Rob Tuytel 的 Grass Path 3 颜色与 OpenGL 法线 1K JPG，两个文件以原尺寸内嵌。其 SHA-256 分别为 `71b0a514bbb65a0ec2731e82b6bad0bb3a1e089cb671cf697bfe53f75f5da943`、`473bf439c266ffe357409fb0fb4758ed6cd1d6889df588f42e174b7cb6481cc5`。 [Grass Medium 01](https://polyhaven.com/a/grass_medium_01) · [Grass Path 3](https://polyhaven.com/a/grass_path_3) · [Poly Haven CC0 许可](https://polyhaven.com/license)

水面采用水线侧看和进入河岸时的同机位对照。Sozai Search 与 3D Valley 查到的直接材质主要是雨滴水洼、泳池焦散和河床。两边都能定位 Poly Haven 的 Lakeside Dawn 环境图，由 Greg Zaal 和 Jarod Guest 制作。将上游色调映射 JPG 以 Lanczos 缩为 768×384，供远近水面反射使用。运行文件 `river-reflections.jpg` 的 SHA-256 为 `859039643bedd7225fb8076a46a68a3f11dd1d178c45580a94a9b6ede39bb989`。 [Lakeside Dawn](https://polyhaven.com/a/lakeside_dawn) · [Poly Haven CC0 许可](https://polyhaven.com/license)

细波用 ProcTexture 的 Wave Normal Map，CC0 1.0。取 1K PBR 包中的 `normal.png`，以 Lanczos 缩到 512×512，作为于都专用的 `river-calm-normal.png`。原图 SHA-256 为 `bf8577dc7969569edc54c84f5b07d5c152ea91905911b416a6cfc702f7e7b372`，运行图为 `66779c154e97f542d283b2ddd35bee5945827b1a359b54c989946de4cfc9dbdb`。浅岸水色、船壳水线和波纹流动仍由河岸着色器控制。Grass Bermuda 01 原样进场时露出黑色叶片面，同机位对照后沿用 Grass Medium 01。 [Wave Normal Map](https://proctexture.com/textures/water/normal-maps/wave-normal-map) · [ProcTexture 许可](https://proctexture.com/terms)

```sh
python -B "课堂演示/media-source/make-yudu-river-tour.py" --synthesize
node "课堂演示/build.mjs" --preview
python -B "Test/verify-yudu-shorts.py" ".march-build/课件预览/课堂预览.html"
```

分句缓存默认位于 `.march-build/河岸云健旁白/分句/`，缓存为对应字幕、音色和参数生成的 WAV。缓存齐全时可去掉 `--synthesize` 离线重混。仅换音轨时用 `--picture <已验收的连播成片>` 复制画面流，按 444 帧及解码画面一致性复核。
