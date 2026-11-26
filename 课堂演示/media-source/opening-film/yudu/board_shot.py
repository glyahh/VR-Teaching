"""Rebuild the motion study with the source Yudu boat, door, lights and course camera."""

from argparse import ArgumentParser
import json
from math import isfinite, pi, sin
from pathlib import Path
import sys
import time

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent
COURSE = SOURCE.parents[1]
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
import render as yudu
from board_ik import GRASPS, Worker
from river_cast import Cast, skinned_material, soldier, textured_coat
from river_scene import (
    BEAM_Z, BRIDGE_X, DOOR_DEPTH, DOOR_SLOT_Y, DOOR_THICKNESS, HERO_HULL_Y,
    SceneMaterials, build_bridges, landscape, load_meshes, make_water, plant_banks, skies,
)


FRAMES = yudu.FRAMES['bridge']


def options():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--performer', type=Path, default=SOURCE / 'cast/performance/performer-final.glb')
    parser.add_argument('--grips', type=Path, default=HERE / 'board-grip.json')
    parser.add_argument('--cast', type=Path, default=SOURCE / 'cast')
    parser.add_argument('--assets', type=Path, default=COURSE / 'assets/yudu-river')
    parser.add_argument('--size', type=int, default=100)
    parser.add_argument('--samples', type=int, default=8)
    parser.add_argument('--frame', type=int, nargs='+')
    parser.add_argument('--view', choices=('course', 'front', 'side', 'hands'), default='course')
    parser.add_argument('--matched', action='store_true', help='Use the baseline orthographic camera for a still.')
    parser.add_argument('--measure-only', action='store_true')
    parser.add_argument('--save-scene', action='store_true')
    parser.add_argument('--save-deform', action='store_true', help='Keep an additional visually baked deformation action.')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.save_scene = args.save_scene or args.save_deform
    if args.frame and any(f not in range(FRAMES) for f in args.frame):
        parser.error(f'Frame must fall between 0 and {FRAMES - 1}.')
    if args.view != 'course' and args.frame is None:
        parser.error('Check views take explicit frame numbers.')
    args.output = args.output.resolve()
    args.performer = args.performer.resolve()
    return args


def make_performers(args, cast):
    skin_files = [args.cast / name for name in ('skin-middle.jpg', 'skin-young.jpg')]
    names = ('Villager at the stern', 'Worker at the bow')
    scales = (1.0, .963)
    templates = load_meshes(args.performer)
    template_rig = next(ob for ob in templates if ob.type == 'ARMATURE')
    models = [ob for ob in templates if ob.type == 'MESH' and ob.parent == template_rig]
    skin_files = [args.performer.with_name(path.name) if args.performer.with_name(path.name).is_file() else path
                  for path in skin_files]
    workers = []
    for i, name in enumerate(names):
        rig = template_rig.copy()
        rig.name = name
        rig.scale = (scales[i],) * 3
        bpy.context.collection.objects.link(rig)
        for model in models:
            if model.name.startswith('布帽') or (i == 0 and model.name.startswith('短发')):
                continue
            ob = model.copy()
            bpy.context.collection.objects.link(ob)
            ob.parent = rig
            for modifier in ob.modifiers:
                if modifier.type == 'ARMATURE':
                    modifier.object = rig
                    modifier.use_deform_preserve_volume = True
            ob.material_slots[0].link = 'OBJECT'
            material = model.data.materials[0]
            if 'MPFB' in model.name:
                ob.data = ob.data.copy()
                ob.material_slots[0].material = skinned_material(material, skin_files[i])
                if ob.data.shape_keys:
                    age = ob.data.shape_keys.key_blocks.get('面颊与下颌')
                    if age:
                        age.value = .85 if i == 0 else 0
            elif model.name.startswith('斜袖与立领上衣'):
                ob.material_slots[0].material = textured_coat(material, cast.palette[i][0])
            elif model.name.startswith('长裤'):
                ob.material_slots[0].material = textured_coat(material, cast.palette[i][1])
        if i == 0:
            previous = set(rig.children)
            cast.work_costume(rig, 'wrap', cast.palette[i][0], True)
            for ob in set(rig.children) - previous:
                if not ob.name.startswith(('Layered work headcloth', 'End of folded headcloth')):
                    bpy.data.objects.remove(ob, do_unlink=True)
        workers.append(rig)
    for ob in templates:
        bpy.data.objects.remove(ob, do_unlink=True)
    return workers


def plank_surfaces(door):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    vertices, faces = [], []
    for child in door.children:
        if not child.name.startswith('Unequal door leaf stave'):
            continue
        ob = child.evaluated_get(depsgraph)
        local = door.matrix_world.inverted() @ ob.matrix_world
        faces.extend(tuple(len(vertices) + v for v in p.vertices) for p in ob.data.polygons)
        vertices.extend(local @ v.co for v in ob.data.vertices)
    return BVHTree.FromPolygons(vertices, faces)


