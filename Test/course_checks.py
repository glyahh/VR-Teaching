from io import BytesIO

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import expect
from lesson_rule_checks import narration, disclosures, journeys, controls


DESK = '.desk-live-frame'


def button(page, name):
    return page.get_by_role('button', name=name, exact=True)


def object_point(page, target):
    handle = page.locator(f'[data-desk-target="{target}"]')
    expect(handle).to_be_visible(timeout=16000)
    bounds = handle.bounding_box()
    return bounds['x'] + bounds['width']/2, bounds['y'] + bounds['height']/2


def drag_desk(page, target, dx=0, dy=0, *, destination=None, hold=False):
    x,y = object_point(page,target)
    bounds = page.locator(DESK).bounding_box()
    end = destination or (x+dx*bounds['width'],y+dy*bounds['height'])
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(*end,steps=10)
    if not hold:
        page.mouse.up()


def open_dossier(page):
    desk = page.locator(DESK)
    drag_desk(page,'cord',.20)
    expect(desk).to_have_attribute('data-dossier','untied')
    drag_desk(page,'cover',dy=-.24)
    expect(desk).to_have_attribute('data-dossier','open')


def visible_motion(new, previous):
    with Image.open(BytesIO(new)) as active, Image.open(BytesIO(previous)) as resting:
        return max(ImageStat.Stat(ImageChops.difference(active.convert('RGB'),resting.convert('RGB'))).mean)


def exercise_desk(page, screen, right_first=False, shot=None):
    desk = page.locator(DESK)
    mirror = screen.locator(DESK)
    expect(desk).to_have_attribute('data-space','ready',timeout=18000)
    expect(mirror).to_have_attribute('data-space','ready',timeout=18000)
    button(page,'动手查证').click()
    if right_first:
        open_dossier(page)
    desk.press('ArrowRight')
    expect(mirror).to_have_attribute('data-yaw','4.000')
    canvas=desk.locator('canvas')
    before=canvas.screenshot()
    drag_desk(page,'page-forward',-.058,hold=True)
    expect(desk).to_have_attribute('data-gesture','page')
    expect(mirror).to_have_attribute('data-gesture','page')
    assert visible_motion(canvas.screenshot(),before) > .12, '拖动时纸面没有可见变化'
    if shot:
        shot('斜看拖页中',page)
        shot('投影同步拖页',screen)
    page.mouse.up()
    expect(mirror).to_have_attribute('data-gesture','')
    expect(mirror).to_have_attribute('data-spread','0')
    for spread in (1,2,3,4):
        drag_desk(page,'page-forward',-.22)
        expect(mirror).to_have_attribute('data-spread',str(spread))
    drag_desk(page,'page-back',.21)
    expect(mirror).to_have_attribute('data-spread','3')
    if not right_first:
        expect(desk).to_have_attribute('data-dossier','sealed')
        open_dossier(page)
    expect(mirror).to_have_attribute('data-dossier','open')

    center=object_point(page,'table')
    edge=desk.bounding_box()
    for target,attr,direction in [('discussion-sheet','data-sheet-discussion',1),('before-sheet','data-sheet-before',-1)]:
        drag_desk(page,target,destination=(center[0]+direction*edge['width']*.062,center[1]))
        expect(desk).not_to_have_attribute(attr,'')
        expect(mirror).to_have_attribute(attr,desk.get_attribute(attr))
    page.mouse.click(*object_point(page,'discussion-sheet'))
    expect(mirror).to_have_attribute('data-gesture','inspect')
    if shot:
        shot('会议讨论页近看',page)
    page.keyboard.press('Escape')
    expect(mirror).to_have_attribute('data-gesture','')

    drag_desk(page,'map',-.17,dy=-.12)
    expect(mirror).to_have_attribute('data-map','original')
    drag_desk(page,'overlay',dy=-.26)
    expect(mirror).to_have_attribute('data-map','both')
    drag_desk(page,'overlay',dy=-.26)
    expect(mirror).to_have_attribute('data-map','original')
    button(page,'叠看两条路线').click()
    expect(mirror).to_have_attribute('data-map','both')
    pose={key:desk.get_attribute(key) for key in ('data-spread','data-dossier','data-sheet-discussion','data-sheet-before','data-map','data-yaw')}
    if shot:
        shot('两份证据与叠图',page)
    button(page,'结束查证').click()
    expect(mirror).to_have_attribute('data-inquiry','off')
    return pose


def enter_lesson(page, url):
    page.goto(url)
    button(page, '开始授课').click()
    button(page, '进入课堂').click()
    expect(page.locator('.scene-head h1')).to_have_text('于都集结')


