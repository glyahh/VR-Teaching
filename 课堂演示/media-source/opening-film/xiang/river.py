"""River, riverbank, weather, and the ripples made by the waders."""

import math
import random

import bpy
from mathutils import Euler, Matrix, Vector, noise
from array import array

WATER_HEIGHT = 0.05
MIST = (0.26, 0.305, 0.326, 1)


def lerp(a, b, t):
    return a + (b - a) * t


def smoothstep(value, start, end):
    t = min(1, max(0, (value - start) / (end - start)))
    return t * t * (3 - 2 * t)


def river_center(y):
    return 4.5 * math.sin(-y * 0.055) + 1.8 * math.cos(-y * 0.12)


def river_half_width(y):
    return 13.5 + 2.6 * math.sin(-y * 0.045 + 0.6)


def ground_height(x, y, matched=False):
    center = river_center(y)
    distance = abs(x - center) - river_half_width(y)
    bed_depth = lerp(-1.85, -0.85, math.exp(-(y / 11) ** 2))
    shore = smoothstep(distance, -1.2, 3.2)
    terrace = smoothstep(distance, 3.8, 19)
    slope = smoothstep(distance, 16, 58)
    west = 1.28 if x < center else 0.94
    rolling = (1.5 + 2.1 * math.sin(x * 0.07 - y * 0.09) ** 2
               + 1.4 * math.cos(x * 0.11 + y * 0.06) ** 2) * west
    karst = (9.5 + 11.5 * (0.5 + 0.5 * math.sin(x * 0.055 + 0.8)
                          * math.cos(-y * 0.062 - 0.5)) ** 1.8) * west
    small = (math.sin(x * 0.72 - y * 0.88) + 0.5 * math.cos(x * 1.3 + y * 0.9)) * 0.08
    if not matched:
        ford = math.exp(-(y / 6.2) ** 2)
        bed_depth = lerp(bed_depth, -0.35 + 0.059 * math.sin(x * 0.76 + y * 0.81), ford * 0.91)
        shore = smoothstep(distance + 0.47 * noise.noise(Vector((x * 0.21, y * 0.21, 2))), -1.2, 3.2)
        small += 0.4 * noise.fractal(Vector((x * 0.17, y * 0.17, 7)), 0.85, 2.0, 3)
    return lerp(bed_depth, 0.65, shore) + terrace * rolling + slope * karst + small * smoothstep(distance, 0.2, 4.5)


def mesh_object(name, vertices, faces, material=None):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for face in mesh.polygons:
        face.use_smooth = True
    if material:
        mesh.materials.append(material)
    return obj


def assign(tree, source, dest):
    if isinstance(source, bpy.types.NodeSocket):
        tree.links.new(source, dest)
    else:
        dest.default_value = source


def node(tree, name, **properties):
    obj = tree.nodes.new(name)
    for key, value in properties.items():
        setattr(obj, key, value)
    return obj


def math_node(tree, operation, a, b=0.0):
    calc = node(tree, "ShaderNodeMath", operation=operation)
    assign(tree, a, calc.inputs[0])
    assign(tree, b, calc.inputs[1])
    return calc.outputs[0]


def vector_math(tree, operation, a, b):
    calc = node(tree, "ShaderNodeVectorMath", operation=operation)
    assign(tree, a, calc.inputs[0])
    assign(tree, b, calc.inputs[1])
    return calc.outputs["Vector"]


def mix(tree, amount, a, b, blend="MIX"):
    calculation = node(tree, "ShaderNodeMixRGB", blend_type=blend)
    for value, input_socket in zip((amount, a, b), calculation.inputs):
        assign(tree, value, input_socket)
    return calculation.outputs[0]


def ramp(tree, value, low, high):
    calculation = node(tree, "ShaderNodeMapRange", interpolation_type="SMOOTHSTEP")
    assign(tree, value, calculation.inputs["Value"])
    calculation.inputs["From Min"].default_value = low
    calculation.inputs["From Max"].default_value = high
    return calculation.outputs[0]


def noise_value(tree, coordinates, scale, detail, roughness=0.58):
    clouds = node(tree, "ShaderNodeTexNoise")
    assign(tree, coordinates, clouds.inputs["Vector"])
    clouds.inputs["Scale"].default_value = scale
    clouds.inputs["Detail"].default_value = detail
    clouds.inputs["Roughness"].default_value = roughness
    return clouds.outputs["Fac"]


