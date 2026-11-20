"""用精修工程原有的侧机位渲染导览插镜。用 Blender 4.5 后台执行。"""

from pathlib import Path

import bpy


root = Path(__file__).resolve().parents[3]
source = root / '展示材料/遵义会议室精修场景/会前的桌边.blend'
work = root / '.march-build/desk-live/guide'
work.mkdir(parents=True, exist_ok=True)
scene = bpy.context.scene
if not source.samefile(bpy.data.filepath) or scene.camera.name != '机位一 · 桌边全景':
    raise ValueError('导览需要已审精修工程及原全景机位')
if (scene.render.resolution_x, scene.render.resolution_y) != (1920, 1080):
    raise ValueError('精修工程的原画幅已改变')

scene.camera = scene.objects['机位二 · 侧视装订']
scene.render.resolution_x = 1440
scene.render.resolution_y = 810
scene.render.resolution_percentage = 100
scene.cycles.samples = 40
scene.cycles.use_denoising = True
scene.render.image_settings.file_format = 'PNG'
frame = work / 'detail-rendering.png'
scene.render.filepath = str(frame)
bpy.ops.render.render(write_still=True)
frame.replace(work / 'detail.png')
