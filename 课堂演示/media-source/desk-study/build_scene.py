"""Blender 4.5 · 遵义会议室桌边静物。用 --help 查看后台构建参数。"""

import argparse
import math
import os
import random
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE))
from atelier import basic, box, collection, color, empty, lathe, make_materials, mesh, move_to, planar_uv, wire
from objects import bowl, folios, lantern, pencil


TOP=.80
HERO="会前的桌边"
DETAIL="侧看书口与灯罩"


def plank(group, name, y_front, y_back, index, mats):
    width=1.70
    segments=120
    section_size=8
    vertices,faces=[],[]
    for step in range(segments+1):
        position=width*(step/segments-.5)
        wear=sum(amount*math.exp(-((position-center)/span)**2) for center,span,amount in
                 [(-.70,.024,.0036),(-.36,.015,.0027),(-.14,.043,.0018),(.22,.021,.0019),(.67,.037,.0037)])
        wobble=.00065*math.sin(15*position+index*8)+.0004*math.sin(83*position+index)
        front=y_front+wobble+(wear if index==0 else 0)
        back=y_back+.00061*math.sin(21*position+index)
        elevation=TOP+.00041*math.sin(4*position+.47*index)
        rounding=.0022+(.45*wear if index==0 else 0)
        for depth,height in [(front+.002,elevation-.049),(back-.002,elevation-.049),
                             (back,elevation-.046),(back,elevation-.002),(back-.0015,elevation),
                             (front+rounding,elevation),(front,elevation-rounding),(front,elevation-.047)]:
            vertices.append((position,depth,height))
    for step in range(segments):
        for edge in range(section_size):
            first=step*section_size+edge
            adjacent=step*section_size+(edge+1)%section_size
            faces.append((first,adjacent,adjacent+section_size,first+section_size))
    faces.extend([tuple(reversed(range(section_size))),tuple(range(segments*section_size,(segments+1)*section_size))])
    obj=mesh(group,name,vertices,faces,[mats["top"]])
    planar_uv(obj,.61,(.49+.024*index,.49+.065*index))
    marks=obj.data.uv_layers.new(name="磨痕位置").data
    wood_map=obj.data.uv_layers["米制纹理"]
    strips=[(.06,.175),(.26,.37),(.44,.56),(.63,.75),(.83,.95)]
    low,high=strips[index]
    for poly in obj.data.polygons:
        for loop in poly.loop_indices:
            point=obj.data.vertices[obj.data.loops[loop].vertex_index].co
            if poly.normal.z>.9:
                along=(point.y-y_front)/(y_back-y_front)
                wood_map.data[loop].uv=(.50+point.x*.54,low+along*(high-low))
            marks[loop].uv=(.5+point.x/width,.5+point.y/.95)
    obj.data.uv_layers.active_index=0
    wood_map.active_render=True
    return obj


def table(group,mats):
    start=-.475
    for index,width in enumerate([.184,.2075,.1785,.201,.179]):
        plank(group,"磨旧桌板 %02d"%(index+1),start+.0005,start+width-.0006,index,mats)
        start+=width
    for side in (-1,1):
        box(group,"长牙板",(0,side*.396,.684),(1.52,.038,.130),mats["frame"],.0032)
        box(group,"压边线",(0,side*.418,.638),(1.52,.009,.014),mats["frame"],.002)
        box(group,"短牙板",(side*.747,0,.684),(.043,.785,.131),mats["frame"],.003)
        box(group,"下横枨",(0,side*.388,.210),(1.47,.031,.043),mats["frame"],.002)
        for along in (-1,1):
            box(group,"方榫桌腿",(side*.747,along*.390,.377),(.078,.079,.754),mats["frame"],.0042,vertical=True)
            pin=lathe(group,"旧榫木销",[(0,.0044),(.0008,.0043)],[mats["frame"]],center=(side*.747,along*.430,.701),segments=20)
            pin.rotation_euler.x=along*-math.pi/2
    for index,(horizontal,depth) in enumerate([(-.755,-.391),(.752,-.382),(-.748,.345),(.747,.350),(-.754,-.193),(.751,.094)]):
        fastener=lathe(group,"沉入木面的钉头",[(0,.0034),(.00023,.0031)],[mats["iron"]],
                       center=(horizontal,depth,TOP+.00036),segments=24)
        fastener.scale.y=.83+.03*index


