"""精修材料厅的铺地、屋面和木作，坐标对应样课原有动线。"""

from math import cos, pi, sin
from pathlib import Path
from random import Random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refine_mesh import Parts, blender_point, maps, save_and_export, surface


out, editable, console_source = map(Path, sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
random = Random(61035)
aged_wood = surface("旧木 · 深色木构", (0.24, 0.16, 0.10), 0.88, {
    "Base Color": out / "wood-color.jpg", "Normal": out / "wood-normal.jpg",
})
wood_edge = surface("旧木 · 磨损木边", (0.23, 0.137, 0.071), 0.86)
tile_finish = surface("青灰陶瓦 · 烧制纹理", (0.18, 0.18, 0.17), 0.91,
                      {"Base Color": out / "roof.jpg", "Normal": out / "roof-normal.jpg"}, normal_strength=0.33)
tile_end = surface("青灰陶瓦 · 端面", (0.129, 0.134, 0.132), 0.93)
ash_brick = surface("青砖 · 窗洞与墙角砌体", (0.084, 0.085, 0.077), 0.92,
                    {"Normal": out / "brick-normal.jpg"}, normal_strength=0.18)
wall_bricks = [Parts(ash_brick, 1.9), Parts(surface("青砖 · 略深", (0.062, 0.065, 0.060), 0.94), 1.9)]
step_stone = Parts(surface("青石 · 门槛", (0.24, 0.245, 0.23), 0.95, {
    "Normal": out / "courtyard-stone-normal.jpg",
}), 0.72)
fittings = Parts(surface("暗色旧铜与铁件", (0.17, 0.111, 0.059), 0.68, metal=0.22))
frame = Parts(aged_wood, 1.92)
wear = Parts(wood_edge)


def courtyard():
    face = Parts(surface("灰石板 · 颜色、法线与粗糙度", (0.38, 0.38, 0.35), 0.91,
                         maps(out, "courtyard-stone"), normal_strength=0.57), 2.26)
    source = bpy.data.images.load(str(out / "courtyard-stone-height.jpg"))
    source.colorspace_settings.name = "Non-Color"
    width, height = source.size[:]
    values = source.pixels[:]
    columns, rows = 147, 91
    points, faces = [], []
    meters = 2.26
    for j in range(rows):
        z = -0.82 + 6.81 * j / (rows - 1)
        for i in range(columns):
            x = -5.53 + 11.06 * i / (columns - 1)
            u, v = x / meters % 1, z / meters % 1
            index = (min(height - 1, int(v * height)) * width + min(width - 1, int(u * width))) * 4
            h = values[index]
            points.append((x, -0.039 + h * 0.042, z))
            n = len(points) - 1
            if i and j:
                faces.append((n - columns - 1, n - 1, n, n - columns))
    face.mesh(points, faces, lambda p: (p[0] / meters, p[2] / meters))
    face.object("庭院 · 按扫描起伏制作的石板地", smooth=True)
    bpy.data.images.remove(source)


def planked_floor():
    floor = Parts(surface("旧木地板 · 顺纹", (0.4, 0.30, 0.22), 0.89,
                          maps(out, "indoor-floor"), normal_strength=0.38))
    count = 36
    for i in range(count):
        width = 11.10 / count
        x = -5.55 + width * (i + 0.5)
        start = -5.39
        breaks = [-4.01 + random.uniform(-0.45, 0.36), -2.51 + random.uniform(-0.30, 0.55), -0.754]
        strip = ((i * 7) % 13) / 13 + 0.013
        offset = random.random()
        for end in breaks:
            floor.block((x, -0.038 + random.uniform(-0.0019, 0.0019), (start + end) / 2),
                        (width - 0.006, 0.077, end - start - 0.007), edge=0.004,
                        uv=lambda p: (p[2] / 3.18 + offset, strip + (p[0] - x) / width * 0.055))
            start = end
    floor.object("材料厅 · 错缝、倒角木地板")


def make_window(x):
    z = -0.75
    for side in (-1, 1):
        frame.block((x + side * 0.618, 1.64, z), (0.123, 1.245, 0.277), 0.009)
        frame.block((x + side * 0.543, 1.64, z - 0.061), (0.044, 1.12, 0.057), 0.005)
        frame.block((x, 1.64 + side * 0.585, z + 0.008), (1.35, 0.079, 0.265), 0.008)
        frame.block((x + side * 0.572, 1.64, z + 0.105), (0.043, 1.20, 0.068), 0.005)
        for row in range(10):
            brick = wall_bricks[(row + int(side > 0)) % 2]
            brick.block((x + side * (0.69 + (row % 2) * 0.031), 1.108 + row * 0.112, z + 0.005),
                        (0.099 + 0.035 * (row % 2), 0.105, 0.228), 0.005)
            if row in (1, 7):
                fittings.block((x + side * 0.49, 1.108 + row * 0.112, z + 0.109), (0.063, 0.062, 0.016), 0.003)

    for k in range(-3, 4):
        frame.block((x + k * 0.148, 1.647, z + 0.018), (0.032, 1.09, 0.075), 0.004)
        if k in (-2, 2):
            frame.block((x + k * 0.148, 1.64, z - 0.083), (0.047, 1.075, 0.048), 0.004)
    for y in (1.455, 1.826):
        frame.block((x, y, z + 0.022), (1.11, 0.052, 0.092), 0.006)
        wear.block((x, y + 0.012, z - 0.072), (1.105, 0.029, 0.047), 0.003)
    frame.block((x, 1.015, z + 0.014), (1.51, 0.079, 0.359), 0.01)
    wear.block((x, 0.971, z + 0.015), (1.42, 0.029, 0.295), 0.004)


def entry():
    for x in (-3.89, -1.82, 3.97):
        make_window(x)
    for i, x in enumerate((0.57, 2.23)):
        side = (2 * i - 1)
        step_stone.block((x, 0.084, -0.75), (0.286, 0.164, 0.36), 0.017)
        frame.block((x, 1.362, -0.75), (0.185, 2.4, 0.279), 0.009)
        wear.block((x - side * 0.071, 1.34, -0.638), (0.057, 2.34, 0.109), 0.006)
        for j in range(13):
            wall_bricks[j % 2].block((x + side * (0.108 + (j % 2) * 0.041), 0.243 + j * 0.166, -0.75),
                                     (0.163 + (j % 2) * 0.075, 0.151, 0.249), 0.009)
        for y in (0.56, 1.8):
            fittings.block((x - side * 0.083, y, -0.642), (0.044, 0.106, 0.018), 0.004)
    step_stone.block((1.4, 0.017, -0.734), (1.65, 0.071, 0.49), 0.013)
    wear.block((1.4, 0.052, -0.75), (1.56, 0.019, 0.327), 0.006)
    frame.block((1.4, 2.58, -0.75), (1.90, 0.211, 0.29), 0.012)
    for x in (-5.33, 5.33):
        side = -1 if x < 0 else 1
        for j in range(15):
            y = 0.17 + j * 0.163
            wall_bricks[j % 2].block((x, y, -0.75), (0.122, 0.147, 0.271), 0.007)
            wall_bricks[(j + 1) % 2].block((x + side * 0.007, y, -5.27 + (j % 2) * 0.038),
                                           (0.11, 0.147, 0.19), 0.007)
    for x in (-4.99, -2.39):
        step_stone.block((x, 0.077, 0.51), (0.268, 0.156, 0.259), 0.013)
        frame.block((x, 1.34, 0.51), (0.133, 2.41, 0.133), 0.009)
        frame.block((x, 2.39, 0.51), (0.235, 0.092, 0.238), 0.008)
        for y in (0.19, 2.32):
            wear.block((x, y, 0.51), (0.155, 0.048, 0.152), 0.006)


def ceramic_roof():
    pans, rims = Parts(tile_finish, 1.62), Parts(tile_end)

    def tile(x, z, direction, row, y, slope, cap):
        half = 0.063 if cap else 0.101
        length = 0.38
        phase = (row % 3 - 1) * 0.003
        amplitude = 0.037 if cap else -0.018
        profile = [(half * sin(angle), amplitude * cos(angle)) for angle in
                   [(-1 + i / 3) * pi / 2 for i in range(7)]]
        under = [(u, rise - (0.012 if cap else 0.010)) for u, rise in reversed(profile)]
        rings = []
        for travel in (0, length):
            rings.append([(x + u * (1 + 0.08 * (1 - travel / length)), y + slope * travel + rise + phase,
                           z + direction * travel) for u, rise in [*profile, *under]])
        a, b = rings
        if direction > 0:
            a, b = b, a
        n = len(a)
        faces = [(k, k + n, (k + 1) % n + n, (k + 1) % n) for k in range(n)]
        pans.mesh(a + b, faces, lambda p: (p[0] / 1.18, p[2] / 1.6 + 0.13 * (row % 4)))
        rims.mesh(a, [tuple(range(n))])
        rims.mesh(b, [tuple(reversed(range(n)))])

    def slope_surface(low_z, high_z, low_y, high_y, left, span, *, tiled=True):
        length = abs(high_z - low_z)
        direction = 1 if high_z > low_z else -1
        slope = (high_y - low_y) / length
        if not tiled:
            pans.block((left + span / 2, low_y - 0.035, low_z + direction * length / 2),
                       (span, 0.079, length + 0.03), 0.008,
                       transform=lambda p: (p[0], p[1] + (p[2] - low_z) * direction * slope, p[2]))
            return
        columns = round(span / 0.21)
        detail = min(4, round(length / 0.272))
        for r in range(detail):
            along = r * 0.272
            for i in range(columns):
                x = left + (i + 0.5) * span / columns
                tile(x, low_z + direction * along, direction, r, low_y + slope * along + 0.005 * r, slope, False)
                tile(x + 0.102, low_z + direction * along, direction, r, low_y + slope * along + 0.005 * r + 0.009, slope, True)
        setback = detail * 0.272 - 0.11
        pans.block((left + span / 2, low_y - 0.035, low_z + direction * (length + setback) / 2),
                   (span, 0.079, length - setback + 0.03), 0.008,
                   transform=lambda p: (p[0], p[1] + (p[2] - low_z) * direction * slope, p[2]))
        for i in range(round(span / 0.31)):
            x = left + 0.085 + i * 0.31
            frame.block((x, low_y - 0.067, low_z + direction * 0.191), (0.068, 0.114, 0.59), 0.006,
                        transform=lambda p: (p[0], p[1] + (p[2] - low_z) * direction * slope, p[2]))
        frame.block((left + span / 2, low_y - 0.087, low_z + direction * 0.239), (span, 0.143, 0.152), 0.009)
        wear.block((left + span / 2, low_y - 0.019, low_z + direction * 0.035), (span + 0.075, 0.091, 0.058), 0.008)

    slope_surface(0.18, -3.05, 2.925, 3.735, -5.87, 11.74)
    slope_surface(-6.29, -3.05, 2.925, 3.735, -5.87, 11.74, tiled=False)
    slope_surface(2.42, 0.02, 2.43, 2.935, -5.46, 3.39)
    # 封堵左院墙顶（y≈2.71）与廊檐/主屋前檐斜坡之间的三角空隙
    porch_slope = (2.935 - 2.43) / (2.42 - 0.02)
    frame.block((-5.47, 2.75, -0.34), (0.21, 0.30, 0.96), 0.006)
    z0, z1 = 0.04, 1.56
    y_bot = 2.60
    y_top0 = 2.43 + (2.42 - z0) * porch_slope - 0.025
    y_top1 = 2.43 + (2.42 - z1) * porch_slope - 0.025
    gable = [
        (-5.575, y_bot, z0), (-5.365, y_bot, z0), (-5.365, y_top0, z0), (-5.575, y_top0, z0),
        (-5.575, y_bot, z1), (-5.365, y_bot, z1), (-5.365, y_top1, z1), (-5.575, y_top1, z1),
    ]
    frame.mesh(gable, [
        (1, 2, 6, 5), (0, 4, 7, 3), (0, 3, 2, 1), (4, 5, 6, 7), (3, 7, 6, 2), (0, 1, 5, 4),
    ])
    for i in range(41):
        rims.block((-5.72 + i * 0.285, 3.869, -3.05), (0.283, 0.128, 0.184), 0.029)
    for x in (-4.84, -2.52, 0.6, 2.23, 4.68):
        frame.block((x, 2.78, -0.61), (0.176, 0.257, 0.52), 0.011)
        wear.block((x, 2.747, -0.43), (0.228, 0.084, 0.288), 0.008)
    pans.object("屋面 · 搭接小青瓦")
    rims.object("屋脊与瓦口 · 端面")


def place_console():
    existing = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(console_source))
    imported = set(bpy.context.scene.objects) - existing
    coordinates = [obj.matrix_world @ Vector(corner) for obj in imported if obj.type == "MESH"
                   for corner in obj.bound_box]
    min_x = min(v.x for v in coordinates)
    max_x = max(v.x for v in coordinates)
    min_y, max_y = min(v.y for v in coordinates), max(v.y for v in coordinates)
    min_z = min(v.z for v in coordinates)
    scale = 1.46 / (max_x - min_x)
    root = bpy.data.objects.new("墙边中式条案 · Poly Haven", None)
    bpy.context.collection.objects.link(root)
    for obj in imported:
        if obj.type == "MESH":
            for slot in obj.material_slots:
                if slot.material:
                    slot.material.use_backface_culling = True
        if obj.parent not in imported:
            obj.parent = root
    root.scale = (scale,) * 3
    root.location = Vector(blender_point((-3.91, 0.004, -4.7))) - Vector(
        ((min_x + max_x) / 2, (min_y + max_y) / 2, min_z)) * scale


courtyard()
planked_floor()
entry()
ceramic_roof()
place_console()
frame.object("门窗与檐下木构")
wear.object("木作边缘、窗格内层")
fittings.object("窗铰与门扣")
step_stone.object("磨损石门槛与柱脚")
for i, parts in enumerate(wall_bricks):
    parts.object(f"墙角与洞口 · 青砖 {i + 1}")
save_and_export("遵义材料厅", out, editable)
