"""离线 Edge 实测遵义三条镜头路线。运行 python Test/verify-shot-routes.py。

依赖 Python、Playwright、Pillow 和已安装的 Microsoft Edge。只通过页面控件
操作课件，像素和状态从交付 HTML 读取。原课件参照图只在 Python 中核对。
"""

import argparse
import base64
import hashlib
import io
import json
import math
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import parse_qs, unquote, urlsplit

from PIL import Image, ImageChops, ImageOps, ImageStat
from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
INPUT = ROOT / "展示材料" / "遵义镜头路线对比"
OUTPUT = ROOT / ".march-build" / "route-lab" / "qa"
ASSETS = ROOT / "课堂演示" / "assets"
FILES = {
    "A": "A-Blender预渲染机位.html",
    "B": "B-浏览器实时三维.html",
    "C": "C-三维接Blender短片.html",
}
VIEWPORT = {"width": 1280, "height": 800}
SIZE = (640, 360)
INITIAL = {"yaw": -16, "pitch": 22, "radius": 2.75}
FRONT = {**INITIAL, "yaw": 0}
ORIGINS = {
    "A": "舞台取自预渲染机位，正面静图与短片首帧共享 Blender 画面来源。",
    "B": "静止和翻起均由同一 WebGL 场景绘制，固定机位观察不同动作时刻。",
    "C": "舞台取自实时 WebGL，正面使用压片前的 gold.png 锚点纹理，与 MP4 共享 Blender 渲染来源。",
}

FRAME_PROVENANCE = """() => {
  const drawn = new WeakMap(), exports = new Map();
  window.__shotOrigin = (image, id) => {
    const frame = exports.get(image.currentSrc)?.get(id);
    if (!frame) return null;
    const {src, ...info} = frame;
    if (src) info.sameFilm = src === document.querySelector('#film').currentSrc;
    return info;
  };
  const ctx = CanvasRenderingContext2D.prototype;
  const draw = ctx.drawImage;
  ctx.drawImage = function(source, ...args) {
    const result = draw.call(this, source, ...args);
    if (!this.canvas.dataset?.shotSample) {
      const video = source instanceof HTMLVideoElement;
      if (video || (source instanceof HTMLCanvasElement && ['space','plate'].includes(source.id))) {
        const origin = {id: source.id, copied_ms: performance.now(),
                        phase: document.querySelector('#stage')?.dataset.phase};
        if (video) Object.assign(origin, {src: source.currentSrc, seconds: source.currentTime,
                                          readyState: source.readyState, width: source.videoWidth});
        drawn.set(this.canvas, origin);
      } else if (drawn.has(source)) drawn.set(this.canvas, drawn.get(source));
      else drawn.delete(this.canvas);
    }
    return result;
  };
  const encode = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function(...args) {
    const result = encode.apply(this, args);
    const origin = drawn.get(this);
    if (origin) {
      if (!exports.has(result)) exports.set(result, new Map());
      exports.get(result).set(origin.id, {...origin, exported_ms: performance.now()});
    }
    return result;
  };
}"""

