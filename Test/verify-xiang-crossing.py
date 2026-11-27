"""在断网 Edge 中验收湘江渡口的纯视频课页。"""

import argparse
from contextlib import contextmanager, suppress
from hashlib import file_digest
import json
from pathlib import Path
from traceback import format_exc

from playwright.sync_api import expect

from course_cli import COURSE, launch, lesson_action, size
from support.course_media import MAX_JOIN_RGB_ERROR, video_frame_errors


CAPTIONS = (
    "先头部队赶到界首一带，后续队伍朝渡口靠拢。",
    "中央红军从全州、兴安之间陆续过江。",
    "战事波及灌阳。阻击部队为渡江争取时间。",
    "主力突破了第四道封锁线，付出重大代价。",
)


def open_crossing(page, url):
    page.goto(url)
    page.get_by_role("navigation", name="时间轴").get_by_role("button", name="湘江战役").click()
    lesson_action(page, "enter-scene").click()
    expect(page.locator(".scene-head h1")).to_have_text("湘江河谷")
    entry = page.locator(".scene-camera > img").first.element_handle()
    lesson_action(page, "next").click()
    expect(page.locator(".scene-head h1")).to_have_text("湘江渡口")
    return entry


def assert_scene_source(video):
    assert video.evaluate("""async video => {
      if (typeof acquireCourseAsset === 'undefined') return video.src === mediaAssets['xiang-tour-video'];
      const lease = await acquireCourseAsset('xiang-tour-video');
      try { return video.src === lease.url; }
      finally { lease.release(); }
    }"""), "湘江渡口没有使用验收的短片资源"


def check_page_join(page, entry):
    expect(page.locator(".scene-head h1")).to_have_text("湘江留下的启示")
    expect(page.locator(".outgoing-image")).to_have_count(0)
    exit_image = page.locator(".scene-camera > img").first.element_handle()
    first, last = video_frame_errors(page, "xiang-tour-video", entry, exit_image)
    print(f"湘江河谷 → 湘江渡口 → 湘江留下的启示，首尾 RGB 差 {first:.2f}、{last:.2f}/255", flush=True)
    assert max(first, last) < MAX_JOIN_RGB_ERROR, (
        f"湘江短片与实际前后课页的首尾 RGB 差为 {first:.2f}、{last:.2f}/255，超过 {MAX_JOIN_RGB_ERROR}/255。"
        "请按实际前后课页校正 OpenMotion 的首尾帧，并用 make-xiang-crossing-tour.py 装入验收过的原始导出。"
    )
    return {"firstMeanRgb": first, "lastMeanRgb": last}


def wait_for_playing(video, after=0):
    video.page.wait_for_function("""after => {
      const video = document.querySelector('.xiang-tour video');
      return !video.paused && video.readyState >= 2 && video.videoWidth && video.currentTime > after;
    }""", arg=after)


def check_layout(video, caption, viewport):
    layout = video.evaluate("""video => ({
      fit: getComputedStyle(video).objectFit,
      overflow: document.documentElement.scrollWidth > innerWidth,
    })""")
    assert not layout["overflow"], layout
    if viewport["width"] / viewport["height"] <= 4 / 3:
        assert layout["fit"] == "contain", layout
        box = caption.bounding_box()
        assert box and box["y"] >= (viewport["height"] + viewport["width"] * 9 / 16) / 2, box
    return layout


def observe_handoff(video):
    video.evaluate("""video => video.addEventListener('ended', () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', {willReadFrequently:true});
      ctx.drawImage(video,0,0);
      const pixels = ctx.getImageData(0,0,canvas.width,canvas.height).data;
      const observation = window.xiangHandoff = {widths:[], tailError:null, cropIntermediateWidth:null};
      const frameSelector = '.scene-stage > .scene-tour.outgoing-image canvas';
      const mounted = new MutationObserver(() => {
        const frame = document.querySelector(frameSelector);
        if (!frame) return;
        mounted.disconnect();
        const animate = frame.animate.bind(frame);
        frame.animate = (keyframes, options) => {
          const animation = animate(keyframes, options);
          // Read the real animation between its endpoints even if Edge skips a paint.
          animation.currentTime = animation.effect.getComputedTiming().duration / 4;
          observation.cropIntermediateWidth = frame.getBoundingClientRect().width;
          animation.currentTime = 0;
          return animation;
        };
      });
      mounted.observe(document.querySelector('main'), {childList:true, subtree:true});
      function sample() {
        const frame = document.querySelector(frameSelector);
        if (!frame) return;
        observation.widths.push(frame.getBoundingClientRect().width);
        if (observation.tailError === null) {
          const actual = frame.getContext('2d').getImageData(0,0,frame.width,frame.height).data;
          let error = 0;
          for (let i = 0; i < pixels.length; i++) error += Math.abs(pixels[i] - actual[i]);
          observation.tailError = error / pixels.length;
        }
        requestAnimationFrame(sample);
      }
      requestAnimationFrame(sample);
    }, {capture:true, once:true})""")


@contextmanager
def crossing_page(html, viewport, output):
    output.mkdir(parents=True, exist_ok=True)
    with launch(html, viewport) as (context, url, edge, _):
        page = context.new_page()
        try:
            yield page, url, edge
        except Exception:
            with suppress(Exception):
                page.screenshot(path=output / "失败现场.png", timeout=5000)
            raise


