"""准备两份离线原型的模型和贴图。运行端需要的资源全部嵌入 HTML。"""

import argparse
from hashlib import md5, sha256
import io
import json
import os
from pathlib import Path
import struct
import subprocess
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from zipfile import ZipFile

from PIL import Image
import numpy as np

from folio_art import paper_art


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = ROOT / ".march-build" / "roam-prototypes"
SOURCE = ROOT / "展示材料" / "遵义会议室精修场景" / "会前的桌边.blend"


def fetch(url):
    for attempt in range(3):
        try:
            with urlopen(Request(url, headers={"User-Agent": "VR Teaching asset build"}), timeout=18) as response:
                return response.read()
        except OSError:
            if attempt == 2:
                raise


def compact_model(path, limit=1024):
    """裁定内嵌贴图分辨率，保留网格、材质和透明通道。"""
    raw = path.read_bytes()
    json_length, kind = struct.unpack_from("<I4s", raw, 12)
    assert raw[:4] == b"glTF" and kind == b"JSON"
    document = json.loads(raw[20:20 + json_length])
    binary = memoryview(raw)[28 + json_length:]
    image_views = {image["bufferView"]: image for image in document.get("images", [])}
    packed = bytearray()
    for index, view in enumerate(document["bufferViews"]):
        start = view.get("byteOffset", 0)
        data = binary[start:start + view["byteLength"]]
        if index in image_views:
            image = Image.open(io.BytesIO(data))
            image.thumbnail((limit, limit), Image.Resampling.LANCZOS)
            resized = io.BytesIO()
            if image.mode == "RGB":
                image.save(resized, format="JPEG", quality=87, optimize=True)
                image_views[index]["mimeType"] = "image/jpeg"
            else:
                image.save(resized, format="PNG", optimize=True)
                image_views[index]["mimeType"] = "image/png"
            data = resized.getvalue()
        view["byteOffset"] = len(packed)
        view["byteLength"] = len(data)
        packed.extend(data)
        packed.extend(b"\0" * (-len(packed) % 4))
    document["buffers"][0]["byteLength"] = len(packed)
    metadata = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    metadata += b" " * (-len(metadata) % 4)
    path.write_bytes(struct.pack("<4sII", b"glTF", 2, 28 + len(metadata) + len(packed)) +
                     struct.pack("<I4s", len(metadata), b"JSON") + metadata +
                     struct.pack("<I4s", len(packed), b"BIN\0") + packed)


def texture(asset, role, stem):
    """按发布方校验值复用缓存，只下载所需的 1K JPEG。"""
    if asset == "brick_wall_08":
        folder = ROOT / ".march-build" / "source-review" / "brick-wall-08"
        manifest = folder / "source.json"
    else:
        folder = WORK / "polyhaven" / asset
        manifest = folder / "source.json"
    records = json.loads(manifest.read_text(encoding="utf-8-sig"))["files"] if manifest.is_file() else []
    if not any(item["role"] == role for item in records):
        response = json.loads(fetch(f"https://api.polyhaven.com/files/{asset}"))
        channels = dict.fromkeys(["Diffuse", "nor_gl", role, *(item["role"] for item in records)])
        records = [
            {"role": channel, "file": record["url"].rsplit("/", 1)[-1], **record}
            for channel in channels
            for record in (response[channel]["1k"]["jpg"],)
        ]
        if asset != "brick_wall_08":
            folder.mkdir(parents=True, exist_ok=True)
            manifest.write_text(json.dumps({
                "source": f"https://polyhaven.com/a/{asset}",
                "license": "CC0-1.0",
                "files": records,
            }, indent=2) + "\n", encoding="utf-8")
    record = next(item for item in records if item["role"] == role)
    original = folder / record["file"]
    raw = original.read_bytes() if original.is_file() else fetch(record["url"])
    if md5(raw).hexdigest() != record["md5"]:
        raise ValueError(f"贴图校验失败 {original}")
    if asset != "brick_wall_08" and not original.is_file():
        original.write_bytes(raw)
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    image.thumbnail((1024, 1024))
    image.save(WORK / "assets" / f"{stem}.jpg", quality=86)


