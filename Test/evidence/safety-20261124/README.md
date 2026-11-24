# 五点式安全带课技术调研与验证档案
日期：2026-11-24。此目录保留各轮历史报告与最新候选技术路线，历史状态以各自报告日期为准，当前状态以第五轮报告为准。

## 文档
- [第一轮测试验证报告](安全带测试验证报告.md)：核心规则、离线部署PoC及初次失败记录。
- [第二轮验证报告](安全带第二轮验证报告.md)：检查卡加固、真实WASM并发与剩余风险。
- [第四轮验证报告](安全带第四轮验证报告.md)：Windows CI、真人普通话模型对照、局部浏览器验证。
- [第五轮技术调研与验证报告](安全带第五轮技术调研与验证报告.md)：专用视觉数据和模型、中文ASR候选、Edge及稳定性方案。
- [压力测试原始数据](harness-stress-results.json) 与 [历史复跑脚本](harness-stress.cjs)。

## 复跑和归档说明
既有 Windows 验证代码见本分支的 .github/workflows/safety-public-baseline.yml；[基础CI](https://github.com/glyahh/VR-Teaching/actions/runs/45355921777) 与 [ASR基准CI](https://github.com/glyahh/VR-Teaching/actions/runs/45356893344) 保存运行记录。第五轮原始压力测试脚本需先从对应加固HTML提取Worker、WASM、模型和测试夹具，按第二轮复跑包说明准备同目录文件；原脚本输出路径为 /mnt/data/harness-stress-results.json，本地复跑时按环境调整。第一、二轮报告引用的本地独立验证包及模型产物不代表已经提交到远程。未发现独立第三轮报告，不虚构。未上传第三方数据集、未经许可的素材、模型二进制或学员录音。

当前 releaseReady=false。未合并主分支，未修改正式课件或教学内容。