"""导出会议桌空间、参考机位和独立的实时道具。

blender -b --disable-autoexec 会前的桌边.blend -P export-live-desk.py -- --samples 24 --output <导出目录>
"""

import argparse
import json
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_space import (ASSETS, FOLIOS, ROOM, SIDE_OVERSCAN, VIEWS, bake_colors,
                          camera_at, frame, image_pixels, mesh_arrays, projection,
                          matrix_columns, room_photo, subdivide_for_color)

PROPS = {'提灯总成', '粗瓷茶碗', '削过的木杆铅笔'}
ANGLES = (*[(name, yaw, 0) for name, yaw in VIEWS], ('top', 0, 15))
SURFACES = {
    '灯架': ('desk-iron', '514031', .44, .55),
    '铜件': ('desk-brass', '94714a', .38, .62),
    '铁件': ('desk-soot', '2e2923', .79, .17),
    '灯罩': ('desk-glass', 'e1cba2', .22, 0),
    '玻璃': ('desk-glass', 'e1cba2', .22, 0),
    '茶碗': ('desk-glaze', 'bcb09a', .30, 0),
    '胎土': ('desk-clay', '8b6d54', .83, 0),
    '碗口': ('desk-rim', '87725c', .36, 0),
    '茶面': ('desk-tea', '452c1d', .19, 0),
    '笔杆': ('desk-pencil', '66432e', .56, 0),
    '铅笔': ('desk-cutwood', 'c49966', .73, 0),
    '铅芯': ('desk-graphite', '363438', .43, .28),
    '火焰 · 琥珀': ('desk-flame-amber', 'ff972f', .46, 0),
    '火焰 · 芯': ('desk-flame-core', 'ffe0a1', .44, 0),
}


def linear(component):
    value = int(component, 16) / 255
    return ((value + .055) / 1.055) ** 2.4 if value > .04045 else value / 12.92


def export_props(path, objects):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.hide_render = False
        obj.select_set(True)
    for obj in objects:
        if obj.type not in ('MESH', 'CURVE'):
            continue
        for slot in obj.material_slots:
            old = slot.material
            profile = SURFACES.get(old.name.split(' · ')[0]) or SURFACES.get(old.name)
            if profile is None:
                raise ValueError(f'缺少实时材质参数 {old.name}')
            name, hex_color, roughness, metal = profile
            mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
            mat.use_nodes = True
            shader = mat.node_tree.nodes.get('Principled BSDF')
            shader.inputs['Base Color'].default_value = tuple(linear(hex_color[i:i+2]) for i in (0, 2, 4)) + (1,)
            shader.inputs['Roughness'].default_value = roughness
            shader.inputs['Metallic'].default_value = metal
            if name == 'desk-glass':
                shader.inputs['Alpha'].default_value = .19
            slot.material = mat
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                              export_yup=True, export_animations=False, export_lights=False,
                              export_cameras=False, export_texcoords=False)


def geometry(scene, views):
    objects = [obj for obj in scene.objects if not obj.hide_render and obj.type in ('MESH', 'CURVE')]
    for obj in objects:
        if obj.type == 'CURVE' or (len(obj.data.vertices) >= 600 and not obj.name.startswith('木靠椅')):
            modifier = obj.modifiers.new('实时桌景减面', 'DECIMATE')
            modifier.ratio = .60 if obj.type == 'CURVE' else .42
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

    movable = set(FOLIOS) | PROPS
    props = [obj for obj in scene.objects if obj.name in PROPS or obj.parent and obj.parent.name in PROPS]
    for obj in scene.objects:
        if obj.parent and obj.parent.name in movable:
            obj.hide_render = True
    scene.objects['灯芯光'].data.energy *= .58
    base = hero.matrix_world.copy()
    pivot = base @ Vector((0, 0, -hero.data.dof.focus_distance))
    settings = scene.render
    size = settings.resolution_x, settings.resolution_y
    aspect = size[0] / size[1]
    camera = hero.copy()
    camera.data = hero.data.copy()
    scene.collection.objects.link(camera)

    photos, views = [], []
    manifest = json.loads((ASSETS / 'desk-space.json').read_text(encoding='utf-8'))
    for name, yaw, pitch in ANGLES:
        camera.matrix_world = camera_at(base, pivot, yaw, pitch)
        overscan = SIDE_OVERSCAN if yaw or pitch else 1
        camera.data.sensor_width = hero.data.sensor_width * overscan
        camera.data.sensor_height = hero.data.sensor_height * overscan
        filename = f'desk-world-{name}.jpg'
        image = staging / filename
        frame(scene, camera, image, 1280, aspect, samples)
        vp = projection(camera, scene) @ camera.matrix_world.inverted()
        photos.append((np.asarray(vp), camera.matrix_world.translation.copy(), image_pixels(image)))
        views.append({'yaw': yaw, 'pitch': pitch, 'eye': list(camera.matrix_world.translation), 'vp': matrix_columns(vp)})
    manifest['views'] = views

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
    colors = bake_colors(parts, points, faces, photos, clean, manifest)
    write_glb(staging / 'desk-world.glb', points, faces, colors)
    (staging / 'desk-space.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
    export_props(staging / 'desk-props-source.glb', props)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--samples', type=int, default=24)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    args.output.mkdir(parents=True, exist_ok=True)
    export(args.output.resolve(), args.samples)
