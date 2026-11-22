"""线装手记的书衣、四眼线脚、四十八张纸叶和可翻封面。"""

from collections import defaultdict
from math import cos, exp, sin, tau
from pathlib import Path
from random import Random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refine_mesh import Parts, blender_point, surface


out, editable = map(Path, sys.argv[sys.argv.index("--") + 1:])
bpy.ops.wm.read_factory_settings(use_empty=True)
rng = Random(19350115)
paper_source = out.parent / "model-refine" / "ambientcg-paper001"
paper_normal = paper_source / "Paper001_1K-JPG_NormalGL.jpg"
paper_rough = paper_source / "Paper001_1K-JPG_Roughness.jpg"


def paper(name, image, normal=paper_normal, strength=0.20):
    return surface(name, (0.64, 0.56, 0.41), 0.92, {
        "Base Color": out / (image + ".jpg"), "Normal": normal, "Roughness": paper_rough,
    }, normal_strength=strength)


outer = paper("书衣 · 青灰旧纸及编纹", "folio-cover", out / "coarse-cloth-normal.jpg", 0.33)
lining = paper("封面内沿 · 压实旧纸", "folio-lining")
plate = paper("贴签 · 会前手记", "folio-label", strength=0.12)
contents = paper("卷首 · 会前形势", "folio-reading", strength=0.11)
edge_mats = [surface("纸叶切边 · " + name, color, 0.96) for name, color in [
    ("灰黄", (0.61, 0.511, 0.341)), ("原纸", (0.69, 0.584, 0.405)),
    ("麦色", (0.66, 0.55, 0.35)), ("压紧", (0.559, 0.464, 0.315)),
]]
thread = surface("装订麻线 · 蜜灰", (0.56, 0.431, 0.264), 0.9)
holes = surface("针孔内壁 · 受压纸纤维", (0.103, 0.070, 0.045), 0.97)
corner = paper("书衣包角 · 磨亮起毛", "folio-cover", out / "coarse-cloth-normal.jpg", 0.47)


def empty(name, where=(0, 0, 0), parent=None):
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = blender_point(where)
    return obj


def placed(batch, name, parent, *, smooth=False):
    model = batch.object(name, smooth=smooth)
    model.parent = parent
    return model


notebook = empty("notebook")
hinge_x = -0.139
hinge = empty("cover-pivot", (hinge_x, 0.0204, 0), notebook)
cover_left, cover_right = 0, 0.305
end = 0.212


def cover_surface(x, z):
    u = x / cover_right
    v = abs(z) / end
    bent_edge = max(0, (u - 0.77) / 0.23) ** 2 * max(0, (v - 0.79) / 0.21) ** 2
    crease = 0.0008 * exp(-((x - 0.023) / 0.009) ** 2) * (0.65 + 0.35 * cos(z * 15))
    return 0.0011 + 0.0047 * bent_edge + crease + 0.0005 * u * sin(11 * z + 7 * x)


def curved_panel(batch, bounds, height, nx=34, nz=42, downward=False, uv=None):
    x0, x1, z0, z1 = bounds
    points, faces = [], []
    for j in range(nz + 1):
        t = j / nz
        z = z0 + (z1 - z0) * t
        for i in range(nx + 1):
            u = i / nx
            x = x0 + (x1 - x0) * u
            if i in (0, nx):
                x += (0.0006 * cos(87 * z + 3 * u) + 0.00045 * sin(136 * z)) * u
            if j in (0, nz):
                z_frame = z + u * (0.00056 * sin(163 * x + t) + 0.0006 * cos(77 * x))
            else:
                z_frame = z
            points.append((x, height(x, z_frame), z_frame))
            n = len(points) - 1
            if i and j:
                part = (n - nx - 2, n - 1, n, n - nx - 1)
                faces.append(tuple(reversed(part)) if downward else part)
    batch.mesh(points, faces, uv or (lambda p: ((p[0] - x0) / (x1 - x0), (z1 - p[2]) / (z1 - z0))))
    border = [*range(nx + 1)]
    border += [j * (nx + 1) + nx for j in range(1, nz + 1)]
    border += [nz * (nx + 1) + i for i in range(nx - 1, -1, -1)]
    border += [j * (nx + 1) for j in range(nz - 1, 0, -1)]
    return [points[i] for i in border]


