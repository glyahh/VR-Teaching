"""Render the 134-frame crossing shot with Blender 4.5 LTS."""

import argparse
import json
import math
from pathlib import Path
import subprocess
import sys
import time

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
sys.path.insert(1, str(HERE.parent / "yudu"))

from people import animate_crowd, final_specs, frozen_waders, make_waders, matched_specs
from river import Rain, WaterMarks, add_bank, add_overcast, add_water, lerp, place_bank_details, place_ridges, smoothstep
from wading import SleeveAssist

FPS = 24
SHOT_FRAMES = round(43.30 * FPS) - round(38.20 * FPS) + 12
BASELINE_FRAME = 76
BASELINE_PROGRESS = lerp(0.14, 0.94, BASELINE_FRAME / 172)
ASSETS = HERE.parents[2] / "assets" / "yudu-river"


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cast-assets", type=Path, default=HERE.parent / "cast" / "performance",
                        help="Shared full performer GLB and source-UV skin textures.")
    parser.add_argument("--rig", type=Path, help="Use the editable Blender character source for the distant procession.")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--fixed", action="store_true", help="Render the fixed baseline camera and troop placement.")
    mode.add_argument("--preview", nargs="+", type=int, metavar="FRAME")
    mode.add_argument("--kinematics", action="store_true", help="Measure poses without rendering.")
    check_view = parser.add_mutually_exclusive_group()
    check_view.add_argument("--baseline-camera", action="store_true",
                            help="Use the original 44° camera for stills. Requires --preview.")
    check_view.add_argument("--contact-camera", action="store_true",
                            help="Render a closer view for checking palm and sleeve. Requires --preview.")
    parser.add_argument("--resolution", default=100, type=int)
    parser.add_argument("--samples", default=6, type=int)
    parser.add_argument("--last-frame", default=SHOT_FRAMES - 1, type=int)
    parser.add_argument("--blend", type=Path, help="Save the first posed frame and packed textures as an editable Blender project.")
    parser.add_argument("--clip", type=Path, help="Encode the completed PNG sequence to this MP4.")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if not 0 <= args.last_frame < SHOT_FRAMES or (args.preview and not all(0 <= f < SHOT_FRAMES for f in args.preview)):
        parser.error(f"Frame numbers must be in 0–{SHOT_FRAMES - 1}.")
    if (args.baseline_camera or args.contact_camera) and not args.preview:
        parser.error("Comparison cameras require --preview.")
    if args.clip and (args.fixed or args.preview or args.kinematics or args.last_frame != SHOT_FRAMES - 1
                      or args.resolution != 100):
        parser.error("--clip requires all 134 frames at 1280×720.")
    args.output = args.output.resolve()
    if args.blend:
        args.blend = args.blend.resolve()
    if args.clip:
        args.clip = args.clip.resolve()
    return args


def smoother(value):
    t = min(1, max(0, value))
    return t * t * t * (t * (t * 6 - 15) + 10)


def project_three(position):
    x, height, z = position
    return Vector((x, -z, height))


def camera_pose(camera, frame, matched):
    if matched:
        blend = smoother(BASELINE_FRAME / 172 / 0.62)
        eye = project_three([lerp(x, y, blend) for x, y in zip((21.0, 18.5, 31.0), (-12.5, 4.2, 13.8))])
        look = project_three([lerp(x, y, blend) for x, y in zip((-1.0, 1.0, -4.0), (2.4, 0.9, -4.2))])
        fov = 44.0
    else:
        t = frame / (SHOT_FRAMES - 1)
        eye = Vector((-5.09 - 2.08 * t, -7.26 + 0.20 * t, 2.14 - 0.27 * smoothstep(t, 0.0, 0.76)))
        look = Vector((0.09 - 1.54 * t, -1.10 + 0.12 * t, 0.88 + 0.08 * smoothstep(t, 0.70, 1)))
        fov = 36.9
    camera.location = eye
    camera.rotation_euler = (look - eye).to_track_quat("-Z", "Y").to_euler()
    camera.data.sensor_fit = "VERTICAL"
    camera.data.lens = camera.data.sensor_height / (2 * math.tan(math.radians(fov / 2)))
    return tuple(eye), tuple(look), fov


