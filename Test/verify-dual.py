import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

from playwright.sync_api import expect, sync_playwright


def verify_lesson(context, lesson_url, student_width, student_height):
    errors = []
    remote_requests = []
    context.set_default_timeout(8000)
    context.on("weberror", lambda event: errors.append(str(event.error)))
    context.on(
        "request",
        lambda request: remote_requests.append(request.url)
        if request.url.startswith(("http://", "https://"))
        else None,
    )
    teacher = context.new_page()
    teacher.goto(lesson_url)

    def press(name, scope=teacher):
        scope.get_by_role("button", name=name, exact=True).click()

    def slide(title):
        expect(teacher.locator(".presenter-notes h2")).to_have_text(title)
        expect(student.locator(".scene-head h1")).to_have_text(title)

    with teacher.expect_popup() as opened:
        press("开始双屏授课")
    student = opened.value
    student.set_viewport_size({"width": student_width, "height": student_height})
    status = teacher.locator(".presenter-status")
    expect(status).to_have_text("投影已连接")
    expect(student.locator("#presenter")).to_be_empty()
    expect(student.get_by_text("教师备课", exact=True)).to_have_count(0)

    teacher.locator(".timeline button").filter(has_text="遵义会议").click()
    expect(student.locator(".event-card h2")).to_have_text("遵义会议")
    press("开始授课")
    slide("于都集结")
    teacher.keyboard.press("PageDown")
    slide("岸边备桥")
    press("下一页")
    slide("浮桥近景")
    expect(teacher.locator(".presenter-question")).to_have_text("桥面靠什么托住？")
    expect(student.get_by_text("桥面靠什么托住？", exact=True)).to_have_count(0)
    expect(student.locator(".slide-line")).to_have_text("浮桥由船体和桥板组成。")
    press("船体")
    expect(student.locator(".bridge-outline.is-drawn")).to_have_count(1)
    expect(student.locator(".slide-line")).to_have_text("木船托住桥面")

    press("下一页")
    slide("夜渡于都河")
    playing = """() => {
        const video = document.querySelector('video');
        return video?.classList.contains('is-visible') && !video.paused && video.currentTime > 0.2;
    }"""
    for window in (teacher, student):
        window.wait_for_function(playing)
    press("暂停短片")
    for window in (teacher, student):
        window.wait_for_function("document.querySelector('video')?.paused === true")
        expect(window.locator("video")).to_be_visible()
    press("继续播放")
    for window in (teacher, student):
        window.wait_for_function(playing)
    press("静态画面")
    for window in (teacher, student):
        expect(window.locator("video")).to_be_hidden()

    chapters = teacher.locator(".chapter-nav")
    press("湘江战役", chapters)
    slide("湘江河谷")
    press("下一页")
    press("下一页")
    slide("兵力对照")
    expect(student.locator(".troop-hud-note")).to_be_hidden()
    press("渡江后 · 3万")
    expect(student.locator(".troop-hud-row").filter(has_text="3 万余人")).to_have_attribute(
        "data-focus", "true"
    )
    expect(student.locator(".troop-hud-note")).to_be_visible()

    press("黎平会议", chapters)
    slide("黎平翘街")
    press("下一页")
    slide("进军方向")
    press("推演原计划 · 湘西北")
    expect(student.locator(".paper-node.east")).to_be_visible()
    expect(student.locator(".paper-node.west")).to_be_hidden()
    press("推演新方向 · 贵州北部")
    expect(student.locator(".paper-node.west")).to_be_visible()

    press("遵义会议", chapters)
    slide("遵义会议室")
    press("并排对照")
    expect(student.locator("#dialog-title")).to_have_text("两份材料对照")
    teacher.keyboard.press("Escape")
    expect(student.locator("dialog")).not_to_be_visible()
    press("下一页")
    slide("会议桌上的两份材料")
    left = student.locator(".dossier-slot.is-left .folio-card")
    right = student.locator(".dossier-slot.is-right .folio-card")
    expect(left).to_be_hidden()
    expect(right).to_be_hidden()
    press("翻阅左册 · 会前形势")
    expect(left).to_be_visible()
    expect(right).to_be_hidden()
    teacher.keyboard.press("Escape")
    expect(left).to_be_hidden()
    press("桌面并排对照")
    expect(left).to_be_visible()
    expect(right).to_be_visible()

    student.close()
    expect(status).to_have_text("投影窗口已关闭")
    with teacher.expect_popup() as reopened:
        press("重新打开投影")
    student = reopened.value
    student.set_viewport_size({"width": student_width, "height": student_height})
    expect(status).to_have_text("投影已连接")
    slide("会议桌上的两份材料")
    press("下一页")
    press("下一页")
    press("下一页")
    slide("遵义会议的转折意义")
    conclusion = student.locator(".assembly-conclusion")
    expect(conclusion).to_be_hidden()
    press("直接揭示全部结论")
    expect(conclusion).to_be_visible()
    expect(student.locator(".evidence-chip[data-locked=true]")).to_have_count(3)
    press("课堂回顾")
    expect(student.locator(".review h1")).to_have_text("课堂回顾")
    press("下一页")
    expect(student.locator(".review h1")).to_have_text("全课结论")
    press("揭示结论")
    expect(student.locator(".review-conclusion")).to_be_visible()
    press("结束双屏")
    expect(teacher.locator("#presenter")).to_be_hidden()
    assert student.is_closed(), "结束双屏后，投影窗口仍开着"
    assert not errors, errors
    assert not remote_requests, remote_requests


def main():
    root = Path(__file__).resolve().parents[1]
    source = root / "课堂演示" / "从于都到遵义-课堂演示.html"
    with TemporaryDirectory() as folder:
        lesson = Path(folder) / "lesson.html"
        shutil.copyfile(source, lesson)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            for teacher_width, student_width, student_height in (
                (1366, 1920, 1080),
                (1920, 1366, 768),
            ):
                context = browser.new_context(
                    offline=True, viewport={"width": teacher_width, "height": 768}
                )
                verify_lesson(context, lesson.as_uri(), student_width, student_height)
                print(
                    f"通过 Edge 离线双屏验收（教师宽度 {teacher_width}，"
                    f"投影 {student_width} × {student_height}）",
                    flush=True,
                )
                context.close()
            browser.close()


if __name__ == "__main__":
    main()
