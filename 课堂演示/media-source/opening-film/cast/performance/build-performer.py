"""Fit MakeHuman's original body, shirt, trousers, shoes, hair and eyes to one rest skeleton."""
import argparse
import gzip
import math
import sys
from pathlib import Path

import bmesh
import bpy
from bl_ext.user_default.mpfb.services.humanservice import HumanService


def material(name, color=None, normal=None, roughness=.82, alpha=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    tree = mat.node_tree
    shader = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    shader.inputs["Roughness"].default_value = roughness
    def image(path, space):
        tex = tree.nodes.new("ShaderNodeTexImage")
        tex.image = bpy.data.images.load(str(path), check_existing=True)
        tex.image.colorspace_settings.name = space
        return tex
    if color:
        tex = image(color, "sRGB")
        tree.links.new(tex.outputs["Color"], shader.inputs["Base Color"])
        if alpha:
            tree.links.new(tex.outputs["Alpha"], shader.inputs["Alpha"])
    if normal:
        bump = tree.nodes.new("ShaderNodeNormalMap")
        tree.links.new(image(normal, "Non-Color").outputs["Color"], bump.inputs["Color"])
        tree.links.new(bump.outputs["Normal"], shader.inputs["Normal"])
    return mat


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for face in obj.data.polygons:
        face.material_index = 0
        face.use_smooth = True


def edit_mesh(obj, callback):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    callback(bm)
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


def connected(start):
    vertices = {start}
    pending = [start]
    while pending:
        vertex = pending.pop()
        for edge in vertex.link_edges:
            other = edge.other_vert(vertex)
            if other not in vertices:
                vertices.add(other)
                pending.append(other)
    return vertices


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pack", type=Path)
    parser.add_argument("textures", type=Path)
    parser.add_argument("course", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--targets",type=Path,required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    pack, txt = args.pack.resolve(), args.textures.resolve()
    body = HumanService.create_human()
    rig = HumanService.add_builtin_rig(body, "game_engine")
    rig.name = "片头演员 · 变形骨架"
    def fit(rel, kind):
        return HumanService.add_mhclo_asset(str(pack / rel), body, asset_type=kind,
                                            subdiv_levels=0, material_type="NONE")
    full = fit("clothes/male_casualsuit03/male_casualsuit03.mhclo", "Clothes")
    shoe = fit("clothes/shoes04/shoes04.mhclo", "Clothes")
    hair = fit("hair/short01/short01.mhclo", "Hair")
    eyes = fit("eyes/high-poly/high-poly.mhclo", "Eyes")
    brow = fit("eyebrows/eyebrow007/eyebrow007.mhclo", "Eyebrows")
    # Keep the artist's original head, arms and individually weighted fingers, including the covered body.
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    for mod in list(body.modifiers):
        if mod.type == "MASK":
            body.modifiers.remove(mod)
    keep = body.vertex_groups["body"].index
    def body_topology(bm):
        weights = bm.verts.layers.deform.active
        ids = bm.verts.layers.int.new("source_vertex")
        for v in bm.verts:
            v[ids]=v.index
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if keep not in v[weights]], context="VERTS")
    edit_mesh(body, body_topology)
    body.name = "头颈与手 · MPFB 原拓扑全身"
    assign(body, material("肤色 · 人体原始UV",txt/"skin-young.jpg",roughness=.64))
    covered=material("衣内人体 · 裁片原遮罩")
    shader=next(n for n in covered.node_tree.nodes if n.type=="BSDF_PRINCIPLED")
    shader.inputs["Alpha"].default_value=0
    covered.diffuse_color=(.20,.095,.057,0)
    body.data.materials.append(covered)
    groups={group.index for group in body.vertex_groups if group.name.startswith(("Delete.male_casual","Delete.shoes"))}
    interior={v.index for v in body.data.vertices if any(g.group in groups and g.weight>.5 for g in v.groups)
              or v.co.z<.085}
    for face in body.data.polygons:
        if all(i in interior for i in face.vertices):
            face.material_index=1
    # Subsurface geometry inside opaque clothing is retained for articulation checks.
    # Contract only the covered cross-section. Wrists and exposed fingers keep their original surface.
    for v in body.data.vertices:
        x,y,z = v.co
        if z < .12:
            v.co.z += .007
        elif .76 < z < 1.42 and abs(x) < .24:
            fade = min(1, (z-.76)/.06, (1.42-z)/.04)
            v.co.y = y*(1-.13*fade)
            v.co.x = x*(1-.045*fade)
    # These are artist-authored MakeHuman morphs in the original source vertex order.
    ids=body.data.attributes["source_vertex"].data
    index_map={tag.value:i for i,tag in enumerate(ids)}
    from mathutils import Vector
    def sculpt(points, target, strength):
        path=args.targets/(target+".target.gz")
        for line in gzip.open(path,mode="rt",encoding="utf-8"):
            fields=line.split()
            if len(fields)!=4 or not fields[0].isdigit():continue
            index=index_map.get(int(fields[0]))
            if index is not None:
                x,y,z=map(float,fields[1:])
                points[index].co += Vector((x,-z,y))*(.1*strength)
    sculpt(body.data.vertices,"chin/chin-bones-incr",.49)
    sculpt(body.data.vertices,"chin/chin-width-incr",.33)
    body.shape_key_add(name="Basis")
    mature=body.shape_key_add(name="面颊与下颌")
    sculpt(mature.data,"chin/chin-prominent-incr",.50)
    for side in ("l","r"):
        sculpt(mature.data,"cheek/"+side+"-cheek-volume-decr",.58)
        sculpt(mature.data,"cheek/"+side+"-cheek-bones-incr",.48)
    pants = full.copy()
    pants.data = full.data.copy()
    bpy.context.collection.objects.link(pants)
    def keep_cloth(bm, trousers):
        leg = connected(min(bm.verts, key=lambda v:v.co.z))
        bmesh.ops.delete(bm, geom=list(set(bm.verts)-leg if trousers else leg), context="VERTS")
        for v in bm.verts:
            x,y,z = v.co
            if not trousers and abs(x)<.25 and z<1.02:
                weight = min(1,(1.02-z)/.17)
                v.co.z -= .066*weight
                v.co.x *= 1+.08*weight
            if trousers:
                # Looser legs under the work shirt, tapering into the cloth shoe.
                leg_x = rig.data.bones["foot_l" if x>0 else "foot_r"].head_local.x
                gain = .13 * max(0,min(1,(.81-z)/.15,(z-.085)/.12))
                v.co.x += (x-leg_x)*gain
                v.co.y *= 1+gain
    edit_mesh(full,lambda m:keep_cloth(m,False))
    edit_mesh(pants,lambda m:keep_cloth(m,True))
    full.name = "斜袖与立领上衣 · 实裁前后片"
    pants.name = "长裤 · 膝褶与松紧裤口"
    assign(full, material("上衣 · 裁片褶皱",txt/"workshirt-shading.jpg",txt/"workshirt-normal.jpg"))
    assign(pants, material("长裤 · 粗布裁片",txt/"workshirt-shading.jpg",txt/"workshirt-normal.jpg"))
    shoe.name = "鞋底 · 布面与鞋楦"
    floor = min(v.co.z for v in shoe.data.vertices)
    for v in shoe.data.vertices:
        v.co.z -= floor - .0007
    assign(shoe,material("旧鞋 · 布鞋",txt/"shoe.jpg",txt/"shoe-n.jpg"))
    hair.name = "短发 · 分束发际"
    assign(hair,material("原装 · 短发",txt/"hair.png",roughness=.77,alpha=True))
    eyes.name = "眼球 · 双眼"
    assign(eyes,material("原装 · 虹膜",txt/"eye.png",roughness=.36,alpha=True))
    brow.name="眉毛 · 毛流"
    assign(brow,material("原装 · 眉毛",txt/"brows.png",roughness=.83,alpha=True))
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(args.course / "assets/yudu-river/river-people.glb"))
    imported = set(bpy.data.objects)-before
    cap = next(o for o in imported if o.type=="MESH" and o.name.startswith("布帽"))
    cap.parent = rig
    for mod in cap.modifiers:
        if mod.type == "ARMATURE":
            mod.object=rig
    for ob in [body, full, pants, shoe, hair, eyes, brow, cap]:
        if not ob.vertex_groups:
            group=ob.vertex_groups.new(name="head")
            group.add(list(range(len(ob.data.vertices))),1,"REPLACE")
        for m in ob.modifiers:
            if m.type=="ARMATURE":
                m.use_deform_preserve_volume=True
        print("PERFORMER",ob.name,len(ob.data.vertices),len(ob.data.polygons),
              ob.parent.name if ob.parent else None,flush=True)
    bpy.ops.object.select_all(action="DESELECT")
    for ob in (rig, body, full, pants, shoe, hair, eyes, brow, cap):
        ob.select_set(True)
    bpy.context.view_layer.objects.active=rig
    bpy.ops.export_scene.gltf(filepath=str(args.output.resolve()), export_format="GLB", use_selection=True,
                              export_animations=False, export_all_influences=True)


if __name__ == "__main__":
    main()
