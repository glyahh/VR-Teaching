from argparse import ArgumentParser
from pathlib import Path
import re
from playwright.sync_api import expect
from course_cli import COURSE, EXPLORATION_LOAD_TIMEOUT, VIDEO_COMPLETION_TIMEOUT, launch, lesson_action, size
from support.exploration_input import drag, elapsed_frames
from support.course_checks import drag_desk, open_dossier

def button(page, name):
    return page.get_by_role("button", name=name, exact=True)


def page_is(page, name):
    expect(page.locator(".scene-head h1")).to_have_text(name)


def next_page(page):
    lesson_action(page, "next").click()


def river(teacher, output):
    button(teacher, "开始授课").click()
    button(teacher, "进入课堂").click()
    next_page(teacher)
    page_is(teacher, "岸边备桥")
    expect(teacher.locator(".probe-pin")).to_have_count(1)
    next_page(teacher)
    page_is(teacher, "浮桥近景")
    lesson_action(teacher, "tour-playback").click()
    expect(teacher.locator(".classroom-slide")).to_have_attribute("data-river-tour", "finished", timeout=VIDEO_COMPLETION_TIMEOUT)
    teacher.locator("[data-river-entry]").click()
    dock = teacher.locator("#river-tools")
    expect(dock).to_have_attribute("data-observe", "", timeout=EXPLORATION_LOAD_TIMEOUT)
    expect(dock.locator("#river-action")).to_be_hidden()
    expect(dock.locator("#river-compare, #river-comparison")).to_have_count(0)
    read_pose = "() => {const {eye,target,zoom}=explorationActivity.read().state;return [eye,target,zoom]}"
    recall_view = teacher.evaluate(read_pose)
    history = button(teacher, "史料")
    history.click()
    reading = teacher.locator("#reading")
    expect(reading.get_by_role("heading", name="渡河计划")).to_be_visible()
    expect(dock.locator("#river-instruction")).to_be_hidden()
    expect(reading.locator(".river-plan-stats dd")).to_have_text(["8.6 万余人", "8 处", "5 座"])
    expect(reading.locator(".river-plan-timeline")).to_contain_text("野战军南渡贡水计划表")
    expect(reading.get_by_text("史料出处", exact=True)).to_have_count(0)
    expect(reading).not_to_contain_text("课堂推演")
    if output:
        teacher.screenshot(path=output / "于都渡河计划.png", animations="disabled")
    expect(button(teacher, "收桥后")).to_have_attribute("aria-pressed", "true")
    button(teacher, "夜渡").click()
    expect(reading).to_be_hidden()
    expect(history).to_be_focused()
    expect(dock.locator("#river-instruction")).to_contain_text("不同渡口")
    assert teacher.evaluate(read_pose) == recall_view

    history.click()
    expect(button(teacher, "夜渡")).to_have_attribute("aria-pressed", "true")
    button(teacher, "收桥后").click()
    expect(reading).to_be_hidden()
    expect(dock.locator("#river-instruction")).to_contain_text("拂晓前撤桥")
    assert teacher.evaluate(read_pose) == recall_view

    button(teacher, "看构件").click()
    expect(button(teacher, "船体")).to_be_visible()
    button(teacher, "纵梁").click()
    expect(dock.locator("#river-instruction")).to_contain_text("纵梁")
    dock.get_by_role("button", name="返回", exact=True).click()
    expect(dock.locator("#river-instruction")).to_contain_text("拂晓前撤桥")
    assert teacher.evaluate(read_pose) == recall_view
    print("渡河计划面板、同机位夜渡和收桥后、构件查看与归位通过", flush=True)


def journey_and_routes(teacher, output):
    next_page(teacher)
    page_is(teacher, "夜渡于都河")
    expect(teacher.locator(".journey-departure")).to_have_count(1)
    next_page(teacher)
    page_is(teacher, "湘江河谷")
    layer = teacher.locator(".journey-layer")
    expect(layer.locator(".journey-route .past")).to_have_count(1)
    expect(layer.locator(".spatial-station").filter(has_text="湘江")).to_have_count(1)
    expect(layer).to_have_count(0)
    next_page(teacher)
    page_is(teacher, "湘江渡口")
    next_page(teacher)
    page_is(teacher, "湘江留下的启示")
    expect(teacher.locator(".troop-hud")).to_have_count(0)
    button(teacher, "回望渡口").click()
    expect(teacher.locator("[data-activity=troops] .story-shot.is-current")).to_have_count(1)
    if output:
        expect(teacher.locator(".caption-copy")).to_contain_text("让给战友", timeout=9000)
        teacher.screenshot(path=output / "湘江回望渡口.png", animations="disabled")
    button(teacher, "回到岸上").click()
    expect(teacher.locator("[data-activity=troops] .story-shot.is-current")).to_have_count(0)
    button(teacher, "查兵力记录").click()
    expect(teacher.get_by_role("dialog")).to_contain_text("累计减员包含湘江战役前的损失")
    teacher.keyboard.press("Escape")
    next_page(teacher)
    next_page(teacher)
    page_is(teacher, "黎平翘街")
    expect(teacher.locator(".journey-layer")).to_have_count(0)
    next_page(teacher)
    marker = teacher.get_by_role("slider", name="行军标记")
    box = marker.bounding_box()
    middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    drag(teacher, 180, 0, start=middle)
    expect(marker).to_have_attribute("data-side", "east")
    expect(teacher.locator(".march-marker")).to_have_attribute("data-side", "east")
    box = marker.bounding_box()
    middle = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
    drag(teacher, -360, 0, start=middle)
    expect(marker).to_have_attribute("data-side", "west")
    expect(teacher.locator(".march-marker")).to_have_attribute("data-side", "west")
    print("路线过场与桌图拖动通过", flush=True)


