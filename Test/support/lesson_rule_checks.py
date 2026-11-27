from contextlib import contextmanager
from math import isclose

from playwright.sync_api import expect

from course_cli import EXPLORATION_LOAD_TIMEOUT, VIDEO_COMPLETION_TIMEOUT, button, lesson_action


def heading(page, title):
    expect(page.locator("h1")).to_have_text(title)


def onward(page, title):
    lesson_action(page, "next").click()
    heading(page, title)


def begin(page):
    lesson_action(page, "start").click()
    lesson_action(page, "opening-next").click()
    heading(page, "于都集结")


def caption(page):
    return page.locator(".caption-copy > .slide-line")


def narrated(page, text, kind="main"):
    box = caption(page)
    expect(box).to_have_attribute("data-narration-view", kind)
    expect(box.locator(".visually-hidden")).to_have_text(text, timeout=10000)


def blank(page):
    bounds = page.locator(".scene-stage").bounding_box()
    return bounds["x"] + bounds["width"] * .56, bounds["y"] + bounds["height"] * .30


@contextmanager
def paused_clock(page):
    page.clock.pause_at(page.evaluate("new Date(Date.now() + 2000).toISOString()"))
    try:
        yield page.clock
    finally:
        page.clock.resume()


def narration(room, url):
    page = room.page
    page.clock.install()
    page.goto(url)
    begin(page)
    first = "第五次反“围剿”失败后，中央红军开始战略转移。"
    narrated(page, first)
    expect(caption(page).locator(".visually-hidden")).to_have_text(first)
    expect(caption(page)).to_have_attribute("data-narration-count", "1")
    x, y = blank(page)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 48, y + 20, steps=6)
    page.mouse.move(x, y)
    page.mouse.up()
    expect(caption(page)).to_have_attribute("data-narration-count", "1")
    # 校验非文字化微光刻度条存在，且在焦点移至标题时按全局空格键仍可推进字幕
    expect(caption(page).locator(".narration-pip")).to_have_count(3)
    page.locator(".scene-head h1").focus()
    page.keyboard.press("Space")
    narrated(page, "各路队伍在于都集结。出发前，得先渡过于都河。")
    onward(page, "岸边备桥")
    onward(page, "浮桥近景")
    narrated(page, "浮桥由船体和桥板组成。")
    expect(caption(page)).to_have_attribute("data-narration-writing", "false", timeout=10000)
    boat = "木船托住桥面。船舷上的纵梁把船和桥板连在一起。"
    button(page, "船体").click()
    narrated(page, boat, "point")
    expect(caption(page)).to_have_attribute("data-narration-count", "1")
    page.mouse.click(*blank(page))
    narrated(page, "先看桥下面的船，再看铺在上面的木板。")
    expect(caption(page)).to_have_attribute("data-narration-count", "2")
    room.shot("圆点后接回主讲")
    page.set_viewport_size({"width": 1063, "height": 811})
    button(page, "湘江战役").click()
    heading(page, "湘江河谷")
    narrated(page, "中央红军渡过湘江，突破第四道封锁线，遭受重大损失。")
    metrics = caption(page).evaluate("""box => {
      const text = box.querySelector('.narration-viewport');
      return [text.clientHeight, parseFloat(getComputedStyle(box).lineHeight),
              box.getBoundingClientRect().right, document.querySelector('.scene-navigation').getBoundingClientRect().left];
    }""")
    assert isclose(metrics[0], metrics[1], abs_tol=1.2) and metrics[2] <= metrics[3], metrics
    page.set_viewport_size({"width": 414, "height": 811})
    onward(page, "湘江渡口")
    narrated(page, "中央红军在广西全州、兴安之间渡过湘江。")
    onward(page, "湘江留下的启示")
    narrated(page, "有人守在江边，为后面的队伍争取过江时间。")
    page.evaluate("""() => {
      const box = document.querySelector('.slide-line');
      window.captionFrames = [];
      function sample(at) {
        if (!box.isConnected) return;
        const rows = [...box.querySelectorAll('.narration-row:not([hidden])')];
        if (box.dataset.narrationView === 'point') {
          const style = getComputedStyle(rows[0]);
          captionFrames.push({at, rows:rows.length, text:rows[0].textContent,
            opacity:Number(style.opacity), offset:new DOMMatrixReadOnly(style.transform).m42});
          if (box.dataset.narrationWriting === 'false') return;
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }""")
    with paused_clock(page) as clock:
        button(page, "回望渡口").press("Enter")
        clock.run_for(5500)
    narrated(page, "有人留在险处，把过江的时间让给战友。渡江以后，红军要带着这些教训继续往前走。", "point")
    frames = page.evaluate("captionFrames")
    fading = [frame for frame in frames if 0 < frame["opacity"] < .99]
    assert fading and 190 < fading[-1]["at"] - fading[0]["at"] < 340, fading
    assert all(frame["rows"] <= 2 for frame in frames)
    assert fading[-1]["offset"] < fading[0]["offset"] < 0, fading
    full = next(frame for frame in frames if frame["text"] == fading[0]["text"])
    assert fading[0]["at"] - full["at"] >= 800, (full, fading[0])
    expect(caption(page).locator(".narration-row:visible").last).to_contain_text("走。")
    assert caption(page).locator(".narration-row:visible").evaluate_all(
        "rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1)")
    room.shot("窄窗两行与尾字")
    page.keyboard.press("Escape")
    narrated(page, "有人守在江边，为后面的队伍争取过江时间。")
    room.steps.append("主讲连点、圆点、空白推进、宽窗一行和窄窗淡出已验证")


