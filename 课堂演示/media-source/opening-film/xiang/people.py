"""Wading gait, supported step, and the production character rig."""

import math
import random
from dataclasses import dataclass

import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

from costumes import fit_cap, refine
from river import WATER_HEIGHT, assign, ground_height, image_texture, mix, node, principled, ramp, smoothstep, wet_cloth


@dataclass(frozen=True)
class Wader:
    name: str
    x: float
    y: float
    speed: float
    cadence: float
    phase: float
    yaw: float = -math.pi / 2
    lean: float = 0.19
    scale: float = 1.0
    palette: int = 0

    @property
    def forward(self):
        return Vector((math.sin(self.yaw), -math.cos(self.yaw), 0))

    @property
    def left(self):
        return Vector((math.cos(self.yaw), math.sin(self.yaw), 0))

    def walk_center(self, time):
        return Vector((self.x, self.y, 0)) + self.forward * self.speed * time


class RigPose:
    """Two-bone reach solved in armature space using the source rest matrices."""

    def __init__(self, rig, rest):
        self.rig = rig
        self.rest = rest
        self.basis = {}

    def base(self, name):
        parent, transform = self.rest[name]
        return self.matrix(parent) @ transform if parent else transform

    def matrix(self, name):
        base = self.base(name)
        return base @ self.basis[name] if name in self.basis else base

    def put(self, name, matrix):
        self.basis[name] = self.base(name).inverted() @ matrix

    def turn(self, name, rotation):
        current = self.matrix(name)
        self.orient(name, rotation @ current.to_quaternion())

    def orient(self, name, rotation):
        current = self.matrix(name)
        self.put(name, Matrix.LocRotScale(current.translation, rotation, None))

    def translate(self, name, offset):
        current = self.matrix(name)
        current.translation += offset
        self.put(name, current)

    def point(self, name):
        return self.matrix(name).translation

    def aim(self, bone, child, target):
        origin = self.point(bone)
        current = self.point(child) - origin
        desired = target - origin
        self.turn(bone, current.rotation_difference(desired))

    def reach(self, upper, lower, end, target, bend):
        origin = self.point(upper)
        joint = self.point(lower)
        a = (joint - origin).length
        b = (self.point(end) - joint).length
        axis = (target - origin).normalized()
        distance = min(a + b - 0.001, max(abs(a - b) + 0.001, (target - origin).length))
        along = (a * a + distance * distance - b * b) / (2 * distance)
        side = (bend - axis * bend.dot(axis)).normalized()
        hinge = origin + along * axis + math.sqrt(max(0, a * a - along * along)) * side
        self.aim(upper, lower, hinge)
        self.aim(lower, end, origin + axis * distance)

    def write(self):
        for name, basis in self.basis.items():
            self.rig.pose.bones[name].matrix_basis = basis


def source_rig(asset_dir, edit_rig=None):
    before = set(bpy.data.objects)
    if edit_rig:
        with bpy.data.libraries.load(str(edit_rig)) as (source, target):
            target.objects = [name for name in source.objects if not name.startswith(("Camera", "Light"))]
        for obj in target.objects:
            if obj and obj.type in {"ARMATURE", "MESH"}:
                bpy.context.scene.collection.objects.link(obj)
    else:
        bpy.ops.import_scene.gltf(filepath=str(asset_dir / "river-people.glb"))
    added = set(bpy.data.objects) - before
    rig = next(obj for obj in added if obj.type == "ARMATURE")
    meshes = sorted((obj for obj in added if obj.type == "MESH" and len(obj.data.materials)), key=lambda obj: obj.name)
    for obj in added:
        if obj.type == "MESH" and not len(obj.data.materials):
            bpy.data.objects.remove(obj, do_unlink=True)
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()
    meshes = refine(rig, meshes)
    meshes.extend(create_packs(rig))
    return rig, meshes


