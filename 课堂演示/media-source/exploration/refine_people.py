"""用 MPFB 的 CC0 网格与游戏骨架制作于都近景人物和远处队伍。"""

from collections import defaultdict
from math import cos, pi, sin
from pathlib import Path
import sys

import bpy
from mathutils import Matrix, Vector
from bl_ext.user_default.mpfb.services.humanservice import HumanService

sys.path.insert(0, str(Path(__file__).resolve().parent))
from refine_mesh import Parts, save_and_export, surface


out, editable = map(Path, sys.argv[sys.argv.index("--") + 1:])
bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete()
body = HumanService.create_human()
rig = HumanService.add_builtin_rig(body, "game_engine")
rig.name = "于都人物 · MPFB 游戏骨架"
skin = surface("肤色 · 暖灰", (0.47, 0.283, 0.175), 0.82)
textile = {"Normal": out / "coarse-cloth-normal.jpg", "Roughness": out / "coarse-cloth-rough.jpg"}
coat = surface("上衣 · 粗布", (0.24, 0.218, 0.168), 0.87, textile, normal_strength=0.48)
trousers = surface("长裤 · 粗布", (0.146, 0.139, 0.112), 0.91, textile, normal_strength=0.39)
stitch = surface("布领、衣襟与收口", (0.121, 0.101, 0.072), 0.91)
straw = surface("旧鞋与绳扣", (0.186, 0.126, 0.064), 0.94, textile, normal_strength=0.30)
cap = surface("布帽", (0.163, 0.15, 0.107), 0.94)


def to_view(p):
    return (p.x, p.z, -p.y)


def joint(name):
    return Vector(to_view(rig.data.bones[name].head_local))