def disclosures(room, url):
    page = room.page
    page.goto(url)
    begin(page)
    button(page, "遵义会议").click()
    heading(page, "遵义会议室")
    onward(page, "会议桌上的两份材料")
    onward(page, "军事问题")
    panel = page.locator(".story-panel")
    for title in ("军事问题", "组织问题", "遵义会议的转折意义"):
        if title != "军事问题":
            onward(page, title)
        expect(panel.get_by_role("button")).to_have_count(3)
        rows = panel.locator(".story-step")
        finished = title == "遵义会议的转折意义"
        summary = page.locator(".assembly-conclusion")
        for count, index in enumerate((2,0,1), 1):
            item = rows.nth(index)
            item.press("Enter") if count == 1 else item.click()
            expect(item).to_have_attribute("aria-expanded", "true")
            shown = panel.locator(".story-detail:visible")
            expect(shown).to_have_count(1)
            expect(page.locator(".story-stop[data-revealed=true]")).to_have_count(count)
            if title in ("军事问题", "遵义会议的转折意义"):
                expect(page.locator(".story-shot.is-current")).to_have_count(1)
            if title == "组织问题":
                expect(page.locator(".organization-folder[data-open=true] .organization-finding")).to_have_text(item.inner_text())
            if finished and count < 3:
                expect(summary).to_be_hidden()
            if count == 2:
                item.press("Space")
                expect(shown).to_have_count(0)
        if title == "组织问题":
            page.locator(".practice-entry").click()
            button(page,"返回原页").click()
            expect(rows.nth(1)).to_have_attribute("aria-expanded", "true")
    expect(summary).to_be_visible()
    page.set_viewport_size({"width":1024, "height":480})
    expect(summary).to_be_in_viewport(ratio=.90)
    room.shot("窄窗读结论")
    button(page, "课堂回顾").click()
    button(page, "全景总结").click()
    heading(page, "全课结论")
    expect(page.locator(".review-conclusion")).to_be_hidden()
    button(page, "播放片尾").click()
    finale = page.locator(".recap-stage")
    expect(finale).to_have_attribute("data-playback", "playing")
    expect(page.locator('.recap-memory[data-station="xiang"]')).to_be_visible(timeout=7000)
    button(page, "暂停").click()
    expect(finale).to_have_attribute("data-playback", "paused")
    frozen_route = page.locator(".recap-path-glow").get_attribute("d")
    page.wait_for_timeout(400)
    assert page.locator(".recap-path-glow").get_attribute("d") == frozen_route
    button(page, "继续播放").click()
    expect(finale).to_have_attribute("data-playback", "finished", timeout=20000)
    expect(page.locator(".review-conclusion")).to_be_visible(timeout=20000)
    room.shot("课尾遵义破晓与返回地图")
    button(page, "返回地图").click()
    begin(page)
    button(page,"遵义会议").click()
    for title in ("会议桌上的两份材料","军事问题","组织问题","遵义会议的转折意义"):
        onward(page,title)
    expect(page.locator(".assembly-conclusion")).to_be_hidden()
    expect(page.locator(".story-stop[data-revealed=true]")).to_have_count(0)
    room.steps.append("遵义三页乱序开合、练习返回和重新开课重置已验证")


