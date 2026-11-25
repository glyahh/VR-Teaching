"""从已核验许可的本地片头素材中提取正课轻量循环环境音与收官大提琴尾奏。

许可声明：
- 江水环境声：源自 Pexels 实拍视频 `pexels-water.mp4`（João Pavese，Pexels License）。
- 课尾弦乐尾奏：源自 `'Hiraeth' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au`。
"""

from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCES = ROOT / ".march-build" / "opening-sources"
ASSETS = ROOT / "课堂演示" / "assets"


def find_ffmpeg():
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        raise SystemExit("未找到 ffmpeg，请先确认已安装并在 PATH 中。")
    return ffmpeg


def build_river_loop(ffmpeg: str):
    source = SOURCES / "pexels-shore.mp4"
    if not source.is_file():
        raise FileNotFoundError(f"缺少已核验的水声源素材：{source}")
    output = ASSETS / "ambient-river.mp3"
    # 探测原片时长，将尾部 2.0s 交叉淡化回首部形成无缝循环江水声
    probe = subprocess.run([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(source),
    ], capture_output=True, text=True, check=True)
    duration = float(probe.stdout.strip())
    clip_len = min(11.5, max(5.0, duration - 1.0))
    fade = min(2.0, clip_len * 0.22)
    loop_len = clip_len - fade
    filter_complex = (
        f"[0:a]atrim=start=0.5:duration={clip_len:.2f},asetpts=PTS-STARTPTS,"
        "highpass=f=110,lowpass=f=2900,volume=0.88,asplit=2[a][b];"
        f"[a]atrim=start=0:duration={loop_len:.2f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d={fade:.2f}:curve=qsin,afade=t=out:st={loop_len - fade:.2f}:d={fade:.2f}:curve=qsin[main];"
        f"[b]atrim=start={loop_len:.2f}:duration={fade:.2f},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d={fade * 0.85:.2f}:curve=qsin,afade=t=out:st={fade * 0.15:.2f}:d={fade * 0.85:.2f}:curve=qsin[tail];"
        "[main][tail]amix=inputs=2:duration=first:normalize=0,"
        "loudnorm=I=-22:TP=-2:LRA=7[out]"
    )
    subprocess.run([
        ffmpeg, "-v", "error", "-y", "-i", str(source),
        "-filter_complex", filter_complex, "-map", "[out]",
        "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "32k",
        "-metadata", "comment=Source: Pexels shore water loop (Pexels License)",
        str(output),
    ], check=True)
    print(f"已生成 {output.name} ({output.stat().st_size} bytes, {loop_len:.1f}s loop)")


def build_recap_cello(ffmpeg: str):
    source = SOURCES / "sb-hiraeth.mp3"
    if not source.is_file():
        raise FileNotFoundError(f"缺少已核验的弦乐源素材：{source}")
    output = ASSETS / "recap-cello.mp3"
    # 截取 312s 起 18s 温暖收官尾奏，柔和淡入淡出
    filter_complex = (
        "[0:a]atrim=start=312.0:duration=18.0,asetpts=PTS-STARTPTS,"
        "afade=t=in:st=0:d=2.2:curve=qsin,afade=t=out:st=14.0:d=4.0:curve=qsin,"
        "loudnorm=I=-20:TP=-2:LRA=8[out]"
    )
    subprocess.run([
        ffmpeg, "-v", "error", "-y", "-i", str(source),
        "-filter_complex", filter_complex, "-map", "[out]",
        "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "48k",
        "-metadata", "comment='Hiraeth' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au",
        str(output),
    ], check=True)
    print(f"已生成 {output.name} ({output.stat().st_size} bytes)")


def main():
    ffmpeg = find_ffmpeg()
    build_river_loop(ffmpeg)
    build_recap_cello(ffmpeg)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"音频生成失败: {exc}", file=sys.stderr)
        sys.exit(1)
