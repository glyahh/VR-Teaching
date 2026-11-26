"""Pose the shipped MPFB skin with explicit support, hand and foot targets."""

from math import atan2, cos, floor, pi, sin, sqrt

import bpy
import bmesh
from mathutils import Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree

from river_scene import (
    BRIDGE_X, DOOR_DEPTH, DOOR_WIDTH, HERO_HULL_Y, STAGING_HEIGHT,
    clamp, cord, deck_surface, ease, fine_bump, load_meshes, mesh, principled, surface,
)


class Cast:
    def __init__(self, materials, workshirt=None):
        self.templates = load_meshes(materials.assets / 'river-people.glb')
        self.armature = next(ob for ob in self.templates if ob.type == "ARMATURE")
        self.parts = [ob for ob in self.templates if ob.type == 'MESH' and ob.parent == self.armature]
        self.shirt = None
        self.shirt_surface = None
        if workshirt:
            shirt_parts = load_meshes(workshirt)
            self.shirt = next(obj for obj in shirt_parts if obj.name.startswith("片头 · 裁片上衣"))
            self.shirt_surface = BVHTree.FromPolygons([v.co for v in self.shirt.data.vertices],
                                                     [p.vertices[:] for p in self.shirt.data.polygons])
            self.templates.extend(shirt_parts)
        self.pack_cloth = [surface("Canvas kit bag", (.16, .131, .087), .96),
                           surface("Rolled bed blanket", (.22, .20, .145), .94),
                           surface("Faded blanket and wrapping cloth", (.115,.14,.119), .91)]
        for mat in self.pack_cloth:
            fine_bump(mat, 238, .003, .26)
        self.seam = surface("Coarse pack edge cords and strap ends", (.080, .057, .035), .96)
        self.palette = (
            ((.171,.205,.226), (.074,.090,.079), (.094,.12,.118), (.44,.246,.150)),
            ((.230,.180,.116), (.10,.082,.057), (.18,.14,.099), (.51,.285,.164)),
            ((.155,.185,.164), (.118,.123,.10), (.094,.13,.11), (.355,.192,.104)),
            ((.218,.222,.183), (.12,.122,.096), (.135,.137,.103), (.52,.317,.191)),
            ((.173,.196,.221), (.118,.130,.150), (.116,.133,.160), (.411,.23,.139)),
        )
        self.costumes = [self.costume(tints, index) for index, tints in enumerate(self.palette)]

    def costume(self, tints, index):
        coat, trousers, cap, skin = tints
        result = {}
        for part in self.parts:
            original = part.data.materials[0]
            mat = original.copy()
            mat.name = f"{original.name} · 衣装 {index + 1}"
            bsdf = principled(mat)
            nt = mat.node_tree
            name = original.name
            if "肤色" in name:
                nt.nodes.clear()
                bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
                output = nt.nodes.new("ShaderNodeOutputMaterial")
                nt.links.new(bsdf.outputs[0], output.inputs[0])
                bsdf.inputs['Subsurface Weight'].default_value = .045
                bsdf.inputs['Subsurface Scale'].default_value = .013
                bsdf.inputs['Roughness'].default_value = .72
                noise = nt.nodes.new("ShaderNodeTexNoise")
                coordinates = nt.nodes.new("ShaderNodeTexCoord")
                nt.links.new(coordinates.outputs['UV'], noise.inputs[0])
                noise.inputs['Scale'].default_value = 88
                noise.inputs['Detail'].default_value = 3.0
                ramp = nt.nodes.new("ShaderNodeValToRGB")
                ramp.color_ramp.elements[0].color = (*(c * .66 for c in skin), 1)
                ramp.color_ramp.elements[1].color = (*(c * 1.20 for c in skin), 1)
                nt.links.new(noise.outputs['Fac'], ramp.inputs[0])
                nt.links.new(ramp.outputs[0], bsdf.inputs['Base Color'])
                fine_bump(mat, 224, .0009, .24)
            else:
                rgb = coat if name.startswith("上衣") else trousers
                if name.startswith("布帽"):
                    rgb = cap
                elif name.startswith("旧鞋"):
                    rgb = (.107, .074, .044)
                elif name.startswith("布领"):
                    rgb = tuple(c * .67 for c in coat)
                for link in list(bsdf.inputs['Base Color'].links):
                    nt.links.remove(link)
                bsdf.inputs['Base Color'].default_value = (*rgb, 1)
                existing_normal = next((node for node in nt.nodes if node.type == "NORMAL_MAP"), None)
                detail = nt.nodes.new("ShaderNodeTexNoise")
                detail.inputs['Scale'].default_value = 7.5
                detail.inputs['Detail'].default_value = 3
                tex = nt.nodes.new("ShaderNodeTexCoord")
                nt.links.new(tex.outputs['UV'], detail.inputs[0])
                tone = nt.nodes.new("ShaderNodeValToRGB")
                tone.color_ramp.elements[0].color = (*(c * .56 for c in rgb), 1)
                tone.color_ramp.elements[1].color = (*(c * 1.14 for c in rgb), 1)
                nt.links.new(detail.outputs['Fac'], tone.inputs[0])
                nt.links.new(tone.outputs[0], bsdf.inputs['Base Color'])
                bump = fine_bump(mat, 26, .008, .24)
                if existing_normal:
                    nt.links.new(existing_normal.outputs[0], bump.inputs['Normal'])
                bsdf.inputs['Sheen Weight'].default_value = .12
            mat.use_backface_culling = False
            result[original.name] = mat
        return result

    def actor(self, name, variant, scale=1.0, pack=0, headwear=None, skin=None, wear_shirt=False):
        rig = self.armature.copy()
        rig.name = name
        rig.scale = (scale,) * 3
        bpy.context.collection.objects.link(rig)
        use_shirt = self.shirt is not None and (headwear is not None or wear_shirt)
        models = [*self.parts, self.shirt] if use_shirt else self.parts
        for model in models:
            if headwear and model.name.startswith("布帽"):
                continue
            if use_shirt and model.name.startswith("斜袖与立领上衣"):
                continue
            ob = model.copy()
            bpy.context.collection.objects.link(ob)
            ob.parent = rig
            ob.name = model.name
            for mod in ob.modifiers:
                if mod.type == "ARMATURE":
                    mod.object = rig
                    mod.use_deform_preserve_volume = True
            ob.material_slots[0].link = 'OBJECT'
            if use_shirt and model == self.shirt:
                ob.material_slots[0].material = textured_coat(model.data.materials[0], self.palette[variant][0])
            else:
                ob.material_slots[0].material = self.costumes[variant][model.data.materials[0].name]
            if skin and "MPFB" in model.name:
                ob.material_slots[0].material = skinned_material(ob.material_slots[0].material, skin)
                trim_faces(ob, lambda v: abs(v.x) < .19 and v.z < 1.431)
            if use_shirt and model.name.startswith("衣襟"):
                trim_faces(ob, lambda v: v.z > .84)
            if model.name.startswith("鞋底"):
                shoes = ob
            elif "MPFB" in model.name:
                head_and_hands = ob
        if pack:
            self.kit(rig, pack, variant, use_shirt)
        if headwear:
            self.work_costume(rig, headwear, self.palette[variant][0], use_shirt)
        return Actor(rig, scale, shoes, head_and_hands)

    def work_costume(self, rig, headwear, coat, use_shirt):
        washed = surface("Faded linen on the turned cuffs", (.36,.33,.258), .94)
        broad = surface("Mud-darkened cloth waist wrap", (.139,.105,.064), .96)
        hair = surface("Dark hair and brow", (.036,.024,.018), .85)
        for material in (washed, broad, hair):
            fine_bump(material, 180, .002, .22)
        if headwear == 'wrap':
            wrap = surface("Work headcloth", (.217,.195,.143), .96)
            fine_bump(wrap, 141, .003, .24)
            profiles = ((.087,.113,1.576),(.092,.118,1.592),(.088,.115,1.608),
                        (.086,.110,1.622),(.079,.106,1.638),(.067,.089,1.651),
                        (.048,.068,1.660),(.015,.028,1.665))
            loops = [[(rx*cos(a), -.034+ry*sin(a), z + .009*cos(a+index*.81)+.0024*sin(4*a))
                      for a in angles(34)] for index,(rx,ry,z) in enumerate(profiles)]
            bind(ring_mesh("Layered work headcloth over the MPFB scalp", loops, wrap), rig, 'head')
            knot = sack("End of folded headcloth", (-.074,.056,1.606),(.031,.034,.024),wrap,4)
            bind(knot, rig, 'head')
        else:
            template = next(part for part in self.parts if "MPFB" in part.name)
            scalp = template.data
            origin = Vector((0,-.038,1.575))
            selected = [poly for poly in scalp.polygons if all(
                scalp.vertices[i].co.z > 1.539 + .065 * ease(-scalp.vertices[i].co.y,.022,.137)
                for i in poly.vertices)]
            indices = sorted({i for poly in selected for i in poly.vertices})
            lookup = {i: j for j,i in enumerate(indices)}
            positions = [v + .0042*(v-origin).normalized() for i in indices for v in [scalp.vertices[i].co]]
            faces = [tuple(lookup[i] for i in p.vertices) for p in selected]
            shell = mesh("Short hair fitted to the original head", positions, faces, hair)
            for face in shell.data.polygons:
                face.use_smooth = True
            bind(shell, rig, 'head')
        sclera = surface("Warm grey sclera", (.22,.177,.119), .63)
        iris = surface("Shadowed iris", (.055,.027,.016), .47)
        for sign in (-1, 1):
            points = [(sign*x,y,z) for x,y,z in ((.019,-.1340,1.5557),(.033,-.1378,1.5602),
                      (.052,-.1209,1.5564),(.035,-.1365,1.5508),(.034,-.1392,1.5558))]
            eye = mesh("Eye surface in the original socket", points,
                       [(0,1,4),(1,2,4),(2,3,4),(3,0,4)], sclera)
            bind(eye, rig, 'head')
            pupil = mesh("Dark part of the eye", [(sign*(.0318+.0035*cos(a)),
                         -.1395+.0013*cos(a),1.5557+.0037*sin(a)) for a in angles(12)],
                         [tuple(range(12))], iris)
            bind(pupil, rig, 'head')
            brow = cord("Brow above the original eyelid", [(sign*x,y,z) for x,y,z in
                        ((.020,-.137,1.567),(.034,-.142,1.5715),
                         (.045,-.136,1.5699),(.055,-.125,1.566))], .0028, hair)
            convert_and_bind(brow, rig, 'head')

        rings = [[(rx*cos(a),-.008+ry*sin(a),z+.012*cos(a)+.003*sin(5*a))
                  for a in angles(32)] for rx,ry,z in
                 ((.158,.112,.906),(.161,.115,.918),(.159,.114,.938),(.153,.110,.949))]
        bind(ring_mesh("Folded cloth waist sash", rings, broad, close=False), rig, 'pelvis')
        tie = sack("Folded end of the waist sash", (.148,-.021,.921),(.035,.024,.023),broad,2)
        bind(tie, rig, 'pelvis')
        if not use_shirt:
            shirt_facing = surface("Worn neck reinforcement and shoulder cloth", coat, .93)
            fine_bump(shirt_facing, 128, .0022, .29)
            collar_rings = [[(rx*cos(a), -.014+ry*sin(a), z+.004*sin(a)+.002*sin(4*a))
                             for a in angles(30)] for rx,ry,z in
                            ((.106,.103,1.385),(.084,.087,1.418),(.074,.075,1.444),(.069,.069,1.446))]
            bind(ring_mesh("Rounded, overlapping cloth collar", collar_rings, shirt_facing, close=False), rig, 'spine_03')
        for side in ('l','r'):
            start = rig.data.bones[f'lowerarm_{side}'].head_local
            end = rig.data.bones[f'hand_{side}'].head_local
            direction = (end-start).normalized()
            u = direction.cross(Vector((0,0,1))).normalized()
            v = direction.cross(u)
            rings = []
            for f,r in ((.75,.043),(.81,.047),(.97,.044),(1.007,.039)):
                rings.append([start.lerp(end,f) + r*(1+.030*sin(a*4))*(cos(a)*u+sin(a)*v)
                              for a in angles(20)])
            bind(ring_mesh("Turned, double-folded work cuff", rings, washed, close=False),
                 rig, f'lowerarm_{side}')

    def kit(self, rig, kind, variant, fitted):
        shape = (.135 + .013 * kind, .090, .188 + .010 * (kind % 2)) if fitted else (.155,.125,.205)
        shell = sack("Bound soft kit bag", (.012, .168 if fitted else .178, 1.134), shape,
                     self.pack_cloth[(variant + 2) % len(self.pack_cloth)], kind)
        bind(shell, rig)
        if kind != 2:
            blanket = sack("Cloth roll strapped over kit", (-.014, .186, 1.345), (.222, .081, .083),
                           self.pack_cloth[1 if kind == 1 else 2], variant)
            bind(blanket, rig)
            for x in (-.124, .106):
                tie = cord("Twine round the cloth roll",
                           [(x, .19 + .083 * cos(theta), 1.344 + .084 * sin(theta))
                            for theta in (j * 2 * pi / 34 for j in range(35))], .010, self.seam)
                convert_and_bind(tie, rig)
        for side in (-1, 1):
            if fitted:
                bind(self.fitted_strap(side), rig)
                continue
            stripe = cord("Kit straps on the shoulders",
                          [(side*.105, .205, 1.274), (side*.125, .108, 1.355),
                           (side*.134, -.016, 1.341), (side*.124, -.109, 1.28),
                           (side*.109, -.132, 1.171), (side*.109, -.124, 1.04),
                           (side*.131, -.049, 1.006), (side*.132, .071, 1.027),
                           (side*.122, .137, 1.086)], .0115, self.seam)
            convert_and_bind(stripe, rig)

    def fitted_strap(self, side):
        x = side * .116
        def place(origin, axis, fallback):
            point, normal, _, _ = self.shirt_surface.ray_cast(Vector(origin), Vector(axis))
            return point + normal * .006 if point is not None else Vector(fallback)
        points = [Vector((x,.182,1.260))]
        points.append(place((x,.8,1.311),(0,-1,0),(x,.082,1.311)))
        for y in (.072,.035,-.004,-.046,-.081):
            points.append(place((x,y,1.66),(0,0,-1),(x,y,1.349)))
        for z in (1.315,1.285,1.246,1.202,1.152,1.093,1.049):
            points.append(place((x,-.7,z),(0,1,0),(x,-.128,z)))
        points.extend([Vector((x,-.052,1.005)),Vector((x,.075,1.018)),Vector((x,.133,1.068))])
        vertices = [tuple(p + Vector((offset,0,0))) for p in points for offset in (-.012,.012)]
        faces = [(2*i,2*i+1,2*i+3,2*i+2) for i in range(len(points)-1)]
        strap = mesh("Backpack webbing fitted against the shirt", vertices, faces, self.seam)
        for face in strap.data.polygons:
            face.use_smooth = True
        thickness = strap.modifiers.new("Woven tape thickness", "SOLIDIFY")
        thickness.thickness = .003
        return strap

    def remove_templates(self):
        for ob in self.templates:
            bpy.data.objects.remove(ob, do_unlink=True)