def journeys(room, url):
    page = room.page
    page.clock.install()
    page.goto(url)
    expect(page.locator(".map .terrain-surface.is-relief")).to_be_visible(timeout=20000)
    begin(page)
    for title in ("岸边备桥", "浮桥近景", "夜渡于都河"):
        page.keyboard.press("PageDown")
        heading(page, title)
    for index, (title, places, after_titles) in enumerate((
        ("湘江河谷", ["于都", "湘江"], ("湘江渡口", "湘江留下的启示", "渡江之后")),
        ("黎平翘街", ["湘江", "通道", "黎平"], ("进军方向",)),
        ("猴场会议", ["黎平", "猴场"], ()),
        ("渡过乌江", ["猴场", "乌江"], ()),
        ("遵义会议室", ["乌江", "遵义"], ()),
    )):
        layer = page.locator(".spatial-journey")
        with paused_clock(page) as clock:
            page.keyboard.press("PageDown")
            heading(page, title)
            clock.fast_forward(650)
            expect(layer).to_have_attribute("data-phase", "near")
            expect(layer).to_have_attribute("data-terrain", "relief")
            expect(caption(page)).to_have_attribute("data-narration-count", "0")
            assert layer.evaluate("""(layer, names) => {
              const visible = [...layer.querySelectorAll('.spatial-station')].filter(node =>
                Number(getComputedStyle(node).opacity) > .5).map(node => node.textContent);
              return names.every(name => visible.includes(name));
            }""", places), places
            expect(layer.locator(".journey-route .past")).to_have_css("stroke-dasharray", "none")
            if title == "猴场会议":
                expect(layer.locator(".spatial-abandoned")).to_have_count(1)
            close_width = layer.locator(".journey-world").evaluate("world => world.clientWidth")
            if index < 3:
                room.shot(f"路段{index+1}近景")
            clock.fast_forward(2150)
            expect(layer).to_have_attribute("data-phase", "overview")
            expect(layer).to_have_attribute("data-route-progress", "1.000")
            assert layer.locator(".journey-world").evaluate("world => world.clientWidth") < close_width
            expect(caption(page)).to_have_attribute("data-narration-count", "0")
            expect(layer.locator(".spatial-station").filter(has_text="遵义")).not_to_have_css("opacity", "0")
            if index < 3:
                room.shot(f"路段{index+1}总览")
            clock.fast_forward(1000)
        expect(caption(page)).to_have_attribute("data-narration-count", "1", timeout=10000)
        assert layer.count() == 0, f"{title} 已开始讲述，过场仍在"
        for page_title in after_titles:
            page.keyboard.press("PageDown")
            heading(page, page_title)
    button(page,"湘江战役").click()
    heading(page,"渡江之后")
    button(page,"下一页").click()
    page.keyboard.press("PageDown")
    heading(page,"进军方向")
    expect(page.locator(".spatial-journey")).to_have_count(0)
    expect(page.locator('.classroom-slide[data-activity="directions"] .march-marker')).to_be_visible()
    room.steps.append("全线五段按近景描线、拉远、总览、进场顺序播放，连翻只保留当前页")