def image_texture(tree, file, coordinates, linear_data=False):
    texture = node(tree, "ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(file), check_existing=True)
    if linear_data:
        texture.image.colorspace_settings.name = "Non-Color"
    assign(tree, coordinates, texture.inputs["Vector"])
    return texture.outputs["Color"]


def mist_factor(tree, start=17, end=69):
    distance = node(tree, "ShaderNodeCameraData").outputs["View Distance"]
    return ramp(tree, distance, start, end)


def principled(material):
    return next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def base_material(name):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    return material, material.node_tree, principled(material)


def mist_material(tree, shader, start, end, amount=0.8):
    # Camera distance blends distant shapes into the same overcast air color.
    out = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    air = node(tree, "ShaderNodeEmission")
    air.inputs["Color"].default_value = MIST
    air.inputs["Strength"].default_value = 0.70
    bl = node(tree, "ShaderNodeMixShader")
    assign(tree, math_node(tree, "MULTIPLY", mist_factor(tree, start, end), amount), bl.inputs[0])
    assign(tree, shader, bl.inputs[1])
    assign(tree, air.outputs[0], bl.inputs[2])
    tree.links.new(bl.outputs[0], out.inputs["Surface"])


def wet_cloth(material, tint, damp):
    tree = material.node_tree
    shader = principled(material)
    coord = node(tree, "ShaderNodeTexCoord").outputs["Generated"]
    patches = noise_value(tree, coord, 8.5, 2.6)
    faded = mix(tree, patches, (*(v * 0.71 for v in tint), 1), (*(v * 1.19 for v in tint), 1))
    roughness = 0.91
    if damp:
        surface = node(tree, "ShaderNodeNewGeometry").outputs["Position"]
        height = node(tree, "ShaderNodeSeparateXYZ")
        assign(tree, surface, height.inputs[0])
        dry = ramp(tree, height.outputs["Z"], WATER_HEIGHT + 0.06, WATER_HEIGHT + 0.52)
        faded = mix(tree, dry, (*(v * 0.49 for v in tint), 1), faded)
        roughness = math_node(tree, "ADD", 0.52, math_node(tree, "MULTIPLY", dry, 0.35))
    assign(tree, faded, shader.inputs["Base Color"])
    assign(tree, roughness, shader.inputs["Roughness"])
    shader.inputs["Sheen Weight"].default_value = 0.15
    shader.inputs["Coat Weight"].default_value = 0.035
    bump = node(tree, "ShaderNodeBump")
    existing = shader.inputs["Normal"].links
    if existing:
        assign(tree, existing[0].from_socket, bump.inputs["Normal"])
    assign(tree, noise_value(tree, coord, 82, 2.2), bump.inputs["Height"])
    bump.inputs["Strength"].default_value = 0.19
    bump.inputs["Distance"].default_value = 0.011
    assign(tree, bump.outputs[0], shader.inputs["Normal"])


def add_bank(assets, matched):
    material, tree, shader = base_material("湿岸：细泥、草根和石砾")
    position = node(tree, "ShaderNodeNewGeometry").outputs["Position"]
    coordinates = vector_math(tree, "MULTIPLY", position, (0.37, 0.37, 0.37))
    soil = image_texture(tree, assets / "river-soil.jpg", coordinates)
    green = image_texture(tree, assets / "river-ground.jpg", coordinates)
    height = node(tree, "ShaderNodeSeparateXYZ")
    assign(tree, position, height.inputs[0])
    dry = ramp(tree, height.outputs["Z"], WATER_HEIGHT + 0.14, WATER_HEIGHT + 1.10)
    mixture = mix(tree, dry, soil, green)
    low = noise_value(tree, position, 0.29, 3.0)
    tinted = mix(tree, low, (0.21, 0.23, 0.21, 1), (0.63, 0.61, 0.52, 1))
    assign(tree, mix(tree, 0.82, mixture, tinted, "MULTIPLY"), shader.inputs["Base Color"])
    assign(tree, math_node(tree, "ADD", 0.39, math_node(tree, "MULTIPLY", dry, 0.47)), shader.inputs["Roughness"])
    normal = node(tree, "ShaderNodeNormalMap")
    normal.space = "OBJECT"
    normal.inputs["Strength"].default_value = 0.25
    assign(tree, image_texture(tree, assets / "river-ground-normal.jpg", coordinates, True), normal.inputs["Color"])
    bump = node(tree, "ShaderNodeBump")
    bump.inputs["Distance"].default_value = 0.065
    bump.inputs["Strength"].default_value = 0.52
    assign(tree, normal.outputs[0], bump.inputs["Normal"])
    assign(tree, noise_value(tree, position, 5.7, 2.2), bump.inputs["Height"])
    assign(tree, bump.outputs[0], shader.inputs["Normal"])
    mist_material(tree, shader.outputs[0], 18, 102, 0.87)
    vertices, faces = [], []
    columns, rows = 210, 202
    for j in range(rows + 1):
        y = lerp(-91, 114, j / rows)
        for i in range(columns + 1):
            x = lerp(-106, 106, i / columns)
            vertices.append((x, y, ground_height(x, y, matched)))
            if j < rows and i < columns:
                k = j * (columns + 1) + i
                faces.append((k, k + 1, k + columns + 2, k + columns + 1))
    return mesh_object("湘江河床和两岸", vertices, faces, material)


def place_ridges(plate, matched):
    # The source is the same valley visible two shots earlier. The foreground bank hides
    # the lower edge of this distant plane, leaving depth changes from the animated camera.
    if matched:
        direction = Vector((9.48614, 20.49419, 0)).normalized()
        center = Vector((-7.58498, -16.32353, 0)) + direction * 96 + Vector((0, 0, 13))
        half_width = 83
    else:
        direction = Vector((0.61, 0.795, 0)).normalized()
        center = direction * 87 + Vector((0, 0, 8.2))
        half_width = 68
    right = Vector((direction.y, -direction.x, 0))
    horizontal = right * half_width
    vertical = Vector((0, 0, 17))
    vertices = [center - horizontal - vertical, center + horizontal - vertical,
                center + horizontal + vertical, center - horizontal + vertical]
    material, tree, shader = base_material("沿用雾锁湘江画面的远山和雨气")
    coordinates = node(tree, "ShaderNodeTexCoord").outputs["UV"]
    original = image_texture(tree, plate, coordinates)
    grade = mix(tree, 0.35, original, (0.58, 0.67, 0.72, 1.0), "MULTIPLY")
    washed = mix(tree, 0.27, grade, MIST)
    emit = node(tree, "ShaderNodeEmission")
    assign(tree, washed, emit.inputs["Color"])
    emit.inputs["Strength"].default_value = 0.74
    out = next(n for n in tree.nodes if n.type == "OUTPUT_MATERIAL")
    assign(tree, emit.outputs[0], out.inputs["Surface"])
    obj = mesh_object("湘江雾岭 · 远景投影", vertices, [(0, 1, 2, 3)], material)
    uv = obj.data.uv_layers.new()
    for index, coordinate in enumerate(((0.615, 0.548), (1.0, 0.548), (1.0, 0.910), (0.615, 0.910))):
        uv.data[index].uv = coordinate


def import_parts(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    bpy.context.view_layer.update()
    parts = [o for o in sorted(set(bpy.data.objects) - before, key=lambda ob: ob.name) if o.type == "MESH"]
    matrices = [o.matrix_world.copy() for o in parts]
    return parts, matrices


def place_bank_details(assets, matched):
    rng = random.Random(19341128)
    seed = 19341127

    def old_random():
        nonlocal seed
        seed = (seed * 1664525 + 1013904223) & 0xffffffff
        return seed / 4294967296

    def model_parts(name, fog):
        imported, matrices = import_parts(assets / f"river-{name}.glb")
        for material in {m for ob in imported for m in ob.data.materials if m}:
            shader = principled(material)
            if name == "rock":
                shader.inputs["Roughness"].default_value = 0.48
                shader.inputs["Coat Weight"].default_value = 0.20
                socket = shader.inputs["Base Color"]
                if socket.links:
                    source = socket.links[0].from_socket
                    assign(material.node_tree, mix(material.node_tree, .67, source, (.49, .57, .61, 1), "MULTIPLY"), socket)
            if material.name.endswith("leaves") or name == "grass":
                socket = shader.inputs["Base Color"]
                if socket.links:
                    assign(material.node_tree, socket.links[0].from_socket, shader.inputs["Emission Color"])
                shader.inputs["Emission Strength"].default_value = 0.10
            mist_material(material.node_tree, shader.outputs[0], 19, fog, 0.88)
        return imported, matrices

    def stamp(part, matrix, x, y, z, scale, heading, flatten=1.0):
        clone = part.copy()
        bpy.context.scene.collection.objects.link(clone)
        clone.parent = None
        adjustment = Matrix.LocRotScale((x, y, z), Euler((0, 0, heading)).to_quaternion(),
                                        (scale, scale, scale * flatten))
        clone.matrix_world = adjustment @ matrix
        return clone

    rocks, rock_matrices = model_parts("rock", 64)
    rock_bounds = [matrix @ Vector(p) for part, matrix in zip(rocks, rock_matrices) for p in part.bound_box]
    rock_min = min(p.z for p in rock_bounds)
    rock_height = max(0.4, max(p.z for p in rock_bounds) - rock_min)
    for i in range(36):
        y = 40 - old_random() * 80
        side = 1 if i % 2 else -1
        x = river_center(y) + side * (river_half_width(y) + 0.6 + old_random() * 4.2)
        scale = 0.28 + old_random() * 0.42
        heading = old_random() * math.tau
        old_random()
        if not matched and not (-24 < y < 45 and x > -21):
            continue
        z = ground_height(x, y, matched) - (rock_min + rock_height * 0.42) * scale
        for part, matrix in zip(rocks, rock_matrices):
            stamp(part, matrix, x, y, z, scale, heading)
    for x, three_z, scale in [(-4.8, -1.8, .42), (-1.2, 2.4, .36), (3.8, -2.5, .46), (6.2, 1.5, .38)]:
        heading = old_random() * 6.28
        if matched:
            for part, matrix in zip(rocks, rock_matrices):
                stamp(part, matrix, x, -three_z, WATER_HEIGHT - (rock_min + rock_height * .56) * scale, scale, heading)
    if not matched:
        for i, (x, y, scale, flatten) in enumerate([
            (-3.94, -4.76, .48, .70), (-3.51, -4.95, .19, .68), (-4.73, -5.11, .29, .68),
            (-0.23, -3.62, .22, .50), (1.24, -4.05, .51, .66), (2.34, -3.56, .24, .70),
            (5.37, -1.88, .58, .74), (4.85, .23, .32, .59), (8.42, 1.21, .24, .72),
            (11.6, -1.57, .53, .65), (9.64, 4.44, .70, .69), (12.2, 7.85, .51, .61),
        ]):
            part = rocks[i % len(rocks)]
            bound = [Vector(p) for p in part.bound_box]
            center = sum(bound, Vector()) / 8
            minimum, maximum = min(v.z for v in bound), max(v.z for v in bound)
            local = Matrix.Translation((-center.x, -center.y, -minimum))
            z = WATER_HEIGHT - (maximum - minimum) * scale * flatten * 0.60
            stamp(part, local, x, y, z, scale, rng.uniform(0, math.tau), flatten)
    for part in rocks:
        bpy.data.objects.remove(part, do_unlink=True)

    grass, grass_matrices = model_parts("grass", 59)
    for i in range(85):
        y = 44 - old_random() * 88
        side = 1 if i % 2 else -1
        x = river_center(y) + side * (river_half_width(y) + 1.8 + old_random() * 14)
        scale = 0.55 + old_random() * 0.9
        heading = old_random() * math.tau
        old_random()
        if not matched and (x < 0 or y < -13 or y > 42):
            continue
        for part, matrix in zip(grass, grass_matrices):
            stamp(part, matrix, x, y, ground_height(x, y, matched) - 0.04, scale, heading)
    if not matched:
        for i in range(46):
            y = rng.uniform(-12, 35)
            x = river_center(y) + river_half_width(y) + rng.uniform(1.4, 3.0)
            part = grass[i % len(grass)]
            stamp(part, Matrix.Identity(4), x, y, ground_height(x, y) - 0.05,
                  rng.uniform(0.53, 1.23), rng.uniform(0, math.tau))
    for part in grass:
        bpy.data.objects.remove(part, do_unlink=True)

    trees, tree_matrices = model_parts("tree-far", 103)
    for i in range(42):
        y = 50 - old_random() * 100
        side = 1 if i % 2 else -1
        x = river_center(y) + side * (river_half_width(y) + 11.5 + old_random() * 24.0)
        scale = 0.9 + old_random() * 1.1
        heading = old_random() * 6.28
        old_random()
        if not matched and (x < 0 or y < -18):
            continue
        for part, matrix in zip(trees, tree_matrices):
            stamp(part, matrix, x, y, ground_height(x, y, matched) - 0.18, scale, heading)
    if not matched:
        for x, y, scale in [(22, -3, .84), (24, 6, .86), (22, 11, .58), (26, 15, .95), (24, 27, .75),
                            (23, 34, .67), (20, 42, .65), (28, 31, .88), (30, 20, .91),
                            (29, 24, .58), (36, 18, .89), (39, 22, .77), (36, 29, .68)]:
            heading = rng.uniform(0, math.tau)
            for part, matrix in zip(trees, tree_matrices):
                stamp(part, matrix, x, y, ground_height(x, y) - 0.13, scale, heading)
    for part in trees:
        bpy.data.objects.remove(part, do_unlink=True)


def add_overcast(scene, hdr):
    world = bpy.data.worlds.new("低云散射")
    world.use_nodes = True
    scene.world = world
    tree = world.node_tree
    sky = node(tree, "ShaderNodeTexEnvironment")
    sky.image = bpy.data.images.load(str(hdr), check_existing=True)
    background = next(n for n in tree.nodes if n.type == "BACKGROUND")
    assign(tree, mix(tree, 0.65, sky.outputs["Color"], (0.32, 0.365, 0.39, 1)), background.inputs["Color"])
    background.inputs["Strength"].default_value = 0.73
    lights = (
        ("漫射天光 · 左后", (-8, 4, 12), (-1, 0, 0), 2650, 14, (0.81, 0.89, 1.0)),
        ("岸线反光 · 左前", (-11, -5, 7), (-2, -1, 0), 760, 9, (0.90, 0.93, 1.0)),
        ("云隙反光 · 对岸", (6, 16, 12), (1, -3, 0), 1920, 18, (0.95, 0.94, 0.80)),
        ("雨天肩沿与帽檐", (-2, 3, 4.5), (-2, -1.7, 0.8), 270, 5, (0.72, 0.84, 1.0)),
    )
    for name, position, target, power, size, color in lights:
        lamp = bpy.data.lights.new(name, "AREA")
        lamp.energy = power
        lamp.shape = "DISK"
        lamp.size = size
        lamp.color = color
        lamp.use_shadow = name.startswith("漫射天光")
        obj = bpy.data.objects.new(name, lamp)
        bpy.context.scene.collection.objects.link(obj)
        obj.location = position
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def add_water():
    material, tree, shader = base_material("湘江：深水、斜流波与雨点涟漪")
    position = node(tree, "ShaderNodeNewGeometry").outputs["Position"]
    clock = node(tree, "ShaderNodeValue")
    clock.label = "经过秒数"
    drift = node(tree, "ShaderNodeCombineXYZ")
    assign(tree, math_node(tree, "MULTIPLY", clock.outputs[0], 0.47), drift.inputs["Y"])
    moving = vector_math(tree, "ADD", position, drift.outputs[0])
    long_coordinates = vector_math(tree, "MULTIPLY", moving, (0.97, 1.87, 1.0))
    chop_coordinates = vector_math(tree, "MULTIPLY", moving, (0.75, 2.87, 1.0))
    wind_waves = noise_value(tree, long_coordinates, 1.31, 2.75)
    crossed = noise_value(tree, chop_coordinates, 5.6, 2.5, 0.63)
    water_color = mix(tree, wind_waves, (0.015, 0.035, 0.046, 1), (0.043, 0.083, 0.103, 1))
    shine = mix(tree, wind_waves, (0.023, 0.044, 0.061, 1), (0.122, 0.163, 0.174, 1))
    layer = node(tree, "ShaderNodeLayerWeight")
    layer.inputs["Blend"].default_value = 0.47
    assign(tree, mix(tree, layer.outputs["Fresnel"], water_color, shine), shader.inputs["Base Color"])
    assign(tree, water_color, shader.inputs["Emission Color"])
    shader.inputs["Emission Strength"].default_value = 0.12
    shader.inputs["IOR"].default_value = 1.333
    shader.inputs["Specular IOR Level"].default_value = 0.23
    shader.inputs["Metallic"].default_value = 0.12
    shader.inputs["Coat Weight"].default_value = 0.24
    shader.inputs["Coat Roughness"].default_value = 0.20
    assign(tree, math_node(tree, "ADD", 0.23, math_node(tree, "MULTIPLY", crossed, 0.22)), shader.inputs["Roughness"])
    broad_bump = node(tree, "ShaderNodeBump")
    broad_bump.inputs["Distance"].default_value = 0.22
    broad_bump.inputs["Strength"].default_value = 0.62
    assign(tree, wind_waves, broad_bump.inputs["Height"])
    finer_bump = node(tree, "ShaderNodeBump")
    finer_bump.inputs["Distance"].default_value = 0.059
    finer_bump.inputs["Strength"].default_value = 0.43
    assign(tree, crossed, finer_bump.inputs["Height"])
    assign(tree, broad_bump.outputs[0], finer_bump.inputs["Normal"])

    rain = node(tree, "ShaderNodeTexVoronoi", voronoi_dimensions="2D")
    rain.inputs["Scale"].default_value = 5.1
    assign(tree, position, rain.inputs["Vector"])
    color = node(tree, "ShaderNodeSeparateColor")
    assign(tree, rain.outputs["Color"], color.inputs["Color"])
    phase = math_node(tree, "FRACT", math_node(tree, "ADD", color.outputs[0],
                                               math_node(tree, "MULTIPLY", clock.outputs[0], 1.24)))
    distance_from_rim = math_node(tree, "ABSOLUTE", math_node(tree, "SUBTRACT", rain.outputs["Distance"],
                                                              math_node(tree, "MULTIPLY", phase, 0.42)))
    edge = math_node(tree, "SUBTRACT", 1, ramp(tree, distance_from_rim, 0.01, 0.048))
    ripple = math_node(tree, "MULTIPLY", edge, math_node(tree, "SUBTRACT", 1, phase))
    drops = node(tree, "ShaderNodeBump")
    drops.inputs["Distance"].default_value = 0.008
    drops.inputs["Strength"].default_value = 0.22
    assign(tree, ripple, drops.inputs["Height"])
    assign(tree, finer_bump.outputs[0], drops.inputs["Normal"])
    assign(tree, drops.outputs[0], shader.inputs["Normal"])
    assign(tree, drops.outputs[0], shader.inputs["Coat Normal"])
    mist_material(tree, shader.outputs[0], 25, 110, 0.84)

    vertices, faces = [], []
    for j in range(207):
        y = lerp(-92, 113, j / 206)
        center, hw = river_center(y), river_half_width(y) + 3.4
        for i in range(25):
            x = center + lerp(-hw, hw, i / 24)
            vertices.append((x, y, WATER_HEIGHT))
            if j < 206 and i < 24:
                k = j * 25 + i
                faces.append((k, k + 1, k + 26, k + 25))
    mesh_object("起伏水光 · 湘江", vertices, faces, material)
    return clock.outputs[0]


class WaterMarks:
    """One mesh for all advected foam arcs and their fading crests."""

    RIBBONS = 4
    POINTS = 15

    def __init__(self, feet_count):
        material, tree, shader = base_material("脚侧扰流 · 薄水沫")
        colors = node(tree, "ShaderNodeVertexColor", layer_name="浅流高光")
        assign(tree, colors.outputs["Alpha"], shader.inputs["Alpha"])
        assign(tree, colors.outputs["Color"], shader.inputs["Base Color"])
        assign(tree, colors.outputs["Color"], shader.inputs["Emission Color"])
        shader.inputs["Emission Strength"].default_value = 0.38
        shader.inputs["Roughness"].default_value = 0.53
        self.count = feet_count * self.RIBBONS * self.POINTS * 2
        faces = []
        for index in range(feet_count * self.RIBBONS):
            start = index * self.POINTS * 2
            for i in range(start, start + self.POINTS * 2 - 2, 2):
                faces.append((i, i + 1, i + 3, i + 2))
        self.mesh = mesh_object("水线接触与随流尾迹", [(0, 0, -3)] * self.count, faces, material).data
        self.attribute = self.mesh.color_attributes.new(name="浅流高光", type="FLOAT_COLOR", domain="POINT")

    def set(self, states, time):
        position = array("f")
        colors = array("f")
        index = 0
        for actor in states:
            for center, phase, lift in actor:
                for layer in range(self.RIBBONS):
                    if center is None:
                        samples = self.POINTS * 2
                        position.extend((0, 0, -3) * samples)
                        colors.extend((0, 0, 0, 0) * samples)
                        continue
                    expansion = (time * 1.65 + layer * 0.173 + index * 0.083) % 1
                    if layer == 0:
                        expansion = 0.13 * math.sin(time * 4.8 + index) + 0.12
                    rise = 1 - expansion
                    radius = 0.10 + layer * 0.046 + expansion * 0.14 + 0.064 * lift
                    spread = 1.11 + expansion * 1.37
                    apex = 0.09 + layer * 0.11 + expansion * 0.15
                    start_angle = -0.16 - 0.19 * layer + 0.18 * math.sin(index)
                    arc = 3.42 + 0.13 * layer
                    for k in range(self.POINTS):
                        along = k / (self.POINTS - 1)
                        a = start_angle + arc * along
                        irregular = 1 + 0.12 * math.sin(6 * a + index * 0.82) + 0.07 * math.cos(19 * a + time * 5)
                        blade = math.sin(math.pi * along) ** 0.72
                        shimmer = 0.42 + 0.58 * (0.5 + 0.5 * math.sin(k * 2.9 + layer * 4.1 + index * 2.0)) ** 0.61
                        alpha = rise * blade * shimmer * ((0.42 if layer == 0 else 0.23) + 0.30 * lift)
                        width = (0.008 + 0.012 * rise + 0.01 * lift) * blade
                        for side in (-1, 1):
                            rad = radius * irregular + side * width
                            x = center.x + rad * math.cos(a)
                            y = center.y + spread * rad * math.sin(a) - apex
                            position.extend((x, y, WATER_HEIGHT + 0.007 + layer * 0.002))
                            tone = 0.28 + 0.15 * rise + lift * 0.18
                            colors.extend((tone * 0.84, tone * 0.98, tone, alpha))
                index += 1
        self.mesh.vertices.foreach_set("co", position)
        self.attribute.data.foreach_set("color", colors)
        self.mesh.update()


class Rain:
    """Slanted near-camera streaks, graded down toward the valley."""

    def __init__(self, count=254):
        rng = random.Random(19341129)
        self.drops = [(rng.uniform(-9, 15), rng.uniform(-8, 17), rng.uniform(0, 8.3),
                       rng.uniform(5.4, 8.0), rng.uniform(0.072, 0.234), rng.uniform(0.0008, 0.0027))
                      for _ in range(count)]
        material, tree, shader = base_material("薄雨 · 近机位雨丝")
        shader.inputs["Base Color"].default_value = (0.46, 0.53, 0.56, 1.0)
        shader.inputs["Emission Color"].default_value = (0.37, 0.44, 0.47, 1)
        shader.inputs["Emission Strength"].default_value = 0.38
        shader.inputs["Alpha"].default_value = 0.22
        self.mesh = mesh_object("镜头附近薄雨", [(0, 0, -4)] * (count * 4),
                                [tuple(range(4 * i, 4 * i + 4)) for i in range(count)], material).data

    def set(self, time, camera):
        positions = array("f")
        right = camera.rotation_euler.to_matrix() @ Vector((1, 0, 0))
        for x, y, start, speed, length, width in self.drops:
            z = (start - time * speed) % 8.3
            lower = Vector((x - 0.16 * z, y + 0.085 * z, z))
            upper = lower + Vector((-length * 0.14, length * 0.092, length))
            for p in (lower - right * width, lower + right * width, upper + right * width * 0.53,
                      upper - right * width * 0.53):
                positions.extend(p)
        self.mesh.vertices.foreach_set("co", positions)
        self.mesh.update()

