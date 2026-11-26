"""Retarget captured walks to the two lanes of the Yudu night crossing."""

from dataclasses import dataclass
from math import atan2, cos, degrees, floor, pi, radians, sin, sqrt
from pathlib import Path
from random import Random
from zipfile import Path as ArchivePath, ZipFile

import bpy
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

from mocap import Capture
from river_cast import Actor, axes, bind, convert_and_bind, sack, skinned_material, textured_coat
from river_scene import (
    BRIDGE_X, DECK_MAX, DECK_MIN, DECK_Z, clamp, cord, ease, fine_bump, ground,
    load_meshes, mesh, mix, surface,
)


DATA = Path(__file__).resolve().with_name('night-mocap') / 'cmu-35-and-37.zip'
UP = Vector((0, 0, 1))
FORWARD = Vector((0, -1, 0))
DIGITS = ('index', 'middle', 'ring', 'pinky')
BODY = (('pelvis', 'root'), ('spine_01', 'lowerback'), ('spine_02', 'upperback'), ('spine_03', 'thorax'),
        ('neck_01', 'upperneck'), ('head', 'head'), ('clavicle_l', 'lclavicle'), ('clavicle_r', 'rclavicle'))
PALETTE = (
    ((.17, .21, .245), (.095, .123, .148)), ((.245, .201, .138), (.133, .104, .075)),
    ((.19, .22, .174), (.103, .131, .112)), ((.215, .22, .227), (.115, .128, .141)),
    ((.21, .175, .132), (.134, .12, .087)), ((.153, .18, .20), (.100, .113, .127)),
)


@dataclass(frozen=True)
class Style:
    capture: str
    period: float
    cadence: float
    lean: float
    arm_swing: float
    tuck: float


STYLES = {
    'heavy': Style('37_01', 1.23, .92, .137, .44, .018),
    'lamp': Style('35_01', 1.06, .98, .044, .60, .004),
    'steady': Style('37_01', 1.13, .95, .088, .64, .009),
    'free': Style('35_01', 1.04, 1.06, .026, 1.00, .000),
}


def support(x, y):
    """Continuous top surface from the bridge deck across its two landing boards."""
    if abs(x - BRIDGE_X) > 1.23:
        return ground(x, y)
    if DECK_MIN <= y <= DECK_MAX:
        return DECK_Z
    edge, direction = (DECK_MIN, -1) if y < DECK_MIN else (DECK_MAX, 1)
    distance = abs(y - edge)
    if distance < .70:
        return mix(DECK_Z, ground(x, edge + direction * .70) + .025, distance / .70)
    return ground(x, y) + .025 * (1 - ease(distance, .70, .93))


class WalkingSurface:
    """The visible timber and terrain surfaces in the final scene."""

    def __init__(self, scene):
        names = ('Crossing plank', 'Unequal door leaf stave', 'Shore landing boards',
                 'Banks, tributary profile and crossing paths')
        vertices, faces = [], []
        for obj in scene.objects:
            if obj.type != 'MESH' or not obj.name.startswith(names):
                continue
            base = len(vertices)
            vertices.extend(obj.matrix_world @ point.co for point in obj.data.vertices)
            faces.extend(tuple(base + index for index in polygon.vertices) for polygon in obj.data.polygons)
        self.surface = BVHTree.FromPolygons(vertices, faces)

    def height(self, point):
        # The ray considers only objects that carry weight. It passes through slat gaps to the shore below.
        hit, _, _, _ = self.surface.ray_cast(Vector((point.x, point.y, 3.0)), -UP, 7)
        return hit.z if hit is not None else support(point.x, point.y)


def pose_bone(actor, name, point, rotation):
    matrix = (rotation @ actor.rest[name].to_quaternion()).to_matrix().to_4x4()
    matrix.translation = point
    actor.set(name, matrix)


def segment_frame(axis, normal):
    forward = axis.normalized()
    across = normal.cross(forward).normalized()
    return Matrix((forward, across, forward.cross(across))).transposed()


