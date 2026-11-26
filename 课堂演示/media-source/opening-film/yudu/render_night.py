"""Render the original Yudu night crossing with captured, contact-corrected walkers."""

from argparse import ArgumentParser
import json
from math import sin
from pathlib import Path
import sys
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
from night_motion import NightCast, WalkingSurface, arrange
from render import FPS, FRAMES, animate_camera, configure, encode, lantern, point_camera, props, shore_lamps
from river_scene import SceneMaterials, build_bridges, landscape, make_water, plant_banks, skies


def options():
    parser = ArgumentParser(description=__doc__)
    parser.set_defaults(shot='night')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--assets', type=Path, default=HERE.parents[2] / 'assets' / 'yudu-river')
    parser.add_argument('--cast', type=Path, default=HERE.parent / 'cast')
    parser.add_argument('--frame', type=int, nargs='+', help='Zero-based frames for a still preview.')
    parser.add_argument('--preview-first', action='store_true')
    parser.add_argument('--matched', action='store_true')
    parser.add_argument('--grip-review', type=int, help='Diagnostic camera in front of a numbered pack wearer.')
    parser.add_argument('--measure-only', action='store_true')
    parser.add_argument('--size', type=int, default=100)
    parser.add_argument('--samples', type=int, default=8)
    return parser.parse_args(sys.argv[sys.argv.index('--') + 1:])


def render_from_common(args):
    args.output = args.output.resolve()
    assets = args.assets.resolve()
    cast_path = args.cast.resolve()
    if (cast_path / 'performance').is_dir():
        cast_path /= 'performance'
    performer = cast_path / 'performer-final.glb'
    if not performer.is_file():
        raise FileNotFoundError(performer)
    frames_dir = args.output / 'night-frames'
    frames_dir.mkdir(parents=True, exist_ok=True)
    count = FRAMES['night']
    matched = args.matched
    grip_review = getattr(args, 'grip_review', None)
    if grip_review is not None and (not args.frame or not 1 <= grip_review <= 18):
        raise ValueError('--grip-review needs an explicit --frame and an actor number from 1 through 18.')
    frames = args.frame or ([30] if matched else list(range(count)))
    if any(frame not in range(count) for frame in frames):
        raise ValueError('A frame is outside the source.')
    if args.preview_first and not args.frame and not matched:
        early = [0, 22, 45, 68]
        frames = [*early, *(frame for frame in frames if frame not in early)]

    scene = configure(args)
    materials = SceneMaterials(assets)
    bank_reference = assets.parent / 'yudu-bank.jpg' if not matched else None
    bank_camera = landscape(materials, not matched, bank_reference)
    branches = plant_banks(materials, not matched)
    _, hulls = build_bridges(materials, assembling=False)
    bpy.context.view_layer.update()
    floor_surface = WalkingSurface(scene)
    ripple, reflected_camera = make_water(materials, hulls, True)
    cloud = skies(scene, True, bank_reference)
    lit = shore_lamps(materials, True)
    props(materials)
    carried_lamp = lantern('Partly shaded lamp carried by a guide', (0, 0, 0), materials, .35, .052)
    lit.append(carried_lamp)
    people = arrange(NightCast(performer, cast_path), carried_lamp[0], floor_surface)
    diagnostics, render_seconds = [], []
    for frame in frames:
        mark = time.monotonic()
        time_s = frame / FPS
        scene.frame_set(frame + 1)
        animate_camera(scene.camera, 'night', frame, matched)
        planned = [person.at(time_s) for person in people]
        if grip_review is not None:
            walker = people[grip_review - 1].actor
            point_camera(scene.camera, walker.ob.location + Vector((-1.27, 1.90, 1.24)),
                         walker.ob.location + Vector((0, 0, 1.08)), 58)
        for coordinate, socket in zip(scene.camera.location, reflected_camera):
            socket.default_value = coordinate
        if bank_camera is not None:
            for coordinate, socket in zip(scene.camera.location, bank_camera):
                socket.default_value = coordinate

        offsets = [{'l': 0.0, 'r': 0.0} for person in people]
        for _ in range(2):
            bpy.context.view_layer.update()
            graph = bpy.context.evaluated_depsgraph_get()
            errors = [person.align_feet(plans, graph, shift)
                      for person, (plans, _), shift in zip(people, planned, offsets)]

        for index, (_, intensity, glow, weight) in enumerate(lit):
            wave = 1 + .119 * sin(time_s * 9.2 + index) + .071 * sin(time_s * 21.4 + .5 * index)
            intensity.default_value = 2.9 * weight * wave
            glow.energy = 23 * weight * wave
        ripple[0].default_value = (-.094 * time_s, .021 * time_s, 0)
        ripple[1].default_value = (.061 * time_s + .27, -.047 * time_s - .22, 0)
        cloud.default_value = (.0021 * time_s, 0, 0)
        for branch, yaw, phase in branches:
            branch.rotation_euler.z = yaw + .010 * sin(.83 * time_s + phase)

        bpy.context.view_layer.update()
        graph = bpy.context.evaluated_depsgraph_get()
        motions = [person.inspect(plans, hands, error, graph)
                   for person, (plans, hands), error in zip(people, planned, errors)]
        for walker, motion in zip(people[:8], motions[:8]):
            actor = walker.actor
            joints = ('pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
                      *(f'{joint}_{side}' for side in 'lr' for joint in
                        ('clavicle', 'upperarm', 'lowerarm', 'hand', 'middle_02', 'thigh', 'calf', 'foot', 'ball')))
            motion['pixels'] = {name: list(world_to_camera_view(scene, scene.camera,
                                      actor.local_to_world(actor.pose[name].translation))) for name in joints}
        diagnostics.append({'frame': frame, 'camera': list(scene.camera.location),
                            'lens': scene.camera.data.lens, 'cast': motions})
        if not args.measure_only:
            prefix = 'matched-' if matched else ''
            scene.render.filepath = str(frames_dir / f'{prefix}{frame:04d}.png')
            bpy.ops.render.render(write_still=True)
            render_seconds.append(round(time.monotonic() - mark, 3))
            print(f'night {frame + 1}/{count} saved in {render_seconds[-1]} s', flush=True)
    if args.frame is None and not args.measure_only and not matched:
        encode(args, frames_dir)
    suffix = '-matched' if matched else ('-stills' if args.frame else '')
    report = {'shot': 'night', 'frames': len(frames), 'fps': FPS, 'size_percent': args.size,
              'floor_reference': 'visible bridge planks, shore landing boards and terrain meshes',
              'samples': args.samples, 'render_seconds_per_frame': render_seconds,
              'contacts': sorted(diagnostics, key=lambda x: x['frame'])}
    (args.output / f'night{suffix}-metrics.json').write_text(json.dumps(report, ensure_ascii=False, indent=2),
                                                            encoding='utf-8')


if __name__ == '__main__':
    render_from_common(options())