cover = Parts(outer)
bound = (cover_left, cover_right, -end, end)
rim = curved_panel(cover, bound, cover_surface)
placed(cover, "notebook-cover", hinge, smooth=True)
inside = Parts(lining)
curved_panel(inside, bound, lambda x, z: cover_surface(x, z) - 0.00162, 22, 32, downward=True)
placed(inside, "封面内衬", hinge, smooth=True)
binding_edge = Parts(edge_mats[3])
lower = [(x, y - 0.00162, z) for x, y, z in rim]
for i in range(len(rim)):
    j = (i + 1) % len(rim)
    binding_edge.mesh([lower[i], lower[j], rim[j], rim[i]], [(0, 1, 2, 3)])
placed(binding_edge, "封皮厚边", hinge)

for sign in (-1, 1):
    patch = Parts(corner)
    limits = (-0.005, 0.028, -end, -end + 0.051) if sign < 0 else (-0.005, 0.028, end - 0.051, end)
    curved_panel(patch, limits, lambda x, z: cover_surface(x, z) + 0.00043, 5, 8)
    placed(patch, "封角补片", hinge, smooth=True)

label = Parts(plate)
curved_panel(label, (0.216, 0.278, -0.169, -0.010),
             lambda x, z: cover_surface(x, z) + 0.00058 + 0.00044 * exp(-((x - 0.278) / 0.01) ** 2), 10, 20)
placed(label, "贴签 · 纸边", hinge, smooth=True)