PROBE = """([route, width, height]) => {
  const id = key => document.getElementById(key);
  const stage = id('stage'), layer = id(route === 'A' ? 'plate' : 'space'), video = id('film');
  const realTime = route === 'B';
  function buffer() {
    const c = document.createElement('canvas');
    c.dataset.shotSample = '1'; c.width = width; c.height = height;
    return c;
  }
  function copy(canvas, source) {
    canvas.getContext('2d').drawImage(source, 0, 0, width, height);
  }
  function photo(source) {
    const canvas = buffer(); copy(canvas, source); return canvas.toDataURL();
  }
  function state() {
    const d = stage.dataset;
    return {phase: d.phase, paused: d.paused, finished: d.finished,
            yaw: Number(d.yaw), pitch: Number(d.pitch), radius: Number(d.radius),
            seconds: realTime ? Number(id('seek')?.value) : video.currentTime};
  }
  function filmVisible() {
    const s = getComputedStyle(video);
    return s.display !== 'none' && s.visibility !== 'hidden' && Number(s.opacity) > .5;
  }
  let recording;
  function start() {
    const pre = buffer(), first = buffer(), raised = buffer();
    const record = {phases: [], pre, first, raised, armed_ms: performance.now()};
    recording = record;
    function sample() {
      const s = state();
      if (record.phases.at(-1) !== s.phase) record.phases.push(s.phase);
      if (s.phase === 'browse' || s.phase === 'align') {
        if (!filmVisible() && !layer.hidden) { copy(pre, layer); record.before = s; }
      } else if (s.phase === 'clip') {
        const shown = realTime ? !filmVisible() && !layer.hidden : filmVisible() && video.readyState >= 2;
        if (shown && !record.entered) {
          copy(first, realTime ? layer : video); record.entered = s; record.entered_ms = performance.now();
        }
        if (shown && realTime) {
          const progress = s.seconds / Number(id('seek').max);
          if (!record.motion || Math.abs(progress - .29) < Math.abs(record.motion.progress - .29)) {
            copy(raised, layer); record.motion = {...s, progress};
          }
          if (progress >= .29) { record.done = true; return; }
        } else if (record.entered) { record.done = true; return; }
      }
      record.raf = requestAnimationFrame(sample);
    }
    sample();
  }
  window.__shot = {
    photo, state, start, filmVisible, get record() { return recording; },
    result() {
      const r = recording;
      cancelAnimationFrame(r.raf);
      return {phases: r.phases, before: r.before, entered: r.entered, motion: r.motion,
              pre: r.pre.toDataURL(), first: r.first.toDataURL(),
              raised: r.motion ? r.raised.toDataURL() : null};
    },
  };
}"""


def require(condition, message):
    if not condition:
        raise AssertionError(message)


def decode(data):
    with Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1]))) as img:
        return img.convert("RGB")


def metrics(left, right, box=None):
    require(left.size == right.size, f"两张采样图尺寸不同 {left.size} / {right.size}")
    diff = ImageChops.difference(left, right)
    if box:
        diff = diff.crop(box)
    red, green, blue = diff.split()
    hist = ImageChops.lighter(ImageChops.lighter(red, green), blue).histogram()
    stat = ImageStat.Stat(diff)
    changed = sum(hist[9:])
    return {
        "mae_rgb_255": round(sum(stat.mean) / 3, 4),
        "rmse_rgb_255": round(math.sqrt(sum(channel_rms * channel_rms for channel_rms in stat.rms) / 3), 4),
        "pixels_over_8": changed,
        "within_8_pct": round(100 * (1 - changed / sum(hist)), 4),
    }


def pose(page):
    return page.evaluate("window.__shot.state()")


def same_pose(seen, expected, tolerance=.06):
    for axis in FRONT:
        require(abs(seen[axis] - expected[axis]) <= tolerance,
                f"{axis} 实测 {seen[axis]}，预期 {expected[axis]} ± {tolerance}")


def phase(page, name, paused=None, finished=None):
    stage = page.locator("#stage")
    expect(stage).to_have_attribute("data-phase", name)
    if paused is not None:
        expect(stage).to_have_attribute("data-paused", str(paused).lower())
    if finished is not None:
        expect(stage).to_have_attribute("data-finished", str(finished).lower())


def photograph(page, selector):
    return decode(page.locator(selector).evaluate("el => window.__shot.photo(el)"))


def scene_layer(route):
    return "#plate" if route == "A" else "#space"


def start_probe(page, route):
    page.evaluate(PROBE, [route, *SIZE])


def scene_point(page, horizontal, vertical):
    rect = page.locator("#stage").bounding_box()
    return rect["x"] + horizontal * rect["width"], rect["y"] + vertical * rect["height"]


def drag(page, dx, dy):
    start = scene_point(page, .72, .73)
    end = scene_point(page, .72 + dx, .73 + dy)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=5)
    page.mouse.up()


def settled(page):
    page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")


def wheel(page):
    page.mouse.move(*scene_point(page, .72, .73))
    page.mouse.wheel(0, -150)
    settled(page)