def sack_geometry():
    rings = [
        (1.036, 0.79), (1.058, 0.97), (1.106, 1.04),
        (1.227, 0.99), (1.282, 0.77), (1.301, 0.36),
    ]
    vertices = []
    for level, (z, taper) in enumerate(rings):
        for i in range(24):
            a = math.tau * i / 24
            ripple = 1 + 0.045 * math.sin(5 * a + level * 0.6) + 0.05 * math.cos(3 * a)
            vertices.append((0.128 * taper * ripple * math.cos(a),
                             0.164 + 0.083 * taper * ripple * math.sin(a), z + 0.012 * math.cos(a)))
    faces = [tuple(reversed(range(24))), tuple(range(len(vertices) - 24, len(vertices)))]
    for level in range(len(rings) - 1):
        for i in range(24):
            point = level * 24 + i
            following = level * 24 + (i + 1) % 24
            faces.append((point, following, following + 24, point + 24))
    return vertices, faces


def create_packs(rig, shirt=None):
    def weighted_mesh(name, vertices, faces, color):
        data = bpy.data.meshes.new(name)
        data.from_pydata(vertices, [], faces)
        data.update()
        obj = bpy.data.objects.new(name, data)
        bpy.context.scene.collection.objects.link(obj)
        obj.parent = rig
        group = obj.vertex_groups.new(name="spine_03")
        group.add(list(range(len(vertices))), 1.0, "REPLACE")
        modifier = obj.modifiers.new("行囊随躯干受力", "ARMATURE")
        modifier.object = rig
        for poly in data.polygons:
            poly.use_smooth = True
        material = bpy.data.materials.new(name)
        material.use_nodes = True
        wet_cloth(material, color, False)
        data.materials.append(material)
        return obj

    verts, faces = sack_geometry()
    sack = weighted_mesh("扎口粗布行囊", verts, faces, (0.112, 0.077, 0.041))
    subdivision = sack.modifiers.new("细分布褶", "SUBSURF")
    subdivision.levels = subdivision.render_levels = 1
    points = [(0.088, 0.186, 1.246), (0.096, 0.112, 1.323), (0.104, 0.031, 1.353),
              (0.102, -0.038, 1.337), (0.100, -0.087, 1.284), (0.097, -0.104, 1.219),
              (0.098, -0.107, 1.160), (0.107, -0.101, 1.103), (0.113, -0.085, 1.050),
              (0.115, -0.021, 1.033), (0.119, 0.067, 1.053), (0.103, 0.137, 1.069)]
    surface = BVHTree.FromPolygons([v.co for v in shirt.data.vertices], [p.vertices[:] for p in shirt.data.polygons]) if shirt else None
    vertices, faces = [], []
    for sign in (-1, 1):
        lane = [(sign*x, y, z) for x,y,z in points]
        if surface:
            def trace(origin, ray, fallback):
                position, normal, _, _ = surface.ray_cast(Vector(origin), Vector(ray))
                return position + normal*.003 if position else Vector(fallback)

            x = sign*.108
            lane = [Vector((x,.187,1.255))]
            lane.extend(trace((x,y,1.61), (0,0,-1), (x,y,1.328)) for y in (.099,.065,.031,-.004,-.042,-.079))
            lane.extend(trace((x,-.65,z), (0,1,0), (x,-.117,z))
                        for z in (1.291,1.246,1.197,1.151,1.104,1.065))
            lane.extend((Vector((x,-.050,1.042)), Vector((x,.066,1.055)), Vector((x,.137,1.069))))
        start = len(vertices)
        for x, y, z in lane:
            vertices.extend(((x - 0.0085, y, z), (x + 0.0085, y, z)))
        for i in range(start, len(vertices) - 2, 2):
            faces.append((i, i + 1, i + 3, i + 2))
    straps = weighted_mesh("棉布背带", vertices, faces, (0.071, 0.055, 0.036))
    if shirt:
        torso = straps.vertex_groups["spine_03"]
        for side, width in (("l", 1), ("r", -1)):
            shoulder = straps.vertex_groups.new(name=f"clavicle_{side}")
            for v in straps.data.vertices:
                if v.co.x * width > 0 and v.co.z > 1.243:
                    amount = .23*smoothstep(v.co.z, 1.243, 1.342)
                    torso.add([v.index], 1-amount, "REPLACE")
                    shoulder.add([v.index], amount, "REPLACE")
    straps.modifiers.new("织带厚度", "SOLIDIFY").thickness = 0.002
    return [sack, straps]