def import_chair(group,work):
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(work/"chair"/"chinese_armchair_1k.gltf"))
    imported=[obj for obj in bpy.data.objects if obj not in before]
    bpy.context.view_layer.update()
    points=[obj.matrix_world @ Vector(corner) for obj in imported if obj.type=="MESH" for corner in obj.bound_box]
    height=max(point.z for point in points)-min(point.z for point in points)
    pivot=empty(group,"木靠椅",(.461,.755,0),-11)
    pivot.scale=(1.08/height,)*3
    for obj in imported:
        move_to(obj,group)
        if obj.parent is None:
            obj.parent=pivot
        if obj.type=="MESH":
            obj.name="木靠椅 · 椅身"


def stool(group,mats):
    root=empty(group,"窗边条凳",(-1.00,.18,0),-14)
    box(group,"窄凳面",(0,0,.459),(.35,.52,.045),mats["top"],.007,root)
    for side in (-1,1):
        for end in (-1,1):
            leg=box(group,"凳脚",(side*.120,end*.188,.226),(.033,.047,.456),mats["frame"],.003,root,True)
            leg.rotation_euler=(end*.065,-side*.085,0)
        box(group,"凳侧枨",(side*.122,0,.187),(.027,.377,.032),mats["frame"],.003,root)
    width,rows=.23,48
    vertices,faces=[],[]
    for station in range(rows+1):
        portion=station/rows
        if portion<=.63:
            along=-.10+portion/.63*.35
            height=.485
        else:
            bend=(portion-.63)/.37
            along=.25+.017*math.sin(bend*math.pi/2)
            height=.485-.19*bend
        for cross in range(26):
            across=cross/25
            fold=.009*math.sin(7.5*math.pi*across+1.3*portion)+.003*math.cos(15*across+7*portion)
            vertices.append(((across-.5)*width+.016*portion,along+max(0,portion-.63)*fold*2,height+fold*(.5+portion*.5)))
    for station in range(rows):
        for cross in range(25):
            offset=station*26+cross
            faces.append((offset,offset+1,offset+27,offset+26))
    cloth=mesh(group,"搭在凳边的蓝灰布",vertices,faces,[mats["cloth"]],root)
    cloth.modifiers.new("布边厚度","SOLIDIFY").thickness=.0016
    for poly in cloth.data.polygons:
        poly.use_smooth=True


def room(group,mats):
    for index in range(20):
        box(group,"地面木板",(0,-2.95+index*.304,-.025),(6,.302,.05),mats["frame"],.0016)
    near,far=-1.65,-.41
    sill,header=.79,2.13
    for name,center,size in [
        ("窗下墙",(0,1.29,sill/2),(6,.17,sill)),
        ("窗上墙",(0,1.29,(header+2.88)/2),(6,.17,2.88-header)),
        ("窗左墙",((-3+near)/2,1.29,(header+sill)/2),(near+3,.17,header-sill)),
        ("窗右墙",((far+3)/2,1.29,(header+sill)/2),(3-far,.17,header-sill)),
        ("左山墙",(-3,-.83,1.44),(.14,4.25,2.88)),
        ("右山墙",(3,-.83,1.44),(.14,4.25,2.88)),
        ("室内背墙",(0,-2.96,1.44),(6,.14,2.88)),
        ("顶棚",(0,-.82,2.90),(6,4.30,.08)),
    ]:
        box(group,name,center,size,mats["plaster"],vertical=True)
    for horizontal in (near,far,.99,2.25):
        box(group,"旧木立柱",(horizontal,1.16,1.41),(.081,.095,2.82),mats["frame"],.0036,vertical=True)
    box(group,"窗台",((near+far)/2,1.15,sill),(far-near+.15,.185,.069),mats["top"],.005)
    box(group,"门窗上枋",((near+far)/2,1.18,header),(far-near+.1,.115,.078),mats["frame"],.004)
    for index in range(1,7):
        box(group,"窗棂竖档",(near+index*(far-near)/7,1.21,(sill+header)/2),(.024,.046,header-sill),mats["frame"],.0023,vertical=True)
    for elevation in (.97,1.25,1.56,1.87):
        box(group,"窗棂横档",((near+far)/2,1.214,elevation),(far-near,.037,.022),mats["frame"],.0018)
    for side in (-1,1):
        box(group,"踢脚木",(side*1.5,1.181,.092),(2.99,.062,.182),mats["frame"],.003)
    exterior=basic("远墙 · 暮蓝","84979d",.94)[0]
    box(group,"院外远墙",(-1.45,3.17,-.19),(3.25,.11,1.02),exterior,.008)
    ridge=box(group,"院外斜屋面",(-1.42,2.90,.366),(3.5,.85,.063),mats["slate"],.007)
    ridge.rotation_euler.x=math.radians(18)
    for index in range(40):
        roof_tile=box(group,"远檐瓦垄",(-3.07+index*.086,2.90,.400),(.028,.86,.022),mats["slate"],.007)
        roof_tile.rotation_euler.x=ridge.rotation_euler.x
    rng=random.Random(5)
    for index in range(11):
        origin=-1.9+index*.097
        wire(group,"院中细枝",[(origin,2.42,.15),(origin-.04,2.43,.47),(origin+rng.uniform(-.15,.12),2.44,.71),
             (origin+rng.uniform(-.29,.18),2.46,.86+rng.random()*.29)],.003,mats["bark"],smooth=True)


