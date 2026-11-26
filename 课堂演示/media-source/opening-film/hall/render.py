"""Rendering setup for the 118-frame entry into the Zunyi hall."""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path
from random import Random

import bmesh
import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.dont_write_bytecode = True
sys.path.insert(0, str(HERE.parents[1] / "exploration"))
from refine_mesh import Parts  # noqa: E402


FPS = 24
FRAMES = round(76.65 * FPS) - round(72.25 * FPS) + 12
ASSETS = REPO / "课堂演示" / "assets" / "zunyi-hall"
STUDY = REPO / "展示材料" / "遵义会议室精修场景" / "会前的桌边.blend"
SEED = 78655


def rgba(rgb):
    return (*rgb, 1)


def principled(name, color, roughness, metallic=0):
    material = bpy.data.materials.new(name)
    material.diffuse_color = rgba(color)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return material, bsdf


def noise(tree, source, scale, detail=2):
    node = tree.nodes.new("ShaderNodeTexNoise")
    node.inputs["Scale"].default_value = scale
    node.inputs["Detail"].default_value = detail
    tree.links.new(source, node.inputs["Vector"])
    return node.outputs["Fac"]


def ramp(tree, signal, stops):
    node = tree.nodes.new("ShaderNodeValToRGB")
    colors = node.color_ramp
    colors.elements[0].position, colors.elements[0].color = stops[0]
    colors.elements[1].position, colors.elements[1].color = stops[-1]
    for position, color in stops[1:-1]:
        colors.elements.new(position).color = color
    tree.links.new(signal, node.inputs["Fac"])
    return node.outputs["Color"]


def multiply(tree, first, second, factor=1):
    node = tree.nodes.new("ShaderNodeMixRGB")
    node.blend_type = "MULTIPLY"
    node.inputs[0].default_value = factor
    tree.links.new(first, node.inputs[1])
    if isinstance(second, tuple):
        node.inputs[2].default_value = second
    else:
        tree.links.new(second, node.inputs[2])
    return node.outputs["Color"]


def image_texture(tree, file, color=True):
    node = tree.nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(str(ASSETS / file), check_existing=True)
    if not color:
        node.image.colorspace_settings.name = "Non-Color"
    return node.outputs["Color"]