PALETTES = [
    ((0.123, 0.129, 0.091), (0.091, 0.095, 0.068), (0.114, 0.118, 0.084)),
    ((0.134, 0.105, 0.070), (0.095, 0.083, 0.055), (0.118, 0.097, 0.065)),
    ((0.104, 0.122, 0.114), (0.070, 0.088, 0.082), (0.090, 0.111, 0.103)),
    ((0.153, 0.148, 0.118), (0.109, 0.106, 0.082), (0.117, 0.116, 0.095)),
]


def make_waders(asset_dir, specs, edit_rig, cast_assets):
    source, meshes = source_rig(asset_dir, edit_rig)
    inherited = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(cast_assets / "performer-final.glb"))
    applied = set(bpy.data.objects) - inherited
    professional = next(ob for ob in applied if ob.type == "ARMATURE")
    tailored = sorted((ob for ob in applied if ob.type == "MESH" and ob.parent == professional),
                      key=lambda ob: ob.name)
    professional_shirt = next(ob for ob in tailored if ob.name.startswith("斜袖与立领上衣"))
    fit_cap(next(ob for ob in tailored if ob.name.startswith("布帽")),
            next(ob for ob in tailored if ob.name.startswith("头颈与手")))
    tailored += create_packs(professional, professional_shirt)
    rest = {}
    for bone in source.data.bones:
        parent = bone.parent
        relative = parent.matrix_local.inverted() @ bone.matrix_local if parent else bone.matrix_local.copy()
        rest[bone.name] = (parent.name if parent else None, relative)
    material_sets = []
    for index, palette in enumerate(PALETTES):
        substitutions = {}
        for material in {m for obj in meshes + tailored for m in obj.data.materials if m}:
            new = material.copy()
            name = material.name
            if name.startswith(("上衣 · 裁片", "长裤 · 粗布裁片", "旧鞋 · 布鞋")):
                cloth = principled(new)
                color_socket = cloth.inputs["Base Color"]
                texture = color_socket.links[0].from_socket
                tint = ((0.15, 0.213, 0.229) if index == 2 else tuple(c * 1.52 for c in palette[0])) if name.startswith("上衣") else palette[1]
                tree = new.node_tree
                dry_color = mix(tree, 1, texture, (*tint, 1), "MULTIPLY")
                position = node(tree, "ShaderNodeNewGeometry").outputs["Position"]
                height = node(tree, "ShaderNodeSeparateXYZ")
                assign(tree, position, height.inputs[0])
                dry = ramp(tree, height.outputs["Z"], WATER_HEIGHT + .025, WATER_HEIGHT + .49)
                dark = mix(tree, 1, dry_color, (.54, .60, .63, 1), "MULTIPLY")
                assign(tree, mix(tree, dry, dark, dry_color), color_socket)
                cloth.inputs["Roughness"].default_value = 0.83
                cloth.inputs["Sheen Weight"].default_value = .10
            elif name.startswith(("上衣", "长裤", "布帽", "布领", "旧鞋")):
                if name.startswith("上衣"):
                    color = palette[0]
                elif name.startswith("长裤"):
                    color = palette[1]
                elif name.startswith("布帽"):
                    color = palette[2]
                elif name.startswith("布领"):
                    color = tuple(value * 0.71 for value in palette[0])
                else:
                    color = (0.052, 0.041, 0.027)
                wet_cloth(new, color, name.startswith(("上衣", "长裤", "旧鞋")))
            if name.startswith("肤色"):
                tree = new.node_tree
                p = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
                uv = node(tree, "ShaderNodeTexCoord").outputs["UV"]
                skin_file = cast_assets / ("skin-young.jpg" if index in (0, 2) else "skin-middle.jpg")
                skin_texture = image_texture(tree, skin_file, uv)
                tint = ((0.74, 0.74, 0.71, 1), (0.79, 0.76, 0.71, 1),
                        (0.68, 0.72, 0.72, 1), (0.74, 0.73, 0.68, 1))[index]
                assign(tree, mix(tree, 1.0, skin_texture, tint, "MULTIPLY"), p.inputs["Base Color"])
                p.inputs["Roughness"].default_value = 0.62
                p.inputs["Subsurface Weight"].default_value = 0.055
            if name.startswith("扎口粗布"):
                wet_cloth(new, ((0.109, 0.073, 0.044), (0.123, 0.102, 0.062),
                                (0.085, 0.073, 0.054), (0.140, 0.110, 0.067))[index], False)
            substitutions[material] = new
        material_sets.append(substitutions)

    cast = []
    for index, spec in enumerate(specs):
        detail = index < 6
        rig = (professional if detail else source).copy()
        rig.name = spec.name
        rig.animation_data_clear()
        bpy.context.scene.collection.objects.link(rig)
        wardrobe = tailored if detail else meshes
        bare_head = index in (1, 3)
        for mesh in wardrobe:
            if detail and ((bare_head and mesh.name.startswith("布帽")) or
                           (not bare_head and mesh.name.startswith("短发"))):
                continue
            obj = mesh.copy()
            if index >= 2:
                obj.name = f"{spec.name} · {mesh.name}"
            bpy.context.scene.collection.objects.link(obj)
            obj.parent = rig
            for modifier in obj.modifiers:
                if modifier.type == "ARMATURE":
                    modifier.object = rig
                    modifier.use_deform_preserve_volume = True
            if detail and mesh.name.startswith("头颈与手") and index in (0, 4):
                obj.data = obj.data.copy()
                obj.data.shape_keys.key_blocks["面颊与下颌"].value = .85
            for slot in obj.material_slots:
                material = slot.material
                slot.link = "OBJECT"
                slot.material = material_sets[spec.palette][material]
        cast.append((spec, rig))
    for ob in [*meshes, *set(tailored).union(applied), source]:
        bpy.data.objects.remove(ob, do_unlink=True)
    return cast, rest


