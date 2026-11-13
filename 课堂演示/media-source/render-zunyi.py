"""Render the fixed-camera Zunyi classroom scene with Blender 4.5 and FFmpeg.

blender -b --factory-startup --python-exit-code 1 --python render-zunyi.py -- OUTPUT_DIR preview|render
ffmpeg -framerate 24 -i OUTPUT_DIR/frame-%04d.png -c:v libx264 -crf 19 -pix_fmt yuv420p -movflags +faststart zunyi.mp4
The accompanying MakeHuman base mesh is CC0. See its embedded source header.
"""
import gzip
import math
import random
import sys
from collections import defaultdict
from pathlib import Path

import bpy
from mathutils import Euler, Matrix, Vector

FPS = 24
FRAMES = 8 * FPS
HERE = Path(__file__).resolve().parent
OUT = Path(sys.argv[sys.argv.index('--') + 1]).resolve()
MODE = sys.argv[sys.argv.index('--') + 2]
if MODE not in {'preview', 'render'}:
    raise ValueError('Expected preview or render')
OUT.mkdir(parents=True, exist_ok=True)
V = Vector
RNG = random.Random(1935)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mat(name, dark, light=None, scale=(8, 8, 8), roughness=.58, bump=.05, metal=0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = (*dark, 1)
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*dark, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = metal
    if light is not None:
        tex = nodes.new('ShaderNodeTexCoord')
        mapping = nodes.new('ShaderNodeVectorMath')
        mapping.operation = 'MULTIPLY'
        mapping.inputs[1].default_value = scale
        links.new(tex.outputs['Object'], mapping.inputs[0])
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 1
        noise.inputs['Detail'].default_value = 4
        links.new(mapping.outputs[0], noise.inputs['Vector'])
        ramp = nodes.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].position = .19
        ramp.color_ramp.elements[0].color = (*dark, 1)
        ramp.color_ramp.elements[1].position = .81
        ramp.color_ramp.elements[1].color = (*light, 1)
        links.new(noise.outputs['Fac'], ramp.inputs[0])
        links.new(ramp.outputs[0], bsdf.inputs['Base Color'])
        if bump:
            detail = nodes.new('ShaderNodeBump')
            detail.inputs['Strength'].default_value = bump
            detail.inputs['Distance'].default_value = .035
            links.new(noise.outputs['Fac'], detail.inputs['Height'])
            links.new(detail.outputs[0], bsdf.inputs['Normal'])
    return material


def glow(name, color, strength):
    material = mat(name, color)
    bsdf = material.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Emission Color'].default_value = (*color, 1)
    bsdf.inputs['Emission Strength'].default_value = strength
    return material


