"""在片头副本里拍摄一次翻页。输入为仓库内已打包贴图的桌边 Blender 工程。"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Quaternion, Vector


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("repo", type=Path)
parser.add_argument("output", type=Path)
parser.add_argument("--frames", type=int, nargs="+")
parser.add_argument("--crop", action="store_true", help="只渲纸叶与投影经过的桌面，须与固定机位底片合成")
parser.add_argument("--width", type=int, default=1280)
parser.add_argument("--samples", type=int, default=8)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
args.output.mkdir(exist_ok=True, parents=True)
scene = bpy.context.scene
camera = scene.camera
manifest = json.loads((args.repo / "课堂演示/assets/desk-space.json").read_text(encoding="utf-8"))
pivot = Vector(manifest["pivot"])
home = camera.location.copy()
orientation = camera.matrix_world.to_quaternion()
horizontal = orientation @ Vector((1, 0, 0))
horizontal.z = 0
horizontal.normalize()
FRAMES = round(83.15 * 24) - round(79.85 * 24) + 12


def printed(name, texture):
    paper = bpy.data.materials["纤维纸 · 随记封皮"].copy()
    paper.name = name
    nodes, links = paper.node_tree.nodes, paper.node_tree.links
    shader = next(n for n in nodes if n.type == "BSDF_PRINCIPLED")
    # 扫描纸纹控制明度，排字图只改变墨覆盖的部分。
    grain = next(n for n in nodes if n.type == "TEX_IMAGE" and n.image and n.image.name == "notebook.jpg")
    palette = nodes.new("ShaderNodeValToRGB")
    palette.color_ramp.elements[0].color = (.40, .31, .19, 1)
    palette.color_ramp.elements[1].color = (.78, .69, .51, 1)
    links.new(grain.outputs["Color"], palette.inputs[0])
    ink = nodes.new("ShaderNodeTexImage")
    ink.image = bpy.data.images.load(str(args.output / (texture + ".png")), check_existing=True)
    blend = nodes.new("ShaderNodeMixRGB")
    blend.blend_type = "MULTIPLY"
    blend.inputs[0].default_value = .98
    links.new(palette.outputs[0], blend.inputs[1])
    links.new(ink.outputs["Color"], blend.inputs[2])
    links.new(blend.outputs[0], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = .86
    return paper


def coords(mesh):
    data = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", data)
    return data.reshape(-1, 3)


def store_coords(mesh, values):
    mesh.vertices.foreach_set("co", np.ascontiguousarray(values, np.float32).ravel())
    mesh.update()


def turn(rest, progress, height):
    # 以弧长积分折页，沿书脊的约 14 mm 缝线区夹紧；自由角比书口中央先起。
    hinge = -.149
    x, y, z = rest.T
    length = np.maximum(x - hinge, 0)
    u = length / .316
    v = (y - y.min()) / np.ptp(y)
    free = length[:, None] * ((np.arange(42) + .5) / 42)
    along = free / .316
    blade = progress * (math.pi + .050)
    lead = math.sin(math.pi * progress) * (1.18 * along + .86 * (.55 - v[:, None]))
    angle = np.clip(blade + lead, 0, math.pi + .09) * (-np.expm1(-free / .003))
    out = rest.copy()
    active = length > 0
    out[active, 0] = (hinge + length * np.cos(angle).mean(axis=1))[active]
    out[:, 2] = (z - np.median(z)) * (.34 + .40 * (1 - progress)) + height
    out[active, 2] += (length * np.sin(angle).mean(axis=1))[active]
    out[:, 2] += .0009 * u * np.cos(v * 9 + progress * 4) * math.sin(math.pi * progress)
    return out


def smooth(t):
    t = min(1, max(0, t))
    return t * t * t * (10 - 15 * t + 6 * t * t)


def view(yaw, pitch, zoom):
    orbit = Quaternion((0, 0, 1), math.radians(yaw)) @ Quaternion(horizontal, math.radians(-pitch))
    camera.location = pivot + (orbit @ (home - pivot)) / zoom
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = orbit @ orientation


cover = scene.objects["线装手记 · 封面"]
top = scene.objects["露出书口 30"]
leaf = top.copy()
leaf.data = top.data.copy()
leaf.name = "片头 · 穿线单叶"
cover.users_collection[0].objects.link(leaf)
leaf.data.materials.clear()
leaf.data.materials.append(printed("片头 · 翻动页", "before"))
leaf.data.materials.append(printed("片头 · 翻页背面", "reverse"))
leaf.modifiers[0].thickness = .00026
leaf.modifiers[0].material_offset = 1
leaf.modifiers[0].material_offset_rim = 1
top.data.materials[0] = printed("片头 · 揭开的内页", "after")
store_coords(cover.data, turn(coords(cover.data), 1, .0157))
rest = coords(leaf.data)
facing = leaf.copy()
facing.data = leaf.data.copy()
facing.name = "片头 · 已翻纸叶"
cover.users_collection[0].objects.link(facing)
facing.data.materials[1] = printed("片头 · 已读页", "facing")
store_coords(facing.data, turn(rest, 1, .0170))
# 前沿的小行军图与原录屏位置相同。折过的纸层沿折痕相接。
plain = leaf.data.materials[0]
map_ink = printed("片头 · 折图封面", "map")
for layer in range(4):
    fold = top.copy()
    fold.data = top.data.copy()
    fold.name = f"行军图 · 折层 {layer + 1}"
    cover.users_collection[0].objects.link(fold)
    fold.parent = None
    paper = coords(top.data)
    v = (paper[:, 1] - paper[:, 1].min()) / np.ptp(paper[:, 1])
    edge = v if layer % 2 else 1 - v
    paper[:, 0] *= .185 / .326
    paper[:, 1] *= .136 / .421
    paper[:, 2] = .0011 * layer + .0014 * edge ** 6 + .0003 * np.sin(6 * v)
    store_coords(fold.data, paper)
    fold.location = (.395, -.382, cover.parent.location.z + .0008)
    fold.rotation_euler = (0, 0, -.015)
    fold.data.materials[0] = map_ink if layer == 3 else plain
# 保留原灯芯照明，纸张运动产生的阴影由灯和窗光计算。
scene.objects["明亮焰芯"].scale.z = 1
scene.render.engine = "CYCLES"
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 5
scene.cycles.diffuse_bounces = 2
scene.cycles.glossy_bounces = 3
scene.cycles.transmission_bounces = 4
scene.cycles.seed = 13
scene.cycles.use_animated_seed = False
scene.render.use_persistent_data = True
scene.render.film_transparent = False
scene.render.use_border = args.crop
scene.render.use_crop_to_border = args.crop
if args.crop:
    # 含受翻页遮光的桌边、书口和背景，另留 24 像素拼接余量。
    scene.render.border_min_x, scene.render.border_max_x = 0, .525
    scene.render.border_min_y, scene.render.border_max_y = .14, .94
scene.render.resolution_x = args.width
scene.render.resolution_y = round(args.width * 9 / 16)
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGB"
# 源录制的第 66 帧（从零计）与正式片 81.50 秒匹配。
s = smooth(66 / 162)
view(-13.5 + 22 * s, -2.2 + 4.7 * s, .98 + .18 * s)
for i in args.frames if args.frames is not None else range(FRAMES):
    if not 0 <= i < FRAMES:
        raise ValueError(f"无效帧 {i} / {FRAMES}")
    t = i / (FRAMES - 1)
    progress = smooth((t - .08) / .73)
    store_coords(leaf.data, turn(rest, progress, .018))
    scene.render.filepath = str(args.output / f"locked-{i:03d}.png")
    bpy.ops.render.render(write_still=True)
