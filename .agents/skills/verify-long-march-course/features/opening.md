# 开场及于都集结

## 子功能

从地图播放离线片头，暂停、续播，切回于都集结。主控播放音轨，投影显示同一画面。

## 如何进入

在地图点「开始双屏授课」后点「开始授课」。片头操作为「暂停短片」「继续播放」「进入课堂」。

## 用 CLI 操作

`python -B "Test/course_cli.py" run opening` 走两屏播放及续播，再看两屏是否都进于都集结。剪辑变更时追加 `python -B "Test/verify-dual.py" --check-join opening yudu-bank yudu-assembly`，对照实际入图、出图与解码帧。

## 易错处

分别观察按「进入课堂」前后的相机与裁切。用正常速度听一次音画交接，片头的素材性质与署名查 `课堂演示/media-source/opening-sources.md`。
