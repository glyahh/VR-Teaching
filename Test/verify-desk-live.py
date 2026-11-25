import argparse
from hashlib import file_digest
import json
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect

from course_checks import DESK, drag_desk, exercise_desk, object_point, visible_motion
from course_cli import COURSE, Classroom, button, launch, size


def color_counts(plots):
    return plots.locator('canvas').evaluate_all("""plots => plots.map(canvas => {
        const {data} = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
        const counts = [0, 0];
        for (let i = 0; i < data.length; i += 4) {
            if (data[i] === 36 && data[i+1] === 78 && data[i+2] === 96) counts[0]++;
            if (data[i] === 155 && data[i+1] === 49 && data[i+2] === 41) counts[1]++;
        }
        return counts;
    })""")


def enter_desk(page, url, chapter):
    page.goto(url)
    if not chapter:
        page.locator('.timeline button').filter(has_text='遵义会议').click()
        button(page, '进入「遵义会议」场景').click()
    else:
        button(page, '开始授课').click()
        button(page, '进入课堂').click()
        page.locator('.chapter-nav').get_by_role('button', name='遵义会议', exact=True).click()
    expect(page.locator('.scene-head h1')).to_have_text('遵义会议室')
    button(page, '下一页').click()
    expect(page.locator('.scene-head h1')).to_have_text('会议桌上的两份材料')
    expect(page.locator(DESK)).to_have_attribute('data-space', 'ready', timeout=20000)


def verify_interruptions(room):
    page = room.page
    frame = page.locator(DESK)
    reader = page.locator('.desk-reader')
    before = frame.locator('canvas').screenshot()
    button(page, '俯看桌面').click()
    expect(frame).to_have_attribute('data-pitch', '15.000')
    expect(button(page, '俯看桌面')).to_have_attribute('aria-pressed', 'true')
    assert visible_motion(frame.locator('canvas').screenshot(), before) > 2
    room.shot('11-俯看桌面')
    button(page, '俯看桌面').click()
    expect(frame).to_have_attribute('data-pitch', '0.000')
    button(page, '拉近桌面').click()
    expect(frame).to_have_attribute('data-zoom', '1.1300')
    button(page, '回到正面机位').click()
    page.keyboard.press('ArrowLeft')
    expect(frame).to_have_attribute('data-yaw', '-4.000')
    expect(frame).to_have_attribute('data-zoom', '1.0000')
    button(page, '回到正面机位').click()
    expect(frame).to_have_attribute('data-yaw', '0.000')
    bounds=frame.bounding_box()
    x,y=bounds['x']+bounds['width']*.73,bounds['y']+bounds['height']*.24
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(x+bounds['width']*.16,y,steps=8)
    page.mouse.up()
    expect(frame).not_to_have_attribute('data-yaw', '0.000')
    assert -9.4<float(frame.get_attribute('data-yaw'))<-8.8
    page.mouse.wheel(0,-150)
    expect(frame).to_have_attribute('data-zoom','1.2712')
    button(page, '回到正面机位').click()
    expect(frame).to_have_attribute('data-yaw', '0.000')

    saved_sheet=frame.get_attribute('data-sheet-before')
    drag_desk(page,'before-sheet',-.17,dy=.04,hold=True)
    expect(frame).to_have_attribute('data-gesture','sheet')
    page.keyboard.press('Escape')
    page.mouse.up()
    expect(frame).to_have_attribute('data-gesture','')
    expect(frame).to_have_attribute('data-sheet-before',saved_sheet)

    # 整册纸面都有入口。点离可见圆点较远的一个实际纸面位置。
    x,y = object_point(page, 'page-forward')
    page.mouse.click(x-26,y+3)
    expect(reader.get_by_role('heading', name='会前手记')).to_be_visible()
    expect(frame).to_have_attribute('data-spread', '3')
    book = reader.locator('.desk-reader-book')
    box = book.bounding_box()
    x,y = box['x']+box['width']*.73,box['y']+box['height']*.35
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(x-box['width']*.16,y,steps=7)
    expect(reader.locator('.desk-reader-turn')).to_be_visible()
    room.shot('12-阅读中翻页跟手')
    page.keyboard.press('Escape')
    page.mouse.up()
    expect(reader).to_be_hidden()
    expect(frame).to_have_attribute('data-gesture', '')
    expect(frame).to_have_attribute('data-spread', '3')

    button(page, '翻阅左册 · 会前形势').click()
    page.keyboard.press('ArrowRight')
    page.keyboard.press('ArrowLeft')
    expect(frame).to_have_attribute('data-gesture', '')
    expect(frame).to_have_attribute('data-spread', '3')
    button(page,'后一张手记').click()
    expect(frame).to_have_attribute('data-spread', '4')
    button(page,'前一张手记').click()
    expect(frame).to_have_attribute('data-spread', '3')
    button(page,'对照两份材料').click()
    expect(reader.locator('.desk-reader-pair article:visible')).to_have_count(2)
    room.shot('13-两份会议材料')
    button(page,'返回桌面').click()
    expect(reader).to_be_hidden()
    expect(frame).to_have_attribute('data-focus', '0.000')

    button(page,'查看行军路线图').click()
    plots=reader.locator('.desk-map-plots')
    expect(plots).to_have_attribute('data-mode','parallel')
    button(page,'原议湘西').click()
    expect(plots).to_have_attribute('data-drawing','false')
    [(old_only,new_missing)]=color_counts(plots)
    assert old_only>200 and new_missing==0, (old_only,new_missing)
    button(page,'改向黔北').click()
    expect(plots).to_have_attribute('data-drawing','false')
    [(old_missing,new_only)]=color_counts(plots)
    assert old_missing==0 and new_only>200, (old_missing,new_only)
    button(page,'叠加').click()
    expect(plots).to_have_attribute('data-drawing','false')
    [(overlay_old,overlay_new)]=color_counts(plots)
    assert overlay_old>200 and overlay_new>200, (overlay_old,overlay_new)
    region=reader.locator('.desk-reader-content').bounding_box()
    legend=reader.locator('.desk-map-legend').bounding_box()
    font=reader.locator('[data-place="黎平"] span').evaluate('node=>getComputedStyle(node).fontSize')
    assert legend['y']+legend['height'] <= region['y']+region['height']+1, (legend,region)
    room.shot('14-叠图和完整图例')
    button(page,'重画路线').click()
    expect(plots).to_have_attribute('data-drawing','true')
    button(page,'改向黔北').click()
    button(page,'并排').click()
    expect(plots).to_have_attribute('data-drawing','false')
    (left_blue,left_red),(right_blue,right_red)=color_counts(plots)
    assert left_blue>200 and left_red==right_blue==0 and right_red>200
    page.keyboard.press('Escape')
    expect(reader).to_be_hidden()
    return {'single_map_station_font':font,'direction_ink_pixels':{
        'original':[old_only,new_missing], 'revised':[old_missing,new_only],
        'overlay':[overlay_old,overlay_new], 'parallel':[[left_blue,left_red],[right_blue,right_red]],
    }}


