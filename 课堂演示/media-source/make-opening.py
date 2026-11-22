"""用已入库的课堂镜头和旁白剪出开场导览。"""

import json
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory


ASSETS = Path(__file__).resolve().parents[1] / "assets"
FPS = 24
SAMPLE_RATE = 48000
GUIDE = "desk-guide.mp4"


def make_opening(target: Path):
    inputs = ["ffmpeg", "-v", "error", "-nostdin", "-y", "-filter_complex_threads", "2"]
    filters = []
    tracks = []
    sources = 0

    def media(name, frame):
        nonlocal sources
        inputs.extend(("-ss", str(frame / FPS), "-i", str(ASSETS / name)))
        sources += 1
        return sources - 1

    def segment(name, start, frames, narration=None, text="", still=False):
        nonlocal sources
        duration = frames / FPS
        track = len(tracks)
        if still:
            inputs.extend(("-loop", "1", "-framerate", str(FPS), "-i", str(ASSETS / name)))
            sources += 1
            picture = sources - 1
        else:
            picture = media(name, start)
        if narration is None:
            inputs.extend(("-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono"))
            sources += 1
            voice = sources - 1
        else:
            voice = picture if name == GUIDE and start == narration else media(GUIDE, narration)
        caption = ""
        if text:
            caption = (
                r",drawtext=fontfile='C\:/Windows/Fonts/msyh.ttc'"
                f":text='{text}':fontcolor=0xfff1d6:fontsize=35"
                ":box=1:boxcolor=0x141510@0.78:boxborderw=11:x=(w-tw)/2:y=h-86"
                ":enable='gte(t,0.20)'"
            )
        filters.append(
            f"[{picture}:v]fps={FPS},scale=1280:720:flags=lanczos,setsar=1,format=yuv420p,"
            f"trim=end_frame={frames},setpts=PTS-STARTPTS{caption}[v{track}]"
        )
        filters.append(
            f"[{voice}:a]aresample={SAMPLE_RATE},aformat=channel_layouts=mono,"
            f"atrim=end_sample={frames * SAMPLE_RATE // FPS},asetpts=PTS-STARTPTS,"
            f"afade=t=in:d=0.04,afade=t=out:st={duration-0.05:.6f}:d=0.05[a{track}]"
        )
        tracks.append(f"[v{track}][a{track}]")

    segment("yudu-preparation.mp4", 0, 64, text="1934年10月 · 于都")
    segment("xiang.mp4", 3, 92, narration=144, text="湘江战役中，中央红军损失重大。")
    segment(GUIDE, 584, 119, narration=584)
    segment(GUIDE, 1045, 111, narration=1045)
    segment(GUIDE, 1201, 147, narration=1201)
    segment("yudu-assembly.jpg", 0, 14, still=True)
    filters.append("".join(tracks) + f"concat=n={len(tracks)}:v=1:a=1[picture][voice]")
    subprocess.run(inputs + [
        "-filter_complex", ";".join(filters), "-map", "[picture]", "-map", "[voice]",
        "-c:v", "libx264", "-crf", "18", "-preset", "fast", "-g", "24", "-threads", "2",
        "-c:a", "aac", "-b:a", "96k", "-movflags", "+faststart", str(target),
    ], check=True)


if __name__ == "__main__":
    with TemporaryDirectory(dir=ASSETS) as folder:
        candidate = Path(folder) / "opening.mp4"
        make_opening(candidate)
        footage = json.loads(subprocess.check_output([
            "ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,nb_frames",
            "-of", "json", str(candidate)
        ]))
        video, audio = footage["streams"]
        seconds = float(footage["format"]["duration"])
        if int(video["nb_frames"]) != 547 or audio["codec_type"] != "audio" or abs(seconds - 547/FPS) > .05:
            raise RuntimeError("开场片时长或音轨与剪辑表不符")
        candidate.replace(ASSETS / "opening.mp4")
        print(f"开场短片 {seconds:.2f} 秒，547 帧，含旁白。")
