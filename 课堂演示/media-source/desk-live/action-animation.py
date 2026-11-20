"""把成片的封面姿态存成原生绝对形态键，再在独立 Blender 进程逐帧验收。"""

import json
from pathlib import Path
import runpy
import sys

import bpy
import numpy as np


RIG = runpy.run_path(str(Path(__file__).with_name("action-cycles.py")))


def packed_images():
    images = [im for im in bpy.data.images if im.source == "FILE"]
    if not images or bpy.data.libraries or any(not im.packed_file or not im.packed_file.size for im in images):
        raise ValueError("原工程的贴图或外链库不满足独立打开条件")
    return {im.name: im.packed_file.size for im in images}


def bake(scene, cover, info, sequence, path):
    packed_images()
    if cover.data.shape_keys:
        raise ValueError("源封面已有形态键，请检查输入工程")
    rest = RIG["coordinates"](cover)
    bpy.context.view_layer.objects.active = cover
    cover.select_set(True)
    basis = cover.shape_key_add(name="闭合 · 原封面", from_mix=False)
    keys = cover.data.shape_keys
    keys.name = "左册翻阅"
    keys.use_relative = False
    basis.interpolation = "KEY_LINEAR"
    for pose in range(1, info["last_pose"] + 1):
        block = cover.shape_key_add(name=f"翻起 {pose:02d}", from_mix=False)
        block.interpolation = "KEY_LINEAR"
        block.data.foreach_set("co", RIG["bend"](rest, info["hinge_local_x_m"], pose).ravel())
    bpy.ops.object.shape_key_retime()
    times = [block.frame for block in keys.key_blocks]
    if any(b <= a for a, b in zip(times, times[1:])):
        raise ValueError("绝对形态键时间未递增")

    for i, pose in enumerate(sequence):
        # 停留段只在两端落键，便于教师移动时间轴上的停留时长。
        if 0 < i < len(sequence)-1 and sequence[i-1] == pose == sequence[i+1]:
            continue
        keys.eval_time = times[pose]
        keys.keyframe_insert(data_path="eval_time", frame=i+1, group="封面弯曲")

    verso = scene.objects["露出书口 30"]
    if verso.parent != cover.parent:
        raise ValueError("封里材质与原册不符")
    cover.data.materials.append(verso.data.materials[0])
    thickness = cover.modifiers["纸厚"]
    original_offset = thickness.material_offset
    for i, pose in enumerate(sequence):
        if i == 0 or bool(pose) != bool(sequence[i-1]):
            thickness.material_offset = 1 if pose else original_offset
            thickness.keyframe_insert(data_path="material_offset", frame=i+1, group="封里纸材")
    # 在 4.5 中物体和 Key 可以共用一个动作，曲线分属各自的槽位。
    # 整数材质索引须到翻起的那一帧才切换，不能在两个键之间取整。
    for owner, interpolation in ((keys, "LINEAR"), (cover, "CONSTANT")):
        animation = owner.animation_data
        animation.action.name = "左册翻阅"
        channelbag = animation.action.layers[0].strips[0].channelbag(animation.action_slot)
        for curve in channelbag.fcurves:
            for point in curve.keyframe_points:
                point.interpolation = interpolation
            curve.update()
    cover.active_shape_key_index = 0
    cover.show_only_shape_key = False
    scene.render.fps, scene.render.fps_base = 24, 1
    scene.frame_start, scene.frame_end = 1, len(sequence)
    scene.use_preview_range = False
    scene.sync_mode = "FRAME_DROP"
    scene.render.resolution_x, scene.render.resolution_y = info["frame_size"]
    scene.render.resolution_percentage = 100
    scene.render.use_border = False
    scene.render.filepath = "//../../.march-build/desk-live/action/editable-frames/desk-"
    last = info["last_pose"]
    markers = [(1, "闭合"), (sequence.index(1)+1, "翻起"), (sequence.index(last)+1, "停留"),
               (sequence.index(last)+sequence.count(last)+1, "放回"),
               (len(sequence) - sequence[::-1].index(1) + 1, "合拢")]
    for frame, name in markers:
        scene.timeline_markers.new(name, frame=frame)
    scene.frame_set(1)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(path), compress=True, relative_remap=False)


