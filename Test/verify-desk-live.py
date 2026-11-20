"""从单文件课件的真实入口验收遵义会议桌。运行 python -B Test/verify-desk-live.py。

需要 Microsoft Edge、Python Playwright、Pillow、NumPy、FFmpeg 和 ffprobe。
浏览器只打开空目录中的 HTML。精修 PNG 仅供 Python 比对，MP4 取自播放元素。
"""

import base64
import hashlib
import io
import json
import math
import re
import shutil
import subprocess
import sys
from collections import deque
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

import numpy as np
from PIL import Image, ImageChops, ImageEnhance
from playwright.sync_api import Error as PlaywrightError, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
LESSON = ROOT / "课堂演示" / "从于都到遵义-课堂演示.html"
ORIGINAL = ROOT / "展示材料" / "遵义会议室精修场景" / "会前的桌边.png"
QA = ROOT / ".march-build" / "desk-live" / "qa"
TITLE = "会议桌上的两份材料"
FRAME = ".desk-live-frame"
VIDEO = ".desk-live-video"
SEEK = ".desk-live-seek"
LEFT = "翻阅左册 · 会前形势"
RIGHT = "翻阅右册 · 会议讨论"
COMPARE = "桌面并排对照"
GUIDE = re.compile(r"^播放\s*90\s*秒导览$")
DUAL = re.compile(r"^(?:开始)?双屏授课$")
PAUSE = re.compile(r"^暂停(?:播放|导览|翻页)?$")
RESUME = re.compile(r"^继续(?:播放|导览|翻页)?$")
SIZE = (640, 360)
# 640 × 360 的原机位坐标。三个窗口分别跨过桌沿、左册封角和右册书口。
LANDMARKS = {"桌沿": (378, 292, 455, 325), "左册": (220, 220, 260, 265),
             "右册": (345, 217, 399, 256)}
DESK = (90, 112, 592, 307)
TURN = (64, 77, 294, 261)
ABOVE_COVER = (95, 86, 276, 157)
STILL = (340, 130, 579, 249)


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def button(page, name):
    return page.get_by_role("button", name=name, exact=isinstance(name, str))


def pixels(raw):
    with Image.open(io.BytesIO(raw)) as image:
        return image.convert("RGB").resize(SIZE, Image.Resampling.LANCZOS)


def error(a, b, box=None):
    if box:
        a, b = a.crop(box), b.crop(box)
    delta = np.abs(np.asarray(a, dtype=np.int16) - np.asarray(b, dtype=np.int16))
    return round(float(delta.mean()), 3), round(float((delta.max(axis=2) > 16).mean()), 4)


def registration(reference, observed):
    """在原机位标志物附近寻找亮度相关性最高的位置，位移单位为 640 图像像素。"""
    ref = np.asarray(reference.convert("L"), dtype=np.float32)
    img = np.asarray(observed.convert("L"), dtype=np.float32)
    result = {}
    for name, (x, y, r, b) in LANDMARKS.items():
        template = ref[y:b, x:r]
        template = template - template.mean()
        norm = np.linalg.norm(template)
        best = (-1., 0, 0)
        for dy in range(-8, 9):
            for dx in range(-8, 9):
                patch = img[y+dy:b+dy, x+dx:r+dx]
                patch = patch - patch.mean()
                score = (template * patch).sum() / max(norm * np.linalg.norm(patch), 1.)
                if score > best[0]:
                    best = (float(score), dx, dy)
        result[name] = (round(best[0], 3), best[1], best[2])
    return result


def compare_view(label, reference, observed, limit):
    mae, changed = error(reference, observed, DESK)
    marks = registration(reference, observed)
    print(f"  {label}，桌面 RGB 平均差 {mae}/255，通道差超过 16 的占比 {changed:.1%}，"
          f"标志物（相关系数、横移、纵移）{marks}", flush=True)
    check(mae < limit, f"{label} 桌面画面偏差过大")
    for name, (score, dx, dy) in marks.items():
        check(score >= .80 and math.hypot(dx, dy) <= 4, f"{label} 的{name}未对齐 {marks[name]}")


def command(*args):
    result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=120)
    check(result.returncode == 0, f"{args[0]} 失败 {result.stderr.decode(errors='replace')[-1200:]}")
    return result.stdout


def video_frames(path, sample=False):
    filters = ("fps=2," if sample else "") + "scale=640:360:flags=lanczos"
    limit = [] if sample else ["-frames:v", "1"]
    raw = command("ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-map", "0:v:0",
                  "-vf", filters, *limit, "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1")
    stride = math.prod(SIZE) * 3
    check(raw and len(raw) % stride == 0, "FFmpeg 未解出完整视频帧")
    return [Image.frombytes("RGB", SIZE, raw[i:i+stride]) for i in range(0, len(raw), stride)]