def pin_position(page):
    return page.locator("#pin").evaluate("""el => {
      const pin = el.getBoundingClientRect(), stage = el.parentElement.getBoundingClientRect();
      return [(pin.x + pin.width/2 - stage.x)/stage.width, (pin.y + pin.height/2 - stage.y)/stage.height];
    }""")


def paper_point(camera, across, depth, up=0):
    coord_x, coord_y, coord_z = -.50 + across * .50, .006 + up, .16 + depth * .36
    yaw, pitch = map(math.radians, (camera["yaw"], camera["pitch"]))
    lateral = coord_x * math.cos(yaw) - coord_z * math.sin(yaw)
    forward = coord_x * math.sin(yaw) + coord_z * math.cos(yaw)
    vertical = coord_y * math.cos(pitch) - forward * math.sin(pitch)
    distance = camera["radius"] - forward * math.cos(pitch) - coord_y * math.sin(pitch)
    frustum_height = 2 * distance * math.tan(math.radians(17))
    return .5 + lateral / (frustum_height * 16/9), .5 - vertical / frustum_height


def inspect_pin(page):
    observed = pin_position(page)
    predicted = paper_point(pose(page), .5, 0)
    error = math.dist(observed, predicted)
    require(error < .015, f"卷宗热点偏离纸面中心，实测 {observed}，几何投影 {predicted}")
    return {"observed_uv": observed, "predicted_uv": predicted, "error_uv": round(error, 5)}


def select_paper(page):
    uv = paper_point(pose(page), .15, .15)
    xy = scene_point(page, *uv)
    surface = page.evaluate("p => document.elementFromPoint(...p)?.id", xy)
    require(surface in ("space", "plate", "stage"), f"卷宗取样点被 {surface} 遮挡")
    page.mouse.click(*xy)
    return {"uv": uv, "hit_element": surface}


def browse(page, route, out, result):
    layer = scene_layer(route)
    same_pose(pose(page), INITIAL)
    phase(page, "browse", False, False)
    expect(page.locator(layer)).to_be_visible()
    if route != "A":
        require(page.locator(layer).evaluate("c => !!(c.getContext('webgl2') || c.getContext('webgl'))"),
                "#space 未取得 WebGL 上下文")
    initial = photograph(page, layer)
    require(max(ImageStat.Stat(initial).stddev) > 8, "初始舞台采样为空或近似纯色")
    stage = page.locator("#stage")
    name = f"{route}-stage.png"
    screenshot = stage.screenshot()
    with Image.open(io.BytesIO(screenshot)) as img:
        result["screenshot"] = {"file": name, "size": img.size, "pose": pose(page)}
    (out / name).write_bytes(screenshot)
    result["pin_initial"] = inspect_pin(page)
    page.locator("#front").click()
    same_pose(pose(page), FRONT)
    page.locator("#left").click()
    same_pose(pose(page), {**FRONT, "yaw": -8}, 1)
    page.locator("#right").click()
    same_pose(pose(page), FRONT, 1)
    baseline = photograph(page, layer)
    start_pin = inspect_pin(page)
    drag(page, -.105, 0)
    first = pose(page)
    first_image = photograph(page, layer)
    drag(page, -.017, 0)
    small = pose(page)
    small_image = photograph(page, layer)
    drag(page, 0, -.13)
    tilt = pose(page)
    tilt_image = photograph(page, layer)
    wheel(page)
    zoom = pose(page)
    zoom_image = photograph(page, layer)
    end_pin = inspect_pin(page)
    changes = {
        "yaw": metrics(baseline, first_image), "small_yaw": metrics(first_image, small_image),
        "pitch": metrics(small_image, tilt_image), "wheel": metrics(tilt_image, zoom_image),
    }
    result.update(horizontal=first, small_horizontal=small, vertical=tilt, zoom=zoom,
                  pin_front=start_pin, pin_after=end_pin, image_changes=changes)
    require(abs(first["yaw"]) > 2 and changes["yaw"]["pixels_over_8"] > 200, "水平拖动未改变舞台画面")
    require(math.dist(start_pin["observed_uv"], end_pin["observed_uv"]) > .002, "转动后卷宗热点没有移动")
    if route == "A":
        require(abs(first["yaw"] / 4 - round(first["yaw"] / 4)) < .01, "A 未落在 4° 机位上")
        for value in (small, tilt, zoom):
            same_pose(value, first)
        require(all(changes[check_name]["pixels_over_8"] == 0 for check_name in ("small_yaw", "pitch", "wheel")),
                "A 的小幅水平拖动、垂直拖动或滚轮改变了当前机位画面")
    else:
        require(.1 < abs(small["yaw"] - first["yaw"]) < 3, "小幅水平拖拽未产生连续角度变化")
        require(abs(tilt["pitch"] - small["pitch"]) > 1, "垂直拖动未改变俯仰")
        require(zoom["radius"] < tilt["radius"] - .03, "向上滚轮没有拉近")
        for key in ("small_yaw", "pitch", "wheel"):
            require(changes[key]["pixels_over_8"] > 150, f"{key} 更新了数据，但画面变化不足")
    page.mouse.click(*scene_point(page, .9, .13))
    settled(page)
    phase(page, "browse", False, False)


