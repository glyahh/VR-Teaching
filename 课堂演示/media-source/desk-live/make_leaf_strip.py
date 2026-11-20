"""从交付的翻页视频一次提取开合姿态，供手指拖动直接寻帧。"""

import hashlib
import json
import math
from pathlib import Path
import subprocess

import numpy as np
from PIL import Image, ImageFilter


ASSETS = Path(__file__).resolve().parents[2] / "assets"


def build():
    movie = ASSETS / "desk-action.mp4"
    probe = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_streams", "-of", "json", str(movie)
    ]))["streams"][0]
    width, height = probe["width"], probe["height"]
    if probe["avg_frame_rate"] != "24/1" or int(probe["nb_frames"]) != 144:
        raise ValueError("翻页片时序改变，请重新选定开页区间")
    frame_count = 31
    indices = {0, *(11 + round(45 * step / (frame_count-1)) for step in range(1, frame_count))}
    commands = ["ffmpeg", "-v", "error", "-i", str(movie), "-frames:v", str(max(indices)+1),
                "-an", "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"]
    with subprocess.Popen(commands, stdout=subprocess.PIPE) as decoder:
        frames = []
        for index in range(max(indices)+1):
            raw = decoder.stdout.read(width * height * 3)
            if len(raw) != width * height * 3:
                raise ValueError("翻页帧缺失")
            if index in indices:
                frames.append(Image.frombytes("RGB", (width, height), raw))
        if decoder.wait():
            raise RuntimeError("无法解码翻页短片")

    def difference(current, initial, threshold):
        diff = np.abs(np.asarray(current, dtype=np.int16)-np.asarray(initial, dtype=np.int16))
        return Image.fromarray((diff.max(axis=2) >= threshold).astype(np.uint8) * 255)

    small = (width//4, height//4)
    reference = frames[0].resize(small, Image.Resampling.BOX)
    boxes = []
    for current in frames[1:]:
        mask = difference(current.resize(small, Image.Resampling.BOX), reference, 14)
        bounds = mask.filter(ImageFilter.MinFilter(3)).getbbox()
        if bounds:
            boxes.append(bounds)
    if not boxes:
        raise ValueError("未找到纸页动作")
    left = max(0, min(box[0] for box in boxes)*4-16)
    top = max(0, min(box[1] for box in boxes)*4-16)
    right = min(width, max(box[2] for box in boxes)*4+16)
    bottom = min(height, max(box[3] for box in boxes)*4+16)
    crop = (left, top, right, bottom)
    initial = frames[0].crop(crop)
    cell = (round(initial.width*.82), round(initial.height*.82))
    columns = 6
    atlas = Image.new("RGBA", (columns*cell[0], math.ceil(frame_count/columns)*cell[1]))
    for index, image in enumerate(frames[1:], start=1):
        region = image.crop(crop)
        mask = difference(region, initial, 6).filter(ImageFilter.MaxFilter(5)).filter(ImageFilter.GaussianBlur(.65))
        region.putalpha(mask)
        atlas.paste(region.resize(cell, Image.Resampling.LANCZOS), ((index%columns)*cell[0], (index//columns)*cell[1]))
    sheet = ASSETS/"desk-leaf.webp"
    atlas.save(sheet, format="WEBP", quality=84, method=3)
    layout = {"size":[width,height], "crop":crop, "cell":cell, "columns":columns, "count":frame_count,
              "sourceSha256":hashlib.sha256(movie.read_bytes()).hexdigest()}
    (ASSETS/"desk-leaf.json").write_text(json.dumps(layout,separators=(",",":")),encoding="utf-8")
    print(f"{frame_count} 个姿态，{sheet.stat().st_size:,} 字节")


if __name__ == "__main__":
    build()