def final_specs():
    specs = [
        Wader("涉水 · 前方试探", -1.22, -1.98, 0.57, 0.85, 0.73, lean=0.24, palette=3),
        Wader("涉水 · 侧后扶持", -0.84, -2.50, 0.57, 0.91, 0.32, yaw=-1.55, lean=0.15, scale=1.035, palette=2),
    ]
    rng = random.Random(19341127)
    for i, (x, y) in enumerate([
        (0.6, -0.75), (1.5, -1.5), (1.8, 0.36), (2.8, -0.42), (3.6, 0.65),
        (4.1, 1.78), (5.1, 0.4), (5.9, 1.45), (6.9, 2.46), (7.6, 1.10),
        (9.0, 2.18), (10.1, 2.58), (11.0, 3.3), (12.2, 3.06), (13.6, 4.03),
        (15.0, 4.42), (16.1, 5.2), (17.25, 4.83), (18.6, 5.62), (20.0, 6.3),
    ]):
        specs.append(Wader(f"队伍 · {i + 3:02d}", x, y, rng.uniform(0.49, 0.66), rng.uniform(0.79, 1.04),
                           rng.random(), -math.pi / 2 + rng.uniform(-0.14, 0.12),
                           rng.uniform(0.10, 0.29), rng.uniform(0.91, 1.05), i % len(PALETTES)))
    return specs