def embedded_movie(page, target):
    encoded = page.evaluate("""async () => {
      const v = document.querySelector('.desk-live-video');
      if (!v.videoWidth || !/^(data:|blob:)/.test(v.currentSrc)) throw Error('没有内嵌媒体');
      if (v.currentSrc.startsWith('data:') && v.currentSrc.includes(';base64,'))
        return v.currentSrc.slice(v.currentSrc.indexOf(',') + 1);
      const blob = await (await fetch(v.currentSrc)).blob();
      return await new Promise((resolve, reject) => {
        const r = new FileReader(); r.onerror = reject;
        r.onload = () => resolve(r.result.split(',')[1]); r.readAsDataURL(blob);
      });
    }""")
    target.write_bytes(base64.b64decode(encoded, validate=True))
    return target


def inspect_movie(path, reel, original, out):
    info = json.loads(command("ffprobe", "-v", "error", "-show_format", "-show_streams",
                              "-of", "json", str(path)))
    with path.open("rb") as stream:
        header = stream.read(12)
    check("mp4" in info["format"]["format_name"].split(",") and header[4:8] == b"ftyp"
          and header[8:12] != b"qt  ", f"{reel} 播放源不是 MP4")
    streams = info["streams"]
    video = next(s for s in streams if s["codec_type"] == "video")
    duration = float(video.get("duration", info["format"]["duration"]))
    target = 6 if reel == "翻页" else 90
    check(abs(duration-target) <= .3, f"{reel} 视频轨时长 {duration:.3f} 秒，应为 {target} 秒")
    print(f"  {reel}内嵌 MP4，{video['width']} × {video['height']}，{duration:.3f} 秒，"
          f"SHA256 {hashlib.sha256(path.read_bytes()).hexdigest()[:16]}", flush=True)
    zero = video_frames(path)[0]
    zero.save(out / f"{reel}-MP4零帧.png")
    compare_view(f"{reel}独立精修 PNG 与 FFmpeg 零帧", original, zero, 7)
    if reel == "导览":
        audio = [s for s in streams if s["codec_type"] == "audio"]
        check(audio, "90 秒导览没有音轨")
        pcm = command("ffmpeg", "-v", "error", "-nostdin", "-i", str(path), "-map", "0:a:0",
                      "-ac", "1", "-ar", "8000", "-f", "s16le", "pipe:1")
        signal = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
        blocks = signal[:len(signal)//4000*4000].reshape(-1, 4000)
        check(len(blocks) and np.max(np.mean(blocks**2, axis=1)) > 100**2, "导览音轨解码后静音")
        print(f"  视频轨起点 {video.get('start_time')} 秒，时长 {duration:.3f} 秒，"
              f"{audio[0]['codec_name']} 音轨起点 {audio[0].get('start_time')} 秒，"
              f"时长 {audio[0].get('duration')} 秒", flush=True)
    else:
        frames = video_frames(path, sample=True)
        distinct = []
        for shot in frames:
            if all(error(shot, prior, TURN)[1] > .018 for prior in distinct):
                distinct.append(shot)
        lifted = max(frames, key=lambda shot: error(zero, shot, ABOVE_COVER)[1])
        lifted.save(out / "翻页-封面抬起.png")
        turn = error(zero, lifted, TURN)[1]
        above = error(zero, lifted, ABOVE_COVER)[1]
        quiet = max(error(zero, shot, STILL)[1] for shot in frames)
        print(f"  翻页有 {len(distinct)} 个可区分姿态，左册变化 {turn:.1%}，"
              f"原封面上方变化 {above:.1%}，右册和背景变化 {quiet:.1%}", flush=True)
        check(len(distinct) >= 4 and turn > .06 and above > .03 and quiet < .04,
              "解码画面未呈现左册连续翻起、桌面和右册保持稳定")
    return zero


def pose(page):
    values = page.locator(FRAME).evaluate("""f =>
      ['yaw','pitch','zoom'].map(k => parseFloat(f.dataset[k]))""")
    check(all(v is not None and math.isfinite(v) for v in values), f"机位读数无效 {values}")
    return values


def same_pose(page, expected):
    page.wait_for_function("""p => ['yaw','pitch','zoom'].every((k,i) =>
      Math.abs(parseFloat(document.querySelector('.desk-live-frame')?.dataset[k])-p[i]) < .025)""",
                           arg=expected)


def phase(page, value, paused=False):
    frame = page.locator(FRAME)
    expect(frame).to_have_attribute("data-phase", value)
    expect(frame).to_have_attribute("data-paused", str(paused).lower())


def evidence(page, mode):
    expect(page.locator(FRAME)).to_have_attribute("data-evidence", mode)
    boxes = []
    for side in ("left", "right"):
        card = page.locator(f".dossier-slot.is-{side} .folio-card")
        if mode in (side, "both"):
            expect(card).to_be_visible()
            expect(card).to_be_in_viewport(ratio=.65)
            expect(card.locator("h3")).to_have_text("会前形势" if side == "left" else "会议讨论")
            expect(card.locator("p").first).to_have_text(re.compile(r"\S"))
            check(card.evaluate("e => e.checkVisibility({opacityProperty:true,visibilityProperty:true})"),
                  f"{side} 册占位但画面透明")
            boxes.append(card.bounding_box())
        else:
            expect(card).to_be_hidden()
    if mode == "both":
        check(boxes[0]["x"] + boxes[0]["width"] <= boxes[1]["x"] + 2, "并排展开的材料相互覆盖")


def projection_privacy(teacher, student):
    notes = teacher.locator(".presenter-notes")
    expect(notes.locator("h2")).to_have_text(TITLE)
    script = notes.locator("p:not(.presenter-time):not(.presenter-question)")
    expect(script.first).to_be_visible()
    for entry in [*script.all_inner_texts(), *notes.locator(".presenter-question").all_inner_texts()]:
        check(entry.strip() and entry.strip() not in student.locator("body").inner_text(), "教师讲稿或提问出现在投影")
    expect(student.locator("#presenter")).to_be_hidden()
    for label in (DUAL, LEFT, RIGHT, COMPARE, GUIDE, PAUSE, RESUME, "返回桌面"):
        expect(button(student, label)).to_be_hidden()
    expect(student.locator(SEEK)).to_be_hidden()
    check(student.evaluate("!document.querySelector('.desk-live-video').controls"), "投影显示原生视频控件")


def projector(teacher, size, previous=None):
    if previous is not None:
        previous.close()
        expect(teacher.locator(".presenter-status")).to_have_text("投影窗口已关闭")
    with teacher.expect_popup() as opened:
        button(teacher, "重新打开投影" if previous is not None else DUAL).click()
    student = opened.value
    student.set_viewport_size(size)
    expect(teacher.locator(".presenter-status")).to_have_text("投影已连接")
    expect(student.locator(".scene-head h1")).to_have_text(TITLE)
    expect(student.locator(FRAME)).to_have_attribute("data-space", "ready", timeout=25000)
    check(student.evaluate("!navigator.onLine"), "投影有网络连接")
    projection_privacy(teacher, student)
    return student


def stage_shot(page):
    return pixels(page.locator(FRAME).screenshot())


def scene_point(page, u, v):
    box = page.locator(FRAME).bounding_box()
    return box["x"] + u * box["width"], box["y"] + v * box["height"]


def drag(page, du, dv):
    start = scene_point(page, .58, .32)
    end = scene_point(page, .58+du, .32+dv)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=8)
    page.mouse.up()


