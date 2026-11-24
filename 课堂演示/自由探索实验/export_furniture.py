"""从精修工程导出桌、座椅、提灯与册页。只修改 Blender 当前进程中的副本。"""

from pathlib import Path
import sys

import bpy


output = Path(sys.argv[sys.argv.index("--") + 1])
output.mkdir(parents=True, exist_ok=True)
old_folio_parts = set(bpy.data.objects["线装手记"].children_recursive)
selected = [
    obj for group in bpy.context.scene.collection.children
    if group.name[:2] in {"02", "03", "04", "05"}
    for obj in group.all_objects if obj not in old_folio_parts
]
materials = {slot.material for obj in selected for slot in obj.material_slots if slot.material}

# Cycles 的污痕、噪声和混合节点在这里换成同源扫描贴图。
for name, diffuse in (
    ("旧木 · 磨亮桌面", "surface-color.jpg"),
    ("旧木 · 深色桌架", "wood-color.jpg"),
):
    material = bpy.data.materials[name]
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    surface = nodes.get("Principled BSDF")
    for socket_name in ("Base Color", "Roughness"):
        socket = surface.inputs[socket_name]
        for link in tuple(socket.links):
            links.remove(link)
    color_node = next(node for node in nodes if node.type == "TEX_IMAGE" and node.image.name == diffuse)
    links.new(color_node.outputs["Color"], surface.inputs["Base Color"])
    surface.inputs["Roughness"].default_value = 0.72

for material in materials:
    if material.name in {"旧木 · 磨亮桌面", "旧木 · 深色桌架"}:
        continue
    if material.name == "灯罩 · 微浑薄玻璃":
        surface = material.node_tree.nodes.get("Principled BSDF")
        target = material.node_tree.nodes.get("Material Output").inputs["Surface"]
        material.node_tree.links.new(surface.outputs["BSDF"], target)
        surface.inputs["Transmission Weight"].default_value = 0
        continue
    surface = material.node_tree.nodes.get("Principled BSDF") if material.use_nodes else None
    if surface and surface.inputs["Base Color"].is_linked:
        socket = surface.inputs["Base Color"]
        if socket.links[0].from_node.type == "VALTORGB":
            # 保留原色调的中间值，让灯架、瓷釉等程序材质可输出到 glTF。
            link = socket.links[0]
            tint = link.from_node.color_ramp.evaluate(0.48)
            material.node_tree.links.remove(link)
            socket.default_value = tint

for original, stable in {
    "线装手记": "notebook",
    "薄壁玻璃灯罩": "lamp-glass",
}.items():
    bpy.data.objects[original].name = stable

for material in materials:
    if material.name not in {"灯罩 · 微浑薄玻璃", "棉布 · 靛灰"}:
        material.use_backface_culling = True


def select_only(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_viewport = False
        obj.hide_set(False)
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]


def clear_parent(objects):
    if not objects:
        return
    select_only(objects)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")


def to_mesh(obj):
    if obj.type not in {"MESH", "CURVE", "SURFACE"}:
        return False
    select_only([obj])
    if obj.type != "MESH":
        bpy.ops.object.convert(target="MESH")
    else:
        for mod in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=mod.name)
    return True


def decimate_to(obj, target_tris):
    obj.data.validate(verbose=False)
    obj.data.calc_loop_triangles()
    count = len(obj.data.loop_triangles)
    if count <= target_tris:
        return
    select_only([obj])
    mod = obj.modifiers.new("Furniture budget", "DECIMATE")
    mod.ratio = max(0.004, target_tris / count)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.validate(verbose=False)


def join_group(objects, name, parent=None):
    if not objects:
        return None
    clear_parent(objects)
    if len(objects) > 1:
        select_only(objects)
        bpy.ops.object.join()
    merged = bpy.context.view_layer.objects.active if len(objects) > 1 else objects[0]
    merged.name = name
    if parent is not None:
        matrix = merged.matrix_world.copy()
        merged.parent = parent
        merged.matrix_world = matrix
    return merged


# 1) 精简不可交互的牛皮纸封卷与扎绳（压至 < 5k 面），保留「牛皮纸封卷」节点供 deskShot 定位。
dossier = bpy.data.objects["牛皮纸封卷"]
lamp_glass = bpy.data.objects["lamp-glass"]
clear_parent([lamp_glass])
preserve_names = {"notebook", "lamp-glass", "牛皮纸封卷"}
dossier_set = set(dossier.children_recursive)
dossier_children = [obj for obj in selected if obj in dossier_set]
other_objects = [obj for obj in selected if obj.name not in preserve_names and obj not in dossier_set]
dossier_parts = []
rope_parts = []
cover_parts = []
edge_parts = []
for obj in dossier_children:
    if not to_mesh(obj):
        continue
    if "麻绳" in obj.name or "线头" in obj.name or "活结" in obj.name:
        rope_parts.append(obj)
    elif "封面" in obj.name:
        cover_parts.append(obj)
    else:
        edge_parts.append(obj)

if rope_parts:
    merged_rope = join_group(rope_parts, "牛皮纸封卷 · 扎绳合批", dossier)
    decimate_to(merged_rope, 1800)
    dossier_parts.append(merged_rope)
if cover_parts:
    merged_cover = join_group(cover_parts, "牛皮纸封卷 · 封面合批", dossier)
    decimate_to(merged_cover, 1200)
    dossier_parts.append(merged_cover)
if edge_parts:
    merged_edges = join_group(edge_parts, "牛皮纸封卷 · 书口合批", dossier)
    decimate_to(merged_edges, 1400)
    dossier_parts.append(merged_edges)

# 2) 其余静态家具按单材质合批以压低 DrawCall，保留 notebook 与 lamp-glass 原对象。
by_material = {}
keep_objects = [bpy.data.objects["notebook"], lamp_glass, dossier, *dossier_parts]
for obj in other_objects:
    if not to_mesh(obj):
        continue
    mats = [slot.material for slot in obj.material_slots if slot.material]
    if len(mats) == 1:
        by_material.setdefault(mats[0].name, []).append(obj)
    else:
        clear_parent([obj])
        keep_objects.append(obj)

for mat_name, group in by_material.items():
    merged = join_group(group, f"家具合批 · {mat_name}")
    if merged is not None:
        keep_objects.append(merged)

for name in ("wood-color.jpg", "wood-normal.jpg", "plaster-color.jpg", "plaster-normal.jpg"):
    image = bpy.data.images[name]
    (output / name).write_bytes(image.packed_file.data)

select_only(keep_objects)

bpy.ops.export_scene.gltf(
    filepath=str(output / "furniture.glb"),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_image_format="JPEG",
    export_jpeg_quality=82,
)