def check_camera(frame, view, door, camera):
    if view == 'front':
        return yudu.point_camera(camera, (3.04, HERO_HULL_Y - .90, 1.36),
                                 (6.53, HERO_HULL_Y + .13, .825), 42)
    if view == 'side':
        return yudu.point_camera(camera, (7.15, HERO_HULL_Y - 2.62, 1.10),
                                 (6.57, HERO_HULL_Y + .14, .73), 42)
    center = door.matrix_world @ Vector((1.39, -.14, -.055))
    return yudu.point_camera(camera, center + Vector((.53, -.92, .16)), center + Vector((.01, .02, 0)), 70)


def key_matrix_state(ob, frame):
    ob.keyframe_insert('location', frame=frame)
    ob.keyframe_insert('rotation_quaternion' if ob.rotation_mode == 'QUATERNION' else 'rotation_euler', frame=frame)
    ob.keyframe_insert('scale', frame=frame)


def key_arcs(scene, frame, door, reflected_camera, bank_camera, ripple, cloud, branches, lamps, far):
    for ob in (scene.camera, door):
        key_matrix_state(ob, frame)
    scene.camera.data.keyframe_insert('lens', frame=frame)
    for socket in (*ripple, *reflected_camera, *(bank_camera or []), cloud):
        socket.keyframe_insert('default_value', frame=frame)
    for branch, _, _ in branches:
        branch.keyframe_insert('rotation_euler', frame=frame)
    for _, intensity, glow, _ in lamps:
        intensity.keyframe_insert('default_value', frame=frame)
        glow.keyframe_insert('energy', frame=frame)
    key_matrix_state(far.ob, frame)
    for bone in far.ob.pose.bones:
        bone.keyframe_insert('location', frame=frame)
        bone.keyframe_insert('rotation_quaternion', frame=frame)


def save_deform(worker, snapshots):
    rig = worker.rig
    prior = rig.animation_data.action
    prior.name = f'{worker.label} · editable IK controls and finger joints'
    prior.use_fake_user = True
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        for constraint in bone.constraints:
            constraint.mute = True
    continuous = {}
    for frame, pose in enumerate(snapshots, 1):
        for bone in rig.pose.bones:
            name = bone.name
            if name not in pose:
                continue
            parent = bone.parent
            parent_space = ({'parent_matrix': pose[parent.name], 'parent_matrix_local': parent.bone.matrix_local}
                            if parent else {})
            basis = bone.bone.convert_local_to_pose(pose[name], bone.bone.matrix_local, invert=True, **parent_space)
            loc, quat, scale = basis.decompose()
            if name in continuous:
                quat.make_compatible(continuous[name])
            continuous[name] = quat.copy()
            bone.location, bone.rotation_quaternion, bone.scale = loc, quat, scale
            bone.keyframe_insert('location', frame=frame, group=name)
            bone.keyframe_insert('rotation_quaternion', frame=frame, group=name)
            bone.keyframe_insert('scale', frame=frame, group=name)
    baked = rig.animation_data.action
    baked.name = f'{worker.label} · constrained deformation baked at 24 fps'
    baked.use_fake_user = True
    rig.animation_data.action = prior
    for bone in rig.pose.bones:
        for constraint in bone.constraints:
            constraint.mute = False
    return baked.name


def render_from_common(args):
    args.performer = args.cast / 'performance/performer-final.glb'
    args.grips = HERE / 'board-grip.json'
    args.view = 'course'
    args.save_scene = False
    args.save_deform = False
    render(args)


