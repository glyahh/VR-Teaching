"""Freeze frame 76 of the original camera path using the original course."""

import argparse
import importlib.util
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright

FRAME = 76


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--course", type=Path, help="Use HTML from the baseline checkout.")
    args = parser.parse_args()
    sys.dont_write_bytecode = True
    media_source = Path(__file__).resolve().parents[2]
    spec = importlib.util.spec_from_file_location("original_recorder", media_source / "record-opening-3d.py")
    original = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(original)
    args.output.parent.mkdir(parents=True, exist_ok=True)

    def capture_fixed(page, _output, count, step):
        step(FRAME, FRAME / (count - 1))
        page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
        page.screenshot(path=str(args.output))

    original.capture_frames = capture_fixed
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel="msedge", headless=True,
                     args=["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--enable-webgl"])
        page = browser.new_page(viewport={"width": original.WIDTH, "height": original.HEIGHT},
                                device_scale_factor=1, reduced_motion="reduce", offline=True)
        course = args.course or original.COURSE_HTML
        page.goto(course.resolve().as_uri())
        page.wait_for_selector("button:has-text('开始授课')", timeout=15000)
        original.record_xiang_crossing(page, True)
        browser.close()


if __name__ == "__main__":
    main()

