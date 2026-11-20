import json
import math
import os
import subprocess
from io import BytesIO
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps


ROOT = Path(__file__).resolve().parents[2]
WORK = ROOT / ".march-build" / "route-lab"
RANDOM = np.random.default_rng(193501)


def face(size, book=False):
    fonts = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    return ImageFont.truetype(str(fonts / ("simsun.ttc" if book else "msyh.ttc")), size)


def colored_field(field, tint):
    pixels = np.clip(np.array(tint)[None, None, :] + field[:, :, None], 0, 255)
    return Image.fromarray(pixels.astype("uint8"))


def textures():
    height, width = 384, 768
    rows, cols = np.indices((height, width))
    grain = rows + 4 * np.sin(cols / 107 + rows / 69) + 2 * np.sin(cols / 42 + rows / 39)
    grain += 5 * np.sin(cols / 171 + rows / 18)
    grooves = np.power((1 + np.sin(grain * 1.7)) / 2, 9)
    grain_light = 12 * np.sin(grain / 6.4) + 7 * np.sin(grain / 2.5) - 18 * grooves
    grain_light += RANDOM.normal(0, 3, (height, width))
    wood = colored_field(grain_light, [128, 79, 46])
    wood.save(WORK / "wood.jpg", quality=91)
    plaster_base = Image.fromarray(RANDOM.integers(0, 255, (20, 40), dtype="uint8"))
    plaster = np.asarray(plaster_base.resize((width, height), Image.Resampling.BICUBIC)).astype(float)
    colored_field((plaster - 128) * .19 + RANDOM.normal(0, 3, plaster.shape), [157, 139, 109]).save(WORK / "wall.jpg", quality=86)
    height, width = 464, 640
    rows, cols = np.indices((height, width))
    edge = np.minimum(np.minimum(rows, height-1-rows), np.minimum(cols, width-1-cols))
    variations = -23 * np.exp(-edge / 19) + RANDOM.normal(0, 2.6, edge.shape) + 3 * np.sin(rows / 33 + cols / 57)
    paper = colored_field(variations, [223, 203, 161])
    for filename, title, lines in [
        ("leaf.jpg", "会前形势", ["长征初期的处境", "行军方向的调整", "会前材料摘记"]),
        ("cover.jpg", "会议议题", ["总结经验教训", "军事与组织问题", "课堂讨论提纲"]),
    ]:
        sheet = paper.copy()
        pen = ImageDraw.Draw(sheet)
        pen.rectangle((24, 20, 616, 444), outline="#a48a5e", width=2)
        pen.line((484, 48, 484, 414), fill="#b69a6b", width=2)
        for index, glyph in enumerate(title):
            pen.text((537, 57 + index * 70), glyph, font=face(51, True), fill="#504431", anchor="mt")
        for column, words in enumerate(lines):
            for row, glyph in enumerate(words):
                pen.text((424 - column * 55, 66 + row * 35), glyph, font=face(25, True), fill="#6e6048", anchor="mt")
        pen.rectangle((64, 301, 139, 374), outline="#98604a", width=4)
        pen.text((101, 339), "示意", font=face(26, True), fill="#98604a", anchor="mm")
        sheet.save(WORK / filename, quality=94)
    assets = ROOT / "课堂演示" / "assets"
    first = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(assets/"zunyi.mp4"), "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "pipe:1"])
    for name, source in [("project-reference", assets/"zunyi.png"), ("project-first", BytesIO(first))]:
        with Image.open(source) as reference:
            ImageOps.fit(reference.convert("RGB"), (800, 450)).save(WORK / (name+".jpg"), quality=88)


