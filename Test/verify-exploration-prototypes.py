"""验收单个离线样课中的第一人称、河岸漫游和物件操作。"""

from io import BytesIO
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import expect, sync_playwright
from exploration_input import drag, elapsed_frames, walk


ROOT = Path(__file__).resolve().parents[1]
FILE = ROOT / "展示材料" / "遵义自由探索原型" / "室内与河岸-交互原型.html"
QA = ROOT / ".march-build" / "roam-prototypes" / "qa"
VIEWPORTS = [(1920, 1080), (1366, 768), (412, 915)]


def center(node):
    box = node.bounding_box()
    assert box is not None, "物件标签不在画面内"
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def region(page, x, y, width, height):
    raw = page.screenshot(clip={"x": x, "y": y, "width": width, "height": height})
    return Image.open(BytesIO(raw)).convert("RGB")


def mean_difference(first, second):
    return sum(ImageStat.Stat(ImageChops.difference(first, second)).mean) / 3


def mode(page, title):
    tab = page.get_by_role("navigation", name="切换场景").get_by_role("button", name=title, exact=True)
    tab.click()
    expect(tab).to_have_attribute("aria-current", "page", timeout=26000)
    expect(page.locator("#restart")).to_be_enabled(timeout=30000)


def check_reading_layout(page, dock, actions, caption, *, framed=True):
    width = page.viewport_size["width"]
    for selector in [".heading", ".toolbar", dock, actions, caption, "#reading", "#reading-title"]:
        node = page.locator(selector)
        box = node.bounding_box()
        assert 0 <= box["x"] and box["x"] + box["width"] <= width + 1, (selector, box)
    assert abs(center(page.locator(dock))[0] - width / 2) < 1
    assert page.locator(dock).evaluate("""(node, framed) => {
      const style = getComputedStyle(node);
      const grain = getComputedStyle(node, '::before');
      if (!framed) return style.borderWidth === '0px' && style.backdropFilter === 'none' &&
        style.backgroundColor === 'rgba(0, 0, 0, 0)' && grain.backgroundImage === 'none';
      return style.borderWidth === '1px' && style.borderStyle === 'solid' &&
        style.boxShadow === 'none' && style.backdropFilter.includes('blur(') &&
        grain.backgroundImage !== 'none' && Number(grain.opacity) > 0 && grain.pointerEvents === 'none';
    }""", framed), ("材料厅提示框应使用细边和磨砂" if framed else "河岸按钮组应直接透出场景")
    panel = page.locator("#reading").bounding_box()
    header = page.locator(".hud").bounding_box()
    dock_box = page.locator(dock).bounding_box()
    hint = page.locator(caption).bounding_box()
    buttons = page.locator(actions).bounding_box()
    navigation = page.locator(".modes").bounding_box()
    assert header["y"] + header["height"] <= panel["y"]
    assert panel["y"] + panel["height"] < dock_box["y"]
    assert dock_box["y"] + dock_box["height"] < navigation["y"]
    if width <= 680:
        assert hint["y"] + hint["height"] <= buttons["y"]
    else:
        assert hint["x"] + hint["width"] < buttons["x"]
    assert buttons["y"] + buttons["height"] <= dock_box["y"] + dock_box["height"]


