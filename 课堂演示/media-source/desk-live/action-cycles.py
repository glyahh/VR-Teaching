"""render_action.py 调用的 Blender 后台进程。在内存中弯曲原封面网格。"""

import argparse
import json
import math
import sys
import time
from pathlib import Path

import bpy
import numpy as np


WIDTH, HEIGHT = 1280, 720
LAST = 45
CAMERA = "机位一 · 桌边全景"
COVER = "线装手记 · 封面"


def coordinates(obj):
    points = np.empty(len(obj.data.vertices) * 3, np.float32)
    obj.data.vertices.foreach_get("co", points)
    return points.reshape(-1, 3)


def transform(matrix, points):
    return points @ matrix[:3, :3].T + matrix[:3, 3]


def project(matrix, world):
    clip = world @ matrix[:, :3].T + matrix[:, 3]
    ndc = clip[:, :2] / clip[:, 3:4]
    return ((ndc * [0.5, -0.5] + 0.5) * [WIDTH, HEIGHT]).astype(np.float32)


def bend(rest, hinge, pose):
    if pose == 0:
        return rest.copy()
    # 沿纸面弧长积分切线。窄装订带保持原位，翻页初段由外角带起。
    progress = (1 - math.cos(math.pi * pose / LAST)) / 2
    x, y, z = rest.astype(np.float64).T
    distance = np.maximum(x - hinge, 0)
    width = distance.max()
    along = (y - y.min()) / np.ptp(y)

    def angle(s, along):
        u = s / width
        curl = 144 - 31 * u**1.5 + 10 * np.sin(math.pi * u)
        lead = (1 - progress) * (94 * (u - 0.5) + 31 * (0.5 - along))
        degrees = progress * (curl + lead + 5 * (0.5 - along) * u)
        return np.deg2rad(degrees) * (-np.expm1(-s / 0.011))

    # 中点积分保持横跨封面的纸长，也保留原网格磨损、缺口与折角的起伏。
    count = 48
    steps = distance[:, None] * ((np.arange(count) + 0.5) / count)
    tangents = angle(steps, along[:, None])
    tip = angle(distance, along)
    spine_z = np.median(z[np.abs(x - hinge) < 0.004])
    grain = z - spine_z
    result = rest.copy()
    moving = distance > 0
    result[moving, 0] = (hinge + distance * np.cos(tangents).mean(axis=1) - grain * np.sin(tip))[moving]
    result[moving, 2] = (spine_z + distance * np.sin(tangents).mean(axis=1) + grain * np.cos(tip))[moving]
    return result


def shadow_receivers(points, lamps, bounds):
    # 将光源中心和发光面的四角穿过纸面，截到原桌的侧边或牙板下沿。
    # 灯芯可能低于抬起的封面。这种光线只截在侧边，不除以近零高度。
    lo, hi = bounds
    hits = []
    for lamp in lamps:
        matrix = np.array(lamp.matrix_world)
        centers = [matrix[:3, 3]]
        if lamp.data.type == "AREA":
            half_x = lamp.data.size * 0.5
            half_y = (lamp.data.size_y if lamp.data.shape == "RECTANGLE" else lamp.data.size) * 0.5
            for a, b in [(-1, -1), (-1, 1), (1, -1), (1, 1)]:
                centers.append(centers[0] + matrix[:3, 0] * a * half_x + matrix[:3, 1] * b * half_y)
        for center in centers:
            direction = points - center
            destination = np.where(direction > 0, hi, lo)
            travel = np.divide(destination - points, direction, out=np.full_like(points, np.inf),
                               where=np.abs(direction) > 1e-8).min(axis=1)
            hits.append(points + np.maximum(travel, 0)[:, None] * direction)
    return np.concatenate(hits)