def skinned_material(source, skin):
    mat = source.copy()
    mat.name = f"MPFB model UV · {skin.stem}"
    nt = mat.node_tree
    uv = nt.nodes.new('ShaderNodeUVMap')
    image = nt.nodes.new('ShaderNodeTexImage')
    image.image = bpy.data.images.load(str(skin), check_existing=True)
    nt.links.new(uv.outputs[0], image.inputs['Vector'])
    nt.links.new(image.outputs['Color'], principled(mat).inputs['Base Color'])
    return mat


def textured_coat(source, rgb):
    mat = source.copy()
    mat.name = f"{source.name} · 蓝布" if rgb[2] > rgb[0] else f"{source.name} · 褐布"
    nt, bsdf = mat.node_tree, principled(mat)
    base = bsdf.inputs['Base Color']
    tint = nt.nodes.new("ShaderNodeMixRGB")
    tint.blend_type = 'MULTIPLY'
    tint.inputs[0].default_value = .93
    tint.inputs[2].default_value = (*rgb,1)
    nt.links.new(base.links[0].from_socket, tint.inputs[1])
    nt.links.new(tint.outputs[0], base)
    bsdf.inputs['Roughness'].default_value = .86
    bsdf.inputs['Sheen Weight'].default_value = .11
    return mat