def public_model(asset):
    """在准备阶段下载 Poly Haven 的模型和原始贴图，并核对发布方 MD5。"""
    folder = WORK / "polyhaven" / asset
    manifest = folder / "model-source.json"
    folder.mkdir(parents=True, exist_ok=True)
    if manifest.exists():
        metadata = json.loads(manifest.read_text(encoding="utf-8"))
    else:
        upstream = json.loads(fetch(f"https://api.polyhaven.com/files/{asset}"))["gltf"]["1k"]["gltf"]
        metadata = {
            "source": f"https://polyhaven.com/a/{asset}",
            "license": "CC0-1.0",
            "gltf": upstream["url"].rsplit("/", 1)[-1],
            "files": {upstream["url"].rsplit("/", 1)[-1]: upstream, **upstream["include"]},
        }
        manifest.write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")

    def materialize(entry):
        name, record = entry
        destination = (folder / name).resolve()
        if not destination.is_relative_to(folder.resolve()):
            raise ValueError(f"素材路径越界 {name}")
        raw = destination.read_bytes() if destination.exists() else fetch(record["url"])
        if md5(raw).hexdigest() != record["md5"]:
            raise ValueError(f"模型文件校验失败 {destination}")
        if not destination.exists():
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(raw)

    with ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(materialize, metadata["files"].items()))
    print(f"模型及材质已校验 {asset}", flush=True)
    return folder / metadata["gltf"]


def water_normals(out):
    """用可平铺的斜率场给河面提供多方向波纹。"""
    size = 192
    y, x = np.mgrid[0:size, 0:size] / size
    dx = np.zeros_like(x)
    dy = np.zeros_like(y)
    rng = np.random.default_rng(20761)
    for _ in range(25):
        kx, ky = rng.integers(-9, 10, size=2)
        if kx == ky == 0:
            continue
        phase = 2 * np.pi * (kx * x + ky * y + rng.random())
        amplitude = 0.21 / (kx * kx + ky * ky + 3) ** 0.78
        dx += np.cos(phase) * kx * amplitude
        dy += np.cos(phase) * ky * amplitude
    normals = np.stack((-dx, -dy, np.ones_like(dx)), axis=2)
    normals /= np.linalg.norm(normals, axis=2, keepdims=True)
    Image.fromarray(np.uint8((normals * 0.5 + 0.5) * 255)).save(out / "water-normal.png", optimize=True)


def prepare_nature(blender, out):
    models = [public_model(asset) for asset in ("island_tree_02", "grass_medium_01", "rock_moss_set_01")]
    subprocess.run([str(blender), "--background", "--factory-startup", "--python-exit-code", "1",
                    "-P", str(HERE / "export_nature.py"), "--", str(out), *map(str, models)], check=True)
    for name, limit in (("river-tree", 1024), ("river-tree-far", 768), ("river-grass", 768), ("river-rock", 768)):
        compact_model(out / (name + ".glb"), limit)
    water_normals(out)


def prepare_mpfb():
    version = "2.0.18"
    folder = WORK / "model-refine" / f"mpfb2-{version}"
    archive = folder / "source.zip"
    manifest = folder / "source.json"
    url = f"https://codeload.github.com/makehumancommunity/mpfb2/zip/refs/tags/v{version}"
    folder.mkdir(parents=True, exist_ok=True)
    raw = archive.read_bytes() if archive.is_file() else fetch(url)
    digest = sha256(raw).hexdigest()
    if manifest.is_file() and json.loads(manifest.read_text(encoding="utf-8"))["sha256"] != digest:
        raise ValueError(f"MPFB 源包校验失败 {archive}")
    with ZipFile(io.BytesIO(raw)) as source:
        prefix = f"mpfb2-{version}/"
        for name in source.namelist():
            relative = name.removeprefix(prefix)
            if relative.endswith("/") or not (relative.startswith("src/mpfb/") or relative.startswith("LICENSE.")):
                continue
            dest = (folder / relative).resolve()
            if not dest.is_relative_to(folder.resolve()):
                raise ValueError(f"MPFB 路径越界 {name}")
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(source.read(name))
    if not archive.is_file():
        archive.write_bytes(raw)
    manifest.write_text(json.dumps({
        "version": version, "url": url, "sha256": digest,
        "assets_license": "CC0-1.0", "code_license": "GPL-3.0-or-later",
    }, indent=2) + "\n", encoding="utf-8")
    print(f"MPFB {version} 已准备 SHA-256 {digest}", flush=True)
    return folder / "src"


def prepare_refine_sources():
    def maps(item):
        asset, stem = item
        for role, suffix in (("Rough", "-rough"), ("Diffuse", ""), ("nor_gl", "-normal")):
            texture(asset, role, stem + suffix)
        if asset == "grey_stone_path":
            texture(asset, "Displacement", stem + "-height")
        print(f"精修材质已核对 {asset}", flush=True)

    with ThreadPoolExecutor(max_workers=5) as pool:
        model = pool.submit(public_model, "chinese_console_table")
        human = pool.submit(prepare_mpfb)
        materials = [
            pool.submit(maps, pair) for pair in [
                ("grey_stone_path", "courtyard-stone"), ("wood_floor_worn", "indoor-floor"),
                ("brown_planks_03", "river-timber"), ("rough_linen", "coarse-cloth"),
            ]
        ]
        for job in materials:
            job.result()
        return model.result(), human.result()