def matched_specs(progress):
    # Old scatter consumed these values before assigning the troop lanes.
    state = 19341127
    random_values = []
    for _ in range(36 * 5 + 4 + 85 * 5 + 42 * 5 + 78):
        state = (state * 1664525 + 1013904223) & 0xffffffff
        random_values.append(state / 4294967296)
    count = max(18, round(78 * (1 - 0.64 * smoothstep(progress, 0.25, 0.95))))
    specs = []
    for i, value in enumerate(random_values[-78:][:count]):
        offset = (i // 5) * 1.48 + (i % 3) * 0.42
        x = 26 - progress * 44 + offset * 0.72
        if x < -34 or x > 32:
            continue
        y = -(((i % 5) - 2) * 2.25 + math.sin(x * 0.14 + value * 6.28) * 1.15)
        specs.append(Wader(f"旧机位 · {i:02d}", x, y, 0.38, 0.9, value * 6.28,
                           -math.pi / 2 + (i % 3 - 1) * 0.082, 0.10, 1, i % len(PALETTES)))
    return specs


def frozen_waders(asset_dir, specs):
    """Keep the original idle vertices and placements for the before/after still."""
    previous = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(asset_dir / "river-crowd.glb"))
    bpy.context.view_layer.update()
    imported = set(bpy.data.objects) - previous
    idle = next(obj for obj in imported if obj.type == "MESH" and obj.name == "idle")
    idle_transform = idle.matrix_world.copy()
    for material in idle.data.materials:
        name = material.name
        if name.startswith("上衣"):
            wet_cloth(material, (0.121, 0.129, 0.106), True)
        elif name.startswith("长裤"):
            wet_cloth(material, (0.093, 0.105, 0.088), True)
        elif name.startswith("布帽"):
            wet_cloth(material, (0.108, 0.117, 0.106), False)
    feet = []
    for spec in specs:
        height = max(WATER_HEIGHT - 0.52, ground_height(spec.x, spec.y, True))
        transform = Matrix.LocRotScale((spec.x, spec.y, height), Quaternion((0, 0, 1), spec.yaw), None)
        clone = idle.copy()
        clone.name = spec.name
        bpy.context.scene.collection.objects.link(clone)
        clone.parent = None
        clone.matrix_world = transform @ idle_transform
        feet.append([(transform @ Vector((sign * 0.15, -0.026, WATER_HEIGHT - height)), 0.31, 0)
                     if height < WATER_HEIGHT else (None, 0, 0) for sign in (-1, 1)])
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    return feet


def foot_target(spec, time, sign):
    phase = time * spec.cadence + spec.phase + (0.5 if sign < 0 else 0)
    foot_phase = phase % 1.0
    plant_time = time - foot_phase / spec.cadence
    stride = spec.speed / spec.cadence
    plant = spec.walk_center(plant_time) + spec.forward * (stride * 0.29)
    plant += spec.left * (sign * 0.145 * spec.scale)
    swing = smoothstep(foot_phase, 0.64, 1.0)
    plant += spec.forward * stride * swing
    raise_fraction = max(0.0, (foot_phase - 0.64) / 0.36)
    lift = math.sin(math.pi * raise_fraction) ** 1.3
    bed = ground_height(plant.x, plant.y)
    plant.z = bed + spec.scale * (0.073 + lift * (0.155 + 0.042 * abs(sign)))
    return plant, foot_phase, lift


def curl_fingers(pose, suffix, sign, amount):
    index_base = pose.point(f"index_01_{suffix}")
    width = (pose.point(f"pinky_01_{suffix}") - index_base).normalized()
    for finger, flex in (("index", .78), ("middle", .97), ("ring", 1.06), ("pinky", 1.14)):
        for segment, portion in ((1, .55), (2, .70), (3, .40)):
            pose.turn(f"{finger}_{segment:02d}_{suffix}", Quaternion(width, sign * amount * flex * portion))


