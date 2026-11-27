from io import BytesIO

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import expect
from course_cli import EXPLORATION_LOAD_TIMEOUT, SCREENSHOT_TIMEOUT
from .lesson_rule_checks import narration, disclosures, journeys, controls


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
    expect(desk).to_have_attribute('data-space', 'ready', timeout=EXPLORATION_LOAD_TIMEOUT)
    canvas = desk.locator('canvas.desk-live-canvas')
    raw_forward = object_point(page, 'page-forward')
    page.mouse.move(raw_forward[0]-30, raw_forward[1]+7)
    expect(canvas).to_have_css('cursor','pointer')
    expect(desk.locator('.desk-inquiry-cue')).to_contain_text('拖动翻页')

    if right_first:
        open_dossier(page)
    desk.press('ArrowRight')
    expect(desk).to_have_attribute('data-yaw', '4.000')
    clip = canvas.bounding_box()
    assert clip, '会议桌画布不可见'
    before = page.screenshot(clip=clip, timeout=SCREENSHOT_TIMEOUT)
    drag_desk(page, 'page-forward', -.040, hold=True)
    expect(desk).to_have_attribute('data-gesture', 'page')
    after = page.screenshot(clip=clip, timeout=SCREENSHOT_TIMEOUT)
    assert visible_motion(after, before) > .12, '拖动时纸面没有可见变化'
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
        button(page,'下一页').click()
        expect(page.locator('.scene-head h1')).to_have_text('浮桥近景')
        expect(slide).to_have_attribute('data-river-tour','ready')
        expect(page.locator('.river-tour')).to_be_hidden()
        expect(page.locator('.lesson-exploration')).to_have_count(0)
        expect(button(page,'于都河岸')).to_be_visible()
        expect(button(page,'进入河岸')).to_be_hidden()
        room.steps.append('减少动态效果时直接显示完整布局和讲述，保留河岸视频入口')
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

    def seek_to(seconds):
        film.evaluate('''(video, seconds) => new Promise(resolve => {
          video.addEventListener('seeked', resolve, {once:true});
          video.currentTime = seconds;
        })''', seconds)

    seek_to(41.2)
    expect(page.locator('.opening-troops')).to_have_count(0)
    expect(page.locator('.opening-sub')).to_contain_text('出发时八万六千余人')
    room.shot('湘江涉水与字幕')

    timeline = page.locator('.opening-timeline')
    for seconds, lit_count in ((84.2, 1), (85.4, 2), (86.1, 3), (87.5, 4)):
        seek_to(seconds)
        expect(timeline).to_be_visible()
        expect(timeline.locator('[data-lit=true]')).to_have_count(lit_count)
        layout = timeline.evaluate('''node => {
          const rect = selector => node.querySelector(selector).getBoundingClientRect();
          const centerX = r => (r.left + r.right) / 2;
          const centerY = r => (r.top + r.bottom) / 2;
          const track = rect('.opening-tl-track');
          const fill = rect('.opening-tl-fill');
          const stops = [...node.querySelectorAll('.opening-tl-stop')].map(stop => {
            const [date, dot, label] = [...stop.children].map(child => child.getBoundingClientRect());
            return {x:centerX(dot), y:centerY(dot), date:centerX(date), label:centerX(label)};
          });
          return {stops, left:track.left, right:track.right, y:centerY(track), fill:fill.right,
            bottom:node.getBoundingClientRect().bottom,
            subtitleTop:node.closest('.opening-hud').querySelector('.opening-sub').getBoundingClientRect().top};
        }''')
        stops = layout['stops']
        for stop in stops:
            assert abs(stop['x'] - stop['date']) < 1 and abs(stop['x'] - stop['label']) < 1, layout
            assert abs(stop['y'] - layout['y']) < 1, layout
        assert abs(layout['left'] - stops[0]['x']) < 1 and abs(layout['right'] - stops[-1]['x']) < 1, layout
        assert layout['bottom'] < layout['subtitleTop'], layout
        assert layout['fill'] >= stops[lit_count - 1]['x'] - 1, layout
        if lit_count < len(stops):
            assert layout['fill'] < stops[lit_count]['x'], layout
    room.shot('片头四站时间轴')

    seek_to(86.1)
    button(page, '继续播放').click()
    expect(timeline.locator('[data-lit=true]')).to_have_count(4)
    expect(timeline).to_be_hidden()
    film.evaluate('''video => {
      window.openingTiming = {};
      video.addEventListener('ended', () => {
        window.openingTiming.ended = performance.now();
        window.openingTiming.holdsFrame = video.isConnected && video.classList.contains('is-visible');
      }, {once:true});
      const observer = new MutationObserver(() => {
        if (!document.querySelector('.classroom-slide')) return;
        window.openingTiming.entered = performance.now();
        observer.disconnect();
      });
      observer.observe(document.querySelector('#app'), {childList:true});
      video.currentTime = video.duration - .7;
    }''')
    expect(page.locator('.scene-head h1')).to_have_text('于都集结', timeout=5500)
    delay = page.evaluate('openingTiming.entered - openingTiming.ended')
    assert page.evaluate('openingTiming.holdsFrame')
    assert 1980 <= delay < 3300, delay
    room.shot('自动进入于都集结')

    def start_near_end():
        page.goto(url)
        button(page, '开始授课').click()
        page.wait_for_function('document.querySelector(".opening-page video").currentTime > .15')
        expect(page.locator('.opening-page')).to_have_attribute('data-entry-phase', 'ready')
        film.evaluate('video => { video.currentTime = video.duration - .4; }')
        expect(film).to_have_js_property('ended', True)

    start_near_end()
    button(page, '地图').click()
    page.wait_for_timeout(2200)
    expect(button(page, '开始授课')).to_be_visible()

    start_near_end()
    button(page, '重播').click()
    page.wait_for_function('''() => {
      const video = document.querySelector('.opening-page video');
      return video && !video.paused && video.currentTime > 2;
    }''')
    button(page, '进入课堂').click()
    expect(page.locator('.scene-head h1')).to_have_text('于都集结')
    room.steps.append(f'片头自然播完后 {delay:.0f} 毫秒自动入课，片尾返回地图、重播与手动进入通过')


