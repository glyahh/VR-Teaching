"""核对两版片头的每帧时码、每包音频和逐镜放映对照。"""

import argparse
import hashlib
import json
import os
import re
import subprocess
from fractions import Fraction
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFont


SHOTS = (
    ("于都架桥", 18.00, 21.10),
    ("于都夜渡", 21.10, 23.45),
    ("湘江涉水", 38.20, 43.30),
    ("遵义进门", 72.25, 76.65),
    ("遵义桌边", 79.85, 83.15),
)
SOURCES = ("yudu/bridge.mp4", "yudu/night.mp4", "xiang/crossing.mp4", "hall/hall.mp4", "desk/desk.mp4")


def probe(path, *options):
    return json.loads(subprocess.check_output(["ffprobe", "-v", "error", *options, "-of", "json", str(path)]))


def timing(path):
    video = probe(path, "-select_streams", "v:0", "-show_frames", "-show_entries",
                  "stream=width,height,time_base:frame=best_effort_timestamp")
    stream, = video["streams"]
    timestamps = [int(frame["best_effort_timestamp"]) for frame in video["frames"]]
    if (stream["width"], stream["height"]) != (1280, 720) or len(timestamps) != 2280:
        raise ValueError(f"{path} 画幅或总帧数有变")
    if any(t * Fraction(stream["time_base"]) != Fraction(i, 24) for i, t in enumerate(timestamps)):
        raise ValueError(f"{path} 画面时码有变")
    # data_hash 对实际 AAC 负载取指纹，同时检查封包时间及首包的编码延迟。
    audio = probe(path, "-select_streams", "a:0", "-show_packets", "-show_data_hash", "sha256",
                  "-show_entries", "stream=codec_name,sample_rate,channels,time_base,start_pts,duration_ts:"
                  "packet=pts,dts,duration,size,data_hash:packet_side_data")
    if not audio.get("packets"):
        raise ValueError(f"{path} 缺少音轨")
    return audio


def unchanged_shots(before, after, shots=SHOTS):
    windows = [(round(start*24)-6, round(end*24)+6) for _, start, end in shots]
    fixed = [n for n in range(2280) if not any(a <= n < b for a, b in windows)]
    with TemporaryDirectory() as folder:
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(before.resolve()), "-i", str(after.resolve()),
                        "-filter_complex", "[0:v]scale=320:180,format=yuv420p[a];[1:v]scale=320:180,format=yuv420p[b];"
                        "[a][b]ssim=stats_file=frames.log", "-an", "-f", "null", "-"], cwd=folder, check=True)
        rows = (Path(folder) / "frames.log").read_text().splitlines()
    if len(rows) != 2280:
        raise ValueError("逐帧画面对照不完整")
    scores = {n: dict((k, float(v)) for k, v in re.findall(r"(Y|U|V|All):([0-9.]+)", rows[n])) for n in fixed}
    minima = {k: min(fixed, key=lambda n: scores[n][k]) for k in ("Y", "U", "V", "All")}
    for channel, n in minima.items():
        if scores[n][channel] < .98:
            raise ValueError(f"原画面第 {n} 帧 {channel} 的 SSIM 是 {scores[n][channel]:.5f}，需要复核")
    return {"frames": len(fixed), "ssim_at_320x180": {k: {"frame": n, "minimum": scores[n][k]} for k, n in minima.items()}}


def edited_shots(before, after, shots=SHOTS):
    # 核对实际进入正片的是交付片源。取无叠化、无上下沿暗角的区域，容许两次 H.264 编码的量化差。
    import numpy as np
    directory = Path(__file__).resolve().parents[1] / "课堂演示/media-source/opening-film"
    def sample(path, frame):
        raw = subprocess.check_output(["ffmpeg", "-v", "error", "-ss", f"{frame / 24:.8f}", "-i", str(path),
                                      "-frames:v", "1", "-vf", "crop=1280:360:0:164,scale=320:90,format=rgb24",
                                      "-f", "rawvideo", "pipe:1"])
        if len(raw) != 320 * 90 * 3:
            raise ValueError(f"{path} 第 {frame} 帧解码失败")
        return np.frombuffer(raw, dtype=np.uint8).astype(float)
    checks = {}
    sources = dict(zip((label for label, _, _ in SHOTS), SOURCES, strict=True))
    for label, start, end in shots:
        filename = sources[label]
        first, last = round(start * 24), round(end * 24)
        values = []
        for fraction in (.25, .50, .75):
            n = round(first + (last - first) * fraction)
            reference = sample(directory / filename, n - first + 6)
            new = float(np.abs(sample(after, n) - reference).mean())
            old = float(np.abs(sample(before, n) - reference).mean())
            if new > 4 or new >= old:
                raise ValueError(f"{label} 第 {n} 帧与专用片源的 RGB 平均差异常：新版 {new:.3f}，原版 {old:.3f}")
            values.append({"frame": n, "new_mae": round(new, 3), "old_mae": round(old, 3)})
        checks[label] = values
    return checks


