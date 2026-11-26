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

    notebook = Path(__file__).resolve().parents[2] / "自由探索实验" / "notebook.json"
    pages = json.loads(notebook.read_text(encoding="utf-8"))
    for index, item in enumerate(pages, 1):
        page = tone((1400, 1788), (222, 205, 168))
        arr = np.asarray(page, dtype=np.float32).copy()
        h, w = arr.shape[:2]
        yy, xx = np.mgrid[:h, :w].astype(np.float32)
        # 书脊折痕压暗、翻阅右下角泛褐与轻量水渍晕染
        spine_shadow = 16.0 * np.exp(-((xx - 26.0) / 88.0) ** 2)
        corner_wear = 12.0 * np.exp(-((xx - 1295.0) / 195.0) ** 2 - ((yy - 1665.0) / 230.0) ** 2)
        cx = 175.0 + (index * 263) % 980
        cy = 180.0 + (index * 389) % 1360
        stain = 7.5 * np.exp(-((xx - cx) / 220.0) ** 2 - ((yy - cy) / 185.0) ** 2)
        crease = 4.2 * np.exp(-((yy - (865.0 + 38.0 * (index - 2))) / 26.0) ** 2) * (0.65 + 0.35 * np.sin(xx * 0.011))
        arr -= (spine_shadow + crease)[:, :, None]
        arr -= (corner_wear + stain)[:, :, None] * np.array([0.55, 0.95, 1.35], dtype=np.float32)
        page = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8))

        draw = ImageDraw.Draw(page)
        draw.rectangle((101, 78, 1294, 1694), outline=(146, 102, 62), width=3)
        draw.rectangle((113, 90, 1282, 1682), outline=(179, 143, 94), width=1)
        # 淡褐竖格乌丝栏（保持轻雅，不干扰正文可读性）
        for col_x in range(230, 1240, 132):
            draw.line((col_x, 96, col_x, 1676), fill=(197, 177, 142), width=1)
        ink = (36, 29, 20)
        draw.text((202, 198), item["title"], font=typeface(166), anchor="lt", fill=ink, stroke_width=2)
        draw.line((203, 421, 1176, 421), fill=(144, 101, 56), width=3)
        draw.line((203, 430, 1176, 430), fill=(178, 142, 95), width=1)
        for (caption, value), y in zip(item["rows"], (503, 883)):
            draw.text((209, y), caption, font=typeface(92), anchor="lt", fill=(64, 46, 29), stroke_width=1)
            draw.text((199, y + 127), value, font=typeface(160), anchor="lt", fill=ink, stroke_width=2)
        draw.line((205, 1298, 1172, 1298), fill=(165, 130, 86), width=2)
        draw.text((208, 1368), item["note"], font=typeface(75), anchor="lt", fill=(45, 35, 24), stroke_width=1)
        if index == 1:
            stamp = (158, 86, 70)
            draw.rectangle((208, 1528, 344, 1612), outline=stamp, width=2)
            draw.text((276, 1570), "摘要", font=typeface(46), anchor="mm", fill=stamp)
        draw.text((1175, 1538), str(index), font=typeface(63), anchor="rt", fill=(112, 82, 51))

        # 给深色墨迹叠加轻量纸纤维透白与墨韵深浅，减少电脑矢量感
        rendered = np.asarray(page, dtype=np.float32)
        luma = rendered.mean(axis=2)
        ink_mask = np.clip((115.0 - luma) / 85.0, 0.0, 1.0)
        mottle = (np.sin(xx * 0.043 + index) * np.cos(yy * 0.037 - index) * 0.5 + 0.5) * 18.0
        fibre_bleed = np.maximum(0.0, (np.asarray(ImageOps.fit(scan, (w, h), Image.Resampling.LANCZOS), dtype=np.float32) - 185.0) * 0.34)
        rendered += (ink_mask * (mottle + fibre_bleed))[:, :, None]
        page = Image.fromarray(np.clip(rendered, 0, 255).astype(np.uint8))

        name = "folio-reading.jpg" if index == 1 else f"folio-page-{index}.jpg"
        page.save(out / name, quality=92, optimize=True)
    tone((768, 956), (216, 198, 160)).save(out / "folio-lining.jpg", quality=87, optimize=True)