def scene():
    nodes = []

    def put(key, kind, pos, size, material, yaw=0):
        nodes.append(dict(id=key, kind=kind, pos=pos, size=size, material=material, rotY=yaw))

    def box(key, pos, size, material, yaw=0):
        put(key, "box", pos, size, material, yaw)

    materials = {
        "oak": {"color": "#ffffff", "texture": "wood.jpg", "roughness": .68},
        "walnut": {"color": "#967956", "texture": "wood.jpg"},
        "edge": {"color": "#69432c"},
        "wall": {"color": "#ffffff", "texture": "wall.jpg"},
        "floor": {"color": "#585348"},
        "joinery": {"color": "#493426"},
        "brass": {"color": "#ad864f", "roughness": .32},
        "ink": {"color": "#353630"},
        "linen": {"color": "#3f584b", "roughness": .94},
        "cloth": {"color": "#675642"},
        "paper": {"color": "#d3bc91"},
        "pageTop": {"color": "#ffffff", "texture": "cover.jpg"},
        "leaf": {"color": "#ffffff", "texture": "leaf.jpg"},
        "porcelain": {"color": "#d9dbca", "roughness": .25},
        "tea": {"color": "#504128", "roughness": .22},
        "pane": {"color": "#62858b", "emission": .35},
        "flame": {"color": "#ffd386", "emission": 2.6},
    }
    box("floor", [0,-.08,0], [8,.16,8], "floor")
    box("rear-wall", [0,1.48,-1.8], [7,3.1,.1], "wall")
    for side in [-1, 1]:
        box(f"side-{side}", [side*2.75,1.45,-.5], [.1,3.1,4.3], "wall")
        center = side * .98
        box(f"window-{side}", [center,1.64,-1.72], [1.16,1.30,.045], "pane")
        for offset in [-.59,-.30,0,.30,.59]:
            box(f"mullion-{side}-{offset}", [center+offset,1.64,-1.68], [.032,1.33,.06], "joinery")
        for offset in [-.65,-.32,.28,.65]:
            box(f"rail-{side}-{offset}", [center,1.64+offset,-1.671], [1.21,.045,.065], "walnut")
        box(f"sill-{side}", [center,.954,-1.63], [1.30,.065,.20], "walnut")
    for offset in [-2.21,0,2.21]:
        box(f"pillar-{offset}", [offset,1.38,-1.67], [.11,2.8,.14], "walnut")
    box("wainscot", [0,.42,-1.69], [5.4,.82,.08], "walnut")
    box("wall-rail", [0,.83,-1.64], [5.4,.06,.12], "edge")
    for number, center in enumerate([-.78,.81]):
        box(f"chair-seat-{number}", [center,.46,-.83], [.56,.075,.5], "walnut")
        for side in [-1,1]:
            box(f"chair-post-{number}-{side}", [center+side*.23,.78,-1.025], [.058,.99,.065], "walnut")
        for offset in [-.12,0,.12]:
            box(f"chair-slat-{number}-{offset}", [center+offset,1.019,-1.026], [.060,.40,.047], "walnut")
        box(f"chair-crown-{number}", [center,1.29,-1.028], [.61,.085,.08], "oak")
    for left in [-1.09,1.09]:
        for depth in [-.48,.48]:
            box(f"table-leg-{left}-{depth}", [left,.356,depth], [.095,.71,.095], "walnut")
    box("apron", [0,.661,.535], [2.40,.135,.065], "walnut")
    box("table", [0,.755,0], [2.56,.09,1.34], "oak")
    box("front-lip", [0,.752,.668], [2.55,.025,.013], "edge")
    for depth in [-.37,.04,.47]:
        box(f"plank-joint-{depth}", [0,.8003,depth], [2.54,.00055,.0017], "edge")

    box("dossier-board", [-.25,.810,.16], [.544,.019,.393], "linen")
    for level in range(5):
        box(f"dossier-stack-{level}", [-.25+.0014*math.sin(level),.821+level*.0045,.16], [.507,.0045,.366], "paper")
    box("dossier-notes", [-.25,.843,.16], [.50,.003,.36], "pageTop")
    box("case-binding", [-.514,.831,.16], [.023,.034,.383], "linen")
    box("second-book", [.40,.818,-.055], [.36,.031,.27], "cloth", -12)
    box("second-pages", [.40,.839,-.055], [.344,.012,.256], "paper", -12)
    box("second-cover", [.40,.848,-.055], [.36,.008,.27], "linen", -12)
    box("title-slip", [.485,.853,-.051], [.047,.001,.148], "paper", -12)
    box("pencil", [.42,.808,.237], [.29,.011,.012], "brass", 13)
    box("pencil-tip", [.269,.808,.273], [.020,.007,.008], "ink", 13)
    for key,height,radius,thick,mat in [
        ("foot",.819,.098,.036,"brass"), ("ring",.845,.080,.020,"ink"),
        ("reservoir",.892,.065,.08,"brass"), ("collar",.94,.052,.026,"ink"),
        ("crown",1.178,.053,.030,"brass"), ("cap",1.206,.038,.03,"ink"),
    ]:
        put("lamp-"+key, "cylinder", [.67,height,-.335], [radius*2,thick,radius*2], mat)
    put("flame", "sphere", [.67,1.029,-.335], [.063,.128,.057], "flame")
    for side in [-1,1]:
        box(f"lamp-guard-{side}", [.67+side*.055,1.055,-.335], [.009,.222,.009], "brass")
    for index,(left,depth) in enumerate([(-.83,-.18),(.94,.20)]):
        put(f"saucer-{index}", "cylinder", [left,.809,depth], [.161,.011,.161], "porcelain")
        put(f"cup-{index}", "cylinder", [left,.86,depth], [.116,.101,.116], "porcelain")
        put(f"rim-{index}", "cylinder", [left,.906,depth], [.119,.011,.119], "linen")
        put(f"tea-{index}", "cylinder", [left,.912,depth], [.103,.003,.103], "tea")
    return {
        "camera": {"target":[0,.84,0],"yaw":0,"pitch":22,"radius":2.75,"fov":34},
        "object": {"hinge":[-.50,.846,.16],"width":.50,"depth":.36},
        "lighting": {"key":[.70,2.17,.57],"fill":[-1.65,2.3,-.87]},
        "materials": materials, "nodes": nodes,
    }


if __name__ == "__main__":
    WORK.mkdir(parents=True, exist_ok=True)
    textures()
    manifest = scene()
    staging = WORK / "scene.tmp"
    staging.write_text(json.dumps(manifest,ensure_ascii=False),encoding="utf-8")
    staging.replace(WORK / "scene.json")
    print("场景就绪", len(manifest["nodes"]), flush=True)
