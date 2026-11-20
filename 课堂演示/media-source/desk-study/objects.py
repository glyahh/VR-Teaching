import math
import random

from atelier import basic, box, color, cord, empty, lathe, mesh, wire


def page(group, parent, name, width, depth, elevation, material, seed, lift, thickness, fine=False, folded=False, wrapped=False):
    columns, rows = (67,82) if fine else (16,22)
    vertices, faces, uv_coords=[],[],[]
    for row in range(rows+1):
        along=row/rows
        for column in range(columns+1):
            across=column/columns
            edge_x=(abs(2*across-1)**14)*(.00082*math.sin(39*along+.6*seed)+.00048*math.sin(77*along+seed))
            edge_y=(abs(2*along-1)**14)*(.00076*math.cos(45*across+.3*seed)+.00047*math.sin(85*across+seed))
            corner=math.exp(-((1-across)/.19)**1.4-(along/.16)**1.5)
            ripple=.00040*across*(math.sin(8*along+2*across)+.45*math.cos(11*across-5*along))
            curl=lift*corner
            turn=max(0,.036-(1-across)*width-along*depth) if folded else 0
            rounding=max(0,.007-min(along,1-along)*depth)*abs(2*across-1)**18
            horizontal=(across-.5)*width+edge_x-curl*.22-turn*.92-math.copysign(rounding,across-.5)
            vertical=(along-.5)*depth+edge_y+curl*.18+turn*.92
            if folded:
                erosion=.0017*(1+math.sin(61*across+.8)*math.cos(27*across))
                erosion+=.009*math.exp(-((across-.20)/.034)**2)
                erosion+=.015*max(0,(across-.58)/.42)*(1+.3*math.sin(72*across))
                vertical+=erosion*math.exp(-along/.050)
                horizontal-=.0019*max(0,1-along/.26)*across**6*(1+math.cos(along*110))
            if wrapped:
                to_string=min(abs(horizontal-.093),abs(vertical-.014))
                ripple+=.00120*(1-math.exp(-(to_string/.007)**2))
                ripple+=.00130*math.exp(-((along-.544-.012*math.sin(across*5))/.016)**2)
            vertices.append((horizontal,vertical,elevation+ripple+curl+turn*.24))
            uv_coords.append((across,along))
    for row in range(rows):
        for column in range(columns):
            left=row*(columns+1)+column
            faces.append((left,left+1,left+columns+2,left+columns+1))
    obj=mesh(group,name,vertices,faces,[material],parent)
    mapping=obj.data.uv_layers.new(name="纸面").data
    for poly in obj.data.polygons:
        poly.use_smooth=True
        for loop in poly.loop_indices:
            mapping[loop].uv=uv_coords[obj.data.loops[loop].vertex_index]
    rim=obj.modifiers.new("纸厚","SOLIDIFY")
    rim.thickness=thickness
    rim.offset=-1
    return obj


def flap(group,parent,name,outline,material):
    obj=mesh(group,name,outline,[tuple(range(len(outline)))],[material],parent)
    mapping=obj.data.uv_layers.new(name="折封").data
    for loop in obj.data.loops:
        point=obj.data.vertices[loop.vertex_index].co
        mapping[loop.index].uv=(.5+point.x/.323,.5+point.y/.421)
    obj.modifiers.new("折边厚度","SOLIDIFY").thickness=.00030