def recap(room, url):
    page = room.page
    page.goto(url)
    button(page, '课堂回顾').click()
    expect(page.locator('.recap-world .terrain-surface.is-relief')).to_be_visible(
        timeout=EXPLORATION_LOAD_TIMEOUT)
    card = page.locator('.recap-card')
    close = button(page, '收起站点卡片')
    for title in ('于都出发', '湘江战役', '黎平会议', '遵义会议'):
        page.wait_for_function("""() => {
          const world = document.querySelector('.recap-world');
          return new DOMMatrixReadOnly(getComputedStyle(world).transform).a <= 1.01;
        }""")
        node = button(page, title + '，查看视觉回顾')
        ring = node.locator('.recap-node-ring')
        ring.hover(force=True)
        expect(page.locator(".recap-node:hover")).to_have_attribute("data-station", node.get_attribute("data-station"))
        expect(node).to_have_css('background-color', 'rgba(0, 0, 0, 0)')
        box = ring.bounding_box()
        point = [box['x'] + box['width'] / 2, box['y'] + box['height'] / 2]
        page.mouse.move(*point)
        assert node.evaluate('(node, [x,y]) => node.contains(document.elementFromPoint(x,y))', point), title
        page.mouse.down()
        try:
            page.wait_for_timeout(120)
            hit = node.evaluate('(node, [x,y]) => node.contains(document.elementFromPoint(x,y))', point)
        finally:
            page.mouse.up()
        expect(card).to_be_visible()
        assert hit, title
        expect(node).to_have_css('background-color', 'rgba(0, 0, 0, 0)')
        expect(node).to_have_attribute('aria-expanded', 'true')
        expect(card.get_by_role('heading', name=title)).to_be_visible()
        card.evaluate('node => Promise.allSettled(node.getAnimations().map(animation => animation.finished))')
        assert card.evaluate('''node => {
          const card = node.getBoundingClientRect();
          const header = document.querySelector('.recap-top').getBoundingClientRect();
          const footer = document.querySelector('.recap-footer').getBoundingClientRect();
          return card.top >= header.bottom && card.bottom <= footer.top && card.left >= 0 && card.right <= innerWidth;
        }'''), title
        if title == '湘江战役':
            room.shot('湘江站点卡片')
        close.click()
        expect(card).to_be_hidden()
        expect(node).to_be_focused()

    station = button(page, '湘江战役，查看视觉回顾')
    station.press('Enter')
    button(page, '回看现场').click()
    expect(page.locator('.scene-head h1')).to_have_text('湘江河谷')
    button(page, '返回回顾').click()
    expect(card.get_by_role('heading', name='湘江战役')).to_be_visible()
    button(page, '返回地图').click()
    expect(button(page, '开始授课')).to_be_visible()
    room.steps.append('四站实际鼠标点击、悬停底色、卡片边界、键盘回看和返回地图通过')


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


FEATURES = {check.__name__:check for check in (single_screen, opening, entry, desk, narration, disclosures, journeys, controls, recap)}
