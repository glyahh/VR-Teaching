"""Usable terrain and bridge elevations for the rendered Yudu opening shots."""

from math import cos, pi, sin
from pathlib import Path
from random import Random

import bpy
from mathutils import Vector


BRIDGE_X = 4.9
WATER_Z = -0.26
DECK_Z = 0.4895
BEAM_Z = 0.3865
DOOR_THICKNESS = DECK_Z - BEAM_Z
DOOR_WIDTH = 2.74


def clamp(value, low=0.0, high=1.0):
    return min(high, max(low, value))


def mix(a, b, weight):
    return a + (b - a) * weight


def ease(value, start, end):
    p = clamp((value - start) / (end - start))
    return p * p * (3 - 2 * p)


def river_center(x):
    return -(2.7 * sin(x / 13) + .56 * sin(x / 6.5)
             + ease(abs(x), 36, 102) * 7.2 * sin(x / 25 + .77))


def river_width(x):
    return 5.03 + .64 * cos(x / 19) + ease(abs(x), 36, 102) * (1.5 + 1.15 * sin(x / 18))


def ground(x, y):
    z = -y  # Three.js X,Y,Z becomes Blender X,-Z,Y.
    bank = abs(y - river_center(x)) - river_width(x)
    low = 1.38 + 1.95 * (.5 + .5 * cos(x * .098 + z * .145)) + 1.26 * (.51 + .49 * sin(z * .26 - x * .155))
    high = 5.5 + 4.8 * sin(x * .063 - z * .098) ** 2 + 3.6 * cos(x * .079 + z * .061) ** 2
    uneven = (sin(x * .93 + z * 1.21) + .54 * cos(x * 1.45 - z * .81)) * .041
    return (mix(-1.17, .39, ease(bank, -.8, 1.5)) + ease(bank, 3.1, 16.8) * low
            + ease(bank, 15, 71) * high + uneven * ease(bank, .19, 3.55))


def crossing(x):
    return river_center(x), river_width(x) + 1.22


BRIDGE_Y, SPAN = crossing(BRIDGE_X)
HERO_HULL_Y = BRIDGE_Y - .75 * SPAN
DOOR_SLOT_Y = HERO_HULL_Y + SPAN / 24
DOOR_DEPTH = SPAN / 12 - .014
DECK_MIN = BRIDGE_Y - SPAN
DECK_MAX = BRIDGE_Y + SPAN
STAGING_HEIGHT = .021
PHOTO_Y = 72
PHOTO_X = (-151, 30)
PHOTO_Z = (-14, 23)
PHOTO_U = (1007/1600, 1598/1600)
PHOTO_V = (1-315/900, 1-.5/900)


class SceneMaterials:
    def __init__(self, assets):
        self.assets = Path(assets)
        self.wood = [
            self.wood_finish(f"Bridge timber {index + 1}", tint)
            for index, tint in enumerate((
                (.49, .34, .21), (.64, .49, .33), (.53, .39, .26),
                (.37, .27, .19), (.57, .43, .30), (.65, .52, .38),
            ))
        ]
        self.beams = self.wood_finish("Old, damp grain on the bearers", (.245, .165, .106))
        self.hemp = surface("Twisted hemp", (.24, .163, .083), .88)
        fine_bump(self.hemp, 151, .003, .20)
        self.iron = surface("Dark, oxidized iron", (.048, .036, .025), .64, .53)

    def texture(self, node_tree, filename, noncolor=False):
        node = node_tree.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(str(self.assets / filename), check_existing=True)
        if noncolor:
            node.image.colorspace_settings.name = "Non-Color"
        return node

    def wood_finish(self, name, tint):
        mat = surface(name, tint, .79)
        nt, bsdf = mat.node_tree, principled(mat)
        diffuse = self.texture(nt, "river-timber.jpg")
        tinted = nt.nodes.new("ShaderNodeMixRGB")
        tinted.blend_type = 'MULTIPLY'
        tinted.inputs[0].default_value = .74
        tinted.inputs[2].default_value = (*tint, 1)
        nt.links.new(diffuse.outputs['Color'], tinted.inputs[1])
        nt.links.new(tinted.outputs[0], bsdf.inputs['Base Color'])
        roughness = self.texture(nt, "river-timber-rough.jpg", True)
        nt.links.new(roughness.outputs['Color'], bsdf.inputs['Roughness'])
        normal = nt.nodes.new("ShaderNodeNormalMap")
        normal.inputs['Strength'].default_value = .50
        nt.links.new(self.texture(nt, "river-timber-normal.jpg", True).outputs['Color'], normal.inputs['Color'])
        nt.links.new(normal.outputs[0], bsdf.inputs['Normal'])
        return mat


def principled(material):
    return next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def surface(name, rgb, roughness, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*rgb, 1)
    mat.use_nodes = True
    node = principled(mat)
    node.inputs['Base Color'].default_value = (*rgb, 1)
    node.inputs['Roughness'].default_value = roughness
    node.inputs['Metallic'].default_value = metallic
    return mat