def folios(group, mats, tabletop):
    rng=random.Random(193501)
    for ordinal,(name,origin,angle,width,depth,layers) in enumerate([
        ("线装手记",(-.331,-.10),-8.3,.326,.421,30),
        ("牛皮纸封卷",(.243,.013),10.5,.309,.414,40),
    ]):
        parent=empty(group,name,(*origin,tabletop+.0007),angle)
        face_mat=mats["cover"] if ordinal==0 else mats["wrap"]
        page(group,parent,name+" · 底封",width+.006,depth+.007,.0017,face_mat,11,.001,.0016)
        for level in range(layers):
            portion=(level+1)/layers
            sheet=page(group,parent,"露出书口 %02d"%(level+1),width+rng.uniform(-.002,.004),depth+rng.uniform(-.003,.003),
                       .0022+level*.00044,mats["edge"+str(rng.randrange(5))],level,.0009+(.006 if ordinal==0 else .002)*portion**5,.00040)
            sheet.location.x=rng.uniform(-.0008,.0008)
            sheet.location.y=rng.uniform(-.0013,.0013)+.0015*math.sin(level//5)
            sheet.rotation_euler.z=rng.uniform(-.008,.008)
            if ordinal==0 and level==10:
                slip=page(group,parent,"夹入的散页",width+.018,depth+.019,.00233+level*.00044,mats["edge2"],45,.001,.00031)
                slip.location.x=.0072;slip.location.y=-.008;slip.rotation_euler.z=.042
        height=.0024+layers*.00044
        page(group,parent,name+" · 封面",width+.004,depth+.004,height,face_mat,2,.008 if ordinal==0 else .0036,.00085,True,ordinal==0,ordinal==1)
        if ordinal==0:
            margin=-width/2+.014
            stations=[-.158,-.076,.004,.085,.160]
            for index,along in enumerate(stations):
                lathe(group,"针孔",[(0,.0021),(.00022,.0018)],[mats["iron"]],parent,center=(margin,along,height+.00015),segments=18)
                wire(group,"包背线脚",[(margin,along,height+.00035),(margin-.005,along+.00025,height+.00145),(-width/2-.001,along+.0004,height+.0013),
                     (-width/2-.0031,along+.0005,height-.001),(-width/2-.0034,along+.0002,.0025),(-width/2,along,.0004)],
                     .00092,mats["thread"],parent,smooth=True)
                if index+1<len(stations):
                    second=stations[index+1]
                    wire(group,"顺背线脚",[(margin,along,height+.0005),(margin+.0007,(along+second)/2,height+.0012),
                         (margin,second,height+.0005)],.00079,mats["thread"],parent,smooth=True)
        else:
            right=width/2
            end=depth/2
            top=height+.0020
            flap(group,parent,"折入的包角",[(right-.070,-end+.003,top),(right,-end+.004,top+.0015),
                 (right-.001,-end+.093,top+.0003),(right-.032,-end+.048,top+.0011)],face_mat)
            flop=.014
            cross=.093
            crown=height+.0021
            lengthwise=[(cross,-end+.006,crown),(cross+.001,flop,crown),(cross+.001,end-.004,crown),(cross,end+.002,top-.001),
                        (cross-.001,end+.003,.003),(cross,end-.003,.0007),(cross,-end+.002,.0007),
                        (cross,-end-.003,.002),(cross,-end-.003,top-.002),(cross,-end+.006,crown)]
            sidewise=[(-right+.003,flop,crown),(-.018,flop-.002,crown),(cross,flop,crown+.0021),
                      (right-.006,flop+.001,crown),(right+.001,flop,top-.001),(right+.003,flop,.003),
                      (right-.002,flop,.0005),(-right+.002,flop,.0005),(-right-.003,flop,.0028),
                      (-right-.002,flop,top-.001),(-right+.003,flop,crown)]
            cord(group,"纵扎麻绳",lengthwise,.00168,mats["twine"],parent)
            cord(group,"横扎麻绳",sidewise,.00168,mats["twine"],parent)
            center_knot=[]
            for index in range(62):
                turn=index/61*math.tau*1.55
                center_knot.append((cross+.006*math.cos(turn),flop+.0039*math.sin(turn),
                                    crown+.0032+.0025*math.sin(turn+.8)))
            cord(group,"绳结压头",center_knot,.00165,mats["twine"],parent)
            for direction in [-1,1]:
                loop=[]
                for index in range(55):
                    phase=math.tau*index/54
                    spread=.0109 if direction<0 else .020
                    loop.append((cross+direction*spread*(1-math.cos(phase)),flop+.0081*math.sin(phase)+direction*.006*(1-math.cos(phase)),
                                 crown+.004+(.0027 if direction<0 else .0056)*math.sin(phase/2)))
                cord(group,"活结耳",loop,.00152,mats["twine"],parent)
                tail=[]
                for index in range(24):
                    portion=index/23
                    reach=.049 if direction<0 else .084
                    position=cross+direction*reach*portion
                    drop=min(1,max(0,(position-right-.002)/.015))
                    weight=drop*drop*(3-2*drop)
                    tail.append((position,flop-(.052 if direction<0 else .035)*portion+.011*math.sin(portion*5)*portion,
                                 (crown+.004*(1-portion)+.0005*math.sin(portion*6))*(1-weight)+.0015*weight))
                cord(group,"短线头",tail,.00115,mats["twine"],parent)
                for strand in range(5):
                    tip=tail[-1]
                    wire(group,"散纤维",[tip,(tip[0]+direction*.003,tip[1]-.003,tip[2]+strand*.00025),
                         (tip[0]+direction*(.005+strand*.0009),tip[1]-.005+strand*.001,tip[2]+.0007)],.00010,mats["twine"][strand%3],parent,smooth=True)
    return parent


def burner_cage(group,parent,material,base,lower_radius,upper_radius,height,count):
    vertices,faces=[],[]
    for index in range(count):
        center=math.tau*index/count
        half_width=.31*math.tau/count
        start=len(vertices)
        for elevation,radius in ((base,lower_radius),(base+height,upper_radius)):
            for offset in range(6):
                angle=center+half_width*(2*offset/5-1)
                vertices.append((radius*math.cos(angle),radius*math.sin(angle),elevation))
        for offset in range(5):
            faces.append((start+offset,start+offset+1,start+offset+7,start+offset+6))
    obj=mesh(group,"冲孔通风带",vertices,faces,[material],parent)
    obj.modifiers.new("卷铁片","SOLIDIFY").thickness=.0008
    return obj


def lantern(group,mats,tabletop):
    parent=empty(group,"提灯总成",(.00,.259,tabletop+.0006),-14)
    dark,brass=mats["bronze"],mats["brass"]
    lathe(group,"铆压油箱与底座",[(.0002,.048),(.001,.065),(.0035,.069),(.006,.070),(.008,.069),
          (.0095,.065),(.013,.0635),(.017,.061),(.022,.063),(.028,.066),(.037,.065),(.050,.060),
          (.061,.052),(.069,.039),(.072,.034),(.075,.034),(.0765,.037),(.080,.0375),(.083,.034),(.084,.027)],
          [dark,brass],parent,assign=lambda ring,angle: int(ring in (3,14)))
    cap=lathe(group,"滚花注油盖",[(0,.016),(.002,.019),(.0065,.020),(.009,.017),(.010,.014)],[brass],parent,
              center=(.031,-.037,.058),segments=112,deform=lambda height,radius,angle:(radius+.00055*math.cos(28*angle),height))
    cap.rotation_euler=(.36,.15,0)
    lathe(group,"燃烧器下碟",[(.081,.026),(.084,.033),(.088,.048),(.091,.049),(.093,.046),(.094,.035)],
          [dark,brass],parent,assign=lambda ring,angle:int(ring in (2,3)))
    burner_cage(group,parent,dark,.093,.033,.026,.016,26)
    lathe(group,"灯芯座",[(.105,.021),(.109,.028),(.113,.026),(.119,.013),(.122,.009)],[brass],parent)
    box(group,"焦黑灯芯",(0,0,.124),(.014,.005,.009),mats["iron"],.00075,parent)
    outer=[(.091,.036),(.096,.040),(.106,.046),(.119,.050),(.137,.051),
           (.155,.048),(.178,.043),(.199,.036),(.219,.0325),(.233,.033),(.240,.035)]
    glass_profile=outer+[(height,radius-.00135) for height,radius in reversed(outer)]
    lathe(group,"薄壁玻璃灯罩",glass_profile,[mats["glass"]],parent,segments=112)
    lathe(group,"烟帽下卷边",[(.238,.035),(.240,.047),(.243,.050),(.246,.049),(.248,.040),(.251,.035)],[dark],parent)
    burner_cage(group,parent,dark,.249,.036,.033,.015,28)
    lathe(group,"带烟熏的帽盖",[(.263,.035),(.264,.039),(.268,.040),(.270,.036),(.276,.023),
          (.279,.018),(.282,.018),(.284,.012)],[dark,brass],parent,assign=lambda ring,angle:int(ring==2))
    for side in (-1,1):
        wire(group,"中空侧导管",[(side*.045,.006,.045),(side*.062,.007,.067),(side*.068,.006,.106),
             (side*.071,.007,.172),(side*.064,.007,.227),(side*.050,.005,.247),(side*.028,.004,.255)],
             .0064,dark,parent,smooth=True)
        ear=lathe(group,"提梁铆钉",[(0,.0064),(.0015,.008),(.0035,.0069),(.004,.0044)],[brass],parent,
                  center=(side*.064,-.001,.218),segments=36)
        ear.rotation_euler.x=math.pi/2
    for front in (-1,1):
        for turn in (-1,1):
            wire(group,"交叉护网",[(turn*.043,front*.005,.097),(turn*.040,front*.034,.119),
                 (turn*.015,front*.051,.145),(-turn*.019,front*.039,.184),(-turn*.039,front*.016,.221),
                 (-turn*.041,front*.003,.241)],.00155,dark,parent,smooth=True)
    wire(group,"提梁钢丝",[(-.065,-.002,.218),(-.073,.001,.230),(-.085,.025,.302),(-.066,.04,.353),
         (-.025,.048,.378),(.020,.047,.383),(.061,.04,.365),(.084,.028,.323),(.074,.004,.249),(.065,-.002,.218)],
         .00205,dark,parent,smooth=True)
    knob=lathe(group,"灯芯滚花调节轮",[(0,.007),(.002,.0105),(.006,.0105),(.007,.008)],[brass],parent,
               center=(.016,-.041,.100),segments=100,deform=lambda height,radius,angle:(radius+.00053*math.cos(25*angle),height))
    knob.rotation_euler.x=math.pi/2
    wire(group,"调节轴",[(.008,-.016,.100),(.016,-.044,.100)],.0017,brass,parent)
    amber,shader=basic("火焰 · 琥珀", "ff9b37",.43)
    shader.inputs["Emission Color"].default_value=color("ffad43")
    shader.inputs["Emission Strength"].default_value=5.8
    core,shader=basic("火焰 · 芯","fff0b2",.4)
    shader.inputs["Emission Color"].default_value=color("ffe9aa")
    shader.inputs["Emission Strength"].default_value=11
    for label,mat,sizes,offset in [
        ("偏斜外焰",amber,[(0,.0023),(.004,.0043),(.012,.0058),(.023,.0041),(.035,.0019),(.045,.00022)],(0,0,0)),
        ("明亮焰芯",core,[(0,.0016),(.004,.0033),(.010,.0038),(.018,.0026),(.029,.00020)],(.0003,-.0037,0)),
    ]:
        flame=lathe(group,label,sizes,[mat],parent,center=(offset[0],offset[1],.127),segments=40)
        for vertex in flame.data.vertices:
            phase=vertex.co.z/.044
            vertex.co.x+=.0065*phase**2
            vertex.co.y*=.67
    return parent


def bowl(group,mats,tabletop):
    parent=empty(group,"粗瓷茶碗",(.609,.222,tabletop+.0005),10)
    profile=[(.0003,.027),(.001,.0315),(.004,.033),(.008,.033),(.011,.0295),(.013,.030),
             (.016,.035),(.022,.041),(.033,.0475),(.046,.052),(.059,.0555),
             (.068,.057),(.0715,.0584),(.0735,.0587),(.0745,.0576),(.074,.0561),(.072,.0555),
             (.060,.0532),(.047,.0502),(.032,.045),(.022,.036),(.016,.021),(.015,.0002)]
    def deform(height,radius,angle):
        weight=min(1,height/.06)
        rim=max(0,(height-.066)/.009)
        chip=math.exp(-((math.atan2(math.sin(angle+.9),math.cos(angle+.9)))/.07)**2)
        return (radius*(1+weight*(.007*math.sin(3*angle+.4)+.0045*math.cos(7*angle))),
                height+rim*(.00055*math.sin(3*angle)-.0015*chip))
    def finish(ring,angle):
        if ring<5 or (12<=ring<=16 and abs(math.atan2(math.sin(angle+.9),math.cos(angle+.9)))<.057):
            return 1
        return 2 if ring in (12,13) else 0
    lathe(group,"有圈足的灰釉薄胎碗",profile,[mats["ceramic"],mats["clay"],mats["rim"]],parent,segments=140,deform=deform,assign=finish)
    lathe(group,"茶汤及弯月形边缘",[(.0516,.0510),(.0538,.0514),(.0535,.0513),(.0526,.0505),(.0523,.0479),(.0523,.0002)],
          [mats["tea"]],parent,segments=96)
    return parent


def pencil(group,mats,tabletop):
    root=empty(group,"削过的木杆铅笔",(.019,-.261,tabletop+.00385),-15)
    pencil_body=lathe(group,"六棱漆杆",[(0,.0035),(.135,.0036),(.138,.0034)],[mats["pencil"]],root,segments=6)
    pencil_body.rotation_euler.y=math.pi/2
    shave=lathe(group,"削口",[(0,.0007),(.011,.0030),(.014,.00355)],[mats["cutwood"]],root,center=(-.014,0,0),segments=6)
    shave.rotation_euler.y=math.pi/2
    lead=lathe(group,"石墨笔尖",[(0,.00012),(.0032,.00075)],[mats["graphite"]],root,center=(-.0171,0,0),segments=8)
    lead.rotation_euler.y=math.pi/2
