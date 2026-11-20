"""用 Blender 4.5 后台打开《会前的桌边.blend》，传入 -P 本文件。

默认从同目录的主视图和当前打开的工程生成四个课件资产。可在 -- 后传
--mode views、mesh 或 check。check 将独立的 Cycles 验收图写到工作目录。
"""

import argparse
import gzip
import json
import math
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree


ROOT = Path(__file__).resolve().parents[3]
BUILD = ROOT / ".march-build" / "desk-live" / "space"
ASSETS = ROOT / "课堂演示" / "assets"
VIEWS = (("front", 0), ("left", -18), ("right", 18))
SIDE_OVERSCAN = 1.24
SIDE_WIDTH = 1152
FOLIOS = ('线装手记', '牛皮纸封卷')
ROOM = '01 · 室内与窗外'


def matrix_columns(matrix):
    return [float(value) for column in matrix.transposed() for value in column]


def camera_at(base, pivot, yaw, pitch=0, zoom=1):
    right = base.col[0].to_3d()
    right.z = 0
    turn = (Matrix.Rotation(math.radians(yaw), 3, 'Z')
            @ Matrix.Rotation(math.radians(-pitch), 3, right.normalized()))
    camera = (turn @ base.to_3x3()).to_4x4()
    camera.translation = pivot + turn @ (base.translation - pivot) / zoom
    return camera


def projection(camera, scene):
    settings = scene.render
    graph = bpy.context.evaluated_depsgraph_get()
    return camera.calc_matrix_camera(
        graph, x=settings.resolution_x, y=settings.resolution_y,
        scale_x=settings.pixel_aspect_x, scale_y=settings.pixel_aspect_y)


def frame(scene, camera, filename, width, aspect, samples):
    scene.camera = camera
    settings = scene.render
    settings.resolution_x = width
    settings.resolution_y = round(width / aspect)
    settings.resolution_percentage = 100
    settings.image_settings.file_format = 'JPEG' if filename.suffix == '.jpg' else 'PNG'
    settings.image_settings.color_mode = 'RGB'
    settings.image_settings.quality = 94
    settings.filepath = str(filename)
    scene.cycles.samples = samples
    bpy.context.view_layer.update()
    bpy.ops.render.render(write_still=True)


def anchors(scene, manifest):
    graph = bpy.context.evaluated_depsgraph_get()
    eye = scene.camera.matrix_world.translation
    manifest['anchors'] = {}
    manifest['anchorUV'] = {}
    for key, name in zip(('left', 'right'), FOLIOS):
        cover = scene.objects[name + ' · 封面'].evaluated_get(graph)
        center = cover.matrix_world @ (sum(map(Vector, cover.bound_box), Vector()) / 8)
        # 保持原封面包围盒中心的画面坐标，但把三维取样点落在可见纸面上。
        hit, point, _, _, first, _ = scene.ray_cast(graph, eye, (center - eye).normalized())
        if not hit or first.name != cover.name:
            raise ValueError(f'{name} 的锚点被遮挡')
        screen = world_to_camera_view(scene, scene.camera, point)
        manifest['anchors'][key] = list(point)
        manifest['anchorUV'][key] = [screen.x, 1 - screen.y]


def mesh_arrays(obj, graph):
    evaluated = obj.evaluated_get(graph)
    mesh = evaluated.to_mesh()
    try:
        local = np.empty((len(mesh.vertices), 3), dtype=np.float32)
        mesh.vertices.foreach_get('co', local.ravel())
        transform = np.asarray(evaluated.matrix_world)
        world = (local @ transform[:3, :3].T + transform[:3, 3]).astype(np.float32)
        mesh.calc_loop_triangles()
        triangles = np.empty((len(mesh.loop_triangles), 3), dtype=np.int32)
        mesh.loop_triangles.foreach_get('vertices', triangles.ravel())
        return world, triangles
    finally:
        evaluated.to_mesh_clear()


def page_block(objects, graph):
    """用每张纸真实的上、下切边连接书口，仅保留整叠最外侧两面。"""
    positions, faces = [], []
    previous = 0
    offset = 0
    sheets = sorted(objects, key=lambda obj: int(obj.name.split()[1].split('.')[0]))
    for index, obj in enumerate(sheets):
        count = len(obj.data.vertices)
        world, triangles = mesh_arrays(obj, graph)
        if len(world) != 2 * count:
            raise ValueError(f'{obj.name} 的纸厚结构已改变')
        upper = triangles < count
        rim = triangles[upper.any(axis=1) & ~upper.all(axis=1)]
        faces.append(rim + offset)
        if index == 0:
            faces.append(triangles[~upper.any(axis=1)] + offset)
        else:
            # 同拓扑的相邻纸层有各自的宽度、错位和翘曲。搭接外圈补足露出的纸台阶。
            pairs = rim[(rim < count).sum(axis=1) == 2]
            a, b = pairs[pairs < count].reshape(-1, 2).T
            faces.extend((np.column_stack((previous+a, previous+b, offset+count+b)),
                          np.column_stack((previous+a, offset+count+b, offset+count+a))))
        if index == len(sheets) - 1:
            faces.append(triangles[upper.all(axis=1)] + offset)
        positions.append(world)
        previous = offset
        offset += len(world)
    used, remap = np.unique(np.concatenate(faces).ravel(), return_inverse=True)
    return np.concatenate(positions)[used], remap.reshape(-1, 3)


