"""Authored foreground wading with limb IK and a contact on the actual sleeve."""

import json
from math import cos, degrees, pi, radians, sin, tanh, tau
from pathlib import Path

import bpy
from mathutils import Quaternion, Vector
from mathutils.bvhtree import BVHTree

from board_ik import FINGERS, SIDES, UP, Grip, Worker, frame_axes, mm, rotation, transform
from river import WATER_HEIGHT, ground_height, lerp, smoothstep


REST_FINGERS = ((13, 14, 6), (19, 18, 8), (22, 20, 12), (26, 22, 14), (11, 10, 8))
OPEN_FINGERS = ((-6, 1, -4), (-4, 0, -3), (0, 3, -2), (3, 5, 0), (-9, 4, 4))
SLEEVE_GRIP = ((11, 23, 17), (16, 27, 19), (19, 29, 19), (22, 27, 20), (19, 17, 14))
GRIP_WINDUP, GRIP_HOLD, GRIP_RELEASE, GRIP_DONE = 28, 47, 78, 96


class WadingHand(Grip):
    """The same anatomical wrist frame and mesh weight samples as the board hands."""

    def __init__(self, actor, side, width):
        self.worker, self.side, self.width = actor, side, width
        self.bone = f"hand_{side}"
        self.wrist = actor.rest[self.bone].translation
        bases = [actor.rest[f"{finger}_01_{side}"].translation for finger in FINGERS[:4]]
        self.forward = (sum(bases, Vector()) / 4 - self.wrist).normalized()
        self.axes = frame_axes(self.forward, bases[0] - bases[3])
        self.normal = self.axes.col[2] * width
        self.regions = self.skin_regions(actor.skin)
        self.finger_axes = {}
        for finger in FINGERS:
            for i in range(1, 4):
                name = f"{finger}_{i:02d}_{side}"
                basis = actor.rest[name].to_3x3()
                direction = -self.axes.col[1] if finger == "thumb" else self.normal
                curl_axis = basis.col[1].cross(direction).normalized()
                self.finger_axes[name] = basis.transposed() @ curl_axis

    def fold(self, opened, closed, hold=SLEEVE_GRIP, thumb_closed=None, thumb_turn=(0.0, 0.0)):
        for finger, at_rest, open_angles, bend in zip(FINGERS, REST_FINGERS, OPEN_FINGERS, hold):
            pressure = thumb_closed if finger == "thumb" and thumb_closed is not None else closed
            for i, angles in enumerate(zip(at_rest, open_angles, bend), 1):
                relaxed, extended, curled = angles
                name = f"{finger}_{i:02d}_{self.side}"
                flex = lerp(lerp(relaxed, extended, opened), curled, pressure)
                pose = Quaternion(self.finger_axes[name], radians(flex))
                if finger == "thumb" and i == 1:
                    local = self.worker.rest[name].to_3x3().transposed()
                    pose = (Quaternion(local @ self.forward, thumb_turn[0]*pressure)
                            @ Quaternion(local @ self.normal, thumb_turn[1]*pressure) @ pose)
                self.worker.rig.pose.bones[name].rotation_quaternion = pose


