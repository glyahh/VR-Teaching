"""Exercise the continuous Yudu tour and the separate live river in offline Edge."""

import argparse
from hashlib import file_digest
import json
from pathlib import Path

from playwright.sync_api import expect

from course_cli import COURSE, button, launch, size


def film_layout(page):
    bounds = page.locator(".river-tour video").evaluate("""video => {
      const scene = video.closest('.classroom-slide');
      const {width, height, top} = video.getBoundingClientRect();
      const fit = getComputedStyle(video).objectFit;
      const pictureHeight = fit === 'contain' ? Math.min(height, width * video.videoHeight / video.videoWidth) : height;
      const caption = scene.querySelector('.river-tour-caption').getBoundingClientRect();
      const entry = scene.querySelector('[data-river-entry]').getBoundingClientRect();
      return {
        videoWidth: width, videoHeight: height,
        pictureTop: top + (height - pictureHeight) / 2,
        pictureBottom: top + (height + pictureHeight) / 2,
        titleBottom: scene.querySelector('h1').getBoundingClientRect().bottom,
        captionTop: caption.top, captionCenter: (caption.left + caption.right) / 2,
        captionHeight: caption.height, entryBottom: entry.bottom,
        captionBottomInset: innerHeight - caption.bottom,
        viewportWidth: innerWidth, viewportHeight: innerHeight,
        footerBackground: getComputedStyle(scene.querySelector('.lesson-footer')).backgroundColor,
        fit,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth
      };
    }""")
    width, height = bounds["viewportWidth"], bounds["viewportHeight"]
    assert (bounds["videoWidth"], bounds["videoHeight"]) == (width, height), bounds
    assert bounds["captionHeight"] > 0 and abs(bounds["captionCenter"] - width / 2) <= 1, bounds
    assert bounds["captionTop"] >= height * .8 and bounds["titleBottom"] <= height * .2, bounds
    if width / height <= 4 / 3:
        assert bounds["fit"] == "contain" and bounds["captionTop"] >= bounds["pictureBottom"], bounds
        assert bounds["entryBottom"] <= bounds["pictureTop"] + 1, bounds
    else:
        assert bounds["fit"] == "cover" and bounds["entryBottom"] <= height * .2, bounds
    assert bounds["footerBackground"] == "rgba(0, 0, 0, 0)" and not bounds["horizontalOverflow"], bounds
    return bounds


def subtitle_style(caption):
    return caption.evaluate("""node => {
      const style = getComputedStyle(node);
      return [style.textAlign, style.fontSize, style.lineHeight, style.color,
        style.backgroundColor, style.borderRadius, style.backdropFilter];
    }""")


def play_backup_from_closeup(page):
    video = page.locator(".scene-camera video")
    button(page, "抬送门板：群众捐出自家门板").click()
    expect(page.locator(".slide-line")).to_have_attribute("data-narration-view", "point")
    video.evaluate("""video => {
      video.startTimes = [];
      video.addEventListener('playing', () => video.startTimes.push(video.currentTime));
    }""")
    button(page, "播放备桥短片").click()
    page.wait_for_function("document.querySelector('.scene-camera video')?.currentTime > .2")
    started = video.evaluate("video => video.startTimes[0]")
    assert 0 <= started < .05, f"备桥短片从 {started:.3f} 秒起播"

    button(page, "暂停短片").click()
    expect(video).to_have_js_property("paused", True)
    paused = video.evaluate("video => video.currentTime")
    button(page, "继续播放").click()
    page.wait_for_function("document.querySelector('.scene-camera video')?.startTimes.length === 2")
    resumed = video.evaluate("video => video.startTimes[1]")
    assert abs(resumed - paused) < .05, (paused, resumed)
    return {"startedAt": started, "pausedAt": paused, "resumedAt": resumed}


