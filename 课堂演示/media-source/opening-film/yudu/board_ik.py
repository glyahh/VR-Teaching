"""Native armature controls and pose-specific cloth correction for the Yudu insert."""

from bisect import bisect_right
from math import atan2, degrees, pi, radians, tanh

import bmesh
import bpy
from mathutils import Matrix, Quaternion, Vector

from river_scene import BRIDGE_X, DOOR_DEPTH, DOOR_THICKNESS, DOOR_WIDTH, HERO_HULL_Y, STAGING_HEIGHT, ease


SIDES = (('l', 1), ('r', -1))
FINGERS = ('index', 'middle', 'ring', 'pinky', 'thumb')
UP = Vector((0, 0, 1))
GRASPS = {}
GRASP_DEFAULT = (
    .067, 0, .018, -.16, .22, 0,
    -13, 18, 16, -8, 14, 17, -7, 14, 13, -4, 18, 16, 9, 19, 14,
)

# Time, lateral weight shift, hips back, hips down, pelvis, lumbar, chest, chest turn.
STERN = (
    (0, .008, .024, .089, 12, 8, 0, -3),
    (12, .017, .044, .126, 15, 8, 2, -4),
    (29, .055, .107, .275, 21, 16, 6, -5),
    (45, .075, .174, .418, 25, 22, 8, -2),
    (53, .074, .173, .428, 25, 22, 7, -1),
    (58, .068, .168, .433, 24, 21, 6, 0),
    (65, .054, .150, .393, 22, 18, 3, 1),
    (73, .039, .105, .289, 17, 14, 0, 2),
    (82, .016, .050, .143, 10, 8, -2, 0),
    (85, .013, .044, .128, 9, 6, -2, -1),
)
BOW = (
    (0, .013, .045, .108, 14, 7, 0, 3),
    (14, .022, .061, .151, 16, 10, 2, 3),
    (29, .051, .117, .282, 21, 18, 5, 4),
    (46, .081, .165, .421, 25, 22, 7, 5),
    (54, .082, .166, .430, 25, 22, 8, 3),
    (62, .077, .166, .431, 24, 23, 9, 1),
    (68, .067, .154, .408, 22, 22, 7, -1),
    (76, .047, .121, .325, 18, 16, 4, -1),
    (85, .032, .061, .172, 11, 9, -1, 0),
)


def pose_at(table, frame):
    times = [row[0] for row in table]
    index = min(len(times) - 2, max(0, bisect_right(times, frame) - 1))
    a, b = table[index:index + 2]
    interval = b[0] - a[0]
    t = (frame - a[0]) / interval

    def tangent(prev, now, after, field):
        if prev[0] == now[0]:
            return (after[field] - now[field]) / (after[0] - now[0])
        if after[0] == now[0]:
            return (now[field] - prev[field]) / (now[0] - prev[0])
        start = (now[field] - prev[field]) / (now[0] - prev[0])
        end = (after[field] - now[field]) / (after[0] - now[0])
        return 2 * start * end / (start + end) if start * end > 0 else 0

    return tuple(
        (2*t**3 - 3*t*t + 1) * a[field]
        + (t**3 - 2*t*t + t) * interval * tangent(table[max(0, index-1)], a, b, field)
        + (-2*t**3 + 3*t*t) * b[field]
        + (t**3 - t*t) * interval * tangent(a, b, table[min(len(table)-1, index+2)], field)
        for field in range(1, len(a))
    )


def rotation(x, y=0.0, z=0.0):
    return (Quaternion(UP, radians(z))
            @ Quaternion((0, 1, 0), radians(y))
            @ Quaternion((1, 0, 0), radians(x)))


def frame_axes(forward, across):
    unit = forward.normalized()
    width = (across - unit * across.dot(unit)).normalized()
    return Matrix((unit, width, unit.cross(width))).transposed()


def transform(loc, quat, scale=1.0):
    return Matrix.LocRotScale(loc, quat, Vector((scale,) * 3))


def angle_wrap(value):
    return (value + pi) % (2*pi) - pi


def mm(value):
    return round(value * 1000, 3)