def subdivide_for_color(points, faces, views):
    """细分大平面上的长边，让墙根和桌下的补色能随真实照明变化。"""
    while True:
        corners = points[faces]
        edges = np.roll(corners, -1, axis=1) - corners
        lengths = (edges * edges).sum(axis=2)
        normals = np.cross(edges[:, 0], edges[:, 1])
        candidates = (lengths.max(axis=1) > .17**2) & (np.linalg.norm(normals, axis=1) > .012)
        selected = np.flatnonzero(candidates)
        split = np.zeros(len(faces), dtype=bool)
        for vp, eye in views:
            front = (normals[selected] * (eye - corners[selected, 0])).sum(axis=1) > 0
            test = selected[front]
            clip = corners[test] @ vp[:, :3].T + vp[:, 3]
            w = clip[:, :, 3:]
            outside = ((clip[:, :, :3] < -w).all(axis=1) | (clip[:, :, :3] > w).all(axis=1)).any(axis=1)
            split[test[~outside]] = True
        if not split.any():
            return points, faces
        selected = faces[split]
        longest = lengths[split].argmax(axis=1)
        row = np.arange(len(selected))
        a, b, c = (selected[row, (longest+i) % 3] for i in range(3))
        pairs, remap = np.unique(np.sort(np.column_stack((a,b)), axis=1), axis=0, return_inverse=True)
        midpoint = remap.ravel() + len(points)
        points = np.concatenate((points, points[pairs].mean(axis=1)))
        faces = np.concatenate((faces[~split], np.column_stack((a,midpoint,c)),
                                np.column_stack((midpoint,b,c))))


def collect_geometry(scene, views):
    sheets = {name: [] for name in FOLIOS}
    objects = []
    for obj in scene.objects:
        if obj.hide_render or obj.type not in ('MESH', 'CURVE'):
            continue
        if obj.name.startswith('露出书口 '):
            sheets[obj.parent.name].append(obj)
            continue
        objects.append(obj)
        if obj.type == 'CURVE':
            ratio = .12 if ' · ' in obj.name else .40
        elif len(obj.data.vertices) >= 600 and not obj.name.startswith('木靠椅'):
            ratio = .24 if obj.name.endswith('封面') else .40
        else:
            continue
        modifier = obj.modifiers.new('空间浏览减面', 'DECIMATE')
        modifier.ratio = ratio
    graph = bpy.context.evaluated_depsgraph_get()
    parts = []
    for obj in objects:
        world, faces = mesh_arrays(obj, graph)
        material = obj.data.materials[0]
        room = any(collection.name == ROOM for collection in obj.users_collection)
        if room:
            world, faces = subdivide_for_color(world, faces, views)
        parent = obj.parent.name if obj.parent else ''
        paper = (parent in FOLIOS and (obj.name.endswith(('封面', '底封'))
                 or obj.name in ('夹入的散页', '折入的包角')))
        tag = 1 + FOLIOS.index(parent) if paper else 0
        parts.append((world, faces, material, tag, room))
    for tag, (name, layers) in enumerate(sheets.items(), 1):
        world, faces = page_block(layers, graph)
        parts.append((world, faces, layers[0].data.materials[0], tag, False))
    return parts


def image_pixels(path):
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = 'Non-Color'
    w, h = image.size
    rgba = np.empty((h, w, 4), np.float32)
    image.pixels.foreach_get(rgba.ravel())
    return np.rint(rgba[:, :, :3] * 255).clip(0, 255).astype(np.uint8)


