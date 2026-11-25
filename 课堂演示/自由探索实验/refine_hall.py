"""精修遵义材料厅的铺地、屋面、雕花木作、半敞格扇门、室内陈设与邻屋街巷天际线。

坐标沿用样课与正式课件原有动线（Y 向上，单位米）。
"""

from math import cos, pi, sin
from pathlib import Path
from random import Random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refine_mesh import Parts, blender_point, maps, save_and_export, surface


out, editable, console_source = (Path(p).resolve() for p in sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
random = Random(61035)

aged_wood = surface("旧木 · 深色木构", (0.24, 0.16, 0.10), 0.84, {
    "Base Color": out / "wood-color.jpg", "Normal": out / "wood-normal.jpg",
})
wood_edge = surface("旧木 · 磨损木边", (0.25, 0.148, 0.078), 0.80)
lacquer_red = surface("黔北漆木 · 暗朱红廊栏", (0.28, 0.072, 0.056), 0.62, {
    "Normal": out / "wood-normal.jpg",
}, normal_strength=0.22)
tile_finish = surface("青灰陶瓦 · 烧制纹理", (0.16, 0.17, 0.18), 0.86,
                      {"Base Color": out / "roof.jpg", "Normal": out / "roof-normal.jpg"}, normal_strength=0.38)
tile_end = surface("青灰陶瓦 · 端面", (0.118, 0.125, 0.130), 0.90)
ash_brick = surface("青砖 · 窗洞与墙角砌体", (0.095, 0.098, 0.092), 0.91,
                    {"Normal": out / "brick-normal.jpg"}, normal_strength=0.26)
wall_bricks = [
    Parts(ash_brick, 1.9),
    Parts(surface("青砖 · 略深", (0.068, 0.072, 0.069), 0.93,
                  {"Normal": out / "brick-normal.jpg"}, normal_strength=0.22), 1.9),
]
distant_plaster = surface("远景民居 · 青灰粉墙", (0.145, 0.155, 0.158), 0.96)
step_stone = Parts(surface("青石 · 门槛与柱础", (0.20, 0.205, 0.195), 0.91,
                           maps(out, "courtyard-stone"), normal_strength=0.45), 1.45)
fittings = Parts(surface("暗色旧铜与铁件", (0.24, 0.165, 0.082), 0.42, metal=0.68))
paper_scroll = Parts(surface("旧宣纸与卷宗", (0.64, 0.56, 0.42), 0.92))
cloth_bundle = Parts(surface("靛青粗布包袱", (0.13, 0.17, 0.21), 0.94))
ceramics = Parts(surface("青灰釉瓷", (0.36, 0.41, 0.39), 0.34, metal=0.05))
gold_trim = Parts(surface("旧金线匾框", (0.58, 0.43, 0.18), 0.46, metal=0.58))

frame = Parts(aged_wood, 1.92)
wear = Parts(wood_edge)
red_trim = Parts(lacquer_red, 1.4)
distant_wall = Parts(distant_plaster, 2.5)


def rotate_y(p, pivot, angle):
    ca, sa = cos(angle), sin(angle)
    dx, dz = p[0] - pivot[0], p[2] - pivot[2]
    return (pivot[0] + dx * ca - dz * sa, p[1], pivot[2] + dx * sa + dz * ca)


def courtyard():
    face = Parts(surface("灰石板 · 颜色、法线与粗糙度", (0.37, 0.375, 0.35), 0.88,
                         maps(out, "courtyard-stone"), normal_strength=0.62), 2.26)
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

    # 庭院东南角低矮青砖花台与屋前青石阶沿（不挡通行）
    step_stone.block((1.4, 0.035, -0.26), (2.25, 0.072, 0.56), 0.014)
    step_stone.block((4.65, 0.16, 4.78), (1.35, 0.32, 1.48), 0.018)
    wall_bricks[0].block((4.65, 0.13, 4.78), (1.28, 0.26, 1.40), 0.010)
    # 沿正屋檐下铺设一条青石排水明沟边石
    for x_seg in (-3.2, -0.6, 3.85):
        span = 4.2 if x_seg == -3.2 else (1.5 if x_seg == -0.6 else 2.9)
        step_stone.block((x_seg, 0.018, -0.45), (span, 0.045, 0.24), 0.008)


def planked_floor():
    floor = Parts(surface("旧木地板 · 顺纹", (0.36, 0.26, 0.18), 0.78,
                          maps(out, "indoor-floor"), normal_strength=0.42))
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
        red_trim.block((x + side * 0.572, 1.64, z + 0.105), (0.043, 1.20, 0.068), 0.005)
        for row in range(10):
            brick = wall_bricks[(row + int(side > 0)) % 2]
            brick.block((x + side * (0.69 + (row % 2) * 0.031), 1.108 + row * 0.112, z + 0.005),
                        (0.099 + 0.035 * (row % 2), 0.105, 0.228), 0.005)
            if row in (1, 7):
                fittings.block((x + side * 0.49, 1.108 + row * 0.112, z + 0.109), (0.063, 0.062, 0.016), 0.003)

    # 细腻中式方格+回字心窗棂
    for k in range(-3, 4):
        frame.block((x + k * 0.148, 1.647, z + 0.018), (0.028, 1.09, 0.072), 0.004)
        if k in (-2, 2):
            red_trim.block((x + k * 0.148, 1.64, z - 0.083), (0.042, 1.075, 0.046), 0.004)
    for y in (1.30, 1.645, 1.98):
        frame.block((x, y, z + 0.022), (1.11, 0.038, 0.086), 0.005)
        wear.block((x, y + 0.010, z - 0.072), (1.105, 0.024, 0.042), 0.003)
    # 窗台青石滴水板
    step_stone.block((x, 1.015, z + 0.025), (1.54, 0.078, 0.38), 0.010)
    wear.block((x, 0.968, z + 0.015), (1.42, 0.029, 0.295), 0.004)


def make_door_leaf(pivot_x, pivot_z, width, side_sign, open_angle):
    """制作一扇带裙板、冰格窗格与铜门环的传统木格扇门，向室内半敞。"""
    pivot = (pivot_x, 0.0, pivot_z)
    rot = lambda p: rotate_y(p, pivot, open_angle)
    cx = pivot_x + side_sign * (width / 2)
    # 左右边框与上下横冒
    frame.block((pivot_x + side_sign * 0.045, 1.24, pivot_z), (0.082, 2.28, 0.048), 0.006, transform=rot)
    frame.block((pivot_x + side_sign * (width - 0.045), 1.24, pivot_z), (0.082, 2.28, 0.048), 0.006, transform=rot)
    for y_bar, h_bar in ((0.14, 0.11), (0.98, 0.09), (2.34, 0.10)):
        frame.block((cx, y_bar, pivot_z), (width - 0.04, h_bar, 0.046), 0.005, transform=rot)
    # 下部实木裙板 + 暗朱红雕边线
    wear.block((cx, 0.56, pivot_z), (width - 0.14, 0.76, 0.026), 0.004, transform=rot)
    red_trim.block((cx, 0.56, pivot_z + 0.016), (width - 0.24, 0.62, 0.010), 0.003, transform=rot)
    # 上部中式细木格心
    for i in (1, 2, 3):
        lx = pivot_x + side_sign * (width * i / 4)
        frame.block((lx, 1.66, pivot_z), (0.024, 1.28, 0.032), 0.003, transform=rot)
    for y_g in (1.28, 1.56, 1.84, 2.10):
        frame.block((cx, y_g, pivot_z), (width - 0.14, 0.024, 0.032), 0.003, transform=rot)
    # 铜铺首门环与合页
    handle_x = pivot_x + side_sign * (width - 0.12)
    fittings.block((handle_x, 1.06, pivot_z + 0.032), (0.055, 0.072, 0.016), 0.004, transform=rot)
    fittings.block((handle_x, 1.06, pivot_z - 0.032), (0.055, 0.072, 0.016), 0.004, transform=rot)


def make_lantern(x, y, z):
    """在廊下制作传统六角木框竹骨宫灯，内部发光体由 world.js 装配。"""
    fittings.block((x, y + 0.28, z), (0.022, 0.24, 0.022), 0.004)
    # 顶盖与底托
    red_trim.block((x, y + 0.16, z), (0.28, 0.032, 0.28), 0.008)
    red_trim.block((x, y + 0.185, z), (0.18, 0.028, 0.18), 0.006)
    red_trim.block((x, y - 0.16, z), (0.24, 0.028, 0.24), 0.007)
    # 四角立柱
    for sx in (-0.105, 0.105):
        for sz in (-0.105, 0.105):
            frame.block((x + sx, y, z + sz), (0.022, 0.30, 0.022), 0.004)
    # 下垂铜穗座
    fittings.block((x, y - 0.21, z), (0.036, 0.08, 0.036), 0.006)


def entry():
    for x in (-3.89, -1.82, 3.97):
        make_window(x)

    # 主门框、青石抱鼓门枕石与砖雕门罩
    for i, x in enumerate((0.57, 2.23)):
        side = (2 * i - 1)
        step_stone.block((x, 0.095, -0.75), (0.31, 0.19, 0.42), 0.018)
        frame.block((x, 1.362, -0.75), (0.185, 2.4, 0.279), 0.009)
        red_trim.block((x - side * 0.071, 1.34, -0.638), (0.057, 2.34, 0.109), 0.006)
        for j in range(13):
            wall_bricks[j % 2].block((x + side * (0.108 + (j % 2) * 0.041), 0.243 + j * 0.166, -0.75),
                                     (0.163 + (j % 2) * 0.075, 0.151, 0.249), 0.009)
        for y in (0.56, 1.8):
            fittings.block((x - side * 0.083, y, -0.642), (0.044, 0.106, 0.018), 0.004)

    # 半敞双开木格扇门（斜向室内开启 68°，既保留充足净宽又从庭院一眼可见门扇层次）
    make_door_leaf(0.66, -0.82, 0.68, 1, -1.24)
    make_door_leaf(2.14, -0.82, 0.68, -1, 1.24)

    # 门槛石与门额匾框（立体框 + 烫金内线，门额上添阶梯砖雕檐）
    step_stone.block((1.4, 0.022, -0.734), (1.68, 0.078, 0.50), 0.014)
    wear.block((1.4, 0.058, -0.75), (1.56, 0.022, 0.327), 0.006)
    frame.block((1.4, 2.58, -0.75), (1.96, 0.215, 0.30), 0.012)
    # 立体牌匾框（中心 1.4, 2.59, -0.575）
    frame.block((1.4, 2.59, -0.59), (0.98, 0.35, 0.055), 0.010)
    gold_trim.block((1.4, 2.74, -0.565), (0.92, 0.024, 0.022), 0.004)
    gold_trim.block((1.4, 2.44, -0.565), (0.92, 0.024, 0.022), 0.004)
    gold_trim.block((0.94, 2.59, -0.565), (0.024, 0.32, 0.022), 0.004)
    gold_trim.block((1.86, 2.59, -0.565), (0.024, 0.32, 0.022), 0.004)

    # 廊下挂两盏木框宫灯
    make_lantern(0.18, 2.22, -0.26)
    make_lantern(2.62, 2.22, -0.26)

    # 墙角青砖交错咬合
    for x in (-5.33, 5.33):
        side = -1 if x < 0 else 1
        for j in range(15):
            y = 0.17 + j * 0.163
            wall_bricks[j % 2].block((x, y, -0.75), (0.122, 0.147, 0.271), 0.007)
            wall_bricks[(j + 1) % 2].block((x + side * 0.007, y, -5.27 + (j % 2) * 0.038),
                                           (0.11, 0.147, 0.19), 0.007)

    # 西侧廊柱、八角青石柱础、雕花雀替与暗朱红挂落
    for x in (-4.99, -2.39):
        step_stone.block((x, 0.095, 0.51), (0.31, 0.19, 0.31), 0.024)
        step_stone.block((x, 0.21, 0.51), (0.23, 0.06, 0.23), 0.015)
        frame.block((x, 1.36, 0.51), (0.142, 2.38, 0.142), 0.014)
        frame.block((x, 2.39, 0.51), (0.255, 0.096, 0.255), 0.009)
        for y in (0.26, 2.30):
            red_trim.block((x, y, 0.51), (0.165, 0.052, 0.165), 0.007)
        # 柱顶雀替（左右与前后斜撑木构件）
        for dz in (-0.22, 0.22):
            red_trim.block((x, 2.26, 0.51 + dz), (0.072, 0.14, 0.30), 0.008)
    # 廊柱间檐枋与花格挂落
    frame.block((-3.69, 2.37, 0.51), (2.68, 0.11, 0.12), 0.008)
    red_trim.block((-3.69, 2.24, 0.51), (2.42, 0.042, 0.045), 0.005)
    for kx in range(9):
        rx = -4.65 + kx * 0.24
        red_trim.block((rx, 2.30, 0.51), (0.026, 0.12, 0.036), 0.003)


def indoor_furnishing(console_top):
    """室内梁架、东墙档案书架、北墙挂轴地图框与案几小件（避开全部动线）。"""
    # 1. 室内穿斗木梁架与纵檩，抬头可见木构层次
    for x in (-4.6, -1.6, 1.4, 4.4):
        frame.block((x, 2.72, -3.08), (0.14, 0.18, 4.55), 0.009)
    for z in (-4.6, -3.1, -1.6):
        frame.block((0.0, 2.80, z), (10.9, 0.11, 0.12), 0.007)

    # 2. 东墙靠边多宝格档案书架（x≈5.02，紧贴东墙，不侵入走道）
    sx = 5.02
    sz = -3.05
    frame.block((sx, 1.12, sz - 0.96), (0.44, 2.18, 0.065), 0.006)
    frame.block((sx, 1.12, sz + 0.96), (0.44, 2.18, 0.065), 0.006)
    frame.block((sx, 1.12, sz), (0.42, 2.18, 0.055), 0.005)
    for y_shelf in (0.14, 0.62, 1.12, 1.62, 2.16):
        frame.block((sx, y_shelf, sz), (0.44, 0.046, 1.98), 0.005)
    red_trim.block((sx - 0.21, 2.16, sz), (0.024, 0.075, 2.02), 0.004)
    # 书架内叠放的线装档案卷宗与粗布包袱
    for layer_y, z_offs in (
        (0.68, (-0.70, -0.34, 0.28, 0.68)),
        (1.18, (-0.64, -0.22, 0.34, 0.72)),
        (1.68, (-0.56, 0.42)),
    ):
        for idx, zo in enumerate(z_offs):
            stack_h = 0.09 + (idx % 3) * 0.045
            paper_scroll.block((sx - 0.03, layer_y + stack_h / 2, sz + zo),
                               (0.28, stack_h, 0.24), 0.005)
    cloth_bundle.block((sx - 0.02, 0.29, sz - 0.48), (0.30, 0.22, 0.42), 0.028)
    cloth_bundle.block((sx - 0.02, 1.76, sz + 0.72), (0.28, 0.16, 0.34), 0.024)

    # 3. 北墙大号木轴战略挂图框（x=1.55, y=1.64, z=-5.27；画芯由 world.js 动态挂贴）
    mx, my, mz = 1.55, 1.64, -5.27
    frame.block((mx, my + 0.68, mz), (1.84, 0.055, 0.055), 0.012)
    frame.block((mx, my - 0.68, mz), (1.84, 0.062, 0.062), 0.014)
    for side in (-1, 1):
        gold_trim.block((mx + side * 0.94, my + 0.68, mz), (0.055, 0.064, 0.064), 0.012)
        gold_trim.block((mx + side * 0.94, my - 0.68, mz), (0.062, 0.072, 0.072), 0.014)
    fittings.block((mx, my + 0.84, mz - 0.01), (0.032, 0.032, 0.032), 0.006)

    # 4. 西墙条案（x=-3.91, z=-4.7）台面上精确落位放置瓷茶壶、茶盏与文书卷（严丝合缝零浮空）
    ty = console_top - 0.003
    ceramics.block((-4.22, ty + 0.075, -4.68), (0.14, 0.15, 0.14), 0.035)
    ceramics.block((-4.02, ty + 0.032, -4.62), (0.065, 0.065, 0.065), 0.016)
    ceramics.block((-3.92, ty + 0.032, -4.74), (0.065, 0.065, 0.065), 0.016)
    paper_scroll.block((-3.58, ty + 0.031, -4.68), (0.32, 0.062, 0.24), 0.006)
    cloth_bundle.block((-3.56, ty + 0.062 + 0.019, -4.69), (0.28, 0.038, 0.20), 0.010)


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

    # 东西南三面院墙青瓦双坡墙帽（取代扁平木条，显著提升建筑完整度）
    for wall_x in (-5.47, 5.47):
        rims.block((wall_x, 2.86, 0.17), (0.14, 0.14, 11.65), 0.018)
        for side in (-1, 1):
            pans.block((wall_x + side * 0.18, 2.75, 0.17), (0.34, 0.065, 11.68), 0.008,
                       transform=lambda p, wx=wall_x, s=side: (p[0], p[1] - abs(p[0] - wx) * 0.36, p[2]))
    # 南院墙青瓦压顶
    rims.block((0.0, 2.02, 5.81), (11.25, 0.14, 0.14), 0.018)
    for side in (-1, 1):
        pans.block((0.0, 1.92, 5.81 + side * 0.18), (11.28, 0.065, 0.34), 0.008,
                   transform=lambda p, wz=5.81: (p[0], p[1] - abs(p[2] - wz) * 0.36, p[2]))

    # 封堵左院墙顶与廊檐斜坡空隙
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

    # 主屋正脊与两侧翘尾吻兽简化轮廓
    for i in range(41):
        rims.block((-5.72 + i * 0.285, 3.869, -3.05), (0.283, 0.128, 0.184), 0.029)
    for end_x in (-5.84, 5.84):
        rims.block((end_x, 4.02, -3.05), (0.22, 0.28, 0.22), 0.024)
    for x in (-4.84, -2.52, 0.6, 2.23, 4.68):
        frame.block((x, 2.78, -0.61), (0.176, 0.257, 0.52), 0.011)
        wear.block((x, 2.747, -0.43), (0.228, 0.084, 0.288), 0.008)

    # 院外黔北邻屋重檐与马头墙远景（适度拉开距离融入雾霭，不压迫主院）
    neighbors = [
        # (center_x, center_z, width, depth, wall_h, roof_h)
        (-11.4, -3.4, 5.2, 10.4, 4.4, 1.25),
        (11.6, -2.6, 5.4, 11.2, 4.3, 1.2),
        (-1.6, -12.8, 16.5, 5.8, 4.9, 1.35),
        (10.6, 8.8, 6.2, 5.2, 3.6, 1.05),
        (-10.4, 8.6, 5.8, 5.6, 3.8, 1.1),
    ]
    for nx, nz, nw, nd, wh, rh in neighbors:
        distant_wall.block((nx, wh / 2 - 0.1, nz), (nw, wh, nd), 0.02)
        # 邻屋二层暗朱红木栏带与窗格暗示
        red_trim.block((nx, wh - 1.15, nz + (nd / 2 + 0.04 if nz < 0 else -nd / 2 - 0.04)),
                       (nw * 0.72, 0.42, 0.08), 0.008)
        # 双坡青瓦屋顶与正脊
        rims.block((nx, wh + rh + 0.08, nz), (nw + 0.7, 0.18, 0.22), 0.02)
        for side in (-1, 1):
            pans.block((nx, wh + rh * 0.48, nz + side * (nd * 0.27)),
                       (nw + 0.85, 0.12, nd * 0.58), 0.01,
                       transform=lambda p, zc=nz, d=nd, r=rh: (p[0], p[1] - abs(p[2] - zc) / (d * 0.54) * r + r * 0.48, p[2]))
        # 两侧马头墙阶梯山墙
        for sx in (-1, 1):
            distant_wall.block((nx + sx * (nw / 2 + 0.08), wh + 0.55, nz), (0.22, 1.35, nd + 0.2), 0.012)
            rims.block((nx + sx * (nw / 2 + 0.08), wh + 1.25, nz), (0.34, 0.10, nd + 0.34), 0.012)

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
    min_z, max_z = min(v.z for v in coordinates), max(v.z for v in coordinates)
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
    return 0.004 + (max_z - min_z) * scale


courtyard()
planked_floor()
entry()
console_top = place_console()
indoor_furnishing(console_top)
ceramic_roof()

frame.object("门窗与檐下木构")
wear.object("木作边缘、窗格内层")
red_trim.object("黔北暗朱红栏板与挂落")
fittings.object("窗铰门环与灯具五金")
gold_trim.object("匾额与挂轴金饰")
step_stone.object("磨损石门槛与柱脚")
paper_scroll.object("档案卷宗堆叠")
cloth_bundle.object("靛青布包")
ceramics.object("青瓷茶器")
distant_wall.object("远景黔北民居粉墙")
for i, parts in enumerate(wall_bricks):
    parts.object(f"墙角与洞口 · 青砖 {i + 1}")
save_and_export("遵义材料厅", out, editable)
