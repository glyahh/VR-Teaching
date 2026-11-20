"""Blender 4.5 后台入口。-- 后传入 --scene、--assets、--out。

默认输出 896×504 的 17 个机位及 4 秒短片。--preview 只输出平放和翻起两张 PNG。
"""

import argparse
import json
import math
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector


YAWS = tuple(range(-32, 33, 4))
FPS = 24
FRAME_COUNT = FPS * 4
STRIPS = 40


def arguments():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scene", type=Path, required=True)
    parser.add_argument("--assets", type=Path, help="默认使用 scene.json 所在目录")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--width", type=int, default=896)
    parser.add_argument("--samples", type=int, default=32)
    parser.add_argument("--ffmpeg", default="ffmpeg")
    parser.add_argument("--preview", action="store_true")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if args.width <= 0 or args.width % 32 or args.samples < 1:
        parser.error("宽度须为 32 的正倍数，采样数须为正整数")
    return args


def blender_xyz(point):
    coord_x, coord_y, coord_z = point
    return Vector((coord_x, -coord_z, coord_y))


def linear_rgba(hex_color):
    def linear(value):
        channel_value = int(value, 16) / 255
        return channel_value / 12.92 if channel_value <= 0.04045 else ((channel_value + 0.055) / 1.055) ** 2.4

    return tuple(linear(hex_color[index:index + 2]) for index in (1, 3, 5)) + (1.0,)


def make_material(key, spec, assets):
    material = bpy.data.materials.new(key)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    shader = nodes.get("Principled BSDF")
    color = linear_rgba(spec["color"])
    shader.inputs["Base Color"].default_value = material.diffuse_color = color
    shader.inputs["Roughness"].default_value = spec.get("roughness", 0.76)
    if key == "brass":
        shader.inputs["Metallic"].default_value = 0.72
    if key in {"porcelain", "tea"}:
        shader.inputs["Coat Weight"].default_value = 0.30
        shader.inputs["Coat Roughness"].default_value = 0.17
    if key in {"linen", "cloth"}:
        shader.inputs["Sheen Weight"].default_value = 0.20
    if key in {"paper", "leaf", "pageTop"}:
        shader.inputs["Specular IOR Level"].default_value = 0.22
    shader.inputs["Emission Color"].default_value = color
    shader.inputs["Emission Strength"].default_value = spec.get("emission", 0.0)

    texture = spec.get("texture")
    if texture:
        image = nodes.new("ShaderNodeTexImage")
        image.image = bpy.data.images.load(str((assets / texture).resolve()), check_existing=True)
        surface = image.outputs["Color"]
        if color != (1, 1, 1, 1):
            tint = nodes.new("ShaderNodeMixRGB")
            tint.blend_type = "MULTIPLY"
            tint.inputs[0].default_value = 1
            tint.inputs[2].default_value = color
            links.new(surface, tint.inputs[1])
            surface = tint.outputs[0]
        if key == "leaf":
            paper_back = nodes.new("ShaderNodeMixRGB")
            paper_back.inputs[2].default_value = linear_rgba("#d9c6a0")
            back_weight = nodes.new("ShaderNodeMath")
            back_weight.operation = "MULTIPLY"
            back_weight.inputs[1].default_value = 0.80
            links.new(nodes.new("ShaderNodeNewGeometry").outputs["Backfacing"], back_weight.inputs[0])
            links.new(back_weight.outputs[0], paper_back.inputs[0])
            links.new(surface, paper_back.inputs[1])
            surface = paper_back.outputs[0]
        links.new(surface, shader.inputs["Base Color"])
        if Path(texture).name in {"wood.jpg", "wall.jpg"}:
            bump = nodes.new("ShaderNodeBump")
            bump.inputs["Strength"].default_value = 0.20
            bump.inputs["Distance"].default_value = 0.002
            links.new(image.outputs["Color"], bump.inputs["Height"])
            links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return material


def mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def make_box(name, size, wood):
    width, height, depth = size
    coord_x, coord_y, coord_z = width / 2, depth / 2, height / 2
    vertices = [(-coord_x, -coord_y, -coord_z), (coord_x, -coord_y, -coord_z), (coord_x, coord_y, -coord_z), (-coord_x, coord_y, -coord_z),
                (-coord_x, -coord_y, coord_z), (coord_x, -coord_y, coord_z), (coord_x, coord_y, coord_z), (-coord_x, coord_y, coord_z)]
    faces = [(4, 5, 6, 7), (0, 1, 5, 4), (2, 3, 7, 6), (1, 2, 6, 5),
             (3, 0, 4, 7), (3, 2, 1, 0)]
    obj = mesh_object(name, vertices, faces)
    uv_layer = obj.data.uv_layers.new()
    for poly in obj.data.polygons:
        first_corner, second_corner, _, fourth_corner = (obj.data.vertices[index].co for index in poly.vertices)
        across, up = (second_corner - first_corner).length, (fourth_corner - first_corner).length
        for loop, (across_uv, depth_uv) in zip(poly.loop_indices, ((0, 0), (1, 0), (1, 1), (0, 1))):
            if wood:
                if up > across:
                    across_uv, depth_uv = depth_uv * up / 2.56, (1 - across_uv) * across / 1.34
                else:
                    across_uv, depth_uv = across_uv * across / 2.56, depth_uv * up / 1.34
            uv_layer.data[loop].uv = (across_uv, depth_uv)
    return obj


def make_node(node, materials, specs):
    name, kind, size, key = (node[key_name] for key_name in ("id", "kind", "size", "material"))
    width, height, depth = size
    if kind == "box":
        wood = Path(specs[key].get("texture", "")).name == "wood.jpg"
        obj = make_box(name, size, wood)
    else:
        if kind == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=0.5, depth=1)
        elif kind == "sphere":
            bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, radius=0.5)
        else:
            raise ValueError(f"未知几何类型 {name}: {kind}")
        obj = bpy.context.object
        obj.name = name
        obj.data.transform(Matrix.Diagonal((width, depth, height, 1)))
        for face in obj.data.polygons:
            face.use_smooth = kind == "sphere" or len(face.vertices) == 4
    if kind != "sphere":
        bevel = obj.modifiers.new("棱边圆角", "BEVEL")
        bevel.width = min(0.008, min(size) * 0.09)
        bevel.segments = 3
        bevel.harden_normals = True
        normals = obj.modifiers.new("平面法线", "WEIGHTED_NORMAL")
        normals.keep_sharp = True
    obj.location = blender_xyz(node["pos"])
    obj.rotation_euler.z = math.radians(node.get("rotY", 0))
    obj.data.materials.append(materials[key])
    return obj


def leaf_coords(spec, phase_value):
    theta = 1.95 * math.sin(math.pi * phase_value) ** 2
    cosine, sine = math.cos(theta), math.sin(theta)
    vertices = []
    for index in range(STRIPS + 1):
        across_uv = index / STRIPS
        reach = spec["width"] * across_uv
        rise = (reach + 0.022 * math.sin(math.pi * across_uv)) * sine
        for depth_uv in (0, 1):
            vertices.append((reach * cosine, spec["depth"] * (0.5 - depth_uv), rise))
    return vertices