def observe_space(teacher, student):
    pin = button(teacher, LEFT)
    initial_pin = pin.bounding_box()
    before = stage_shot(student)
    initial = pose(teacher)
    for axis, name in enumerate(("水平拖动", "垂直拖动", "滚轮缩放")):
        previous = pose(teacher)
        if axis == 2:
            teacher.mouse.move(*scene_point(teacher, .58, .32))
            teacher.mouse.wheel(0, -110)
        else:
            drag(teacher, .16 if axis == 0 else 0, .13 if axis == 1 else 0)
        teacher.wait_for_function("""([key, old]) =>
          Math.abs(Number(document.querySelector('.desk-live-frame').dataset[key])-old) > .015""",
                                  arg=[("yaw", "pitch", "zoom")[axis], previous[axis]])
        same_pose(student, pose(teacher))
        after = stage_shot(student)
        mae, fraction = error(before, after, DESK)
        check(mae > 1 and fraction > .018, f"{name}只改变了读数，投影桌面像素差 {mae} / {fraction}")
        before = after
    now = pin.bounding_box()
    check(math.hypot(now["x"]-initial_pin["x"], now["y"]-initial_pin["y"]) > 3, "左册热点没有随相机移动")
    return initial, before


def pick_left(page):
    """以随书移动的可见标签定位，点击偏下的封面，命中目标须是场景本身。"""
    pin = button(page, LEFT).bounding_box()
    box = page.locator(FRAME).bounding_box()
    x = pin["x"] + pin["width"] / 2
    y = pin["y"] + pin["height"] + box["height"] * .018
    hit = page.evaluate("""([x,y]) => {
      const e = document.elementFromPoint(x,y);
      return !!e?.closest('.desk-live-frame') && !e.closest('button,input,article');
    }""", [x, y])
    check(hit, "左册封面取样点被控件或其他元素遮住")
    page.mouse.click(x, y)


