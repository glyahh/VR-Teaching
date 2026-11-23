"""将已核验的外部片源与课内讲述剪成离线片头。分镜与署名见 opening-sources.md。"""

import argparse
from dataclasses import dataclass
from hashlib import file_digest
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen


HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets"
SOURCE_CACHE = HERE.parents[1] / ".march-build" / "opening-sources"
GUIDE = ASSETS / "desk-guide.mp4"
FPS = 24
RATE = 48000
WIDTH, HEIGHT = 1280, 720
BLEND = 6
FFMPEG = ["ffmpeg", "-v", "error", "-nostdin", "-y"]
CC_BY = "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/"
PEXELS = "Pexels License https://www.pexels.com/license/"
SHORE = "pexels-shore.mp4"


@dataclass(frozen=True)
class Source:
    file: str
    url: str
    sha256: str
    credit: str


SOURCES = (
    Source(
        "cns-yudu.mp4",
        "https://poss-videocloud.cns.com.cn/oss/2026/04/04/chinanews/MEIZI_YUNSHI/onair/8EF91E19C3C74C28A4F89A5229E80F94.mp4",
        "79c88d8ee0c17d40b70e4c6959affdb5eefa3535c11e618dcf2cd8a657c5d555",
        f"于都烈士纪念园实拍｜中国新闻社 https://www.youtube.com/watch?v=L3Sc2_nUj30 ｜{CC_BY}｜截取、统一帧率、调色、替换原音",
    ),
    Source(
        "pexels-water.mp4",
        "https://videos.pexels.com/video-files/31810558/13552637_2160_3840_30fps.mp4",
        "e29b8d0238c0e000e6a064a41c21719d60b6f3214c6b2298cc3d954a8068900f",
        f"浅水近景｜Physical Pixel https://www.pexels.com/video/clear-water-rippling-over-rocky-riverbed-31810558/ ｜{PEXELS}｜截取、裁切、调色",
    ),
    Source(
        SHORE,
        "https://videos.pexels.com/video-files/4058993/4058993-hd_1920_1080_24fps.mp4",
        "0926d8fc12f689c913e7da092b36904a42f58801d72625f4ff6fbaf0117c4bf4",
        f"急流与环境声｜João Pavese https://www.pexels.com/video/a-close-up-shot-of-the-cascading-water-in-the-river-4058993/ ｜{PEXELS}｜截取、调色、混音",
    ),
    Source(
        "cns-zunyi.mp4",
        "https://poss-videocloud.cns.com.cn/oss/2026/10/21/chinanews/MEIZI_YUNSHI/onair/9E27CE9A67F849328BCB798297972424.mp4",
        "6ca58db2f72f8aac68f300a5bf1a5d860280c4ae1838087b5b1e3fe6d2ea429c",
        f"遵义实景剧场情景演绎｜中国新闻社 https://www.youtube.com/watch?v=_N1ep0cNYr0 ｜{CC_BY}｜截取、统一帧率、调色、替换原音",
    ),
)


@dataclass(frozen=True)
class Shot:
    file: str
    start: int
    frames: int
    label: str = ""
    grade: str = ""


SHOTS = (
    Shot("yudu-bank.jpg", 0, 18),
    Shot("cns-yudu.mp4", 17, 46, "于都 · 2026 年实拍", "eq=brightness=-.05:saturation=.79"),
    Shot("xiang.mp4", 3, 62),
    Shot("pexels-water.mp4", 40, 30, grade="eq=brightness=-.07:saturation=.68"),
    Shot("route.mp4", 0, 119),
    Shot(SHORE, 22, 111, grade="eq=brightness=-.055:saturation=.7"),
    Shot("cns-zunyi.mp4", 656, 147, "遵义 · 情景演绎", "eq=brightness=-.015:saturation=.88"),
    Shot("yudu-assembly.jpg", 0, 14),
)
FRAMES = sum(shot.frames for shot in SHOTS)
VOICE = (
    (SHORE, 72, 64),
    (GUIDE.name, 144, 92),
    (GUIDE.name, 584, 119),
    (GUIDE.name, 1045, 111),
    (GUIDE.name, 1201, 147),
    (SHORE, 136, 14),
)


def digest(path):
    with path.open("rb") as file:
        return file_digest(file, "sha256").hexdigest()


def prepare_sources(cache, download):
    paths = {}
    for source in SOURCES:
        path = cache / source.file
        if not path.exists():
            if not download:
                raise FileNotFoundError(f"缺少片头素材 {path}。首次准备时加 --download。")
            cache.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix(".part")
            try:
                request = Request(source.url, headers={"User-Agent": "Mozilla/5.0 VRTeachingMedia/1.0"})
                with urlopen(request, timeout=60) as response, partial.open("wb") as dest:
                    shutil.copyfileobj(response, dest)
                if digest(partial) != source.sha256:
                    raise ValueError(f"下载内容与核准版本不同，已停止使用 {source.file}")
                partial.replace(path)
            finally:
                partial.unlink(missing_ok=True)
        if digest(path) != source.sha256:
            raise ValueError(f"片源校验不符，请核对 {path}")
        paths[source.file] = path
    return paths


def make_route(target):
    guide = runpy.run_path(str(HERE / "desk-live" / "make_guide.py"))
    draw = guide["route_art"]()
    frames = next(shot.frames for shot in SHOTS if shot.file == target.name)
    guide_fps = guide["FPS"]
    start = guide["ROUTE_START_SECONDS"]
    first = round(start * guide_fps)
    last = round((start + guide["ROUTE_DURATION_SECONDS"]) * guide_fps)
    command = FFMPEG + [
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-",
        "-c:v", "libx264", "-crf", "17", "-preset", "fast", "-pix_fmt", "yuv420p",
        "-threads", "2", str(target),
    ]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as process:
        for index in range(frames):
            guide_frame = round(first + (last - first) * index / (frames - 1))
            process.stdin.write(draw(guide_frame).tobytes())
        process.stdin.close()
        if process.wait():
            raise subprocess.CalledProcessError(process.returncode, command)