class WadingRig(Worker):
    """Share the Blender solve chains, twist weights and corrective garments with Yudu."""

    def __init__(self, spec, rig, lead):
        self.rig, self.spec, self.lead = rig, spec, lead
        self.label = rig.name
        self.scale = spec.scale
        self.skin = next(obj for obj in rig.children if obj.name.startswith("头颈与手"))
        self.shoes = next(obj for obj in rig.children if obj.name.startswith("鞋底"))
        self.shirt = next(obj for obj in rig.children if obj.name.startswith("斜袖与立领上衣"))
        self.rest = {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}
        self.grips = {side: WadingHand(self, side, width) for side,width in SIDES}
        self.twists = {side: 0.0 for side,_ in SIDES}
        self.constraints, self.wrist_turn, self.foot_goals, self.soles = {}, {}, {}, {}
        self.controls = []
        self.make_controls()
        self.rebind_shoes()
        self.rebind_sleeves()
        self.fit_trouser_rise()
        self.build_correctives()
        self.record_soles()

    def make_controls(self):
        rig = self.rig
        rig.data = rig.data.copy()
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = rig
        rig.select_set(True)
        for label in ("Controls", "Mechanism", "Skin"):
            rig.data.collections.new(label)
        bpy.ops.object.mode_set(mode="EDIT")
        for side, _ in SIDES:
            arm = tuple(f"{joint}_{side}" for joint in ("upperarm", "lowerarm", "hand"))
            leg = tuple(f"{joint}_{side}" for joint in ("thigh", "calf", "foot"))
            self.mech_chain(f"arm {side}", arm, f"clavicle_{side}")
            self.mech_chain(f"leg {side}", leg, "pelvis")
            self.clone_bone(f"Turn wrist {side}", arm[2], "Controls")
            elbow, wrist = (self.rest[bone].translation for bone in arm[1:])
            axis = self.rest[arm[1]].to_3x3().col[2]
            for i, fraction in enumerate((.23, .54, .85), 1):
                start = elbow.lerp(wrist, fraction)
                self.add_bone(f"Twist {i} {side}", start, start + (wrist-elbow).normalized()*.047,
                              "Skin", arm[1], axis)
        bpy.ops.object.mode_set(mode="OBJECT")
        rig.data.collections["Mechanism"].is_visible = False
        rig.data.collections["Skin"].is_visible = False
        for bone in rig.pose.bones:
            bone.rotation_mode = "QUATERNION"
        for side, _ in SIDES:
            self.connect_chain(f"arm {side}", tuple(f"{joint}_{side}" for joint in ("upperarm", "lowerarm", "hand")))
            self.connect_chain(f"leg {side}", tuple(f"{joint}_{side}" for joint in ("thigh", "calf", "foot")))
            rig.pose.bones[f"hand_{side}"].constraints[-1].subtarget = f"Turn wrist {side}"

    def record_soles(self):
        for side, _ in SIDES:
            group = self.shoes.vertex_groups[f"foot_{side}"].index
            foot = [v for v in self.shoes.data.vertices if any(w.group == group and w.weight > .9 for w in v.groups)]
            floor = min(v.co.z for v in foot)
            ankle = self.rest[f"foot_{side}"].translation
            self.soles[side] = [(v.index, v.co-ankle) for v in foot if v.co.z < floor + .004]

    def course(self, time):
        spec = self.spec
        frame = time * 24
        center = spec.walk_center(time)
        slow = smoothstep(frame, 12, 52) * (1 - smoothstep(frame, 57, 120))
        close = smoothstep(frame, 21, 46) * (1 - smoothstep(frame, 77, 114))
        center.x += .118 * slow - (0 if self.lead else .098 * close)
        center.y += (-.018 if self.lead else .081) * close
        return center

    def set_foot(self, time, side, width):
        spec = self.spec
        phase = time * spec.cadence + spec.phase + (.5 if width < 0 else 0)
        fraction = phase % 1.0
        plant_time = time - fraction / spec.cadence
        duration = 1 / spec.cadence
        stride = spec.speed * duration
        stance = .665 if self.lead else .72
        progress = smoothstep(fraction, stance, 1)
        lift = sin(pi * max(0, (fraction - stance) / (1 - stance))) ** 1.35
        guide = spec.forward * (stride * (.27 if self.lead else .235))
        stance_width = (.164 if self.lead else .125) + (width * .007 if self.lead else -.005)
        foot = self.course(plant_time).lerp(self.course(plant_time + duration), progress) + guide
        foot += spec.left * (width * stance_width * self.scale)
        bone = self.rest[f"foot_{side}"]
        tilt = lift * (-.22 if self.lead else -.15) * sin(pi * (fraction-stance) / (1 - stance) + .42)
        world_toe = Quaternion(UP, spec.yaw) @ rotation(degrees(tilt), 0, width * (9 if self.lead else 5))
        footprint = [world_toe @ (offset * self.scale) for _, offset in self.soles[side]]
        sink = .093 if self.lead else .071
        lift_height = (.182 + .049*(width > 0)) if self.lead else (.135 + .018*(width < 0))
        foot.z = max(ground_height(foot.x+p.x, foot.y+p.y) - p.z for p in footprint) + .0016 + lift*lift_height
        attitude = self.inverse.to_quaternion() @ world_toe @ bone.to_quaternion()
        self.set_frame(f"Place leg {side}", transform(self.inverse @ foot, attitude))
        pole = Vector((width * (.22 if self.lead else .18), -.64, .51 + sink*lift))
        self.set_frame(f"Pole leg {side}", transform(pole, Quaternion()))
        self.foot_goals[side] = (fraction, lift)

    def arm_goal(self, side, width, wrist, orientation, contact=0, elbow_width=.69):
        shoulder = self.upper_arm_root(side)
        elbow = self.rest[f"lowerarm_{side}"].translation
        span = (elbow - self.rest[f"upperarm_{side}"].translation).length + (elbow - self.rest[f"hand_{side}"].translation).length
        delta = wrist - shoulder
        if delta.length > .93 * span:
            wrist = shoulder + delta.normalized() * span * (.93 + .064*tanh((delta.length/span - .93)/.064))
        hand = self.grips[side]
        semantic = self.rest[hand.bone].to_quaternion().inverted() @ hand.forward
        desired_elbow = -(orientation @ semantic)
        relaxed_elbow = Vector((width*elbow_width, .24, -.95)).normalized()
        bend = relaxed_elbow.lerp(desired_elbow, .41 + .36 * contact)
        ray = (wrist - shoulder).normalized()
        bend -= ray * bend.dot(ray)
        pole = shoulder.lerp(wrist, .42) + bend.normalized() * .43
        self.set_frame(f"Place arm {side}", transform(wrist, orientation))
        self.set_frame(f"Pole arm {side}", transform(pole, Quaternion()))
        self.set_frame(f"Turn wrist {side}", transform(wrist, orientation))
        self.wrist_turn[side] = (orientation, .72 * (1-contact))

    def ready(self, time):
        spec = self.spec
        frame = time * 24
        phase = tau * (time * spec.cadence + spec.phase)
        notice = smoothstep(frame, 17, 37) * (1 - smoothstep(frame, 78, 100))
        probe = smoothstep(frame, 9, 26) * (1 - smoothstep(frame, 38, 58))
        respond = smoothstep(frame, 49, 66) * (1 - smoothstep(frame, 77, 101))
        center = self.course(time) + spec.left * (.034 * sin(phase))
        center.z = ground_height(center.x, center.y)
        yaw = spec.yaw + radians((2.7 if self.lead else -4.6)*notice)
        self.rig.matrix_world = transform(center, Quaternion(UP, yaw), self.scale)
        self.inverse = self.rig.matrix_world.inverted()
        bend = (14 + 14*probe - 5*respond) if self.lead else (9 + 2*probe + 6*notice)
        low = (.093 + .064*probe - .031*respond) if self.lead else (.077 + .018*notice)
        lateral = .026*sin(phase) + (.032*probe - .031*respond if self.lead else -.026*notice)
        self.rotate_rest("pelvis", rotation(.45*bend, degrees(.045*sin(phase)), 3.2*cos(phase)),
                         (lateral, .039*probe if self.lead else .015, -low + .024*cos(2*phase)))
        self.rotate_rest("spine_01", rotation(.43*bend, -2.0*sin(phase), 2.8*sin(phase)))
        self.rotate_rest("spine_03", rotation(.12*bend, -2.2*notice + 3.4*respond if self.lead else 5.3*notice,
                                              6.0*respond if self.lead else -13.0*notice))
        self.rotate_rest("neck_01", rotation(-8 + 5.0*probe, 2.7*cos(phase), 12.0*respond if self.lead else -17*notice))
        self.rotate_rest("head", rotation(7 + 9*probe - 8*respond if self.lead else 3 + 2.7*sin(phase),
                                          -3.1*notice if self.lead else 1.4*notice, 42*respond if self.lead else -12*notice))
        self.free_right = None
        for side, width in SIDES:
            approach = notice if side == "r" and not self.lead else (.46*notice if self.lead and side == "l" else 0)
            self.rotate_rest(f"clavicle_{side}", rotation(0, width*(2.8*approach - 1.8),
                                                         -width*(4.0 + 10.5*approach)),
                             (0, -.011 - .018*approach, .007*approach))
            self.set_foot(time, side, width)
            swing = sin(phase + width * 1.47)
            elbow_width = .69
            if self.lead:
                if side == "l":
                    held = smoothstep(frame, 33, 46) * (1 - smoothstep(frame, 80, 97))
                    offer = Vector((.255 + .090*notice, -.105 - .043*swing*(1 - .82*held) + .074*notice, .928 + .091*notice))
                    wrist = Vector((.188, -.069 - .069*swing, .860 + .031*swing)).lerp(offer, held)
                    forward, normal = Vector((.24, -.88, -.48)), Vector((.12, .38, .88))
                    elbow_width = .35 + .34 * held
                else:
                    wrist = Vector((-.205 - .025*probe, -.143 - .088*swing, .864 + .044*swing + .035*probe))
                    forward, normal = Vector((-.12, -.42, -.88)), Vector((.94, -.18, .09))
                    elbow_width = .31
            elif side == "l":
                balance = smoothstep(frame, 23, 42) * (1 - smoothstep(frame, 96, 115))
                wrist = Vector((.236 + .011*balance, -.095 - .051*swing, .892 + .029*swing - .045*balance))
                forward, normal = Vector((-.16, -.37, -.912)), Vector((-.92, .14, .16))
                elbow_width = .24
            else:
                wrist = Vector((-.264, -.136 - .075*swing, .903 + .05*swing))
                forward, normal = Vector((-.08, -.46, -.882)), Vector((.94, -.18, .15))
            att = self.grips[side].rotation_for(forward, normal)
            self.arm_goal(side, width, wrist, att, elbow_width=elbow_width)
            self.grips[side].fold(.09*probe if self.lead and side == "r" else 0, .08 if not self.lead and side == "l" else .0)
            if not self.lead and side == "r":
                self.free_right = (wrist, att)

    def wakes(self):
        deps = bpy.context.evaluated_depsgraph_get()
        evaluated = self.rig.evaluated_get(deps)
        shoes = self.shoes.evaluated_get(deps)
        wakes, feet = [], {}
        for side, (phase, lift) in self.foot_goals.items():
            bones = evaluated.pose.bones
            knee = evaluated.matrix_world @ bones[f"calf_{side}"].head
            ankle = evaluated.matrix_world @ bones[f"foot_{side}"].head
            goal = evaluated.matrix_world @ bones[f"Place leg {side}"].head
            water = None
            if ankle.z < WATER_HEIGHT < knee.z:
                water = ankle.lerp(knee, (WATER_HEIGHT - ankle.z)/(knee.z - ankle.z))
            elif ground_height(knee.x, knee.y) < WATER_HEIGHT:
                water = Vector((knee.x, knee.y, WATER_HEIGHT))
            wakes.append((water, phase, lift))
            footprint = [shoes.matrix_world @ shoes.data.vertices[i].co for i,_ in self.soles[side]]
            gap = min(p.z - ground_height(p.x, p.y) for p in footprint)
            feet[side] = {"swing": round(lift,5), "step_phase": round(phase,5), "ankle_goal_mm": mm((goal-ankle).length),
                          "sole_to_bed_min_mm": mm(gap), "ankle_xy_m": tuple(round(x,5) for x in ankle.xy)}
        return wakes, feet