def verify_walk(page):
    area = page.locator("#stage")
    marker = page.get_by_role("button", name="行军图", exact=True)
    expect(area).to_have_attribute("data-area", "庭院入口")
    hud = page.locator(".hud")
    navigation = page.locator(".modes")
    dock = page.locator("#inspect")
    hotspots = page.locator("#markers")
    expect(marker).to_be_visible()
    page.evaluate("""() => {
      const hud = document.querySelector('.hud');
      hud.addEventListener('transitionend', event => {
        if (event.target === hud && event.propertyName === 'opacity') {
          window.walkControlsRevealed = getComputedStyle(hud).opacity === '1';
        }
      });
    }""")
    stationary = region(page, 420, 225, 530, 300)
    page.keyboard.down("a")
    for overlay in [hud, dock, hotspots, navigation]:
        expect(overlay).to_be_hidden()
    expect(page.locator("#view")).to_be_visible()
    assert area.evaluate("node => getComputedStyle(node, '::after').opacity") == "0"
    elapsed_frames(page, 0.26)
    assert mean_difference(stationary, region(page, 420, 225, 530, 300)) > 4, "收起界面后没有继续步行"
    page.screenshot(path=QA / "A-步行时收起界面.png")
    page.keyboard.down("ArrowUp")
    page.keyboard.up("a")
    expect(hud).to_be_hidden()
    page.keyboard.up("ArrowUp")
    page.wait_for_function("window.walkControlsRevealed === true", timeout=5000)
    expect(dock).to_be_visible()
    expect(navigation).to_have_css("opacity", "1")
    expect(hotspots).to_have_css("opacity", "1")
    page.screenshot(path=QA / "A-停步后恢复界面.png")

    page.keyboard.down("ArrowUp")
    expect(hud).to_be_hidden()
    page.evaluate("window.dispatchEvent(new Event('blur'))")
    expect(hud).to_be_visible()
    page.keyboard.up("ArrowUp")
    page.get_by_role("button", name="重新开始", exact=True).click()
    expect(area).to_have_attribute("data-area", "庭院入口")
    page.screenshot(path=QA / "A-庭院入口.png")
    x, y = center(marker)
    drag(page, 22, 0)
    assert center(marker)[0] < x - 24, "右拉时相机没有转向右侧"
    drag(page, -22, 0)
    drag(page, 0, 24)
    assert center(marker)[1] < y - 14, "下拉时相机没有朝下"
    drag(page, 0, -24)
    marker.click()
    expect(page.locator("#instruction")).to_contain_text("走近行军图")

    drag(page, 69, 0)
    walk(page, "a", 1.52)
    walk(page, "w", 1.04)
    page.keyboard.press("e")
    expect(page.locator("#instruction")).to_contain_text("原定的会合路线还能走吗")
    elapsed_frames(page, 0.30)
    first_route = region(page, 470, 275, 360, 217)
    expect(page.locator("#summary")).to_be_visible()
    drag(page, 385, 0, start=(683, 384))
    expect(page.locator("#summary")).to_be_visible()
    expect(page.locator("#reading")).to_be_hidden()
    changed_route = region(page, 470, 275, 360, 217)
    assert mean_difference(first_route, changed_route) > 0.6, "拖动未改变现场路线"
    page.screenshot(path=QA / "增强版-A-拨图.png")
    page.locator("#summary").click()
    expect(page.locator("#finding")).to_contain_text("黎平会议决定改向黔北")
    expect(page.locator("#finding")).to_contain_text("建立新的根据地")
    expect(page.locator("#detail")).to_contain_text("还没与友军会合，就可能先遇上一场硬仗")
    page.screenshot(path=QA / "A-行军图-改向背景.png", animations="disabled")
    page.keyboard.press("Escape")
    expect(page.locator("#reading")).to_be_hidden()
    expect(page.locator("#summary")).to_be_focused()
    page.mouse.click(732, 458)
    expect(page.locator("#reading-title")).to_have_text("黎平")
    expect(page.locator("#finding")).to_contain_text("12 月 18 日")
    page.get_by_role("button", name="收起材料").click()
    route_stops = page.get_by_role("combobox", name="行军地点")
    route_stops.select_option("乌江")
    expect(page.locator("#reading-title")).to_have_text("乌江")
    expect(page.locator("#finding")).to_contain_text("黔北")
    expect(page.locator("a[href], area[href], form[action]")).to_have_count(0)
    page.get_by_role("button", name="收起材料").click()
    expect(page.locator("#reading")).to_be_hidden()
    page.screenshot(path=QA / "A-行军图乌江.png")
    page.locator("#leave").click()
    elapsed_frames(page, 0.30)

    walk(page, "d", 0.76)
    walk(page, "w", 1.12)
    expect(area).to_have_attribute("data-area", "庭院")
    walk(page, "d", 0.94)
    walk(page, "w", 0.60)
    expect(area).to_have_attribute("data-area", "材料厅")
    walk(page, "a", 1.06)
    page.keyboard.press("e")
    expect(page.locator("#instruction")).to_contain_text("拖动封面")
    elapsed_frames(page, 0.30)
    page.screenshot(path=QA / "A-手记封面.png")
    closed = region(page, 410, 255, 410, 275)
    page.mouse.move(683, 384)
    page.mouse.down()
    page.mouse.move(537, 344, steps=8)
    elapsed_frames(page, 0.08)
    midway = region(page, 410, 255, 410, 275)
    page.mouse.move(408, 319, steps=8)
    page.mouse.up()
    expect(page.get_by_role("button", name="下一页")).to_be_enabled()
    opened = region(page, 410, 255, 410, 275)
    assert mean_difference(closed, midway) > 2.0, "按住拖动期间封面没有移动"
    assert mean_difference(midway, opened) > 1.0, "第二段拖动没有继续翻页"
    expect(page.locator("#summary")).to_be_visible()
    expect(page.locator("#reading")).to_be_hidden()
    page.screenshot(path=QA / "增强版-A-掀页.png")
    next_page = page.get_by_role("button", name="下一页")
    previous = page.get_by_role("button", name="上一页")
    expect(page.locator("#instruction")).to_have_text("1 / 4")
    drag(page, 320, 56, start=(683, 384))
    expect(page.locator("#instruction")).to_have_text("拖动封面翻开")
    expect(next_page).to_be_enabled()
    reclosed = region(page, 410, 255, 410, 275)
    assert mean_difference(closed, reclosed) < mean_difference(closed, opened) / 2, "反向拖动未合上书页"

    next_page.click()
    expect(next_page).to_be_enabled()
    drag(page, -270, -55, start=(683, 384))
    expect(page.locator("#instruction")).to_have_text("2 / 4")
    expect(next_page).to_be_enabled()
    second = region(page, 456, 274, 378, 269)
    page.locator("#summary").click()
    expect(page.locator("#finding")).to_contain_text("红二、红六军团")
    expect(page.locator("#detail")).to_contain_text("12 月 18 日")
    expect(page.locator("a[href], area[href], form[action]")).to_have_count(0)
    page.get_by_role("button", name="收起材料").click()
    next_page.click()
    expect(page.locator("#instruction")).to_have_text("3 / 4")
    expect(next_page).to_be_enabled()
    third = region(page, 456, 274, 378, 269)
    assert mean_difference(second, third) > 1.0, "第三页的实际书面未变化"
    page.screenshot(path=QA / "A-手记第三页.png")
    next_page.click()
    expect(page.locator("#instruction")).to_have_text("4 / 4")
    expect(previous).to_be_enabled()
    expect(next_page).to_be_disabled()
    fourth = region(page, 456, 274, 378, 269)
    assert mean_difference(third, fourth) > 1.0, "第四页的实际书面未变化"
    page.screenshot(path=QA / "A-手记第四页.png")
    page.locator("#summary").click()
    expect(page.locator("#reading-title")).to_have_text("遵义会前")
    expect(page.locator("#finding")).to_contain_text("部队的军事指挥出了问题")
    expect(page.locator("#detail")).to_contain_text("多数中央领导人已对前期指挥的问题形成共识")
    for width, height in VIEWPORTS:
        page.set_viewport_size({"width": width, "height": height})
        elapsed_frames(page, 0.27)
        check_reading_layout(page, "#inspect", "#inspect .dock-actions", "#instruction")
        page.screenshot(path=QA / f"A-遵义会前-{width}.png")
    page.set_viewport_size({"width": 1366, "height": 768})
    page.get_by_role("button", name="收起材料", exact=True).click()
    expect(page.locator("#reading")).to_be_hidden()
    previous.click()
    expect(page.locator("#instruction")).to_have_text("3 / 4")
    expect(next_page).to_be_enabled()
    assert mean_difference(third, region(page, 456, 274, 378, 269)) < 0.45, "回翻的实际书页不一致"
    print("A 通过。步行收起界面、停步渐显、路线对照、地图点选与手记翻阅。", flush=True)