def exercise(html, viewport, output, video, chapter):
    with launch(html,viewport,video_dir=output if video else None) as (context,url,edge,errors):
        requests=[]
        context.on('request',lambda request: requests.append(request.url)
            if request.url.startswith(('http://','https://')) else None)
        teacher=context.new_page()
        room=Classroom(teacher,output)
        try:
            enter_desk(teacher,url,chapter)
            frame=teacher.locator(DESK)
            expect(frame.locator('video')).to_have_count(0)
            expect(frame.locator('button.scene-point')).to_have_count(3)
            exercise_desk(teacher,right_first=not chapter,shot=room.shot)
            measured=verify_interruptions(room)
            assert not requests, requests
            return {'edge':edge,'viewport':viewport,'chapter_entry':chapter,'observations':measured,
                    'steps':room.steps,'browser_errors':errors}
        except Exception:
            room.shot('失败现场')
            raise
        finally:
            recording=teacher.video
            if recording:
                teacher.close()
                recording.save_as(output/'会议桌交互.webm')


def exercise_narrow(html, output):
    with launch(html,{'width':390,'height':820},reduced='reduce') as (context,url,edge,errors):
        page=context.new_page()
        enter_desk(page,url,False)
        frame=page.locator(DESK)
        button(page,'翻阅左册 · 会前形势').click()
        reader=page.locator('.desk-reader')
        expect(reader.get_by_role('heading',name='会前手记')).to_be_visible()
        expect(frame).to_have_attribute('data-focus','1.000')
        expect(frame).to_have_attribute('data-gesture','')
        page.screenshot(path=output/'15-窄窗手记.png')
        button(page,'返回桌面').click()
        expect(frame).to_have_attribute('data-focus','0.000')
        # 模拟实际 WebGL 上下文丢失。静态桌景上的地图仍能打开并对照。
        frame.locator('canvas').evaluate("canvas=>canvas.getContext('webgl2').getExtension('WEBGL_lose_context').loseContext()")
        expect(frame).to_have_attribute('data-space','fixed')
        button(page,'查看行军路线图').click()
        button(page,'并排').click()
        expect(reader.locator('.desk-map-plots')).to_have_attribute('data-drawing','false')
        expect(reader.locator('.desk-map-plot')).to_have_count(2)
        visible=reader.locator('.desk-map-plot').last
        visible.scroll_into_view_if_needed()
        expect(visible.locator('[data-place="遵义"] span')).to_be_visible()
        page.screenshot(path=output/'16-窄窗读图与 WebGL 回退.png')
        button(page,'返回桌面').click()
        expect(reader).to_be_hidden()
        expect(button(page,'查看行军路线图')).to_be_focused()


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--html',type=Path,default=COURSE)
    parser.add_argument('--output',type=Path)
    parser.add_argument('--viewport',type=size)
    parser.add_argument('--record',action='store_true')
    args=parser.parse_args()
    with TemporaryDirectory() as temp:
        output=args.output or Path(temp)
        output.mkdir(parents=True,exist_ok=True)
        sizes=[args.viewport] if args.viewport else [size('1366x768'),size('1920x1080')]
        reports=[]
        for index, viewport in enumerate(sizes):
            folder=output/str(viewport['width'])
            folder.mkdir(exist_ok=True)
            reports.append(exercise(args.html,viewport,folder,args.record,chapter=index==0))
            print(f'桌景通过 Edge 单屏离线验收，窗口 {viewport["width"]}x{viewport["height"]}。',flush=True)
        exercise_narrow(args.html,output)
        with args.html.open('rb') as source_file:
            checksum=file_digest(source_file,'sha256').hexdigest()
        (output/'report.json').write_text(json.dumps({'passed':True,'sha256':checksum,'runs':reports},
            ensure_ascii=False,indent=2),encoding='utf-8')