def trim_faces(ob, predicate):
    ob.data = ob.data.copy()
    topology = bmesh.new()
    topology.from_mesh(ob.data)
    interior = [face for face in topology.faces if any(predicate(v.co) for v in face.verts)]
    bmesh.ops.delete(topology, geom=interior, context='FACES_ONLY')
    topology.to_mesh(ob.data)
    topology.free()


def bind(ob, rig, bone='spine_03'):
    ob.parent = rig
    group = ob.vertex_groups.new(name=bone)
    group.add(range(len(ob.data.vertices)), 1.0, 'REPLACE')
    mod = ob.modifiers.new("Follow the upper back", "ARMATURE")
    mod.object = rig
    mod.use_deform_preserve_volume = True


def convert_and_bind(ob, rig, bone='spine_03'):
    bpy.ops.object.select_all(action='DESELECT')
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH')
    bind(bpy.context.object, rig, bone)


def angles(count):
    return (2 * pi * i / count for i in range(count))


def ring_mesh(name, rings, mat, close=True):
    span = len(rings[0])
    faces = [(i*span+j,i*span+(j+1)%span,(i+1)*span+(j+1)%span,(i+1)*span+j)
             for i in range(len(rings)-1) for j in range(span)]
    if close:
        end = (len(rings)-1)*span
        faces.extend((tuple(reversed(range(span))), tuple(end+i for i in range(span))))
    obj = mesh(name, [p for ring in rings for p in ring], faces, mat)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def sack(name, location, axes, material, variant):
    points, faces = [], []
    rows, columns = 14, 24
    for i in range(rows + 1):
        along = -pi / 2 + pi * i / rows
        for j in range(columns):
            across = 2 * pi * j / columns
            folds = 1 + .07 * cos(6 * across + 3 * along + variant) + .042 * sin(9 * across - 5 * along)
            radius = max(.01, cos(along)) ** .55
            points.append((location[0] + axes[0] * sin(along),
                           location[1] + axes[1] * radius * folds * cos(across),
                           location[2] + axes[2] * radius * folds * sin(across)))
            idx = i * columns + j
            nxt = i * columns + (j + 1) % columns
            if i < rows:
                faces.append((idx, idx + columns, nxt + columns, nxt))
    faces.extend((tuple(reversed(range(columns))), tuple(rows * columns + j for j in range(columns))))
    obj = mesh(name, points, faces, material)
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