def geometry(scene, cover, rest, hinge, work):
    camera = scene.camera
    projection = np.array(camera.calc_matrix_camera(bpy.context.evaluated_depsgraph_get(),
                                                    x=WIDTH, y=HEIGHT) @ camera.matrix_world.inverted())
    local_to_world = np.array(cover.matrix_world)
    faces = np.array([tuple(poly.vertices) for poly in cover.data.polygons], dtype=np.int32)
    fixed = rest[:, 0] <= hinge
    body = []
    shadows = []
    diagnostics = []
    boards = [obj for obj in scene.objects if obj.name.startswith("磨旧桌板")]
    rails = [obj for obj in scene.objects if obj.name.startswith("长牙板")]
    boards_xyz = np.concatenate([transform(np.array(o.matrix_world), np.array(o.bound_box)) for o in boards])
    rail_floor = min(transform(np.array(o.matrix_world), np.array(o.bound_box))[:, 2].min() for o in rails)
    lo, hi = boards_xyz.min(axis=0), boards_xyz.max(axis=0)
    lo[2], hi[2] = rail_floor, 2.9
    lamps = [obj for obj in scene.objects if obj.type == "LIGHT"]
    for pose in range(LAST + 1):
        points = bend(rest, hinge, pose)
        world = transform(local_to_world, points)
        body.append(project(projection, world))
        diagnostics.append({
            "spine_max_displacement_m": float(np.linalg.norm((points - rest)[fixed], axis=1).max()),
            "max_lift_m": float((points[:, 2] - rest[:, 2]).max()),
        })
        if pose in (0, 12, 23, 30, 37, LAST):
            shadows.append(project(projection, shadow_receivers(world[::29], lamps, (lo, hi))))
    all_pixels = np.concatenate([*body, *shadows])
    low = np.maximum(0, np.floor((all_pixels.min(axis=0) - 24) / 4) * 4)
    high = np.minimum([WIDTH, HEIGHT], np.ceil((all_pixels.max(axis=0) + 24) / 4) * 4)
    box = [int(v) for v in (*low, *high)]
    np.savez_compressed(work / "projection.npz", pixels=body, faces=faces)
    info = {
        "camera": camera.name, "lens_mm": camera.data.lens, "object": cover.name,
        "vertices": len(rest), "fixed_vertices": int(fixed.sum()), "hinge_local_x_m": hinge,
        "last_pose": LAST, "frame_size": [WIDTH, HEIGHT], "survey_box": box,
        "light_objects": [lamp.name for lamp in lamps], "poses": diagnostics,
    }
    (work / "geometry.json").write_text(json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8")
    return box


def set_border(scene, box, divisor):
    left, top, right, bottom = box
    render = scene.render
    render.resolution_x, render.resolution_y = WIDTH // divisor, HEIGHT // divisor
    render.resolution_percentage = 100
    render.use_border = render.use_crop_to_border = True
    # Blender 对浮点像素边界向下取整；四分之一像素余量避免少取一行。
    def edge(value, dimension):
        return min(1.0, (value + 0.25 * divisor) / dimension)
    render.border_min_x, render.border_max_x = edge(left, WIDTH), edge(right, WIDTH)
    render.border_min_y, render.border_max_y = edge(HEIGHT - bottom, HEIGHT), edge(HEIGHT - top, HEIGHT)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("survey", "render"))
    parser.add_argument("work", type=Path)
    parser.add_argument("--poses", type=int, nargs="+")
    parser.add_argument("--samples", type=int, default=32)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    work = args.work.resolve()
    work.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    cover = scene.objects[COVER]
    if scene.camera.name != CAMERA or scene.render.engine != "CYCLES":
        raise RuntimeError("输入工程的主相机或渲染器不符")
    if (scene.render.resolution_x, scene.render.resolution_y) != (1920, 1080):
        raise RuntimeError("原主视图画幅不符")
    rest = coordinates(cover)
    holes = [obj for obj in cover.parent.children if obj.name.startswith("针孔")]
    hinge = max(obj.location.x for obj in holes) + 0.003
    if len(holes) != 5 or not np.any(rest[:, 0] <= hinge):
        raise RuntimeError("找不到原封面五个针孔的固定带")

    if args.stage == "survey":
        box = geometry(scene, cover, rest, hinge, work)
        poses = [0, 15, 25, 33, LAST]
        set_border(scene, box, 2)
    else:
        box = json.loads((work / "crop.json").read_text(encoding="utf-8"))["render_box"]
        poses = args.poses if args.poses is not None else range(LAST + 1)
        set_border(scene, box, 1)

    # 原网格上表面、纸厚、UV 均保留。翻过来的封里用同册内页的未印字纸材。
    verso = scene.objects["露出书口 30"]
    if verso.parent != cover.parent:
        raise RuntimeError("封里材质来自另一册")
    cover.data.materials.append(verso.data.materials[0])
    thickness = cover.modifiers["纸厚"]
    original_offset = thickness.material_offset
    scene.cycles.device = "CPU"
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.cycles.use_animated_seed = False
    scene.render.use_persistent_data = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    folder = work / args.stage
    folder.mkdir(exist_ok=True)
    print(f"{args.stage} | border {box} | {args.samples} spp", flush=True)
    for pose in poses:
        destination = folder / f"{pose:02d}.png"
        if destination.is_file():
            continue
        thickness.material_offset = 1 if pose else original_offset
        points = bend(rest, hinge, pose)
        cover.data.vertices.foreach_set("co", points.ravel())
        cover.data.update()
        bpy.context.view_layer.update()
        temporary = folder / f"{pose:02d}.partial.png"
        scene.render.filepath = str(temporary)
        started = time.monotonic()
        bpy.ops.render.render(write_still=True)
        temporary.replace(destination)
        print(f"{args.stage} pose={pose:02d} seconds={time.monotonic()-started:.2f}", flush=True)


if __name__ == "__main__":
    main()
