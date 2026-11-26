"""Tailor the source MPFB work coat for the close view of the crossing."""

import math

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from river import mesh_object, smoothstep, wet_cloth


def fit_cap(hat, head):
    """Seat the cloth crown just outside the actual forehead in bind pose."""
    skin = head.data
    faces = [p.vertices[:] for p in skin.polygons if all(skin.vertices[i].co.z > 1.53 for i in p.vertices)]
    surface = BVHTree.FromPolygons([v.co for v in skin.vertices], faces)
    for vertex in hat.data.vertices:
        x, y, z = vertex.co
        radial = Vector((x, y + .035, 0))
        if y > -.044 or radial.length < .018:
            continue
        direction = radial.normalized()
        distances = []
        for height in (z-.006, z, z+.006):
            hit, _, _, depth = surface.ray_cast(Vector((0,-.035,height)), direction, .160)
            if hit is not None:
                distances.append(depth)
        if distances:
            clearance = .007 if z < 1.634 else .004
            vertex.co += direction * max(0.0, max(distances) + clearance - radial.length)
    hat.data.update()


def attach(obj, rig, weights):
    obj.parent = rig
    groups = {}
    for index, influences in enumerate(weights):
        for name, factor in influences:
            if factor <= 0:
                continue
            if name not in groups:
                groups[name] = obj.vertex_groups.new(name=name)
            groups[name].add([index], factor, "REPLACE")
    deform = obj.modifiers.new("布料随人体骨骼蒙皮", "ARMATURE")
    deform.object = rig
    deform.use_deform_preserve_volume = True
    return obj


def cloth_model(name, rgb):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    wet_cloth(material, rgb, False)
    return material


def strip_sleeves(obj):
    source = bmesh.new()
    source.from_mesh(obj.data)
    weights = source.verts.layers.deform.active
    arm_groups = {group.index for group in obj.vertex_groups
                  if group.name.startswith(("upperarm_", "lowerarm_", "hand_"))}
    remove = [vertex for vertex in source.verts if arm_groups.intersection(vertex[weights].keys())]
    bmesh.ops.delete(source, geom=remove, context="VERTS")
    source.to_mesh(obj.data)
    source.free()
    obj.data.update()


def sleeve(side, rig, material, cuffs):
    """A continuous sleeve starts inside the chest and ends past the wrist joint."""
    upper = f"upperarm_{side}"
    fore = f"lowerarm_{side}"
    hand = f"hand_{side}"
    shoulder = rig.data.bones[upper].head_local
    elbow = rig.data.bones[fore].head_local
    wrist = rig.data.bones[hand].head_local
    p = (elbow - shoulder).normalized()
    q = (wrist - elbow).normalized()
    bend = (p + q).normalized()
    profiles = [
        (shoulder - 0.091 * p, p, 0.063, 0.078, [("spine_03", 1)]),
        (shoulder - 0.052 * p, p, 0.075, 0.084, [("spine_03", 0.86), (upper, 0.14)]),
        (shoulder - 0.022 * p, p, 0.078, 0.084, [("spine_03", 0.63), (upper, 0.37)]),
        (shoulder + 0.018 * p, p, 0.077, 0.078, [("spine_03", 0.30), (upper, 0.70)]),
        (shoulder + 0.057 * p, p, 0.069, 0.069, [(upper, 1)]),
        (shoulder + 0.105 * p, p, 0.064, 0.061, [(upper, 1)]),
        (shoulder + 0.149 * p, p, 0.058, 0.056, [(upper, 1)]),
        (elbow - 0.047 * p, p, 0.055, 0.055, [(upper, 0.90), (fore, 0.10)]),
        (elbow - 0.019 * p, bend, 0.056, 0.056, [(upper, 0.72), (fore, 0.28)]),
        (elbow + 0.008 * q, bend, 0.057, 0.052, [(upper, 0.45), (fore, 0.55)]),
        (elbow + 0.039 * q, q, 0.055, 0.052, [(upper, 0.18), (fore, 0.82)]),
        (elbow + 0.074 * q, q, 0.053, 0.051, [(fore, 1)]),
        (elbow + 0.118 * q, q, 0.049, 0.046, [(fore, 1)]),
        (wrist - 0.057 * q, q, 0.044, 0.042, [(fore, 1)]),
        (wrist - 0.027 * q, q, 0.040, 0.038, [(fore, 1)]),
        (wrist + 0.009 * q, q, 0.035, 0.034, [(fore, 0.81), (hand, 0.19)]),
    ]

    def tube(name, samples, sleeve_material):
        vertices, faces, weights = [], [], []
        ring_size = 22
        for j, (center, axis, r1, r2, influences) in enumerate(samples):
            u = axis.cross(Vector((0, 0, 1))).normalized()
            v = axis.cross(u)
            for i in range(ring_size):
                a = math.tau * i / ring_size
                crease = 1 + 0.073 * math.sin(5 * a + j * 1.35) + 0.030 * math.sin(3 * a - j * 2.8)
                vertices.append(center + crease * (r1 * math.cos(a) * u + r2 * math.sin(a) * v))
                weights.append(influences)
                if j + 1 < len(samples):
                    base = j * ring_size + i
                    following = j * ring_size + (i + 1) % ring_size
                    faces.append((base, following, following + ring_size, base + ring_size))
        return attach(mesh_object(name, vertices, faces, sleeve_material), rig, weights)

    main = tube(f"粗呢连肩袖 · {side}", profiles, material)
    main_subdiv = main.modifiers.new("折褶面圆顺", "SUBSURF")
    main_subdiv.levels = main_subdiv.render_levels = 1
    cuff_rings = [
        (wrist + q * offset, q, width, depth, [(fore, 1 - follow), (hand, follow)])
        for offset, width, depth, follow in [(-.034, .041, .040, 0), (-.026, .044, .042, 0),
              (-.010, .041, .040, 0.07), (.007, .038, .036, 0.14), (.013, .035, .032, 0.23)]
    ]
    cuff = tube(f"翻折袖口 · {side}", cuff_rings, cuffs)
    cuff.modifiers.new("袖口内外层", "SOLIDIFY").thickness = 0.0021
    return main, cuff


def refine(rig, meshes):
    parts = {obj.data.materials[0].name.split(" · ")[0]: obj for obj in meshes}
    if "布帽" in parts:
        fit_cap(parts["布帽"], parts["肤色"])
    body = parts["上衣"]
    trim = next(obj for obj in meshes if obj.data.materials[0].name.startswith("布领"))
    strip_sleeves(body)
    strip_sleeves(trim)
    cuff_material = cloth_model("双翻袖口粗布", (0.089, 0.083, 0.067))
    sleeve_material = body.data.materials[0].copy()
    sleeve_material.name = "上衣 · 连肩粗布"
    tree = sleeve_material.node_tree
    for shader in [n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"]:
        for linked in list(shader.inputs["Normal"].links):
            tree.links.remove(linked)
    for side in ("l", "r"):
        meshes.extend(sleeve(side, rig, sleeve_material, cuff_material))
    return meshes