def room_photo(scene, aspect, path):
    # 遮挡物仍参与照明、投影和反射，只对这一次离线补色采样的主射线隐藏。
    hero = scene.camera
    camera = hero.copy()
    camera.data = hero.data.copy()
    camera.data.sensor_width *= 1.65
    camera.data.sensor_height *= 1.65
    scene.collection.objects.link(camera)
    hidden = [obj for obj in scene.objects if obj.type in ('MESH', 'CURVE') and obj.visible_camera
              and all(collection.name != ROOM for collection in obj.users_collection)]
    try:
        for obj in hidden:
            obj.visible_camera = False
        frame(scene, camera, path, 768, aspect, 24)
        vp = projection(camera, scene) @ camera.matrix_world.inverted()
        return np.asarray(vp), camera.matrix_world.translation.copy(), image_pixels(path)
    finally:
        for obj in hidden:
            obj.visible_camera = True
        scene.camera = hero
        data = camera.data
        bpy.data.objects.remove(camera, do_unlink=True)
        bpy.data.cameras.remove(data)
        bpy.context.view_layer.update()


def sample_photos(points, views, tree):
    # 只把有无遮挡视线的照片样本烘到顶点，在三个投影都看不到的窄缝中使用。
    sums = np.zeros((len(points), 3))
    weights = np.zeros(len(points))
    for vp, eye, image in views:
        clip = points @ vp[:, :3].T + vp[:, 3]
        uv = .5 + .5 * clip[:, :2] / np.where(clip[:, 3:] != 0, clip[:, 3:], 1)
        inside = ((uv > .001) & (uv < .999)).all(axis=1) & (clip[:, 3] > 0)
        h, w = image.shape[:2]
        for index in np.flatnonzero(inside):
            direction = Vector(points[index]) - eye
            if tree.ray_cast(eye, direction.normalized(), direction.length - .00045)[0] is None:
                u, v = uv[index]
                sums[index] += image[int(v*h), int(u*w)]
                weights[index] += 1
    seen = weights > 0
    sums[seen] /= weights[seen, None]
    return sums, seen


def bake_colors(parts, points, triangles, photos, clean, manifest):
    vertices = points.tolist()
    tree = BVHTree.FromPolygons(vertices, triangles.tolist(), all_triangles=True)
    room_faces = np.repeat([part[4] for part in parts], [len(part[1]) for part in parts])
    room_tree = BVHTree.FromPolygons(vertices, triangles[room_faces].tolist(), all_triangles=True)
    sky = []
    for vp, eye, image in photos:
        inverse = np.linalg.inv(vp)
        h, w = image.shape[:2]
        for y in range(10, h, 24):
            for x in range(10, w, 24):
                far = inverse @ [2*(x+.5)/w-1, 2*(y+.5)/h-1, 1, 1]
                direction = (Vector(far[:3] / far[3]) - eye).normalized()
                if tree.ray_cast(eye, direction)[0] is None:
                    sky.append(image[y, x])
    background = bpy.context.scene.world.node_tree.nodes.get('Background')
    radiance = np.asarray(background.inputs[0].default_value[:3]) * background.inputs[1].default_value
    sky_color = np.median(sky, axis=0) / 255 if sky else 1.055 * radiance ** (1/2.4) - .055
    manifest['sky'] = sky_color.clip(0, 1).tolist()
    colors = np.empty((len(points), 3), np.uint8)
    offset = 0
    for world, faces, material, _, room in parts:
        # 大墙面和地板的顶点可能全在取景框外，也对其三角面内部取样。
        corners = world[faces]
        large = np.linalg.norm(corners[:, 1] - corners[:, 0], axis=1) > .12
        samples = np.concatenate((world, corners[large].mean(axis=1)))
        rgb, seen = sample_photos(samples, photos, tree)
        if room and not seen.all():
            unseen = np.flatnonzero(~seen)
            indirect, valid = sample_photos(samples[unseen], [clean], room_tree)
            rgb[unseen[valid]] = indirect[valid]
            seen[unseen[valid]] = True
        missing = ~seen[:len(world)]
        if missing.any() and seen.any():
            nearest = KDTree(int(seen.sum()))
            for idx in np.flatnonzero(seen):
                nearest.insert(samples[idx], int(idx))
            nearest.balance()
            for idx in np.flatnonzero(missing):
                rgb[idx] = rgb[nearest.find(world[idx])[1]]
        elif not seen.any():
            # 全部在机位背后的物件沿用工程的材质底色及室内曝光近似色。
            rgb[:len(world)] = 104 * np.sqrt(material.diffuse_color[:3])
        colors[offset:offset+len(world)] = np.rint(rgb[:len(world)])
        offset += len(world)
    return colors