def actual_frame_zero(page):
    film = page.locator("#film")
    info = film.evaluate("""async v => {
      const src = v.currentSrc;
      let header;
      if (src.startsWith('data:')) {
        const comma = src.indexOf(',');
        header = atob(src.slice(comma + 1, comma + 25));
      } else if (src.startsWith('blob:')) {
        const blob = await (await fetch(src)).blob();
        header = String.fromCharCode(...new Uint8Array(await blob.slice(0, 16).arrayBuffer()));
      }
      return {container: header?.slice(4,8), scheme: src.split(':',1)[0], seconds: v.currentTime,
              paused: v.paused, ready: v.readyState, seeking: v.seeking, duration: v.duration,
              native_size: [v.videoWidth, v.videoHeight]};
    }""")
    require(info.get("container") == "ftyp" and info["ready"] >= 2 and info["duration"] > 0,
            f"#film 未解码内嵌 MP4 {info}")
    require(info["paused"] and not info["seeking"] and info["seconds"] == 0, f"未采到解码第 0 帧 {info}")
    frame = photograph(page, "#film")
    require(max(ImageStat.Stat(frame).stddev) > 8, "交付视频第 0 帧为空或近似纯色")
    return info, frame


def motion_metrics(still, lifted, camera):
    corners = [paper_point(camera, across, depth, height)
               for across in (-.5, 1.1) for depth in (-.6, .6) for height in (0, .52)]
    xs, ys = zip(*corners)
    box = (max(0, int(min(xs)*SIZE[0])-4), max(0, int(min(ys)*SIZE[1])-4),
           min(SIZE[0], math.ceil(max(xs)*SIZE[0])+4), min(SIZE[1], math.ceil(max(ys)*SIZE[1])+4))
    all_pixels = metrics(still, lifted)
    paper = metrics(still, lifted, box)
    share = paper["pixels_over_8"] / max(1, all_pixels["pixels_over_8"])
    return {"full": all_pixels, "paper": paper, "box_xyxy": box, "share_in_box": round(share, 4)}


def check_motion(evidence):
    require(evidence["paper"]["pixels_over_8"] > 50 and evidence["share_in_box"] > .65,
            f"固定机位下未检出集中在纸页区域的翻起动作 {evidence}")


def dialog_pair(page, expected_size=None):
    pair = []
    for selector in ("#before", "#after"):
        el = page.locator(selector)
        expect(el).to_be_visible()
        width, height = el.evaluate("async i => { await i.decode(); return [i.naturalWidth, i.naturalHeight]; }")
        require(height and abs(width / height - 16/9) < .01, f"{selector} 并非 16:9 抓图 {width}×{height}")
        if expected_size:
            require((width, height) == expected_size, f"{selector} 图片尺寸为 {width}×{height}，预期 {expected_size}")
        pair.append(photograph(page, selector))
    return pair


