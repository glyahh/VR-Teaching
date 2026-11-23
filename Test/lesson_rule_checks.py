from math import isclose

from playwright.sync_api import expect

from course_cli import button


def heading(page, title):
    expect(page.locator("h1")).to_have_text(title)


def onward(page, title):
    button(page, "下一页").click()
    heading(page, title)


def begin(page):
    button(page, "开始授课").click()
    button(page, "进入课堂").click()
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


def narration(room, url):
    page = room.teacher
    page.goto(url)
    screen = room.project()
    begin(page)
    first = "第五次反“围剿”失败后，中央红军开始战略转移。"
    expect(caption(page)).to_have_attribute("data-narration-writing", "true")
    page.mouse.click(*blank(page))
    narrated(page, first)
    expect(caption(screen).locator(".visually-hidden")).to_have_text(first)
    expect(caption(page)).to_have_attribute("data-narration-count", "1")
    x, y = blank(page)
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 48, y + 20, steps=6)
    page.mouse.move(x, y)
    page.mouse.up()
    expect(caption(page)).to_have_attribute("data-narration-count", "1")
    page.mouse.click(x, y)
    narrated(page, "各路队伍在于都集结。出发前，得先渡过于都河。")
    onward(page, "岸边备桥")
    onward(page, "浮桥近景")
    narrated(page, "浮桥由船体和桥板组成。")
    boat = "木船托住桥面。船舷上的纵梁把船和桥板连在一起。"
    button(page, "船体").click()
    narrated(page, boat, "point")
    narrated(screen, boat, "point")
    expect(caption(page)).to_have_attribute("data-narration-count", "1")
    room.close_projection()
    screen = room.project()
    narrated(screen, boat, "point")
    page.mouse.click(*blank(page))
    narrated(page, "先看桥下面的船，再看铺在上面的木板。")
    expect(caption(screen)).to_have_attribute("data-narration-count", "2")
    room.shot("圆点后接回主讲", screen)
    button(page, "结束双屏").click()
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
    button(page, "标绘渡江区域").click()
    narrated(page, "中央红军在全州、兴安之间抢渡湘江。灌阳也在战役涉及范围内。红军在这里突破了第四道封锁线。", "point")
    frames = page.evaluate("captionFrames")
    fading = [frame for frame in frames if 0 < frame["opacity"] < .99]
    assert fading and 190 < fading[-1]["at"] - fading[0]["at"] < 340, fading
    assert all(frame["rows"] <= 2 for frame in frames)
    assert fading[-1]["offset"] < fading[0]["offset"] < 0, fading
    full = next(frame for frame in frames if frame["text"] == fading[0]["text"])
    assert fading[0]["at"] - full["at"] >= 800, (full, fading[0])
    expect(caption(page).locator(".narration-row:visible").last).to_contain_text("封锁线。")
    assert caption(page).locator(".narration-row:visible").evaluate_all(
        "rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1)")
    room.shot("窄窗两行与尾字")
    page.keyboard.press("Escape")
    narrated(page, "中央红军在广西全州、兴安之间渡过湘江。")
    room.steps.append("主讲连点、圆点、空白推进、宽窗一行和窄窗淡出已验证")


def disclosures(room, url):
    page = room.teacher
    page.goto(url)
    screen = room.project()
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
        summary = screen.locator(".assembly-conclusion")
        for count, index in enumerate((2,0,1), 1):
            item = rows.nth(index)
            item.press("Enter") if count == 1 else item.click()
            expect(item).to_have_attribute("aria-expanded", "true")
            shown = panel.locator(".story-detail:visible")
            expect(shown).to_have_count(1)
            expect(screen.locator(".story-detail:visible")).to_have_text(shown.inner_text())
            expect(screen.locator(".story-stop:visible")).to_have_count(count)
            if finished and count < 3:
                expect(summary).to_be_hidden()
            if count == 2:
                item.press("Space")
                expect(shown).to_have_count(0)
                if finished:
                    room.close_projection()
                    screen = room.project()
                    summary = screen.locator(".assembly-conclusion")
                    expect(screen.locator(".story-stop:visible")).to_have_count(2)
                    expect(screen.locator(".story-detail:visible")).to_have_count(0)
                    expect(summary).to_be_hidden()
        if title == "组织问题":
            page.locator(".practice-entry").click()
            button(page,"返回原页").click()
            expect(rows.nth(1)).to_have_attribute("aria-expanded", "true")
    expect(summary).to_be_visible()
    screen.set_viewport_size({"width":1024, "height":480})
    expect(summary).to_be_in_viewport(ratio=.90)
    room.shot("窄投影读结论", screen)
    button(page, "课堂回顾").click()
    onward(page, "全课结论")
    expect(screen.locator(".review-conclusion")).to_be_hidden()
    button(page, "揭示结论").click()
    expect(screen.locator(".review-conclusion")).to_be_visible()
    button(page, "地图").click()
    for trial in range(2):
        button(page, "教师备课").click()
        button(page, "开始遵义 3 分钟试讲").click()
        onward(page, "会议桌上的两份材料")
        onward(page, "遵义会议的转折意义")
        expect(page.locator(".assembly-conclusion")).to_be_hidden()
        if trial == 0:
            for name in ("湘江受挫","黎平转向","遵义调整"):
                button(page,name).click()
            expect(page.locator(".assembly-conclusion")).to_be_visible()
        button(page,"结束试讲").click()
    begin(page)
    button(page,"遵义会议").click()
    for title in ("会议桌上的两份材料","军事问题","组织问题","遵义会议的转折意义"):
        onward(page,title)
    expect(page.locator(".assembly-conclusion")).to_be_hidden()
    expect(screen.locator(".story-stop:visible")).to_have_count(0)
    room.steps.append("遵义三页乱序开合、重连、练习返回、试讲重开和正式授课重置已验证")