def aim(obj,target):
    obj.rotation_euler=(Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


def lights(group):
    def area(name,position,target,energy,tint,size,height=None):
        data=bpy.data.lights.new(name,"AREA")
        data.energy=energy
        data.color=color(tint)[:3]
        if height:
            data.shape="RECTANGLE"
            data.size_y=height
        else:
            data.shape="DISK"
        data.size=size
        obj=bpy.data.objects.new(name,data)
        group.objects.link(obj);obj.location=position;aim(obj,target)
        return obj
    data=bpy.data.lights.new("灯芯光","POINT")
    data.color=color("ffc17d")[:3];data.energy=10.5;data.shadow_soft_size=.015
    light=bpy.data.objects.new("灯芯光",data)
    group.objects.link(light);light.location=(.0,.259,TOP+.15)
    light.visible_glossy=False
    light.visible_transmission=False
    area("灯边暖光",(.26,.50,1.15),(-.14,-.13,TOP),3.2,"ffce99",.30)
    area("穿窗天光",(-1.12,1.36,1.75),(-.16,-.08,.79),55,"b6cefc",.93,1.13)
    area("室内柔反射",(-.72,-1.02,1.82),(.1,.05,.77),14,"ecdbc8",1.20,.85)
    area("杯沿反光",(1.30,.45,1.57),(.32,.06,.82),7,"e0d9c7",.71,1.04)
    area("院中散光",(-1.3,2.01,2.55),(-1.35,3.1,1.0),37,"9ab9e7",1.9)


def camera(group,name,position,target,lens,aperture):
    data=bpy.data.cameras.new(name)
    obj=bpy.data.objects.new(name,data)
    group.objects.link(obj);obj.location=position
    aim(obj,target)
    data.lens=lens;data.sensor_width=36;data.clip_start=.04
    data.dof.use_dof=True;data.dof.focus_distance=(Vector(target)-Vector(position)).length
    data.dof.aperture_fstop=aperture;data.dof.aperture_blades=8
    return obj


def build(work):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene=bpy.context.scene
    scene.name="遵义会议室 · 会前的桌边"
    scene.unit_settings.system="METRIC"
    mats=make_materials(work)
    scenery=collection("01 · 室内与窗外")
    furniture=collection("02 · 木作家具")
    room(scenery,mats);table(furniture,mats);stool(furniture,mats);import_chair(furniture,work)
    folios(collection("03 · 手记与扎绳卷宗"),mats,TOP)
    lantern(collection("04 · 玻璃提灯"),mats,TOP)
    stills=collection("05 · 茶碗和铅笔")
    bowl(stills,mats,TOP);pencil(stills,mats,TOP)
    photo=collection("06 · 摄影与光线")
    lights(photo)
    hero=camera(photo,"机位一 · 桌边全景",(.29,-1.94,2.055),(-.015,.025,.853),42,6.3)
    detail=camera(photo,"机位二 · 侧视装订",(-.96,-1.26,1.55),(.025,.040,.875),48,6.3)
    scene.camera=hero
    scene.world=bpy.data.worlds.new("窗外 · 入夜")
    scene.world.use_nodes=True
    background=scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value=color("b8cde3")
    background.inputs["Strength"].default_value=.26
    scene.render.engine="CYCLES"
    scene.cycles.samples=80
    scene.cycles.preview_samples=16
    scene.cycles.use_preview_denoising=True
    scene.cycles.use_denoising=True
    scene.cycles.adaptive_threshold=.025
    scene.cycles.max_bounces=9;scene.cycles.transmission_bounces=7
    scene.cycles.diffuse_bounces=4;scene.cycles.glossy_bounces=4
    scene.cycles.sample_clamp_indirect=4
    scene.render.resolution_x=1920;scene.render.resolution_y=1080;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format="PNG";scene.render.image_settings.color_mode="RGB"
    scene.view_settings.view_transform="AgX"
    scene.view_settings.look="AgX - Medium High Contrast"
    scene.view_settings.exposure=-.23
    scene.render.film_transparent=False
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type=="VIEW_3D":
                space=area.spaces.active
                space.region_3d.view_distance=2.3
                space.region_3d.view_location=(0,.03,.85)
                space.region_3d.view_rotation=hero.rotation_euler.to_quaternion()
                space.region_3d.view_perspective="CAMERA"
                space.overlay.show_overlays=False
                space.shading.type="MATERIAL"
                space.shading.use_scene_lights=True
                space.shading.use_scene_world=True
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active=None
    notes=bpy.data.texts.new("关于本场景")
    notes.write("会前的桌边｜遵义会议室教学情境复原\n此为对照课件画面搭建的美术场景，桌上手记和物件不作史料原物使用。\n两台相机均已保存在工程中。\nPoly Haven · CC0\nhttps://polyhaven.com/a/wood_table\nhttps://polyhaven.com/a/wood_table_worn\nhttps://polyhaven.com/a/painted_plaster_wall\nhttps://polyhaven.com/a/chinese_armchair\n自制纸面使用项目原有桌面图中的纸面纹理细节。其余道具均为本场景制作。\n")
    return scene,hero,detail


def render(scene,camera_obj,path):
    scene.camera=camera_obj
    scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--work",type=Path,required=True)
    parser.add_argument("--out",type=Path,required=True)
    parser.add_argument("--preview",action="store_true")
    parser.add_argument("--model-only",action="store_true")
    parser.add_argument("--samples",type=int)
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    work=args.work.resolve();output=args.out.resolve()
    output.mkdir(parents=True,exist_ok=True)
    scene,hero,detail=build(work)
    if args.preview:
        scene.render.resolution_percentage=40;scene.cycles.samples=args.samples or 18
        for title,camera_obj in [(HERO,hero),(DETAIL,detail)]:
            render(scene,camera_obj,output/(title+".png"))
        return
    scene.cycles.samples=args.samples or 80
    bpy.context.preferences.filepaths.save_version=0
    scene.render.filepath="//"+HERO+".png"
    bpy.ops.file.pack_all()
    missing=[image.name for image in bpy.data.images if image.source=="FILE" and not image.packed_file]
    if missing:
        raise RuntimeError("未内嵌的贴图："+str(missing))
    for image in bpy.data.images:
        if image.source=="FILE" and image.packed_file:
            virtual="//内嵌贴图/"+Path(image.filepath).name
            image.filepath_raw=virtual
            for packed in image.packed_files:
                packed.filepath=virtual
    staging=output/"场景生成中.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(staging),compress=True)
    os.replace(staging,output/(HERO+".blend"))
    if args.model_only:
        return
    for title,camera_obj in [(HERO,hero),(DETAIL,detail)]:
        render(scene,camera_obj,output/(title+".png"))


if __name__=="__main__":
    main()