def build_scene(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.eevee.taa_render_samples = args.samples
    scene.eevee.use_raytracing = False
    scene.eevee.shadow_pool_size = "256"
    scene.eevee.shadow_step_count = 3
    scene.render.use_persistent_data = True
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = args.resolution
    scene.render.fps = FPS
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 17
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -0.32
    scene.frame_start = 0
    scene.frame_end = args.last_frame

    camera_data = bpy.data.cameras.new("湘江涉水取景")
    camera_data.clip_start = 0.20
    camera_data.clip_end = 240
    camera = bpy.data.objects.new("湘江涉水取景", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    add_overcast(scene, HERE / "overcast-soil-1k.hdr")
    add_bank(ASSETS, args.fixed)
    place_ridges(ASSETS.parent / "xiang.png", args.fixed or args.baseline_camera)
    place_bank_details(ASSETS, args.fixed)
    water_clock = add_water()
    specs = matched_specs(BASELINE_PROGRESS) if args.fixed else final_specs()
    frozen = frozen_waders(ASSETS, specs) if args.fixed else None
    cast, rest = ([], None) if args.fixed else make_waders(ASSETS, specs, args.rig, args.cast_assets)
    wakes = WaterMarks(2 * len(specs))
    rain = Rain()
    assist = SleeveAssist(cast[:2]) if cast else None
    return scene, camera, water_clock, cast, rest, wakes, rain, frozen, assist


def detail_camera(camera, assist):
    lead = assist.probe.rig
    elbow = lead.matrix_world @ lead.pose.bones["lowerarm_l"].head
    wrist = lead.matrix_world @ lead.pose.bones["hand_l"].head
    look = elbow.lerp(wrist, .38) + Vector((.067, -.057, .100))
    camera.location = look + Vector((-.73, -1.73, .53))
    camera.rotation_euler = (look - camera.location).to_track_quat("-Z", "Y").to_euler()


def main():
    args = parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    print(f"[SETUP] {args.output}", flush=True)
    started = time.perf_counter()
    scene, camera, clock, cast, rest, wakes, rain, frozen, assist = build_scene(args)
    print(f"[SETUP] {len(cast)} armatures, {time.perf_counter() - started:.2f} s", flush=True)
    checks = {}

    def pose(frame):
        eye, look, fov = camera_pose(camera, frame, args.fixed or args.baseline_camera)
        seconds = frame / FPS
        clock.default_value = seconds
        diagnostics = {}
        if args.fixed:
            states = frozen
        else:
            near_wakes, diagnostics = assist.pose(seconds)
            states = near_wakes + animate_crowd(cast[2:], rest, seconds)
        wakes.set(states, seconds)
        rain.set(seconds, camera)
        checks[frame] = {"camera": {"eye": eye, "target": look, "vertical_fov": fov},
                         "legs_in_water": sum(p is not None for pair in states for p, _, _ in pair),
                         **diagnostics}
        print(f"[FRAME] {frame:03d} {time.perf_counter() - started:.2f} s", flush=True)

    sample = set(args.preview or [BASELINE_FRAME]) if args.preview or args.fixed else None
    sequence = [BASELINE_FRAME] if args.fixed else range(max(sample)+1 if sample else args.last_frame+1)
    save_frame = BASELINE_FRAME if args.fixed else args.preview[0] if args.preview else 0
    for frame in sequence:
        scene.frame_set(frame)
        pose(frame)
        if args.blend and frame == save_frame:
            args.blend.parent.mkdir(parents=True, exist_ok=True)
            bpy.ops.file.pack_all()
            bpy.ops.wm.save_as_mainfile(filepath=str(args.blend), copy=True)
        if args.kinematics or (sample is not None and frame not in sample):
            continue
        if args.contact_camera:
            detail_camera(camera, assist)
        prefix = "fixed-new" if args.fixed else "fixed-cast" if args.baseline_camera else "sleeve" if args.contact_camera else "shot"
        filename = f"{prefix}-{frame:03d}.png" if sample else f"crossing-{frame:04d}.png"
        scene.render.filepath = str(args.output / filename)
        bpy.ops.render.render(write_still=True)
    info = {"frame_count": SHOT_FRAMES, "fps": FPS, "render_seconds": round(time.perf_counter() - started, 3),
            "mode": "kinematics" if args.kinematics else "fixed" if args.fixed else "preview" if args.preview else "shot",
            "resolution_percent": args.resolution, "samples": args.samples,
            "baseline": {"frame": BASELINE_FRAME, "progress": BASELINE_PROGRESS}, "frames": checks}
    if args.baseline_camera:
        info["mode"] = "fixed-cast"
    if args.contact_camera:
        info["mode"] = "sleeve"
    (args.output / (info["mode"] + ".json")).write_text(json.dumps(info, indent=2), encoding="utf-8")
    if args.clip:
        args.clip.parent.mkdir(parents=True, exist_ok=True)
        pending = args.clip.with_suffix(".part.mp4")
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                        "-framerate", str(FPS), "-start_number", "0", "-i", str(args.output / "crossing-%04d.png"),
                        "-vf", "scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
                        "-frames:v", str(SHOT_FRAMES), "-c:v", "libx264", "-preset", "fast",
                        "-threads", "4", "-crf", "17", "-colorspace", "bt709",
                        "-color_primaries", "bt709", "-color_trc", "bt709", "-an",
                        "-movflags", "+faststart", str(pending)], check=True)
        pending.replace(args.clip)


if __name__ == "__main__":
    main()