class Grip:
    def __init__(self, worker, side, width):
        self.worker = worker
        self.side = side
        self.width = width
        self.bone = f'hand_{side}'
        rest = worker.rest
        self.wrist = rest[self.bone].translation
        heads = [rest[f'{finger}_01_{side}'].translation for finger in FINGERS[:4]]
        self.forward = (sum(heads, Vector()) / len(heads) - self.wrist).normalized()
        self.axes = frame_axes(self.forward, heads[0] - heads[3])
        self.normal = self.axes.col[2] * width
        self.finger_axes = {}
        for finger in FINGERS:
            for i in range(1, 4):
                name = f'{finger}_{i:02d}_{side}'
                bone = rest[name]
                desired = -self.axes.col[1] if finger == 'thumb' else self.normal
                curl_axis = bone.to_3x3().col[1].cross(desired).normalized()
                self.finger_axes[name] = bone.to_3x3().transposed() @ curl_axis

        self.regions = self.skin_regions(worker.skin)
        self.grasp = GRASPS.get(worker.label, {}).get(side, GRASP_DEFAULT)
        self.grip_transform = self.place(self.grasp)
        self.anchor = bpy.data.objects.new(f'{worker.label} {side} · door end grip', None)
        bpy.context.collection.objects.link(self.anchor)
        self.anchor.empty_display_size = .035
        self.anchor.empty_display_type = 'ARROWS'
        self.anchor.parent = worker.door
        self.anchor.matrix_parent_inverse = Matrix.Identity(4)
        self.anchor.matrix_basis = self.grip_transform

    def place(self, grasp):
        across, lateral, height, pitch, fan, bank = grasp[:6]
        end = self.worker.end
        ysign = -end * self.width
        forward = Vector((-end, fan * ysign, pitch))
        normal = Quaternion(forward.normalized(), bank * self.width) @ UP
        rest_rot = self.rotation_for(forward, normal)
        return transform(Vector((end * (DOOR_WIDTH / 2 + across), ysign * DOOR_DEPTH * .335 - .012 + lateral,
                                 -DOOR_THICKNESS / 2 - height)), rest_rot, self.worker.scale)

    def rotation_for(self, forward, palm_normal):
        across = palm_normal.cross(forward) * self.width
        return (frame_axes(forward, across) @ self.axes.transposed() @
                self.worker.rest[self.bone].to_3x3()).to_quaternion()

    def skin_regions(self, skin):
        names = {g.index: g.name for g in skin.vertex_groups}
        parts = {'palm': [], **{finger: [] for finger in FINGERS}, 'hand': []}
        for vertex in skin.data.vertices:
            weights = {names[w.group]: w.weight for w in vertex.groups if w.weight > .02}
            ownership = sum(value for name, value in weights.items()
                            if name == self.bone or (name.endswith('_' + self.side) and name.split('_')[0] in FINGERS))
            if ownership < .40:
                continue
            parts['hand'].append(vertex.index)
            relative = vertex.co - self.wrist
            finger = max(weights, key=weights.get).split('_')
            if weights.get(self.bone, 0) > .61 and .037 < relative.dot(self.forward) < .108:
                parts['palm'].append(vertex.index)
            elif len(finger) == 3 and finger[0] in FINGERS and finger[2] == self.side and finger[1] in ('02', '03'):
                parts[finger[0]].append(vertex.index)
        return parts

    def curl(self, openness):
        # Knuckles flex modestly. The two small joints curl up at the lower arris.
        hold = (self.grasp[i:i+3] for i in range(6, len(self.grasp), 3))
        free = ((2, -2, 1), (3, -1, 1), (5, 3, 1), (6, 5, 2), (6, 4, 2))
        relaxed = ((15, 16, 9), (19, 21, 12), (24, 23, 14), (28, 25, 15), (17, 9, 8))
        for finger, holding, opening, resting in zip(FINGERS, hold, free, relaxed):
            for i, (closed, opened, loose) in enumerate(zip(holding, opening, resting), 1):
                name = f'{finger}_{i:02d}_{self.side}'
                opening_weight, rest_weight = openness
                flex = (closed + (opened - closed) * opening_weight) * (1 - rest_weight) + loose * rest_weight
                self.worker.rig.pose.bones[name].rotation_quaternion = Quaternion(self.finger_axes[name], radians(flex))


