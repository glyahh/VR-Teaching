"""将一份 blend 单独复制到空目录，验证贴图、两台相机及实际重渲。"""

import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory


VIEWS = [
    ("机位一 · 桌边全景", "会前的桌边.png"),
    ("机位二 · 侧视装订", "侧看书口与灯罩.png"),
]


def inspect_packed(arguments):
    import bpy

    directory = Path(arguments[0])
    scene = bpy.context.scene
    images = [image for image in bpy.data.images if image.source == "FILE"]
    assert images and not list(bpy.data.libraries)
    for image in images:
        assert image.packed_file and image.packed_file.size > 0, image.name
        assert not Path(bpy.path.abspath(image.filepath)).exists(), image.filepath
    assert scene.camera.name == VIEWS[0][0]
    assert (scene.render.resolution_x, scene.render.resolution_y) == (1920, 1080)
    assert scene.render.engine == "CYCLES"
    cameras = [bpy.data.objects[name] for name, filename in VIEWS]
    assert (cameras[0].location-cameras[1].location).length > .5
    if "full" not in arguments:
        scene.render.resolution_percentage = 25
        scene.cycles.samples = 12
    for camera, (_, filename) in zip(cameras, VIEWS):
        scene.camera = camera
        scene.render.filepath = str(directory / filename)
        bpy.ops.render.render(write_still=True)
    summary = {
        "packed_images": len(images),
        "packed_bytes": sum(image.packed_file.size for image in images),
        "mesh_objects": sum(obj.type == "MESH" for obj in scene.objects),
        "curve_objects": sum(obj.type == "CURVE" for obj in scene.objects),
        "camera_views": [name for name, filename in VIEWS],
        "external_libraries": len(bpy.data.libraries),
    }
    (directory/"summary.json").write_text(json.dumps(summary,ensure_ascii=False),encoding="utf-8")


def run():
    from PIL import Image, ImageChops, ImageStat

    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--blender", required=True, type=Path)
    parser.add_argument("--model", required=True, type=Path)
    parser.add_argument("--render-to", type=Path, help="输出从独立工程渲染的两张正式图")
    args = parser.parse_args()
    with TemporaryDirectory() as folder:
        directory = Path(folder)
        isolated = directory / "scene.blend"
        shutil.copyfile(args.model, isolated)
        assert list(directory.iterdir()) == [isolated]
        subprocess.run([
            str(args.blender.resolve()), "-b", "--disable-autoexec", str(isolated),
            "--python-exit-code", "1", "-P", str(Path(__file__).resolve()), "--", str(directory),
            "full" if args.render_to else "quick",
        ], check=True)
        thumbs = []
        for camera_name, filename in VIEWS:
            with Image.open(directory/filename) as picture:
                picture.load()
                assert picture.size == ((1920,1080) if args.render_to else (480,270))
                small = picture.convert("RGB").resize((160,90))
                assert ImageStat.Stat(small.convert("L")).stddev[0] > 18
                rgb = small.tobytes()
                magenta = sum(red>200 and green<26 and blue>200 for red,green,blue in zip(rgb[::3],rgb[1::3],rgb[2::3]))
                assert magenta < 3, camera_name
                thumbs.append(small)
        difference = ImageStat.Stat(ImageChops.difference(*thumbs)).mean
        assert sum(difference)/3 > 7
        if args.render_to:
            args.render_to.mkdir(parents=True, exist_ok=True)
            for name, filename in VIEWS:
                target = args.render_to / filename
                temporary = target.with_suffix(".tmp")
                shutil.copyfile(directory/filename,temporary)
                os.replace(temporary,target)
        print((directory/"summary.json").read_text(encoding="utf-8"), flush=True)


if __name__ == "__main__":
    if "--" in sys.argv:
        inspect_packed(sys.argv[sys.argv.index("--")+1:])
    else:
        run()
