"""从精修 Blender 工程导出不含纸件的会议桌和三个参考机位。

blender -b --disable-autoexec 会前的桌边.blend -P export-live-desk.py -- --samples 24
"""

import argparse
import json
import struct
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_space import (ASSETS, FOLIOS, ROOM, SIDE_OVERSCAN, VIEWS, bake_colors,
                          camera_at, frame, image_pixels, mesh_arrays, projection,
                          room_photo, subdivide_for_color)


def geometry(scene, views):
    objects = [obj for obj in scene.objects if not obj.hide_render and obj.type in ('MESH', 'CURVE')]
    for obj in objects:
        if obj.type == 'CURVE' or (len(obj.data.vertices) >= 600 and not obj.name.startswith('木靠椅')):
            modifier = obj.modifiers.new('实时桌景减面', 'DECIMATE')
            modifier.ratio = .24 if obj.type == 'CURVE' else .42
    graph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        world, faces = mesh_arrays(obj, graph)
        if not len(faces):
            continue
        is_room = any(group.name == ROOM for group in obj.users_collection)
        if is_room:
            world, faces = subdivide_for_color(world, faces, views)
        yield world, faces, obj.data.materials[0], 0, is_room


def write_glb(path, points, faces, colors):
    # glTF 以 Y 为竖轴。
    points = np.column_stack((points[:, 0], points[:, 2], -points[:, 1])).astype('<f4')
    indices = faces.astype('<u2' if len(points) <= 65536 else '<u4')
    data, views, accessors = bytearray(), [], []
    for values, component, shape, target in (
        (points, 5126, 'VEC3', 34962),
        (colors, 5121, 'VEC3', 34962),
        (indices.ravel(), 5123 if indices.itemsize == 2 else 5125, 'SCALAR', 34963),
    ):
        views.append({'buffer': 0, 'byteOffset': len(data), 'byteLength': values.nbytes, 'target': target})
        accessors.append({'bufferView': len(views) - 1, 'componentType': component,
                          'count': len(values), 'type': shape})
        data.extend(values.tobytes())
        data.extend(b'\0' * ((-len(data)) % 4))
    accessors[0].update(min=points.min(axis=0).tolist(), max=points.max(axis=0).tolist())
    accessors[1]['normalized'] = True
    model = {
        'asset': {'version': '2.0'},
        'scene': 0,
        'scenes': [{'nodes': [0]}],
        'nodes': [{'mesh': 0}],
        'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'COLOR_0': 1}, 'indices': 2}]}],
        'buffers': [{'byteLength': len(data)}],
        'bufferViews': views,
        'accessors': accessors,
    }
    info = bytearray(json.dumps(model, separators=(',', ':')).encode())
    info.extend(b' ' * ((-len(info)) % 4))
    with path.open('wb') as stream:
        stream.write(struct.pack('<4sII', b'glTF', 2, 28 + len(info) + len(data)))
        for chunk, tag in ((info, b'JSON'), (data, b'BIN\0')):
            stream.write(struct.pack('<I4s', len(chunk), tag))
            stream.write(chunk)
    print(f'桌景网格 {len(points)} 顶点，{len(faces)} 三角面。', flush=True)


def export(staging, samples):
    scene = bpy.context.scene
    hero = scene.camera
    if not hero or hero.name != '机位一 · 桌边全景' or scene.render.engine != 'CYCLES':
        raise ValueError('请使用会前的桌边精修工程与主机位')

    movable = set(FOLIOS)
    for obj in scene.objects:
        if obj.parent and obj.parent.name in movable:
            obj.hide_render = True
    base = hero.matrix_world.copy()
    pivot = base @ Vector((0, 0, -hero.data.dof.focus_distance))
    settings = scene.render
    size = settings.resolution_x, settings.resolution_y
    aspect = size[0] / size[1]
    camera = hero.copy()
    camera.data = hero.data.copy()
    scene.collection.objects.link(camera)

    photos, outputs = [], []
    for name, yaw in VIEWS:
        camera.matrix_world = camera_at(base, pivot, yaw)
        overscan = SIDE_OVERSCAN if yaw else 1
        camera.data.sensor_width = hero.data.sensor_width * overscan
        camera.data.sensor_height = hero.data.sensor_height * overscan
        filename = f'desk-world-{name}.jpg'
        image = staging / filename
        frame(scene, camera, image, 1280 if yaw == 0 else 1152, aspect, samples)
        vp = projection(camera, scene) @ camera.matrix_world.inverted()
        photos.append((np.asarray(vp), camera.matrix_world.translation.copy(), image_pixels(image)))
        outputs.append(filename)

    settings.resolution_x, settings.resolution_y = size
    scene.camera = hero
    clean = room_photo(scene, aspect, staging / 'room-radiance.png')
    views = [(vp, np.asarray(eye)) for vp, eye, _ in [*photos, clean]]
    parts = list(geometry(scene, views))
    points, faces = [], []
    offset = 0
    for world, triangles, _, _, _ in parts:
        points.append(world)
        faces.append(triangles + offset)
        offset += len(world)
    points, faces = np.concatenate(points), np.concatenate(faces)
    colors = bake_colors(parts, points, faces, photos, clean, {})
    write_glb(staging / 'desk-world.glb', points, faces, colors)
    for name in [*outputs, 'desk-world.glb']:
        (staging / name).replace(ASSETS / name)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=24)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    with TemporaryDirectory(prefix='live-desk-', dir=ASSETS) as folder:
        export(Path(folder), args.samples)
