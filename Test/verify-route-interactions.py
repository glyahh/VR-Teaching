from argparse import ArgumentParser
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
from playwright.sync_api import expect, sync_playwright
from exploration_input import drag, elapsed_frames, walk
from course_checks import drag_desk, open_dossier

ROOT = Path(__file__).resolve().parents[1]
COURSE = ROOT / "课堂演示" / "从于都到遵义-课堂演示.html"


def button(page, name):
    return page.get_by_role("button", name=name, exact=True)


def open_projection(teacher, viewport, reopen=False):
    with teacher.expect_popup() as popup:
        button(teacher, "重新打开投影" if reopen else "开始双屏授课").click()
    screen = popup.value
    screen.set_viewport_size(viewport)
    expect(teacher.locator(".presenter-status")).to_have_text("投影已连接", timeout=15000)
    return screen


def page_is(page, name):
    expect(page.locator(".scene-head h1")).to_have_text(name)


def next_page(page):
    button(page, "下一页").click()


def river(teacher, screen):
    button(teacher, "开始授课").click()
    button(teacher, "进入课堂").click()
    next_page(teacher)
    page_is(teacher, "岸边备桥")
    expect(teacher.locator(".probe-pin")).to_have_count(1)
    next_page(teacher)
    button(teacher, "于都河岸").click()
    dock = teacher.locator("#river-tools")
    for name in ("到桥头", "看桥下", "看架桥", "看夜渡", "看收桥"):
        action = teacher.locator("#river-action")
        expect(action).to_have_attribute("aria-label", name, timeout=12000)
        action.click()
    expect(dock).to_have_attribute("data-playback", "finished", timeout=12000)
    read_pose = "() => {const {eye,target,zoom}=explorationActivity.read().state;return [eye,target,zoom]}"
    recall_view = teacher.evaluate(read_pose)
    button(teacher, "分流对照").click()
    expect(screen.locator("#river-tools")).to_have_attribute("data-comparing", "")
    allocation = teacher.locator("#river-allocation")
    compare = teacher.locator("#river-run-comparison")
    view = teacher.evaluate(read_pose)
    compare.click()
    teacher.wait_for_function("Number(document.querySelector('#river-tools').dataset.progress) > .12")
    compare.click()
    expect(screen.locator("#river-tools")).to_have_attribute("data-playback", "paused")
    compare.click()
    expect(screen.locator("#river-instruction")).to_have_text("未过河 6 组", timeout=13000)
    for _ in range(6):
        allocation.press("ArrowRight")
    compare.click()
    expect(screen.locator("#river-instruction")).to_have_text("未过河 1 组", timeout=13000)
    assert teacher.evaluate(read_pose) == view
    expect(dock).to_have_attribute("data-progress", "1")
    print("同机位显示一处通行与两处分流的不同候渡结果，暂停和投影同步通过", flush=True)
    return recall_view


def journey_and_routes(teacher, screen, recall_view):
    teacher.locator("#river-allocation").press("Escape")
    expect(screen.locator("#river-tools")).not_to_have_attribute("data-comparing", "")
    assert teacher.evaluate("() => {const {eye,target,zoom}=explorationActivity.read().state;return [eye,target,zoom]}") == recall_view
    next_page(teacher)
    page_is(teacher, "夜渡于都河")
    expect(teacher.locator(".journey-departure")).to_have_count(1)
    next_page(teacher)
    page_is(teacher, "湘江河谷")
    layer = teacher.locator(".journey-layer")
    expect(layer.locator(".journey-route .past")).to_have_count(1)
    expect(layer.locator(".spatial-station").filter(has_text="湘江")).to_have_count(1)
    expect(layer).to_have_count(0)
    for _ in range(4):
        next_page(teacher)
    page_is(teacher, "黎平翘街")
    expect(screen.locator(".journey-layer")).to_have_count(0)
    next_page(teacher)
    marker = teacher.get_by_role("slider", name="行军标记")
    box = marker.bounding_box()
    middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    drag(teacher, 180, 0, start=middle)
    expect(marker).to_have_attribute("data-side", "east")
    expect(screen.locator(".march-marker")).to_have_attribute("data-side", "east")
    box = marker.bounding_box()
    middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    drag(teacher, -360, 0, start=middle)
    expect(marker).to_have_attribute("data-side", "west")
    expect(screen.locator(".march-marker")).to_have_attribute("data-side", "west")
    button(teacher, "兵力对照").click()
    expect(screen.locator(".liping-troop-record strong")).to_have_text(["8.6 万余人", "3 万余人"])
    print("路线过场、桌图拖动与两时点兵力同屏通过", flush=True)


