"""Render the two Yudu opening shots with Blender 4.5 LTS and FFmpeg."""

from argparse import ArgumentParser
import json
from math import cos, pi, sin
from pathlib import Path
from random import Random
import shutil
import subprocess
import sys
import time

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE))
from river_cast import Cast, hold_door, soldier
from river_scene import (
    BEAM_Z, BRIDGE_X, DECK_MAX, DECK_MIN, DECK_Z, DOOR_DEPTH, DOOR_SLOT_Y,
    DOOR_THICKNESS, HERO_HULL_Y, SceneMaterials, build_bridges, cord, ease, empty,
    ground, landscape, light, make_water, mesh, mix, plant_banks, principled, skies, surface, timber,
)


FPS = 24
FRAMES = {'bridge': round(21.10 * FPS) - round(18.00 * FPS) + 12,
          'night': round(23.45 * FPS) - round(21.10 * FPS) + 12}


def options():
    parser = ArgumentParser(description=__doc__)
    parser.add_argument('--shot', choices=FRAMES, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--assets', type=Path, default=HERE.parents[2] / 'assets' / 'yudu-river')
    parser.add_argument('--cast', type=Path, default=HERE.parent / 'cast')
    parser.add_argument('--workshirt', type=Path)
    parser.add_argument('--legacy-shirt', action='store_true', help='Keep the original tunics for a camera comparison.')
    parser.add_argument('--frame', type=int, nargs='+', help='Zero-based frames for a still preview.')
    parser.add_argument('--preview-first', action='store_true', help='Render the contact frames first in a full run.')
    parser.add_argument('--matched', action='store_true', help='Reuse the old source’s orthographic camera at raw frame 30.')
    parser.add_argument('--size', type=int, default=100, help='Percentage of 1280×720.')
    parser.add_argument('--samples', type=int, default=8)
    parser.add_argument('--measure-only', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    if args.frame and any(frame not in range(FRAMES[args.shot]) for frame in args.frame):
        parser.error('Frame is outside the source.')
    if args.shot == 'bridge' and any(not (args.cast / file).is_file() for file in ('skin-young.jpg','skin-middle.jpg')):
        parser.error('The bridge shot requires the two licensed MPFB skin textures in --cast.')
    return args


def configure(args):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    for ob in list(bpy.context.scene.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT'
    scene.eevee.taa_render_samples = args.samples
    scene.eevee.shadow_pool_size = '256'
    scene.eevee.shadow_step_count = 3
    scene.render.resolution_x = 1280
    scene.render.resolution_y = 720
    scene.render.resolution_percentage = args.size
    scene.render.fps = FPS
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.render.image_settings.compression = 20
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.view_settings.exposure = 0
    scene.render.dither_intensity = .77
    camera = bpy.data.cameras.new("Opening shot")
    obj = bpy.data.objects.new(camera.name, camera)
    bpy.context.collection.objects.link(obj)
    scene.camera = obj
    camera.clip_start = .065
    camera.clip_end = 500
    return scene


def point_camera(camera, eye, center, lens):
    camera.location = eye
    camera.rotation_euler = (Vector(center) - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.lens = lens


def animate_camera(camera, shot, frame, matched):
    if matched:
        def convert(p):
            return (p[0], -p[2], p[1])

        pairs = {
            'bridge': ((26.0, 29.0, 31.0), (18.5, 22.0, 22.0),
                       (4.6, .4, 1.1), (4.9, .45, .9), 3.2, 4.4, 108),
            'night': ((23.0, 24.0, 27.0), (15.5, 19.0, 19.5),
                      (5.2, .4, 1.4), (4.5, .4, .6), 3.4, 4.6, 120),
        }
        eye0, eye1, aim0, aim1, zoom0, zoom1, count = pairs[shot]
        t = 30 / (count - 1)
        weight = t**3 * (t*(6*t-15)+10)
        eye = tuple(mix(a, b, weight) for a,b in zip(eye0,eye1))
        aim = tuple(mix(a, b, weight) for a,b in zip(aim0,aim1))
        point_camera(camera, convert(eye), convert(aim), 36)
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = 2 * 33.5 * (1280 / 720) / mix(zoom0, zoom1, weight)
    elif shot == 'bridge':
        p = ease(frame, -7, 75)
        point_camera(camera,
                     (mix(7.09, 6.08, p), mix(-11.62, -10.67, p), mix(1.77, 1.57, p)),
                     (4.91, DOOR_SLOT_Y + .12, mix(1.01, .83, p)), mix(38.5, 34.0, p))
    else:
        p = ease(frame, -8, 64)
        point_camera(camera,
                     (mix(8.96, 7.88, p), mix(-12.10, -10.33, p), mix(2.31, 2.07, p)),
                     (4.68, mix(.05, 2.68, p), mix(1.22, 1.24, p)), mix(31.5, 34.5, p))


def lantern(name, position, materials, weight, radius=.066):
    body = empty(name, position)
    paper = surface("Smoked horn around the wick", (.46,.25,.072), .68)
    lamp = principled(paper)
    lamp.inputs['Emission Color'].default_value = (1.0,.37,.078,1)
    lamp.inputs['Emission Strength'].default_value = 2.9 * weight
    rings = ((radius*.71, .024), (radius, .055), (radius*.94, .128), (radius*.66, .160))
    points = [(r*cos(angle), r*sin(angle), h) for r,h in rings
              for angle in (i * 2 * pi / 8 for i in range(8))]
    faces = [(j+i*8,(j+1)%8+i*8,(j+1)%8+(i+1)*8,j+(i+1)*8)
             for i in range(3) for j in range(8)]
    mantle = mesh("Thin, warm lantern panes", points, faces, paper)
    mantle.parent = body
    for index,(r,h) in enumerate(rings):
        ring = cord("Oil lantern rim", [(r*cos(theta),r*sin(theta),h)
                    for theta in (i*2*pi/8 for i in range(9))],
                    .008 if index in (0,3) else .004, materials.iron)
        ring.parent = body
    for i in range(8):
        a = i * pi / 4
        upright = cord("Fine framework of oil lantern", [(r*cos(a),r*sin(a),z) for r,z in rings],
                       .004, materials.iron)
        upright.parent = body
    cap = timber("Lantern shade", (0, 0, .154), (radius*1.44,radius*1.44,.018), materials.iron)
    cap.parent = body
    handle = cord("Wire lantern handle",
                  [(.047*cos(a), 0, .164+.042*sin(a)) for a in (i*pi/18 for i in range(19))],
                  .0037, materials.iron)
    handle.parent = body
    glow = light("Low, warm wick light", "POINT", (0, 0, .106), (1,.36,.092), 23*weight, .12, shadow=False)
    glow.parent = body
    return body, lamp.inputs['Emission Strength'], glow.data, weight


def shore_lamps(materials, night):
    posts = ([(BRIDGE_X-1.40, DECK_MIN-.37, .74), (BRIDGE_X+1.44, DECK_MAX+.25, .56)]
             if night else [(BRIDGE_X-2.95, DECK_MIN-.86, .88)])
    lit = []
    for x, y, weight in posts:
        z = ground(x, y)
        pole = timber("Tallow light on a bridge approach post", (x,y,z+.68),
                      (.062,.069,1.38), materials.beams, .28)
        pole.rotation_euler.y = -.065
        cord("Simple bent hanging pin", [(x-.044,y,z+1.35),(x+.03,y,z+1.36),(x+.113,y,z+1.29)],
             .010, materials.iron)
        lit.append(lantern("Bank lamp", (x+.113,y,z+1.09),materials,weight))
    return lit


def props(materials):
    rng = Random(213)
    x, y = BRIDGE_X - 2.38, DECK_MIN - .80
    z = ground(x, y)
    for i in range(7):
        item = timber("Loose boards delivered from shore", (x-i*.036,y+i*.028,z+.03+i*.039),
                      (2.02-rng.uniform(0,.28),rng.uniform(.22,.34),.058),
                      materials.wood[i%6], rng.random(), slanted=True)
        item.rotation_euler.z = .37 + rng.uniform(-.15,.09)
    for cx,cy in [(BRIDGE_X+2.66,DECK_MIN-.42), (BRIDGE_X-2.6,DECK_MIN-.51)]:
        z=ground(cx,cy)+.019
        cord("Hemp line coiled by the landing", [
            (cx+(.07+i*.0015)*cos(i*.22),cy+(.07+i*.0015)*sin(i*.22),z+i*.00017)
            for i in range(121)], .016, materials.hemp)


def arrange_night(cast):
    rng = Random(1017)
    procession = []
    for idx in range(18):
        x = BRIDGE_X + (-.44 if idx % 2 else .43) + rng.uniform(-.122,.122)
        y = -10.8 + 1.04 * idx + rng.uniform(-.27,.27)
        speed = rng.uniform(.61, .89)
        stride = rng.uniform(.99, 1.30)
        phase = rng.random()
        yaw = pi + rng.uniform(-.095,.095)
        player = (x, y, speed, stride, phase, yaw, rng.random())
        actor = cast.actor(f"Crossing column {idx + 1}", idx % 5, rng.uniform(.918,1.095),
                           (1,2,3,0,2)[idx%5], wear_shirt=idx < 5)
        procession.append((actor, player))
    return procession


def animate_board(door, frame):
    inset = 1 - ease(frame, 4, 43)
    lower = ease(frame, 7, 48)
    roll = .029 * (1 - ease(frame, 48, 54))
    door.rotation_euler = (.012 * inset, -roll, -.035 * inset)
    door.location = (BRIDGE_X + .048 * inset, DOOR_SLOT_Y - .22 * inset,
                     mix(.948, BEAM_Z + DOOR_THICKNESS / 2 + sin(roll) * .86, lower))
    bpy.context.view_layer.update()
    return lower


def check_projection(scene):
    bpy.context.view_layer.update()
    anchors = ((BRIDGE_X, DECK_MIN, DECK_Z), (BRIDGE_X, DECK_MAX, DECK_Z),
               (BRIDGE_X+2.91, HERO_HULL_Y, .2), (-16.7, 0, DECK_Z))
    return [tuple(round(value, 3) for value in
                  (p.x * 1280, (1-p.y) * 720))
            for xyz in anchors
            for p in [world_to_camera_view(scene, scene.camera, Vector(xyz))]]


def encode(args, frames_dir):
    ffmpeg = shutil.which('ffmpeg')
    if ffmpeg is None:
        raise RuntimeError("FFmpeg is needed for full-length clips. Add it to PATH.")
    temporary = args.output / f'{args.shot}.part.mp4'
    target = args.output / f'{args.shot}.mp4'
    subprocess.run([ffmpeg, '-v','error','-y','-threads','4','-framerate',str(FPS),
                    '-start_number','0','-i',str(frames_dir/'%04d.png'),'-frames:v',str(FRAMES[args.shot]),
                    '-an','-c:v','libx264','-threads','4','-preset','medium','-crf','17','-pix_fmt','yuv420p',
                    '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709',
                    '-movflags','+faststart',str(temporary)],check=True)
    temporary.replace(target)


def main():
    args = options()
    if not args.legacy_shirt and args.workshirt is None:
        if args.shot == 'bridge':
            from board_shot import render_from_common
        else:
            from render_night import render_from_common
        return render_from_common(args)
    args.output = args.output.resolve()
    frames_dir = args.output / f'{args.shot}-frames'
    frames_dir.mkdir(parents=True, exist_ok=True)
    scene = configure(args)
    night = args.shot == 'night'
    materials = SceneMaterials(args.assets)
    photographic = not args.matched
    bank_reference = args.assets.parent / 'yudu-bank.jpg' if photographic else None
    bank_camera = landscape(materials, photographic, bank_reference if night else None)
    branches = plant_banks(materials, photographic)
    door, hulls = build_bridges(materials, assembling=not night and not args.matched)
    ripple, reflected_camera = make_water(materials, hulls, night)
    cloud = skies(scene, night, bank_reference)
    lit = shore_lamps(materials, night)
    props(materials)
    workshirt = None
    if not args.legacy_shirt:
        candidate = args.workshirt or args.cast / 'workshirt.glb'
        if candidate.is_file():
            workshirt = candidate
    cast = Cast(materials, workshirt)
    if night:
        procession = arrange_night(cast)
        carried_lamp = lantern("Partly shaded lamp carried by a guide", (0,0,0), materials, .35, .052)
        lit.append(carried_lamp)
    else:
        workers = (cast.actor('Villager at the stern', 0, 1.00, headwear='wrap', skin=args.cast / 'skin-middle.jpg'),
                   cast.actor('Worker at the bow', 1, .963, headwear='bare', skin=args.cast / 'skin-young.jpg'))
        procession = [(cast.actor("Far bank crew", 2, .95, pack=2),
                       (4.57, 5.1, .35, 1.04, .16, pi+.14, .5))]
    cast.remove_templates()
    batch = args.frame or ([30] if args.matched else list(range(FRAMES[args.shot])))
    if args.preview_first and not args.frame and not args.matched:
        early = [0, 48, 54, 65] if args.shot == 'bridge' else [0, 35, 68]
        batch = [*early, *(frame for frame in batch if frame not in early)]
    render_times, diagnostics = [], []
    for frame in batch:
        time_s = frame / FPS
        scene.frame_set(frame + 1)
        animate_camera(scene.camera, args.shot, frame, args.matched)
        for coordinate, socket in zip(scene.camera.location, reflected_camera):
            socket.default_value = coordinate
        if bank_camera is not None:
            for coordinate, socket in zip(scene.camera.location, bank_camera):
                socket.default_value = coordinate
        if not night:
            lower = animate_board(door, frame)
            hands = [hold_door(actor, door, side, lower, ease(frame, 56 if side < 0 else 58,
                                                             73 if side < 0 else 76), time_s)
                     for actor, side in zip(workers, (-1, 1))]
            underside = [min((door.matrix_world @ Vector((x,y,-DOOR_THICKNESS/2))).z
                             for y in (-DOOR_DEPTH/2, DOOR_DEPTH/2))
                         for x in (-.86, .86)]
        feet = [error for index, (actor,person) in enumerate(procession)
                for error in soldier(actor, person, time_s, carried_lamp[0] if night and index == 6 else None)]
        for index, (_, intensity, glow, weight) in enumerate(lit):
            wave = 1 + .119*sin(time_s*9.2 + index) + .071*sin(time_s*21.4 + .5*index)
            intensity.default_value = 2.9 * weight * wave
            glow.energy = 23 * weight * wave
        ripple[0].default_value = (-.094*time_s, .021*time_s, 0)
        ripple[1].default_value = (.061*time_s + .27, -.047*time_s - .22, 0)
        cloud.default_value = (.0021 * time_s, 0, 0)
        for branch, yaw, phase in branches:
            branch.rotation_euler.z = yaw + .010*sin(.83*time_s+phase)
        if night:
            note = {'frame': frame, 'max_planted_ankle_error_m': max(feet), 'planted_feet': len(feet)}
        else:
            note = {'frame': frame, 'underside_gap_at_bearers_m': [round(z-BEAM_Z,6) for z in underside],
                    'workers': hands}
        diagnostics.append(note)
        if args.matched:
            note['projected_px_near_deck_far_deck_bow_downstream'] = check_projection(scene)
        if not args.measure_only:
            mark = time.monotonic()
            prefix = 'matched-' if args.matched else ''
            scene.render.filepath = str(frames_dir / f'{prefix}{frame:04d}.png')
            bpy.ops.render.render(write_still=True)
            render_times.append(round(time.monotonic()-mark,3))
            print(f'{args.shot} {frame + 1}/{FRAMES[args.shot]} saved in {render_times[-1]} s', flush=True)
    if args.frame is None and not args.matched and not args.measure_only:
        encode(args,frames_dir)
    suffix = '-matched' if args.matched else ('-stills' if args.frame else '')
    report = {'shot': args.shot, 'frames': len(batch), 'fps': FPS, 'size_percent': args.size,
              'samples': args.samples, 'render_seconds_per_frame': render_times, 'contacts': diagnostics}
    (args.output / f'{args.shot}{suffix}-metrics.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


if __name__ == '__main__':
    main()

