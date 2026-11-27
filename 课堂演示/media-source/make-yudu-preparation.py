"""把已审的抬送段和浮桥示意剪成 6.5 秒，首尾分别对齐课件里的岸边与桥面。"""

import argparse
import math
from pathlib import Path
import re
import subprocess
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "课堂演示" / "assets"
LESSON_PAGE = ROOT / "课堂演示" / "src" / "lesson-page.ts"
WIDTH, HEIGHT = 1280, 720
SIZE = WIDTH, HEIGHT
FPS = 24
CARRY = 66
TOTAL = 156
GOLD = (249, 214, 148)
FONT = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 28)


def reference(name):
    with Image.open(ASSETS / name) as picture:
        return picture.convert("RGB").resize(SIZE, Image.Resampling.LANCZOS)


def ramp(value, start, end):
    return min(1, max(0, (value - start) / (end - start)))


def course_outline(key):
    content = LESSON_PAGE.read_text(encoding="utf-8")
    match = re.search(rf"'{key}',\[[^\]]+\],'(M [^']+)'", content)
    if not match:
        raise ValueError(f"Could not find {key} in the course bridge activity")
    tokens = iter(match[1].split())

    def point():
        return float(next(tokens)) * WIDTH / 100, float(next(tokens)) * HEIGHT / 100

    vertices = []
    for command in tokens:
        if command in ("M", "L"):
            vertices.append(point())
        elif command == "Q":
            start, control, end = vertices[-1], point(), point()
            for step in range(1, 19):
                t = step / 18
                vertices.append(tuple((1 - t)**2 * a + 2 * (1 - t) * t * b + t**2 * c
                                      for a, b, c in zip(start, control, end)))
        elif command == "Z":
            vertices.append(vertices[0])
        else:
            raise ValueError(command)
    return vertices


def trace(drawing, vertices, progress, alpha, width=4):
    if progress <= 0 or alpha <= 0:
        return
    lengths = [math.dist(a, b) for a, b in zip(vertices, vertices[1:])]
    remaining = sum(lengths) * progress
    points = [vertices[0]]
    for a, b, length in zip(vertices, vertices[1:], lengths):
        if length == 0:
            continue
        if remaining <= length:
            points.append(tuple(x + (y - x) * remaining / length for x, y in zip(a, b)))
            break
        points.append(b)
        remaining -= length
    drawing.line(points, (22, 21, 17, round(180 * alpha)), width=width + 5, joint="curve")
    drawing.line(points, (*GOLD, round(244 * alpha)), width=width, joint="curve")


def label(drawing, value, x, y, alpha):
    if alpha <= 0:
        return
    w = round(FONT.getlength(value)) + 31
    drawing.rounded_rectangle(
        (x, y, x + w, y + 47), radius=5, fill=(20, 25, 27, round(234 * alpha)),
        outline=(*GOLD, round(205 * alpha)), width=1,
    )
    drawing.text((x + w / 2, y + 23), value, font=FONT, fill=(*GOLD, round(255 * alpha)), anchor="mm")


def structure_frame(base, t, plank, boat):
    visibility = 1 - ramp(t, 3.28, 3.72)
    layer = Image.new("RGBA", SIZE)
    drawing = ImageDraw.Draw(layer)
    trace(drawing, plank, ramp(t, 0, .96), visibility)
    label(drawing, "桥板", 1000, 242, ramp(t, .31, .60) * visibility)
    connector = [(668, 321), (647, 357), (619, 400)]
    arrow = ramp(t, .96, 1.55)
    trace(drawing, connector, arrow, visibility, 3)
    if arrow == 1:
        trace(drawing, [(617, 387), connector[-1], (631, 393)], 1, visibility, 3)
    trace(drawing, boat, ramp(t, 1.53, 2.97), visibility)
    label(drawing, "船体", 248, 468, ramp(t, 2.52, 2.83) * visibility)
    return Image.alpha_composite(base, layer).convert("RGB")


def build(source, output):
    start = reference("yudu-bank.jpg")
    end = reference("yudu-bridge.jpg")
    bridge = end.convert("RGBA")
    plank, boat = course_outline("plank"), course_outline("boat")
    decoder = [
        "ffmpeg", "-v", "error", "-nostdin", "-threads", "2", "-i", str(source),
        "-an", "-vf", f"fps={FPS},scale={WIDTH}:{HEIGHT}:flags=lanczos",
        "-frames:v", str(CARRY), "-threads:v", "1", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1",
    ]
    output.parent.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(dir=output.parent) as work:
        staging = Path(work) / output.name
        encoder = [
            "ffmpeg", "-v", "error", "-nostdin", "-y", "-f", "rawvideo",
            "-pixel_format", "rgb24", "-video_size", f"{WIDTH}x{HEIGHT}", "-framerate", str(FPS),
            "-i", "pipe:0", "-an", "-vf", "scale=out_color_matrix=bt709:out_range=tv",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "17", "-threads:v", "2",
            "-pix_fmt", "yuv420p", "-colorspace", "bt709", "-color_primaries", "bt709",
            "-color_trc", "iec61966-2-1", "-color_range", "tv", "-movflags", "+faststart", str(staging),
        ]
        with subprocess.Popen(decoder, stdout=subprocess.PIPE) as reader, \
                subprocess.Popen(encoder, stdin=subprocess.PIPE) as writer:
            for index in range(CARRY):
                data = reader.stdout.read(WIDTH * HEIGHT * 3)
                if len(data) != WIDTH * HEIGHT * 3:
                    raise RuntimeError(f"Input stopped at frame {index}")
                picture = Image.frombytes("RGB", SIZE, data)
                if index < 5:
                    picture = Image.blend(start, picture, index / 5)
                writer.stdin.write(picture.tobytes())
            for index in range(CARRY, TOTAL):
                picture = end if index == TOTAL - 1 else structure_frame(
                    bridge, (index - CARRY) / FPS, plank, boat
                )
                writer.stdin.write(picture.tobytes())
            writer.stdin.close()
            if reader.wait() or writer.wait():
                raise RuntimeError("FFmpeg could not finish the preview")
        staging.replace(output)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    build(args.source, args.output)
