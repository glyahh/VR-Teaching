# 于都河岸：OpenMotion 图生视频短片

本版替代「浮桥近景 → 于都河岸」五段固定课堂演示。每段从 OpenAI 原生工具全新生成的写实参考 PNG 出发，输入 MiniMax H3 High（SRAPI，`mode=reference`），用 OpenMotion / OpenMontage 剪辑。当前原生生图入口没有返回可验证的模型版本。成片与静止画面均不使用旧课件截图、WebGL 录屏或上一版插入镜头。画面是教学复原，不是历史影像。

| 段 | 帧数 @24 fps | 镜头 |
| --- | ---: | --- |
| 到桥头 | 89 | 码头石阶前，队伍前行，灯火低摇 |
| 看桥下 | 76 | 水线边横移，看船舷、纵梁与绳结 |
| 看架桥 | 96 | 两人降低门板，到梁、放稳，手再放开 |
| 看夜渡 | 88 | 沿一处浮桥侧面跟拍；不把一条生成镜头当作多处渡口的证据 |
| 看收桥 | 95 | 天将亮，开口处一艘空船缓慢离开 |

短片每段独立点播。首帧载入、段末讲解和减少动态效果使用同一新视频的解码定格，不淡回旧的固定三维演示。视频内嵌纪录片风格普通话男声，字幕放在底部居中；旁白播放时压低课件环境声，停止或暂停后恢复。课件全局静音也控制该音轨。不在左上角显示镜头编号或步骤；「看桥下」下方提示把缺船断口明确交给构件查看，「看夜渡」区分镜头内的一处和讲解中的多处分流。可自由操作的三维场景、构件剖看、史料回看、分流对照、片头和其他章节不换。窄窗等非典型画幅采用等比显示，不裁去桥和人物。

旁白参考片头的纪录片节奏；原片头使用 Edge 云健音色，这五段使用本地 [Kokoro v1.1 中文音色](https://k2-fsa.github.io/sherpa/onnx/tts/all/Chinese-English/kokoro-multi-lang-v1_1.html) zm_009，音色并非完全相同。课件内的字幕采用同一份旁白文本，无需联网合成。

配乐沿用现有课件授权的 [Hiraeth](https://www.scottbuckley.com.au/library/hiraeth/)，Scott Buckley，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)；从课尾弦乐素材节选和分段，加短淡入淡出，随旁白自动压低。署名：'Hiraeth' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au。

史料用于约束场景和旁白：[于都纪念馆：门板、渔船与竹篙](https://www.ydczcfmuseum.cn/article/1005)，[国防部：夜架拂晓前拆桥](https://www.mod.gov.cn/gfbw/gfjy_index/16476460.html)。镜头内人数、视点、服装、灯光及工序细节是教学复原，不是独立的史实证据。

参考图哈希、原片哈希、解码源帧区间和最终交付哈希见 [yudu-shorts-qa.json](yudu-shorts-qa.json)。帧号从零开始，区间右端不含。无 API 密钥、外链或实时生成依赖。

```sh
node "课堂演示/build.mjs" --preview
python "Test/verify-yudu-shorts.py" ".march-build/课件预览/课堂预览.html"
```