def make_opening(target, sources):
    route = target.with_name("route.mp4")
    make_route(route)
    files = {**sources, route.name: route}
    inputs, filters = [], []
    source_count = 0

    def feed(file, start=0, still=False):
        nonlocal source_count
        if still:
            inputs.extend(["-loop", "1", "-framerate", str(FPS)])
        elif start:
            inputs.extend(["-ss", f"{start / FPS:.9f}"])
        inputs.extend(["-threads", "2", "-i", str(files.get(file, ASSETS / file))])
        index = source_count
        source_count += 1
        return index

    font_path = (Path(os.environ["WINDIR"]) / "Fonts" / "msyh.ttc").as_posix().replace(":", r"\:")
    for index, shot in enumerate(SHOTS):
        picture = feed(shot.file, shot.start, shot.file.endswith(".jpg"))
        steps = [
            f"fps={FPS}", f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos"
            ":out_color_matrix=bt709:out_range=tv",
            f"crop={WIDTH}:{HEIGHT}", "setsar=1", "format=yuv444p", f"trim=end_frame={shot.frames}",
            f"settb=1/{FPS}", "setpts=N",
        ]
        if shot.grade:
            steps.append(shot.grade)
        if shot.label:
            steps.append(
                f"drawtext=fontfile='{font_path}':text='{shot.label}':"
                "fontcolor=0xfff2d7:fontsize=23:x=42:y=h-51:"
                "box=1:boxcolor=0x171712@0.65:boxborderw=8:enable='gte(n,6)'"
            )
        filters.append(f"[{picture}:v]{','.join(steps)}[v{index}]")

    def dissolve(left, right, left_frames, result):
        filters.extend([
            f"[v{left}]tpad=stop_mode=clone:stop={BLEND}[hold{left}]",
            f"[hold{left}][v{right}]xfade=transition=fade:duration={BLEND / FPS}:"
            f"offset={left_frames / FPS}[{result}]",
        ])

    dissolve(0, 1, SHOTS[0].frames, "opening")
    dissolve(6, 7, SHOTS[6].frames, "landing")
    filters.append(
        "[opening][v2][v3][v4][v5][landing]concat=n=6:v=1:a=0,"
        f"trim=end_frame={FRAMES},format=yuv420p[picture]"
    )

    def sound(file, start, frames, channel):
        source = feed(file, start)
        duration = frames / FPS
        gain = ",highpass=f=80,lowpass=f=4200,volume=0.27" if file == SHORE else ""
        filters.append(
            f"[{source}:a]aresample={RATE},aformat=channel_layouts=mono,"
            f"atrim=end_sample={frames * RATE // FPS},asetpts=PTS-STARTPTS{gain},"
            f"afade=t=in:d=0.06,afade=t=out:st={duration - .09:.6f}:d=0.09[{channel}]"
        )

    for index, (file, start, frames) in enumerate(VOICE):
        if index == 3:
            sound(file, start, frames, "riverVoice")
            sound(SHORE, 22, frames, "riverBed")
            filters.append("[riverVoice][riverBed]amix=inputs=2:normalize=0:duration=first[a3]")
        else:
            sound(file, start, frames, f"a{index}")
    filters.append("".join(f"[a{i}]" for i in range(len(VOICE))) + "concat=n=6:v=0:a=1[voice]")

    credits = "\n".join(source.credit for source in SOURCES)
    subprocess.run(FFMPEG + ["-filter_complex_threads", "2"] + inputs + [
        "-filter_complex", ";".join(filters), "-map", "[picture]", "-map", "[voice]",
        "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-g", "24", "-threads", "2",
        "-maxrate", "4200k", "-bufsize", "4200k", "-colorspace", "bt709", "-color_range", "tv",
        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart",
        "-metadata", "title=从于都到遵义 · 开场", "-metadata", f"comment={credits}", str(target),
    ], check=True)


def verify_output(target):
    info = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration:stream=codec_type,nb_frames,width,height", "-of", "json", str(target),
    ]))
    video, voice = info["streams"]
    seconds = float(info["format"]["duration"])
    if (int(video["nb_frames"]) != FRAMES or (video["width"], video["height"]) != (WIDTH, HEIGHT)
            or voice["codec_type"] != "audio" or abs(seconds - FRAMES / FPS) > .05):
        raise RuntimeError("开场片的画幅、时长或音轨与剪辑表不符")
    return seconds


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=SOURCE_CACHE)
    parser.add_argument("--download", action="store_true", help="下载并校验已获得复用许可的片源")
    parser.add_argument("--output", type=Path, default=ASSETS / "opening.mp4")
    args = parser.parse_args()
    sources = prepare_sources(args.source_dir, args.download)
    with TemporaryDirectory(dir=args.output.resolve().parent) as folder:
        candidate = Path(folder) / "opening.mp4"
        make_opening(candidate, sources)
        seconds = verify_output(candidate)
        candidate.replace(args.output)
    external = sum(shot.frames for shot in SHOTS if shot.file in sources)
    print(f"开场短片 {seconds:.2f} 秒，{FRAMES} 帧。外部片源 {external / FPS:.2f} 秒，含旁白和水声。")


if __name__ == "__main__":
    main()