def render(args):
    args.shot = 'bridge'
    args.output = args.output.resolve()
    profiles = json.loads(args.grips.read_text(encoding='utf-8'))
    if not isinstance(profiles, dict):
        raise ValueError(f"{args.grips}: expected named hand profiles")
    for worker in ('Stern', 'Bow'):
        if not isinstance(profiles.get(worker), dict):
            raise ValueError(f"{args.grips}: missing hand profiles for {worker}")
        for side in ('l', 'r'):
            hand = profiles.get(worker, {}).get(side)
            if (not isinstance(hand, list) or len(hand) != 21
                    or not all(type(v) in (int, float) and isfinite(v) for v in hand)):
                raise ValueError(f"{args.grips}: {worker}.{side} requires 6 placement and 15 finger coordinates")
    GRASPS.clear()
    GRASPS.update(profiles)
    args.output.mkdir(parents=True, exist_ok=True)
    scene = yudu.configure(args)
    scene.frame_end = FRAMES
    bpy.context.preferences.edit.keyframe_new_interpolation_type = 'LINEAR'
    materials = SceneMaterials(args.assets)
    photographic = not args.matched
    bank_reference = args.assets.parent / 'yudu-bank.jpg' if photographic else None
    bank_camera = landscape(materials, photographic)
    branches = plant_banks(materials, photographic)
    door, hulls = build_bridges(materials, assembling=True)
    ripple, reflected_camera = make_water(materials, hulls, False)
    cloud = skies(scene, False, bank_reference)
    lamps = yudu.shore_lamps(materials, False)
    yudu.props(materials)
    cast = Cast(materials, args.cast / 'workshirt.glb')
    far = cast.actor('Far bank crew', 2, .95, pack=2)
    workers = [Worker(rig, door, end) for rig, end in zip(make_performers(args, cast), (-1, 1))]
    cast.remove_templates()
    bpy.context.view_layer.update()
    wood = plank_surfaces(door)
    last = [None, None]
    if args.matched and args.frame is None:
        args.frame = [30]
    selected = set(args.frame if args.frame is not None else range(FRAMES))
    dirname = 'bridge-frames' if not args.frame else f'{args.view}-checks'
    frames = args.output / dirname
    if not args.measure_only:
        frames.mkdir(exist_ok=True)
    diagnostics, timings, snapshots = [], [], [[], []]

    if args.view != 'course':
        camera = bpy.data.objects.new(f'{args.view} diagnostic camera', bpy.data.cameras.new('Diagnostic camera'))
        bpy.context.collection.objects.link(camera)
    course_camera = scene.camera
    for frame in range(FRAMES):
        into = frame + 1
        time_s = frame / yudu.FPS
        scene.frame_set(into)
        yudu.animate_camera(course_camera, 'bridge', frame, args.matched)
        for coordinate, socket in zip(course_camera.location, reflected_camera):
            socket.default_value = coordinate
        if bank_camera is not None:
            for coordinate, socket in zip(course_camera.location, bank_camera):
                socket.default_value = coordinate
        yudu.animate_board(door, frame)
        for worker in workers:
            worker.author(frame)
        bpy.context.view_layer.update()
        if frame == 0:
            for worker in workers:
                worker.calibrate_poles()
        for worker in workers:
            worker.finish_pose()
        soldier(far, (4.57, 5.1, .35, 1.04, .16, pi+.14, .5), time_s)
        for index, (_, intensity, glow, weight) in enumerate(lamps):
            wave = 1 + .119*sin(time_s*9.2 + index) + .071*sin(time_s*21.4 + .5*index)
            intensity.default_value = 2.9 * weight * wave
            glow.energy = 23 * weight * wave
        ripple[0].default_value = (-.094*time_s, .021*time_s, 0)
        ripple[1].default_value = (.061*time_s + .27, -.047*time_s - .22, 0)
        cloud.default_value = (.0021 * time_s, 0, 0)
        for branch, yaw, phase in branches:
            branch.rotation_euler.z = yaw + .010*sin(.83*time_s+phase)
        bpy.context.view_layer.update()

        footings = [min((door.matrix_world @ Vector((x, y, -DOOR_THICKNESS/2))).z
                        for y in (-DOOR_DEPTH/2, DOOR_DEPTH/2)) for x in (-.86, .86)]
        note = {'frame': frame, 'source_camera_anchors_px': yudu.check_projection(scene),
                'door_bearer_gap_mm': [round(1000*(z-BEAM_Z), 4) for z in footings], 'workers': {}}
        for index, worker in enumerate(workers):
            note['workers'][worker.label], last[index] = worker.audit(wood, last[index])
            if args.save_scene or args.save_deform:
                worker.key_authoring(into)
            if args.save_deform:
                evaluated = worker.rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
                snapshots[index].append({b.name: b.matrix.copy() for b in evaluated.pose.bones if b.bone.use_deform})
        if args.save_scene:
            key_arcs(scene, into, door, reflected_camera, bank_camera, ripple, cloud, branches, lamps, far)
        diagnostics.append(note)
        if frame not in selected or args.measure_only:
            continue
        prefix = 'matched-' if args.matched else ''
        frame_path = frames / f'{prefix}{frame:04d}.png'
        if args.view != 'course':
            check_camera(frame, args.view, door, camera)
            scene.camera = camera
        mark = time.monotonic()
        scene.render.filepath = str(frame_path)
        bpy.ops.render.render(write_still=True)
        timings.append([frame, round(time.monotonic() - mark, 3)])
        print(f'B {args.view} frame {frame} saved in {timings[-1][1]} s', flush=True)
        scene.camera = course_camera

    course_camera.name = 'Opening shot · original camera'
    baked = [save_deform(worker, values) for worker, values in zip(workers, snapshots)] if args.save_deform else []
    if args.save_scene:
        scene.frame_set(25)
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(args.output / '于都抬板-人物控制.blend'), compress=True)
    if args.frame is None and not args.measure_only:
        yudu.encode(args, frames)
    path = args.output / ('bridge-metrics.json' if args.frame is None else f'{args.view}-check-metrics.json')
    path.write_text(json.dumps({
        'frames': FRAMES, 'fps': yudu.FPS, 'view': args.view, 'size_percent': args.size, 'samples': args.samples,
        'performer': str(args.performer), 'render_seconds': timings, 'baked_actions': baked, 'contacts': diagnostics,
    }, indent=2), encoding='utf-8')
    print(f'Wrote {path}', flush=True)


if __name__ == '__main__':
    render(options())