def fine_bump(mat, scale, depth, strength):
    nt = mat.node_tree
    coordinates = nt.nodes.new("ShaderNodeTexCoord")
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = 2
    nt.links.new(coordinates.outputs['Object'], noise.inputs['Vector'])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs['Distance'].default_value = depth
    bump.inputs['Strength'].default_value = strength
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs[0], principled(mat).inputs['Normal'])
    return bump


def mesh(name, positions, faces, material=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(positions, [], faces)
    data.update()
    if material is not None:
        data.materials.append(material)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return obj


def load_meshes(path):
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return sorted(set(bpy.context.scene.objects) - before, key=lambda item: item.name)


def assign_uv(obj, mapper):
    data = obj.data
    uv = data.uv_layers.new(name="UVMap")
    data.uv_layers.active = uv
    uv.active_render = True
    uv.data.foreach_set("uv", [
        num for p in data.polygons for i in p.loop_indices
        for num in mapper(data.vertices[data.loops[i].vertex_index].co, p.normal)
    ])


def select_axis(maximum, middle, dense, coarse):
    def section(a, b, step):
        count = round((b - a) / step)
        return [mix(a, b, i / count) for i in range(count)]
    return [*section(-maximum, -middle, coarse), *section(-middle, middle, dense),
            *section(middle, maximum, coarse), maximum]


def landscape(materials, photographic=False, project_on_far_slope=None):
    xs, ys = select_axis(155, 43, .52, 3.2), select_axis(155, 21, .40, 3.0)
    def far_depth(x, y):
        return y - river_center(x) - river_width(x)

    points = [(x, y, mix(ground(x, y), -2.5, ease(far_depth(x, y), 4.5, 11.0))
               if photographic else ground(x, y)) for y in ys for x in xs]
    columns = len(xs)
    faces = [(i, i + 1, i + columns + 1, i + columns)
             for row in range(len(ys) - 1) for col in range(columns - 1)
             for i in [row * columns + col]]
    mat = surface("Damp trampled dirt and grass, Poly Haven", (.24, .24, .13), .9)
    obj = mesh("Banks, tributary profile and crossing paths", points, faces, mat)
    assign_uv(obj, lambda p, _: (p.x / 6.9, p.y / 6.9))
    weights = obj.data.attributes.new("Shore and paths", 'FLOAT', 'POINT')

    def worn(x, y):
        bank = abs(y - river_center(x)) - river_width(x)
        shore = (1 - ease(bank, .13, 1.25 + .21 * sin(x * .76))) * .86
        traffic = 0
        for cx in (BRIDGE_X, -16.7):
            cy, span = crossing(cx)
            depth = abs(y - cy) - span
            bend = sin(max(0, depth) * .27) * (1 if y > cy else -1) * 1.63
            edge = abs(x - cx - bend)
            traffic = max(traffic, (1 - ease(edge, 1.05, 1.85)) * ease(depth, -.6, .02)
                          * (1 - ease(depth, 8, 14.6)))
        return max(shore, .95 * traffic)

    weights.data.foreach_set("value", [worn(x, y) for x, y, _ in points])
    for poly in obj.data.polygons:
        poly.use_smooth = True
    nt, shader = mat.node_tree, principled(mat)
    earth = materials.texture(nt, "river-soil.jpg")
    grass = materials.texture(nt, "river-ground.jpg")
    shore = nt.nodes.new("ShaderNodeAttribute")
    shore.attribute_name = weights.name
    blend = nt.nodes.new("ShaderNodeMixRGB")
    nt.links.new(shore.outputs['Fac'], blend.inputs[0])
    nt.links.new(grass.outputs['Color'], blend.inputs[1])
    nt.links.new(earth.outputs['Color'], blend.inputs[2])
    tint = nt.nodes.new("ShaderNodeMixRGB")
    tint.blend_type = "MULTIPLY"
    tint.inputs[0].default_value = .40
    tint.inputs[2].default_value = (.52, .48, .35, 1)
    nt.links.new(blend.outputs[0], tint.inputs[1])
    if photographic:
        air = obj.data.attributes.new("Far bank airlight", 'FLOAT', 'POINT')
        air.data.foreach_set('value', [.59 * ease(y-river_center(x), 3.9, 12.0) for x,y,_ in points])
        air_attribute = nt.nodes.new('ShaderNodeAttribute')
        air_attribute.attribute_name = air.name
        cool = nt.nodes.new('ShaderNodeMixRGB')
        cool.inputs[2].default_value = (.062,.095,.12,1)
        nt.links.new(air_attribute.outputs['Fac'], cool.inputs[0])
        nt.links.new(tint.outputs[0], cool.inputs[1])
        nt.links.new(cool.outputs[0], shader.inputs['Base Color'])
        shader.inputs['Emission Color'].default_value = (.018,.031,.050,1)
        nt.links.new(air_attribute.outputs['Fac'], shader.inputs['Emission Strength'])
    else:
        nt.links.new(tint.outputs[0], shader.inputs['Base Color'])
    normal = nt.nodes.new("ShaderNodeNormalMap")
    normal.inputs['Strength'].default_value = .62
    nt.links.new(materials.texture(nt, "river-ground-normal.jpg", True).outputs['Color'], normal.inputs['Color'])
    nt.links.new(normal.outputs[0], shader.inputs['Normal'])
    if not photographic:
        add_ridges()
    if project_on_far_slope:
        blend = obj.data.attributes.new('Distant bank overlaid in perspective', 'FLOAT', 'POINT')
        blend.data.foreach_set('value', [ease(far_depth(x,y), 1.85, 4.5) for x,y,_ in points])
        return projected_bank_material(nt, project_on_far_slope, blend.name)


def bank_photo(nt, uv, file, night):
    photo = nt.nodes.new('ShaderNodeTexImage')
    photo.image = bpy.data.images.load(str(file), check_existing=True)
    photo.extension = 'EXTEND'
    nt.links.new(uv, photo.inputs['Vector'])
    grade = nt.nodes.new('ShaderNodeMixRGB')
    grade.blend_type = 'MULTIPLY'
    grade.inputs[0].default_value = 1.0
    grade.inputs[2].default_value = ((.38,.57,.83,1) if night else (.90,.98,1.07,1))
    nt.links.new(photo.outputs['Color'], grade.inputs[1])
    return grade.outputs[0]


def projected_bank_material(nt, file, blend_attribute):
    # Project the slope along the same ray that hits the distant plate. The textures coincide
    # at the end of the fade even while the camera drifts along the bridge.
    position = nt.nodes.new('ShaderNodeNewGeometry').outputs['Position']
    eye = nt.nodes.new('ShaderNodeCombineXYZ')
    ray = nt.nodes.new('ShaderNodeVectorMath')
    ray.operation = 'SUBTRACT'
    nt.links.new(position, ray.inputs[0])
    nt.links.new(eye.outputs[0], ray.inputs[1])
    ray_axis = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(ray.outputs[0], ray_axis.inputs[0])
    camera_distance = nt.nodes.new('ShaderNodeMath')
    camera_distance.operation = 'SUBTRACT'
    camera_distance.inputs[0].default_value = PHOTO_Y
    # The camera Y socket also drives the plane-distance calculation.
    camera_y = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(eye.outputs[0], camera_y.inputs[0])
    nt.links.new(camera_y.outputs['Y'], camera_distance.inputs[1])
    travel = nt.nodes.new('ShaderNodeMath')
    travel.operation = 'DIVIDE'
    nt.links.new(camera_distance.outputs[0], travel.inputs[0])
    nt.links.new(ray_axis.outputs['Y'], travel.inputs[1])
    segment = nt.nodes.new('ShaderNodeVectorMath')
    segment.operation = 'SCALE'
    nt.links.new(ray.outputs[0], segment.inputs[0])
    nt.links.new(travel.outputs[0], segment.inputs['Scale'])
    hit = nt.nodes.new('ShaderNodeVectorMath')
    hit.operation = 'ADD'
    nt.links.new(eye.outputs[0], hit.inputs[0])
    nt.links.new(segment.outputs[0], hit.inputs[1])
    hit_axis = nt.nodes.new('ShaderNodeSeparateXYZ')
    nt.links.new(hit.outputs[0], hit_axis.inputs[0])
    uv = nt.nodes.new('ShaderNodeCombineXYZ')
    for world_axis, texture_axis, source, target in (('X', 'X', PHOTO_X, PHOTO_U), ('Z','Y',PHOTO_Z,PHOTO_V)):
        scale = nt.nodes.new('ShaderNodeMapRange')
        scale.clamp = True
        for socket, value in zip(('From Min','From Max','To Min','To Max'), (*source,*target)):
            scale.inputs[socket].default_value = value
        nt.links.new(hit_axis.outputs[world_axis], scale.inputs['Value'])
        nt.links.new(scale.outputs['Result'], uv.inputs[texture_axis])
    emit = nt.nodes.new('ShaderNodeEmission')
    nt.links.new(bank_photo(nt, uv.outputs[0], file, night=True), emit.inputs['Color'])
    coverage = nt.nodes.new('ShaderNodeAttribute')
    coverage.attribute_name = blend_attribute
    blend = nt.nodes.new('ShaderNodeMixShader')
    out = next(node for node in nt.nodes if node.type == 'OUTPUT_MATERIAL')
    nt.links.new(coverage.outputs['Fac'], blend.inputs[0])
    nt.links.new(out.inputs['Surface'].links[0].from_socket, blend.inputs[1])
    nt.links.new(emit.outputs[0], blend.inputs[2])
    nt.links.new(blend.outputs[0], out.inputs['Surface'])
    return eye.inputs


def add_ridges():
    """Place layered distant silhouettes behind the far bank."""
    ridges = [
        (122, 15.1, 5.7, 1.17, (.052, .073, .052), .29),
        (153, 19.3, 9.7, 2.26, (.085, .110, .098), .42),
        (182, 23.4, 11.3, 3.76, (.126, .154, .150), .56),
    ]
    for index, (y, height, amplitude, phase, rgb, airlight) in enumerate(ridges):
        mat = surface(f"Air-light on the distant ridge {index + 1}", rgb, .98)
        bsdf = principled(mat)
        bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
        bsdf.inputs['Emission Strength'].default_value = airlight
        points = []
        for i in range(401):
            x = -460 + i * 2.3
            crest = height + amplitude * (.57 * sin(x * .071 + phase) + .22 * sin(x * .144 - phase)
                                          + .16 * sin(x * .243 + phase) + .05 * sin(x * .71))
            for layer, (height_factor, inset) in enumerate(((0, -10), (.58, -4), (1, 0), (.74, 7), (0, 15))):
                points.append((x, y + inset + 4.5 * sin(x / 25 + phase),
                               crest * height_factor + (.7 * sin(x * .49 + layer) if layer else 0)))
        faces = [(5 * i + j, 5 * (i + 1) + j, 5 * (i + 1) + j + 1, 5 * i + j + 1)
                 for i in range(400) for j in range(4)]
        obj = mesh(f"Far bank ridge {index + 1}", points, faces, mat)
        for p in obj.data.polygons:
            p.use_smooth = True


def make_water(materials, hulls, night):
    vertices, faces = [], []
    xs = select_axis(150, 30, .22, 2.1)
    # The holes vary in count across the boat tips. Tessellate cross sections inside each hull's
    # x-range separately so the open inside of each boat stays below the outside water line.
    for left, right in zip(xs, xs[1:]):
        mid = (left + right) / 2
        local_hulls = [point for point in hulls if abs(mid - point[0]) < 2.91]
        profiles = []
        for x in (left, right):
            banks = (river_center(x) - river_width(x) - 1.25, river_center(x) + river_width(x) + 1.25)
            openings = []
            for hx, hy in local_hulls:
                t = clamp((x - hx) / 5.82 + .5)
                sheer = (.166 if t > .5 else .115) * abs(2 * t - 1) ** 4
                height = WATER_Z - sheer
                portion = (.22 + .33 * clamp((height + .375) / .066) + .22 * clamp((height + .309) / .109)
                           if height > -.375 else .22 * clamp((height + .394) / .019))
                width = portion * .81 * sin(pi * t) ** (.68 if t < .55 else .83)
                openings.append((hy - width, hy + width))
            edges = [banks[0], *(value for pair in sorted(openings) for value in pair), banks[1]]
            profiles.append(edges)
        for i in range(0, len(profiles[0]), 2):
            a, b = profiles[0][i:i + 2]
            c, d = profiles[1][i:i + 2]
            j = len(vertices)
            vertices.extend(((left, a, WATER_Z), (right, c, WATER_Z), (right, d, WATER_Z), (left, b, WATER_Z)))
            faces.append((j, j + 1, j + 2, j + 3))

    mat = surface("Current, reflected skylight and crossed ripples",
                  (.012,.034,.064) if night else (.018,.100,.104), .28)
    obj = mesh("Yudu river, with clearance inside the timber hulls", vertices, faces, mat)
    assign_uv(obj, lambda p, _: (p.x, p.y))
    nt, bsdf = mat.node_tree, principled(mat)
    coordinates = nt.nodes.new("ShaderNodeTexCoord")
    normal = nt.nodes.new("ShaderNodeNormalMap")
    normal.inputs['Strength'].default_value = .34 if night else .41
    wave_maps = []
    offsets = []
    for scale, phase in (((.18, .53, 1), (0, 0, 0)), ((-.48, .24, 1), (.27, -.22, 0))):
        transform = nt.nodes.new("ShaderNodeMapping")
        transform.inputs['Scale'].default_value = scale
        transform.inputs['Location'].default_value = phase
        nt.links.new(coordinates.outputs['UV'], transform.inputs['Vector'])
        ripple = materials.texture(nt, "water-normal.png", True)
        nt.links.new(transform.outputs[0], ripple.inputs[0])
        wave_maps.append(ripple)
        offsets.append(transform.inputs['Location'])
    blend = nt.nodes.new("ShaderNodeMixRGB")
    blend.inputs[0].default_value = .36
    nt.links.new(wave_maps[0].outputs['Color'], blend.inputs[1])
    nt.links.new(wave_maps[1].outputs['Color'], blend.inputs[2])
    nt.links.new(blend.outputs[0], normal.inputs['Color'])
    nt.links.new(normal.outputs[0], bsdf.inputs['Normal'])
    bsdf.inputs['IOR'].default_value = 1.334
    bsdf.inputs['Coat Weight'].default_value = .28 if night else .16
    bsdf.inputs['Coat Roughness'].default_value = .22
    bsdf.inputs['Specular IOR Level'].default_value = .44

    facing = nt.nodes.new("ShaderNodeLayerWeight")
    reflect = nt.nodes.new("ShaderNodeValToRGB")
    for element, (position, value) in zip(reflect.color_ramp.elements, (
        (.05, (.025, .048, .092) if night else (.043, .111, .108)),
        (.88, (.095, .173, .285) if night else (.28, .32, .30)),
    )):
        element.position = position
        element.color = (*value, 1)
    nt.links.new(facing.outputs['Facing'], reflect.inputs[0])
    bsdf.inputs['Emission Strength'].default_value = .31 if night else .21
    camera_position = nt.nodes.new("ShaderNodeCombineXYZ")
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    to_eye = nt.nodes.new("ShaderNodeVectorMath")
    to_eye.operation = 'SUBTRACT'
    nt.links.new(camera_position.outputs[0], to_eye.inputs[0])
    nt.links.new(geo.outputs['Position'], to_eye.inputs[1])
    eye_dir = nt.nodes.new("ShaderNodeVectorMath")
    eye_dir.operation = 'NORMALIZE'
    nt.links.new(to_eye.outputs[0], eye_dir.inputs[0])
    sum_dirs = nt.nodes.new("ShaderNodeVectorMath")
    sum_dirs.operation = 'ADD'
    sun_dir = (-.39,.91,.196) if night else (-.31,.932,.184)
    sum_dirs.inputs[1].default_value = Vector(sun_dir).normalized()
    nt.links.new(eye_dir.outputs[0], sum_dirs.inputs[0])
    halfway = nt.nodes.new("ShaderNodeVectorMath")
    halfway.operation = 'NORMALIZE'
    nt.links.new(sum_dirs.outputs[0], halfway.inputs[0])
    reflection = nt.nodes.new("ShaderNodeVectorMath")
    reflection.operation = 'DOT_PRODUCT'
    nt.links.new(halfway.outputs[0], reflection.inputs[0])
    nt.links.new(normal.outputs[0], reflection.inputs[1])
    glint = nt.nodes.new("ShaderNodeMath")
    glint.operation = 'POWER'
    glint.inputs[1].default_value = 137 if night else 86
    nt.links.new(reflection.outputs['Value'], glint.inputs[0])
    shimmer = nt.nodes.new("ShaderNodeMixRGB")
    shimmer.blend_type = 'ADD'
    shimmer.inputs[2].default_value = ((1.08, 1.77, 3.75, 1) if night else (1.07,.81,.48,1))
    nt.links.new(glint.outputs[0], shimmer.inputs[0])
    nt.links.new(reflect.outputs[0], shimmer.inputs[1])
    nt.links.new(shimmer.outputs[0], bsdf.inputs['Emission Color'])
    return offsets, camera_position.inputs


def timber(name, location, size, mat, grain=.0, slanted=False):
    rng = Random(name)
    x, y, z = (n / 2 for n in size)
    corners = [(-x, -y), (x, -y), (x, y), (-x, y)]
    if slanted:
        corners = [(a + rng.uniform(-.012, .012), b + rng.uniform(-.007, .007)) for a, b in corners]
    points = [(a, b, c) for c in (-z, z) for a, b in corners]
    ob = mesh(name, points, [(3, 2, 1, 0), (4, 5, 6, 7), (0, 1, 5, 4),
                             (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], mat)
    ob.location = location
    along_x = x > y
    def texture_coords(p, normal):
        grain_main, across = (p.x, p.y) if along_x else (p.y, p.x)
        band = grain + .186 * across + .3 * p.z
        if abs(normal.z) < .5:
            band = grain + p.z * .28
        return band, .48 * grain_main + .37 * grain
    assign_uv(ob, texture_coords)
    bevel = ob.modifiers.new("Worn, rounded edge", "BEVEL")
    bevel.width = .009
    bevel.segments = 2
    return ob


def cord(name, points, radius, material):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 2
    data.bevel_depth = radius
    data.bevel_resolution = 1
    spline = data.splines.new('POLY')
    spline.points.add(len(points) - 1)
    spline.points.foreach_set("co", [v for point in points for v in (*point, 1.0)])
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(material)
    return obj


def empty(name, location):
    ob = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(ob)
    ob.location = location
    return ob


def deck_surface(y, x):
    if abs(x - BRIDGE_X) > 1.29:
        return ground(x, y)
    if DECK_MIN <= y <= DECK_MAX:
        return DECK_Z
    edge = DECK_MIN if y < DECK_MIN else DECK_MAX
    if abs(y-edge) <= .70:
        return mix(DECK_Z, ground(x, edge + (-.70 if y < DECK_MIN else .70)) + .015, abs(y-edge) / .70)
    return ground(x, y)


def build_bridges(materials, assembling=False):
    assets = materials.assets
    boat = [ob for ob in load_meshes(assets / "river-boat.glb") if ob.type == 'MESH']
    finish_boat_trim(next(ob for ob in boat if ob.name.startswith("厚船舷")), materials)
    centers = []
    door = None
    rng = Random(2044)
    for crossing_number, cx in enumerate((BRIDGE_X, -16.7)):
        cy, span = crossing(cx)
        bay = span / 2
        for row in range(4):
            hull_y = cy + (row - 1.5) * bay
            centers.append((cx, hull_y))
            for template in boat:
                instance = template.copy()
                bpy.context.collection.objects.link(instance)
                instance.location = (cx, hull_y, 0)
            for offset in (-.86, .86):
                timber("Long bearer", (cx + offset, hull_y, BEAM_Z - .112),
                       (.178, bay + .022, .224), materials.beams, rng.random())
                for edge in (-.65, .65):
                    # Spacer and three turns around bearer and gunwale.
                    timber("Gunwale spacer", (cx + offset, hull_y + edge, .176), (.25, .19, .029),
                           materials.beams, .27)
                    knots = []
                    for i in range(33):
                        a = i / 32 * pi * 5.8
                        xx, zz = sin(a), cos(a)
                        knots.append((cx + offset + .101 * (abs(xx) ** .47) * (1 if xx >= 0 else -1),
                                      hull_y + edge + .141 * (i / 32 - .5),
                                      .273 + .125 * (abs(zz) ** .48) * (1 if zz >= 0 else -1)))
                    cord("Gunwale lashing", knots, .012, materials.hemp)
                if crossing_number == 0 and row == 0:
                    # Stern and bow working surfaces rest on two visible battens.
                    sx = cx + (1.74 if offset > 0 else -1.74)
                    for y in (hull_y - .245, hull_y + .245):
                        timber("Boat floor spreader", (sx, y, -.065), (.74, .09, .13),
                               materials.beams, rng.random())
                    for i in range(3):
                        timber("Working footing on floor spreaders", (sx, hull_y + .21 * (i - 1), STAGING_HEIGHT - .021),
                               (.75, .205, .042), materials.wood[3], rng.random())

            for i in range(6):
                y = hull_y + (i - 2.5) * bay / 6
                if assembling and crossing_number == 0 and row == 0 and i < 3:
                    continue
                if crossing_number == 0 and row == 0 and i == 3:
                    door = make_door(materials)
                    door.location = (cx, DOOR_SLOT_Y, (DECK_Z + BEAM_Z) / 2)
                    continue
                # The door takes the same slot as its neighbouring boards.
                width = 2.62 + rng.uniform(-.07, .07)
                plank = timber("Crossing plank", (cx + rng.uniform(-.025, .025), y, (DECK_Z + BEAM_Z) / 2),
                               (width, bay / 6 - .017, DOOR_THICKNESS), rng.choice(materials.wood),
                               rng.random(), slanted=True)
                plank.rotation_euler.z = rng.uniform(-.011, .011)
        # Bridging boards are laid on the slopes with small pitch, so feet can enter and leave the deck.
        for direction in ((1,) if assembling and crossing_number == 0 else (-1, 1)):
            end = cy + direction * span
            for i in range(2):
                delta = .175 + i * .35
                y = end + direction * delta
                low = deck_surface(y - .13, cx) if cx == BRIDGE_X else mix(DECK_Z, ground(cx, y) + .025, i / 2)
                high = deck_surface(y + .13, cx) if cx == BRIDGE_X else low
                step = timber("Shore landing boards", (cx, y, (low+high)/2 - .051),
                              (2.58, .351, .102), materials.wood[2], rng.random(), slanted=True)
                step.rotation_euler.x = (high-low) / .26

        for offset, side in ((-1.82, -1), (1.82, 1)):
            y = cy - span - .48
            x = cx + offset
            z = ground(x, y)
            peg = timber("Mooring stake", (x, y, z + .10), (.12, .113, .46), materials.beams, rng.random())
            peg.rotation_euler.y = side * .14
            cord("Bank mooring", [(x, y, z + .24), (x + side * .24, y + .5, z + .12),
                                  (x + side * .61, y + .9, .05), (x + side * .92, y + 1.2, .12)], .018, materials.hemp)

    for obj in boat:
        bpy.data.objects.remove(obj, do_unlink=True)
    return door, centers


def finish_boat_trim(woodwork, materials):
    data = woodwork.data
    data.materials.clear()
    data.materials.append(materials.wood_finish("Old inland fishing-boat gunwale and ribs", (.285,.189,.119)))
    data.materials.append(materials.wood_finish("Seat planks worn light by feet and hands", (.408,.311,.227)))
    uv = data.uv_layers.new(name='Grain along each timber')
    data.uv_layers.active = uv
    uv.active_render = True
    values = []
    for face in data.polygons:
        x, y, z = face.center
        rail = abs(y) > .47 and z > .123 or abs(x) > 2.52 and z > .16
        seat = (.027 < z < .103 and min(abs(x+1.46), abs(x+.06)) < .151 and abs(y) < .78)
        face.material_index = int(seat)
        for index in face.vertices:
            p = data.vertices[index].co
            if rail:
                values.extend((.216 + .28*p.z + .15*abs(p.y), .41*p.x + .47))
            else:
                values.extend((.490 + .18*p.x + .18*p.z, .49*p.y + .41))
    uv.data.foreach_set('uv', values)


def make_door(materials):
    board = empty("Reused household door, hinge end to east", (0, 0, 0))
    rng = Random(1942)
    for i in range(3):
        part = timber("Unequal door leaf stave", (0, (i - 1) * DOOR_DEPTH / 3, 0),
                      (DOOR_WIDTH, DOOR_DEPTH / 3 - .002, DOOR_THICKNESS),
                      materials.wood[(2, 5, 1)[i]], rng.random(), slanted=True)
        part.parent = board
    for x in (-.64, .67):
        brace = timber("Old door batten under the leaf", (x, 0, -DOOR_THICKNESS / 2 - .018),
                       (.087, DOOR_DEPTH-.036, .036), materials.beams, .28)
        brace.parent = board
    for x, y in ((-1.04, -.166), (-1.04, .179)):
        bracket = timber("Removed hinge outline and retained bent strap", (x, y, DOOR_THICKNESS/2+.006),
                         (.235, .043, .013), materials.iron, .11)
        bracket.rotation_euler.z = .037
        bracket.parent = board
        for dx in (-.076, .071):
            head = timber("Recessed hinge fixing", (x + dx, y, DOOR_THICKNESS/2+.013),
                          (.018, .02, .012), materials.iron)
            head.parent = board
    return board


def linked(template, name, location, size, yaw):
    obj = bpy.data.objects.new(name, template.data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    obj.rotation_euler.z = yaw
    obj.scale = (size,) * 3
    return obj


def plant_banks(materials, photographic=False):
    rng = Random(19341017)
    assets = materials.assets
    tree = [o for o in load_meshes(assets / "river-tree-far.glb") if o.type == 'MESH']
    grass = [o for o in load_meshes(assets / "river-grass.glb") if o.type == 'MESH']
    rock = [o for o in load_meshes(assets / "river-rock.glb") if o.type == 'MESH']
    big = [(-4, -10, 1.65), (11.6, -10.5, 1.22), (-3.7, -7.7, .73),
           (13.9, -7.3, .82), (-4.7, 9.6, 1.73), (8.6, 11.3, 1.4),
           (-8.6, 8.7, 1.22), (14.1, 13.8, 1.31), (20.6, 13.6, .98)]
    if photographic:
        big = [item for item in big if item[1] < 0 or item[1] - river_center(item[0]) - river_width(item[0]) <= 3.4]
        big.append((-2.50, river_center(-2.50) + river_width(-2.50) + 1.95, 1.54))
    for _ in range(23 if photographic else 48):
        x = rng.uniform(-63, 78)
        y = river_center(x) + rng.choice([-1, 1]) * (river_width(x) + rng.uniform(2.8, 31))
        if photographic and y > 0 and y - river_center(x) - river_width(x) > 2.6:
            continue
        if min(abs(x - BRIDGE_X), abs(x + 16.7)) > 2.6 or abs(y) > 15:
            big.append((x, y, rng.uniform(.70, 1.62)))
    branches = []
    for i, (x, y, size) in enumerate(big):
        angle = rng.uniform(-pi, pi)
        for part in tree:
            ob = linked(part, "Native bank tree", (x, y, ground(x, y) - .025), size, angle)
            if i < 9:
                branches.append((ob, angle, rng.uniform(0, pi * 2)))

    for index in range(240 if photographic else 296):
        x = rng.uniform(-30, 34)
        y = river_center(x) + rng.choice([-1, 1]) * (river_width(x) + rng.uniform(-.29, 9.5))
        if photographic and y > 0 and y - river_center(x) - river_width(x) > 4.4:
            continue
        offset = min(abs(x - BRIDGE_X - .27 * (abs(y) - SPAN)), abs(x + 16.7))
        if offset < 1.67 and abs(y) > 5.7:
            continue
        if index < 83:
            linked(rng.choice(rock), "Partly buried mossy stone", (x, y, ground(x,y) - .05),
                   rng.uniform(.10, .43), rng.uniform(-pi, pi))
        linked(rng.choice(grass), "Marsh grass at the footpath", (x, y, ground(x, y) - .02),
               rng.uniform(1.10, 2.60), rng.uniform(-pi, pi))

    for template in (*tree, *grass, *rock):
        bpy.data.objects.remove(template, do_unlink=True)
    return branches


def light(name, kind, loc, color, energy, size, target=None, shadow=True):
    data = bpy.data.lights.new(name, kind)
    data.color = color
    data.energy = energy
    data.use_shadow = shadow
    if kind == 'AREA':
        data.shape = 'DISK'
        data.size = size
    elif kind == 'SUN':
        data.angle = size
    else:
        data.shadow_soft_size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = loc
    if target is not None:
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()
    return obj


def skies(scene, night, far_bank=None):
    world = bpy.data.worlds.new("October twilight")
    scene.world = world
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs['Color'].default_value = ((.23, .30, .45, 1) if night else (.54, .54, .63, 1))
    background.inputs['Strength'].default_value = .20 if night else .41

    if night:
        light("Moon above the far bank", 'SUN', (-39, 91, 23), (.57, .70, 1), 1.43, .065, (0, 0, 0))
        light("Cool open sky", 'AREA', (6, -7, 7.6), (.52, .64, .90), 420, 9, (5, -2, .5), shadow=False)
        light("Blue sky reflected upriver", 'AREA', (13, 4, 9), (.50, .63, .94), 560, 15, (5, 1, .1), shadow=False)
    else:
        sun = light("Late sun across the water", 'SUN', (-37, 47, 25), (1, .74, .51), 2.1, .084, (0, 0, 0))
        sun.data.specular_factor = .32
        light("Open blue sky from near shore", 'AREA', (5, -9, 8.5), (.62, .73, 1), 925, 11, (4.5, -5, 1), shadow=False)
        light("Light from the near bank lamp", 'AREA', (1.95,-9.15,2.14), (1,.63,.34), 222, 1.8, (5,-6,.6), shadow=False)

    # A camera-only sky section beyond the terrain avoids enclosing the stage in an emissive mesh.
    mat = bpy.data.materials.new("Clouds and moon in the reconstructed sky")
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emit = nt.nodes.new("ShaderNodeEmission")
    nt.links.new(emit.outputs[0], out.inputs['Surface'])
    tex = nt.nodes.new("ShaderNodeTexCoord")
    gradient = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(tex.outputs['UV'], gradient.inputs[0])
    skies_rgb = nt.nodes.new("ShaderNodeValToRGB")
    sky = skies_rgb.color_ramp
    sky.elements[0].position = .01
    sky.elements[0].color = ((.061, .102, .170, 1) if night else (.84, .44, .29, 1))
    sky.elements[1].position = .57
    sky.elements[1].color = ((.009, .023, .060, 1) if night else (.15, .23, .35, 1))
    nt.links.new(gradient.outputs['Y'], skies_rgb.inputs[0])
    clouds = nt.nodes.new("ShaderNodeTexNoise")
    clouds.inputs['Scale'].default_value = 13
    clouds.inputs['Detail'].default_value = 4
    cloud_map = nt.nodes.new("ShaderNodeMapping")
    cloud_map.inputs['Scale'].default_value = (1.0, 2.9, 1)
    nt.links.new(tex.outputs['UV'], cloud_map.inputs[0])
    nt.links.new(cloud_map.outputs[0], clouds.inputs[0])
    threshold = nt.nodes.new("ShaderNodeValToRGB")
    threshold.color_ramp.elements[0].position = .47
    threshold.color_ramp.elements[1].position = .69
    threshold.color_ramp.elements[1].color = (.74,.74,.74,1)
    nt.links.new(clouds.outputs['Fac'], threshold.inputs[0])
    cover = nt.nodes.new("ShaderNodeMixRGB")
    cover.inputs[2].default_value = ((.024, .043, .073, 1) if night else (.47,.35,.32,1))
    nt.links.new(threshold.outputs[0], cover.inputs[0])
    nt.links.new(skies_rgb.outputs[0], cover.inputs[1])
    nt.links.new(cover.outputs[0], emit.inputs[0])
    if far_bank is not None:
        # Restrict the existing reconstruction to its empty upper-right hills and sky.
        nt.links.new(bank_photo(nt, tex.outputs['UV'], far_bank, night), emit.inputs[0])
        panel_x = (-234, *PHOTO_X, 76)
        panel_z = (-130, *PHOTO_Z, 128) if night else PHOTO_Z
        backdrop = mesh("Distant terrain, taken from the course's Yudu reference",
                        [(x,PHOTO_Y,z) for z in panel_z for x in panel_x],
                        [(i,i+1,i+5,i+4) for row in range(len(panel_z)-1) for col in range(3)
                         for i in [4*row+col]], mat)
        assign_uv(backdrop, lambda p, _: (mix(*PHOTO_U, clamp((p.x-PHOTO_X[0])/(PHOTO_X[1]-PHOTO_X[0]))),
                                         mix(*PHOTO_V, clamp((p.z-PHOTO_Z[0])/(PHOTO_Z[1]-PHOTO_Z[0])))))
    else:
        backdrop = mesh("Cloud deck behind ridge silhouettes",
                        [(-880,249,-8),(840,249,-8),(840,249,191),(-880,249,191)],[(0,1,2,3)],mat)
        assign_uv(backdrop, lambda p, _: ((p.x+315)/535, (p.z+8)/199))
    if night:
        moon_material = surface("Moon surface", (.62,.72,.91), .91)
        moon_shader = principled(moon_material)
        moon_shader.inputs['Emission Color'].default_value = (.55,.72,1,1)
        moon_shader.inputs['Emission Strength'].default_value = 4.2
        moon_noise = moon_material.node_tree.nodes.new("ShaderNodeTexNoise")
        moon_noise.inputs['Scale'].default_value = 7
        moon_noise.inputs['Detail'].default_value = 4
        moon_tint = moon_material.node_tree.nodes.new("ShaderNodeValToRGB")
        moon_tint.color_ramp.elements[0].color = (.23,.35,.56,1)
        moon_tint.color_ramp.elements[1].color = (.63,.76,1,1)
        moon_material.node_tree.links.new(moon_noise.outputs['Fac'], moon_tint.inputs[0])
        moon_material.node_tree.links.new(moon_tint.outputs[0], moon_shader.inputs['Emission Color'])
        center = Vector((-24.6, 71, 17.2) if far_bank is not None else (-91, 229, 47.7))
        radius = .50 if far_bank is not None else 1.47
        points = [tuple(center + Vector((radius * cos(a), 0, radius * sin(a))))
                  for a in (i / 64 * 2 * pi for i in range(64))]
        mesh("Waxing moon, interpreted for the film", points, [tuple(range(64))], moon_material)
    return cloud_map.inputs['Location']