# 在 Edge 合成画面上取帧。观察器只记录公开的阶段、显示时刻和视口位置。
# 进入 film 之前的样本按合成时间选定，绝不按“与零帧最相似”倒选。
TRACE = """() => {
  const f = document.querySelector('.desk-live-frame'), v = f.querySelector('video');
  const c = f.querySelector('.desk-live-canvas'), states = [];
  const visible = e => e.checkVisibility({opacityProperty:true, visibilityProperty:true});
  function read() {
    const phase = f.dataset.phase, canvas = visible(c), movie = visible(v);
    const pose = [f.dataset.yaw, f.dataset.pitch, f.dataset.zoom].map(Number);
    const front = pose[0]===0 && pose[1]===0 && pose[2]===1;
    const last = states.at(-1);
    if (last && last.phase===phase && last.canvas===canvas && last.movie===movie && last.front===front) return;
    const box = (movie ? v : c).getBoundingClientRect();
    const seek = document.querySelector('.desk-live-seek').getBoundingClientRect();
    states.push({at:performance.timeOrigin + performance.now(), tick:document.timeline.currentTime,
      phase, canvas, movie, front, pose, rect:[box.x,box.y,box.width,box.height],
      seek:[seek.x,seek.y,seek.width,seek.height], viewport:[innerWidth,innerHeight]});
  }
  const observer = new MutationObserver(read);
  observer.observe(f,{subtree:true,attributes:true}); let id;
  function tick() { read(); id = requestAnimationFrame(tick); }
  tick();
  window.finishDeskTrace = () => { read(); observer.disconnect(); cancelAnimationFrame(id); return states; };
}"""


def screen_plane(encoded, state, rect=None, size=SIZE):
    with Image.open(io.BytesIO(base64.b64decode(encoded))) as image:
        vw, vh = state["viewport"]
        x, y, w, h = state["rect"] if rect is None else rect
        check(w > 0 and h > 0 and x >= -1 and y >= -1 and x+w <= vw+1 and y+h <= vh+1,
              f"会议桌超出录屏视口 {state}")
        box = (x*image.width/vw, y*image.height/vh, (x+w)*image.width/vw, (y+h)*image.height/vh)
        return image.convert("RGB").resize(size, Image.Resampling.LANCZOS, box=box)