def mesh(name, vertices, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    obj.data.materials.append(material)
    return obj


def smooth(obj):
    for face in obj.data.polygons:
        face.use_smooth = True
    return obj


def box(name, xyz, size, material, bevel=.012, rotation=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.rotation_euler.z = rotation
    obj.data.materials.append(material)
    if bevel:
        modifier = obj.modifiers.new('Worn edges', 'BEVEL')
        modifier.width = bevel
        modifier.segments = 3
        obj.modifiers.new('Face normals', 'WEIGHTED_NORMAL')
    return obj


def ball(name, xyz, size, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24, ring_count=16, location=xyz)
    obj = bpy.context.object
    obj.name = name
    obj.scale = size
    obj.data.materials.append(material)
    return smooth(obj)


def line(name, points, material, radius):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth = radius
    data.bevel_resolution = 2
    spline = data.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for p, xyz in zip(spline.points, points):
        p.co = (*xyz, 1)
    obj = bpy.data.objects.new(name, data)
    scene.collection.objects.link(obj)
    data.materials.append(material)
    return obj


def loft(name, rings, material):
    count = len(rings[0])
    faces = [tuple(reversed(range(count)))]
    for row in range(len(rings) - 1):
        for col in range(count):
            i = row * count + col
            j = row * count + (col + 1) % count
            faces.append((i, j, j + count, i + count))
    faces.append(tuple(range((len(rings) - 1) * count, len(rings) * count)))
    return smooth(mesh(name, [p for ring in rings for p in ring], faces, material))


def ellipse(z, width, depth, y=0, x=0, ripples=0):
    points = []
    for i in range(40):
        a = math.tau * i / 40
        fold = 1 + ripples * math.sin(7 * a + 11 * z)
        points.append((x + width * math.cos(a) * fold, y + depth * math.sin(a) * fold, z))
    return points


def area(name, xyz, focus, power, color, size):
    lamp = bpy.data.lights.new(name, 'AREA')
    lamp.energy, lamp.color, lamp.shape, lamp.size = power, color, 'DISK', size
    obj = bpy.data.objects.new(name, lamp)
    scene.collection.objects.link(obj)
    obj.location = xyz
    obj.rotation_euler = (V(focus) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return lamp


wood = mat('Old oiled elm', (.019, .010, .006), (.105, .044, .019), (3, 55, 36), .65, .29)
dark_wood = mat('Smoked timber', (.011, .008, .007), (.052, .032, .017), (35, 37, 2.2), .57, .22)
plaster = mat('Aged lime plaster', (.058, .039, .025), (.177, .124, .084), (4, 4, 9), .95, .36)
paper = mat('Warm uncoated paper', (.47, .36, .22), (.79, .66, .43), (48, 48, 48), .85, .08)
ink = mat('Faded ink', (.087, .057, .035), roughness=.89)
metal = mat('Patinated dark brass', (.08, .051, .028), (.24, .15, .06), (21, 20, 37), .43, .16, .7)
enamel = mat('Warm ceramic', (.36, .27, .16), (.56, .45, .28), (54, 50, 28), .36, .05)
night = glow('Blue night through windows', (.020, .048, .091), .65)
night.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value = 1
night.node_tree.nodes.get('Principled BSDF').inputs['Specular IOR Level'].default_value = 0
flame = glow('Wick flame', (1, .27, .035), 8)
hair = mat('Dark hair and brows', (.019, .013, .012), (.047, .034, .026), (88, 106, 56), .82)
white = mat('Eye white', (.35, .28, .21), roughness=.35)
iris = mat('Brown iris', (.047, .025, .015), roughness=.38)
pupil = mat('Pupil', (.009, .006, .005), roughness=.35)

# The shot faces a plaster and wood interior. Both faces are visible in three-quarter profile.
box('Back wall', (0, 1.53, 1.38), (7, .18, 2.76), plaster)
box('Left wall', (-2.4, 0, 1.38), (.18, 3, 2.76), plaster)
box('Right wall', (2.4, 0, 1.38), (.18, 3, 2.76), plaster)
box('Floor', (0, 0, -.10), (5, 6, .2), dark_wood)
box('Ceiling', (0, 0, 2.82), (5, 6, .2), dark_wood)
for x in (-2.23, -.56, .63, 2.22):
    box('Wall upright', (x, 1.38, 1.4), (.085, .14, 2.8), dark_wood)
for z in (.17, .82, 2.42):
    box('Wall rail', (0, 1.38, z), (4.55, .15, .075), dark_wood)
for x, width in ((-1.40, 1.20), (1.47, 1.21)):
    box('Window frame', (x, 1.38, 1.79), (width + .12, .14, 1.13), dark_wood)
    box('Window night', (x, 1.29, 1.79), (width, .023, 1.0), night, .002)
    for dx in (-width / 2, -width / 6, width / 6, width / 2):
        box('Window mullion', (x + dx, 1.24, 1.79), (.033, .08, 1.04), dark_wood, .004)
    for z in (1.30, 1.54, 1.80, 2.05, 2.28):
        box('Window bar', (x, 1.24, z), (width + .02, .08, .031), dark_wood, .004)
    for i in range(4):
        h = 1.43 + .08*i
        line('Distant roof tiles', [(x - width/2, 1.266, h), (x - .13, 1.266, h+.16), (x + width/2, 1.266, h+.04)], dark_wood, .013)
for x in (-.38, -.21, -.04, .13, .30, .47):
    box('Panel inset', (x, 1.42, .51), (.155, .035, .58), dark_wood, .006)

TABLE_Z = .891
for i in range(6):
    box('Table plank', (0, -.26 + i * .127, TABLE_Z - .030), (2.48, .1255, .06), wood, .007)
box('Table front apron', (0, -.33, .807), (2.39, .075, .11), dark_wood)
for x in (-1.07, 1.07):
    for y in (-.29, .32):
        box('Table leg', (x, y, .414), (.099, .095, .8), dark_wood)
for x in (-.67, .69):
    box('Chair seat', (x, .70, .50), (.46, .43, .065), wood)
    for dx in (-.20, .20):
        box('Chair upright', (x + dx, .88, .61), (.046, .055, 1.18), dark_wood)
    for z in (.79, 1.02, 1.15):
        box('Chair slat', (x, .88, z), (.43, .05, .065), dark_wood)


def lathe(name, x, y, rings, material):
    return loft(name, [ellipse(z, radius, radius, y, x) for z, radius in rings], material)


# Lamp sits well behind the papers so it frames the action without blocking it.
lx, ly = .045, .40
lathe('Kerosene lamp base', lx, ly, [(.892, .063), (.903, .069), (.918, .068), (.938, .047), (.956, .039), (.977, .037), (.984, .044)], metal)
lathe('Lamp cap', lx, ly, [(1.116, .033), (1.13, .039), (1.141, .030), (1.151, .018)], metal)
ball('Flame', (lx, ly, 1.015), (.014, .012, .036), flame)
for side in (-1, 1):
    line('Lamp support', [(lx + side * w, ly, z) for w, z in ((.058, .930), (.071, .963), (.067, 1.053), (.050, 1.119), (.034, 1.134))], metal, .005)
    line('Glass guard', [(lx + side * w, ly - .022, z) for w, z in ((.030, .98), (.044, 1.016), (.038, 1.059), (.021, 1.11))], metal, .0018)
for x, y in ((-.99, .24), (.96, .17)):
    lathe('Ceramic tea cup', x, y, [(.892, .033), (.898, .041), (.965, .049), (.978, .049), (.978, .043), (.965, .042), (.902, .033)], enamel)
    lathe('Dark tea', x, y, [(.949, .039), (.953, .040)], ink)
    line('Cup handle', [(x + .041 + .027 * math.sin(i * math.pi / 16), y, .937 + .025 * math.cos(i * math.pi / 16)) for i in range(17)], enamel, .006)


def load_base():
    vertices, groups = [], defaultdict(list)
    with gzip.open(HERE / 'makehuman-base.obj.gz', 'rt', encoding='utf-8') as src:
        for row in src:
            cols = row.split()
            if not cols:
                continue
            if cols[0] == 'v':
                x, z, y = map(float, cols[1:4])
                vertices.append(V((x / 10, -y / 10, z / 10)))
            elif cols[0] == 'g':
                group = cols[1]
            elif cols[0] == 'f':
                groups[group].append(tuple(int(v.split('/')[0]) - 1 for v in cols[1:]))
    return vertices, groups


BASE, GROUPS = load_base()


def landmark(group):
    indices = {i for face in GROUPS[group] for i in face}
    return sum((BASE[i] for i in indices), V()) / len(indices)


def extract(name, group, keep, transform, material):
    faces = [face for face in GROUPS[group] if all(keep(BASE[i]) for i in face)]
    indices = sorted({i for face in faces for i in face})
    lookup = {index: new for new, index in enumerate(indices)}
    return smooth(mesh(name, [transform(BASE[i]) for i in indices], [tuple(lookup[i] for i in f) for f in faces], material))


def attach(obj, arm, bone):
    # Bone parenting preserves each model's rest transform, including hats and buttons.
    bpy.context.view_layer.update()
    world = obj.matrix_world.copy()
    obj.parent = arm
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    obj.matrix_world = world
    return obj


def make_armature(name):
    data = bpy.data.armatures.new(name)
    rig = bpy.data.objects.new(name, data)
    scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for key in ('Jacket', 'Head', 'Upper.L', 'Lower.L', 'Hand.L', 'Upper.R', 'Lower.R', 'Hand.R'):
        bone = data.edit_bones.new(key)
        bone.head, bone.tail = (0, 0, 0), (0, 1, 0)
    bpy.ops.object.mode_set(mode='OBJECT')
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
    return rig


def sleeve(name, length, widths, material):
    rings = []
    for i, width in enumerate(widths):
        y = i * length / (len(widths) - 1)
        rings.append([(width * math.cos(a), y, width * math.sin(a) * .88 * (1 + .055 * math.sin(6 * a + i)))
                      for a in [math.tau * j / 32 for j in range(32)]])
    return loft(name, rings, material)


def hand_model(name, side, material):
    prefix = f'joint-{side.lower()}-'
    wrist = landmark(prefix + 'hand')
    tip = landmark(prefix + 'finger-3-4')
    forward = (tip - wrist).normalized()
    thumb = landmark(prefix + 'finger-1-4')
    across = thumb - wrist - forward * (thumb - wrist).dot(forward)
    across.normalize()
    if side == 'L':
        across.negate()
    up = across.cross(forward)
    basis = Matrix((across, forward, up)).transposed()
    # A mild finger curl is baked into the mesh and keeps the index near the page corner.
    def shape(point):
        x, y, z = basis.transposed() @ (point - wrist)
        curl = max(0, y - .066)
        return V((x, y - 1.8 * curl**2, z - 7.0 * curl**2))

    hand = extract(name, 'body', lambda v: (v - wrist).dot(forward) > -.014 and v.x * (1 if side == 'L' else -1) > .365, shape, material)
    return hand, shape(landmark(prefix + 'finger-2-4'))


def person(name, x, y, yaw, jacket, skin, head_scale):
    rig = make_armature(name)
    coat = loft(name + ' cotton jacket', [ellipse(z, w, d, cy, ripples=.036) for z, w, d, cy in
                [(-.34,.18,.107,.035), (-.25,.19,.117,.025), (-.12,.183,.117,.016), (.022,.192,.123,.006),
                 (.13,.204,.122,0), (.187,.184,.099,.003), (.209,.119,.073,.007), (.219,.067,.061,.009)]], jacket)
    attach(coat, rig, 'Jacket')
    seam = mat(name + ' jacket seam', (.069, .065, .052), roughness=.86)
    for z in (-.20, -.105, -.01, .085, .148):
        attach(ball('Jacket button', (.007, -.119, z), (.008,.005,.008), metal), rig, 'Jacket')
    attach(line('Jacket placket', [(.010,-.104,-.26), (.008,-.123,-.14), (.005,-.126,.09), (.002,-.090,.186)], seam, .0027), rig, 'Jacket')
    for side in (-1,1):
        attach(line('Breast pocket seam', [(side*x,-y,z) for x,y,z in ((.041,.126,.086),(.13,.100,.086),(.13,.100,.021),(.043,.124,.021),(.041,.126,.086))], seam, .0024), rig, 'Jacket')
        collar = mesh('Folded collar', [(0,-.082,.194),(side*.065,-.062,.224),(side*.100,-.088,.178),(side*.057,-.115,.143)], [(0,1,2,3)], jacket)
        attach(collar, rig, 'Jacket')
        solid = collar.modifiers.new('Collar thickness', 'SOLIDIFY')
        solid.thickness = .007
    head_origin = V((0,-.007,.580))
    head_transform = lambda p: (p - head_origin) * head_scale
    head = extract(name + ' face', 'body', lambda p: p.z > .579, head_transform, skin)
    head.data.materials.append(hair)
    for face in head.data.polygons:
        center = sum((head.data.vertices[i].co for i in face.vertices), V()) / len(face.vertices)
        if center.z > .179 and (center.y > -.040 or center.z > .195):
            face.material_index = 1
    attach(head, rig, 'Head')
    neck = ball('Neck', (0,.002,.027), (.057,.054,.067), skin)
    attach(neck, rig, 'Head')
    for side in ('l','r'):
        eye_center = head_transform(landmark(f'joint-{side}-eye'))
        eye = extract('Eye globe', f'helper-{side}-eye', lambda p: True, head_transform, white)
        attach(eye, rig, 'Head')
        attach(ball('Iris', eye_center + V((0,-.0126,0)), (.0055,.002,.0055), iris), rig, 'Head')
        attach(ball('Pupil', eye_center + V((0,-.0144,0)), (.0023,.0008,.0024), pupil), rig, 'Head')
        sign = 1 if side == 'l' else -1
        attach(line('Eyebrow', [eye_center + V((sign*dx, dy, dz)) for dx,dy,dz in ((-.010,-.014,.011),(0,-.016,.014),(.011,-.013,.014),(.019,-.007,.010))], hair, .0016), rig, 'Head')
    cap = loft('Soft military cap', [ellipse(z*head_scale,w*head_scale,d*head_scale,cy*head_scale,ripples=.035) for z,w,d,cy in
               ((.187,.099,.118,-.039),(.214,.099,.118,-.039),(.255,.091,.099,-.027),(.273,.074,.084,-.017),(.277,.045,.057,-.010))], jacket)
    attach(cap, rig, 'Head')
    brim_rings = []
    for v in range(2):
        for i in range(25):
            t = (i / 24 - .5) * math.pi
            brim_rings.append((math.sin(t)*(.078 + v*.018)*head_scale,(-.047-math.cos(t)*(.060+v*.048))*head_scale,(.199-v*.008+.008*math.cos(t))*head_scale))
    brim = smooth(mesh('Cloth cap visor', brim_rings, [(i,i+1,i+26,i+25) for i in range(24)], jacket))
    brim.modifiers.new('Visor thickness','SOLIDIFY').thickness = .007
    attach(brim, rig, 'Head')
    attach(line('Cap band stitching', [(.088*math.cos(a)*head_scale,(-.028+.096*math.sin(a))*head_scale,.212*head_scale) for a in [math.tau*i/64 for i in range(65)]], seam, .0022), rig, 'Head')
    fingertips = {}
    for side in ('L','R'):
        upper = sleeve('Upper jacket sleeve', .268, [.075,.080,.076,.068,.059,.056], jacket)
        lower = sleeve('Lower jacket sleeve', .244, [.060,.061,.056,.053,.046,.040,.039], jacket)
        attach(upper, rig, 'Upper.'+side)
        attach(lower, rig, 'Lower.'+side)
        joint = ball('Elbow cloth fold', (0,0,0), (.057,.060,.051), jacket)
        attach(joint, rig, 'Lower.'+side)
        hand, fingertips[side] = hand_model('Sculpted hand',side,skin)
        attach(hand, rig, 'Hand.'+side)
        attach(line('Cuff seam', [( .039*math.cos(a),.233,.034*math.sin(a)) for a in [math.tau*i/40 for i in range(41)]], seam, .0017), rig, 'Lower.'+side)
    return rig, V((x, y, 1.072)), yaw, fingertips


jacket_a = mat('Left warm gray cotton', (.027,.027,.024), (.075,.070,.054), (186, 210, 216), .89, .25)
jacket_b = mat('Right blue gray cotton', (.017,.025,.030), (.060,.077,.081), (196, 212, 212), .88, .24)
skin_a = mat('Warm skin', (.167,.078,.046), (.34,.171,.105), (97, 99, 109), .63, .025)
skin_b = mat('Olive skin', (.151,.066,.041), (.308,.151,.090), (106, 107, 117), .62, .025)
left = person('Participant on left', -.57, .408, math.radians(47), jacket_a, skin_a, 1.02)
right = person('Participant on right', .61, .421, math.radians(-49), jacket_b, skin_b, .99)

# The two piles stay under the existing lesson's material hotspots.
PIVOT = V((-.226, .178, TABLE_Z + .018))
WIDTH, DEPTH = .216, .234
for i in range(7):
    box('Meeting notes stack', (PIVOT.x + .003 + i*.0005, PIVOT.y + .002, TABLE_Z + .0015 + i*.002), (.450,.242,.0024), paper, .001, math.radians((i-3)*.45))
for i in range(6):
    box('Second dossier', (.452 + i*.0009, .054 + i*.0012, TABLE_Z + .002 + i*.002), (.321,.247,.0025), paper, .001, math.radians(-9 + i*.48))
for n in range(9):
    x = .342 + n*.022
    for k in range(8 - n%3):
        y = -.033 + k*.022
        line('Ink on second dossier', [(x,y,.907),(x+.003,y+.007,.907),(x+.002,y+.013,.907)], ink, .00072)


def tween(keys, t):
    for (start, a), (end, b) in zip(keys, keys[1:]):
        if t <= end:
            s = min(1, max(0, (t-start)/(end-start)))
            s = s*s*(3-2*s)
            return a + (b-a)*s
    return keys[-1][1]


def leaf(u, v, amount):
    # Integrate the tangent so the curved sheet keeps its length as it turns.
    angle = math.pi * amount
    curl = math.sin(angle) * 1.09
    x, z = 0., 0.
    for i in range(16):
        s = (i + .5) * u / 16
        tangent = angle + curl * (1 - 2*s) * (.78 + v*.22)
        x += math.cos(tangent) * WIDTH * u / 16
        z += math.sin(tangent) * WIDTH * u / 16
    return PIVOT + V((x, DEPTH*(v-.5), z + .004*math.sin(math.pi*u)*math.sin(angle)))


# Geometry for the printed strokes follows the same page surface as the paper.
uvs = [(i/24, j/12, 0) for j in range(13) for i in range(25)]
faces = [(j*25+i,j*25+i+1,(j+1)*25+i+1,(j+1)*25+i) for j in range(12) for i in range(24)]
ink_start = len(faces)
for col in range(8):
    for row in range(9 - col%3):
        u, v = .14+col*.091, .15+row*.084
        width = RNG.uniform(.012,.031)
        start = len(uvs)
        uvs.extend([(u,v,.0015),(u+width,v+.003,.0015),(u+width*.88,v+.014,.0015),(u-.005,v+.012,.0015)])
        faces.append((start,start+1,start+2,start+3))
page = smooth(mesh('Turning sheet with printed strokes',[leaf(u,v,0)+V((0,0,h)) for u,v,h in uvs],faces,paper))
page.data.materials.append(ink)
for face in page.data.polygons[ink_start:]:
    face.material_index = 1
page.shape_key_add(name='Flat on right')
mesh('Ink on page below', [leaf(u,v,0)+V((0,0,-.0026)) for u,v,_ in uvs], faces[ink_start:], ink)


def rotation(forward, up):
    y = V(forward).normalized()
    x = y.cross(V(up)).normalized()
    z = x.cross(y)
    return Matrix((x,y,z)).transposed().to_quaternion()


def set_bone(rig, name, pos, orientation, frame):
    bone = rig.pose.bones[name]
    bone.location = pos
    if bone.rotation_quaternion.dot(orientation) < 0:
        orientation.negate()
    bone.rotation_quaternion = orientation
    bone.keyframe_insert('location', frame=frame)
    bone.keyframe_insert('rotation_quaternion', frame=frame)


def arm(rig, side, shoulder, wrist, hand_rotation, torso_rotation, frame):
    aim = wrist - shoulder
    direction = aim.normalized()
    distance = min(.510, aim.length)
    a, b = .268, .244
    along = (distance*distance+a*a-b*b)/(2*distance)
    spread = math.sqrt(max(0, a*a-along*along))
    hint = torso_rotation @ V((1 if side=='L' else -1, .15, -.78))
    hint = (hint-direction*hint.dot(direction)).normalized()
    elbow = shoulder + direction*along + hint*spread
    wrist = shoulder + direction*distance
    set_bone(rig,'Upper.'+side,shoulder,rotation(elbow-shoulder,(0,0,1)),frame)
    set_bone(rig,'Lower.'+side,elbow,rotation(wrist-elbow,(0,0,1)),frame)
    set_bone(rig,'Hand.'+side,wrist,hand_rotation,frame)
    return wrist


def act(actor, frame, t, pitch, yaw_offset, lean, hands):
    rig, base, yaw, _ = actor
    root = base + V((0,0,.003*math.sin(math.tau*t/8)))
    torso = Euler((lean,0,yaw),'XYZ').to_quaternion()
    head = Euler((pitch,0,yaw+yaw_offset),'XYZ').to_quaternion()
    set_bone(rig,'Jacket',root,torso,frame)
    set_bone(rig,'Head',root + torso @ V((0,-.005,.201)),head,frame)
    wrists = []
    for side, (wrist, orientation) in zip(('L','R'),hands):
        shoulder = root + torso @ V(((1 if side=='L' else -1)*.174,0,.126))
        wrists.append(arm(rig,side,shoulder,wrist,orientation,torso,frame))
    return wrists


left_rest = V((-.405,.254,.977))
left_idle = rotation((.78,-.61,.19),(0,0,1))
contact_error = 0
for frame in range(1, FRAMES + 1):
    t = (frame-1)/FPS
    amount = tween([(0,0.),(1.8,0.),(2.35,.19),(3.13,.69),(3.72,1.)],t)
    if 0 < amount < 1:
        key = page.shape_key_add(name=f'Page bend {frame:03d}')
        angle = math.pi*amount
        for point, (u,v,h) in zip(key.data,uvs):
            point.co = leaf(u,v,amount)+V((-math.sin(angle)*h,0,math.cos(angle)*h))
        key.value = 0
        key.keyframe_insert('value',frame=frame-1)
        key.value = 1
        key.keyframe_insert('value',frame=frame)
        key.value = 0
        key.keyframe_insert('value',frame=frame+1)
    if amount == 1 and frame == math.ceil(3.72 * FPS) + 1:
        key = page.shape_key_add(name='Flat on left')
        for point,(u,v,h) in zip(key.data,uvs):
            point.co = leaf(u,v,1) + V((0,0,-h))
        key.value = 0
        key.keyframe_insert('value',frame=frame-1)
        key.value = 1
        key.keyframe_insert('value',frame=frame)
    angle = math.pi*amount
    corner = leaf(.98,.23,amount) + V((0,0,.004))
    grasp = rotation((.83*math.cos(angle),-.45,-.53),(0,0,1))
    contact = tween([(0,0.),(.73,0.),(1.75,1.),(3.75,1.),(4.67,0.)],t)
    left_rot = left_idle.slerp(grasp,contact)
    left_wrist = left_rest.lerp(corner-grasp@left[3]['L'],contact)
    left_wrist.z += .042*math.sin(math.pi*contact)
    left_pitch = tween([(0,.035),(.65,.035),(1.63,.32),(3.79,.27),(4.85,.055),(6.7,.095),(7.94,.035)],t)
    left_yaw = tween([(0,.20),(1.6,-.06),(3.9,-.06),(5.0,.25),(7.94,.20)],t)
    left_lean = tween([(0,.025),(.65,.025),(1.71,.36),(3.69,.26),(4.82,.025)],t)
    l, _ = act(left, frame,t,left_pitch,left_yaw,left_lean,
               [(left_wrist,left_rot),(V((-.742,.162,.950)),rotation((.51,-.86,.15),(0,0,1)))])
    if contact > .999:
        contact_error = max(contact_error,(l+left_rot@left[3]['L']-corner).length)

    right_pitch = tween([(0,.025),(1.06,.025),(2.16,.41),(3.78,.43),(4.36,.33),(5.1,-.075),(5.42,.145),(5.83,.012),(6.22,.105),(6.62,.025)],t)
    right_yaw = tween([(0,-.24),(1.07,-.24),(2.35,.19),(4.34,.13),(5.12,-.28),(6.80,-.27),(7.94,-.24)],t)
    right_lean = tween([(0,.035),(1.28,.035),(2.42,.22),(4.26,.19),(5.09,-.035),(5.70,.023),(7.94,.035)],t)
    gesture = tween([(0,0.),(4.77,0.),(5.38,1.),(5.85,.69),(6.16,.85),(6.84,0.)],t)
    right_wrist = V((.359,.209,.949)).lerp(V((.322,.225,1.145)),gesture)
    gesture_rotation = rotation((-.65,-.67,.13),(0,0,1)).slerp(rotation((-.68,-.40,.35),(.25,-.66,.68)),gesture)
    act(right,frame,t,right_pitch,right_yaw,right_lean,
        [(V((.748,.178,.950)),rotation((-.49,-.86,.14),(0,0,1))),(right_wrist,gesture_rotation)])

if contact_error > .006:
    raise RuntimeError(f'The fingertip lost contact by {contact_error * 1000:.1f} mm')
print(f'Maximum fingertip distance while turning the sheet: {contact_error * 1000:.1f} mm', flush=True)

camera = bpy.data.objects.new('Fixed classroom camera', bpy.data.cameras.new('Fixed classroom camera'))
scene.collection.objects.link(camera)
scene.camera = camera
camera.location = (0,-3.03,1.72)
camera.rotation_euler = (V((0,.24,.938))-camera.location).to_track_quat('-Z','Y').to_euler()
camera.data.lens = 47
area('Warm lamplight key', (-.20,-.90,1.88),(0,.36,1.18),75,(1,.67,.40),1.34)
area('Soft warm reflection from table', (.70,-.43,1.37),(.22,.51,1.16),22,(1,.72,.49),1.33)
area('Cool left window edge',(-1.62,1.10,1.96),(-.42,.25,1.16),37,(.32,.51,1),.76)
area('Cool right window edge',(1.60,1.13,1.98),(.43,.24,1.18),32,(.34,.54,1),.74)
area('Low camera-side bounce',(-.91,-1.05,1.44),(-.35,.28,1.14),15,(.81,.74,.67),1.8)
light = bpy.data.lights.new('Kerosene flame bounce','POINT')
light.color, light.shadow_soft_size = (1,.39,.13),.073
obj = bpy.data.objects.new('Kerosene flame bounce',light)
scene.collection.objects.link(obj)
obj.location = (lx,ly-.07,1.09)
for frame in range(1, FRAMES+1, 4):
    light.energy = 11 + 1.3*math.sin(frame*.28)+.9*math.sin(frame*.89)
    light.keyframe_insert('energy',frame=frame)

scene.world = bpy.data.worlds.new('Blue ambient night')
scene.world.use_nodes = True
background = scene.world.node_tree.nodes['Background']
background.inputs['Color'].default_value = (.12,.17,.25,1)
background.inputs['Strength'].default_value = .19
scene.render.engine = 'BLENDER_EEVEE_NEXT'
scene.eevee.taa_render_samples = 24
scene.eevee.use_shadows = True
scene.render.resolution_x,scene.render.resolution_y = (1280,720) if MODE == 'render' else (768,432)
scene.render.resolution_percentage = 100
scene.render.fps = FPS
scene.render.image_settings.file_format = 'PNG'
scene.render.image_settings.color_mode = 'RGB'
scene.frame_start,scene.frame_end = 1,FRAMES
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Medium High Contrast'
scene.view_settings.exposure = -.28

if MODE == 'preview':
    for frame in (1,43,66,88,133,155):
        scene.frame_set(frame)
        scene.render.filepath = str(OUT/f'preview-{frame:03d}.png')
        bpy.ops.render.render(write_still=True)
else:
    scene.frame_set(1)
    scene.render.filepath = str(OUT/'frame-')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'zunyi.blend'))
    bpy.ops.render.render(animation=True)