class Actor:
    def __init__(self, ob, scale, shoes, head_and_hands):
        self.ob = ob
        self.scale = scale
        ob.rotation_mode = 'XYZ'
        self.rest = {b.name: b.matrix_local.copy() for b in ob.data.bones}
        self.inverse = {n: matrix.inverted() for n, matrix in self.rest.items()}
        self.rest_head = {name: matrix.translation.copy() for name, matrix in self.rest.items()}
        self.bones = ob.pose.bones
        self.pose = {}
        self.turn = Quaternion()
        self.palm = {}
        self.hand_vertices = {}
        self.soles = {}
        for side in ('l', 'r'):
            average = sum((self.rest_head[f'{finger}_01_{side}'] for finger in ('index','middle','pinky','ring')), Vector()) / 4
            wrist = self.rest_head[f'hand_{side}']
            lengthway = (average - wrist).normalized()
            width = (self.rest_head[f'index_01_{side}'] - self.rest_head[f'pinky_01_{side}']).normalized()
            frame = axes(lengthway, width)
            self.palm[side] = (frame, (average - wrist).length * .59)
            sign = 1 if side == 'l' else -1
            self.hand_vertices[side] = [v.co - wrist for v in head_and_hands.data.vertices if sign * v.co.x > .459]
            foot = f'foot_{side}'
            group = shoes.vertex_groups[foot].index
            self.soles[side] = [v.co - self.rest_head[foot] for v in shoes.data.vertices if v.co.z < .0035
                                and any(g.group == group and g.weight > .99 for g in v.groups)]

    def place(self, x, y, z, yaw):
        self.ob.location = (x, y, z)
        self.ob.rotation_euler.z = yaw
        self.turn = Quaternion((0, 0, 1), yaw)
        self.pose.clear()

    def world_to_local(self, xyz):
        return (self.turn.inverted() @ (Vector(xyz) - self.ob.location)) / self.scale

    def local_to_world(self, xyz):
        return self.ob.location + self.turn @ (Vector(xyz) * self.scale)

    def inherited(self, name):
        parent = self.bones[name].parent
        if parent is None:
            return self.rest[name]
        key = parent.name
        parent_matrix = self.pose[key] if key in self.pose else self.inherited(key)
        return parent_matrix @ self.inverse[key] @ self.rest[name]

    def set(self, name, transformation):
        self.pose[name] = transformation
        bone = self.bones[name]
        inherited = self.inherited(name)
        bone.matrix_basis = inherited.inverted() @ transformation

    def offset(self, name, delta=None, angle=(0, 0, 0)):
        matrix = self.inherited(name)
        pivot = matrix.translation.copy()
        if delta is not None:
            pivot += Vector(delta)
        rotation = Quaternion((0, 0, 1), angle[2]) @ Quaternion((0, 1, 0), angle[1]) @ Quaternion((1, 0, 0), angle[0])
        posed = rotation.to_matrix().to_4x4() @ matrix
        posed.translation = pivot
        self.set(name, posed)

    def limb(self, names, target, pole):
        first, second, end = names
        point = self.inherited(first).translation
        a = (self.rest_head[second] - self.rest_head[first]).length
        b = (self.rest_head[end] - self.rest_head[second]).length
        towards = (target - point).normalized()
        reach = clamp((target - point).length, abs(a-b) + .002, a + b - .002)
        target = point + towards * reach
        lateral = (pole - towards * towards.dot(pole)).normalized()
        chord = (a * a - b * b + reach * reach) / (2 * reach)
        hinge = point + towards * chord + lateral * sqrt(max(0, a*a - chord*chord))
        self.point_bone(first, point, hinge, self.rest_head[second] - self.rest_head[first])
        self.point_bone(second, hinge, target, self.rest_head[end] - self.rest_head[second])
        return target

    def point_bone(self, name, start, end, neutral):
        rot = neutral.normalized().rotation_difference((end - start).normalized())
        posed = rot.to_matrix().to_4x4() @ self.rest[name]
        posed.translation = start
        self.set(name, posed)

    def leg(self, side, ankle, tilt=0):
        names = tuple(f'{name}_{side}' for name in ('thigh', 'calf', 'foot'))
        ankle = self.limb(names, Vector(ankle), Vector((.06 if side == 'l' else -.06, -1, .08)))
        foot = names[-1]
        rotation = Quaternion((1,0,0), tilt).to_matrix().to_4x4() @ self.rest[foot]
        rotation.translation = ankle
        self.set(foot, rotation)
        return ankle

    def walking_foot(self, side, x, y, swing, lift):
        forward = self.turn @ Vector((0, -1, 0))
        heel = Vector((x,y,0)) - .025 * forward
        toe = Vector((x,y,0)) + .20 * forward
        slope = atan2(deck_surface(toe.y,toe.x)-deck_surface(heel.y,heel.x), .225)
        tilt = -.25 * sin(swing * 2 * pi) - slope
        foot_turn = self.turn @ Quaternion((1,0,0), tilt)
        footprint = [foot_turn @ (point * self.scale) for point in self.soles[side]]
        height = max(deck_surface(y+point.y, x+point.x)-point.z for point in footprint)
        target = Vector((x, y, height + lift + .0017))
        actual = self.leg(side, self.world_to_local(target), tilt)
        return round((self.local_to_world(actual)-target).length,6)

    def arm_frame(self, side, palms_up):
        palm_rest, offset = self.palm[side]
        sign = 1 if side == 'l' else -1
        down = Vector((0, -.21, -1)).normalized()
        forward = down.lerp(Vector((0, -1, .05)), palms_up).normalized()
        hand_side = Vector((0, -1, 0)).lerp(Vector((sign, 0, 0)), palms_up)
        return forward, offset, axes(forward, hand_side) @ palm_rest.transposed()

    def grip_depth(self, side, normal):
        forward, offset, rotation = self.arm_frame(side, 1)
        return self.scale * max(normal.dot((rotation @ point) - forward * offset) for point in self.hand_vertices[side])

    def arm(self, side, palm_target, palms_up=0):
        names = tuple(f'{name}_{side}' for name in ('upperarm', 'lowerarm', 'hand'))
        sign = 1 if side == 'l' else -1
        forward, offset, orient = self.arm_frame(side, palms_up)
        wrist = self.limb(names, Vector(palm_target) - forward * offset,
                          Vector((sign * .68, .25, -.74)))
        hand = names[-1]
        transform = orient.to_4x4() @ self.rest[hand]
        transform.translation = wrist
        self.set(hand, transform)
        return wrist + forward * offset


