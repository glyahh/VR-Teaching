"""把课内手记已有的标题和四组条目排在看得见的两页上。"""
import argparse
import json
import os
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("repo", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    notes = json.loads((args.repo / "课堂演示/自由探索实验/notebook.json").read_text(encoding="utf-8"))
    args.output.mkdir(parents=True, exist_ok=True)
    font = str(Path(os.environ["WINDIR"]) / "Fonts/simkai.ttf")
    for name, note in (("facing", notes[0]), ("before", notes[1]), ("reverse", notes[2]),
                       ("after", notes[3]), ("map", {"title": "行军图", "rows": []})):
        mask = Image.new("L", (960, 1240), 255)
        pen = ImageDraw.Draw(mask)
        def column(x, y, value, size):
            face = ImageFont.truetype(font, size)
            for index, char in enumerate(value):
                pen.text((x, y + index * (size + 9)), char, font=face, fill=40, anchor="mt")
        column(804, 105, note["title"], 86)
        for index, (label, value) in enumerate(note["rows"]):
            x = 591 - index * 237
            column(x, 218, label, 58)
            column(x - 81, 315, value, 55)
        if name in {"facing", "reverse"}:
            mask = mask.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        mask.save(args.output / (name + ".png"))


if __name__ == "__main__":
    main()
