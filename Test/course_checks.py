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


def exercise_desk(page, right_first=False, shot=None):
    desk = page.locator(DESK)
    expect(desk).to_have_attribute('data-space', 'ready', timeout=18000)
    canvas = desk.locator('canvas')
    raw_forward = object_point(page, 'page-forward')
    page.mouse.move(raw_forward[0]-30, raw_forward[1]+7)
    expect(canvas).to_have_css('cursor','pointer')
    expect(desk.locator('.desk-inquiry-cue')).to_contain_text('拖动翻页')

    if right_first:
        open_dossier(page)
    desk.press('ArrowRight')
    expect(desk).to_have_attribute('data-yaw', '4.000')
    before = canvas.screenshot()
    drag_desk(page, 'page-forward', -.040, hold=True)
    expect(desk).to_have_attribute('data-gesture', 'page')
    assert visible_motion(canvas.screenshot(), before) > .12, '拖动时纸面没有可见变化'
    if shot:
        shot('01-斜看翻页中', page)
    page.mouse.up()
    expect(desk).to_have_attribute('data-gesture', '')
    expect(desk).to_have_attribute('data-spread', '0')

    for spread in (1, 2):
        drag_desk(page, 'page-forward', -.22)
        expect(desk).to_have_attribute('data-spread', str(spread))
    drag_desk(page, 'page-back', .21)
    expect(desk).to_have_attribute('data-spread', '1')

    button(page, '翻阅左册 · 会前形势').click()
    reader = page.locator('.desk-reader')
    expect(reader.get_by_role('heading', name='会前手记')).to_be_visible()
    expect(desk).to_have_attribute('data-focus', '1.000')
    if shot:
        shot('03-手记正读', page)
    page.keyboard.press('ArrowRight')
    page.keyboard.press('ArrowRight')
    page.keyboard.press('ArrowRight')
    expect(desk).to_have_attribute('data-spread', '4')
    expect(reader.get_by_role('heading', name='遵义会前')).to_be_visible()
    book = reader.locator('.desk-reader-book')
    box = book.bounding_box()
    x, y = box['x']+box['width']*.23, box['y']+box['height']*.35
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(x+box['width']*.17,y,steps=8)
    expect(reader.locator('.desk-reader-turn')).to_be_visible()
    assert desk.get_attribute('data-spread') == '4'
    page.mouse.up()
    expect(desk).to_have_attribute('data-spread', '3')
    expect(reader.get_by_role('heading', name='渡过乌江')).to_be_visible()
    page.keyboard.press('Escape')
    expect(reader).to_be_hidden()
    expect(desk).to_have_attribute('data-focus', '0.000')
    expect(desk).to_have_attribute('data-yaw', '4.000')
    expect(button(page, '翻阅左册 · 会前形势')).to_be_focused()

    if not right_first:
        expect(desk).to_have_attribute('data-dossier', 'sealed')
        open_dossier(page)
    expect(desk).to_have_attribute('data-dossier', 'open')

    center = object_point(page, 'table')
    edge = desk.bounding_box()
    for target,attr,direction in [('discussion-sheet','data-sheet-discussion',1),('before-sheet','data-sheet-before',-1)]:
        drag_desk(page,target,destination=(center[0]+direction*edge['width']*.062,center[1]))
        expect(desk).not_to_have_attribute(attr,'')
        expect(desk).to_have_attribute(attr,desk.get_attribute(attr))
    page.mouse.click(*object_point(page,'discussion-sheet'))
    expect(reader.get_by_role('heading',name='会议讨论')).to_be_visible()
    expect(reader.locator('.desk-reader-surface')).to_have_css('opacity','1')
    if shot:
        shot('05-会议讨论纸页正读',page)
    page.keyboard.press('Escape')
    expect(reader).to_be_hidden()

    drag_desk(page,'map',-.17,dy=-.12)
    expect(desk).to_have_attribute('data-map','original')
    drag_desk(page,'overlay',dy=-.26)
    expect(desk).to_have_attribute('data-map','both')
    drag_desk(page,'overlay',dy=-.26)
    expect(desk).to_have_attribute('data-map','original')
    # 在摊开的实际纸面上点选，进入与圆点入口相同的正视阅读。
    page.mouse.click(*object_point(page,'overlay'))
    plots=page.locator('.desk-map-plots')
    expect(plots).to_have_attribute('data-mode','original')
    expect(plots).to_have_attribute('data-drawing','false')
    expect(plots.locator('[data-place="湘西北"] span')).to_be_visible()
    expect(plots.locator('[data-place="遵义"]')).to_have_count(0)
    if shot:
        shot('06-原议湘西',page)
    button(page,'改向黔北').click()
    expect(plots).to_have_attribute('data-mode','revised')
    expect(plots).to_have_attribute('data-drawing','false')
    expect(plots.locator('[data-place="遵义"] span')).to_be_visible()
    expect(plots.locator('[data-place="湘西北"]')).to_have_count(0)
    if shot:
        shot('07-改向黔北',page)
    button(page,'叠加').click()
    expect(plots).to_have_attribute('data-mode','both')
    expect(plots).to_have_attribute('data-drawing','false')
    expect(plots.locator('figure')).to_have_count(1)
    expect(plots.locator('[data-place="遵义"] span')).to_be_visible()
    expect(plots.locator('[data-place="湘西北"] span')).to_be_visible()
    if shot:
        shot('08-同图叠加',page)
    button(page,'并排').click()
    expect(plots).to_have_attribute('data-mode','parallel')
    expect(plots).to_have_attribute('data-drawing','false')
    expect(plots.locator('figure')).to_have_count(2)
    expect(plots.locator('figure[data-route="original"] [data-place="湘西北"] span')).to_be_visible()
    expect(plots.locator('figure[data-route="revised"] [data-place="遵义"] span')).to_be_visible()
    assert plots.locator('figure').nth(0).bounding_box()['x'] < plots.locator('figure').nth(1).bounding_box()['x']
    if shot:
        shot('09-同尺度并排',page)
    button(page,'返回桌面').click()
    expect(reader).to_be_hidden()
    expect(desk).to_have_attribute('data-focus','0.000')
    expect(desk).to_have_attribute('data-yaw','4.000')
    return {key:desk.get_attribute(key) for key in (
        'data-spread','data-dossier','data-sheet-discussion','data-sheet-before','data-map','data-yaw',
    )}