def comparison(before, after, output, label, t0, t1, header):
    font = ImageFont.truetype(str(Path(os.environ["WINDIR"]) / "Fonts/msyh.ttc"), 19)
    bar = Image.new("RGB", (1280, 38), (26, 27, 26))
    draw = ImageDraw.Draw(bar)
    for x, version in ((14, "原片"), (654, "新版")):
        draw.text((x, 5), f"{version}  ·  {label}    {t0:.2f}–{t1:.2f} 秒", font=font, fill=(247, 244, 233))
    bar.save(header)
    start, end = round(t0 * 24) - 16, round(t1 * 24) + 16
    filters = (
        f"[0:v]trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS,scale=640:360[a];"
        f"[1:v]trim=start_frame={start}:end_frame={end},setpts=PTS-STARTPTS,scale=640:360[b];"
        "[a][b]hstack, pad=1280:398:0:38[split];[split][2:v]overlay=0:0[v];"
        f"[1:a]atrim=start_sample={start * 2000}:end_sample={end * 2000},asetpts=PTS-STARTPTS[s]"
    )
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(before), "-i", str(after), "-i", str(header),
                    "-filter_complex", filters, "-map", "[v]", "-map", "[s]", "-c:v", "libx264", "-crf", "18",
                    "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart",
                    str(output / (label + ".mp4"))], check=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("before", type=Path)
    parser.add_argument("after", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--shots", nargs="+", choices=[name for name, _, _ in SHOTS],
                        help="仅将选中的镜头当作改动窗口，其余画面逐帧与基准比对")
    args = parser.parse_args()
    shots = tuple(shot for shot in SHOTS if args.shots is None or shot[0] in args.shots)
    baseline = timing(args.before)
    if timing(args.after) != baseline:
        raise ValueError("两版的 AAC 数据包、编码延迟或播放时间戳有差异")
    unchanged = unchanged_shots(args.before, args.after, shots)
    edited = edited_shots(args.before, args.after, shots)
    args.output.mkdir(exist_ok=True, parents=True)
    with TemporaryDirectory() as directory:
        for label, start, end in shots:
            comparison(args.before, args.after, args.output, label, start, end, Path(directory) / "header.png")
        playlist = Path(directory) / "shots.ffconcat"
        # 清单中使用本脚本定义的文件名，供 ffmpeg 从证据目录读取。
        playlist.write_text("ffconcat version 1.0\n" + "".join(
            "file '" + (args.output / (label + ".mp4")).resolve().as_posix().replace("'", "'\\''") + "'\n"
            for label, _, _ in shots), encoding="utf-8")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(playlist),
                        "-map", "0:v", "-map", "0:a", "-c", "copy", "-movflags", "+faststart",
                        str(args.output / ("五镜前后对比.mp4" if shots == SHOTS else "选定镜头前后对比.mp4"))], check=True)
    payload = json.dumps(baseline, sort_keys=True, separators=(",", ":")).encode()
    result = {
        "decoded_frames_checked_per_film": 2280, "fps": 24, "size": [1280, 720],
        "audio_packets_identical": len(baseline["packets"]), "audio_packet_manifest_sha256": hashlib.sha256(payload).hexdigest(),
        "before_bytes": args.before.stat().st_size, "after_bytes": args.after.stat().st_size,
        "comparison_includes_neighbor_frames_per_end": 16,
        "unmodified_shots": unchanged,
        "edited_shots_vs_cut_sources": edited,
    }
    (args.output / "音画核对.json").write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
