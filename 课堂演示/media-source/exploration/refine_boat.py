"""制作于都船型的教学模型，中心、吃水和长度沿用河岸舞台。"""

from math import pi, sin
from pathlib import Path
import sys

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refine_mesh import Parts, blender_point, maps, save_and_export, surface


out, editable = map(Path, sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
finish = surface("灰褐旧船木 · 丝缕顺船身", (0.33, 0.24, 0.16), 0.83, maps(out, "river-timber"), normal_strength=0.48)
trim = surface("船框旧木 · 边缘磨损", (0.25, 0.16, 0.079), 0.88,
               {"Normal": out / "river-timber-normal.jpg"})
peg = surface("旧铁与木楔", (0.069, 0.045, 0.027), 0.83, metal=0.28)
lumber, rims, pins = Parts(finish), Parts(trim), Parts(peg)
length = 5.82
outer = [(0, -0.394), (0.22, -0.375), (0.55, -0.309), (0.77, -0.20), (0.905, -0.068),
         (1, 0.163)]


def shape(t):
    return 0.82 * max(0.012, sin(pi * t)) ** (0.68 if t < 0.55 else 0.83) * (1 - 0.10 * (t - 0.5))


def plank_surface(t, part, side, inner=False):
    z, y = part
    sheer = (0.166 if t > 0.5 else 0.115) * (abs(2 * t - 1) ** 4)
    x = length * (t - 0.5)
    if inner:
        z, y = z * 0.935, y + 0.036 * (1 - z) + 0.006
    return x, y + sheer, side * z * shape(t)


def plank(side, band, low, high):
    n = max(6, round((high - low) * 50))
    lo, hi = outer[band:band + 2]
    # 交错的板缝保留真实边界，艏艉所有板收进共同的端木。
    gap = 0.006
    bounds = [(lo[0] + gap * (hi[0] - lo[0]), lo[1] + gap * (hi[1] - lo[1])),
              (hi[0] - gap * (hi[0] - lo[0]), hi[1] - gap * (hi[1] - lo[1]))]
    points = []
    for k in range(n + 1):
        t = low + (high - low) * k / n
        points.extend(plank_surface(t, p, side, inner) for inner in (False, True) for p in bounds)
    profile = (0, 1, 3, 2)
    faces = [profile, tuple((4 * n + i) for i in reversed(profile))]
    for i in range(n):
        for a, b in zip(profile, [*profile[1:], profile[0]]):
            here = i * 4
            faces.append((here + b, here + a, here + 4 + a, here + 4 + b))
    if side > 0:
        faces = [tuple(reversed(row)) for row in faces]
    strip = (0.042, 0.174, 0.304, 0.415, 0.515)[band]
    lumber.mesh(points, faces,
                lambda p: (strip + 0.05 * (p[1] - lo[1]) / (hi[1] - lo[1]), (p[0] + 2.91) / 2.70 + 0.11))


def rail(side):
    points = []
    n = 64
    for i in range(n + 1):
        t = 0.007 + i / n * 0.986
        x, y, z = plank_surface(t, (1, 0.163), side)
        points.extend([(x, y - 0.024, z - side * 0.047), (x, y - 0.024, z + side * 0.017),
                       (x, y + 0.021, z + side * 0.012), (x, y + 0.021, z - side * 0.037)])
    faces = [(0, 1, 2, 3), tuple(n * 4 + j for j in (3, 2, 1, 0))]
    for i in range(n):
        for j in range(4):
            a, b = i * 4 + j, i * 4 + (j + 1) % 4
            faces.append((b, a, a + 4, b + 4))
    if side < 0:
        faces = [tuple(reversed(face)) for face in faces]
    rims.mesh(points, faces)


def rib(x):
    t = x / length + 0.5
    profile = [(-z, y) for z, y in reversed(outer[1:])] + outer
    points = []
    for z, y in profile:
        width = shape(t)
        _, yy, _ = plank_surface(t, (abs(z), y), 1, True)
        z *= width * 0.925
        points.extend([(x - 0.038, yy + 0.009, z), (x + 0.038, yy + 0.009, z),
                       (x + 0.034, yy + 0.073 * (1 - abs(z) * 0.40), z * 0.94),
                       (x - 0.034, yy + 0.073 * (1 - abs(z) * 0.40), z * 0.94)])
    faces = [tuple(range(4)), tuple(reversed(range(len(points) - 4, len(points))))]
    for i in range(len(profile) - 1):
        for j in range(4):
            a, b = i * 4 + j, i * 4 + (j + 1) % 4
            faces.append((b, a, a + 4, b + 4))
    rims.mesh(points, faces)
    for side in (-1, 1):
        _, y, z = plank_surface(t, (0.81, -0.16), side, True)
        pins.block((x, y + 0.034, z * 0.955), (0.029, 0.014, 0.026), 0.003)


for side in (-1, 1):
    rail(side)
    for band in range(5):
        seam = 0.41 + (band % 3) * 0.083 + side * 0.01
        plank(side, band, 0, seam - 0.0007)
        plank(side, band, seam + 0.0007, 1)

for x in (-2.14, -1.63, -1.09, -0.57, -0.034, 0.53, 1.08, 1.60, 2.12):
    rib(x)
for x in (-1.46, -0.06):
    rims.block((x, 0.059, 0), (0.264, 0.055, 1.72 * shape(x / length + 0.5)), 0.008)
for i, z in enumerate((-0.245, -0.123, 0, 0.124, 0.247)):
    lumber.block((-0.41, -0.149 + (i % 2) * 0.002, z), (3.20, 0.050, 0.114), 0.005,
                 uv=lambda p: (0.274 + p[2] * 0.19 + 0.10 * i, p[0] / 2.9))

# 船头站立面、对合端木以及座板木销保留各自的体积。
for i in range(5):
    x = 1.35 + 0.183 * i
    lumber.block((x, -0.055, 0), (0.177, 0.057, 1.37 * shape(x / length + 0.5)), 0.007,
                 uv=lambda p: (0.10 + 0.20 * (p[0] - x) + i * 0.075, p[2] / 1.9))
for side in (-1, 1):
    rims.block((side * 2.789, 0.087, 0), (0.19, 0.178, 0.114), 0.02)
    for x in (-1.46, -0.06):
        pins.block((x, 0.086, side * 0.45), (0.025, 0.009, 0.022), 0.003)

lumber.object("船壳逐条拼板、舱底铺板", smooth=True)
rims.object("厚船舷、横肋和船头端木")
pins.object("可见船钉与木楔")
anchor = bpy.data.objects.new("bow-footing", None)
anchor.location = blender_point((1.74, -0.0265, 0))
bpy.context.collection.objects.link(anchor)
save_and_export("于都木船", out, editable)