def check_dialog(page, route, before, after, references, result):
    requested_ms = page.evaluate("performance.now()")
    page.locator("#check").click()
    expect(page.locator("dialog[open]")).to_be_visible()
    still, other = dialog_pair(page)
    result["before_vs_stage"] = metrics(before, still)
    result["after_vs_observed"] = metrics(after, other)
    require(result["before_vs_stage"]["mae_rgb_255"] < 4, "对位左图与实际舞台抓图不一致")
    if route == "B":
        result["dialog_motion"] = motion_metrics(still, other, FRONT)
        check_motion(result["dialog_motion"])
        box = result["dialog_motion"]["box_xyxy"]
        matched = metrics(after, other, box)["mae_rgb_255"]
        flat = metrics(after, still, box)["mae_rgb_255"]
        result["live_lifted_vs_dialog_roi_mae"] = {"lifted": matched, "flat": flat}
        require(matched < .85 * flat, "对照右图与实际约 1 秒的翻页姿态不符")
    else:
        trace = page.evaluate("""layer => ({
          armed_ms: __shot.record.armed_ms, first_clip_ms: __shot.record.entered_ms,
          before: __shotOrigin(document.querySelector('#before'), layer),
          after: __shotOrigin(document.querySelector('#after'), 'film')
        })""", scene_layer(route)[1:])
        result["capture_trace"] = {**trace, "check_requested_ms": requested_ms}
        for side in ("before", "after"):
            origin = trace[side]
            require(origin and trace["armed_ms"] <= origin["copied_ms"] <= trace["first_clip_ms"]
                    and requested_ms <= origin["exported_ms"],
                    f"#{side} 未对应本次交接时复制、打开弹窗时导出的画布 {origin}")
        film = trace["after"]
        require(film.get("sameFilm") and film["seconds"] == 0 and film["readyState"] >= 2,
                f"#after 未取自实际 #film 解码第 0 帧 {film}")
        require(result["after_vs_observed"]["mae_rgb_255"] < 3, "对位右图与 #film 解码首帧不一致")
    page.locator("#original").click()
    original_pair = dialog_pair(page, (800, 450))
    errors = [metrics(ref, img)["mae_rgb_255"] for ref, img in zip(references, original_pair)]
    result["old_reference_mae"] = errors
    require(max(errors) < 6, f"原课件左右图未对应 zunyi.png 和 zunyi.mp4 第 0 帧 {errors}")
    page.locator("#seam").click()
    for initial, restored in zip((still, other), dialog_pair(page)):
        require(metrics(initial, restored)["pixels_over_8"] == 0, "返回两帧后未恢复原比较画面")
    page.keyboard.press("Escape")
    expect(page.locator("dialog[open]")).to_have_count(0)


def old_references(browser):
    with Image.open(ASSETS / "zunyi.png") as image:
        still = ImageOps.fit(image.convert("RGB"), (800, 450)).resize(SIZE, Image.Resampling.LANCZOS)
    with browser.new_context(offline=True) as context:
        verifier = context.new_page()
        src = "data:video/mp4;base64," + base64.b64encode((ASSETS / "zunyi.mp4").read_bytes()).decode()
        png = verifier.evaluate("""async src => {
          const v = document.createElement('video'); v.muted = true; v.preload = 'auto';
          await new Promise((ok, no) => {
            const timer = setTimeout(() => no(Error('旧短片解码超时')), 10000);
            v.onloadeddata = () => { clearTimeout(timer); ok(); };
            v.onerror = () => { clearTimeout(timer); no(Error('旧短片解码失败')); };
            v.src = src;
          });
          if (v.currentTime !== 0 || !v.paused) throw Error('旧短片未停在第 0 帧');
          const c = document.createElement('canvas'); c.width = 800; c.height = 450;
          const scale = Math.max(800 / v.videoWidth, 450 / v.videoHeight);
          const w = v.videoWidth * scale, h = v.videoHeight * scale;
          c.getContext('2d').drawImage(v, (800-w)/2, (450-h)/2, w, h);
          return c.toDataURL();
        }""", src)
    return still, decode(png).resize(SIZE, Image.Resampling.LANCZOS)


