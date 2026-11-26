"""将校验过的 Poly Haven 模型裁到离线课件需要的细节和尺寸。"""

from pathlib import Path
import sys

import bpy
import numpy as np


def import_meshes(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def simplify(obj, target):
    obj.data.calc_loop_triangles()
    count = len(obj.data.loop_triangles)
    if count <= target:
        return
    select_only([obj])
    mod = obj.modifiers.new("Scene mesh budget", "DECIMATE")
    mod.ratio = target / count
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)


def export(path, objects):
    select_only(objects)
    bpy.ops.export_scene.gltf(filepath=str(path), export_format="GLB", use_selection=True,
                            export_apply=True, export_cameras=False, export_lights=False)


def leaf_cards(mesh, count):
    """保留原叶片的空间位置、弯折轮廓及扫描贴图坐标。"""
    positions = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", positions)
    positions = positions.reshape(-1, 3)
    vertices = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", vertices)
    mesh.calc_loop_triangles()
    loops = np.empty(len(mesh.loop_triangles) * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("loops", loops)
    loops = loops.reshape(-1, 3)
    triangles = vertices[loops]
    loop_uv = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get("uv", loop_uv)
    vertex_uv = np.zeros((len(positions), 2), dtype=np.float32)
    vertex_uv[vertices] = loop_uv.reshape(-1, 2)

    left = triangles.ravel()
    right = np.roll(triangles, -1, axis=1).ravel()
    labels = np.arange(len(positions), dtype=np.int32)
    while True:
        previous = labels.copy()
        np.minimum.at(labels, left, previous[right])
        np.minimum.at(labels, right, previous[left])
        labels = labels[labels]
        if np.array_equal(previous, labels):
            break
    order = labels.argsort(kind="stable")
    _, widths = np.unique(labels, return_counts=True)
    starts = np.r_[0, np.cumsum(widths)]
    cards = []
    for i in np.random.default_rng(91507).permutation(len(widths)):
        ids = order[starts[i]:starts[i + 1]]
        if len(ids) < 7:
            continue
        uv = vertex_uv[ids]
        u, v = uv.T
        lower = np.flatnonzero(v <= (v.min() + v.max()) * 0.5)
        upper = np.flatnonzero(v > (v.min() + v.max()) * 0.5)
        if not len(lower) or not len(upper):
            continue
        rim = [v.argmin(), lower[u[lower].argmax()], upper[u[upper].argmax()],
               v.argmax(), upper[u[upper].argmin()], lower[u[lower].argmin()]]
        mid = ((uv - (uv.min(axis=0) + uv.max(axis=0)) * 0.5) ** 2).sum(axis=1).argmin()
        key = [mid, *rim]
        if len(set(key)) == 7:
            cards.append((positions[ids[key]], uv[key]))
        if len(cards) == count:
            break
    return cards, len(widths)


def replace_leaves(obj, source, count):
    cards, total = source
    selected = cards[:count]
    inflation = (total / len(selected)) ** 0.5 * 0.96
    points = []
    coords = []
    faces = []
    for leaf, uv in selected:
        offset = len(points)
        origin = leaf[0]
        points.extend(origin + (leaf - origin) * inflation)
        coords.extend(uv)
        faces.extend((offset, offset + i, offset + i % 6 + 1) for i in range(1, 7))
    new = bpy.data.meshes.new("Leaf canopy mesh")
    new.from_pydata(points, [], faces)
    new.materials.append(obj.data.materials[0])
    layer = new.uv_layers.new()
    layer.data.foreach_set("uv", np.array(coords, dtype=np.float32)[np.ravel(faces)].ravel())
    new.update()
    obj.data = new


def tree(path, out):
    select_only(import_meshes(path))
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
    pieces = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    budgets = []
    leaves, branches = None, None
    for obj in pieces:
        label = obj.data.materials[0].name.lower()
        if "leaves" in label:
            leaves = obj
            foliage = leaf_cards(obj.data, 3800)
            replace_leaves(obj, foliage, 3800)
        elif "branches" in label:
            branches = obj
            simplify(obj, 2700)
        else:
            simplify(obj, 2900)
            budgets.append(obj)
    export(out / "river-tree.glb", pieces)
    for obj in budgets:
        simplify(obj, 780)
    if leaves is not None:
        replace_leaves(leaves, foliage, 760)
    export(out / "river-tree-far.glb", [obj for obj in pieces if obj != branches])


def parts(path, destination, names, budget):
    choices = [obj for obj in import_meshes(path) if any(name in obj.name for name in names)]
    if len(choices) != len(names):
        raise RuntimeError(f"找不到需要的部件 {names}")
    for obj in choices:
        simplify(obj, budget)
    export(destination, choices)


if __name__ == "__main__":
    out, source_tree, source_grass, source_rock = map(Path, sys.argv[sys.argv.index("--") + 1:])
    tree(source_tree, out)
    parts(source_grass, out / "river-grass.glb", ("tall_a", "tall_c", "small_b"), 430)
    parts(source_rock, out / "river-rock.glb", ("rock03", "rock06"), 1100)
