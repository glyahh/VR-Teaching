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

for name in ("wood-color.jpg", "wood-normal.jpg", "plaster-color.jpg", "plaster-normal.jpg"):
    image = bpy.data.images[name]
    (output / name).write_bytes(image.packed_file.data)

bpy.ops.object.select_all(action="DESELECT")
for obj in selected:
    obj.select_set(True)

bpy.ops.export_scene.gltf(
    filepath=str(output / "furniture.glb"),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_image_format="JPEG",
    export_jpeg_quality=82,
)