def controls(room, url):
    page = room.page
    page.goto(url)
    card = page.locator(".event-card")
    tools = page.locator(".map-tools")
    expect(tools.locator("xpath=..").locator(".timeline")).to_have_count(1)
    assert page.locator(".top h1").evaluate("node => getComputedStyle(node,'::before').content") == "none", "地图标题仍有左侧竖线"
    geometry = tools.evaluate("""node => {
      const tools = node.getBoundingClientRect();
      const rail = node.previousElementSibling.getBoundingClientRect();
      return [tools.left - rail.right, (tools.top + tools.bottom - rail.top - rail.bottom)/2];
    }""")
    assert geometry[0] >= 8 and abs(geometry[1]) < 5, geometry
    expect(card).to_have_attribute("data-movable","")
    card_box = card.bounding_box()
    x, y = card_box["x"] + 70, card_box["y"] + 36
    page.mouse.move(x,y)
    page.mouse.down()
    page.mouse.move(x+95,y+24,steps=7)
    pressed = card.bounding_box()
    page.mouse.up()
    page.wait_for_function("x => document.querySelector('.event-card').getBoundingClientRect().left > x + 10",
                           arg=pressed["x"], timeout=3500)
    card_box = card.bounding_box()
    page.mouse.move(card_box["x"] + 70,card_box["y"] + 36)
    page.mouse.down()
    page.mouse.move(12,100,steps=8)
    page.mouse.up()
    map_box = page.locator(".map").bounding_box()
    clamped = card.bounding_box()
    assert clamped["x"] >= map_box["x"] + 10
    assert clamped["y"] >= map_box["y"] + 10
    assert clamped["x"] + clamped["width"] <= map_box["x"] + map_box["width"] - 10
    page.set_viewport_size({"width":414,"height":811})
    assert tools.evaluate("node => node.getBoundingClientRect().top >= node.previousElementSibling.getBoundingClientRect().bottom")
    page.set_viewport_size({"width":1366,"height":768})
    begin(page)
    onward(page,"岸边备桥")
    expect(lesson_action(page, "video-playback")).to_be_visible()
    onward(page,"浮桥近景")
    lesson_action(page, "tour-playback").click()
    expect(page.locator(".classroom-slide")).to_have_attribute("data-river-tour", "finished", timeout=VIDEO_COMPLETION_TIMEOUT)
    river_entry = page.locator('[data-river-entry]')
    river_entry.click()
    dock = page.locator("#river-tools")
    expect(dock).to_be_visible(timeout=EXPLORATION_LOAD_TIMEOUT)
    expect(dock.locator("progress")).to_have_count(0)
    expect(dock.locator("#river-action")).to_be_hidden()
    expect(button(page,"看构件")).to_be_visible()
    note = page.locator("#river-instruction")
    alignment = note.evaluate("""node => {
      const box = node.getBoundingClientRect();
      const tools = document.querySelector('.scene-actions').getBoundingClientRect();
      return box.top - tools.bottom;
    }""")
    assert alignment >= -2, alignment
    room.shot("河岸控件和右上说明")
    page.set_viewport_size({"width":414,"height":811})
    assert note.evaluate("""node => {
      const {left,right} = node.getBoundingClientRect();
      const frame = node.closest('.lesson-exploration').getBoundingClientRect();
      return left >= frame.left && right <= frame.right && getComputedStyle(node).textWrapStyle === 'balance';
    }"""), "右上说明在窄窗越界或未使用均衡折行"
    page.set_viewport_size({"width":1366,"height":768})
    river_entry.click()
    onward(page,"夜渡于都河")
    expect(lesson_action(page, "video-playback")).to_have_count(0)
    expect(lesson_action(page, "video-still")).to_have_count(0)
    page.wait_for_function("document.querySelector('video.is-visible')?.currentTime > .2")
    page.emulate_media(reduced_motion="reduce")
    expect(page.locator(".scene-camera video")).to_be_hidden()
    page.emulate_media(reduced_motion="no-preference")
    page.wait_for_function("document.querySelector('video.is-visible')?.currentTime > .2")
    room.steps.append("拖卡片后滑行、边界与点击通过，地图底栏和河岸控件位置已实测")
