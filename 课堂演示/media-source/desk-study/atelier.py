"""以米为单位的场景几何与材质。"""

import math
from pathlib import Path

import bpy
from mathutils import Vector


def collection(name):
    group = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(group)
    return group


def move_to(obj, group):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    group.objects.link(obj)
    return obj


def empty(group, name, position, yaw=0):
    obj = bpy.data.objects.new(name, None)
    group.objects.link(obj)
    obj.empty_display_size = .024
    obj.location = position
    obj.rotation_euler.z = math.radians(yaw)
    return obj


def mesh(group, name, vertices, faces, materials, parent=None):
    shape = bpy.data.meshes.new(name)
    shape.from_pydata(vertices, [], faces)
    shape.update()
    obj = bpy.data.objects.new(name, shape)
    group.objects.link(obj)
    obj.parent = parent
    for material in materials:
        shape.materials.append(material)
    return obj


def bevel(obj, amount, segments=3):
    mod = obj.modifiers.new("边缘磨圆", "BEVEL")
    mod.width = amount
    mod.segments = segments
    mod.limit_method = "ANGLE"
    mod.angle_limit = .48
    mod.harden_normals = True
    weighted = obj.modifiers.new("平面法线", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True


def planar_uv(obj, scale=1.0, offset=(.5,.5), vertical=False):
    shape = obj.data
    uv_map = shape.uv_layers.new(name="米制纹理").data
    for poly in shape.polygons:
        normal = poly.normal
        axis = max(range(3), key=lambda index: abs(normal[index]))
        for loop in poly.loop_indices:
            point = shape.vertices[shape.loops[loop].vertex_index].co
            if axis == 2:
                first, second = point.x, point.y
            elif axis == 1:
                first, second = (point.z, point.x) if vertical else (point.x,point.z)
            else:
                first, second = (point.z,point.y) if vertical else (point.y,point.z)
            uv_map[loop].uv = (offset[0]+first*scale,offset[1]+second*scale)


def box(group, name, center, size, material, rounding=0, parent=None, vertical=False):
    half_width, half_depth, half_height = [value/2 for value in size]
    vertices = [(side*half_width,back*half_depth,up*half_height)
                for up in (-1,1) for side,back in ((-1,-1),(1,-1),(1,1),(-1,1))]
    faces = [(3,2,1,0),(4,5,6,7),(0,1,5,4),(1,2,6,5),(2,3,7,6),(3,0,4,7)]
    obj = mesh(group,name,vertices,faces,[material],parent)
    obj.location = center
    planar_uv(obj,.82,(.47+center[0]*.37,.49+center[2]*.43),vertical)
    if rounding:
        bevel(obj,rounding)
    return obj


def lathe(group, name, rings, materials, parent=None, *, center=(0,0,0), segments=96, deform=None, assign=None):
    vertices, faces = [], []
    for ring_index, (height, radius) in enumerate(rings):
        for index in range(segments):
            angle=math.tau*index/segments
            actual_radius, elevation = deform(height,radius,angle) if deform else (radius,height)
            vertices.append((actual_radius*math.cos(angle),actual_radius*math.sin(angle),elevation))
    for ring_index in range(len(rings)-1):
        for index in range(segments):
            adjacent=(index+1)%segments
            base=ring_index*segments
            faces.append((base+index,base+adjacent,base+segments+adjacent,base+segments+index))
    faces.extend([tuple(reversed(range(segments))),tuple(range((len(rings)-1)*segments,len(rings)*segments))])
    obj=mesh(group,name,vertices,faces,materials,parent)
    obj.location=center
    for index,poly in enumerate(obj.data.polygons[:-2]):
        poly.use_smooth=True
        if assign:
            poly.material_index = assign(index//segments, math.tau*(index%segments)/segments)
    return obj


def wire(group,name,points,radius,material,parent=None,*,smooth=False,closed=False):
    curve=bpy.data.curves.new(name,"CURVE")
    curve.dimensions="3D"
    curve.resolution_u=10
    curve.bevel_depth=radius
    curve.bevel_resolution=2
    curve.use_fill_caps=True
    if smooth:
        spline=curve.splines.new("BEZIER")
        spline.bezier_points.add(len(points)-1)
        for handle,point in zip(spline.bezier_points,points):
            handle.co=point
            handle.handle_left_type=handle.handle_right_type="AUTO"
    else:
        spline=curve.splines.new("POLY")
        spline.points.add(len(points)-1)
        for handle,point in zip(spline.points,points):
            handle.co=(*point,1)
    spline.use_cyclic_u=closed
    obj=bpy.data.objects.new(name,curve)
    group.objects.link(obj)
    obj.parent=parent
    curve.materials.append(material)
    return obj


def cord(group,name,points,radius,materials,parent):
    knots=[Vector(pt) for pt in points]
    samples=[knots[0]]
    for start,end in zip(knots,knots[1:]):
        divisions=max(1,math.ceil((end-start).length/.00085))
        samples.extend(start.lerp(end,index/divisions) for index in range(1,divisions+1))
    shifted=[[],[],[]]
    travelled=0.0
    first_axis=Vector((0,0,1))
    for index,position in enumerate(samples):
        tangent=(samples[min(index+1,len(samples)-1)]-samples[max(index-1,0)]).normalized()
        if index:
            travelled+=(position-samples[index-1]).length
        first_axis=first_axis-tangent*first_axis.dot(tangent)
        if first_axis.length<.001:
            first_axis=tangent.orthogonal()
        first_axis.normalize()
        other_axis=tangent.cross(first_axis).normalized()
        for strand in range(3):
            angle=math.tau*(travelled/.0068+strand/3)
            shifted[strand].append(tuple(position+radius*.43*(math.cos(angle)*first_axis+math.sin(angle)*other_axis)))
    for index,track in enumerate(shifted):
        wire(group,name+" · "+str(index+1),track,radius*.60,materials[index],parent)


def color(value):
    value=value.lstrip("#")
    def channel(offset):
        encoded=int(value[offset:offset+2],16)/255
        return encoded/12.92 if encoded<=.04045 else ((encoded+.055)/1.055)**2.4
    return (*[channel(offset) for offset in (0,2,4)],1)


def basic(name, tint, roughness=.6, metal=0):
    mat=bpy.data.materials.new(name)
    mat.diffuse_color=color(tint)
    mat.use_nodes=True
    shader=mat.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value=color(tint)
    shader.inputs["Roughness"].default_value=roughness
    shader.inputs["Metallic"].default_value=metal
    return mat,shader


def texture(mat, path, *, scalar=False):
    image=bpy.data.images.load(str(Path(path).resolve()),check_existing=True)
    if scalar:
        image.colorspace_settings.name="Non-Color"
    node=mat.node_tree.nodes.new("ShaderNodeTexImage")
    node.image=image
    return node.outputs["Color"]


def noise(mat,scale,vector=None,detail=3):
    node=mat.node_tree.nodes.new("ShaderNodeTexNoise")
    node.inputs["Scale"].default_value=scale
    node.inputs["Detail"].default_value=detail
    if vector is not None:
        mat.node_tree.links.new(vector,node.inputs["Vector"])
    return node.outputs["Fac"]


def ramp(mat,signal,stops):
    node=mat.node_tree.nodes.new("ShaderNodeValToRGB")
    gradient=node.color_ramp
    for index,(where,tint) in enumerate(stops):
        element=gradient.elements[index] if index<2 else gradient.elements.new(where)
        element.position=where
        element.color=color(tint)
    mat.node_tree.links.new(signal,node.inputs["Fac"])
    return node.outputs["Color"]


def relief(mat,shader,signal,distance,strength):
    node=mat.node_tree.nodes.new("ShaderNodeBump")
    node.inputs["Strength"].default_value=strength
    node.inputs["Distance"].default_value=distance
    mat.node_tree.links.new(signal,node.inputs["Height"])
    mat.node_tree.links.new(node.outputs["Normal"],shader.inputs["Normal"])


def mottled(name, low, high, roughness, scale, *, metal=0, grain=.00013, coat=0):
    mat,shader=basic(name,low,roughness,metal)
    coords=mat.node_tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    signal=noise(mat,scale,coords,3)
    shade=ramp(mat,signal,[(.24,low),(.76,high)])
    mat.node_tree.links.new(shade,shader.inputs["Base Color"])
    shader.inputs["Coat Weight"].default_value=coat
    shader.inputs["Coat Roughness"].default_value=.22
    relief(mat,shader,noise(mat,1800,coords,2),grain,.19)
    return mat


def scanned(work,key,name,tint,rough_range,normal_strength):
    mat,shader=basic(name,tint)
    nodes=mat.node_tree.nodes
    links=mat.node_tree.links
    mix=nodes.new("ShaderNodeMixRGB")
    mix.blend_type="MULTIPLY"
    mix.inputs[0].default_value=1
    mix.inputs[2].default_value=color(tint)
    links.new(texture(mat,work/(key+"-color.jpg")),mix.inputs[1])
    links.new(mix.outputs[0],shader.inputs["Base Color"])
    rough=nodes.new("ShaderNodeMapRange")
    rough.inputs["To Min"].default_value,rough.inputs["To Max"].default_value=rough_range
    links.new(texture(mat,work/(key+"-rough.jpg"),scalar=True),rough.inputs["Value"])
    links.new(rough.outputs[0],shader.inputs["Roughness"])
    normals=nodes.new("ShaderNodeNormalMap")
    normals.inputs["Strength"].default_value=normal_strength
    links.new(texture(mat,work/(key+"-normal.jpg"),scalar=True),normals.inputs["Color"])
    links.new(normals.outputs[0],shader.inputs["Normal"])
    return mat


def paper_material(work,filename,name):
    mat,shader=basic(name,"d7c8af",.87)
    signal=texture(mat,work/filename)
    mat.node_tree.links.new(signal,shader.inputs["Base Color"])
    coords=mat.node_tree.nodes.new("ShaderNodeTexCoord").outputs["Object"]
    relief(mat,shader,noise(mat,3100,coords,2),.00009,.15)
    shader.inputs["Sheen Weight"].default_value=.10
    return mat


def table_patina(mat,work):
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    surface=nodes.get("Principled BSDF")
    shade=surface.inputs["Base Color"].links[0].from_socket
    rough=surface.inputs["Roughness"].links[0].from_socket
    hsv=nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value=.68
    links.new(shade,hsv.inputs["Color"])
    mark=texture(mat,work/"wear.png",scalar=True)
    mapping=nodes.new("ShaderNodeUVMap")
    mapping.uv_map="磨痕位置"
    links.new(mapping.outputs["UV"],mark.node.inputs["Vector"])
    blend=nodes.new("ShaderNodeMixRGB")
    links.new(mark,blend.inputs[0]);links.new(hsv.outputs["Color"],blend.inputs[1])
    blend.inputs[2].default_value=color("a18b68")
    links.new(blend.outputs[0],surface.inputs["Base Color"])
    dulled=nodes.new("ShaderNodeMixRGB")
    links.new(mark,dulled.inputs[0]);links.new(rough,dulled.inputs[1])
    dulled.inputs[2].default_value=(.68,.68,.68,1)
    links.new(dulled.outputs[0],surface.inputs["Roughness"])


def glaze_dots(mat):
    nodes,links=mat.node_tree.nodes,mat.node_tree.links
    surface=nodes.get("Principled BSDF")
    shade=surface.inputs["Base Color"].links[0].from_socket
    granules=nodes.new("ShaderNodeTexVoronoi")
    granules.inputs["Scale"].default_value=302
    coords=nodes.new("ShaderNodeTexCoord")
    links.new(coords.outputs["Object"],granules.inputs["Vector"])
    dots=nodes.new("ShaderNodeMapRange")
    dots.inputs["From Min"].default_value=.051
    dots.inputs["From Max"].default_value=.131
    dots.inputs["To Min"].default_value=.87
    dots.inputs["To Max"].default_value=0
    links.new(granules.outputs["Distance"],dots.inputs["Value"])
    mix=nodes.new("ShaderNodeMixRGB")
    links.new(dots.outputs[0],mix.inputs[0]);links.new(shade,mix.inputs[1])
    mix.inputs[2].default_value=color("786a56")
    links.new(mix.outputs[0],surface.inputs["Base Color"])


def make_materials(work):
    cloth=mottled("棉布 · 靛灰","272d30","58605a",.92,45,grain=.00024)
    cloth.node_tree.nodes.get("Principled BSDF").inputs["Sheen Weight"].default_value=.30
    glass,shader=basic("灯罩 · 微浑薄玻璃","fffaf1",.065)
    shader.inputs["Transmission Weight"].default_value=1
    shader.inputs["IOR"].default_value=1.46
    signal=noise(glass,7, glass.node_tree.nodes.new("ShaderNodeTexCoord").outputs["Generated"],3)
    variation=glass.node_tree.nodes.new("ShaderNodeMapRange")
    variation.inputs["To Min"].default_value=.025
    variation.inputs["To Max"].default_value=.115
    glass.node_tree.links.new(signal,variation.inputs["Value"])
    glass.node_tree.links.new(variation.outputs[0],shader.inputs["Roughness"])
    nodes,links=glass.node_tree.nodes,glass.node_tree.links
    height=nodes.new("ShaderNodeSeparateXYZ")
    links.new(nodes.new("ShaderNodeTexCoord").outputs["Generated"],height.inputs[0])
    deposit=nodes.new("ShaderNodeMapRange")
    deposit.inputs["From Min"].default_value=.63
    deposit.inputs["From Max"].default_value=1
    deposit.inputs["To Min"].default_value=0
    deposit.inputs["To Max"].default_value=.31
    links.new(height.outputs["Z"],deposit.inputs[0])
    soot=nodes.new("ShaderNodeBsdfPrincipled")
    soot.inputs["Base Color"].default_value=color("403b31")
    soot.inputs["Roughness"].default_value=.49
    smoked=nodes.new("ShaderNodeMixShader")
    links.new(deposit.outputs[0],smoked.inputs[0]);links.new(shader.outputs[0],smoked.inputs[1])
    links.new(soot.outputs[0],smoked.inputs[2])
    shadow=nodes.new("ShaderNodeMixShader")
    links.new(nodes.new("ShaderNodeLightPath").outputs["Is Shadow Ray"],shadow.inputs[0])
    links.new(smoked.outputs[0],shadow.inputs[1])
    clear=nodes.new("ShaderNodeBsdfTransparent")
    clear.inputs["Color"].default_value=color("f7f5ed")
    links.new(clear.outputs[0],shadow.inputs[2])
    links.new(shadow.outputs[0],nodes.get("Material Output").inputs["Surface"])
    result={
        "top":scanned(work,"surface","旧木 · 磨亮桌面","c4cdc4",(.30,.66),.54),
        "frame":scanned(work,"wood","旧木 · 深色桌架","b8b4ab",(.34,.71),.42),
        "plaster":scanned(work,"plaster","石灰墙 · 旧粉刷","dfddcc",(.71,.96),.58),
        "cover":paper_material(work,"notebook.jpg","纤维纸 · 随记封皮"),
        "wrap":paper_material(work,"wrapper.jpg","牛皮纸 · 素封"),
        "cloth":cloth,"glass":glass,
        "bronze":mottled("灯架 · 烟熏铜铁","252622","625548",.48,59,metal=.66,grain=.00019),
        "brass":mottled("铜件 · 经手处","5e4a35","a58a5c",.37,96,metal=.73),
        "iron":mottled("铁件 · 氧化","242522","585049",.65,120,metal=.47),
        "ceramic":mottled("茶碗 · 灰米釉","aeab94","d7cfb4",.23,135,grain=.00010,coat=.32),
        "clay":mottled("胎土 · 露胎","6c5845","a18563",.78,190,grain=.00024),
        "rim":mottled("碗口 · 铁褐釉","584c39","8b7860",.30,116,coat=.22),
        "tea":basic("茶面 · 温褐","523522",.14)[0],
        "slate":mottled("屋瓦 · 远景","293137","495150",.76,29),
        "bark":mottled("枝条","282d2a","505247",.83,67),
        "pencil":mottled("笔杆 · 漆木","614531","966141",.52,85),
        "cutwood":basic("铅笔 · 刀削木芯","bc996d",.73)[0],
        "graphite":basic("铅芯","33312e",.33,.32)[0],
    }
    for index,tint in enumerate(["d0ba95","bfaa86","d9c7a6","b7a487","cbb490"]):
        result["edge"+str(index)]=mottled("书口 · "+str(index+1),tint,"dcccac",.92,690,grain=.00008)
    result["twine"]=[mottled("麻线 · "+str(index),dark,light,.91,550,grain=.00015) for index,(dark,light) in enumerate([("8e7250","ba9e74"),("99805b","ccaf80"),("79634b","ab916a")])]
    result["thread"]=basic("装订 · 捻线","75664c",.88)[0]
    table_patina(result["top"],work)
    glaze_dots(result["ceramic"])
    return result