def handoff(teacher, trigger, reel, out, issues):
    angled = stage_shot(teacher)
    samples = deque(maxlen=360)
    session = teacher.context.new_cdp_session(teacher)

    def collect(event):
        samples.append((event["metadata"]["timestamp"]*1000, event["data"]))
        session.send("Page.screencastFrameAck", {"sessionId": event["sessionId"]})

    teacher.evaluate(TRACE)
    session.on("Page.screencastFrame", collect)
    session.send("Page.startScreencast", {"format": "jpeg", "quality": 94, "maxWidth": 1120})
    try:
        trigger(teacher)
        phase(teacher, "film")
        teacher.wait_for_function("""() => {
          const v=document.querySelector('.desk-live-video');
          return v.readyState>=2 && !v.paused && v.currentTime>.48;
        }""")
    finally:
        states = teacher.evaluate("finishDeskTrace()")
        session.remove_listener("Page.screencastFrame", collect)
        session.send("Page.stopScreencast")
        session.detach()
    align = next((s for s in states if s["phase"] == "align" and s["canvas"] and not s["movie"]), None)
    film = next((s for s in states if s["phase"] == "film" and s["movie"]), None)
    check(align and film, f"{reel} 缺少可见的三维归位或电影画面 {states}")
    cutoff = next(s["at"] for s in states if s["at"] >= align["at"] and (s["phase"] == "film" or s["movie"]))
    pre = [(t, data) for t, data in samples if align["at"] <= t < cutoff]
    post = sorted((t, data) for t, data in samples if film["at"] <= t)
    check(pre and post, f"{reel} 未能采到切换两侧的合成帧，归位 {len(pre)} 帧，播放 {len(post)} 帧")
    t0, source = max(pre, key=lambda entry: entry[0])
    (out / f"{reel}-入片前整窗.jpg").write_bytes(base64.b64decode(source))
    check(cutoff-t0 <= 220, f"{reel} 切入前最后可证实的绘制距入片 {cutoff-t0:.0f} 毫秒")
    # 两侧都按电影的实际显示位置裁切，能测出 canvas 与 video 的 CSS 位移。
    before = screen_plane(source, film)
    before.save(out / f"{reel}-入片前实际绘制.png")
    front = next((s for s in states if s["phase"] == "align" and s["front"] and not s["movie"]), None)
    check(front, f"{reel} 未在入片前观察到正面机位")
    hold = film["tick"] - front["tick"]
    # 同一张合成截图中观察真实进度条和视频背景。DOM 时间只用于辨认肯定尚未入片的样本。
    x, y, w, h = film["seek"]
    track_box = (x+.32*w, y+.18*h, .44*w, .64*h)

    def track(data):
        return screen_plane(data, film, track_box, (80, 16))

    hidden_track, shown_track = track(source), track(post[-1][1])
    playing_plane = screen_plane(post[-1][1], film)
    check(error(hidden_track, shown_track)[0] > 3, "录屏未能辨认进度条从隐藏到实际显示")
    near_cut = sorted((t, data) for t, data in samples if t >= cutoff-350)
    pictures = []
    for at, data in near_cut:
        bar = track(data)
        bar_shown = error(bar, shown_track)[0] < error(bar, hidden_track)[0]
        picture = screen_plane(data, film)
        # 右册与背景在两个片头均静止，压缩/着色特征能区分现场绘制和解码画面。
        stage_error = error(picture, before, STILL)[0]
        film_error = error(picture, playing_plane, STILL)[0]
        pictures.append((at, data, picture, bar_shown, stage_error, film_error))
    distinguishable = error(before, playing_plane, STILL)[0] > .5
    cut = next((i for i, (at, _, _, bar, stage_err, film_err) in enumerate(pictures)
                if at >= cutoff and bar and (not distinguishable or film_err < stage_err)), None)
    check(cut is not None and cut > 0, "合成画面中未找到实际切入视频的边界")
    t1, _, after, *_ = pictures[cut]
    t_last, _, last_stage, *_ = pictures[cut-1]
    after.save(out / f"{reel}-入片后实际显示.png")
    last_stage.save(out / f"{reel}-切片前最后合成帧.png")
    first_still, last_moving = t_last, None
    for at, _, picture, *_ in reversed(pictures[:cut]):
        if error(last_stage, picture, DESK)[0] > .4:
            last_moving = at
            break
        first_still = at
    minimum = t_last-first_still
    maximum = t1-last_moving if last_moving is not None else None
    frames = out / f"{reel}-连续合成帧"
    frames.mkdir(exist_ok=True)
    readings = []
    for i, (at, data, picture, bar, stage_err, film_err) in enumerate(pictures):
        if -220 <= at-t1 <= 55:
            name = f"{i:03d}_{at-t1:+07.1f}ms.jpg"
            (frames / name).write_bytes(base64.b64decode(data))
            readings.append([name, bar, stage_err, film_err, error(last_stage, picture, DESK)[0]])
    timeline = {"states": states, "last_pre_dom_paint_ms": t0, "film_phase_ms": cutoff,
                "last_stage_paint_ms": t_last, "visible_film_paint_ms": t1, "frames": readings,
                "front_timeline_ms": hold, "stable_display_min_ms": minimum, "stable_display_max_ms": maximum}
    (out / f"{reel}-切换时序.json").write_text(json.dumps(timeline, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"  {reel}正面机位保持 {hold:.1f} 毫秒，合成画面稳定至少 {minimum:.1f} 毫秒，"
          f"视频实际合成比页面切换晚 {t1-cutoff:.1f} 毫秒", flush=True)
    if hold < 99.9 or (minimum < 99.9 and (maximum is None or maximum < 99.9)):
        issue = f"{reel} 正面不足 100 毫秒或采样不足，机位 {hold:.1f}，合成区间 {minimum:.1f} 至 {maximum}"
        issues.append(issue)
        print(issue, file=sys.stderr, flush=True)
    return angled, before, after


def verify_handoff(capture, zero, reel, out):
    angled, before, after = capture
    Image.blend(before, zero, .5).save(out / f"{reel}-入片前与解码零帧叠图.png")
    diff = ImageChops.difference(before, zero)
    ImageEnhance.Brightness(diff).enhance(4).save(out / f"{reel}-入片差异四倍.png")
    compare_view(f"{reel}入片前实际绘制与零帧", zero, before, 16)
    compare_view(f"{reel}入片后实际显示与零帧", zero, after, 16)
    check(error(angled, zero, DESK)[0] > error(before, zero, DESK)[0] + 1,
          f"{reel} 未观察到侧机位向首帧归位")


def clock(page):
    return page.evaluate("document.querySelector('.desk-live-video').currentTime")


def playing(page, since=0):
    phase(page, "film")
    page.wait_for_function("""t => {
      const v=document.querySelector('.desk-live-video');
      return v?.checkVisibility({opacityProperty:true,visibilityProperty:true}) &&
        v.readyState>=2 && !v.paused && !v.seeking && v.currentTime>t;
    }""", arg=since)


def paused(page, target):
    phase(page, "film", True)
    page.wait_for_function("""t => {
      const v=document.querySelector('.desk-live-video');
      return v?.checkVisibility({opacityProperty:true,visibilityProperty:true}) && v.readyState>=2 &&
        v.paused && !v.seeking && Math.abs(v.currentTime-t)<.25;
    }""", arg=target)


def audio_owner(teacher, student):
    counts = [p.evaluate("""() => [...document.querySelectorAll('video,audio')].filter(v =>
      !v.paused && !v.ended && !v.muted && v.volume>0).length""") for p in (teacher, student)]
    check(sum(counts) == 1, f"导览发声端数量异常，教师和投影分别为 {counts}")
    return "教师" if counts[0] else "投影"


def resume_clocks(teacher, student, frozen, out):
    for page in (teacher, student):
        page.evaluate("""() => {
          const v=document.querySelector('.desk-live-video'), samples=[];
          const sample=()=>samples.push([performance.timeOrigin+performance.now(), v.currentTime,
            v.paused, v.seeking, v.readyState]);
          const timer=setInterval(sample,40); sample();
          window.finishDeskClocks=()=>{clearInterval(timer);sample();return samples;};
        }""")
    button(teacher, RESUME).click()
    for page in (teacher, student):
        playing(page, frozen+1.5)
    rows = [p.evaluate("finishDeskClocks()") for p in (teacher, student)]
    (out / "续播双屏时钟.json").write_text(json.dumps(dict(zip(("teacher", "projection"), rows))),
                                           encoding="utf-8")
    active = [[r for r in series if not r[2] and not r[3] and r[4] >= 2] for series in rows]
    pairs = []
    for at, timestamp, *_ in active[0]:
        if active[1]:
            other_at, other_time, *_ = min(active[1], key=lambda r: abs(r[0]-at))
            if abs(other_at-at) <= 60:
                # 把两次实际采样换算到同一时刻，最多校正 60 毫秒。
                skew = timestamp-other_time - (at-other_at)/1000
                pairs.append((at, timestamp, other_time, abs(skew)))
    check(len(pairs) >= 3 and pairs[-1][0]-pairs[0][0] >= 500, "续播后缺少同时段的双屏采样")
    _, first, second, worst = max(pairs, key=lambda pair: pair[-1])
    print(f"  续播后取得 {len(pairs)} 对同时间采样，双屏最大时差 {worst:.3f} 秒"
          f"（教师 {first:.3f} 秒，投影 {second:.3f} 秒）", flush=True)
    return worst


def leave_during(page, name, expected_phase):
    control = button(page, name)
    control.evaluate("""b => b.addEventListener('click', e => {
      window.deskExitPhase = e.isTrusted && document.querySelector('.desk-live-frame').dataset.phase;
    }, {once:true,capture:true})""")
    control.click()
    actual = page.evaluate("window.deskExitPhase")
    check(actual == expected_phase, f"点击{name}时阶段是 {actual}，未实际覆盖 {expected_phase}")


def quiet_browse(teacher, student, seconds):
    """覆盖旧翻页片尾和归位回调的实际时间，并记下期间短暂复现的状态。"""
    for page in (teacher, student):
        page.evaluate("""() => {
          const f=document.querySelector('.desk-live-frame'), v=f.querySelector('video'), errors=[];
          function inspect() {
            if (!f.isConnected || f.dataset.phase!=='browse' || f.dataset.evidence!=='none' ||
                !v.paused || [...f.querySelectorAll('.folio-card')].some(c =>
                    c.checkVisibility({opacityProperty:true,visibilityProperty:true})))
              errors.push([f.dataset.phase,f.dataset.evidence,v.paused]);
          }
          const observer=new MutationObserver(inspect);
          observer.observe(f,{subtree:true,attributes:true}); v.addEventListener('play',inspect);
          window.endDeskGuard=()=>{inspect();observer.disconnect();v.removeEventListener('play',inspect);return errors.slice(0,3);};
          inspect();
        }""")
    teacher.wait_for_timeout(seconds*1000)
    for page in (teacher, student):
        glitches = page.evaluate("endDeskGuard()")
        check(not glitches, f"迟到回调改变了已返回的桌面 {glitches}")
        evidence(page, "none")


def exercise(teacher, student_size, original, scratch, out):
    issues = []
    button(teacher, "遵义实景").click()
    expect(teacher.locator(".scene-head h1")).to_have_text(TITLE)
    expect(teacher.locator(".scene-head h1")).to_be_visible()
    expect(teacher.locator(FRAME)).to_have_attribute("data-space", "ready", timeout=25000)
    student = projector(teacher, student_size)
    for page in (teacher, student):
        phase(page, "browse")
        expect(page.locator(FRAME + " .desk-live-canvas")).to_be_visible()
        evidence(page, "none")
    home, view = observe_space(teacher, student)
    first_angle = pose(teacher)
    student = projector(teacher, student_size, student)
    same_pose(student, first_angle)
    evidence(student, "none")
    check(error(view, stage_shot(student), DESK)[0] < 5, "浏览重连后画面机位改变")

    teacher.locator(VIDEO).evaluate("""v => v.addEventListener('ended', e => {
      window.deskFlipEnd = e.isTrusted && v.currentTime;
    }, {once:true,capture:true})""")
    flip = handoff(teacher, pick_left, "翻页", out, issues)
    playing(student)
    projection_privacy(teacher, student)
    for page in (teacher, student):
        evidence(page, "none")
    flip_path = embedded_movie(teacher, scratch / "flip.mp4")
    observed_turns = []
    for moment in (1.5, 3.0):
        playing(student, moment)
        observed_turns.append(stage_shot(student))
    for page in (teacher, student):
        phase(page, "browse")
        evidence(page, "left")
    ended = teacher.evaluate("window.deskFlipEnd")
    check(ended and abs(ended-6) < .3, f"左册展开前未收到翻页视频的自然片尾 {ended}")
    zero = inspect_movie(flip_path, "翻页", original, out)
    verify_handoff(flip, zero, "翻页", out)
    visible_turn = max(observed_turns, key=lambda shot: error(zero, shot, ABOVE_COVER)[1])
    visible_turn.save(out / "翻页-投影实际播放.png")
    check(error(zero, visible_turn, ABOVE_COVER)[1] > .03 and error(zero, visible_turn, STILL)[0] < 12,
          "投影播放中没有显示左册抬起或桌面背景跳位")

    for mode, control in (("left", None), ("right", RIGHT), ("both", COMPARE)):
        if control:
            teacher.keyboard.press("Escape")
            evidence(student, "none")
            button(teacher, control).click()
        for page in (teacher, student):
            phase(page, "browse")
            evidence(page, mode)
        before_reopen = stage_shot(student)
        student = projector(teacher, student_size, student)
        phase(student, "browse")
        evidence(student, mode)
        restored = stage_shot(student)
        restored.save(out / f"材料重连-{mode}.png")
        check(error(before_reopen, restored)[0] < 5, f"{mode} 材料重连后投影画面改变")
    teacher.keyboard.press("Escape")
    evidence(student, "none")
    drag(teacher, -.18, -.12)
    second_angle = pose(teacher)
    same_pose(student, second_angle)
    check((first_angle[0]-home[0])*(second_angle[0]-home[0]) < 0,
          f"两次入片没有来自不同侧面 {first_angle} / {second_angle}")
    print(f"  翻页与导览的起始机位（水平、俯仰、缩放）分别为 {first_angle}、{second_angle}", flush=True)
    guide = handoff(teacher, lambda p: button(p, GUIDE).click(), "导览", out, issues)
    playing(student)
    owner = audio_owner(teacher, student)
    button(teacher, PAUSE).click()
    phase(teacher, "film", True)
    frozen = clock(teacher)
    for page in (teacher, student):
        paused(page, frozen)
    guide_path = embedded_movie(teacher, scratch / "guide.mp4")
    zero = inspect_movie(guide_path, "导览", original, out)
    verify_handoff(guide, zero, "导览", out)
    slider = teacher.locator(SEEK)
    box = slider.bounding_box()
    slider.click(position={"x": box["width"]*.43, "y": box["height"]/2})
    teacher.wait_for_function("Math.abs(document.querySelector('.desk-live-video').currentTime-38.7)<3")
    frozen = clock(teacher)
    for page in (teacher, student):
        paused(page, frozen)
    view = stage_shot(student)
    student = projector(teacher, student_size, student)
    paused(student, frozen)
    check(error(view, stage_shot(student), DESK)[0] < 5, "暂停重连后实际画面改变")
    teacher.wait_for_timeout(450)
    for page in (teacher, student):
        check(abs(clock(page)-frozen) < .12, "暂停或重连后视频时钟仍在走动")
    resume_skew = resume_clocks(teacher, student, frozen, out)
    teacher.wait_for_function("""() => {
      const v=document.querySelector('.desk-live-video'), r=document.querySelector('.desk-live-seek');
      const fraction=(r.valueAsNumber-Number(r.min))/(Number(r.max)-Number(r.min));
      return Math.abs(fraction*v.duration-v.currentTime)<.5;
    }""")
    print(f"  导览在 {frozen:.2f} 秒暂停重连并续播，初始发声端为{owner}，"
          f"重连后为{audio_owner(teacher, student)}", flush=True)
    button(teacher, "返回桌面").click()
    phase(student, "browse")

    drag(teacher, .24, .15)
    button(teacher, LEFT).click()
    leave_during(teacher, "返回桌面", "align")
    for page in (teacher, student):
        phase(page, "browse")
    quiet_browse(teacher, student, 7)
    old = []
    for exit_phase in ("align", "film"):
        drag(teacher, -.24, -.15)
        for page in (teacher, student):
            media = page.locator(VIDEO).element_handle()
            media.evaluate("""v => v.addEventListener('playing', () => {
              if (!v.isConnected) v.playedAfterLeavingDesk = true;
            })""")
            old.append(media)
        button(teacher, LEFT).click()
        if exit_phase == "film":
            for page in (teacher, student):
                playing(page, .2)
        leave_during(teacher, "下一页", exit_phase)
        for page, video in zip((teacher, student), old[-2:]):
            expect(page.locator(".scene-head h1")).to_have_text("军事问题")
            expect(page.locator(FRAME)).to_have_count(0)
            check(video.evaluate("v => v.paused || v.ended"), "切页后旧视频仍在播放")
        button(teacher, "上一页").click()
        for page in (teacher, student):
            expect(page.locator(".scene-head h1")).to_have_text(TITLE)
            phase(page, "browse")
        quiet_browse(teacher, student, 7)
        for page in (teacher, student):
            expect(page.locator(FRAME)).to_have_attribute("data-space", "ready", timeout=25000)
    for video in old:
        check(video.evaluate("v => (v.paused || v.ended) && !v.playedAfterLeavingDesk"),
              "离开后的旧视频被迟到回调重新启动")
    button(teacher, "上一页").click()
    expect(student.locator(".scene-head h1")).to_have_text("遵义会议室")
    button(teacher, "下一页").click()
    expect(student.locator(".scene-head h1")).to_have_text(TITLE)
    button(teacher, "结束双屏").click()
    check(student.is_closed(), "结束授课后投影仍在播放")
    check(resume_skew < .65, f"导览暂停重连、续播后双屏进度相差 {resume_skew:.3f} 秒")
    check(not issues, "，".join(issues))


def main():
    out = QA / datetime.now().strftime("%Y%m%d-%H%M%S-%f")
    out.mkdir(parents=True)
    print(f"QA 画面保存到 {out}", flush=True)
    original = pixels(ORIGINAL.read_bytes())
    original.save(out / "独立参考-精修工程原PNG.png")
    failed = []
    with TemporaryDirectory() as tmp, sync_playwright() as playwright:
        scratch = Path(tmp)
        isolated = scratch / "offline"
        isolated.mkdir()
        lesson = isolated / LESSON.name
        shutil.copyfile(LESSON, lesson)
        identity = f"{lesson.stat().st_size} 字节，SHA256 {hashlib.sha256(lesson.read_bytes()).hexdigest()}"
        print(f"隔离副本 {identity}", flush=True)
        (out / "课件版本.txt").write_text(identity + "\n", encoding="utf-8")
        url = lesson.as_uri()
        with playwright.chromium.launch(channel="msedge", headless=True) as browser:
            for width, projection in ((1366, (1920, 1080)), (1920, (1366, 768))):
                case = out / str(width)
                case.mkdir()
                print(f"Edge {browser.version}，教师 {width} × 768，投影 {projection[0]} × {projection[1]}", flush=True)
                with browser.new_context(offline=True, viewport={"width": width, "height": 768}) as context:
                    context.set_default_timeout(12000)
                    errors = []
                    context.on("weberror", lambda e: errors.append(str(e.error)[:500]))

                    def inspect_request(request):
                        if not request.url.startswith(("data:", "blob:", "about:")) and urldefrag(request.url).url != url:
                            errors.append("课件请求外部资源 " + request.url[:200])

                    context.on("request", inspect_request)
                    teacher = context.new_page()
                    try:
                        teacher.goto(url)
                        check(teacher.evaluate("!navigator.onLine"), "教师窗口有网络连接")
                        exercise(teacher, {"width": projection[0], "height": projection[1]}, original, scratch, case)
                        check(not errors, str(errors))
                        print(f"通过教师宽度 {width} 的离线双屏验收", flush=True)
                    except Exception as exc:
                        failed.append(width)
                        print(f"教师宽度 {width} 失败\n{str(exc)[:2200]}", file=sys.stderr, flush=True)
                        if errors:
                            print(errors[:5], file=sys.stderr, flush=True)
                        for index, page in enumerate(context.pages):
                            if not page.is_closed():
                                try:
                                    page.screenshot(path=case / f"失败-窗口{index+1}.png", timeout=5000)
                                except PlaywrightError as shot_error:
                                    print(f"失败窗口无法截图 {str(shot_error)[:150]}", file=sys.stderr)
        check(list(isolated.iterdir()) == [lesson], "离线目录内出现了 HTML 以外的文件")
    return int(bool(failed))


if __name__ == "__main__":
    sys.exit(main())