def forearm_section(model, elbow, span, axial_bounds, min_weight):
    weighted = {g.index for g in model.vertex_groups if g.name in ("upperarm_l", "lowerarm_l", "hand_l")
                or (g.name.startswith("Twist ") and g.name.endswith(" l"))}
    low, high = axial_bounds
    section = {v.index for v in model.data.vertices if
               sum(w.weight for w in v.groups if w.group in weighted) > min_weight
               and low < (v.co - elbow).dot(span) / span.length_squared < high}
    faces = [poly.vertices[:] for poly in model.data.polygons if all(i in section for i in poly.vertices)]
    ids = sorted({i for face in faces for i in face})
    index = {i: offset for offset, i in enumerate(ids)}
    return ids, [tuple(index[i] for i in face) for face in faces]


class SleeveAssist:
    def __init__(self, pairs):
        self.probe, self.support = (WadingRig(spec, rig, index == 0) for index,(spec,rig) in enumerate(pairs))
        shirt = self.probe.shirt
        self.calibrated = False
        fit_file = Path(__file__).with_name("sleeve-grip.json")
        self.fit = json.loads(fit_file.read_text(encoding="utf-8"))
        self.grasp = [tuple(self.fit[i:i+3]) for i in range(6, 21, 3)]
        self.thumb_turn = self.fit[21:] or (0.0, 0.0)
        forearm = self.probe.rest["lowerarm_l"].translation
        direction = self.probe.rest["hand_l"].translation - forearm
        self.indices, self.faces = forearm_section(shirt, forearm, direction, (-.23, .95), .43)
        self.arm_indices, self.arm_faces = forearm_section(self.probe.skin, forearm, direction, (-.48, 1.24), .32)
        assert self.faces, "The probe actor has no lower-left sleeve faces"
        self.squeeze = shirt.shape_key_add(name="Local sleeve compression under the hand")
        self.undented = {i: self.squeeze.data[i].co.copy() for i in self.indices}
        group_name = {group.index: group.name for group in shirt.vertex_groups}
        self.sleeve_bones = {i: group_name[max(shirt.data.vertices[i].groups, key=lambda g: g.weight).group]
                             for i in self.indices}
        self.sleeve_neighbors = {i: [] for i in self.indices}
        for edge in shirt.data.edges:
            a,b = edge.vertices
            if a in self.undented and b in self.undented:
                self.sleeve_neighbors[a].append(b)
                self.sleeve_neighbors[b].append(a)
        support_hand = self.support.grips["r"]
        mesh = self.support.skin
        distal = {group.index for group in mesh.vertex_groups if group.name in
                  (f"{finger}_03_r" for finger in FINGERS[:4])}
        self.hand_ids = support_hand.regions["hand"]
        local = {i: j for j,i in enumerate(self.hand_ids)}
        self.hand_faces = [tuple(local[i] for i in face.vertices) for face in mesh.data.polygons
                           if all(i in local for i in face.vertices)]
        support_hand.regions["fingertips"] = [i for i in support_hand.regions["hand"] if
                                              any(w.group in distal and w.weight >= .5 for w in mesh.data.vertices[i].groups)]

    def clothing_surface(self):
        deps = bpy.context.evaluated_depsgraph_get()
        lead = self.probe.rig.evaluated_get(deps)
        sleeve = self.probe.shirt.evaluated_get(deps)
        elbow = lead.matrix_world @ lead.pose.bones["lowerarm_l"].head
        wrist = lead.matrix_world @ lead.pose.bones["hand_l"].head
        surface = BVHTree.FromPolygons([sleeve.matrix_world @ sleeve.data.vertices[i].co for i in self.indices], self.faces)
        return elbow, wrist, surface

    def arm_surface(self):
        skin = self.probe.skin.evaluated_get(bpy.context.evaluated_depsgraph_get())
        return BVHTree.FromPolygons([skin.matrix_world @ skin.data.vertices[i].co for i in self.arm_indices],
                                   self.arm_faces)

    def sleeve_frame(self, elbow, wrist, surface):
        center = elbow.lerp(wrist, .40)
        axis = (wrist - elbow).normalized()
        near = Vector((.19, -.87, .64))
        outward = (near - axis * near.dot(axis)).normalized()
        hit, normal, _, _ = surface.ray_cast(center, outward, .14)
        if hit is None:
            hit, normal, _, _ = surface.find_nearest(center + .039 * outward)
        normal = outward.lerp(normal, .24).normalized()
        wanted = Vector((-1, .36, -.16))
        forward = (wanted - normal * wanted.dot(normal)).normalized()
        around = normal.cross(axis).normalized()
        if forward.dot(around) < 0:
            around.negate()
        return hit, normal, forward.lerp(around, .36).normalized()

    def fitted_pose(self, sleeve_frame, parameters):
        hit, normal, initial = sleeve_frame
        along, across, clear, yaw, pitch, roll = map(float, parameters[:6])
        forward = Quaternion(normal, yaw) @ initial
        width = normal.cross(forward).normalized()
        forward = Quaternion(width, pitch) @ forward
        palm_normal = Quaternion(forward, roll) @ -normal
        heel = hit + self.support.scale * (-along*forward + across*width + clear*normal)
        turn = self.support.grips["r"].rotation_for(forward, palm_normal)
        return heel, turn

    def cloth_pressure(self, elbow, sleeve_wrist, hand_surface):
        # The hand and sleeve are in the solved pose. Pull only the cloth below
        # the skin's first radial hit inward, with a short blend at its edges.
        deps = bpy.context.evaluated_depsgraph_get()
        shirt = self.probe.shirt.evaluated_get(deps)
        rig = self.probe.rig.evaluated_get(deps)
        arm = self.arm_surface()
        axis = (sleeve_wrist - elbow).normalized()
        offsets = {}
        for i in self.indices:
            point = shirt.matrix_world @ shirt.data.vertices[i].co
            center = elbow + axis*(point - elbow).dot(axis)
            radial = point - center
            direction = radial.normalized()
            hit, normal, _, arm_radius = arm.ray_cast(center, direction, .14)
            if hit is not None and normal.dot(direction) < .12:
                traveled = arm_radius + .00015
                hit, normal, _, arm_radius = arm.ray_cast(center+direction*traveled, direction, .14-traveled)
                if hit is not None:
                    arm_radius += traveled
            allowance = max(0.0, min(.008, radial.length-arm_radius-.001)) if hit is not None and normal.dot(direction) >= .12 else 0.0
            envelope = []
            for shift in (-.009, 0.0, .009):
                hit, _, _, distance = hand_surface.ray_cast(center + axis*shift, direction, radial.length + .009)
                if hit is not None:
                    envelope.append(radial.length - distance + .0005 - .18*abs(shift))
            compression = min(allowance, max(0.0, *envelope)) if envelope else 0.0
            offsets[i] = (compression, direction, allowance)
        max_squeeze = 0.0
        inverse = {}
        for i, (depth, outward, allowance) in offsets.items():
            pressure = max((offsets[j][0] for j in self.sleeve_neighbors[i]), default=0.0)
            depth = min(allowance, max(depth, .43*pressure))
            name = self.sleeve_bones[i]
            if name not in inverse:
                bone = rig.pose.bones[name]
                inverse[name] = (rig.matrix_world @ bone.matrix @ bone.bone.matrix_local.inverted()).to_3x3().inverted()
            self.squeeze.data[i].co = self.undented[i] - inverse[name] @ (depth*outward)
            max_squeeze = max(max_squeeze, depth)
        self.squeeze.value = 1.0
        return mm(max_squeeze)

    def pose(self, time):
        probe, support = self.probe, self.support
        frame = time * 24
        self.squeeze.value = 0.0
        probe.ready(time)
        support.ready(time)
        bpy.context.view_layer.update()
        if not self.calibrated:
            probe.calibrate_poles()
            support.calibrate_poles()
            self.calibrated = True
        probe.finish_pose()
        bpy.context.view_layer.update()
        elbow, wrist, surface = self.clothing_surface()
        sleeve_frame = self.sleeve_frame(elbow, wrist, surface)
        normal = sleeve_frame[1]
        hand = support.grips["r"]
        fixed, world_att = self.fitted_pose(sleeve_frame, self.fit)
        engaged = smoothstep(frame, GRIP_WINDUP, GRIP_HOLD-10) * (1 - smoothstep(frame, GRIP_RELEASE+9, GRIP_DONE))
        tuck = smoothstep(frame, GRIP_HOLD-7, GRIP_HOLD+5) * (1 - smoothstep(frame, GRIP_RELEASE+1, GRIP_RELEASE+9))
        open_hand = smoothstep(frame, GRIP_WINDUP-3, GRIP_HOLD-10) * (1 - smoothstep(frame, GRIP_DONE, GRIP_DONE+9))
        stand_off = .102 * (1 - smoothstep(frame, GRIP_HOLD-10, GRIP_HOLD+1))
        stand_off += .018*smoothstep(frame, GRIP_RELEASE-4, GRIP_RELEASE-1)
        stand_off += .085*smoothstep(frame, GRIP_RELEASE-1, GRIP_RELEASE+10)
        path_side = Vector((.064, -.074, -.044)) * (1 - smoothstep(frame, 36, 44) + smoothstep(frame, 83, 90))
        rest_wrist, rest_att = support.free_right
        att = support.inverse.to_quaternion() @ world_att
        target = rest_wrist.lerp(support.inverse @ (fixed + normal*(stand_off + .0028) + path_side), engaged)
        wrist_lock = smoothstep(frame, 33, 42) * (1 - smoothstep(frame, 83, GRIP_DONE))
        support.arm_goal("r", -1, target, rest_att.slerp(att, wrist_lock), wrist_lock)
        thumb = smoothstep(frame, GRIP_HOLD-8, GRIP_HOLD+1) * (1 - smoothstep(frame, GRIP_RELEASE-1, GRIP_RELEASE+4))
        hand.fold(open_hand, tuck, self.grasp, thumb_closed=thumb, thumb_turn=self.thumb_turn)
        bpy.context.view_layer.update()
        support.finish_pose()
        bpy.context.view_layer.update()
        skin = support.skin.evaluated_get(bpy.context.evaluated_depsgraph_get())
        skin_points = [skin.matrix_world @ skin.data.vertices[i].co for i in self.hand_ids]
        hand_surface = BVHTree.FromPolygons(skin_points, self.hand_faces)
        pressure = 0.0
        if GRIP_HOLD - 4 <= frame <= GRIP_RELEASE + 4:
            pressure = self.cloth_pressure(elbow, wrist, hand_surface)
            bpy.context.view_layer.update()
            elbow, wrist, surface = self.clothing_surface()
        a, feet_a = probe.wakes()
        b, feet_b = support.wakes()
        return [a, b], {"arm_contact": self.measure(surface, elbow, wrist, engaged, tuck, pressure, skin_points, hand_surface),
                        "foreground_steps": {"probe": feet_a, "support": feet_b}}

    def measure(self, surface, elbow, sleeve_wrist, engaged, tuck, pressure, skin_points, hand_surface):
        support = self.support
        deps = bpy.context.evaluated_depsgraph_get()
        rig = support.rig.evaluated_get(deps)
        hand = support.grips["r"]
        seen = {}
        axis = (sleeve_wrist - elbow).normalized()
        for i, co in zip(self.hand_ids, skin_points):
            point, normal, _, gap = surface.find_nearest(co)
            center = elbow + axis * (co - elbow).dot(axis)
            outward = (co - center).normalized()
            exit_point, exit_normal, _, _ = surface.ray_cast(co + outward * .000015, outward, .067)
            inside = exit_point is not None and exit_normal.dot(outward) > .12 and normal.dot(co-point) < 0
            sign = -1 if inside else 1
            seen[i] = sign * gap
        contact = {}
        for region, points in hand.regions.items():
            if region == "hand":
                continue
            distances = [seen[i] for i in points]
            contact[region] = {"nearest_signed_mm": mm(min(distances, key=abs)),
                               "deepest_signed_mm": mm(min(distances)),
                               "within_3mm": sum(abs(d) < .003 for d in distances),
                               "inside_over_2mm": sum(d < -.002 for d in distances)}
        bones = rig.pose.bones
        along = bones["hand_r"].matrix.to_quaternion() @ (support.rest["hand_r"].to_quaternion().inverted() @ hand.forward)
        overlaps = surface.overlap(hand_surface)
        return {"weight": round(engaged,5), "finger_closure": round(tuck,5), "regions": contact,
                "hand_deepest_signed_mm": mm(min(seen.values())),
                "intruding_over_2mm": sum(d < -.002 for d in seen.values()),
                "hand_sleeve_triangle_pairs": len(overlaps),
                "peak_cloth_compression_mm": pressure,
                "wrist_angle_deg": round(degrees(along.angle(bones["lowerarm_r"].vector)),3)}