def wait_clock(page, seconds):
    page.wait_for_function("t => __shot.state().phase === 'clip' && __shot.state().seconds >= t",
                           arg=seconds, timeout=12000)


def transport(page, route, natural, result):
    layer = "#space" if route == "B" else "#film"
    frozen = pose(page)
    still = photograph(page, layer)
    page.wait_for_timeout(300)
    require(abs(pose(page)["seconds"] - frozen["seconds"]) < .04, "暂停期间时间仍在前进")
    require(metrics(still, photograph(page, layer))["pixels_over_8"] == 0, "暂停时舞台底图仍在变化")
    if route != "B":
        require(page.locator("#film").evaluate("v => v.paused") and page.evaluate("__shot.filmVisible()"),
                "暂停时未显示真实视频帧")
    drag(page, -.085, .09)
    wheel(page)
    moved = pose(page)
    delta = metrics(still, photograph(page, layer))
    result["paused_camera"] = {"before": frozen, "after": moved, "pixels": delta}
    if route == "B":
        require(abs(moved["yaw"] - frozen["yaw"]) > 2 and delta["pixels_over_8"] > 200, "B 暂停时无法绕看")
    else:
        same_pose(moved, FRONT)
        require(delta["pixels_over_8"] == 0, "固定短片在暂停拖动后画面移位")
    page.locator("#play").click()
    phase(page, "clip", False)
    wait_clock(page, frozen["seconds"] + .15)
    if route != "B":
        require(page.locator("#film").evaluate("v => !v.paused && !v.ended"), "续播后视频元素仍暂停")
    playing = pose(page)
    drag(page, .075, -.045)
    observed = pose(page)
    result["playing_camera"] = {"before": playing, "after": observed}
    if route == "B":
        require(abs(observed["yaw"] - playing["yaw"]) > 2, "B 播放中无法绕看")
    else:
        same_pose(observed, FRONT)
    if not natural:
        page.locator("#reset").click()
    phase(page, "browse", False, natural)
    expect(page.locator("#pin")).to_be_visible()
    result["return"] = {"reason": "自然结束" if natural else "返回观察", **pose(page)}
    if natural and route != "B":
        require(page.locator("#film").evaluate("v => v.ended"), "尚未收到视频自然结束")


def enter(page, route, positive, references, result):
    if positive:
        page.locator("#front").click()
        for _ in range(2):
            page.locator("#right").click()
    entry = pose(page)
    same_pose(entry, {**INITIAL, "yaw": 16 if positive else -16}, 1)
    result["entry"] = entry
    starting_image = photograph(page, scene_layer(route))
    if route != "B":
        result["film_zero"], zero = actual_frame_zero(page)
    page.evaluate("__shot.start()")
    if positive:
        page.locator("#play").click()
        result["trigger"] = "#play"
    else:
        result["paper_pick"] = select_paper(page)
        result["trigger"] = "直接点纸面"
    page.wait_for_function("() => __shot.record.done", timeout=12000)
    wait_clock(page, .22)
    page.locator("#play").click()
    phase(page, "clip", True)
    frames = page.evaluate("__shot.result()")
    before, first = decode(frames["pre"]), decode(frames["first"])
    result.update(phase_history=frames["phases"], last_stage_pose=frames["before"], first_clip_pose=frames["entered"])
    if route == "B":
        same_pose(frames["before"], entry)
        same_pose(frames["motion"], entry)
        result["motion_time"] = frames["motion"]
        result["motion"] = motion_metrics(before, decode(frames["raised"]), entry)
        check_motion(result["motion"])
    else:
        require(frames["phases"] == ["browse", "align", "clip"], f"阶段顺序异常 {frames['phases']}")
        same_pose(frames["entered"], FRONT)
        result["entry_to_last_stage"] = metrics(starting_image, before)
        result["entry_vs_decoded_zero"] = metrics(starting_image, zero)
        result["last_stage_vs_decoded_zero"] = metrics(before, zero)
        result["first_visible_film_vs_zero"] = metrics(first, zero)
        require(result["entry_to_last_stage"]["pixels_over_8"] > 200, "入片前舞台未从侧面归位")
        require(result["last_stage_vs_decoded_zero"]["mae_rgb_255"] < result["entry_vs_decoded_zero"]["mae_rgb_255"],
                "归位后舞台与视频首帧的误差未比侧面入片位置缩小")
    transport(page, route, not positive, result)
    if route != "B":
        result["dialog"] = {}
        check_dialog(page, route, before, zero, references, result["dialog"])