def axes(forward, width):
    across = (width - forward * forward.dot(width)).normalized()
    return Matrix((forward, across, forward.cross(across))).transposed()


def hold_door(actor, door, side, lower, release, time):
    direction = pi / 2 if side < 0 else -pi / 2
    withdraw = ease(release, 0, .61)
    rise = ease(release, .61, 1)
    actor.place(BRIDGE_X + side * (1.63 + .015 * cos(time * 1.6 + side) + .061 * withdraw),
                HERO_HULL_Y + (.082 if side < 0 else -.017), STAGING_HEIGHT, direction)
    shoulder_drop = lower * (1 - .69 * rise)
    reach = ease(lower, .38, .86) * (1 - rise)
    actor.offset('pelvis', (.012 * sin(time * 1.8 + side), -.092 - .061 * shoulder_drop + .045 * reach + .063 * withdraw,
                           -.104 - .303 * shoulder_drop - .125 * reach - .074 * withdraw * (1-rise)),
                 (.23 + .66 * shoulder_drop - .20 * withdraw * (1-rise), .020 * side, .014 * side))
    actor.offset('spine_01', angle=(.02 + .050 * lower * (1 - release), .022 * side, 0))
    actor.offset('spine_03', angle=(.015, -.033 * side, -.058 * side + .014 * sin(time * 2)))
    actor.offset('neck_01', angle=(-.05 - .24 * shoulder_drop, .044 * side, -.034 * side))
    actor.offset('head', angle=(.10 + .048 * shoulder_drop, 0, -.06 * side * (1 - lower)))

    grips, supports = [], []
    for hand, width in (('l', 1), ('r', -1)):
        ankle = actor.rest_head[f'foot_{hand}']
        # The feet remain at their actual bow and stern work surfaces throughout the lift.
        foot_x = BRIDGE_X + side * (1.67 + .059 * width)
        foot_y = HERO_HULL_Y + (.072 if side < 0 else -.032) - side * width * .133
        fixed = (foot_x, foot_y, STAGING_HEIGHT + ankle.z * actor.scale + .0015)
        planted = actor.leg(hand, actor.world_to_local(fixed))
        supports.append(round((actor.local_to_world(planted) - Vector(fixed)).length, 6))
        door_normal = door.matrix_world.to_3x3() @ Vector((0,0,1))
        depth = actor.grip_depth(hand, actor.turn.inverted() @ door_normal)
        local = (side * (DOOR_WIDTH / 2 - .039), -side * width * DOOR_DEPTH * .304,
                 -.0515 - depth - .001)
        board_contact = door.matrix_world @ Vector(local)
        pose_contact = actor.world_to_local(board_contact)
        if release > 0:
            outward = pose_contact + Vector((width * .062, .312, -.060))
            lowered = Vector((width * .207, .017, .764))
            pose_contact = pose_contact.lerp(outward, withdraw).lerp(lowered, rise)
        grasped = actor.arm(hand, pose_contact, 1 - rise)
        grips.append(round((actor.local_to_world(grasped) - board_contact).length, 6))
    return {'palms_to_door_m': grips, 'stance_ankle_error_m': supports}


