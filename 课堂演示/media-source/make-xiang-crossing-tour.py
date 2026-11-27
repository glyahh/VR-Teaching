"""准备通过审片的 OpenMotion 导出，并以 Edge 生成首尾静图。"""

import argparse
from base64 import b64decode, b64encode
import json
from pathlib import Path
from shutil import copyfile
import subprocess
from tempfile import TemporaryDirectory

from playwright.sync_api import sync_playwright


SOURCE = Path(__file__).resolve().parent
ASSETS = SOURCE.parent / "assets"
FPS = 24


def make_posters(film, output):
    source = "data:video/mp4;base64," + b64encode(film.read_bytes()).decode("ascii")
    with sync_playwright() as playwright, playwright.chromium.launch(channel="msedge") as browser:
        page = browser.new_page(offline=True)
        posters = page.evaluate("""async source => {
          const video = document.createElement('video');
          video.muted = true;
          await new Promise((resolve, reject) => {
            video.addEventListener('loadeddata', resolve, {once: true});
            video.addEventListener('error', () => reject(new Error('湘江短片解码失败')), {once: true});
            video.src = source;
          });
          const canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const context = canvas.getContext('2d');
          const frames = [];
          for (const time of [0.01, video.duration - 0.01]) {
            const ready = new Promise(resolve => video.addEventListener('seeked', resolve, {once: true}));
            video.currentTime = time;
            await ready;
            context.drawImage(video, 0, 0);
            frames.push(canvas.toDataURL('image/jpeg', .98).split(',')[1]);
          }
          return frames;
        }""", source)
    for name, jpeg in zip(("start.jpg", "end.jpg"), posters, strict=True):
        (output / name).write_bytes(b64decode(jpeg, validate=True))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("export", type=Path, help="已审片的 OpenMotion MP4 导出")
    parser.add_argument("--output", type=Path, default=ASSETS / "xiang-crossing")
    args = parser.parse_args()
    shots = json.loads((SOURCE / "xiang-crossing-tour.json").read_text(encoding="utf-8"))
    duration = sum(shot["seconds"] for shot in shots)
    metadata = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-count_frames",
        "-show_entries", "format=duration:stream=codec_name,width,height,pix_fmt,avg_frame_rate,nb_read_frames",
        "-of", "json", str(args.export),
    ], text=True))
    video = next((stream for stream in metadata["streams"] if stream["codec_name"] == "h264"), {})
    if (video.get("width"), video.get("height"), video.get("pix_fmt"), video.get("avg_frame_rate")) != (
        960, 540, "yuv420p", f"{FPS}/1"
    ):
        raise ValueError("成片规格须为 960×540、24 帧/秒、H.264 yuv420p")
    if int(video["nb_read_frames"]) != duration * FPS or abs(float(metadata["format"]["duration"]) - duration) > .001:
        raise ValueError(f"成片时长或解码帧数与 {duration} 秒分镜清单不符")
    if not any(stream["codec_name"] == "aac" for stream in metadata["streams"]):
        raise ValueError("成片缺少 AAC 环境声音轨")
    args.output.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=args.output.parent) as folder:
        work = Path(folder)
        film = work / "tour.mp4"
        copyfile(args.export, film)
        make_posters(film, work)
        for name in ("tour.mp4", "start.jpg", "end.jpg"):
            (work / name).replace(args.output / name)


if __name__ == "__main__":
    main()