def wujiang_and_desk(teacher, output):
    next_page(teacher)
    page_is(teacher, "猴场会议")
    expect(teacher.locator(".spatial-journey")).to_have_count(0, timeout=10000)
    march = teacher.get_by_role("group", name="从黎平到乌江的行军图")
    button(teacher, "抢渡乌江").click()
    expect(march.locator(".houchang-ink")).to_have_attribute("d", re.compile(r"M .* L .* L .*"))
    if output:
        teacher.screenshot(path=output / "猴场桌图.png", animations="disabled")
    button(teacher, "改向黔北").click()
    expect(march.locator(".houchang-ink")).to_have_attribute("d", "")
    next_page(teacher)
    page_is(teacher, "渡过乌江")
    expect(teacher.locator(".spatial-journey")).to_have_count(0, timeout=10000)
    button(teacher, "走近江岸").click()
    expect(teacher.locator(".scene-stage")).to_have_attribute("data-shore-view", "near")
    button(teacher, "退回岸上").click()
    expect(teacher.locator(".scene-stage")).to_have_attribute("data-shore-view", "wide")
    assert teacher.locator(".probe-pin").count() == 0
    button(teacher, "看地形").click()
    expect(teacher.locator(".wujiang-lens")).to_be_visible()
    expect(teacher.locator(".wujiang-lens .terrain-surface canvas")).to_be_visible()
    expect(teacher.locator(".wujiang-landmark")).to_have_text(["猴场", "乌江", "遵义"])
    route = teacher.locator(".wujiang-lens path")
    top = route.get_attribute("d")
    button(teacher, "斜视").click()
    expect(route).not_to_have_attribute("d", top)
    if output:
        teacher.screenshot(path=output / "乌江三维地形.png", animations="disabled")
    next_page(teacher)
    hall_and_desk(teacher)


def hall_and_desk(teacher):
    page_is(teacher, "遵义会议室")
    button(teacher, "进入材料厅").click()
    hall = teacher.locator('.lesson-exploration[data-scene="zunyi-hall"][data-ready]')
    expect(hall).to_be_visible(timeout=EXPLORATION_LOAD_TIMEOUT)
    hall.locator('[data-hall-spot="route"]').click()
    expect(teacher.locator("#route-stops")).to_be_visible(timeout=EXPLORATION_LOAD_TIMEOUT)
    expect(teacher.locator("#instruction")).to_contain_text("拨动行军图")
    teacher.locator("#route-stops").select_option("乌江")
    expect(teacher.locator("#reading-title")).to_have_text("乌江")
    button(teacher, "收起材料").click()
    elapsed_frames(teacher,.25)
    button(teacher, "会议桌").click()
    page_is(teacher, "会议桌上的两份材料")
    desk = teacher.locator(".desk-live-frame")
    expect(desk).to_have_attribute("data-space", "ready", timeout=EXPLORATION_LOAD_TIMEOUT)
    button(teacher, "乌江").click()
    evidence = teacher.locator(".desk-reader .desk-reader-article")
    expect(evidence.get_by_role("heading", name="乌江")).to_be_visible()
    expect(teacher.locator(".desk-live-frame")).to_have_attribute("data-map", "original")
    expect(evidence).to_contain_text("抵达遵义")
    button(teacher, "返回桌面").click()
    expect(desk).to_have_attribute("data-focus", "0.000")
    open_dossier(teacher)
    drag_desk(teacher,"discussion-sheet",-.15,dy=.06)
    expect(teacher.locator(".desk-live-frame")).not_to_have_attribute("data-sheet-discussion", "")
    button(teacher,"乌江").click()
    button(teacher,"对照两份材料").click()
    expect(teacher.locator(".desk-reader-pair .is-right h3")).to_have_text("会议讨论")
    expect(teacher.locator(".desk-reader-pair .is-left h3")).to_have_text("乌江")
    print("遵义材料厅带入的乌江线索与会议讨论在会议桌阅读区并排可读", flush=True)


def main():
    parser = ArgumentParser()
    parser.add_argument("--html", type=Path, default=COURSE)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--desk-only", action="store_true", help="只验材料厅到会议桌的线索交接")
    args = parser.parse_args()
    if args.output:
        args.output.mkdir(parents=True, exist_ok=True)
    with launch(args.html, size("1366x768")) as (context, url, _, _):
        teacher = context.new_page()
        teacher.goto(url)
        if args.desk_only:
            lesson_action(teacher, "start").click()
            lesson_action(teacher, "opening-next").click()
            teacher.locator(".chapter-nav").get_by_role("button",name="遵义会议",exact=True).click()
            hall_and_desk(teacher)
            return
        river(teacher, args.output)
        journey_and_routes(teacher, args.output)
        wujiang_and_desk(teacher, args.output)


if __name__ == "__main__":
    main()