def b_front_dialog(page, references, result):
    page.locator("#front").click()
    same_pose(pose(page), FRONT)
    page.evaluate("__shot.start()")
    page.locator("#play").click()
    page.wait_for_function("() => __shot.record.done", timeout=12000)
    page.locator("#play").click()
    phase(page, "clip", True)
    frames = page.evaluate("__shot.result()")
    still, lifted = decode(frames["pre"]), decode(frames["raised"])
    same_pose(frames["before"], FRONT)
    same_pose(frames["motion"], FRONT)
    result["sample"] = frames["motion"]
    require(.21 <= frames["motion"]["progress"] <= .38, "实时抽帧未覆盖约一秒的动作")
    result["live_motion"] = motion_metrics(still, lifted, FRONT)
    check_motion(result["live_motion"])
    check_dialog(page, "B", still, lifted, references, result)


def open_projector(page, route):
    with page.expect_popup() as opened:
        page.locator("#project").click()
    student = opened.value
    student.wait_for_load_state("domcontentloaded")
    teacher_url, student_url = urlsplit(page.url), urlsplit(student.url)
    require((teacher_url.scheme, teacher_url.netloc, teacher_url.path) == (student_url.scheme, student_url.netloc, student_url.path) and parse_qs(student_url.fragment).get("p"),
            "投影未使用同一文件的 #p 会话")
    student.wait_for_selector("#stage[data-phase]", state="visible")
    start_probe(student, route)
    require(student.evaluate("navigator.onLine") is False, "投影窗口未断网")
    expect(student.locator(".teacher:visible, #pin:visible")).to_have_count(0)
    return student


def synced_pause(teacher, student, route):
    phase(student, "clip", True, False)
    held = pose(teacher)
    student.wait_for_function("t => Math.abs(__shot.state().seconds - t) < .16", arg=held["seconds"])
    layer = "#space" if route == "B" else "#film"
    if route != "B":
        student.wait_for_function("__shot.filmVisible() && document.querySelector('#film').paused")
    actual = pose(student)
    same_pose(actual, held)
    diff = metrics(photograph(teacher, layer), photograph(student, layer))
    require(diff["mae_rgb_255"] < 6, f"投影暂停画面未恢复 {diff}")
    return {"teacher": held, "projection": actual, "pixels": diff}


def projection(page, route, result):
    student = open_projector(page, route)
    phase(student, "browse", False, False)
    page.locator("#right").click()
    student.wait_for_function("Math.abs(__shot.state().yaw + 8) < 1")
    result["pin_before_pick"] = inspect_pin(page)
    page.locator("#pin").click()
    wait_clock(page, .55)
    wait_clock(student, .20)
    page.locator("#play").click()
    phase(page, "clip", True)
    result["pause"] = synced_pause(page, student, route)
    student.close()
    if route == "B":
        drag(page, -.08, -.06)
    student = open_projector(page, route)
    result["reconnected"] = synced_pause(page, student, route)
    page.locator("#play").click()
    mark = result["reconnected"]["teacher"]["seconds"] + .25
    for window in (page, student):
        phase(window, "clip", False)
        wait_clock(window, mark)
    page.locator("#reset").click()
    for window in (page, student):
        phase(window, "browse", False, False)
    student.close()


