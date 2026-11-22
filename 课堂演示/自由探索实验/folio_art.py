"""按课堂摘要排字，纸张底纹采用 ambientCG Paper001。"""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


def paper_art(source, out):
    font = Path("C:/Windows/Fonts/simkai.ttf")
    if not font.is_file():
        font = Path("C:/Windows/Fonts/simsun.ttc")

    def typeface(size):
        return ImageFont.truetype(str(font), size)

    scan = Image.open(source).convert("L")

    def tone(size, color, worn=False):
        base = ImageOps.fit(scan, size, Image.Resampling.LANCZOS)
        h, w = size[1], size[0]
        yy, xx = np.mgrid[:h, :w].astype(np.float32)
        fibre = (np.asarray(base, dtype=np.float32) - 198) * (0.41 if worn else 0.26)
        edge = np.minimum(np.minimum(xx, w - xx), np.minimum(yy, h - yy))
        edge += 2.9 * np.sin(xx * 0.024 + yy * 0.031)
        amber = np.exp(-np.maximum(0, edge) / (5.0 + min(h, w) * 0.018))
        shade = (fibre - (19 if worn else 14) * amber + 4 * np.sin(xx / w * 2.1))[:, :, None]
        return Image.fromarray(np.clip(np.array(color) + shade, 0, 255).astype(np.uint8))

    cover = tone((1248, 1600), (64, 86, 89), worn=True)
    pixels = np.array(cover).astype(np.float32)
    gy, gx = np.mgrid[:1600, :1248].astype(np.float32)
    faded = 13 * np.exp(-((gx - 1010) / 150) ** 2 - ((gy - 1448) / 58) ** 2)
    pixels += faded[:, :, None] * np.array([1.2, 0.94, 0.58])
    Image.fromarray(np.uint8(np.clip(pixels, 0, 255))).save(out / "folio-cover.jpg", quality=91, optimize=True)

    label = tone((440, 1060), (213, 193, 151), worn=True)
    draw = ImageDraw.Draw(label)
    draw.rounded_rectangle((31, 26, 409, 1031), radius=4, outline=(109, 87, 60), width=4)
    draw.line((48, 46, 392, 46), fill=(148, 122, 79), width=2)
    for i, character in enumerate("会前手记"):
        draw.text((220, 174 + i * 224), character, font=typeface(153),
                  fill=(35, 31, 25), anchor="mm", stroke_width=1)
    label.save(out / "folio-label.jpg", quality=93, optimize=True)

    pages = json.loads(Path(__file__).with_name("notebook.json").read_text(encoding="utf-8"))
    for index, item in enumerate(pages, 1):
        page = tone((1400, 1788), (223, 207, 171))
        draw = ImageDraw.Draw(page)
        draw.rectangle((101, 78, 1294, 1694), outline=(143, 105, 63), width=3)
        draw.rectangle((113, 90, 1282, 1682), outline=(176, 143, 92), width=1)
        ink = (34, 27, 19)
        draw.text((202, 198), item["title"], font=typeface(166), anchor="lt", fill=ink, stroke_width=2)
        draw.line((203, 421, 1176, 421), fill=(141, 99, 52), width=4)
        for (caption, value), y in zip(item["rows"], (503, 883)):
            draw.text((209, y), caption, font=typeface(92), anchor="lt", fill=(59, 42, 26), stroke_width=1)
            draw.text((199, y + 127), value, font=typeface(160), anchor="lt", fill=ink, stroke_width=2)
        draw.line((205, 1298, 1172, 1298), fill=(165, 132, 89), width=2)
        draw.text((208, 1368), item["note"], font=typeface(75), anchor="lt", fill=ink, stroke_width=1)
        if index == 1:
            draw.text((208, 1538), "教学摘要", font=typeface(62), anchor="lt", fill=(103, 73, 44))
        draw.text((1175, 1538), str(index), font=typeface(63), anchor="rt", fill=(103, 73, 44))
        name = "folio-reading.jpg" if index == 1 else f"folio-page-{index}.jpg"
        page.save(out / name, quality=92, optimize=True)
    tone((768, 956), (216, 198, 160)).save(out / "folio-lining.jpg", quality=87, optimize=True)
