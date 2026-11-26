"""逐帧核对两个同机位人物短样，留存原速、四分之一速及可放大的逐帧画面。"""
import argparse
import json
import os
import shutil
import subprocess
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFont
from playwright.sync_api import sync_playwright


def frame_count(path):
    info = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "stream=codec_type,time_base,width,height:frame=best_effort_timestamp", "-show_frames",
        "-of", "json", str(path),
    ]))
    stream, = info["streams"]
    if (stream["codec_type"], stream["width"], stream["height"]) != ("video", 1280, 720):
        raise ValueError(f"{path} 应为 1280 × 720 无声片源")
    clock = Fraction(stream["time_base"])
    for n, frame in enumerate(info["frames"]):
        if clock * int(frame["best_effort_timestamp"]) != Fraction(n, 24):
            raise ValueError(f"{path} 帧 {n} 的时码有误")
    return len(info["frames"])


def play_offline(browser, url, rate):
    with browser.new_context(offline=True, viewport={"width": 1280, "height": 720},
                             service_workers="block") as ctx:
        page = ctx.new_page()
        page.goto(url)
        return page.locator("video").evaluate("""async (v, rate) => {
          const seen = [], stalls = [];
          for (const evt of ['stalled', 'error']) v.addEventListener(evt, () => stalls.push(evt));
          return new Promise((resolve,reject) => {
            let start;
            const timer = setTimeout(() => reject(Error('播放超时')), 90000);
            const onFrame = (_, m) => {seen.push(Math.round(m.mediaTime*24)); if (!v.ended) v.requestVideoFrameCallback(onFrame);};
            v.requestVideoFrameCallback(onFrame);
            v.onended = () => {clearTimeout(timer); const q = v.getVideoPlaybackQuality();
              resolve({rate:v.playbackRate, ended:v.ended, wall_ms:Math.round(performance.now()-start),
                       duration:v.duration, presented:[...new Set(seen)], dropped:q.droppedVideoFrames, stalls});};
            v.addEventListener('loadedmetadata', () => {
              v.defaultPlaybackRate = rate;
              v.playbackRate = rate;
              start = performance.now();
              v.play().catch(reject);
            }, {once:true});
            v.src = v.dataset.src;
            v.load();
          });
        }""", rate)


def frame_sheets(path, output, count, font):
    # Leave the original frame number visible. No temporal resampling or skipped poses.
    width, height, rows, columns = 420, 236, 3, 4
    size = width * height * 3
    output.mkdir(exist_ok=True, parents=True)
    with subprocess.Popen(["ffmpeg", "-v", "error", "-i", str(path), "-vf", f"scale={width}:{height}",
                           "-pix_fmt", "rgb24", "-f", "rawvideo", "-"], stdout=subprocess.PIPE) as process:
        for n in range(count):
            where = n % (rows*columns)
            if where == 0:
                sheet = Image.new("RGB", (width*columns, (height+25)*rows), (30, 31, 30))
                draw = ImageDraw.Draw(sheet)
            data = process.stdout.read(size)
            if len(data) != size:
                raise IOError(f"{path} 只读到第 {n} 帧")
            x, y = (where%columns)*width, (where//columns)*(height+25)
            sheet.paste(Image.frombytes("RGB", (width,height), data), (x,y+25))
            draw.text((x+5,y+1), f"{n:03d}", font=font, fill="white")
            if where == rows*columns-1 or n == count-1:
                sheet.save(output/f"{n-where:03d}-{n:03d}.jpg", quality=93, optimize=True)
        if process.wait():
            raise IOError(f"{path} 解码失败")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("first", type=Path)
    parser.add_argument("second", type=Path)
    parser.add_argument("--labels", nargs=2, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    files = [args.first, args.second]
    count = frame_count(files[0])
    if frame_count(files[1]) != count:
        raise ValueError("两片帧数不同")
    args.output.mkdir(parents=True, exist_ok=True)
    args.evidence.mkdir(parents=True, exist_ok=True)
    font_file = str(Path(os.environ["WINDIR"])/"Fonts/msyh.ttc")
    font = ImageFont.truetype(font_file, 28)
    result = {"source_frames": count, "size_per_panel": [1280,720], "playback": {}}
    with TemporaryDirectory() as temp:
        work = Path(temp)
        banner = Image.new("RGB",(2560,48),(25,26,25))
        pen = ImageDraw.Draw(banner)
        for i, label in enumerate(args.labels):
            pen.text((1280*i+18,4),label,font=font,fill=(244,240,224))
        header = work/"header.png"
        banner.save(header)
        regular = args.output/"同机位原速.mp4"
        slow = args.output/"同机位四分之一速.mp4"
        encoder = ["-an", "-c:v", "libx264", "-preset","fast", "-crf","17", "-threads","4",
                   "-pix_fmt","yuv420p","-movflags","+faststart"]
        subprocess.run(["ffmpeg","-v","error","-y","-i",str(files[0]),"-i",str(files[1]),"-i",str(header),
                        "-filter_complex","[0:v][1:v]hstack,pad=2560:768:0:48[row];[row][2:v]overlay=0:0[v]",
                        "-map","[v]","-frames:v",str(count),*encoder,str(regular)],check=True)
        subprocess.run(["ffmpeg","-v","error","-y","-i",str(regular),"-vf",
                        "setpts=4*PTS,tpad=stop_mode=clone:stop_duration=1,fps=24",
                        "-frames:v",str(count*4),*encoder,str(slow)],check=True)
        with sync_playwright() as playwright, playwright.chromium.launch(channel="msedge", headless=True) as browser:
            result["edge"] = browser.version
            for i,path in enumerate(files):
                filename=f"clip{i}.mp4"
                shutil.copyfile(path,work/filename)
                html=work/f"clip{i}.html"
                html.write_text(f'<video muted playsinline data-src="{filename}"></video>',encoding="utf-8")
                checks=[play_offline(browser,html.as_uri(),r) for r in (1,.25)]
                if any(not v["ended"] or v["stalls"] or v["rate"] != requested
                       or abs(v["duration"] - count / 24) > .001
                       or abs(v["wall_ms"] / 1000 - count / (24 * requested)) > 1.25
                       for v, requested in zip(checks, (1, .25), strict=True)):
                    raise ValueError(f"{path} 未完整播放")
                result["playback"][args.labels[i]]=checks
                frame_sheets(path,args.evidence/f"片源{i+1}逐帧",count,ImageFont.truetype(font_file,17))
    (args.evidence/"播放核对.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"两支同机位片源各 {count} 帧，原速与慢速均已播放到结尾。")


if __name__ == "__main__":
    main()