leaf_objects = defaultdict(list)
leaf_count = 48
for i in range(leaf_count):
    y = 0.00220 + i * 0.000323
    width = 0.317 + rng.uniform(-0.0020, 0.0018)
    depth = 0.408 + rng.uniform(-0.0020, 0.0024)
    drift = 0.0012 * sin(i * 0.43)
    ring = []
    for j in range(32):
        angle = tau * j / 32
        u, v = cos(angle), sin(angle)
        round_shape = max(abs(u), abs(v))
        x = width * 0.5 * u / round_shape * 0.994 + 0.00038 * sin(47 * angle + i * 0.27) + drift
        z = depth * 0.5 * v / round_shape * 0.997 + 0.00042 * sin(31 * angle + i * 0.33)
        lip = 0.00038 * sin(9 * angle + i * 0.29)
        lift = 0.00104 * max(0, u) ** 12 * max(0, -v) ** 3 * (i / 47) ** 4
        ring.append((x, y + lip + lift, z))
    kind = (i * 5 + i // 7) % len(edge_mats)
    part = Parts(edge_mats[kind])
    # 各叶边缘有实体厚度，装订边同轴齐平。
    part.prism([[(x, yy - 0.000249, z) for x, yy, z in ring], ring])
    obj = placed(part, f"纸叶 {i + 1:02d}", notebook)
    leaf_objects[kind].append(obj)

bottom_cover = Parts(outer)
bottom_cover.block((0, 0.0008, 0), (0.333, 0.0015, 0.422), 0.00045)
placed(bottom_cover, "底书衣", notebook)
slip = Parts(lining)
curved_panel(slip, (0.076, 0.174, 0.085, 0.177),
             lambda x, z: 0.0056 + 0.0021 * max(0, (x - 0.123) / 0.051) ** 2, 8, 12)
placed(slip, "夹入的散页", notebook, smooth=True)

sheet = Parts(contents)
curved_panel(sheet, (-0.1375, 0.1575, -0.199, 0.200),
             lambda x, z: 0.01875 + 0.00245 * max(0, x / 0.1575) ** 8 * max(0, -z / 0.199) ** 3
             + 0.00028 * sin(15 * z + 6 * x), 32, 37)
placed(sheet, "reading-page", notebook, smooth=True)

stations = [-0.156, -0.052, 0.052, 0.156]
strip, bore = Parts(outer), Parts(holes)
limits = [-end, -0.104, 0, 0.104, end]
top = 0.0210
for zc, za, zb in zip(stations, limits[:-1], limits[1:]):
    xc = -0.1535
    a, b, edge = [], [], []
    for n in range(16):
        a0 = tau * (n + 0.5) / 16
        u, v = cos(a0), sin(a0)
        tx = ((-0.139 - xc) if u > 0 else (xc + 0.170)) / abs(u)
        tz = ((zb - zc) if v > 0 else (zc - za)) / abs(v)
        t = min(tx, tz)
        a.append((xc + u * t, top, zc + v * t))
        b.append((xc + u * 0.0017, top, zc + v * 0.0017))
        edge.append((xc + u * 0.0017, top - 0.00125, zc + v * 0.0017))
    for n in range(16):
        k = (n + 1) % 16
        strip.mesh([a[k], a[n], b[n], b[k]], [(0, 1, 2, 3)],
                   lambda p: ((p[0] + 0.170) / 0.329, (end - p[2]) / (2 * end)))
        bore.mesh([b[n], b[k], edge[k], edge[n]], [(0, 1, 2, 3)])

placed(strip, "固定书脊 · 实穿针孔", notebook)
placed(bore, "四眼 · 孔壁", notebook)
stitches = Parts(thread)


def cord(points, radius=0.00086):
    positions, faces = [], []
    n = 9
    for i, p in enumerate(points):
        p = Vector(p)
        tangent = Vector(points[min(len(points) - 1, i + 1)]) - Vector(points[max(0, i - 1)])
        axis = tangent.normalized()
        other = axis.cross(Vector((0, 0, 1)))
        if other.length_squared < 0.001:
            other = axis.cross(Vector((1, 0, 0)))
        u = other.normalized()
        v = axis.cross(u)
        for j in range(n):
            a = tau * j / n
            positions.append(tuple(p + (cos(a) * u + sin(a) * v) * radius))
            if i:
                k = i * n
                j1 = (j + 1) % n
                faces.append((k - n + j, k - n + j1, k + j1, k + j))
    stitches.mesh(positions, faces)


for z in stations:
    cord([(-0.1535, top - 0.0008, z), (-0.157, top + 0.0014, z),
          (-0.169, top + 0.00115, z + 0.0009), (-0.1707, 0.019, z + 0.0014),
          (-0.1709, 0.0078, z + 0.0011), (-0.168, -0.00005, z + 0.0008),
          (-0.155, -0.0001, z + 0.0002)])
for z1, z2 in zip(stations, stations[1:]):
    cord([(-0.1535, top + 0.0008, z1), (-0.1529, top + 0.00112, (z1 + z2) / 2),
          (-0.1535, top + 0.0008, z2)], 0.00072)
cord([(-0.1699, 0.005, stations[-1] + 0.001), (-0.1713, 0.008, stations[-1] + 0.0034),
      (-0.1708, 0.011, stations[-1] - 0.0018), (-0.1703, 0.0089, stations[-1] - 0.0021)], 0.001)
placed(stitches, "穿线、过背与线结", notebook, smooth=True)

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(editable / "线装手记.blend"))

# 可编辑工程保留全部单独纸叶，课件按材质合批。
for kind, objects in leaf_objects.items():
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = objects[0]
    for item in objects:
        item.select_set(True)
    bpy.ops.object.join()
    bpy.context.object.name = f"纸叶外缘 · {kind + 1}"
bpy.ops.export_scene.gltf(filepath=str(out / "线装手记.glb"), export_format="GLB", export_yup=True)