def signed_plane_angle(before, after, axis):
    a = (before - axis * before.dot(axis)).normalized()
    b = (after - axis * after.dot(axis)).normalized()
    return atan2(axis.dot(a.cross(b)), a.dot(b))


def chain(actor, names, target, pole, wrist=None):
    first, second, end = names
    origin = actor.inherited(first).translation
    u0 = actor.rest_head[second] - actor.rest_head[first]
    v0 = actor.rest_head[end] - actor.rest_head[second]
    a, b = u0.length, v0.length
    reach = clamp((target - origin).length, abs(a - b) + .006, a + b - .005)
    toward = (target - origin).normalized()
    actual = origin + toward * reach
    hinge_axis = (pole - toward * pole.dot(toward)).normalized()
    chord = (a * a + reach * reach - b * b) / (2 * reach)
    hinge = origin + toward * chord + hinge_axis * sqrt(max(0, a * a - chord * chord))
    u, v = hinge - origin, actual - hinge
    normal, rest_normal = u.cross(v).normalized(), u0.cross(v0).normalized()
    upper = (segment_frame(u, normal) @ segment_frame(u0, rest_normal).transposed()).to_quaternion()
    lower = (segment_frame(v, normal) @ segment_frame(v0, rest_normal).transposed()).to_quaternion()
    twist, wrist_roll = 0, 0
    if wrist:
        rotation, prepared_bias = wrist
        radial = actor.palm[end[-1]][0].col[1]
        twist = signed_plane_angle(lower @ radial, rotation @ radial, v.normalized())
        # Forearm twists share wrist rotation in the elbow plane. The measured wrist channel biases the radius.
        shared = clamp(.80 * twist + prepared_bias, -1.47, 1.47)
        lower = Quaternion(v.normalized(), shared) @ lower
        wrist_roll = degrees(twist - shared)
    pose_bone(actor, first, origin, upper)
    pose_bone(actor, second, hinge, lower)
    return actual, v.normalized(), wrist_roll


def fold_fingers(actor, side, orientation, flex, thumb):
    sign = 1 if side == 'l' else -1
    palm = actor.palm[side][0]
    forward, radial = orientation @ palm.col[0], orientation @ palm.col[1]
    normal = sign * forward.cross(radial)
    for digit, amount in zip(DIGITS, flex):
        for joint, fraction in enumerate((.31, .43, .26), 1):
            name = f'{digit}_{joint:02d}_{side}'
            matrix = actor.inherited(name)
            rotation = Quaternion(radial, -sign * fraction * amount)
            posed = rotation.to_matrix().to_4x4() @ matrix
            posed.translation = matrix.translation
            actor.set(name, posed)
    for joint, fraction in enumerate((.55, .29, .16), 1):
        name = f'thumb_{joint:02d}_{side}'
        matrix = actor.inherited(name)
        rotation = Quaternion(forward, -sign * fraction * thumb * .56) @ Quaternion(normal, sign * fraction * thumb)
        posed = rotation.to_matrix().to_4x4() @ matrix
        posed.translation = matrix.translation
        actor.set(name, posed)