def export_geometry(scene, manifest, source, side_directory, staging):
    anchors(scene, manifest)
    width, height = manifest['size']
    clean = room_photo(scene, width / height, staging / 'room-radiance.png')
    photos = []
    for (name, _), view in zip(VIEWS, manifest['views']):
        path = source if name == 'front' else side_directory / ('desk-view-' + name + '.jpg')
        photos.append((np.array(view['vp']).reshape(4, 4).T,
                       Vector(view['eye']), image_pixels(path)))
    parts = collect_geometry(scene, [(vp, np.asarray(eye)) for vp, eye, _ in [*photos, clean]])
    points = np.concatenate([part[0] for part in parts])
    faces, tags = [], []
    offset = 0
    for world, triangles, _, tag, _ in parts:
        faces.append(triangles + offset)
        tags.append(np.full(len(world), tag, np.uint8))
        offset += len(world)
    faces = np.concatenate(faces)
    minimum = points.min(axis=0)
    span = points.max(axis=0) - minimum
    packed = np.empty((len(points), 10), dtype=np.uint8)
    packed[:, :6] = np.rint((points - minimum) / span * 65535).astype('<u2').view('u1')
    packed[:, 6:9] = bake_colors(parts, points, faces, photos, clean, manifest)
    packed[:, 9] = np.concatenate(tags)
    indices = faces.astype('<u2' if len(points) <= 65536 else '<u4')
    manifest['mesh'] = {'vertices': len(points), 'indices': indices.size,
                        'indexBytes': indices.itemsize, 'min': minimum.tolist(), 'span': span.tolist()}
    with (staging / 'desk-space.bin.gz').open('wb') as file:
        with gzip.GzipFile(filename='', fileobj=file, mode='wb', mtime=0) as stream:
            stream.write(packed.tobytes())
            stream.write(indices.tobytes())
    (staging / 'desk-space.json').write_text(json.dumps(manifest, separators=(',', ':')), encoding='utf-8')
    print('SPACE', manifest['mesh'], manifest['anchorUV'], flush=True)


def generate(args, staging):
    outputs = []
    scene = bpy.context.scene
    hero = scene.camera
    if hero.name != '机位一 · 桌边全景' or scene.render.engine != 'CYCLES':
        raise ValueError('请先打开精修场景的原工程和主机位')
    source = Path(bpy.data.filepath).with_name('会前的桌边.png')
    original = bpy.data.images.load(str(source), check_existing=True)
    size = [scene.render.resolution_x, scene.render.resolution_y]
    if list(original.size) != size or scene.render.resolution_percentage != 100:
        raise ValueError('主视图与工程画幅不符')
    aspect = size[0] / size[1]
    base = hero.matrix_world.copy()
    focus = hero.data.dof.focus_distance
    pivot = base @ Vector((0, 0, -focus))
    camera = hero.copy()
    camera.data = hero.data.copy()
    scene.collection.objects.link(camera)
    manifest = {
        'version': 1, 'size': size, 'cameraWorld': matrix_columns(base),
        'projection': matrix_columns(projection(hero, scene)), 'pivot': list(pivot), 'views': [],
    }
    for name, yaw in VIEWS:
        camera.matrix_world = camera_at(base, pivot, yaw) if yaw else base
        # 加宽成像面以覆盖浏览画面边缘，保留原镜头的焦距、光圈和对焦。
        overscan = SIDE_OVERSCAN if yaw else 1
        camera.data.sensor_width = hero.data.sensor_width * overscan
        camera.data.sensor_height = hero.data.sensor_height * overscan
        bpy.context.view_layer.update()
        vp = projection(camera, scene) @ camera.matrix_world.inverted()
        manifest['views'].append({'yaw': yaw, 'eye': list(camera.matrix_world.translation),
                                  'vp': matrix_columns(vp)})
        if yaw and args.mode in ('all', 'views'):
            name = 'desk-view-' + name + '.jpg'
            frame(scene, camera, staging / name, SIDE_WIDTH, aspect, args.samples)
            scene.render.resolution_x, scene.render.resolution_y = size
            outputs.append(name)
    camera.data.sensor_width = hero.data.sensor_width
    camera.data.sensor_height = hero.data.sensor_height
    scene.camera = hero
    if args.mode in ('mesh', 'all'):
        export_geometry(scene, manifest, source, staging if args.mode == 'all' else ASSETS, staging)
        outputs.extend(('desk-space.bin.gz', 'desk-space.json'))
    if args.mode == 'check':
        for name, yaw, pitch, zoom in CHECK_POSES:
            camera.matrix_world = camera_at(base, pivot, yaw, pitch, zoom)
            frame(scene, camera, BUILD / (name + '.png'), 960, aspect, args.samples)
    # 完成全部渲染和压缩后再发布，最后替换与网格配套的清单。
    for name in outputs:
        (staging / name).replace(ASSETS / name)


CHECK_POSES = (('orbit-left', -9, 3, 1.06), ('orbit-right', 9, -3, 1.03))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--mode', choices=('all', 'views', 'mesh', 'check'), default='all')
    parser.add_argument('--samples', type=int, default=48)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    BUILD.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix='export-', dir=BUILD) as folder:
        generate(args, Path(folder))