def enter_lesson(page, url):
    page.goto(url)
    button(page, '开始授课').click()
    button(page, '进入课堂').click()
    expect(page.locator('.scene-head h1')).to_have_text('于都集结')


def single_screen(room, url):
    page = room.page
    page.goto(url)
    for name in ('遵义实景', '教师备课', '开始双屏授课', '双屏授课'):
        expect(button(page, name)).to_have_count(0)
    expect(page.locator('#presenter')).to_have_count(0)
    expect(button(page, '课堂回顾')).to_be_visible()
    room.shot('单屏首页')
    page.locator('.timeline button').filter(has_text='遵义会议').click()
    button(page, '进入「遵义会议」场景').click()
    expect(page.locator('.scene-head h1')).to_have_text('遵义会议室')
    button(page, '下一页').click()
    expect(page.locator(DESK)).to_have_attribute('data-space', 'ready', timeout=20000)
    expect(button(page, '双屏授课')).to_have_count(0)
    button(page, '翻阅左册 · 会前形势').click()
    expect(page.get_by_role('heading', name='会前手记')).to_be_visible()
    room.shot('从章节进入会议桌')
    assert page.context.pages == [page]

    legacy = page.context.new_page()
    try:
        legacy.goto(url + '#projection=' + '0' * 32)
        expect(button(legacy, '开始授课')).to_be_visible()
        expect(legacy.locator('#presenter,.projection-mode')).to_have_count(0)
    finally:
        legacy.close()
    room.steps.append('单屏首页、遵义章节、会议桌和旧投影链接已验证')


def entry(room, url):
    page = room.page
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
    page = room.page
    page.goto(url)
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
    page.locator('.opening-page video').evaluate('v => { v.currentTime = Math.max(0, v.duration - 1.2); }')
    page.wait_for_function('''() => {
      const video=document.querySelector('.opening-page video');
      return video.duration>85 && video.currentTime>=video.duration-.22;
    }''',timeout=15000)
    room.shot('开场收尾')
    button(page, '进入课堂').click()
    expect(page.locator('.scene-head h1')).to_have_text('于都集结')
    room.steps.append('播放、暂停续播、进入于都集结')


def desk(room, url):
    page = room.page
    page.goto(url + '#desk')
    desk_area = page.locator('.desk-live-frame')
    expect(desk_area).to_have_attribute('data-space','ready', timeout=20000)
    expect(desk_area).to_have_attribute('data-dossier','sealed',timeout=3500)
    expected=exercise_desk(page,right_first=True,shot=room.shot)
    drag_desk(page,'page-forward',-.11,hold=True)
    expect(desk_area).to_have_attribute('data-gesture','page')
    page.keyboard.press('PageUp')
    expect(page.locator('.scene-head h1')).to_have_text('遵义会议室')
    page.mouse.up()
    button(page,'下一页').click()
    expect(desk_area).to_have_attribute('data-space','ready')
    for field,value in expected.items():
        expect(desk_area).to_have_attribute(field,value)
    room.shot('回到桌景仍在原位')
    room.steps.append('真实翻页、松绳、揭封、摆置、提近、叠图，手势未松开切页后只恢复已提交状态')


FEATURES = {check.__name__:check for check in (single_screen, opening, entry, desk, narration, disclosures, journeys, controls)}