def verify_river(page):
    mode(page, "于都河岸")
    action = page.locator("#river-action")
    caption = page.locator("#river-instruction")
    progress = page.locator("#river-tools")
    east = page.locator(".river-label").filter(has_text="东门渡口")
    downstream = page.locator(".river-label").filter(has_text="下游渡口")
    supply = page.locator(".river-label").filter(has_text="备料岸")
    home = page.get_by_role("button", name="回全景", exact=True)
    page.evaluate("""() => {
      const tools = document.querySelector('#river-tools');
      let phase = tools.dataset.playback, start = 0, played = 0;
      window.beatSeconds = [];
      new MutationObserver(() => {
        const next = tools.dataset.playback;
        if (next === phase) return;
        const now = performance.now();
        if (phase === 'playing') played += now - start;
        if (next === 'playing') start = now;
        if ((next === 'waiting' || next === 'finished') && played > 0) {
          window.beatSeconds.push(played / 1000);
          played = 0;
        }
        phase = next;
      }).observe(tools, {attributes: true, attributeFilter: ['data-playback']});
    }""")

    def wait_at(text):
        expect(action).to_have_attribute("aria-label", text, timeout=60000)
        expect(progress.locator("progress")).to_have_count(0)
        elapsed_frames(page, 1.55)
        expect(action).to_have_attribute("aria-label", text)
        expect(progress.locator("progress")).to_have_count(0)

    expect(action).to_have_attribute("aria-label", "到桥头")
    expect(caption).to_contain_text("于都河上没有固定桥，八万多人得在夜里过河")
    expect(page.locator("#scene-previous")).to_be_hidden()
    bounds = action.bounding_box()
    initial_height = bounds["height"]
    sample = (round(bounds["x"]) + 6, round(bounds["y"]) + 8, 6, 22)
    backing = page.add_style_tag(content="#view, #stage::after { visibility: hidden; } #stage { background: #181818; }")
    dark_glass = region(page, *sample)
    backing.evaluate("style => style.textContent += '#stage { background: #f2f2f2; }'")
    bright_glass = region(page, *sample)
    backing.evaluate("style => style.remove()")
    assert mean_difference(dark_glass, bright_glass) > 16, "箭头按钮底色挡住了背景"
    expect(downstream).to_be_hidden()
    expect(supply).to_be_hidden()

    # 拖动只移动镜头。镜头回到全景后，用画布上的一次点击开始。
    x, y = center(east)
    drag(page, 132, 26, start=(640, 291))
    elapsed_frames(page, 0.45)
    current = center(east)
    assert abs(current[0] - x) > 16 or abs(current[1] - y) > 16, "环绕拖动没有改变画面"
    drag(page, 78, 0, start=(631, 250), button="right")
    elapsed_frames(page, 0.38)
    expect(action).to_have_attribute("aria-label", "到桥头")
    home.click()
    page.screenshot(path=QA / "分段演示-入口.png")

    page.locator("#view").click(position={"x": 700, "y": 427})
    expect(action).to_have_attribute("aria-label", "暂停")
    page.wait_for_function("Number(document.querySelector('#river-tools').dataset.progress) > 0.18")
    action.click()
    expect(action).to_have_attribute("aria-label", "继续")
    assert action.bounding_box()["height"] == initial_height
    frozen = float(progress.get_attribute("data-progress"))
    snapshot = region(page, 400, 240, 490, 280)
    elapsed_frames(page, 0.47)
    assert float(progress.get_attribute("data-progress")) == frozen, "暂停后演示仍在推进"
    assert mean_difference(snapshot, region(page, 400, 240, 490, 280)) < 0.35, "暂停后场景画面发生了变化"
    mode(page, "遵义材料厅")
    expect(page.locator("#stage")).to_have_attribute("data-area", "材料厅")
    expect(page.locator("#summary")).to_be_visible()
    expect(page.locator("#reading")).to_be_hidden()
    elapsed_frames(page, 0.50)
    assert float(progress.get_attribute("data-progress")) == frozen, "切走河岸后进度变化了"
    mode(page, "于都河岸")
    expect(action).to_have_attribute("aria-label", "继续")
    assert float(progress.get_attribute("data-progress")) == frozen, "返回河岸后播放位置没有保留"
    expect(page.locator("#scene-previous")).to_be_hidden()
    assert mean_difference(snapshot, region(page, 400, 240, 490, 280)) < 0.50, "返回时河岸机位或画面变了"
    page.screenshot(path=QA / "连续切换-河岸恢复.png")
    action.click()
    wait_at("看桥下")
    expect(caption).to_contain_text("岸边还有人等")
    page.screenshot(path=QA / "于都夜渡-桥头.png")

    action.click()
    wait_at("看架桥")
    expect(caption).to_contain_text("缺船")
    page.screenshot(path=QA / "于都夜渡-桥下.png")

    part_button = page.get_by_role("button", name="看构件", exact=True)
    ready_view = region(page, 350, 195, 590, 340)
    part_button.click()
    ship = page.get_by_role("button", name="船体", exact=True)
    beam = page.get_by_role("button", name="纵梁", exact=True)
    board = page.get_by_role("button", name="木板", exact=True)
    expect(ship).to_have_attribute("aria-pressed", "true")
    expect(caption).to_contain_text("船舷")
    elapsed_frames(page, 0.46)
    ship_view = region(page, 350, 195, 590, 340)
    beam.click()
    expect(beam).to_have_attribute("aria-pressed", "true")
    expect(caption).to_contain_text("露出的纵梁")
    elapsed_frames(page, 0.46)
    assert mean_difference(ship_view, region(page, 350, 195, 590, 340)) > 3, "剖看纵梁没有改变现场"
    page.screenshot(path=QA / "B-纵梁剖看.png")
    board.click()
    expect(caption).to_contain_text("等待铺上纵梁")
    elapsed_frames(page, 0.46)
    page.get_by_role("button", name="返回", exact=True).click()
    expect(action).to_have_attribute("aria-label", "看架桥")
    expect(part_button).to_be_focused()
    assert mean_difference(ready_view, region(page, 350, 195, 590, 340)) < 0.55, "返回后未恢复演示画面"

    action.click()
    page.wait_for_function("Number(document.querySelector('#river-tools').dataset.progress) > 0.46")
    page.screenshot(path=QA / "于都夜渡-抬板.png")
    wait_at("看夜渡")
    expect(caption).to_contain_text("铰链孔")
    page.screenshot(path=QA / "于都夜渡-落板.png")
    part_button.click()
    page.get_by_role("button", name="门板", exact=True).click()
    expect(caption).to_contain_text("旧铰链孔")
    elapsed_frames(page, 0.52)
    page.screenshot(path=QA / "B-门板观察.png")
    page.keyboard.press("Escape")
    expect(action).to_have_attribute("aria-label", "看夜渡")
    history = page.get_by_role("button", name="史料", exact=True)
    history.click()
    expect(page.locator("#detail")).to_contain_text("船主误工的三十块")
    expect(page.locator("a[href], area[href], form[action]")).to_have_count(0)
    expect(page.locator("#river-recall")).to_be_hidden()
    page.get_by_role("button", name="收起材料", exact=True).click()
    expect(history).to_be_focused()

    action.click()
    wait_at("看收桥")
    expect(caption).to_contain_text("夜里能过河的时间有限")
    night = region(page, 320, 220, 550, 320)
    page.screenshot(path=QA / "于都夜渡-夜渡.png")
    action.click()
    page.wait_for_function("Number(document.querySelector('#river-tools').dataset.progress) > 0.44")
    page.screenshot(path=QA / "于都夜渡-撤桥中.png")
    wait_at("重播")
    expect(caption).to_contain_text("白天的浮桥容易被敌机发现")
    times = page.evaluate("window.beatSeconds")
    expected = [3.65, 3.1, 3.95, 3.6, 3.9]
    assert len(times) == len(expected) and all(abs(a - b) < 0.65 for a, b in zip(times, expected)), times
    print("五段实际播放秒数", [round(value, 2) for value in times], flush=True)
    dawn = region(page, 320, 220, 550, 320)
    assert mean_difference(night, dawn) > 4, "收桥前后画面没有明显变化"
    assert action.bounding_box()["height"] == initial_height
    page.screenshot(path=QA / "于都夜渡-拂晓.png")

    close = page.get_by_role("button", name="收起材料", exact=True)
    history.click()
    expect(page.locator("#finding")).to_contain_text("8 处渡口")
    expect(page.locator("#detail")).to_contain_text("脚印也可能泄露大队人马的行踪")
    expect(page.locator("#comparison")).to_contain_text("单处过河 6 组，两处分流过河 11 组")
    night_recall = page.get_by_role("button", name="夜渡", exact=True)
    night_recall.click()
    expect(page.locator("#reading")).to_be_hidden()
    expect(history).to_be_focused()
    assert mean_difference(night, region(page, 320, 220, 550, 320)) < 1.25, "夜渡回看机位或内容变化"
    history.click()
    expect(night_recall).to_have_attribute("aria-pressed", "true")
    page.get_by_role("button", name="收桥后", exact=True).click()
    expect(page.locator("#reading")).to_be_hidden()
    expect(history).to_be_focused()
    assert mean_difference(dawn, region(page, 320, 220, 550, 320)) < 0.70, "收桥后回看画面不一致"

    for width, height in VIEWPORTS:
        page.set_viewport_size({"width": width, "height": height})
        history.click()
        elapsed_frames(page, 0.35)
        check_reading_layout(page, "#river-tools", "#river-actions", "#river-instruction", framed=False)
        page.screenshot(path=QA / f"于都夜渡-史料-{width}.png")
        close.click()
        expect(page.locator("#reading")).to_be_hidden()
    page.set_viewport_size({"width": 1366, "height": 768})
    action.click()
    expect(action).to_have_attribute("aria-label", "暂停")
    expect(caption).to_contain_text("沿土路")
    expect(history).to_be_hidden()
    print("B 通过。五段停留、原位续播、同机位回看、史料揭示、三种尺寸及重播。", flush=True)