def active(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def expose_skin():
    body.name = "头颈与手 · MPFB"
    active(body)
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for mod in list(body.modifiers):
        if mod.type == "MASK":
            body.modifiers.remove(mod)
    original_group = body.vertex_groups["body"].index
    exposed = body.vertex_groups.new(name="头、颈和手")
    indices = []
    for v in body.data.vertices:
        x, y, z = v.co
        on_body = any(g.group == original_group for g in v.groups)
        # 袖口遮住切边，保留手腕、各指和头颈原网格。
        if on_body and (z >= 1.408 or (abs(x) > 0.420 and 0.88 < z < 1.09)):
            indices.append(v.index)
    exposed.add(indices, 1.0, "REPLACE")
    mod = body.modifiers.new("衣内网格遮罩", "MASK")
    mod.vertex_group = exposed.name
    body.modifiers.move(len(body.modifiers) - 1, 0)
    bpy.ops.object.modifier_apply(modifier=mod.name)
    decimate = body.modifiers.new("头手远景减面", "DECIMATE")
    decimate.ratio = 0.25
    decimate.use_collapse_triangulate = True
    body.modifiers.move(len(body.modifiers) - 1, 0)
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    body.data.materials.clear()
    body.data.materials.append(skin)
    for face in body.data.polygons:
        face.material_index = 0
        face.use_smooth = True


class Garment:
    def __init__(self, material):
        self.geometry = Parts(material)
        self.weights = defaultdict(lambda: defaultdict(list))

    def weight(self, offset, size, weights):
        for bone, amount in weights.items():
            if amount > 0:
                self.weights[bone][amount].extend(range(offset, offset + size))

    def rings(self, rings, assignments, *, scale=1.0):
        n = len(rings[0])
        positions = [point for ring in rings for point in ring]
        faces, uv = [], []
        for j in range(len(rings) - 1):
            v = j * scale / (len(rings) - 1)
            nxt = v + scale / (len(rings) - 1)
            for i in range(n):
                k = (i + 1) % n
                faces.append((j * n + k, j * n + i, (j + 1) * n + i, (j + 1) * n + k))
                uv.extend([((i + 1) / n, v), (i / n, v), (i / n, nxt), ((i + 1) / n, nxt)])
        start = len(self.geometry.positions)
        self.geometry.mesh(positions, faces)
        self.geometry.uvs[-len(uv):] = uv
        for j, weights in enumerate(assignments):
            self.weight(start + j * n, n, weights)

    def block(self, center, dims, bone, edge=0.007):
        start = len(self.geometry.positions)
        self.geometry.block(center, dims, edge)
        self.weight(start, len(self.geometry.positions) - start, {bone: 1})

    def make(self, name):
        obj = self.geometry.object(name, smooth=True)
        for bone, weights in self.weights.items():
            vg = obj.vertex_groups.new(name=bone)
            for value, ids in weights.items():
                vg.add(ids, value, "REPLACE")
        obj.parent = rig
        mod = obj.modifiers.new("MPFB 骨架", "ARMATURE")
        mod.object = rig
        return obj


def ellipse(y, xx, zz, *, z=0, count=28):
    return [(xx * cos(a), y + 0.0024 * sin(3 * a), z + zz * sin(a))
            for a in (i * 2 * pi / count for i in range(count))]


def sleeve_ring(point, axis, radius, phase, count=16):
    axis = axis.normalized()
    u = axis.cross(Vector((0, 0, 1))).normalized()
    v = axis.cross(u)
    ring = []
    for i in range(count):
        a = i * 2 * pi / count
        fold = 1 + 0.045 * cos(3 * a + phase) + 0.025 * sin(5 * a - phase)
        ring.append(tuple(point + (u * cos(a) + v * sin(a)) * (radius * fold)))
    return ring


def limb(cloth, binding, profile):
    start, hinge, end = (joint(name) for name in binding)
    rings = []
    weights = []
    for fraction, r in profile:
        if fraction <= 1:
            point, axis = start.lerp(hinge, fraction), hinge - start
        else:
            point, axis = hinge.lerp(end, fraction - 1), end - hinge
        blend = max(0, min(1, (fraction - 0.86) / 0.28))
        rings.append(sleeve_ring(point, axis, r, fraction * 7))
        weights.append({binding[0]: 1 - blend, binding[1]: blend})
    cloth.rings(rings, weights, scale=2.2)


expose_skin()
shirt, pants, sewn, shoes, headwear = map(Garment, (coat, trousers, stitch, straw, cap))
body_profile = [
    (.785, .171, .114, -.014, "pelvis"), (.811, .177, .117, -.011, "pelvis"),
    (.876, .167, .115, -.011, "pelvis"), (.965, .145, .110, -.014, "spine_01"),
    (1.044, .152, .108, -.012, "spine_02"), (1.134, .170, .113, -.010, "spine_03"),
    (1.228, .184, .121, -.005, "spine_03"), (1.303, .193, .103, -.009, "spine_03"),
    (1.352, .158, .083, .003, "spine_03"), (1.404, .079, .066, .015, "spine_03"),
]
shirt.rings([ellipse(y, x, z, z=offset) for y, x, z, offset, _ in body_profile],
            [{bone: 1} for _, _, _, _, bone in body_profile], scale=2.3)
sewn.rings([ellipse(y, w, d, z=0.016, count=20) for y, w, d in
             [(1.389, .082, .067), (1.413, .074, .060), (1.436, .069, .058)]],
           [{"spine_03": 1}, {"neck_01": 1}, {"neck_01": 1}])
for y, depth, bone in ((1.226, .114, "spine_03"), (1.151, .11, "spine_03"), (1.075, .104, "spine_02"),
                       (.997, .099, "spine_01"), (.915, .105, "pelvis")):
    sewn.block((0.016, y, depth + 0.009), (.033, .079, .013), bone, .003)
    shoes.block((0.0175, y, depth + 0.017), (.013, .013, .008), bone, .003)
sewn.block((-0.086, 1.182, 0.098), (.075, .071, .019), "spine_03", .005)
shirt.block((-0.087, 1.22, 0.107), (.087, .026, .015), "spine_03", .004)
for side in ("l", "r"):
    arm = tuple(f"{bone}_{side}" for bone in ("upperarm", "lowerarm", "hand"))
    limb(shirt, arm, [(-.11, .075), (.121, .080), (.45, .061), (.74, .053), (.91, .052),
                      (1.08, .051), (1.32, .054), (1.52, .047), (1.76, .039), (1.93, .035), (1.98, .035)])
    limb(sewn, arm, [(1.88, .038), (1.92, .037), (1.988, .036)])
    leg = tuple(f"{bone}_{side}" for bone in ("thigh", "calf", "foot"))
    limb(pants, leg, [(-.08, .091), (.19, .091), (.43, .079), (.72, .069), (.93, .060),
                      (1.07, .056), (1.28, .055), (1.53, .051), (1.76, .044), (1.97, .043)])
    limb(sewn, leg, [(1.71, .045), (1.79, .046), (1.91, .043), (1.98, .042)])
    foot = joint(leg[-1])
    shoes.block((foot.x, .016, .112), (.106, .031, .238), leg[-1], .011)
    pants.block((foot.x, .041, .105), (.103, .047, .204), leg[-1], .013)
headwear.rings([ellipse(y, w, d, z=0.025, count=20) for y, w, d in
                [(1.585, .099, .098), (1.603, .104, .105), (1.616, .103, .102),
                 (1.661, .086, .084), (1.677, .055, .059), (1.68, .008, .007)]], [{"head": 1}] * 6)
headwear.block((0, 1.596, .125), (.148, .015, .079), "head", .006)
meshes = [body, shirt.make("斜袖与立领上衣"), pants.make("长裤与鞋面"), sewn.make("衣襟、袖口、裤脚"),
          shoes.make("鞋底与衣扣"), headwear.make("布帽与帽檐")]


def rest_matrix(bone, target):
    matrix = bone.matrix.copy()
    direction = (bone.tail - bone.head).normalized()
    rotation = direction.rotation_difference((target - bone.head).normalized()).to_matrix().to_4x4()
    pos = matrix.translation.copy()
    matrix.translation = (0, 0, 0)
    bone.matrix = Matrix.Translation(pos) @ rotation @ matrix
    bpy.context.view_layer.update()


def bake_pose(name, phase=None):
    for bone in rig.pose.bones:
        bone.matrix_basis.identity()
    bpy.context.view_layer.update()
    for sign, side in ((-1, "l"), (1, "r")):
        step = 0 if phase is None else sin(phase) * sign
        upper = rig.pose.bones[f"upperarm_{side}"]
        lower = rig.pose.bones[f"lowerarm_{side}"]
        hand = Vector((upper.head.x - sign * 0.056, -0.10 + 0.208 * step, 0.88 + 0.062 * abs(step)))
        elbow = Vector((upper.head.x - sign * 0.032, 0.028 + 0.105 * step, 1.075))
        rest_matrix(upper, elbow)
        rest_matrix(lower, hand)
        thigh = rig.pose.bones[f"thigh_{side}"]
        shin = rig.pose.bones[f"calf_{side}"]
        toe = rig.pose.bones[f"foot_{side}"]
        rest_matrix(thigh, Vector((thigh.head.x * .98, -.10 - .169 * step, .474 - .025 * max(step, 0))))
        rest_matrix(shin, Vector((thigh.head.x * 1.18, -.03 - .29 * step, .069 + .06 * max(step, 0))))
        rest_matrix(toe, toe.head + Vector((0.0, -.13, -.045 + .045 * max(0, step))))
    deps = bpy.context.evaluated_depsgraph_get()
    snapshots = []
    for obj in meshes:
        mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(deps))
        part = bpy.data.objects.new(name + " · " + obj.name, mesh)
        bpy.context.collection.objects.link(part)
        snapshots.append(part)
    active(snapshots[0])
    for obj in snapshots:
        obj.select_set(True)
    bpy.ops.object.join()
    merged = bpy.context.object
    merged.name = name
    mod = merged.modifiers.new("远景轮廓减面", "DECIMATE")
    merged.data.calc_loop_triangles()
    mod.ratio = min(1, 2670 / len(merged.data.loop_triangles))
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    return merged


# 先输出绑定姿态，再烘焙远景走路的四个相位和站定姿势。
save_and_export("于都人物", out, editable, selection=[rig, *meshes])
poses = [bake_pose("idle")] + [bake_pose(f"walk-{i}", i * pi / 2 + pi / 4) for i in range(4)]
bpy.ops.object.select_all(action="DESELECT")
for pose in poses:
    pose.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out / "于都队伍.glb"), export_format="GLB", use_selection=True, export_yup=True)