def animate_crowd(cast, rest, time):
    wakes = []
    for index, (spec, rig) in enumerate(cast, 2):
        phase = math.tau * (time * spec.cadence + spec.phase)
        body = spec.walk_center(time) + spec.left * ((.025 + .004*(index % 5)) * math.sin(phase))
        body.z = ground_height(body.x, body.y)
        yaw = spec.yaw + .036 * math.sin(phase + index*.41)
        matrix = Matrix.LocRotScale(body, Quaternion((0, 0, 1), yaw), Vector((spec.scale,) * 3))
        rig.matrix_world = matrix
        local = matrix.inverted()
        pose = RigPose(rig, rest)
        rhythm, turn = math.sin(phase), math.cos(phase)
        drop = -.072 - .011*(index % 4) + .022 * math.cos(2*phase)
        pose.translate("pelvis", Vector((.009*rhythm, .019 + .008*turn, drop)))
        pose.turn("pelvis", Quaternion((0,0,1), .038*rhythm) @ Quaternion((0,1,0), .023*turn))
        pose.turn("spine_01", Quaternion((1,0,0), spec.lean + .035*math.sin(.38*phase))
                  @ Quaternion((0,0,1), -.066*rhythm))
        pose.turn("spine_03", Quaternion((0,1,0), (index%3 - 1)*.047 + .025*turn))
        pose.turn("neck_01", Quaternion((0,0,1), (index%5 - 2)*.059 + .063*math.sin(.33*phase)))
        pose.turn("head", Quaternion((1,0,0), .067*(index%3) - .071 + .050*math.cos(.73*phase)))
        foot_wakes = []
        for side, width in (("l", 1), ("r", -1)):
            foot, foot_phase, lift = foot_target(spec, time, width)
            foot_name = f"foot_{side}"
            neutral = pose.matrix(foot_name).to_quaternion()
            pose.reach(f"thigh_{side}", f"calf_{side}", foot_name,
                       local @ foot, Vector((width * (.07 + .018*(index%4)), -1, 0)))
            pose.orient(foot_name, Quaternion((0,0,1), width*.08)
                        @ Quaternion((1,0,0), lift*(-.26 + .37*foot_phase)) @ neutral)
            knee = matrix @ pose.point(f"calf_{side}")
            ankle = matrix @ pose.point(foot_name)
            if ankle.z < WATER_HEIGHT < knee.z:
                entry = ankle.lerp(knee, (WATER_HEIGHT - ankle.z) / (knee.z - ankle.z))
            elif body.z < WATER_HEIGHT:
                entry = Vector((knee.x, knee.y, WATER_HEIGHT))
            else:
                entry = None
            foot_wakes.append((entry, foot_phase, lift))

            swing = math.sin(phase + width*1.33 + .22*index)
            widthway = (.22 + .022*(index%5) + (.02 if width > 0 else 0)) * width
            wrist = Vector((widthway, -.105 - swing*(.062 + .014*(index%4)), .864 + .062*swing))
            bag_side = "l" if index%4 == 2 else "r"
            carries = index%5 in (2, 3) and side == bag_side
            if carries:
                wrist = Vector((width*.205, -.128 - .011*turn, 1.114 + .018*rhythm))
            elif index%5 == 4 and side == "l":
                wrist += Vector((.063, -.036, .117))
            hand, lower = f"hand_{side}", f"lowerarm_{side}"
            pose.reach(f"upperarm_{side}", lower, hand, wrist, Vector((width*.56, .16, -.93)))
            curling = .31 if carries else (.20 + .08*(index%4) + .09*swing)
            forearm = pose.point(hand) - pose.point(lower)
            natural = Vector((.13*width, -.34, -.90))
            direction = forearm.normalized().lerp(natural, .47).normalized()
            pose.aim(hand, f"middle_01_{side}", pose.point(hand) + direction)
            curl_fingers(pose, side, width, curling)
        pose.write()
        wakes.append(foot_wakes)
    return wakes