def prepare_folio_paper(out):
    folder = WORK / "model-refine" / "ambientcg-paper001"
    folder.mkdir(parents=True, exist_ok=True)
    url = "https://ambientcg.com/get?file=Paper001_1K-JPG.zip"
    path = folder / "Paper001_1K-JPG.zip"
    data = path.read_bytes() if path.is_file() else fetch(url)
    digest = sha256(data).hexdigest()
    if digest != "5be094ffad8a6343ed96ec728e6eda3d84ae542cd2b16c32bc2ad67bb57a0013":
        raise ValueError("ambientCG Paper001 纸纹源包校验失败")
    with ZipFile(io.BytesIO(data)) as archive:
        for component in ("Color", "NormalGL", "Roughness"):
            name = f"Paper001_1K-JPG_{component}.jpg"
            (folder / name).write_bytes(archive.read(name))
    if not path.is_file():
        path.write_bytes(data)
    (folder / "source.json").write_text(json.dumps({
        "source": "https://ambientcg.com/view?id=Paper001", "url": url,
        "sha256": digest, "license": "CC0-1.0",
    }, indent=2) + "\n", encoding="utf-8")
    paper_art(folder / "Paper001_1K-JPG_Color.jpg", out)


def prepare_refined(blender, out):
    console, mpfb = prepare_refine_sources()
    prepare_folio_paper(out)
    editable = WORK / "model-refine" / "可编辑模型"
    editable.mkdir(parents=True, exist_ok=True)
    command = [str(blender)]
    profile = mpfb.parent / "blender-profile"
    env = {**os.environ, "BLENDER_USER_RESOURCES": str(profile)}
    package = mpfb.parent / "mpfb-2.0.18.zip"
    if not (profile / "extensions" / "user_default" / "mpfb" / "blender_manifest.toml").is_file():
        subprocess.run([*command, "--command", "extension", "build", "--source-dir", str(mpfb / "mpfb"),
                        "--output-filepath", str(package)], env=env, check=True)
        subprocess.run([*command, "--command", "extension", "install-file", "--repo", "user_default",
                        "--enable", str(package)], env=env, check=True)
    jobs = {"refine_hall.py": [str(console)], "refine_boat.py": [], "refine_folio.py": [], "refine_people.py": []}
    for file, args in jobs.items():
        factory = [] if file == "refine_people.py" else ["--factory-startup"]
        subprocess.run([*command, "--background", *factory, "--python-exit-code", "1",
                        "-P", str(HERE / file), "--", str(out), str(editable), *args], env=env, check=True)
    for name, limit in (("遵义材料厅", 1024), ("线装手记", 1600), ("于都木船", 1024),
                        ("于都人物", 768), ("于都队伍", 256)):
        compact_model(out / (name + ".glb"), limit)


def prepare_furniture(blender, out):
    subprocess.run([str(blender), "--background", str(SOURCE), "--python-exit-code",
                    "1", "-P", str(HERE / "export_furniture.py"), "--", str(out)], check=True)
    compact_model(out / "furniture.glb")
    for stem in ("wood-color", "wood-normal", "plaster-color", "plaster-normal"):
        path = out / f"{stem}.jpg"
        image = Image.open(path).convert("RGB")
        image.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
        image.save(path, quality=85)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--blender", type=Path, default=ROOT / ".march-build"
                        / "blender-4.5.4-windows-x64" / "blender.exe")
    parser.add_argument("--textures-only", action="store_true")
    parser.add_argument("--furniture-only", action="store_true")
    parser.add_argument("--nature-only", action="store_true")
    parser.add_argument("--refine-sources", action="store_true")
    parser.add_argument("--refined-only", action="store_true")
    args = parser.parse_args()
    out = WORK / "assets"
    out.mkdir(parents=True, exist_ok=True)
    if args.refine_sources:
        prepare_refine_sources()
        return
    if args.refined_only:
        prepare_furniture(args.blender, out)
        prepare_refined(args.blender, out)
        return
    if args.nature_only:
        prepare_nature(args.blender, out)
        return
    if not args.furniture_only:
        for asset, stem in (("brick_wall_08", "brick"), ("stone_tiles_03", "stone"),
                            ("grey_roof_tiles_02", "roof"), ("aerial_grass_rock", "river-ground")):
            texture(asset, "Diffuse", stem)
            texture(asset, "nor_gl", stem + "-normal")
            print(f"贴图已核对并准备 {asset}", flush=True)
        texture("dirt", "Diffuse", "river-soil")
    if not args.textures_only:
        prepare_furniture(args.blender, out)
    if not args.textures_only and not args.furniture_only:
        prepare_nature(args.blender, out)
        prepare_refined(args.blender, out)


if __name__ == "__main__":
    main()