def main():
    QA.mkdir(parents=True, exist_ok=True)
    with TemporaryDirectory(prefix="exploration-v2-") as temp, sync_playwright() as playwright:
        local = Path(temp) / "prototype.html"
        shutil.copy2(FILE, local)
        with playwright.chromium.launch(channel="msedge", headless=True) as browser:
            with browser.new_context(offline=True, viewport={"width": 1366, "height": 768}) as context:
                unexpected = []
                errors = []
                context.on("request", lambda request: unexpected.append(request.url)
                           if not request.url.startswith(("data:", "blob:"))
                           and urldefrag(request.url).url != local.as_uri() else None)
                page = context.new_page()
                page.on("pageerror", lambda error: errors.append(str(error)))
                page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
                page.goto(local.as_uri())
                assert page.evaluate("!navigator.onLine")
                expect(page.locator("#restart")).to_be_enabled(timeout=30000)
                try:
                    page.evaluate("""() => {
                      window.lessonSwitches = [];
                      const canvas = document.querySelector('#scene-previous');
                      new MutationObserver(() => {
                        if (canvas.hidden) return;
                        const ctx = canvas.getContext('2d');
                        const brightness = [.27, .52, .71].reduce((sum, x) => {
                          const pixel = ctx.getImageData(Math.floor(x * canvas.width), Math.floor(canvas.height * .54), 1, 1).data;
                          return sum + pixel[0] + pixel[1] + pixel[2];
                        }, 0);
                        window.lessonSwitches.push({ mode: document.body.dataset.mode, brightness });
                      }).observe(canvas, { attributes: true, attributeFilter: ['hidden'] });
                    }""")
                    verify_walk(page)
                    verify_river(page)
                    switches = page.evaluate("window.lessonSwitches")
                    assert [shot["mode"] for shot in switches] == ["river", "walk", "river"], switches
                    assert all(shot["brightness"] > 30 for shot in switches), switches
                    page.emulate_media(reduced_motion="reduce")
                    mode(page, "遵义材料厅")
                    expect(page.locator("#stage")).to_have_attribute("data-area", "材料厅")
                    expect(page.locator("#scene-previous")).to_be_hidden()
                    assert len(page.evaluate("window.lessonSwitches")) == 3
                    expect(page.locator("#summary")).to_be_visible()
                    page.locator("#summary").click()
                    expect(page.locator("#reading-title")).to_have_text("渡过乌江")
                    expect(page.locator("a[href], area[href], form[action], #help, .foot")).to_have_count(0)
                    assert len(context.pages) == 1
                    assert not errors, errors
                    assert not unexpected, unexpected
                except Exception:
                    page.screenshot(path=QA / "增强版-失败.png")
                    print("浏览器错误", errors, "外部请求", unexpected, flush=True)
                    raise
            assert list(Path(temp).iterdir()) == [local]


if __name__ == "__main__":
    main()