def exercise(html, viewport, output):
    with launch(html, viewport) as (context, url, edge, errors):
        page = context.new_page()
        requests = []
        context.on("request", lambda request: requests.append(request.url)
                   if request.url.startswith(("http:", "https:")) else None)
        page.goto(url)
        button(page, "开始授课").click()
        opening_subtitle = subtitle_style(page.locator(".opening-sub"))
        button(page, "进入课堂").click()
        button(page, "下一页").click()
        expect(page.locator("h1")).to_have_text("岸边备桥")
        page.mouse.move(4, 200)
        backup = button(page, "播放备桥短片")
        expect(backup).to_be_visible()
        expect(page.locator(".classroom-slide")).to_have_attribute("data-entry-phase", "ready")
        contrast = backup.evaluate(r"""node => {
          const light = color => {
            const [r,g,b] = color.match(/\d+/g).slice(0, 3).map(value => {
              const v = Number(value) / 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126*r + 0.7152*g + 0.0722*b;
          };
          const style = getComputedStyle(node);
          return { ratio: (light(style.backgroundColor) + .05) / (light(style.color) + .05),
            alpha: Number(style.backgroundColor.match(/[\d.]+/g)[3] ?? 1),
            filter: style.backdropFilter };
        }""")
        assert contrast["ratio"] >= 4.5 and 0.5 < contrast["alpha"] < 1 and "blur" in contrast["filter"], contrast
        page.screenshot(path=output / "岸边按钮-未悬停.png")

        backup_playback = None
        if viewport["width"] == 718:
            backup_playback = play_backup_from_closeup(page)
        else:
            button(page, "下一页").click()
        expect(page.locator("h1")).to_have_text("浮桥近景", timeout=12000)
        scene = page.locator(".classroom-slide")
        entry = button(page, "进入河岸")
        video = page.locator(".river-tour video")
        expect(scene).to_have_attribute("data-river-tour", "ready")
        expect(video).to_be_hidden()
        expect(entry).to_be_hidden()
        expect(page.locator(".lesson-exploration")).to_have_count(0)
        button(page, "于都河岸").click()
        expect(scene).to_have_attribute("data-river-tour", "playing")
        expect(entry).to_be_visible()
        caption = page.locator(".lesson-footer .river-tour-caption")
        expect(caption).to_have_text("乡亲卸下家里的门板，铺成桥面。")
        expect(page.locator(".lesson-exploration")).to_have_count(0)
        page.wait_for_function("""() => {
          const film = document.querySelector('.river-tour video');
          return film.currentTime > .25 && film.webkitAudioDecodedByteCount > 0 && !film.muted;
        }""")
        playing_layout = film_layout(page)
        expect(page.locator(".chapter-nav")).to_be_hidden()
        expect(button(page, "下一页")).to_be_hidden()
        expect(caption).to_be_visible()
        assert subtitle_style(caption) == opening_subtitle
        caption.evaluate("""node => {
          const video = document.querySelector('.river-tour video');
          const reading = () => [node.textContent, video.currentTime];
          window.riverCaptions = [reading()];
          new MutationObserver(() => {
            if (node.textContent && window.riverCaptions.at(-1)[0] !== node.textContent)
              window.riverCaptions.push(reading());
          }).observe(node, { childList: true });
        }""")
        page.screenshot(path=output / "自动播放.png")

        if viewport["width"] == 1366:
            button(page, "暂停河岸短片").click()
            frozen = video.evaluate("film => film.currentTime")
            expect(video).to_have_js_property("paused", True)
            expect(entry).to_be_visible()
            expect(page.locator(".lesson-exploration")).to_have_count(0)
            page.wait_for_timeout(250)
            assert abs(video.evaluate("film => film.currentTime") - frozen) < .05
            button(page, "继续播放河岸短片").click()
            page.wait_for_function("t => document.querySelector('.river-tour video').currentTime > t + .1", arg=frozen)
            entry.press("Enter")
            live = page.locator('.lesson-exploration[data-scene="yudu-river"][data-ready]')
            expect(live).to_be_visible(timeout=20000)
            expect(scene).to_have_attribute("data-river-tour", "paused")
            expect(video).to_have_js_property("paused", True)
            early_exit = video.evaluate("film => film.currentTime")
            assert .25 < early_exit < 15, early_exit
            expect(video).to_be_hidden()
            button(page, "返回浮桥").click()
            expect(video).to_be_visible()
            expect(button(page, "继续播放河岸短片")).to_be_visible()
            assert abs(video.evaluate("film => film.currentTime") - early_exit) < .05
            film_layout(page)
            button(page, "继续播放河岸短片").click()
            page.wait_for_function("t => document.querySelector('.river-tour video').currentTime > t + .1", arg=early_exit)
        expect(scene).to_have_attribute("data-river-tour", "finished", timeout=30000)
        expect(video).to_have_js_property("ended", True)
        expect(page.locator(".lesson-exploration")).to_have_count(0)
        duration = video.evaluate("film => film.duration")
        assert 18.4 <= duration <= 18.7, duration
        readings = page.evaluate("window.riverCaptions")
        captions = [text for text, _ in readings]
        assert captions == [
            "乡亲卸下家里的门板，铺成桥面。", "一列渔船，托住桥下的纵梁。",
            "队伍抵达渡口，等候过河。", "借着夜色，队伍分批踏上浮桥。",
            "拂晓前撤桥，掩护大队转移。",
        ], captions
        cue_times = [time for _, time in readings[1:]]
        for actual, expected in zip(cue_times, [4, 172 / 24, 261 / 24, 349 / 24], strict=True):
            assert abs(actual - expected) < .15, cue_times
        expect(entry).to_be_visible()
        finished_layout = film_layout(page)
        for edge_name in ("pictureTop", "pictureBottom", "captionBottomInset"):
            assert abs(playing_layout[edge_name] - finished_layout[edge_name]) <= 1, (playing_layout, finished_layout)
        expect(caption).to_have_text("拂晓前撤桥，掩护大队转移。")
        page.screenshot(path=output / "片尾与河岸入口.png")

        entry.click()
        stage = page.locator('.lesson-exploration[data-scene="yudu-river"][data-ready]')
        expect(stage).to_be_visible(timeout=20000)
        expect(stage).to_have_css("opacity", "1")
        expect(stage.locator("#river-action")).to_be_hidden()
        page.screenshot(path=output / "空桥与河岸.png")
        button(page, "看构件").click()
        button(page, "纵梁").click()
        expect(stage.locator("#river-instruction")).to_contain_text("纵梁")
        page.wait_for_function("explorationActivity.read().state.zoom > 2.12")
        page.screenshot(path=output / "靠近桥下.png")
        stage.locator("#river-inspect-close").click()
        pose = "() => {const {eye,target,zoom}=explorationActivity.read().state;return [eye,target,zoom]}"
        before = page.evaluate(pose)
        canvas = stage.locator("#view")
        canvas.hover(position={"x": 250, "y": 315})
        page.mouse.wheel(0, -250)
        page.wait_for_function(f"saved => JSON.stringify(({pose})()) !== JSON.stringify(saved)", arg=before)
        after = page.evaluate(pose)
        page.screenshot(path=output / "环绕前的近岸细节.png")
        button(page, "返回浮桥").click()
        expect(scene).to_have_attribute("data-river-tour", "finished")
        expect(video).to_have_js_property("ended", True)
        entry.click()
        expect(stage).to_be_visible(timeout=20000)
        assert page.evaluate(pose) == after
        button(page, "返回浮桥").click()
        button(page, "下一页").click()
        expect(page.locator("h1")).to_have_text("夜渡于都河")
        assert not requests, requests
        return {"viewport": viewport, "edge": edge, "duration": duration,
                "buttonContrast": contrast, "backupPlayback": backup_playback,
                "captions": captions, "cueTimes": cue_times,
                "playingLayout": playing_layout, "finishedLayout": finished_layout,
                "networkRequests": requests}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("html", type=Path, nargs="?", default=COURSE)
    parser.add_argument("--viewport", type=size, action="append")
    parser.add_argument("--output", type=Path, default=Path(".march-build/验收/于都连续播放"))
    args = parser.parse_args()
    reports = []
    for viewport in args.viewport or [size("718x811"), size("1366x768"), size("1920x1080")]:
        directory = args.output / f"{viewport['width']}x{viewport['height']}"
        directory.mkdir(parents=True, exist_ok=True)
        report = exercise(args.html, viewport, directory)
        reports.append(report)
        print(json.dumps(report, ensure_ascii=False), flush=True)
    with args.html.open("rb") as source:
        sha = file_digest(source, "sha256").hexdigest()
    (args.output / "report.json").write_text(
        json.dumps({"passed": True, "sha256": sha, "views": reports}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