class Gait:
    def __init__(self, name, start, end, contacts):
        with ZipFile(DATA) as zip_file:
            capture = ArchivePath(zip_file)
            self.source = Capture(capture / (name.split('_')[0] + '.asf'), capture / (name + '.amc'))
        self.start, self.end = start, end
        self.contacts = contacts
        travel = Vector(self.source.point(end, 'root') - self.source.point(start, 'root'))
        self.axis = Quaternion(UP, -pi / 2 - atan2(travel.y, travel.x))
        self.body_average = {joint: self.mean_rotation(joint) for _, joint in BODY}
        self.root_start = self.point(start, 'root')
        self.root_end = self.point(end, 'root')
        self.z_mean = sum(self.point(i, 'root').z for i in range(start, end, 4)) / len(range(start, end, 4))

    def point(self, frame, joint):
        first = int(frame)
        u = frame - first
        return self.axis @ Vector(self.source.point(first, joint)).lerp(Vector(self.source.point(first + 1, joint)), u)

    def difference(self, phase, joint, proximal):
        raw = mix(self.start, self.end, phase)
        sample = self.point(raw, joint) - self.point(raw, proximal)
        delta = (self.point(self.end, joint) - self.point(self.end, proximal)
                 - self.point(self.start, joint) + self.point(self.start, proximal))
        return sample - delta * ease(phase, .73, 1)

    def raw_rotation(self, frame, joint):
        first = int(frame)
        a = Matrix(self.source.orientation(first, joint)).to_quaternion()
        b = Matrix(self.source.orientation(first + 1, joint)).to_quaternion()
        return a.slerp(b, frame - first)

    def mean_rotation(self, joint):
        mean = self.raw_rotation(self.start, joint)
        for i, frame in enumerate(range(self.start + 5, self.end, 5), 2):
            mean = mean.slerp(self.raw_rotation(frame, joint), 1 / i)
        return mean

    def body_rotation(self, phase, joint):
        raw = self.raw_rotation(mix(self.start, self.end, phase), joint)
        close = self.raw_rotation(self.end, joint).inverted() @ self.raw_rotation(self.start, joint)
        raw = raw @ Quaternion().slerp(close, ease(phase, .73, 1))
        return self.axis @ raw @ self.body_average[joint].inverted() @ self.axis.inverted()

    def channel(self, phase, joint, index=0):
        f = mix(self.start, self.end, phase)
        a, b = int(f), int(f) + 1
        value = mix(self.source.channel(a, joint)[index], self.source.channel(b, joint)[index], f - a)
        change = self.source.channel(self.end, joint)[index] - self.source.channel(self.start, joint)[index]
        return value - change * ease(phase, .73, 1)

    def leg_sample(self, side, progress):
        strike, separation, next_strike, _ = self.contacts[side]
        stance = (separation - strike) / (next_strike - strike)
        raw = mix(strike, next_strike, progress)
        hip = self.point(raw, side + 'hipjoint')
        knee = self.point(raw, side + 'femur')
        ankle = self.point(raw, side + 'tibia')
        toe = self.point(raw, side + 'toes')
        axis = (ankle - hip).normalized()
        pole = (knee - hip - axis * (knee - hip).dot(axis)).normalized().lerp(FORWARD, .54)
        toe_start = self.point(separation, side + 'toes')
        toe_end = self.point(next_strike, side + 'toes')
        if progress < stance:
            next_contact = 0
            lift = 0
            pitch = -.21 * (1 - ease(progress, 0, .117)) + .42 * ease(progress, stance - .18, stance)
        else:
            swing = (progress - stance) / (1 - stance)
            from_source = clamp((toe.y - toe_start.y) / (toe_end.y - toe_start.y))
            next_contact = mix(ease(swing, 0, 1), ease(from_source, 0, 1), .23)
            baseline = mix(toe_start.z, toe_end.z, swing)
            lift = clamp(toe.z - baseline, 0, .067) * ease(swing, 0, .20) * (1 - ease(swing, .70, 1))
            lift += .047 * sin(pi * swing) ** 2
            pitch = .42 * (1 - ease(swing, 0, .42)) - .21 * ease(swing, .60, 1)
        return stance, next_contact, lift, pitch, pole


def capture_library():
    return {
        '35_01': Gait('35_01', 147, 278, {'l': (147, 230, 278, 0), 'r': (77, 163, 210, .481)}),
        '37_01': Gait('37_01', 166, 322, {'l': (166, 257, 322, 0), 'r': (77, 188, 234, .436)}),
    }