def verify_route(browser, route, source, out, references, report):
    with TemporaryDirectory(prefix=f"shot-{route}-") as directory:
        isolated = Path(directory) / source.name
        shutil.copyfile(source, isolated)
        files = [entry.name for entry in isolated.parent.iterdir()]
        require(files == [source.name], f"临时目录含有其他文件 {files}")
        report.update(single_file=files, bytes=isolated.stat().st_size,
                      sha256=hashlib.sha256(isolated.read_bytes()).hexdigest(), origin=ORIGINS[route])
        attempts, errors = [], []
        expected = unquote(urlsplit(isolated.as_uri()).path)
        with browser.new_context(offline=True, service_workers="block", viewport=VIEWPORT,
                                 device_scale_factor=1) as context:
            context.set_default_timeout(10000)
            context.on("weberror", lambda event: errors.append(str(event.error)[:400]))

            def guard(request_route):
                address = urlsplit(request_route.request.url)
                if address.scheme == "file" and not address.netloc and unquote(address.path) == expected:
                    request_route.continue_()
                else:
                    attempts.append(request_route.request.url[:220])
                    request_route.abort()

            context.route(re.compile(r"^(?:file|https?):"), guard)
            context.add_init_script(f"({FRAME_PROVENANCE})()")
            cases = [
                ("browse", lambda case_page, case_result: browse(case_page, route, out, case_result)),
                ("entry_minus16", lambda case_page, case_result: enter(case_page, route, False, references, case_result)),
                ("entry_plus16", lambda case_page, case_result: enter(case_page, route, True, references, case_result)),
                ("projection", lambda case_page, case_result: projection(case_page, route, case_result)),
            ]
            if route == "B":
                cases.append(("front_motion_dialog", lambda case_page, case_result: b_front_dialog(case_page, references, case_result)))
            report["cases"] = {}
            for name, test in cases:
                case = report["cases"][name] = {}
                try:
                    page = context.new_page()
                    page.goto(isolated.as_uri())
                    expect(page.locator("#play")).to_be_enabled(timeout=15000)
                    require(page.evaluate("navigator.onLine") is False, "教师窗口未断网")
                    start_probe(page, route)
                    test(page, case)
                    case["status"] = "通过"
                except Exception as exc:
                    case.update(status="失败", error=str(exc)[:1800])
                finally:
                    for window in reversed(context.pages):
                        if not window.is_closed():
                            window.close()
                print(f"{route} {name} {case['status']} {case.get('error', '')}", flush=True)
        report.update(blocked_requests=attempts, browser_errors=errors)
        return all(case_record["status"] == "通过" for case_record in report["cases"].values()) and not attempts and not errors


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input-dir", type=Path, default=INPUT)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT)
    args = parser.parse_args()
    out = args.output_dir.resolve()
    out.mkdir(parents=True, exist_ok=True)
    report = {
        "started_utc": datetime.now(timezone.utc).isoformat(), "viewport_css": VIEWPORT, "sample_size": SIZE,
        "method": "各 HTML 单独复制到空目录。Edge 离线运行，阻止外部网络和其他文件。"
                  "A/C 在动画帧中采最后可见舞台底图，并独立读取 #film 解码第 0 帧。"
                  "B 在固定机位采静止及约 29% 进度的 WebGL 画面。"
                  "像素按 RGB 0–255 统计，within_8_pct 为每个通道误差均不超过 8 的像素比例。",
        "old_reference": "原课件 zunyi.png 及独立离线上下文解码的原 zunyi.mp4 第 0 帧，先统一到 800×450。",
        "routes": {},
    }
    try:
        with sync_playwright() as playwright:
            with playwright.chromium.launch(channel="msedge", headless=True) as browser:
                report["edge_version"] = browser.version
                references = old_references(browser)
                for route, filename in FILES.items():
                    item = report["routes"][route] = {"filename": filename}
                    source = args.input_dir / filename
                    if not source.is_file():
                        item["status"] = "缺少交付文件"
                        continue
                    try:
                        passed = verify_route(browser, route, source, out, references, item)
                        item["status"] = "通过" if passed else "失败"
                    except Exception as exc:
                        item.update(status="失败", error=str(exc)[:1800])
    except Exception as exc:
        report["error"] = str(exc)[:1800]
    passed = (len(report["routes"]) == len(FILES) and not report.get("error")
              and all(route_result["status"] == "通过" for route_result in report["routes"].values()))
    report["status"] = "通过" if passed else "失败"
    target = out / "report.json"
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{report['status']}，报告已写入 {target}", flush=True)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