def exercise_joins(html, output):
    with crossing_page(html, {"width": 1920, "height": 1080}, output) as (page, url, _):
        entry = open_crossing(page, url)
        assert_scene_source(page.locator(".xiang-tour video"))
        lesson_action(page, "next").click()
        return check_page_join(page, entry)


def exercise(html, viewport, output):
    with crossing_page(html, viewport, output) as (page, url, edge):
        requests = []
        page.context.on("request", lambda request: requests.append(request.url)
                        if request.url.startswith(("http:", "https:")) else None)
        page.add_init_script("""(() => {
          const getContext = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function (type, ...args) {
            if (type.startsWith('webgl') && document.querySelector('.scene[data-activity="crossing"]')) {
              throw new Error('湘江渡口不应请求 WebGL');
            }
            return getContext.call(this, type, ...args);
          };
        })()""")
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        entry = open_crossing(page, url)
        scene = page.locator('.scene[data-activity="crossing"]')
        video = scene.locator(".xiang-tour video")
        caption = scene.locator(".scene-tour-caption")
        play = lesson_action(page, "tour-playback")
        expect(play).to_be_visible()
        expect(video).to_have_count(1)
        expect(video).to_be_hidden()
        source = video.element_handle()
        observe_handoff(video)
        page.screenshot(path=output / "渡口课页.png")

        caption.evaluate("""caption => {
          const video = document.querySelector('.xiang-tour video');
          window.xiangCueTimes = {};
          new MutationObserver(() => {
            if (caption.textContent) window.xiangCueTimes[caption.textContent] ??= video.currentTime;
          }).observe(caption, {childList: true, characterData: true, subtree: true});
        }""")
        play.click()
        wait_for_playing(video, 0.25)
        assert_scene_source(video)
        expect(caption).to_have_text(CAPTIONS[0])
        layout = check_layout(video, caption, viewport)
        play.click()
        expect(video).to_have_js_property("paused", True)
        paused_at = video.evaluate("video => video.currentTime")
        expect(caption).to_have_text(CAPTIONS[0])
        play.click()
        wait_for_playing(video, paused_at + 0.2)
        for text in CAPTIONS[1:]:
            expect(caption).to_have_text(text, timeout=8000)
            if text == CAPTIONS[1]:
                page.screenshot(path=output / "涉水近景.png")
        cue_times = page.evaluate("captions => captions.map(text => window.xiangCueTimes[text])", CAPTIONS[1:])
        assert all(abs(actual - expected) < 0.75 for actual, expected in zip(cue_times, (4, 9, 13), strict=True)), cue_times
        assert video.evaluate("video => video.duration") == 17
        expect(scene.locator(".lesson-exploration, .crossing-inscene, .scene-point")).to_have_count(0)
        expect(scene.locator("[data-scene-tour-entry]")).to_have_count(0)
        expect(page.locator(".scene-head h1")).to_have_text("湘江留下的启示", timeout=8000)
        expect(page.locator(".outgoing-image")).to_have_count(0)
        handoff = page.evaluate("window.xiangHandoff")
        assert handoff["widths"] and handoff["tailError"] <= 1, handoff
        if layout["fit"] == "contain":
            cover_width = viewport["height"] * 16 / 9
            assert max(handoff["widths"]) >= cover_width * .95, handoff
            middle = handoff["cropIntermediateWidth"]
            assert middle and viewport["width"] * 1.05 < middle < cover_width * .95, handoff
        page.screenshot(path=output / "片尾自动接入下一页.png")
        assert source.evaluate("video => video.paused && !video.hasAttribute('src')")
        page_join = check_page_join(page, entry)

        lesson_action(page, "previous").click()
        expect(page.locator(".scene-head h1")).to_have_text("湘江渡口")
        play.click()
        wait_for_playing(video, 0.2)
        expect(caption).to_have_text(CAPTIONS[0])
        lesson_action(page, "next").click()
        expect(page.locator(".scene-head h1")).to_have_text("湘江留下的启示")
        lesson_action(page, "previous").click()
        expect(page.locator(".scene-head h1")).to_have_text("湘江渡口")
        expect(play).to_be_visible()
        assert not requests and not errors, (requests, errors)
        return {"edge": edge, "viewport": viewport, "pausedAt": paused_at,
                "captionCuts": cue_times, "layout": layout, "handoff": handoff, "pageJoin": page_join,
                "networkRequests": requests, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path, nargs="?", default=COURSE)
    parser.add_argument("--viewport", type=size, action="append")
    parser.add_argument("--joins-only", action="store_true", help="只核对实际前后课页的图与短片首尾帧")
    parser.add_argument("--output", type=Path, default=Path(".march-build/验收/湘江渡口"))
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    report = {"passed": False, "views": []}
    try:
        with args.html.open("rb") as f:
            report["sha256"] = file_digest(f, "sha256").hexdigest()
        if args.joins_only:
            report["pageJoin"] = exercise_joins(args.html, args.output)
        else:
            for viewport in args.viewport or [size("1366x768"), size("718x811")]:
                report["failedViewport"] = viewport
                result = exercise(args.html, viewport, args.output / f"{viewport['width']}x{viewport['height']}")
                report["views"].append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
            report.pop("failedViewport")
        report["passed"] = True
    except Exception:
        report["traceback"] = format_exc()
        raise
    finally:
        (args.output / "report.json").write_text(
            json.dumps(report, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
