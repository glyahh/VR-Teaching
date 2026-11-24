"""轻量网格制作工具。坐标沿用课件的 Y 向上、单位米。"""

from mathutils import Vector
import bpy


def blender_point(p):
    return (p[0], -p[2], p[1])


def surface(name, color, roughness, paths=None, *, normal_strength=0.45, metal=0, backface_culling=True):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_backface_culling = backface_culling
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metal
    for channel, file in (paths or {}).items():
        ink = nodes.new("ShaderNodeTexImage")
        ink.image = bpy.data.images.load(str(file), check_existing=(channel == "Base Color"))
        if channel != "Base Color":
            ink.image.colorspace_settings.name = "Non-Color"
        if channel == "Normal":
            bump = nodes.new("ShaderNodeNormalMap")
            bump.inputs["Strength"].default_value = normal_strength
            links.new(ink.outputs["Color"], bump.inputs["Color"])
            links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
        else:
            links.new(ink.outputs["Color"], bsdf.inputs[channel])
    return mat


def maps(folder, stem):
    return {channel: folder / f"{stem}{suffix}.jpg" for channel, suffix in
            (("Base Color", ""), ("Normal", "-normal"), ("Roughness", "-rough"))}


class Parts:
    def __init__(self, material, meters=1.4):
        self.material = material
        self.meters = meters
        self.positions, self.faces, self.uvs = [], [], []

    def mesh(self, positions, faces, uv=None):
        start = len(self.positions)
        self.positions.extend(positions)
        for face in faces:
            self.faces.append(tuple(start + i for i in face))
            if uv:
                self.uvs.extend(uv(positions[i]) for i in face)
            else:
                a, b, c = (Vector(positions[i]) for i in face[:3])
                n = (b - a).cross(c - b)
                axis = max(range(3), key=lambda i: abs(n[i]))
                u, v = ((2, 1), (0, 2), (0, 1))[axis]
                if axis == 2 and n.z < 0:
                    self.uvs.extend((-positions[i][u] / self.meters, positions[i][v] / self.meters) for i in face)
                else:
                    self.uvs.extend((positions[i][u] / self.meters, positions[i][v] / self.meters) for i in face)

    def prism(self, rings, uv=None):
        count = len(rings[0])
        last = count * (len(rings) - 1)
        faces = [tuple(range(count)), tuple(reversed(range(last, last + count)))]
        for k in range(last // count):
            for j in range(count):
                a, b = k * count + j, k * count + (j + 1) % count
                faces.append((b, a, a + count, b + count))
        self.mesh([p for ring in rings for p in ring], faces, uv)

    def block(self, center, size, edge=0.005, uv=None, transform=None):
        x, y, z = center
        w, h, d = (v / 2 for v in size)
        edge = min(edge, w * 0.3, h * 0.3, d * 0.3)
        outline = [(-w + edge, -d), (w - edge, -d), (w, -d + edge), (w, d - edge),
                   (w - edge, d), (-w + edge, d), (-w, d - edge), (-w, -d + edge)]
        rings = []
        for height, inset in ((-h, edge * 0.6), (-h + edge * 0.65, 0),
                              (h - edge, 0), (h, edge * 0.6)):
            ring = [(x + u * (w - inset) / w, y + height, z + v * (d - inset) / d) for u, v in outline]
            rings.append([transform(p) for p in ring] if transform else ring)
        self.prism(rings, uv)

    def object(self, name, *, smooth=False):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([blender_point(p) for p in self.positions], [], self.faces)
        mesh.materials.append(self.material)
        uv = mesh.uv_layers.new(name="UVMap")
        uv.data.foreach_set("uv", [v for item in self.uvs for v in item])
        if smooth:
            for polygon in mesh.polygons:
                polygon.use_smooth = True
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        bpy.context.collection.objects.link(obj)
        return obj


def save_and_export(name, out, editable, *, selection=None):
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.file.pack_all()
    bpy.ops.wm.save_as_mainfile(filepath=str(editable / (name + ".blend")))
    if selection is not None:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in selection:
            obj.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(out / (name + ".glb")), export_format="GLB",
                            use_selection=selection is not None, export_yup=True)