def journeys(room, url):
    page = room.teacher
    page.goto(url)
    screen = room.project()
    begin(page)
    for title in ("岸边备桥", "浮桥近景", "夜渡于都河"):
        onward(page, title)
    for index, (title, places) in enumerate((
        ("湘江河谷", ["于都", "湘江"]), ("黎平翘街", ["湘江", "通道", "黎平"]),
    )):
        onward(page, title)
        layer = page.locator(".spatial-journey")
        expect(layer).to_have_attribute("data-phase", "near")
        expect(layer).to_have_attribute("data-terrain", "relief")
        expect(caption(screen)).to_have_attribute("data-narration-count", "0")
        page.wait_for_function("""names => {
          const nodes = [...document.querySelectorAll('.spatial-journey[data-phase=near] .spatial-station')];
          return names.every(name => nodes.some(node => node.textContent === name && Number(getComputedStyle(node).opacity) > .5));
        }""", arg=places, timeout=2500)
        assert layer.locator('.journey-route .past').evaluate(
            "line => getComputedStyle(line).strokeDasharray === 'none'")
        close_width = layer.locator(".journey-world").evaluate("world => world.clientWidth")
        room.shot(f"路段{index+1}近景")
        overview = screen.locator(".spatial-journey")
        expect(overview).to_have_attribute("data-phase", "overview")
        expect(layer).to_have_attribute("data-route-progress", "1.000")
        assert layer.locator(".journey-world").evaluate("world => world.clientWidth") < close_width
        expect(caption(screen)).to_have_attribute("data-narration-count", "0")
        expect(overview.locator(".spatial-station").filter(has_text="遵义")).not_to_have_css("opacity","0")
        room.shot(f"路段{index+1}总览", screen)
        expect(layer).to_have_count(0)
        expect(caption(screen)).to_have_attribute("data-narration-count", "1")
        if index == 0:
            for page_title in ("湘江渡口", "兵力对照", "渡江之后"):
                onward(page, page_title)
    button(page,"上一页").click()
    heading(page,"渡江之后")
    button(page,"下一页").click()
    page.keyboard.press("PageDown")
    heading(page,"进军方向")
    expect(screen.locator(".spatial-journey")).to_have_count(0)
    expect(caption(screen).locator(".visually-hidden")).to_have_text("原计划是去湘西北，与红二、红六军团会合。")
    room.steps.append("两段按近景描线、拉远、总览、进场顺序播放，连翻只保留当前页")


def controls(room, url):
    page = room.teacher
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
    expect(button(page,"播放备桥短片")).to_be_visible()
    onward(page,"浮桥近景")
    button(page,"于都河岸").click()
    dock = page.locator("#river-tools")
    expect(dock).to_be_visible(timeout=16000)
    expect(dock.locator("progress")).to_have_count(0)
    action = button(page,"到桥头")
    expect(action).to_be_visible()
    alignment = action.evaluate("""node => {
      const {left,right,bottom,height} = node.getBoundingClientRect();
      const frame = document.querySelector('.scene-stage').getBoundingClientRect();
      const next = document.querySelector('[data-lesson-action=next]').getBoundingClientRect();
      const instruction = document.querySelector('#river-instruction');
      const note = instruction.getBoundingClientRect();
      const top = document.querySelector('.scene-actions').getBoundingClientRect();
      return [left+right-frame.left-frame.right,bottom-next.bottom,height-next.height,
        getComputedStyle(node).backgroundColor,note.top-top.bottom-(top.top-frame.top),
        getComputedStyle(instruction).backgroundColor, getComputedStyle(instruction).fontWeight];
    }""")
    assert all(abs(alignment[i]) <= 3 for i in (0,1,2,4)), alignment
    assert alignment[3].endswith(", 0.1)") and alignment[5] == "rgba(0, 0, 0, 0)" and alignment[6] == "400", alignment
    action.click()
    page.wait_for_function("Number(document.querySelector('#river-tools').dataset.progress) > .15")
    button(page,"暂停").click()
    paused = float(dock.get_attribute("data-progress"))
    expect(dock).to_have_attribute("data-playback", "paused")
    button(page,"继续").click()
    page.wait_for_function("p => Number(document.querySelector('#river-tools').dataset.progress) > p", arg=paused)
    room.shot("河岸控件和右上说明")
    page.set_viewport_size({"width":414,"height":811})
    note = page.locator("#river-instruction")
    assert note.evaluate("""node => {
      const {left,right} = node.getBoundingClientRect();
      const frame = node.closest('.lesson-exploration').getBoundingClientRect();
      return left >= frame.left && right <= frame.right && getComputedStyle(node).textWrapStyle === 'balance';
    }"""), "右上说明在窄窗越界或未使用均衡折行"
    page.set_viewport_size({"width":1366,"height":768})
    button(page,"返回浮桥").click()
    onward(page,"夜渡于都河")
    expect(button(page,"暂停短片")).to_have_count(0)
    expect(button(page,"静态画面")).to_have_count(0)
    page.wait_for_function("document.querySelector('video.is-visible')?.currentTime > .2")
    page.emulate_media(reduced_motion="reduce")
    expect(page.locator(".scene-camera video")).to_be_hidden()
    page.emulate_media(reduced_motion="no-preference")
    page.wait_for_function("document.querySelector('video.is-visible')?.currentTime > .2")
    room.steps.append("拖卡片后滑行、边界与点击通过，地图底栏和河岸控件位置已实测")
