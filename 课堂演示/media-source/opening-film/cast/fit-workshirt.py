"""Blender 4.5 + MPFB 2.0.18：从官方试衣裁片生成片头专用的已绑定上衣。"""
import sys
from pathlib import Path
import bmesh
import bpy
from bl_ext.user_default.mpfb.services.humanservice import HumanService

folder, target = (Path(arg).resolve() for arg in sys.argv[sys.argv.index("--") + 1:])
body = HumanService.create_human()
rig = HumanService.add_builtin_rig(body, "game_engine")
ob = HumanService.add_mhclo_asset(str(folder / "male_casualsuit03.mhclo"), body,
                                  subdiv_levels=0, material_type="NONE")
mesh = bmesh.new()
mesh.from_mesh(ob.data)
foot = min(mesh.verts, key=lambda v: v.co.z)
island = {foot}
queue = [foot]
while queue:
    v = queue.pop()
    for edge in v.link_edges:
        other = edge.other_vert(v)
        if other not in island:
            island.add(other)
            queue.append(other)
assert len(island) == 886
bmesh.ops.delete(mesh, geom=list(island), context="VERTS")
for vertex in mesh.verts:
    x, y, z = vertex.co
    # 放出近腰的衣摆，与现有长裤叠搭；袖长、肩宽和原绑定保持配套。
    if abs(x) < .24 and z < 1.02:
        weight = min(1, (1.02 - z) / .17)
        vertex.co.z -= .064 * weight
        vertex.co.x *= 1 + .05 * weight
for face in mesh.faces:
    face.smooth = True
mesh.to_mesh(ob.data)
mesh.free()
ob.name = "片头 · 裁片上衣"
mat = bpy.data.materials.new("上衣 · 裁片褶皱")
mat.use_nodes = True
shader = next(n for n in mat.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
def texture(name, space):
    node = mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image = bpy.data.images.load(str(folder / name))
    node.image.colorspace_settings.name = space
    return node.outputs[0]
normal = mat.node_tree.nodes.new("ShaderNodeNormalMap")
normal.inputs["Strength"].default_value = .85
mat.node_tree.links.new(texture("workshirt-normal.jpg", "Non-Color"), normal.inputs["Color"])
mat.node_tree.links.new(normal.outputs[0], shader.inputs["Normal"])
mat.node_tree.links.new(texture("workshirt-shading.jpg", "sRGB"), shader.inputs["Base Color"])
shader.inputs["Roughness"].default_value = .85
ob.data.materials.clear()
ob.data.materials.append(mat)
for face in ob.data.polygons:
    face.material_index = 0
bpy.ops.object.select_all(action="DESELECT")
rig.select_set(True)
ob.select_set(True)
bpy.context.view_layer.objects.active = rig
bpy.ops.export_scene.gltf(filepath=str(target), export_format="GLB", use_selection=True, export_animations=False)
