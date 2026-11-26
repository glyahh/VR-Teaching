"""将固定机位的纸叶与桌面投影合到底片，逐帧输出 24 fps 的无声剪辑源。"""
import argparse
import math
import subprocess
from pathlib import Path

import numpy as np
from PIL import Image

WIDTH, HEIGHT = 1280, 720
FRAMES = round(83.15 * 24) - round(79.85 * 24) + 12
FIRST_MOVING = math.floor(.08 * (FRAMES - 1)) + 1
LAST_MOVING = math.ceil(.81 * (FRAMES - 1))
PATCH_SIZE = (672, 576)
PATCH_TOP = HEIGHT - int(.94 * HEIGHT)


def combine(plate, patch, feather):
    if patch.size != PATCH_SIZE:
        raise ValueError(f"纸叶分区尺寸应为 {PATCH_SIZE}，读到 {patch.size}")
    frame = plate.copy()
    frame.paste(patch, (0, PATCH_TOP), feather)
    return frame


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("work", type=Path)
    parser.add_argument("target", type=Path)
    args = parser.parse_args()
    folder = args.work
    with Image.open(folder / "locked-000.png") as base:
        plate = base.convert("RGB")
    if plate.size != (WIDTH, HEIGHT):
        raise ValueError("底片须是未裁切的 1280 × 720 渲染")
    x, y = np.meshgrid(np.arange(PATCH_SIZE[0]), np.arange(PATCH_SIZE[1]))
    border = np.minimum(np.minimum(y, PATCH_SIZE[1]-1-y), PATCH_SIZE[0]-1-x)
    feather = Image.fromarray(np.clip(border * (255/20), 0, 255).astype("uint8"))
    pending = args.target.with_suffix(".part.mp4")
    args.target.parent.mkdir(parents=True, exist_ok=True)
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
               "-s", f"{WIDTH}x{HEIGHT}", "-r", "24", "-i", "-", "-an", "-vf",
               "scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1",
               "-c:v", "libx264", "-crf", "15", "-preset", "medium", "-threads", "4", "-colorspace", "bt709",
               "-color_primaries", "bt709", "-color_trc", "bt709", "-movflags", "+faststart", str(pending)]
    try:
        with subprocess.Popen(command, stdin=subprocess.PIPE) as enc:
            frame = plate
            for i in range(FRAMES):
                if FIRST_MOVING <= i <= LAST_MOVING:
                    with Image.open(folder / f"locked-{i:03d}.png") as patch:
                        frame = combine(plate, patch.convert("RGB"), feather)
                    if i == 40:
                        frame.save(folder / "机位对照-新版.png")
                t = i / (FRAMES - 1)
                zoom = 1 + .034 * t*t*(3-2*t)
                w, h = WIDTH/zoom, HEIGHT/zoom
                left, top = (WIDTH-w)*.37, (HEIGHT-h)*.61
                out = frame.transform((WIDTH, HEIGHT), Image.Transform.EXTENT,
                                      (left, top, left+w, top+h), Image.Resampling.BICUBIC)
                enc.stdin.write(out.tobytes())
            enc.stdin.close()
            if enc.wait():
                raise RuntimeError("桌面镜头编码失败")
        pending.replace(args.target)
    finally:
        pending.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