def wujiang_and_desk(teacher, screen):
    next_page(teacher)
    page_is(teacher, "猴场会议")
    next_page(teacher)
    page_is(teacher, "渡过乌江")
    assert teacher.locator(".probe-pin").count() == 0
    button(teacher, "看地形").click()
    expect(screen.locator(".wujiang-lens")).to_be_visible()
    expect(screen.locator(".wujiang-lens .terrain-surface canvas")).to_be_visible()
    route = screen.locator(".wujiang-lens path")
    top = route.get_attribute("d")
    button(teacher, "斜视").click()
    expect(route).not_to_have_attribute("d", top)
    next_page(teacher)
    hall_and_desk(teacher,screen)


def hall_and_desk(teacher, screen):
    page_is(teacher, "遵义会议室")
    button(teacher, "进入材料厅").click()
    hall = teacher.locator('.lesson-exploration[data-scene="zunyi-hall"][data-ready]')
    expect(hall).to_be_visible(timeout=18000)
    canvas = teacher.locator("#view")
    rect = canvas.bounding_box()
    center = (rect["x"] + rect["width"]/2, rect["y"] + rect["height"]/2)
    drag(teacher, 69, 0, start=center)
    walk(teacher, "a", 1.64)
    walk(teacher, "w", .84)
    teacher.keyboard.press("e")
    expect(teacher.locator("#instruction")).to_contain_text("拨动行军图")
    teacher.locator("#route-stops").select_option("乌江")
    expect(screen.locator("#reading-title")).to_have_text("乌江")
    button(teacher, "收起材料").click()
    elapsed_frames(teacher,.25)
    button(teacher, "会议桌").click()
    page_is(teacher, "会议桌上的两份材料")
    desk = teacher.locator(".desk-live-frame")
    expect(desk).to_have_attribute("data-space", "ready", timeout=16000)
    button(teacher, "乌江").click()
    evidence = screen.locator(".desk-reader .desk-reader-article")
    expect(evidence.get_by_role("heading", name="乌江")).to_be_visible()
    expect(screen.locator(".desk-live-frame")).to_have_attribute("data-map", "original")
    expect(evidence).to_contain_text("抵达遵义")
    button(teacher, "返回桌面").click()
    open_dossier(teacher)
    drag_desk(teacher,"discussion-sheet",-.15,dy=.06)
    expect(screen.locator(".desk-live-frame")).not_to_have_attribute("data-sheet-discussion", "")
    button(teacher,"乌江").click()
    button(teacher,"对照两份材料").click()
    expect(screen.locator(".desk-reader-pair .is-right h3")).to_have_text("会议讨论")
    expect(screen.locator(".desk-reader-pair .is-left h3")).to_have_text("乌江")
    print("遵义材料厅带入的乌江线索与会议讨论在双屏并排可读", flush=True)


def main():
    parser = ArgumentParser()
    parser.add_argument("--html", type=Path, default=COURSE)
    parser.add_argument("--desk-only", action="store_true", help="只验材料厅到会议桌的线索交接")
    args = parser.parse_args()
    with TemporaryDirectory() as folder, sync_playwright() as playwright:
        lesson=Path(folder)/"lesson.html"
        copyfile(args.html,lesson)
        with playwright.chromium.launch(channel="msedge",headless=True) as browser:
            context=browser.new_context(offline=True,viewport={"width":1366,"height":768})
            with context:
                teacher=context.new_page()
                errors=[]
                context.on("weberror",lambda event:errors.append(str(event.error)))
                teacher.goto(lesson.as_uri())
                assert not errors,errors
                viewport={"width":1920,"height":1080}
                screen=open_projection(teacher,viewport)
                if args.desk_only:
                    button(teacher,"开始授课").click()
                    button(teacher,"进入课堂").click()
                    teacher.locator(".chapter-nav").get_by_role("button",name="遵义会议",exact=True).click()
                    hall_and_desk(teacher,screen)
                    assert not errors,errors
                    return
                recall_view=river(teacher,screen)
                screen.close()
                screen=open_projection(teacher,viewport,True)
                expect(screen.locator("#river-instruction")).to_have_text("未过河 1 组")
                journey_and_routes(teacher,screen,recall_view)
                wujiang_and_desk(teacher,screen)
                assert not errors,errors


if __name__ == "__main__":
    main()
