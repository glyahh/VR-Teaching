import argparse
import base64
import json
from pathlib import Path
from shutil import copyfile


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = ROOT / ".march-build" / "route-lab"
RELEASE = ROOT / "展示材料" / "遵义镜头路线对比"
TITLES = {"A": "Blender预渲染机位", "B": "浏览器实时三维", "C": "三维接Blender短片"}


def inline(path):
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4"}[path.suffix]
    return "data:" + mime + ";base64," + base64.b64encode(path.read_bytes()).decode("ascii")


def build(route):
    manifest = json.loads((WORK / "scene.json").read_text(encoding="utf-8"))
    media = WORK / "media"
    bundle = {"route":route, "title":TITLES[route], "scene":manifest, "reference":inline(WORK/"project-reference.jpg"), "referenceFirst":inline(WORK/"project-first.jpg")}
    if route in ("B", "C"):
        files = {entry["texture"] for entry in manifest["materials"].values() if "texture" in entry}
        bundle["textures"] = {name:inline(WORK/name) for name in sorted(files)}
    if route in ("A", "C"):
        bundle["clip"] = inline(media/"clip.mp4")
        bundle["calibration"] = json.loads((media/"calibration.json").read_text(encoding="utf-8-sig"))
    if route == "A":
        bundle["views"] = [inline(media/f"view-{index:02d}.jpg") for index in range(17)]
    if route == "C":
        bundle.update(anchorImage=inline(media/"gold.png"), tailImage=inline(media/"tail.png"))
    template = (HERE/"player.html").read_text(encoding="utf-8")
    replacements = {
        "TITLE":TITLES[route],
        "CSS":(HERE/"player.css").read_text(encoding="utf-8"),
        "DATA":json.dumps(bundle, ensure_ascii=False, separators=(",",":")).replace("<","\\u003c"),
        "RENDERER":(HERE/"web"/"renderer.js").read_text(encoding="utf-8") if route != "A" else "",
        "PLAYER":(HERE/"player.js").read_text(encoding="utf-8"),
    }
    for tag, value in replacements.items():
        template = template.replace("@@"+tag+"@@",value)
    RELEASE.mkdir(parents=True,exist_ok=True)
    target = RELEASE/(route+"-"+TITLES[route]+".html")
    staging = target.with_suffix(".tmp")
    staging.write_text(template, encoding="utf-8")
    staging.replace(target)
    print(target.name, target.stat().st_size, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=list(TITLES))
    requested = parser.parse_args().only
    for route in [requested] if requested else TITLES:
        build(route)
    if requested != "B":
        clip = RELEASE / "遵义会议桌-翻页镜头.mp4"
        staging = clip.with_suffix(".tmp")
        copyfile(WORK/"media"/"clip.mp4", staging)
        staging.replace(clip)