class Worker:
    def __init__(self, rig, door, end):
        self.rig = rig
        self.door = door
        self.end = end
        self.label = 'Stern' if end == -1 else 'Bow'
        self.scale = rig.scale.x
        self.skin = next(ob for ob in rig.children if ob.name.startswith('头颈与手'))
        self.shoes = next(ob for ob in rig.children if ob.name.startswith('鞋底'))
        self.shirt = next(ob for ob in rig.children if ob.name.startswith(('片头 · 裁片上衣', '斜袖与立领上衣')))
        self.rest = {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}
        self.yaw = -end * radians(96 if end < 0 else 95)
        self.turn = Quaternion(UP, self.yaw)
        self.rig.location = (BRIDGE_X + end * 1.730,
                             HERO_HULL_Y + (.069 if end < 0 else -.004), STAGING_HEIGHT)
        self.rig.rotation_mode = 'QUATERNION'
        self.rig.rotation_quaternion = self.turn
        self.grips = {side: Grip(self, side, width) for side, width in SIDES}
        self.constraints = {}
        self.anchors = {}
        self.feet = {}
        self.sole_points = {}
        self.twists = {side: 0.0 for side, _ in SIDES}
        self.wrist_turn = {}
        self.controls = []
        self.make_controls()
        self.rebind_shoes()
        self.rebind_sleeves()
        self.fit_trouser_rise()
        self.build_correctives()
        self.pose_keys = [*self.controls, *(f'{finger}_{i:02d}_{side}' for finger in FINGERS
                          for i in range(1, 4) for side, _ in SIDES)]

    def add_bone(self, name, head, tail, kind, parent=None, roll_axis=None):
        edit = self.rig.data.edit_bones
        bone = edit.new(name)
        bone.head, bone.tail = head, tail
        bone.use_deform = kind == 'Skin'
        if parent:
            bone.parent = edit[parent]
        if roll_axis is not None:
            bone.align_roll(roll_axis)
        self.rig.data.collections[kind].assign(bone)
        return bone

    def clone_bone(self, name, source, kind, parent=None):
        reference = self.rig.data.edit_bones[source]
        bone = self.add_bone(name, reference.head, reference.tail, kind, parent)
        bone.roll = reference.roll
        return bone

    def mech_chain(self, prefix, names, parent):
        edit = self.rig.data.edit_bones
        first, second, tip = (edit[name] for name in names)
        axis = (second.head - first.head).cross(tip.head - second.head).normalized()
        upper = self.add_bone(f'Solve {prefix} upper', first.head, second.head, 'Mechanism', parent, axis)
        lower = self.add_bone(f'Solve {prefix} lower', second.head, tip.head, 'Mechanism', upper.name, axis)
        lower.use_connect = True
        self.clone_bone(f'Follow {names[0]}', names[0], 'Mechanism', upper.name)
        self.clone_bone(f'Follow {names[1]}', names[1], 'Mechanism', lower.name)
        self.clone_bone(f'Place {prefix}', names[2], 'Controls')
        self.add_bone(f'Pole {prefix}', first.head, first.head + Vector((0, .09, 0)), 'Controls')
        self.controls.extend((f'Place {prefix}', f'Pole {prefix}'))

    def add_constraint(self, name, kind, target, label):
        constraint = self.rig.pose.bones[name].constraints.new(kind)
        constraint.name = label
        constraint.target = self.rig
        constraint.subtarget = target
        if kind in ('COPY_ROTATION', 'COPY_TRANSFORMS'):
            constraint.target_space = constraint.owner_space = 'POSE'
        return constraint

    def connect_chain(self, prefix, names):
        upper, lower, tip = names
        ik = self.add_constraint(f'Solve {prefix} lower', 'IK', f'Place {prefix}', 'Two joints with a fixed hinge plane')
        ik.chain_count = 2
        ik.iterations = 100
        ik.use_stretch = False
        ik.pole_target = self.rig
        ik.pole_subtarget = f'Pole {prefix}'
        hinge = self.rig.pose.bones[f'Solve {prefix} lower']
        hinge.lock_ik_x = True
        hinge.lock_ik_y = True
        self.constraints[prefix] = (ik, upper, lower, tip)
        self.add_constraint(upper, 'COPY_TRANSFORMS', f'Follow {upper}', 'IK shoulder or hip')
        self.add_constraint(lower, 'COPY_TRANSFORMS', f'Follow {lower}', 'IK elbow or knee')
        self.add_constraint(tip, 'COPY_ROTATION', f'Place {prefix}', 'Contact orientation')

    def make_controls(self):
        rig = self.rig
        rig.data = rig.data.copy()
        rig.data.name = f'{self.label} · board lifter'
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.select_all(action='DESELECT')
        rig.select_set(True)
        for group in ('Controls', 'Mechanism', 'Skin'):
            rig.data.collections.new(group)
        bpy.ops.object.mode_set(mode='EDIT')
        for side, _ in SIDES:
            self.mech_chain(f'arm {side}', tuple(f'{name}_{side}' for name in ('upperarm', 'lowerarm', 'hand')),
                            f'clavicle_{side}')
            self.mech_chain(f'leg {side}', tuple(f'{name}_{side}' for name in ('thigh', 'calf', 'foot')), 'pelvis')
            self.clone_bone(f'Turn wrist {side}', f'hand_{side}', 'Controls')
            self.controls.append(f'Turn wrist {side}')
            elbow = self.rest[f'lowerarm_{side}'].translation
            wrist = self.rest[f'hand_{side}'].translation
            axis = self.rest[f'lowerarm_{side}'].to_3x3().col[2]
            for index, fraction in enumerate((.23, .54, .85), 1):
                name = f'Twist {index} {side}'
                origin = elbow.lerp(wrist, fraction)
                self.add_bone(name, origin, origin + (wrist - elbow).normalized() * .047, 'Skin', f'lowerarm_{side}', axis)
                self.controls.append(name)
        bpy.ops.object.mode_set(mode='OBJECT')
        rig.data.collections['Mechanism'].is_visible = False
        rig.data.collections['Skin'].is_visible = False
        for bone in rig.pose.bones:
            bone.rotation_mode = 'QUATERNION'
        self.controls.extend(('pelvis', 'spine_01', 'spine_03', 'neck_01', 'head'))
        for side, _ in SIDES:
            self.controls.extend((f'clavicle_{side}', f'Follow upperarm_{side}', f'Follow lowerarm_{side}'))
            self.connect_chain(f'arm {side}', tuple(f'{name}_{side}' for name in ('upperarm', 'lowerarm', 'hand')))
            self.connect_chain(f'leg {side}', tuple(f'{name}_{side}' for name in ('thigh', 'calf', 'foot')))
            self.rig.pose.bones[f'hand_{side}'].constraints[-1].subtarget = f'Turn wrist {side}'
            target = rig.pose.bones[f'Place arm {side}']
            constraint = target.constraints.new('COPY_TRANSFORMS')
            constraint.name = 'Heel of palm moves with the door until its load transfers'
            constraint.target = self.grips[side].anchor
            constraint.target_space = constraint.owner_space = 'WORLD'
            self.anchors[side] = constraint

        for side, width in SIDES:
            bone = self.rest[f'foot_{side}']
            foot_groups = {self.shoes.vertex_groups[name].index for name in (f'foot_{side}', f'ball_{side}')}
            foot = [v for v in self.shoes.data.vertices if any(g.group in foot_groups and g.weight > .10 for g in v.groups)]
            ground_local = min(v.co.z for v in foot)
            self.sole_points[side] = [v.index for v in foot if v.co.z < ground_local + .0035]
            ankle = Vector((width * (.145 if self.end < 0 else .149),
                            .055 * width - .004 * self.end,
                            bone.translation.z - ground_local + .0014 / self.scale))
            toe = Quaternion(UP, radians(width * (8 if self.end < 0 else 11)))
            self.feet[side] = transform(ankle, toe @ bone.to_quaternion())

    def rebind_shoes(self):
        self.shoes.data = self.shoes.data.copy()
        groups = {group.name: group for group in self.shoes.vertex_groups}
        sole_groups = {side: {groups[f'{kind}_{side}'].index for kind in ('foot', 'ball', 'calf')}
                       for side, _ in SIDES}
        for vertex in self.shoes.data.vertices:
            values = {g.group: g.weight for g in vertex.groups}
            side = max(sole_groups, key=lambda s: sum(values.get(i, 0) for i in sole_groups[s]))
            for index in values:
                self.shoes.vertex_groups[index].remove((vertex.index,))
            groups[f'foot_{side}'].add((vertex.index,), 1.0, 'REPLACE')

    def rebind_sleeves(self):
        self.shirt.data = self.shirt.data.copy()
        self.skin.data = self.skin.data.copy()
        for mesh in (self.shirt, self.skin):
            for side, _ in SIDES:
                base = mesh.vertex_groups[f'lowerarm_{side}']
                groups = [base, *(mesh.vertex_groups.new(name=f'Twist {i} {side}') for i in range(1, 4))]
                elbow = self.rest[f'lowerarm_{side}'].translation
                axis = self.rest[f'hand_{side}'].translation - elbow
                nodes = (.10, .36, .66, .94)
                for v in mesh.data.vertices:
                    bind = next((g.weight for g in v.groups if g.group == base.index), 0)
                    reach = (v.co - elbow).dot(axis) / axis.length_squared
                    if bind < .0001 or reach <= nodes[0]:
                        continue
                    section = min(2, bisect_right(nodes, reach) - 1)
                    amount = ease(reach, nodes[section], nodes[section + 1])
                    base.remove((v.index,))
                    if amount < 1:
                        groups[section].add((v.index,), bind * (1 - amount), 'REPLACE')
                    if amount > 0:
                        groups[section + 1].add((v.index,), bind * amount, 'REPLACE')

    def fit_trouser_rise(self):
        trousers = next(ob for ob in self.rig.children if ob.name.startswith('长裤'))
        trousers.data = trousers.data.copy()
        for vertex in trousers.data.vertices:
            x, y, z = vertex.co
            rise = ease(z, .750, .878)
            vertex.co.x = x * (1 - .073*rise)
            vertex.co.y = y * (1 - .149*rise)

    def build_correctives(self):
        shirt = self.shirt
        bm = bmesh.new()
        bm.from_mesh(shirt.data)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.000012)
        bm.to_mesh(shirt.data)
        bm.free()
        shirt.data.update()
        basis = shirt.shape_key_add(name='Rest tailoring')
        self.hem = shirt.shape_key_add(name='Coat hem over the trouser rise')
        for index, v in enumerate(basis.data):
            x, y, z = v.co
            outward = Vector((x, y + .006, 0)).normalized()
            mask = 1 - ease(z, .824, .996)
            if mask:
                wide = 1 - .34 * ease(-y, -.025, .095)
                lift = .011 * ease(abs(x), .045, .174)
                self.hem.data[index].co = v.co + mask * (.056 * wide * outward + Vector((0, 0, lift)))
        self.correctives = {}
        for side, width in SIDES:
            outer_elbow = shirt.shape_key_add(name=f'Elbow bend and cloth fullness {side}')
            shoulder = shirt.shape_key_add(name=f'Acromion reach fold {side}')
            self.correctives[side] = (outer_elbow, shoulder)
            elbow = self.rest[f'lowerarm_{side}'].translation
            acromion = self.rest[f'upperarm_{side}'].translation
            upper = (elbow - acromion).normalized()
            fore = (self.rest[f'hand_{side}'].translation - elbow).normalized()
            line = (upper + fore).normalized()
            inside = (fore - upper).normalized()
            for index, v in enumerate(basis.data):
                p = v.co - elbow
                u = p.dot(line)
                radial = p - line * u
                envelope = max(0.0, 1 - abs(u) / .087) ** 2
                if abs(v.co.x - elbow.x) < .113 and radial.length < .12 and envelope > 0:
                    inside_amount = max(0.0, radial.normalized().dot(inside))
                    crest = .0090 - .014 * inside_amount
                    crease = -.010 * inside_amount * ease(u, -.06, .025)
                    outer_elbow.data[index].co = v.co + envelope * (crest * radial.normalized() + crease * line)
                ac = v.co - acromion
                shoulder_mask = max(0.0, 1 - ac.length / .163) ** 2
                if shoulder_mask:
                    gather = Vector((width * .004, -.006, .021 * max(0, 1 - abs(ac.z - .024) / .085)))
                    shoulder.data[index].co = v.co + shoulder_mask * gather
        smoothing = shirt.modifiers.new('Light tailoring relaxation around arm deformation', 'CORRECTIVE_SMOOTH')
        smoothing.factor = .27
        smoothing.iterations = 3
        smoothing.use_pin_boundary = True

    def set_frame(self, name, matrix):
        bone = self.rig.pose.bones[name]
        bone.matrix_basis = bone.bone.matrix_local.inverted() @ matrix

    def rotate_rest(self, name, quat, offset=None):
        bone = self.rig.pose.bones[name]
        native = self.rest[name].to_quaternion()
        bone.rotation_quaternion = native.inverted() @ quat @ native
        if offset is not None:
            bone.location = native.inverted() @ Vector(offset)

    def upper_arm_root(self, side):
        """Evaluate only the authored FK branch before the arm solver runs."""
        chain = []
        part = self.rig.pose.bones[f'clavicle_{side}']
        while part is not None:
            chain.append(part)
            part = part.parent
        pose, parent = Matrix.Identity(4), Matrix.Identity(4)
        for bone in reversed(chain):
            reference = self.rest[bone.name]
            pose = pose @ parent @ reference @ bone.matrix_basis
            parent = reference.inverted()
        return pose @ parent @ self.rest[f'upperarm_{side}'].translation

    def author(self, frame):
        table = STERN if self.end < 0 else BOW
        lateral, back, down, hip, lumbar, chest, turn = pose_at(table, frame)
        reach = ease(frame, 8, 46) * (1 - .63 * ease(frame, 67, 85))
        look = ease(frame, 8 if self.end < 0 else 1, 48 if self.end < 0 else 39)
        recover = ease(frame, 65 if self.end < 0 else 71, 85)
        guide = -self.end
        self.rotate_rest('pelvis', rotation(hip, 3*guide, -3*guide), (guide*lateral, back, -down))
        self.rotate_rest('spine_01', rotation(lumbar, -1.8*guide, turn *.34))
        self.rotate_rest('spine_03', rotation(chest, -2.8*guide, turn *.66))
        self.rotate_rest('neck_01', rotation(-9 - 10*look + 4*recover, 2.6*guide, 5*guide))
        self.rotate_rest('head', rotation(4 + 12*look*(1-recover), -2*guide, guide*(4*look-13*recover)))

        inverse = self.rig.matrix_world.inverted()
        for side, width in SIDES:
            # Separate shoulder lift and protraction follow the arm on the far arris.
            accent = 1 + .15 * guide * width
            self.rotate_rest(f'clavicle_{side}', rotation(0, width*(-3.0 + 5.8*reach),
                                                         -width*(7.0 + 6.8*reach)*accent),
                             (0, -.007 - .012*reach*accent, .001 + .004*reach))
            self.set_frame(f'Place leg {side}', self.feet[side])
            knee = Vector((width * (.187 + .024*reach), -.614, .51 - .16*reach))
            self.set_frame(f'Pole leg {side}', transform(knee, Quaternion()))

            start = (56 if self.end < 0 else 61) + (1 if width == guide else 0)
            end = 83 if self.end < 0 else 85
            open_hand = ease(frame, start + 4, start + 10)
            unset = ease(frame, start, start + 8)
            lower_hand = ease(frame, start, start + 4)
            take_back = ease(frame, start + 4, start + 13)
            return_to_side = ease(frame, start + 9, end)
            grip = self.grips[side]
            grip_pose = inverse @ self.door.matrix_world @ grip.grip_transform
            grip_position, grip_turn, _ = grip_pose.decompose()
            release = grip_position + Vector((width * .049 * take_back, .187 * take_back, -.046 * lower_hand))
            side_hand = Vector((width * (.245 + .010*guide), -.107 - .005*recover, .516 + .220*recover))
            released_pos = release.lerp(side_hand, return_to_side)
            shoulder = self.upper_arm_root(side)
            forearm = self.rest[f'lowerarm_{side}'].translation
            fore_length = (self.rest[grip.bone].translation - forearm).length
            span = (self.rest[f'upperarm_{side}'].translation - forearm).length + fore_length
            direction = released_pos - shoulder
            threshold, softness = .83 * span, .16 * span
            if direction.length > threshold:
                length = threshold + softness * tanh((direction.length - threshold)/softness)
                released_pos = shoulder + direction.normalized() * length
            free_turn = grip.rotation_for(Vector((width*.058, -.27, -.965)), Vector((-width, 0, .18)))
            released_turn = grip_turn.slerp(free_turn, ease(frame, start + 6, end))
            self.set_frame(f'Place arm {side}', transform(released_pos, released_turn))
            self.anchors[side].influence = 1 - unset
            grip.curl((open_hand, ease(frame, start + 10, end)))
            effector = grip_position.lerp(released_pos, unset)
            effector_turn = grip_turn.slerp(released_turn, unset)
            semantic = self.rest[grip.bone].to_quaternion().inverted() @ grip.forward
            ray = (effector - shoulder).normalized()
            preferred = Vector((width * .62, .40, -.83))
            ergonomic = -(effector_turn @ semantic)
            steer = .77 - .25*return_to_side
            bend = preferred.normalized().lerp(ergonomic, steer)
            bend -= bend.dot(ray) * ray
            elbow_pole = shoulder.lerp(effector, .43) + .40*bend.normalized()
            self.set_frame(f'Pole arm {side}', transform(elbow_pole, Quaternion()))
            self.wrist_turn[side] = (grip_turn, ease(frame, start + 5, start + 16))
            self.set_frame(f'Turn wrist {side}', transform(effector, grip_turn))

    def calibrate_poles(self):
        def offset(prefix):
            _, upper, lower, tip = self.constraints[prefix]
            rig = self.rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
            bones = rig.pose.bones
            start = bones[upper].head
            goal = bones[f'Place {prefix}'].head
            bend = bones[lower].head - start
            pole = bones[f'Pole {prefix}'].head - start
            ray = (goal - start).normalized()
            bend -= ray * bend.dot(ray)
            pole -= ray * pole.dot(ray)
            return atan2(ray.dot(pole.cross(bend)), pole.dot(bend))

        for prefix, (ik, _, _, _) in self.constraints.items():
            ik.pole_angle = 0
            bpy.context.view_layer.update()
            first = offset(prefix)
            ik.pole_angle = pi / 2
            bpy.context.view_layer.update()
            sign = 1 if angle_wrap(offset(prefix) - first) > 0 else -1
            ik.pole_angle = angle_wrap(-first * sign)
            bpy.context.view_layer.update()
            residual = offset(prefix)
            assert abs(residual) < .05, (self.label, prefix, degrees(residual))

    def finish_pose(self):
        evaluated = self.rig.evaluated_get(bpy.context.evaluated_depsgraph_get())
        flexion = []
        for side, width in SIDES:
            fore = f'lowerarm_{side}'
            hand = f'hand_{side}'
            adapter = evaluated.pose.bones[f'Follow {fore}']
            posed_fore = (adapter.parent.matrix @ adapter.parent.bone.matrix_local.inverted() @ self.rest[fore]).to_quaternion()
            lower = evaluated.pose.bones[fore].vector
            ideal = lower.normalized().lerp(Vector((width*.035, -.25, -.967)), .21)
            relaxed = self.grips[side].rotation_for(ideal, Vector((-width, -.14, .17)))
            held, release = self.wrist_turn[side]
            posed_hand = held.slerp(relaxed, release)
            position = evaluated.pose.bones[hand].head
            self.set_frame(f'Turn wrist {side}', transform(position, posed_hand))
            default = self.rest[fore].to_quaternion().inverted() @ self.rest[hand].to_quaternion()
            delta = posed_fore.inverted() @ posed_hand @ default.inverted()
            _, angle = delta.to_swing_twist('Y')
            self.twists[side] += angle_wrap(angle - self.twists[side])
            for name, fraction in ((f'Follow upperarm_{side}', .19), (f'Follow lowerarm_{side}', .35)):
                self.rig.pose.bones[name].rotation_quaternion = Quaternion((0, 1, 0), self.twists[side] * fraction)
            for i, fraction in enumerate((.12, .31, .54), 1):
                bone = self.rig.pose.bones[f'Twist {i} {side}']
                bone.rotation_quaternion = Quaternion((0, 1, 0), self.twists[side] * fraction)
            upper = evaluated.pose.bones[f'upperarm_{side}'].vector
            fold, shoulder = self.correctives[side]
            fold.value = ease(degrees(upper.angle(lower)), 32, 104)
            clavicle = self.rig.pose.bones[f'clavicle_{side}'].rotation_quaternion
            shoulder.value = ease(degrees(clavicle.angle), 6, 16)
            thigh = evaluated.pose.bones[f'thigh_{side}'].vector
            calf = evaluated.pose.bones[f'calf_{side}'].vector
            flexion.append(degrees(thigh.angle(calf)))
        self.hem.value = .28 + .72 * ease(sum(flexion)/len(flexion), 42, 106)

    def key_authoring(self, frame):
        for name in self.pose_keys:
            bone = self.rig.pose.bones[name]
            bone.keyframe_insert('location', frame=frame, group=name)
            bone.keyframe_insert('rotation_quaternion', frame=frame, group=name)
        for side, _ in SIDES:
            self.anchors[side].keyframe_insert('influence', frame=frame)
            for key in self.correctives[side]:
                key.keyframe_insert('value', frame=frame)
        self.hem.keyframe_insert('value', frame=frame)

    def audit(self, door_surfaces, last):
        depsgraph = bpy.context.evaluated_depsgraph_get()
        rig = self.rig.evaluated_get(depsgraph)
        hand_mesh = self.skin.evaluated_get(depsgraph)
        shoe_mesh = self.shoes.evaluated_get(depsgraph)
        door_relation = self.door.matrix_world.inverted() @ hand_mesh.matrix_world
        diagnostics = {}
        keep = {}

        def distance(vertex):
            point = door_relation @ hand_mesh.data.vertices[vertex].co
            hit, normal, _, gap = door_surfaces.find_nearest(point)
            return gap if (point - hit).dot(normal) >= 0 else -gap

        for side, _ in SIDES:
            b = rig.pose.bones
            hand = b[f'hand_{side}']
            wrist = b[f'Place arm {side}'].head
            ankle = b[f'foot_{side}'].head
            foot_goal = b[f'Place leg {side}'].head
            upper = b[f'upperarm_{side}'].vector
            lower = b[f'lowerarm_{side}'].vector
            thigh = b[f'thigh_{side}'].vector
            calf = b[f'calf_{side}'].vector
            sole = [shoe_mesh.matrix_world @ shoe_mesh.data.vertices[index].co for index in self.sole_points[side]]
            hand_regions = self.grips[side].regions
            contact = {name: mm(min((distance(vertex) for vertex in hand_regions[name]), key=abs))
                       for name in ('palm', *FINGERS) if hand_regions[name]}
            hits = {name: sum(abs(distance(vertex)) <= .003 for vertex in hand_regions[name])
                    for name in ('palm', *FINGERS)}
            signed = [distance(vertex) for vertex in hand_regions['hand']]
            grip = self.grips[side]
            rest_forward = self.rest[grip.bone].to_quaternion().inverted() @ grip.forward
            forward = hand.matrix.to_quaternion() @ rest_forward
            positions = [rig.matrix_world @ b[f'{name}_{side}'].head for name in ('upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot')]
            keep[side] = positions
            diagnostics[side] = {
                'grip_weight': round(self.anchors[side].influence, 5),
                'wrist_goal_mm': mm((hand.head - wrist).length * self.scale),
                'hand_wood_nearest_signed_mm': contact,
                'hand_wood_vertices_within_3mm': hits,
                'hand_vertices_inside_wood_over_2mm': sum(value < -.002 for value in signed),
                'hand_worst_signed_mm': mm(min(signed)),
                'ankle_goal_mm': mm((ankle - foot_goal).length * self.scale),
                'sole_to_footing_mm': [mm(min(v.z for v in sole) - STAGING_HEIGHT), mm(max(v.z for v in sole) - STAGING_HEIGHT)],
                'forearm_twist_deg': round(degrees(self.twists[side]), 3),
                'forearm_palm_angle_deg': round(degrees(lower.angle(forward)), 3),
                'elbow_bend_deg': round(degrees(upper.angle(lower)), 3),
                'knee_bend_deg': round(degrees(thigh.angle(calf)), 3),
                'joints_from_previous_frame_mm': [mm((a - z).length) for a, z in zip(positions, last[side])] if last else [],
            }
        return diagnostics, keep