def entry(room, url):
    page = room.teacher
    enter_lesson(page, url)
    slide = page.locator('.classroom-slide')
    expect(slide).to_have_attribute('data-entry-phase','ready',timeout=18000)
    if room.reduced:
        button(page,'下一页').click()
        expect(slide).to_have_attribute('data-entry-phase','ready')
        expect(page.locator('.slide-line')).to_have_attribute('data-narration-writing','false')
        expect(page.locator('.narration-row:visible')).to_have_text('于都群众送来木料，帮助架设浮桥。')
        room.steps.append('减少动态效果时直接显示完整布局和讲述')
        return
    page.evaluate('''() => {
      window.entryPhases = [];
      window.entrySamples = [];
      new MutationObserver(records => {
        const slide = document.querySelector('.classroom-slide');
        const phase = slide?.dataset.entryPhase;
        if (slide?.querySelector('h1').textContent === '岸边备桥' &&
          phase && entryPhases.at(-1) !== phase) entryPhases.push(phase);
        const line=slide?.querySelector('.slide-line');
        if (line && (phase==='narration' || phase==='ready')) {
          const rect=line.getBoundingClientRect();
          entrySamples.push({title:slide.querySelector('h1').textContent,phase,size:[rect.width,rect.height],
            writing:line.dataset.narrationWriting==='true'});
        }
      }).observe(document.querySelector('#app'), {subtree:true,childList:true,attributes:true,attributeFilter:['data-entry-phase']});
    }''')
    button(page, '下一页').click()
    expect(slide).to_have_attribute('data-entry-phase','ready',timeout=18000)
    phases = page.evaluate('entryPhases')
    assert phases == ['picture','layout','narration','ready'], phases
    button(page, '下一页').click()
    expect(slide).to_have_attribute('data-entry-phase','ready',timeout=18000)
    samples=page.evaluate('entrySamples.filter(sample=>sample.title==="浮桥近景")')
    typing=next((sample for sample in samples if sample['phase']=='narration'),None)
    assert typing and typing['writing'] and samples[-1]['size']==typing['size'], samples
    page.keyboard.press('PageUp')
    page.keyboard.press('PageDown')
    expect(page.locator('.scene-head h1')).to_have_text('浮桥近景')
    expect(slide).to_have_attribute('data-entry-phase','ready',timeout=18000)
    expect(page.locator('.narration-row:visible')).to_have_text('浮桥由船体和桥板组成。')
    room.steps.append('画面、布局、讲述依次入场，连翻保留当前句')


def opening(room, url):
    page = room.teacher
    page.goto(url)
    room.project()
    button(page, '开始授课').click()
    film = page.locator('.opening-page video')
    expect(film).to_be_visible()
    page.wait_for_function('document.querySelector(".opening-page video").currentTime > .4')
    button(page, '暂停短片').click()
    expect(film).to_have_js_property('paused',True)
    frozen = film.evaluate('video => video.currentTime')
    room.shot('开场暂停')
    assert abs(film.evaluate('video => video.currentTime')-frozen) < .1
    button(page, '继续播放').click()
    page.wait_for_function('time => document.querySelector(".opening-page video").currentTime > time',arg=frozen)
    for target in (page, room.screen):
        target.locator('.opening-page video').evaluate('v => { v.currentTime = Math.max(0, v.duration - 1.2); }')
    page.wait_for_function('''() => {
      const video=document.querySelector('.opening-page video');
      return video.duration>85 && video.currentTime>=video.duration-.22;
    }''',timeout=15000)
    room.shot('开场收尾')
    button(page, '进入课堂').click()
    expect(room.screen.locator('.scene-head h1')).to_have_text('于都集结')
    room.steps.append('双屏播放、暂停续播、进入于都集结')


def desk(room, url):
    page = room.teacher
    page.goto(url + '#desk')
    desk_area = page.locator('.desk-live-frame')
    expect(desk_area).to_have_attribute('data-space','ready', timeout=20000)
    expect(desk_area).to_have_attribute('data-dossier','sealed',timeout=3500)
    room.project()
    expected=exercise_desk(page,room.screen,right_first=True,shot=room.shot)
    drag_desk(page,'page-forward',-.11,hold=True)
    expect(desk_area).to_have_attribute('data-gesture','page')
    page.keyboard.press('PageUp')
    expect(page.locator('.scene-head h1')).to_have_text('遵义会议室')
    page.mouse.up()
    button(page,'下一页').click()
    expect(desk_area).to_have_attribute('data-space','ready')
    for field,value in expected.items():
        expect(desk_area).to_have_attribute(field,value)
        expect(room.screen.locator(DESK)).to_have_attribute(field,value)
    room.close_projection()
    room.project()
    for field,value in expected.items():
        expect(room.screen.locator(DESK)).to_have_attribute(field,value)
    room.shot('重连后仍在原位',room.screen)
    room.steps.append('真实翻页、松绳、揭封、摆置、提近、叠图，手势未松开切页后只恢复已提交状态，重连保持位置')


FEATURES = {check.__name__:check for check in (opening, entry, desk, narration, disclosures, journeys, controls)}