def plaster():
    mat, bsdf = principled("Lime plaster, patching and grain", (.38, .35, .31), .86)
    tree = mat.node_tree
    coords = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    mottling = ramp(tree, noise(tree, coords, 2.7, 4), [
        (.19, (.37, .32, .26, 1)), (.53, (.72, .66, .57, 1)), (.81, (.97, .91, .79, 1)),
    ])
    color = multiply(tree, image_texture(tree, "plaster.jpg"), mottling, .65)
    tree.links.new(color, bsdf.inputs["Base Color"])
    normal = tree.nodes.new("ShaderNodeNormalMap")
    normal.inputs["Strength"].default_value = .54
    tree.links.new(image_texture(tree, "plaster-normal.jpg", color=False), normal.inputs["Color"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .31
    bump.inputs["Distance"].default_value = .017
    tree.links.new(normal.outputs["Normal"], bump.inputs["Normal"])
    tree.links.new(noise(tree, coords, 150, 3), bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def wood(name, axis, red=False):
    mat, bsdf = principled(name, (.095, .049, .027), .43)
    tree = mat.node_tree
    coords = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    stretch = tree.nodes.new("ShaderNodeVectorMath")
    stretch.operation = "MULTIPLY"
    scales = [34, 34, 34]
    scales[axis] = .82
    stretch.inputs[1].default_value = scales
    tree.links.new(coords, stretch.inputs[0])
    grain = noise(tree, stretch.outputs["Vector"], 4.2, 3)
    weather = noise(tree, coords, 7, 4)
    colors = ((.036, .017, .011), (.143, .038, .024), (.24, .103, .05)) if red else (
        (.027, .012, .007), (.089, .045, .024), (.18, .095, .041)
    )
    base = ramp(tree, grain, [(p, rgba(c)) for p, c in zip((.16, .55, .83), colors)])
    scan = image_texture(tree, "wood.jpg")
    tree.links.new(multiply(tree, base, scan, .24), bsdf.inputs["Base Color"])
    tree.links.new(ramp(tree, weather, [(.2, (.31, .31, .31, 1)),
                                       (.8, (.67, .67, .67, 1))]), bsdf.inputs["Roughness"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .27
    bump.inputs["Distance"].default_value = .009
    tree.links.new(grain, bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Coat Weight"].default_value = .12 if red else .05
    bsdf.inputs["Coat Roughness"].default_value = .36
    return mat


def stone(name, color, roughness):
    mat, bsdf = principled(name, color, roughness)
    tree = mat.node_tree
    coords = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    shade = ramp(tree, noise(tree, coords, 17, 4), [
        (.22, rgba(tuple(v * .55 for v in color))), (.78, rgba(tuple(v * 1.42 for v in color))),
    ])
    tree.links.new(shade, bsdf.inputs["Base Color"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .42
    bump.inputs["Distance"].default_value = .011
    tree.links.new(noise(tree, coords, 154, 4), bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def patina(name, color, roughness):
    material = stone(name, color, roughness)
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Metallic"].default_value = 1
    return material


def block(parts, position, size, bevel=.005):
    x, y, z = position
    sx, sy, sz = size
    parts.block((x, z, -y), (sx, sz, sy), bevel)


def batch(name, material, specs, uv_meters=1.6):
    parts = Parts(material, uv_meters)
    for position, size, bevel in specs:
        block(parts, position, size, bevel)
    return parts.object(name)


def piece(name, mat, position, size, bevel=.005):
    local = batch(name, mat, [((0, 0, 0), size, bevel)])
    local.location = position
    return local


def group(name, position=(0, 0, 0)):
    root = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(root)
    root.location = position
    return root


def cylinder(name, mat, position, radius, depth, rotation=(0, 0, 0), vertices=24):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=position)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler = rotation
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.use_smooth = len(poly.vertices) == 4
    bevel = obj.modifiers.new("Turned edges", "BEVEL")
    bevel.width, bevel.segments = min(.002, radius * .18), 2
    return obj


def wire(name, mat, coords, radius):
    curve = bpy.data.curves.new(name, "CURVE")
    curve.dimensions = "3D"
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    points = curve.splines.new("POLY")
    points.points.add(len(coords) - 1)
    for point, xyz in zip(points.points, coords):
        point.co = (*xyz, 1)
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    curve.materials.append(mat)
    return obj


def remove_faces(name, region):
    obj = bpy.data.objects[name]
    mesh = bmesh.new()
    mesh.from_mesh(obj.data)
    matrix = obj.matrix_world
    faces = [face for face in mesh.faces if region(*(matrix @ face.calc_center_median()))]
    bmesh.ops.delete(mesh, geom=faces, context="FACES")
    mesh.to_mesh(obj.data)
    mesh.free()
    obj.data.update()


def import_hall():
    bpy.ops.import_scene.gltf(filepath=str(ASSETS / "hall-model.glb"), merge_vertices=True)
    bpy.context.view_layer.update()

    def old_lantern(x, y, z):
        return min(abs(x - .18), abs(x - 2.62)) < .145 and .11 < y < .42 and 1.95 < z < 2.63

    def door_or_lantern(x, y, z):
        return .42 < x < 2.38 and .42 < y < 1.53 and z < 2.73 or old_lantern(x, y, z)

    for name in ("门窗与檐下木构", "木作边缘、窗格内层", "黔北暗朱红栏板与挂落", "窗铰门环与灯具五金"):
        remove_faces(name, door_or_lantern)
    remove_faces("磨损石门槛与柱脚", lambda x, y, z: .2 < x < 2.6 and .02 < y < 1.08)
    remove_faces("门窗与檐下木构", lambda x, y, z: 4.73 < x and 2.0 < y < 4.11 and z < 2.30)
    remove_faces("黔北暗朱红栏板与挂落", lambda x, y, z: 4.73 < x and 2.0 < y < 4.11 and z < 2.30)
    def exposed_opening_bricks(x, y, z):
        door_jamb = .24 < x < .61 or 2.19 < x < 2.58
        return .57 < y < .89 and abs(x) < 5.12 and (z > .92 or door_jamb)

    for name in ("墙角与洞口 · 青砖 1", "墙角与洞口 · 青砖 2"):
        remove_faces(name, exposed_opening_bricks)
    for name in ("匾额与挂轴金饰", "档案卷宗堆叠", "靛青布包", "青瓷茶器"):
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)

    # Keep the scanned relief under the damp patches.
    for name, values in (
        ("灰石板 · 颜色、法线与粗糙度", (.38, .70, .09)),
        ("旧木地板 · 顺纹", (.37, .67, .13)),
    ):
        mat = bpy.data.materials[name]
        tree = mat.node_tree
        bsdf = next(node for node in tree.nodes if node.type == "BSDF_PRINCIPLED")
        low, high, coat = values
        coords = tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
        weather = ramp(tree, noise(tree, coords, 1.9, 4), [
            (.23, rgba((low,) * 3)), (.86, rgba((high,) * 3)),
        ])
        tree.links.new(weather, bsdf.inputs["Roughness"])
        bsdf.inputs["Coat Weight"].default_value = coat
        bsdf.inputs["Coat Roughness"].default_value = .37


def architecture(rng, materials):
    lime, old_wood, brick_variants, mortar = materials
    shell = [
        ((0, .16, -.23), (11.6, 12, .38), .006),
        ((-5.46, -.16, 1.26), (.23, 11.38, 2.52), .008),
        ((5.46, -.16, 1.26), (.23, 11.38, 2.52), .008),
        ((0, -5.77, .86), (11.2, .22, 1.72), .008),
    ]
    batch("Courtyard walls and footing", mortar, shell)
    walls = []
    facade_bases = []
    for left, right, windows in [(-5.36, .47, (-3.89, -1.82)), (2.33, 5.36, (3.97,))]:
        center = (left + right) / 2
        facade_bases.append((left, right))
        walls.extend([
            ((center, .775, .506), (right - left, .187, 1.013), .009),
            ((center, .79, 2.548), (right - left, .247, .605), .009),
        ])
        edge = left
        for window in windows:
            end = window - .60
            walls.append((((edge + end) / 2, .786, 1.64), (end - edge, .239, 1.273), .009))
            edge = window + .60
        walls.append((((edge + right) / 2, .786, 1.64), (right - edge, .239, 1.273), .009))
    windows = [(1.40, .69), (3.77, .63)]
    edge = -5.54
    for x, half in windows:
        for z, height in ((.525, 1.05), (2.616, .51)):
            walls.append(((x, 5.50, z), (2 * half, .22, height), .008))
        left = x - half
        walls.append((((edge + left) / 2, 5.50, 1.42), (left - edge, .22, 2.84), .009))
        edge = x + half
    walls.append((((edge + 5.54) / 2, 5.50, 1.42), (5.54 - edge, .22, 2.84), .009))
    walls.extend([
        ((1.40, .787, 2.69), (1.86, .24, .326), .01),
        ((0, 3.11, 2.855), (11.18, 4.62, .075), .010),
    ])
    batch("Chunky lime plaster with window returns", lime, walls, 1.62)

    bricks = [Parts(mat, 1.3) for mat in brick_variants]
    for left, right in facade_bases:
        for row in range(15):
            z = .036 + row * .068
            edge = left
            while edge < right - .025:
                full = .228 + rng.uniform(-.030, .030)
                width = full * .54 if edge == left and row % 2 else full
                end = min(right, edge + width)
                protrusion = rng.uniform(.0, .009)
                block(rng.choice(bricks), ((edge + end) / 2, .675 - protrusion, z + rng.uniform(-.003, .003)),
                      (max(.014, end - edge - .007), .064, .061 + rng.uniform(-.004, .002)), rng.uniform(.003, .006))
                edge = end
    for center, bottom, top, width in (
        (.423, 1.018, 2.455, .105), (2.377, 1.018, 2.455, .102),
        *[(x + sign * .655, 1.045, 2.238, .088) for x in (-3.89, -1.82, 3.97) for sign in (-1, 1)],
    ):
        level = bottom
        while level < top - .027:
            height = min(top - level, rng.uniform(.062, .093))
            block(rng.choice(bricks), (center + rng.uniform(-.002, .002), .671, level + height / 2),
                  (width + rng.uniform(-.008, .008), .041, height - .004), .0036)
            level += height
    for index, parts in enumerate(bricks):
        parts.object(f"Staggered blue bricks {index + 1}")

    trim = [
        ((0, 5.345, .132), (11.06, .093, .264), .014),
        ((0, .900, 2.778), (11.34, .143, .117), .012),
        ((0, 5.335, 2.775), (11.14, .105, .16), .010),
        ((-5.31, 3.13, .135), (.161, 4.64, .27), .012),
        ((5.31, 3.13, .135), (.161, 4.64, .27), .012),
    ]
    for x in (-5.30, -3.0, -.78, 2.49, 4.68, 5.31):
        trim.append(((x, 5.346, 1.46), (.126, .108, 2.58), .008))
    batch("Exposed beams and room skirting", old_wood, trim)

    # A real volume behind the openings gives the view through the sash depth.
    outer = [
        ((2.80, 8.07, .91), (8.40, .24, 1.82), .01),
        ((2.80, 8.115, 2.68), (8.40, .30, 1.04), .01),
        ((2.80, 6.77, -.11), (8.40, 3.38, .22), .01),
    ]
    for x in (-1.35, .63, 2.60, 4.60, 6.82):
        outer.append(((x, 8.07, 2.16), (.21, .29, .77), .009))
    batch("Opposite timber and lime wing", lime, outer)
    roof = piece("Opposite wing roof", mortar, (2.8, 7.74, 2.91), (9.0, 1.57, .17), .018)
    roof.rotation_euler.x = math.radians(10)
    for side, opening in enumerate((-.10, 1.48, 3.35, 5.27)):
        dims = ((opening, 8.143, 2.08), (1.40, .07, .67), .008)
        base = brick_variants[side % len(brick_variants)]
        batch(f"Opposite wing opening {side + 1}", base, [dims])
    rear_window, shader = principled("Single window across the courtyard", (.42, .21, .085), .8)
    shader.inputs["Emission Color"].default_value = (1, .47, .12, 1)
    shader.inputs["Emission Strength"].default_value = .47
    piece("Warm paper beyond the sash", rear_window, (1.63, 8.10, 1.99), (.44, .04, .48))
    batch("Opposite window tracery and eave", old_wood, [
        *[((x, 8.072, 1.99), (.024, .041, .50), .003) for x in (1.43, 1.55, 1.70, 1.83)],
        *[((1.63, 8.072, z), (.45, .041, .024), .003) for z in (1.79, 1.97, 2.14)],
        ((2.80, 7.032, 2.753), (8.4, .15, .14), .011),
    ])
    eave_tiles(rng)


def eave_tiles(rng):
    material = stone("Weathered charcoal grey clay", (.105, .111, .105), .69)
    pans = Parts(material, 1.3)
    for i in range(55):
        x = (i - 27) * .213 + rng.uniform(-.009, .009)
        grow = 1 + rng.uniform(-.13, .12)
        z = 2.937 + rng.uniform(-.013, .011)
        front = -.218 + rng.uniform(-.013, .011)
        half_width, crown = .052 * grow, .047 * grow
        arc = [(half_width * math.sin(a * math.pi / 12), crown * math.cos(a * math.pi / 12))
               for a in range(-6, 7)]
        underside = [(u * .91, height - .012) for u, height in reversed(arc)]
        rings = []
        for depth in (0, .22):
            rings.append([(x + u, z + height + .23 * depth, -(front + depth)) for u, height in arc + underside])
        pans.prism(rings)
    obj = pans.object("Round ends of the foreground cover tiles")
    for poly in obj.data.polygons:
        if len(poly.vertices) == 4:
            poly.use_smooth = True


def door(vertical, horizontal, panel, iron, brass, slate):
    uprights = []
    heads = []
    for x in (.565, 2.235):
        sign = 1 if x < 1.4 else -1
        uprights.extend([
            ((x, .760, 1.275), (.185, .266, 2.39), .013),
            ((x + sign * .103, .800, 1.285), (.031, .181, 2.34), .006),
            ((x - sign * .012, .609, 1.300), (.112, .059, 2.39), .010),
        ])
        heads.extend([
            ((x, .551, 2.54), (.26, .19, .12), .016),
            ((x, .628, 2.64), (.222, .29, .117), .016),
        ])
    heads.extend([
        ((1.40, .76, 2.50), (1.91, .30, .145), .016),
        ((1.40, .608, 2.59), (2.18, .139, .089), .012),
        ((1.40, .655, 2.72), (2.12, .142, .102), .013),
        ((1.40, .818, 2.388), (1.514, .16, .037), .005),
    ])
    batch("Rebated door jambs", vertical, uprights)
    batch("Lintel, drip edge and supporting blocks", horizontal, heads)
    batch("Worn blue stone step and pillar pads", slate, [
        ((1.40, .583, .024), (1.76, .57, .104), .018),
        ((.555, .745, .102), (.29, .36, .202), .021),
        ((2.245, .745, .104), (.29, .36, .206), .023),
    ])
    batch("Rounded oak threshold", horizontal, [
        ((1.40, .782, .083), (1.496, .248, .051), .015),
        ((1.40, .917, .053), (1.48, .08, .037), .010),
    ])
    hinges = []
    for side, x in ((1, .681), (-1, 2.119)):
        leaf = group(f"Door leaf pivot {x:.3f}", (x, .822, .11))
        width, h = .710, 2.247
        stiles = [
            ((side * .044, 0, h / 2), (.088, .067, h), .009),
            ((side * (width - .045), 0, h / 2), (.090, .067, h), .008),
        ]
        rails = [((side * width / 2, 0, z), (width, .067, depth), .010)
                 for z, depth in ((.057, .112), (.837, .107), (2.187, .119))]
        panels = []
        for index in range(3):
            center = side * (.178 + index * .176)
            panels.append(((center, 0, .443), (.172, .042, .669), .006))
            panels.append(((center, -.026, .446), (.149, .019, .609), .010))
            panels.append(((center, .026, .446), (.149, .019, .607), .010))
        for offset in (.207, .351, .495):
            stiles.append(((side * offset, -.003, 1.498), (.028, .038, 1.24), .004))
        for z in (1.17, 1.48, 1.79, 2.0):
            rails.append(((side * width / 2, -.002, z), (.584, .036, .023), .004))
        for suffix, material, specs in (("stiles and muntins", vertical, stiles),
                                         ("drawbored rails", horizontal, rails), ("raised panels", panel, panels)):
            batch(f"Door {suffix} {side}", material, specs).parent = leaf

        plates = []
        pivot_offsets = ((.255, .151), (1.86, .153), (2.092, .090))
        for z, height in pivot_offsets:
            center = (side * .039, -.025, z)
            plates.append((center, (.078, .016, height), .008))
            cylinder("Moving centre barrel", iron, (0, 0, z), .019, height * .44).parent = leaf
            for sign in (-1, 1):
                cylinder("Fixed hinge barrel", iron, (x, .822, z + .11 + sign * height * .38),
                         .019, height * .24)
            cylinder("Peened hinge pin", brass, (x, .822, z + .11 + height * .53), .012, .013)
            for zz in (z - height * .28, z + height * .27):
                cylinder("Hinge plate iron rivet", iron, (side * .056, -.036, zz), .008, .010,
                         (math.pi / 2, 0, 0), 12).parent = leaf
            piece("Fixed jamb hinge strap", iron, (x - side * .056, .812, z + .11),
                  (.132, .021, height), .008)
        batch("Swinging hinge straps", iron, plates).parent = leaf
        center_x = side * (width - .10)
        cylinder("Cast round door pull escutcheon", brass, (center_x, -.063, .955), .038, .010,
                 (math.pi / 2, 0, 0), 32).parent = leaf
        cylinder("Knob for the swinging pull", brass, (center_x, -.081, .955), .014, .035,
                 (math.pi / 2, 0, 0), 18).parent = leaf
        ring = [(center_x + math.cos(i * math.tau / 32) * .028, -.094,
                 .928 + math.sin(i * math.tau / 32) * .032) for i in range(33)]
        wire("Rounded bronze finger pull", brass, ring, .0055).parent = leaf
        hinges.append((leaf, side))
    return hinges


def windows(stiles, rails, slate):
    x_stiles, x_rails, sills = [], [], []
    for x, half in ((1.40, .69), (3.77, .63)):
        for sign in (-1, 1):
            x_stiles.append(((x + sign * (half - .037), 5.414, 1.71), (.118, .235, 1.448), .008))
        for offset in (-.32, 0, .32):
            x_stiles.append(((x + offset, 5.384, 1.72), (.049, .101, 1.34), .003))
        for z in (1.085, 2.354):
            x_rails.append(((x, 5.408, z), (2 * half+.047, .20, .131), .007))
        for z in (1.439, 1.759, 2.077):
            x_rails.append(((x, 5.381, z), (2 * half - .091, .092, .048), .004))
        sills.append(((x, 5.374, 1.016), (2 * half+.22, .32, .108), .012))
    batch("Window frames and bars", stiles, x_stiles)
    batch("Window head and rails", rails, x_rails)
    batch("Stone window sills", slate, sills)


def light(name, kind, position, energy, color, *, target=None, size=1, radius=.12, shadows=False):
    data = bpy.data.lights.new(name, kind)
    data.energy, data.color = energy, color
    data.use_shadow = shadows
    data.use_shadow_jitter = shadows
    if kind == "AREA":
        data.shape, data.size = "DISK", size
    elif kind == "POINT":
        data.shadow_soft_size = radius
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = position
    if target:
        obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()
    return obj


def paper_shade(index):
    mat, shader = principled(f"Porch lamp {index} · mulberry paper", (.47, .25, .105), .78)
    tree = mat.node_tree
    coords = tree.nodes.new("ShaderNodeTexCoord").outputs["Generated"]
    paper = noise(tree, coords, 92, 3)
    signal = noise(tree, coords, 5, 3)
    warm = ramp(tree, signal, [(.17, (1, .27, .062, 1)), (.82, (1, .68, .32, 1))])
    tree.links.new(multiply(tree, warm, paper, .18), shader.inputs["Emission Color"])
    shader.inputs["Emission Strength"].default_value = 1.85
    tree.links.new(warm, shader.inputs["Base Color"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value, bump.inputs["Distance"].default_value = .13, .012
    tree.links.new(paper, bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat, shader.inputs["Emission Strength"]


def porch_lamp(index, x, timber, panel, iron):
    root = group(f"Swinging porch lantern {index}", (x, .304, 2.548))
    piece("Blackened mounting block", timber, (x, .465, 2.649), (.164, .17, .088), .012)
    wire("Iron suspension eye", iron, [(x, .41, 2.66), (x, .31, 2.659), (x, .304, 2.53)], .007)
    stem = cylinder("Hook and chain axle", iron, (0, 0, -.083), .008, .166)
    stem.parent = root
    frame = []
    rails = []
    panels = []
    for dx in (-.112, .112):
        for dy in (-.112, .112):
            frame.append(((dx, dy, -.316), (.027, .027, .288), .006))
        panels.append(((dx, 0, -.319), (.012, .211, .246), .003))
        panels.append(((0, dx, -.319), (.211, .012, .246), .003))
        frame.append(((dx, 0, -.320), (.025, .013, .246), .002))
        frame.append(((0, dx, -.320), (.013, .025, .246), .002))
    for z in (-.193, -.443):
        rails.append(((0, 0, z), (.298, .298, .043), .014))
        rails.append(((0, 0, z + (.024 if z > -.3 else -.025)), (.225, .225, .025), .009))
    paper, emission = paper_shade(index)
    for name, mat, specs in (("Lantern wood frame", timber, frame), ("Lantern cap", panel, rails),
                              ("Lantern paper", paper, panels)):
        batch(name, mat, specs).parent = root
    pendant = cylinder("Pendant bob", iron, (0, 0, -.493), .014, .081)
    pendant.parent = root
    glow = light("Porch lantern projected light", "POINT", (0, -.142, -.31), 15, (1, .55, .24), radius=.14)
    glow.parent = root
    bounce = light("Porch lantern light on the wall", "POINT", (x, .424, 2.222), 6.5, (1, .50, .22),
                   radius=.19)
    return root, glow, bounce, emission


def room_furnishings():
    groups = ["02 · 木作家具", "03 · 手记与扎绳卷宗", "04 · 玻璃提灯", "05 · 茶碗和铅笔"]
    with bpy.data.libraries.load(str(STUDY), link=False) as (source, target):
        target.collections = groups
    furniture = group("Imported study table, papers and lantern")
    for collection in target.collections:
        bpy.context.scene.collection.children.link(collection)
        for obj in collection.objects:
            if not obj.parent:
                obj.parent = furniture
    furniture.location = (1.92, 3.95, .009)
    furniture.rotation_euler.z = -.11
    # Reposition the study's scanned chair for this shot.
    chair = bpy.data.objects["木靠椅 · 椅身"]
    original = chair.parent
    original.location.x = .67
    original.location.y = .81
    for i, (x, y, angle) in enumerate(((-1.35, -.42, 2.29), (1.05, .36, .35))):
        duplicate = chair.copy()
        bpy.context.collection.objects.link(duplicate)
        mount = group(f"Chair position {i + 2}", (x, y, original.location.z))
        mount.parent = furniture
        mount.rotation_euler.z = angle
        duplicate.parent = mount

    # Keep the wick visible through both sides of the glass and reflect the two keys at grazing angles.
    glass = bpy.data.objects["薄壁玻璃灯罩"].active_material
    tree = glass.node_tree
    tree.nodes.clear()
    surface = tree.nodes.new("ShaderNodeOutputMaterial").inputs["Surface"]
    clear = tree.nodes.new("ShaderNodeBsdfTransparent")
    clear.inputs["Color"].default_value = (.988, .973, .952, 1)
    mix = tree.nodes.new("ShaderNodeMixShader")
    facing = tree.nodes.new("ShaderNodeFresnel")
    facing.inputs["IOR"].default_value = 1.46
    edge = ramp(tree, facing.outputs["Fac"], [(.04, (.008, .008, .008, 1)),
                                                (.55, (.22, .22, .22, 1)),
                                                (1, (.48, .48, .48, 1))])
    reflection = tree.nodes.new("ShaderNodeBsdfGlossy")
    reflection.inputs["Color"].default_value = (.81, .80, .77, 1)
    reflection.inputs["Roughness"].default_value = .106
    tree.links.new(edge, mix.inputs[0])
    tree.links.new(clear.outputs[0], mix.inputs[1])
    tree.links.new(reflection.outputs[0], mix.inputs[2])
    tree.links.new(mix.outputs[0], surface)
    glass.surface_render_method = "DITHERED"
    glass.use_transparent_shadow = True

    lantern = bpy.data.objects["提灯总成"]
    for obj in bpy.data.objects:
        if obj.parent == lantern and obj.name in ("偏斜外焰", "明亮焰芯"):
            for vertex in obj.data.vertices:
                vertex.co.z = .127 + (vertex.co.z - .127) * 1.12
    oil = light("Oil flame spill", "POINT", (0, -.047, .157), 22, (1, .44, .17), radius=.12, shadows=True)
    oil.parent = lantern
    return oil, [bpy.data.objects[name] for name in ("偏斜外焰", "明亮焰芯")]


def cinema_lighting():
    ambient = bpy.data.worlds.new("Clouded winter dusk")
    scene = bpy.context.scene
    scene.world = ambient
    ambient.use_nodes = True
    tree = ambient.node_tree
    sky = tree.nodes.get("Background")
    sky.inputs["Strength"].default_value = .48
    texture = tree.nodes.new("ShaderNodeTexCoord")
    clouds = noise(tree, texture.outputs["Normal"], 4.1, 3)
    split = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(texture.outputs["Normal"], split.inputs[0])
    elevation = tree.nodes.new("ShaderNodeMath")
    elevation.operation, elevation.inputs[1].default_value = "MULTIPLY_ADD", -1.10
    elevation.inputs[2].default_value = .48
    tree.links.new(split.outputs["Z"], elevation.inputs[0])
    deep_blue = ramp(tree, elevation.outputs[0], [
        (0.0, (.068, .117, .155, 1)), (1.0, (.275, .348, .385, 1)),
    ])
    cloud_color = ramp(tree, clouds, [
        (.16, (.58, .63, .68, 1)), (.52, (.85, .91, .92, 1)), (.83, (1, .98, .92, 1)),
    ])
    tree.links.new(multiply(tree, deep_blue, cloud_color, .37), sky.inputs["Color"])

    light("Overcast courtyard sky", "AREA", (-2.8, -4.0, 6.7), 420, (.56, .71, 1),
          target=(1.11, .65, 1.2), size=6.8, shadows=True)
    light("Late light above east wall", "AREA", (5.5, -2.8, 4.3), 180, (.66, .77, .95),
          target=(.35, .58, 1.0), size=5.9)
    for x, power in ((1.41, 48), (3.77, 58)):
        light("Blue hour through rear sash", "AREA", (x, 5.27, 1.92), power, (.25, .46, 1),
              target=(x - .68, 2.45, .67), size=.85, shadows=True)
    light("Late sky overhead of the rear wing", "AREA", (2.0, 6.38, 4.3), 410, (.24, .48, 1),
          target=(2.75, 8.3, 1.76), size=4.6)
    light("Light through the opposite pane", "AREA", (2.3, 8.00, 2.17), 8.2, (1, .49, .20),
          target=(2.3, 5.39, 1.50), size=.33)
    light("Diffused oil reflection above the table", "AREA", (2.07, 4.21, 1.34), 16, (1, .56, .30),
          target=(1.75, 3.68, .61), size=.78)
    light("Interior warm reflected light", "AREA", (0.00, 2.3, 2.48), 10, (.87, .66, .43),
          target=(2.60, 4.04, 1.46), size=2.3)


def old_camera(camera, index):
    progress = index / (round(6.8 * FPS) - 1)
    if progress < .38:
        blend = smoother(progress / .38)
        start, end = (.95, 4.70, -.24, .08, .98), (1.38, .65, -.02, .01, 1.03)
    elif progress < .72:
        blend = smoother((progress - .38) / .34)
        start, end = (1.38, .65, -.02, .01, 1.03), (.15, -1.65, .56, -.10, 1.06)
    else:
        blend = smoother((progress - .72) / .28)
        start, end = (.15, -1.65, .56, -.10, 1.06), (-1.05, -2.18, .78, -.24, 1.15)
    x, y_three, yaw, pitch, zoom = (a + (b - a) * blend for a, b in zip(start, end))
    direction = (math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch))
    set_camera(camera, (x, -y_three, 1.57), direction, zoom)


def smoother(t):
    return t ** 3 * (t * (6 * t - 15) + 10)


def interpolate(path, time):
    """Piecewise cubic camera path, with a continuous velocity at internal keys."""
    for k in range(len(path) - 1):
        start, a = path[k]
        finish, b = path[k + 1]
        if time > finish and k + 2 < len(path):
            continue
        prev, p = path[max(0, k - 1)]
        following, q = path[min(k + 2, len(path) - 1)]
        d = finish - start
        t = max(0, min(1, (time - start) / d))
        m0 = (b - p) * (d / (finish - prev)) if k > 0 else Vector((0,) * len(a))
        m1 = (q - a) * (d / (following - start)) if k + 2 < len(path) else Vector((0,) * len(a))
        return a * (2 * t ** 3 - 3 * t ** 2 + 1) + m0 * (t ** 3 - 2 * t ** 2 + t) + \
            b * (-2 * t ** 3 + 3 * t ** 2) + m1 * (t ** 3 - t ** 2)


def set_camera(camera, position, direction, zoom):
    camera.location = position
    camera.rotation_euler = Vector(direction).to_track_quat("-Z", "Y").to_euler()
    camera.data.lens = camera.data.sensor_height * zoom / (2 * math.tan(math.radians(61 / 2)))


def film_camera(camera, frame):
    path = (
        (0, Vector((.95, -4.67, 1.57, -.236, .078, .980))),
        (21, Vector((1.096, -3.57, 1.57, -.129, .039, 1.010))),
        (43, Vector((1.341, -1.59, 1.551, -.012, -.008, 1.029))),
        (66, Vector((1.366, .235, 1.538, .029, -.034, 1.046))),
        (91, Vector((1.232, 1.80, 1.475, .207, -.088, 1.072))),
        (117, Vector((1.148, 2.31, 1.45, .182, -.105, 1.075))),
    )
    x, y, z, yaw, pitch, zoom = interpolate(path, frame)
    z += math.sin(frame / FPS * 6.5) * .008 * math.sin(frame / (FRAMES - 1) * math.pi)
    direction = (math.sin(yaw) * math.cos(pitch), math.cos(yaw) * math.cos(pitch), math.sin(pitch))
    set_camera(camera, (x, y, z), direction, zoom)


def animate(scene, camera, hinges, porch, oil, flames):
    for index in range(FRAMES):
        frame = index + 1
        t = index / FPS
        film_camera(camera, index)
        camera.keyframe_insert("location", frame=frame)
        camera.keyframe_insert("rotation_euler", frame=frame)
        camera.data.keyframe_insert("lens", frame=frame)
        for pivot, side in hinges:
            easing = max(0, min(1, (index - 18 - 3 * side) / 64))
            pivot.rotation_euler.z = side * math.radians(65 + 13 * smoother(easing))
            pivot.keyframe_insert("rotation_euler", frame=frame)
        for j, (root, lamp, bounce, emission) in enumerate(porch):
            root.rotation_euler = (.029 * math.sin(2.8 * t + j), .022 * math.sin(2.12 * t + .8 + j), 0)
            root.keyframe_insert("rotation_euler", frame=frame)
            flicker = 1 + .035 * math.sin(7.2 * t + j) + .022 * math.sin(13.0 * t + 1 + j)
            lamp.data.energy = 15 * flicker
            lamp.data.keyframe_insert("energy", frame=frame)
            bounce.data.energy = 6.5 * flicker
            bounce.data.keyframe_insert("energy", frame=frame)
            emission.default_value = 1.85 * flicker
            emission.keyframe_insert("default_value", frame=frame)
        flicker = .063 * math.sin(9.4 * t) + .045 * math.sin(16.5 * t + .8) + .024 * math.sin(2.3 * t)
        oil.data.energy = 22 * (1 + flicker)
        oil.data.keyframe_insert("energy", frame=frame)
        for flame in flames:
            flame.scale = (1 + flicker * .55, 1 - flicker * .6, 1 + flicker)
            flame.location = (.0013 * math.sin(t * 8.7), .0007 * math.cos(t * 6.2), -.127 * flicker)
            flame.keyframe_insert("scale", frame=frame)
            flame.keyframe_insert("location", frame=frame)
    scene.frame_set(1)


def configure(scene, engine, samples, scale):
    if engine == "cycles":
        scene.render.engine = "CYCLES"
        scene.render.use_persistent_data = True
        cycles = scene.cycles
        cycles.device = "CPU"
        cycles.samples = samples
        cycles.use_denoising = True
        cycles.use_light_tree = False
        cycles.max_bounces = 3
        cycles.diffuse_bounces = 2
        cycles.glossy_bounces = 1
        cycles.transmission_bounces = 1
        cycles.transparent_max_bounces = 5
        cycles.volume_bounces = 0
        cycles.sample_clamp_indirect = 3.5
    else:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
        scene.eevee.taa_render_samples = samples
        scene.eevee.use_raytracing = False
        scene.eevee.use_fast_gi = False
        scene.eevee.shadow_pool_size = "128"
        scene.eevee.shadow_ray_count = 1
        scene.eevee.shadow_step_count = 5
        scene.eevee.shadow_resolution_scale = .75
    scene.render.resolution_x, scene.render.resolution_y = 1280, 720
    scene.render.resolution_percentage = scale
    scene.render.fps = FPS
    scene.render.fps_base = 1.0
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 18
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = -.06
    scene.frame_start, scene.frame_end = 1, FRAMES
    scene.use_nodes = True
    tree = scene.node_tree
    tree.nodes.clear()
    layers = tree.nodes.new("CompositorNodeRLayers")
    glare = tree.nodes.new("CompositorNodeGlare")
    glare.glare_type = "FOG_GLOW"
    glare.quality = "HIGH"
    glare.inputs["Threshold"].default_value = 1.8
    glare.inputs["Strength"].default_value = .19
    output = tree.nodes.new("CompositorNodeComposite")
    tree.links.new(layers.outputs["Image"], glare.inputs["Image"])
    tree.links.new(glare.outputs["Image"], output.inputs["Image"])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--stills", type=int, nargs="+")
    parser.add_argument("--reference", type=int, nargs="+")
    parser.add_argument("--engine", choices=("cycles", "eevee"), default="cycles")
    parser.add_argument("--samples", type=int, default=4)
    parser.add_argument("--scale", type=int, default=100)
    parser.add_argument("--blend", type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    out = args.output.resolve()
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    rng = Random(SEED)
    scene = bpy.context.scene
    import_hall()
    lime = plaster()
    mortar = stone("Damp grey mortar", (.099, .115, .119), .82)
    brick_variants = [stone(f"Fired grey masonry {i}", c, .79) for i, c in enumerate((
        (.084, .104, .112), (.120, .133, .135), (.102, .113, .121), (.099, .103, .099), (.145, .148, .143),
    ))]
    slate = stone("Steps · fine blue sandstone", (.18, .193, .187), .68)
    old_wood = wood("Deep brown casing, grain along beam", 0)
    vertical = wood("Worn oxblood lacquer, grain up stile", 2, red=True)
    horizontal = wood("Worn oxblood lacquer, grain along rail", 0, red=True)
    panel = wood("Reddish aged panel, grain up board", 2, red=True)
    iron = patina("Hand forged iron and oxide", (.064, .068, .063), .40)
    brass = patina("Bronze wear at fingers and pins", (.28, .154, .062), .36)
    architecture(rng, (lime, old_wood, brick_variants, mortar))
    hinges = door(vertical, horizontal, panel, iron, brass, slate)
    windows(vertical, horizontal, slate)
    porch = [porch_lamp(i + 1, x, vertical, horizontal, iron) for i, x in enumerate((.18, 2.62))]
    oil, flames = room_furnishings()
    cinema_lighting()

    camera = bpy.data.objects.new("Opening tracking camera", bpy.data.cameras.new("Opening camera"))
    bpy.context.collection.objects.link(camera)
    camera.data.sensor_fit = "VERTICAL"
    camera.data.sensor_height = 24
    camera.data.clip_start, camera.data.clip_end = .045, 95
    scene.camera = camera
    configure(scene, args.engine, args.samples, args.scale)
    animate(scene, camera, hinges, porch, oil, flames)

    if args.blend:
        scene.render.filepath = str(out / "hall-")
        bpy.context.preferences.filepaths.save_version = 0
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(args.blend.resolve()), relative_remap=False)

    if args.stills:
        for frame in args.stills:
            scene.frame_set(frame)
            scene.render.filepath = str(out / f"hall-{frame:04}.png")
            bpy.ops.render.render(write_still=True)
    if args.reference:
        matched = bpy.data.objects.new("Fixed original camera", camera.data.copy())
        matched.data.animation_data_clear()
        bpy.context.collection.objects.link(matched)
        scene.camera = matched
        for frame in args.reference:
            scene.frame_set(1)
            old_camera(matched, frame)
            scene.render.filepath = str(out / f"reference-{frame:03}.png")
            bpy.ops.render.render(write_still=True)
    if not (args.stills or args.reference):
        scene.render.filepath = str(out / "hall-")
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()

