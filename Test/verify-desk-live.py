"""在断网 Edge 中验收定格桌景、手动查证和双屏恢复。"""

from io import BytesIO
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import expect, sync_playwright

ROOT = Path(__file__).resolve().parents[1]
COURSE = ROOT / "课堂演示" / "从于都到遵义-课堂演示.html"
FRAME = ".desk-live-frame"


def reopen(teacher, student=None):
    size = student.viewport_size if student else {"width":1920,"height":1080}
    if student:
        student.close()
    label = "重新打开投影" if student else "双屏授课"
    with teacher.expect_popup() as opened:
        teacher.get_by_role("button",name=label,exact=True).click()
    screen = opened.value
    screen.set_viewport_size(size)
    expect(teacher.locator(".presenter-status")).to_have_text("投影已连接")
    return screen


def exercise(browser, local, width):
    with browser.new_context(offline=True,viewport={"width":width,"height":768}) as context:
        errors = []
        context.on("weberror", lambda error: errors.append(str(error.error)))
        teacher = context.new_page()
        teacher.goto(local.as_uri() + "#desk")
        stage = teacher.locator(FRAME)
        expect(stage).to_have_attribute("data-space","ready")
        assert stage.locator("video").count() == 0
        assert stage.locator(".scene-point").evaluate_all("points=>points.length===2&&points.every(p=>!p.textContent.trim())")
        screen = reopen(teacher)
        expect(screen.locator(FRAME)).to_have_attribute("data-space","ready")
        before = stage.screenshot()
        stage.press("ArrowRight")
        expect(stage).to_have_attribute("data-yaw","4.000")
        expect(screen.locator(FRAME)).to_have_attribute("data-yaw","4.000")
        after = stage.screenshot()
        first, second = (Image.open(BytesIO(raw)).convert("RGB") for raw in (before,after))
        assert max(ImageStat.Stat(ImageChops.difference(first,second)).mean) > 1

        teacher.get_by_role("button",name="翻阅左册 · 会前形势",exact=True).click()
        expect(screen.locator(".is-left .folio-card")).to_be_visible()
        expect(screen.locator(FRAME)).to_have_attribute("data-yaw","4.000")
        expect(screen.locator(FRAME).locator("video")).to_have_count(0)
        teacher.get_by_role("button",name="收起材料",exact=True).click()
        teacher.get_by_role("button",name="动手查证",exact=True).click()
        teacher.get_by_role("button",name="翻阅右册 · 会议讨论",exact=True).click()
        expect(screen.locator(".is-right .folio-card")).to_be_visible()
        teacher.get_by_role("button",name="翻阅左册 · 会前形势",exact=True).click()
        expect(stage).to_have_attribute("data-inquiry","leaf")
        expect(screen.locator(FRAME)).to_have_attribute("data-yaw","0.000")
        slider = teacher.get_by_role("slider",name="手记开合")
        slider.press("ArrowRight")
        opening = stage.get_attribute("data-opening")
        assert int(opening)>0
        screen = reopen(teacher,screen)
        expect(screen.locator(FRAME)).to_have_attribute("data-opening",opening)
        expect(screen.locator(".desk-inquiry-sheet")).to_be_visible()
        expect(screen.get_by_role("slider",name="手记开合")).to_have_count(0)
        slider.press("End")
        expect(screen.locator(FRAME)).to_have_attribute("data-inquiry","done")
        expect(screen.locator(".is-left .folio-card")).to_be_visible()
        expect(screen.locator(".is-right .folio-card")).to_be_visible()
        teacher.get_by_role("button",name="结束查证",exact=True).click()
        expect(screen.locator(FRAME)).to_have_attribute("data-inquiry","off")
        expect(screen.locator(FRAME).locator("video")).to_have_count(0)
        assert not errors, errors
        print(f"桌景通过 Edge 断网验收，教师窗口宽 {width}，手动查证和重连均通过。",flush=True)


def main():
    with TemporaryDirectory() as folder,sync_playwright() as playwright:
        local=Path(folder)/COURSE.name
        copyfile(COURSE,local)
        with playwright.chromium.launch(channel="msedge",headless=True) as browser:
            for width in (1366,1920):
                exercise(browser,local,width)


if __name__ == "__main__":
    main()