def soldier(actor, person, time, lantern=None):
    x, start, speed, cycle, phase, yaw, seed = person
    y = start + speed * time
    progress = time / cycle + phase
    rock = sin(progress * 2 * pi)
    z = deck_surface(y, x)
    actor.place(x + .027 * rock, y, z, yaw)
    drop = .106 - .021 * cos(4*pi*(progress - .18))
    actor.offset('pelvis', (.008 * rock, -.030, -drop), (.081, -.050 * rock, .032 * rock))
    actor.offset('spine_01', angle=(.004, .023 * rock, -.036 * rock))
    actor.offset('spine_03', angle=(.028 + .010 * seed, .021 * rock, -.039 * rock))
    actor.offset('neck_01', angle=(-.064, .02 * sin(time * 2 + seed), .06 * sin(time * 1.4 + seed)))
    actor.offset('head', angle=(.086, -.052 * rock, -.03 * sin(time * 2.1 + seed)))

    planted_errors = []
    for hand, width in (('l', 1), ('r', -1)):
        q = progress + (.5 if width == 1 else 0)
        whole = floor(q)
        portion = q - whole
        planted = portion <= .61
        swing = ease(portion, .61, 1.0)
        travel = (whole + .295 - phase - (.5 if width == 1 else 0) + swing) * cycle
        foot_y = start + speed * travel
        foot_x = x - width * (.128 + .015 * cos(seed + whole)) + .025 * sin(whole + seed)
        lift = (.097 + .023 * seed) * sin(pi * swing)
        error = actor.walking_foot(hand, foot_x, foot_y, swing, lift)
        if planted:
            planted_errors.append(error)
        arm_swing = (sin((q - .14) * 2 * pi) * .120)
        rest_palm = Vector((width * (.216 + .030 * seed), -.035 - arm_swing, .742 + .043 * seed))
        if lantern is not None and hand == 'r':
            rest_palm = Vector((-.285, -.248 - .035 * rock, .935 + .030*cos(progress * 2*pi)))
            palm = actor.arm(hand, rest_palm, .12)
            lantern.location = actor.local_to_world(palm) + Vector((-.011,.012,-.184))
            lantern.rotation_euler.y = .06 * rock
        else:
            actor.arm(hand, rest_palm)
    return planted_errors