class NightCast:
    def __init__(self, performer, textures):
        self.templates = load_meshes(performer)
        self.rig = next(obj for obj in self.templates if obj.type == 'ARMATURE')
        self.parts = [obj for obj in self.templates if obj.type == 'MESH' and obj.parent == self.rig]
        self.skin_textures = (textures / 'skin-young.jpg', textures / 'skin-middle.jpg')
        shirt = next(obj for obj in self.parts if obj.name.startswith('斜袖与立领上衣'))
        shirt.data = shirt.data.copy()
        for v in shirt.data.vertices:
            hem = 1 - ease(v.co.z, .89, 1.028)
            v.co.x *= 1 + .115 * hem
            v.co.y *= 1 + .235 * hem
            v.co.z += .041 * hem
        shirt.data.update()
        self.shirt = BVHTree.FromPolygons([v.co for v in shirt.data.vertices],
                                          [p.vertices[:] for p in shirt.data.polygons])
        pants = next(obj for obj in self.parts if obj.name.startswith('长裤'))
        self.clothes = [(textured_coat(shirt.data.materials[0], coat), textured_coat(pants.data.materials[0], trousers))
                        for coat, trousers in PALETTE]
        skin = next(obj for obj in self.parts if 'MPFB' in obj.name)
        self.skin_materials = [skinned_material(skin.data.materials[0], file) for file in self.skin_textures]
        self.pack_cloth = [surface('Dulled woven cloth for field bundles', rgb, .94) for rgb in
                           ((.104, .091, .062), (.161, .135, .084), (.10, .122, .119), (.136, .123, .088))]
        for material in self.pack_cloth:
            fine_bump(material, 144, .0031, .26)

    def actor(self, index, scale, role):
        rig = self.rig.copy()
        rig.name = f'Crossing file {index + 1:02d} · {role}'
        rig.scale = (scale,) * 3
        bpy.context.collection.objects.link(rig)
        caps = index % 5 not in (1, 3)
        coat, pants = self.clothes[index % len(PALETTE)]
        for template in self.parts:
            if (template.name.startswith('布帽') and not caps) or (template.name.startswith('短发') and caps):
                continue
            ob = template.copy()
            bpy.context.collection.objects.link(ob)
            ob.parent = rig
            for modifier in ob.modifiers:
                if modifier.type == 'ARMATURE':
                    modifier.object = rig
                    modifier.use_deform_preserve_volume = True
            ob.material_slots[0].link = 'OBJECT'
            if template.name.startswith('斜袖与立领上衣'):
                ob.material_slots[0].material = coat
            elif template.name.startswith('长裤'):
                ob.material_slots[0].material = pants
            elif 'MPFB' in template.name:
                ob.material_slots[0].material = self.skin_materials[(index * 7 // 3) % 2]
                if index < 4 and ob.data.shape_keys:
                    ob.data = ob.data.copy()
                    face = ob.data.shape_keys.key_blocks.get('面颊与下颌')
                    if face:
                        face.value = (.62, .07, .88, .24)[index]
                skin = ob
            elif template.name.startswith('鞋底'):
                shoes = ob
        return Actor(rig, scale, shoes, skin), shoes, skin

    def clothes_point(self, origin, direction, backup):
        hit, normal, _, _ = self.shirt.ray_cast(Vector(origin), Vector(direction))
        return hit + normal * .003 if hit is not None else Vector(backup)

    def baggage(self, rig, index, role):
        if role in ('free', 'lamp'):
            return None
        heavy = role == 'heavy'
        sizes = (.142, .100, .186) if heavy else (.116, .077, .149)
        mid_z = 1.164 if heavy else 1.185
        back = self.clothes_point((.0, .8, mid_z), (0, -1, 0), (0, .119, mid_z))
        color = self.pack_cloth[index % 4]
        bag = sack('Cloth bundle held to the rib cage', (0, back.y + sizes[1] - .010, mid_z), sizes, color, index + 1)
        bind(bag, rig)
        if heavy:
            blanket_z = mid_z + .158
            blanket = sack('Bound rolled quilt', (.009, back.y + .081, blanket_z),
                           (.195, .068, .065), self.pack_cloth[(index + 2) % 4], index + 2)
            bind(blanket, rig)
            for x in (-.112, .111):
                handle = cord('Twine holding blanket to bundle', [(x, back.y + .081 + .061 * cos(a),
                              blanket_z + .060 * sin(a)) for a in (i * 2 * pi / 24 for i in range(25))], .006, color)
                convert_and_bind(handle, rig)
        grips = {}
        for side, sign in (('l', 1), ('r', -1)):
            x = sign * (.108 if heavy else .098)
            anchor = Vector((x, back.y + .063, mid_z + sizes[2] * .58))
            points = [anchor, self.clothes_point((x, .8, 1.321), (0, -1, 0), (x, .104, 1.321))]
            for y in (.061, .029, -.006, -.043, -.081):
                points.append(self.clothes_point((x, y, 1.74), (0, 0, -1), (x, y, 1.342)))
            for z in (1.318, 1.266, 1.219, 1.167, 1.115, 1.067, 1.021):
                points.append(self.clothes_point((x, -.8, z), (0, 1, 0), (x, -.128, z)))
            points.extend((Vector((x, -.037, 1.007)), Vector((x, .062, 1.012)),
                           Vector((x, back.y + .070, mid_z - sizes[2] * .75))))
            verts = [p + Vector((offset, 0, 0)) for p in points for offset in (-.013, .013)]
            faces = [(2 * i, 2 * i + 1, 2 * i + 3, 2 * i + 2) for i in range(len(points) - 1)]
            strap = mesh('Woven strap following the shoulder and closed against the bundle', verts, faces, color)
            bind(strap, rig)
            depth = strap.modifiers.new('Tape thickness', 'SOLIDIFY')
            depth.thickness = .0040
            grips[side] = points[8 if heavy else 9], strap
        return grips

    def clear(self):
        for template in self.templates:
            bpy.data.objects.remove(template, do_unlink=True)


class Walker:
    def __init__(self, actor, shoes, skin, style, role, gait, walk, grips, lamp, surface):
        self.actor, self.shoes, self.skin, self.style, self.role = actor, shoes, skin, style, role
        self.gait, self.grips, self.lamp = gait, grips, lamp
        self.surface = surface
        self.x, self.origin, self.speed, self.cycle, self.phase, self.yaw, self.seed = walk
        self.feet = {}
        for side, sign in (('l', 1), ('r', -1)):
            entries = [v for v in shoes.data.vertices if sign * v.co.x > 0]
            low = min(v.co.z for v in entries)
            sole = [v for v in entries if v.co.z < low + .012]
            heel = max(sole, key=lambda v: v.co.y).co.copy()
            toe = min(sole, key=lambda v: v.co.y).co.copy()
            heel.z = toe.z = low
            self.feet[side] = (heel, toe, [v.index for v in sole])
        self.strap_side = ('r' if self.seed < .55 else 'l') if self.role == 'steady' else 'l'
        self.strap_skin = []
        if self.grips:
            names = {g.index: g.name for g in skin.vertex_groups}
            names_on_hand = {f'{digit}_{j:02d}_{self.strap_side}' for digit in (*DIGITS, 'thumb') for j in range(1, 4)}
            names_on_hand.add(f'hand_{self.strap_side}')
            for vertex in skin.data.vertices:
                weights = [(names[g.group], g.weight) for g in vertex.groups if g.weight > .025]
                if weights and all(name in names_on_hand for name, _ in weights):
                    self.strap_skin.append((vertex.index, vertex.co.copy(), weights))
        if self.lamp:
            names = {g.index: g.name for g in skin.vertex_groups}
            self.grip_vertices = [v.index for v in skin.data.vertices if any(
                m.weight > .52 and names[m.group] in ('middle_02_r', 'middle_03_r', 'ring_02_r', 'ring_03_r')
                for m in v.groups)]

    def torso(self, time, drop=0):
        actor, gait, style = self.actor, self.gait, self.style
        current = time / self.cycle + self.phase
        phase = current % 1
        y = self.origin + self.speed * time
        x = self.x
        raw = gait.point(mix(gait.start, gait.end, phase), 'root')
        spine_trace = gait.root_start.lerp(gait.root_end, phase)
        actor.place(x, y, support(x, y), self.yaw)
        torso_offset = Vector(((raw.x - spine_trace.x) * .64, 0,
                                (raw.z - spine_trace.z) * .90 + spine_trace.z - gait.z_mean))
        torso_offset.z -= .056 + style.tuck + drop
        torso_offset.y = -.022 - .20 * style.lean
        for dest, source in BODY:
            rotation = gait.body_rotation(phase, source)
            motion = actor.inherited(dest).translation
            pitch = style.lean
            if dest == 'pelvis':
                motion += torso_offset
                pitch *= .60
            elif dest in ('head', 'neck_01'):
                pitch *= .35
            rotation = Quaternion((1, 0, 0), pitch) @ rotation
            pose_bone(actor, dest, motion, rotation)
        return current, phase

    def foot_plan(self, side, current):
        gait, actor = self.gait, self.actor
        phase_offset = gait.contacts[side][3]
        phase = current - phase_offset
        step = floor(phase)
        progress = phase - step
        stance, swing, lift, pitch, knee = gait.leg_sample(side, progress)
        lift *= (.81 if self.role == 'heavy' else 1.0) * actor.scale
        stride = self.cycle * self.speed
        sign = 1 if side == 'l' else -1
        x = self.x - sign * (.119 + .019 * self.seed)
        y = self.origin + stride * (step + phase_offset - self.phase + .347 + swing)
        heel, toe, _ = self.feet[side]
        roll = Quaternion(UP, -.085 * sign) @ Quaternion((1, 0, 0), pitch)
        ankle = actor.rest_head[f'foot_{side}']
        # Roll onto and off the same wood contact point by moving the ankle around the active sole edge.
        pivot = heel.lerp(toe, ease(pitch, -.12, .14)) - ankle
        pivot_delta = pivot - roll @ pivot
        local = actor.world_to_local(Vector((x, y, support(x, y) - pivot.z * actor.scale + lift))) + pivot_delta
        toe_flexion = -.42 * ease(pitch, .16, .42)
        return local, knee, roll, toe_flexion, (step, progress < stance, x, y), lift

    def foot(self, side, plan, adjust=0):
        actor = self.actor
        target, pole, rotation, toe_flexion, support_point, lift = plan
        names = tuple(f'{bone}_{side}' for bone in ('thigh', 'calf', 'foot'))
        wished = target + Vector((0, 0, adjust / actor.scale))
        destination, _, _ = chain(actor, names, wished, pole)
        pose_bone(actor, names[-1], destination, rotation)
        toes = f'ball_{side}'
        living = actor.inherited(toes)
        bend = (Quaternion((1, 0, 0), toe_flexion).to_matrix().to_4x4() @ living)
        bend.translation = living.translation
        actor.set(toes, bend)
        return (destination - wished).length * actor.scale

    def pelvis_drop(self, plans):
        actor = self.actor
        required = 0
        for side, (ankle, *_) in plans.items():
            thigh, knee, foot = (f'{name}_{side}' for name in ('thigh', 'calf', 'foot'))
            reach = (actor.rest_head[knee] - actor.rest_head[thigh]).length
            reach += (actor.rest_head[foot] - actor.rest_head[knee]).length - .022
            delta = actor.inherited(thigh).translation - ankle
            room = sqrt(max(0, reach ** 2 - delta.x ** 2 - delta.y ** 2))
            required = max(required, delta.z - room)
        return required

    def toe_clearances(self, graph):
        shoe = self.shoes.evaluated_get(graph)
        clearances = {}
        for side, (_, _, indices) in self.feet.items():
            points = [shoe.matrix_world @ shoe.data.vertices[i].co for i in indices]
            clearances[side] = min(point.z - self.surface.height(point) for point in points)
        return clearances

    def arm(self, side, phase, time):
        actor, gait = self.actor, self.gait
        sign = 1 if side == 'l' else -1
        bones = tuple(f'{bone}_{side}' for bone in ('upperarm', 'lowerarm', 'hand'))
        shoulder = actor.inherited(bones[0]).translation
        captured = gait.difference(phase, side + 'radius', side + 'clavicle')
        target = shoulder + Vector((sign * .059 + .47 * captured.x, self.style.arm_swing * .82 * captured.y,
                                     .89 * captured.z))
        target.x = sign * max(.176, sign * target.x)
        capture_elbow = gait.difference(phase, side + 'humerus', side + 'clavicle')
        axis = captured.normalized()
        elbow_pole = (capture_elbow - axis * axis.dot(capture_elbow)).normalized().lerp(Vector((sign * .70, .55, -.11)), .49)
        purpose = 'swing'
        if self.grips and side == self.strap_side:
            back = actor.pose['spine_03'] @ actor.inverse['spine_03']
            anchor = back @ self.grips[side][0]
            purpose = 'strap'
            elbow_pole = Vector((sign * .43, .11, -.93))
        if self.lamp and side == 'r':
            target = Vector((-.277, -.116 + .18 * captured.y, .900 + .26 * (shoulder.z - 1.28)))
            purpose = 'lamp'
            elbow_pole = Vector((-.40, .38, -.89))

        hand_forward = gait.difference(phase, side + 'hand', side + 'radius').normalized()
        if purpose == 'swing':
            forward = Vector((sign * -.038, hand_forward.y * .67, -1)).normalized()
            radial = Vector((-.19 * sign, -1, .19))
        elif purpose == 'strap':
            forward = Vector((-sign * .34, -.37, .86)).normalized()
            radial = Vector((sign, -.02, .23))
        else:
            forward = Vector((-.22, -.21, -1)).normalized()
            radial = Vector((.08, -1, .07))
        palm_rest = actor.palm[side][0]
        rotation = (axes(forward, radial) @ palm_rest.transposed()).to_quaternion()
        sample_curl = max(0.0, gait.channel(phase, side + 'fingers'))
        if purpose == 'lamp':
            grip, thumb = (.99, 1.36, 1.49, 1.60), .64
        elif purpose == 'strap':
            grip, thumb = (.82, .99, 1.14, 1.23), .52
            target = anchor - forward * .091 + Vector((0, -.036, .004))
            pose_bone(actor, bones[-1], target, rotation)
            fold_fingers(actor, side, rotation, grip, thumb)
            skin = self.fit_strap_skin()
            toward_shirt = (back.to_3x3() @ Vector((0, 1, 0))).normalized()
            points = [p for p in skin if abs(p.x - anchor.x) < .017 and abs(p.z - anchor.z) < .022]
            nearest = max(((p - anchor).dot(toward_shirt) for p in points), default=-.016)
            target -= toward_shirt * (nearest + .0021)
        else:
            tension = .13 if self.role == 'free' else .27
            grip = tuple(tension + radians(sample_curl) * .54 + .058 * i + .08 * self.seed for i in range(4))
            thumb = .17 + .15 * self.seed
        actual, forearm, wrist_roll = chain(actor, bones, target, elbow_pole,
                                            (rotation, .08 * radians(gait.channel(phase, side + 'wrist'))))
        if purpose == 'swing':
            # Keep relaxed hands aligned with the captured forearm and shared radial roll.
            forward = forward.lerp(forearm, .28).normalized()
            rotation = (axes(forward, radial) @ palm_rest.transposed()).to_quaternion()
        pose_bone(actor, bones[-1], actual, rotation)
        fold_fingers(actor, side, rotation, grip, thumb)
        if purpose == 'lamp':
            middle = actor.pose['middle_02_r'].translation
            ring = actor.pose['ring_02_r'].translation
            palm_normal = -forward.cross((rotation @ palm_rest.col[1])).normalized()
            grip_center = actor.local_to_world((middle + ring) * .5 + palm_normal * .008)
            tilt = Quaternion((1, 0, 0), .041 * sin((phase + .08) * 2 * pi))
            self.lamp.rotation_euler = tilt.to_euler()
            self.lamp.location = grip_center - tilt @ Vector((0, 0, .206))
            self.handle = grip_center
        return {'purpose': purpose, 'bend_deg': degrees(forearm.angle(forward)), 'axial_wrist_deg': wrist_roll,
                'target_error_m': (actual - target).length * actor.scale, 'wrist': list(actor.local_to_world(actual))}

    def fit_strap_skin(self):
        actor = self.actor
        groups = {name for _, _, weights in self.strap_skin for name, _ in weights}
        transforms = {name: actor.pose[name] @ actor.inverse[name] for name in groups}
        return [sum((w * (transforms[name] @ point) for name, w in weights), Vector()) / sum(w for _, w in weights)
                for _, point, weights in self.strap_skin]

    def at(self, time):
        current, phase = self.torso(time)
        plans = {side: self.foot_plan(side, current) for side in ('l', 'r')}
        drop = self.pelvis_drop(plans)
        if drop > 0:
            self.torso(time, drop)
        for side, plan in plans.items():
            self.foot(side, plan)
        hands = {side: self.arm(side, phase, time) for side in plans}
        return plans, hands

    def align_feet(self, plans, graph, offsets):
        gaps = self.toe_clearances(graph)
        errors = {}
        for side, plan in plans.items():
            offsets[side] += .0018 + plan[-1] - gaps[side]
            errors[side] = self.foot(side, plan, offsets[side])
        return errors

    def inspect(self, plans, hands, errors, graph):
        gaps = self.toe_clearances(graph)
        feet = {}
        for side, plan in plans.items():
            step, stance, x, y = plan[-2]
            feet[side] = {'step': step, 'stance': stance, 'anchor_xy': [x, y], 'clearance_m': gaps[side],
                          'ankle_error_m': errors[side], 'swing_lift_m': plan[-1],
                          'ankle': list(self.actor.local_to_world(self.actor.pose[f'foot_{side}'].translation))}
        if self.lamp:
            skin = self.skin.evaluated_get(graph)
            gap = min(((skin.matrix_world @ skin.data.vertices[i].co) - self.handle).length for i in self.grip_vertices)
            hands['r']['handle_to_skin_m'] = gap
        if self.grips:
            skin = self.skin.evaluated_get(graph)
            strap = self.grips[self.strap_side][1].evaluated_get(graph)
            surface = BVHTree.FromPolygons([strap.matrix_world @ v.co for v in strap.data.vertices],
                                          [p.vertices[:] for p in strap.data.polygons])
            samples = [surface.find_nearest(skin.matrix_world @ skin.data.vertices[index].co)[3]
                       for index, _, _ in self.strap_skin]
            hands[self.strap_side]['strap_skin_gap_m'] = min(samples)
        return {'role': self.role, 'capture': self.gait.source.name, 'feet': feet, 'hands': hands,
                'position': list(self.actor.ob.location), 'name': self.actor.ob.name}


def arrange(cast, lamp, surface):
    library = capture_library()
    rng = Random(1017)
    order = ('heavy', 'free', 'steady', 'heavy', 'heavy', 'steady', 'lamp', 'free', 'steady',
             'heavy', 'free', 'steady', 'heavy', 'free', 'steady', 'free', 'heavy', 'steady')
    people = []
    for index, role in enumerate(order):
        style = STYLES[role]
        x = BRIDGE_X + (-.44 if index % 2 else .43) + rng.uniform(-.122, .122)
        y = -10.8 + 1.04 * index + rng.uniform(-.27, .27)
        speed = rng.uniform(.61, .89) * style.cadence
        period = rng.uniform(.91, 1.10) * style.period
        phase = rng.random()
        yaw = pi + rng.uniform(-.095, .095)
        seed = rng.random()
        actor, shoes, skin = cast.actor(index, rng.uniform(.918, 1.095), role)
        grips = cast.baggage(actor.ob, index, role)
        people.append(Walker(actor, shoes, skin, style, role, library[style.capture],
                             (x, y, speed, period, phase, yaw, seed), grips, lamp if role == 'lamp' else None, surface))
    cast.clear()
    return people