def make_leaf(spec, material):
    faces = [(index, index + 1, index + 3, index + 2) for index in range(0, 2 * STRIPS, 2)]
    obj = mesh_object("活动书页", leaf_coords(spec, 0), faces)
    obj.location = blender_xyz(spec["hinge"])
    obj.data.materials.append(material)
    uv_layer = obj.data.uv_layers.new()
    for poly in obj.data.polygons:
        poly.use_smooth = True
        for loop in poly.loop_indices:
            index = obj.data.loops[loop].vertex_index
            uv_layer.data[loop].uv = ((index // 2) / STRIPS, 1 - index % 2)
    return obj


def camera_pose(camera, spec, yaw):
    yaw, pitch = math.radians(yaw), math.radians(spec["pitch"])
    orbit = blender_xyz((math.sin(yaw) * math.cos(pitch), math.sin(pitch),
                         math.cos(yaw) * math.cos(pitch)))
    target = blender_xyz(spec["target"])
    camera.location = target + spec["radius"] * orbit
    camera.rotation_euler = (-orbit).to_track_quat("-Z", "Y").to_euler()


def make_scene(spec, assets, width, samples):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = samples
    scene.eevee.shadow_ray_count = 3
    scene.eevee.use_shadows = True
    scene.render.resolution_x, scene.render.resolution_y = width, width * 9 // 16
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.render.dither_intensity = 0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 18
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.35
    scene.world = bpy.data.worlds.new("室内环境")
    scene.world.use_nodes = True
    ambient = scene.world.node_tree.nodes.get("Background")
    ambient.inputs["Color"].default_value = (0.27, 0.31, 0.35, 1)
    ambient.inputs["Strength"].default_value = 0.25

    specs = dict(spec["materials"])
    specs.setdefault("leaf", {"color": "#ffffff", "texture": "leaf.jpg"})
    materials = {key: make_material(key, value, assets) for key, value in specs.items()}
    for node in spec["nodes"]:
        obj = make_node(node, materials, specs)
        if node["material"] == "flame":
            light = bpy.data.lights.new("灯焰反光", "POINT")
            light.energy, light.color = 6, (1, 0.47, 0.15)
            light.shadow_soft_size, light.use_shadow = 0.042, False
            practical = bpy.data.objects.new(light.name, light)
            scene.collection.objects.link(practical)
            practical.location = obj.location
    leaf = make_leaf(spec["object"], materials["leaf"])
    target = blender_xyz(spec["camera"]["target"])
    for role, strength, diameter, color in (
        ("key", 23, 1.10, (1, 0.82, 0.64)),
        ("fill", 11, 1.55, (0.68, 0.80, 1)),
    ):
        light = bpy.data.lights.new(role, "AREA")
        lamp = bpy.data.objects.new(role, light)
        scene.collection.objects.link(lamp)
        lamp.location = blender_xyz(spec["lighting"][role])
        to_target = target - lamp.location
        light.energy = strength * to_target.length_squared
        light.shape, light.size, light.color = "DISK", diameter, color
        light.use_shadow_jitter = True
        lamp.rotation_euler = to_target.to_track_quat("-Z", "Y").to_euler()

    lens = bpy.data.cameras.new("固定垂直视场")
    lens.sensor_fit = "VERTICAL"
    lens.lens = lens.sensor_height / (2 * math.tan(math.radians(spec["camera"]["fov"]) / 2))
    lens.clip_start, lens.clip_end = 0.015, 80
    camera = bpy.data.objects.new("相机", lens)
    scene.collection.objects.link(camera)
    scene.camera = camera
    return scene, camera, leaf


def calibration(scene, camera, spec):
    obj = spec["object"]
    coord_x, coord_y, coord_z = obj["hinge"]
    far, near, edge = coord_z - obj["depth"] / 2, coord_z + obj["depth"] / 2, coord_x + obj["width"]
    world = {"spine": (coord_x, coord_y, coord_z), "tip": (edge, coord_y, near), "back": (edge, coord_y, far),
             "table": (0.75, 0.80, 0.58), "hingeNear": (coord_x, coord_y, near), "hingeFar": (coord_x, coord_y, far)}
    views = []
    for yaw in YAWS:
        camera_pose(camera, spec["camera"], yaw)
        bpy.context.view_layer.update()
        uv = {}
        for name, point in world.items():
            projected = world_to_camera_view(scene, camera, blender_xyz(point))
            uv[name] = [round(projected.x, 9), round(1 - projected.y, 9)]
        views.append({"yaw": yaw, "points": {key_name: uv[key_name] for key_name in ("spine", "tip", "back", "table")},
                      "corners": {key_name: uv[key_name] for key_name in ("hingeNear", "tip", "back", "hingeFar")}})
    return {"views": views}


def set_pose(camera, leaf, spec, yaw, phase_value):
    camera_pose(camera, spec["camera"], yaw)
    for vertex, co in zip(leaf.data.vertices, leaf_coords(spec["object"], phase_value)):
        vertex.co = co
    leaf.data.update()


def render_sequence(scene, camera, leaf, spec, work):
    shots = [(yaw, 0.0) for yaw in YAWS if yaw]
    shots.extend((0, index / (FRAME_COUNT - 1)) for index in range(FRAME_COUNT // 2))

    def on_frame(current_scene, *_):
        set_pose(camera, leaf, spec, *shots[current_scene.frame_current])

    scene.frame_start, scene.frame_end = 0, len(shots) - 1
    scene.render.filepath = str(work / "pose-####.png")
    bpy.app.handlers.frame_change_pre.append(on_frame)
    try:
        scene.frame_set(0)
        bpy.ops.render.render(animation=True)
    finally:
        bpy.app.handlers.frame_change_pre.remove(on_frame)


def encode(ffmpeg, work, media):
    def run(*args):
        subprocess.run([ffmpeg, "-hide_banner", "-loglevel", "error", "-nostdin", "-y",
                        *map(str, args)], check=True)

    sequence = work / "pose-%04d.png"
    angles = [yaw for yaw in YAWS if yaw]
    jpeg = ("-c:v", "mjpeg", "-q:v", "1", "-pix_fmt", "yuvj444p")
    run("-framerate", FPS, "-start_number", 0, "-i", sequence, "-frames:v", len(angles),
        *jpeg, "-start_number", 0, work / "still-%02d.jpg")
    for index, yaw in enumerate(angles):
        (work / f"still-{index:02}.jpg").replace(media / f"view-{YAWS.index(yaw):02}.jpg")
    shutil.copyfile(work / f"pose-{len(angles):04}.png", media / "gold.png")
    run("-i", media / "gold.png", "-frames:v", 1, *jpeg, media / "view-08.jpg")

    graph = ("[0:v]scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,split[up][copy];"
             "[copy]reverse[down];[up][down]concat=n=2:v=1:a=0[clip]")
    run("-framerate", FPS, "-start_number", len(angles), "-i", sequence,
        "-filter_complex", graph, "-map", "[clip]", "-frames:v", FRAME_COUNT, "-r", FPS,
        "-an", "-c:v", "libx264", "-preset", "medium", "-qp", 16, "-bf", 0, "-g", 48,
        "-sc_threshold", 0, "-forced-idr", 1, "-force_key_frames", f"expr:eq(n,{FRAME_COUNT - 1})",
        "-color_range", "tv", "-colorspace", "bt709", "-color_primaries", "bt709",
        "-color_trc", "iec61966-2-1", "-movflags", "+faststart", media / "clip.mp4")

    select = f"select='eq(n,0)+eq(n,{FRAME_COUNT - 1})',format=rgb24"
    run("-i", media / "clip.mp4", "-vf", select, "-fps_mode", "passthrough",
        "-frames:v", 2, "-start_number", 0, work / "decoded-%02d.png")
    for index, name in enumerate(("anchor.png", "tail.png")):
        (work / f"decoded-{index:02}.png").replace(media / name)


def main():
    args = arguments()
    start = time.perf_counter()
    spec = json.loads(args.scene.read_text(encoding="utf-8-sig"))
    out = args.out.resolve()
    out.mkdir(parents=True, exist_ok=True)
    ffmpeg = shutil.which(args.ffmpeg)
    if not args.preview and not ffmpeg:
        raise FileNotFoundError(f"未找到 FFmpeg: {args.ffmpeg}")
    scene, camera, leaf = make_scene(spec, args.assets or args.scene.parent, args.width, args.samples)
    if args.preview:
        for name, phase_value in (("flat", 0), ("raised", 0.5)):
            set_pose(camera, leaf, spec, 0, phase_value)
            scene.render.filepath = str(out / f"{name}.png")
            bpy.ops.render.render(write_still=True)
    else:
        coords = calibration(scene, camera, spec)
        with tempfile.TemporaryDirectory(prefix="blender-frames-", dir=out.parent) as directory:
            work = Path(directory)
            media = work / "media"
            media.mkdir()
            render_sequence(scene, camera, leaf, spec, work)
            print(f"Blender render: {time.perf_counter() - start:.1f} s", flush=True)
            encode(ffmpeg, work, media)
            (media / "calibration.json").write_text(json.dumps(coords, indent=2), encoding="utf-8")
            for file in media.iterdir():
                file.replace(out / file.name)
    print(f"Completed in {time.perf_counter() - start:.1f} s: {out}", flush=True)


if __name__ == "__main__":
    main()