def verify(scene, cover, info, sequence, cache, work):
    if bpy.app.autoexec_fail or scene.frame_current != 1 or scene.frame_end != len(sequence):
        raise ValueError("工程未在首帧打开，或需要自动执行脚本")
    if (scene.frame_start, scene.render.fps, scene.render.fps_base) != (1, 24, 1):
        raise ValueError("原生时间轴不符合成片时基")
    if scene.render.use_border or [scene.render.resolution_x, scene.render.resolution_y] != info["frame_size"]:
        raise ValueError("动画工程画幅不符")
    images = packed_images()
    keys = cover.data.shape_keys
    if keys.use_relative or len(keys.key_blocks) != info["last_pose"] + 1 or not keys.animation_data.action:
        raise ValueError("封面绝对形态键或原生动作丢失")
    if keys.animation_data.drivers or cover.animation_data.drivers:
        raise ValueError("封面预览依赖驱动")
    # 只在此次只读验收中隔离形态键控制笼，以便与渲染时的同一批原网格顶点对照。
    thickness = cover.modifiers["纸厚"]
    if not thickness.show_render or not thickness.show_viewport:
        raise ValueError("工程未启用原纸厚")
    thickness.show_viewport = False
    graph = bpy.context.evaluated_depsgraph_get()
    camera = scene.camera
    w, h = info["frame_size"]
    projection = np.array(camera.calc_matrix_camera(graph, x=w, y=h) @ camera.matrix_world.inverted())
    with np.load(cache / "projection.npz") as data:
        rendered_pixels, faces = data["pixels"], data["faces"]
    rest = RIG["coordinates"](cover)
    hinge = info["hinge_local_x_m"]
    expected = [RIG["bend"](rest, hinge, i) for i in range(info["last_pose"] + 1)]
    locked = rest[:, 0] <= hinge
    stride = int(faces[0, 3] - faces[0, 0])
    row = (len(rest) // stride // 2) * stride
    tip = row + stride - 1
    spine = row + int(np.flatnonzero(locked[row:row+stride])[-1])
    max_error = max_screen = max_lock = 0.0
    probes = []
    for frame, pose in enumerate(sequence, 1):
        scene.frame_set(frame)
        evaluated = cover.evaluated_get(graph)
        actual = RIG["coordinates"](evaluated)
        world = RIG["transform"](np.array(evaluated.matrix_world), actual)
        screen = RIG["project"](projection, world)
        max_screen = max(max_screen, float(np.linalg.norm(screen - rendered_pixels[pose], axis=1).max()))
        max_error = max(max_error, float(np.linalg.norm(actual - expected[pose], axis=1).max()))
        max_lock = max(max_lock, float(np.linalg.norm((actual-rest)[locked], axis=1).max()))
        if evaluated.modifiers["纸厚"].material_offset != int(pose != 0):
            raise ValueError(f"第 {frame} 帧封里材质与实渲不一致")
        if frame in (1, 36, 72, 108, 144):
            probes.append({"frame": frame, "pose": pose, "spine_local_m": actual[spine].tolist(),
                           "free_edge_local_m": actual[tip].tolist(),
                           "free_edge_lift_m": float(actual[tip, 2] - rest[tip, 2])})
    if max_error > 2e-6 or max_screen > 0.002 or max_lock > 1e-7 or probes[2]["free_edge_lift_m"] < 0.15:
        raise ValueError(f"形态键与成片顶点不符 {max_error=} {max_screen=} {max_lock=}")
    thickness.show_viewport = True
    box = json.loads((cache / "crop.json").read_text(encoding="utf-8"))["render_box"]
    RIG["set_border"](scene, box, 2)
    scene.cycles.samples = 16
    scene.cycles.use_animated_seed = False
    scene.render.use_persistent_data = True
    for frame in (1, 72, 144):
        scene.frame_set(frame)
        scene.render.filepath = str(work / f"native-{frame:03d}.png")
        bpy.ops.render.render(write_still=True)
    report = {
        "source_mesh": cover.name, "camera": camera.name, "native_shape_keys_including_basis": len(keys.key_blocks),
        "action": keys.animation_data.action.name, "frame_range": [1, len(sequence)], "fps": scene.render.fps,
        "packed_image_bytes": images, "external_libraries": len(bpy.data.libraries),
        "verification_autoexec_disabled": True, "frames_evaluated": len(sequence),
        "max_mesh_error_m": max_error, "max_projected_error_px_vs_movie_geometry": max_screen,
        "max_spine_displacement_m": max_lock, "spine_vertex_index": spine, "free_edge_vertex_index": tip,
        "vertices_per_frame": len(rest), "vertex_probes": probes,
    }
    (work / "animation-validation.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"逐帧复核通过 {len(sequence)} 帧，最大顶点偏差 {max_error:.9f} 米", flush=True)


def main():
    mode, folder, candidate = sys.argv[sys.argv.index("--") + 1:]
    work, path = Path(folder), Path(candidate)
    movie = json.loads((work / "validation.json").read_text(encoding="utf-8"))
    cache = work / movie["geometry_and_light_cache"]
    info = json.loads((cache / "geometry.json").read_text(encoding="utf-8"))
    sequence = movie["frame_to_pose"]
    scene = bpy.context.scene
    cover = scene.objects[RIG["COVER"]]
    if scene.camera.name != info["camera"]:
        raise ValueError("动画工程机位与成片不符")
    if mode == "bake":
        bake(scene, cover, info, sequence, path)
    elif mode == "verify":
        verify(scene, cover, info, sequence, cache, work)
    else:
        raise ValueError(mode)


if __name__ == "__main__":
    main()
