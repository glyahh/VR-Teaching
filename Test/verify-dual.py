import shutil
from argparse import ArgumentParser
from io import BytesIO
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import urldefrag

from PIL import Image, ImageChops, ImageStat
from playwright.sync_api import expect, sync_playwright
from exploration_input import drag, elapsed_frames, walk
from course_checks import exercise_desk


def reopen_projection(teacher, student):
    viewport = student.viewport_size
    student.close()
    with teacher.expect_popup() as reopened:
        teacher.get_by_role("button", name="重新打开投影", exact=True).click()
    student = reopened.value
    student.set_viewport_size(viewport)
    expect(teacher.locator(".presenter-status")).to_have_text("投影已连接", timeout=18000)
    return student


def verify_pacing(teacher):
    teacher.get_by_role("button", name="教师备课", exact=True).click()
    picker = teacher.locator("#prep-pace")
    expect(picker).to_have_value("40")
    names = ("地图导入", "于都出发", "湘江战役", "黎平会议", "遵义会议", "课堂回顾")
    schedules = {
        "18": ["0:45", "3:30", "7:00", "11:00", "16:00", "18:00"],
        "30": ["1:30", "7:00", "12:30", "18:30", "27:00", "30:00"],
        "40": ["2:00", "9:00", "16:30", "24:30", "35:30", "40:00"],
        "50": ["3:00", "12:00", "21:30", "31:30", "44:30", "50:00"],
    }
    for pace, boundaries in schedules.items():
        picker.select_option(pace)
        starts = ["0:00", *boundaries[:-1]]
        expected = [f"{start}–{end} {name}" for start, end, name in zip(starts, boundaries, names)]
        expect(teacher.locator(".teacher-outline summary")).to_have_text(expected)
    picker.select_option("40")
    teacher.keyboard.press("Escape")


def verify_terrain(teacher, student):
    for page in (teacher, student):
        expect(page.locator(".terrain-surface.is-relief canvas")).to_be_visible()
    path = teacher.locator(".map-route path").first
    projection_path = student.locator(".map-route path").first
    inclined = path.get_attribute("d")
    teacher.get_by_role("button", name="俯视", exact=True).click()
    flat = path.get_attribute("d")
    assert flat != inclined
    expect(projection_path).to_have_attribute("d", flat)
    bounds = teacher.locator(".map").bounding_box()
    px = bounds["x"] + bounds["width"] * .8
    py = bounds["y"] + bounds["height"] * .23
    teacher.mouse.move(px, py)
    teacher.mouse.down()
    teacher.mouse.move(px - 90, py + 95, steps=6)
    teacher.mouse.up()
    rotated = path.get_attribute("d")
    assert rotated not in (inclined, flat)
    expect(projection_path).to_have_attribute("d", rotated)
    teacher.get_by_role("button", name="重置地图视角（快捷键 0）", exact=True).click()
    expect(projection_path).to_have_attribute("d", inclined)


def video_frame_errors(video, entry, exit):
    return video.evaluate("""async (video, {entry,exit}) => {
      const sample = document.createElement('video');
      sample.muted = true;
      sample.src = video.src;
      sample.preload = 'auto';
      function waitFor(event) {
        return new Promise((resolve,reject) => {
          const finish = error => {
            clearTimeout(timer);
            sample.removeEventListener(event,ready);
            sample.removeEventListener('error',failed);
            if (error) reject(error);
            else resolve();
          };
          const ready = () => finish();
          const failed = () => finish(new Error('无法解码视频'));
          const timer = setTimeout(() => finish(new Error('等待视频' + event + '超时')),10000);
          sample.addEventListener(event,ready,{once:true});
          sample.addEventListener('error',failed,{once:true});
        });
      }
      if (sample.readyState < 2) await waitFor('loadeddata');
      const canvas = document.createElement('canvas');
      canvas.width = sample.videoWidth;
      canvas.height = sample.videoHeight;
      const brush = canvas.getContext('2d',{willReadFrequently:true});
      function pixels(image) {
        brush.clearRect(0,0,canvas.width,canvas.height);
        const width = image.videoWidth ?? image.naturalWidth;
        const height = image.videoHeight ?? image.naturalHeight;
        const scale = Math.max(canvas.width / width, canvas.height / height);
        const scaledWidth = width * scale, scaledHeight = height * scale;
        brush.drawImage(image,(canvas.width-scaledWidth)/2,(canvas.height-scaledHeight)/2,scaledWidth,scaledHeight);
        return brush.getImageData(0,0,canvas.width,canvas.height).data;
      }
      async function difference(key) {
        const still = new Image();
        still.src = mediaAssets[key];
        await still.decode();
        const image = pixels(still), frame = pixels(sample);
        if (frame[3] !== 255) throw new Error('视频还未完成解码');
        let sum = 0;
        for (let i=0;i<image.length;i++) if (i%4!==3) sum += Math.abs(image[i]-frame[i]);
        return sum/(canvas.width*canvas.height*3);
      }
      async function seek(time) {
        const seeked = waitFor('seeked');
        sample.currentTime = time;
        await seeked;
      }
      await seek(.01);
      const first = await difference(entry);
      await seek(sample.duration-.01);
      return [first,await difference(exit)];
    }""", {"entry": entry, "exit": exit})


def verify_asset_join(browser, lesson_url, clip, entry, exit):
    with browser.new_context(offline=True, viewport={"width": 1920, "height": 1080}) as context:
        page = context.new_page()
        page.goto(lesson_url)
        video_key = clip + "-video"
        missing = page.evaluate("""keys => keys.filter(key => !mediaAssets[key])""", [video_key, entry, exit])
        if missing:
            raise SystemExit("成品中找不到资源 " + "、".join(missing))
        page.evaluate("""key => {
          const video = document.createElement('video');
          video.src = mediaAssets[key];
          video.hidden = true;
          video.dataset.joinCheck = '';
          document.body.append(video);
        }""", video_key)
        first, last = video_frame_errors(page.locator("video[data-join-check]"), entry, exit)
        print(f"{clip} 与 {entry}、{exit} 平均 RGB 差 {first:.2f}、{last:.2f}/255", flush=True)
        if max(first, last) > 3:
            raise SystemExit("首尾帧有偏差。核对实际出入片画面的机位、裁切、亮度和物件状态。")


def verify_opening(teacher, student):
    video = ".opening-page video"
    for page in (teacher, student):
        expect(page.locator(video)).to_be_visible()
        page.wait_for_function("document.querySelector('.opening-page video')?.currentTime > .25")
    seconds = teacher.locator(video).evaluate("node=>node.duration")
    assert 88 < seconds < 102, seconds
    assert not teacher.locator(video).evaluate("node=>node.muted")
    assert student.locator(video).evaluate("node=>node.muted")
    first, last = video_frame_errors(teacher.locator(video), "terrain", "yudu-assembly")
    assert max(first,last) < 3, (first,last)
    teacher.get_by_role("button",name="暂停短片",exact=True).click()
    frozen = teacher.locator(video).evaluate("node=>node.currentTime")
    student = reopen_projection(teacher, student)
    student.wait_for_function("""t=>{
      const v=document.querySelector('.opening-page video');
      return v?.paused && v.muted && Math.abs(v.currentTime-t)<.25;
    }""", arg=frozen)
    teacher.get_by_role("button",name="继续播放",exact=True).click()
    student.wait_for_function("""t=>{
      const v=document.querySelector('.opening-page video');
      return v && !v.paused && v.currentTime>t;
    }""",arg=frozen)
    teacher.get_by_role("button",name="进入课堂",exact=True).click()
    expect(student.locator(".scene-head h1")).to_have_text("于都集结")
    print(f"  开场短片 {seconds:.2f} 秒，首尾帧 RGB 差 {first:.2f}、{last:.2f}/255，重连和进课堂通过", flush=True)
    return student


def assert_scene_points(page):
    assert page.locator("button:is(.pin,.probe-pin,.hotspot,.desk-live-pin,.marker)").evaluate_all("""nodes =>
      nodes.length > 0 && nodes.every(n => n.classList.contains('scene-point') &&
        getComputedStyle(n).position === 'absolute' && n.childElementCount === 0 &&
        !n.textContent.trim() && n.getAttribute('aria-label'))
    """), "热点应只有圆点和无障碍名称"


def verify_preparation_film(teacher, student):
    error = video_frame_errors(teacher.locator(".scene-camera video"), "yudu-bank", "yudu-bridge")
    assert max(error) < 3, f"备桥样片首尾画面偏差 {error}"
    print(f"  备桥首尾帧在 Edge 解码后的平均 RGB 差为 {error[0]:.2f}/255、{error[1]:.2f}/255",flush=True)
    teacher.get_by_role("button", name="抬送门板：群众捐出自家门板", exact=True).click()
    expect(student.locator(".slide-line")).to_have_attribute("data-narration-view", "point")
    teacher.get_by_role("button", name="播放备桥短片", exact=True).click()
    for page in (teacher, student):
        page.wait_for_function("document.querySelector('.scene-camera video.is-visible')?.currentTime > .25")
        expect(page.locator(".scene-camera")).to_have_css("transform", "matrix(1, 0, 0, 1, 0, 0)")
        expect(page.locator(".slide-line")).to_have_attribute("data-narration-view", "main")
    teacher.get_by_role("button", name="暂停短片", exact=True).click()
    position = teacher.locator("video").evaluate("v => v.currentTime")
    student = reopen_projection(teacher, student)
    student.wait_for_function("t => {const v=document.querySelector('video.is-visible');return v?.paused && Math.abs(v.currentTime-t)<.25;}", arg=position)
    teacher.get_by_role("button", name="继续播放", exact=True).click()
    for page in (teacher, student):
        expect(page.locator(".scene-shot-label")).to_have_text("架成后的浮桥")
        expect(page.locator(".scene-shot-label")).to_be_visible()
    for page in (teacher, student):
        expect(page.locator(".scene-head h1")).to_have_text("浮桥近景",timeout=10000)
        expect(page.locator(".scene-camera .outgoing-image")).to_have_count(0)
        assert page.locator(".scene-camera > img").evaluate("img => img.complete && img.naturalWidth > 0")
    return student


def verify_xiang_film(teacher, student):
    video = teacher.locator(".scene-camera video")
    errors = video_frame_errors(video, "xiang", "xiang")
    assert max(errors) <= 3, f"湘江首尾帧偏差 {errors}"
    for page in (teacher, student):
        page.wait_for_function("document.querySelector('.scene-camera video.is-visible')?.currentTime > .25")
        expect(page.get_by_role("button", name="暂停短片", exact=True)).to_have_count(0)
        expect(page.get_by_role("button", name="静态画面", exact=True)).to_have_count(0)
    print(f"  湘江首尾帧 RGB 平均差 {errors[0]:.2f}/255、{errors[1]:.2f}/255，双屏背景自动播放", flush=True)


def verify_river(teacher, student):
    river = '.lesson-exploration[data-scene="yudu-river"][data-ready]'
    action = teacher.locator("#river-action")
    teacher.get_by_role("button", name="于都河岸", exact=True).click()
    for page in (teacher, student):
        expect(page.locator(river)).to_be_visible(timeout=20000)
    teacher.evaluate("window.riverCanvas = document.querySelector('.lesson-exploration #view')")
    expect(student.locator("#river-action")).to_be_hidden()
    for label, next_label in (("到桥头", "看桥下"), ("看桥下", "看架桥")):
        expect(action).to_have_attribute("aria-label", label)
        action.click()
        expect(action).to_have_attribute("aria-label", next_label, timeout=10000)
    action.click()
    teacher.wait_for_function("Number(document.querySelector('#river-tools').dataset.progress) >= .30")

    stopped = teacher.get_by_role("button", name="下一页", exact=True).evaluate("""button => {
      const dock = document.querySelector('#river-tools');
      const before = { progress: Number(dock.dataset.progress), beat: dock.dataset.step };
      button.click();
      return before;
    }""")
    assert stopped["beat"] == "看架桥" and .30 <= stopped["progress"] < 1, stopped
    for page in (teacher, student):
        expect(page.locator(".scene-head h1")).to_have_text("夜渡于都河")
        expect(page.locator(river)).to_have_count(0)

    teacher.get_by_role("button", name="上一页", exact=True).click()
    teacher.get_by_role("button", name="于都河岸", exact=True).click()

    def assert_paused(page):
        expect(page.locator(river)).to_be_visible(timeout=20000)
        expect(page.locator(river)).to_have_css("opacity", "1")
        expect(page.locator("#river-tools")).to_have_attribute("data-playback", "paused")
        expect(page.locator("#river-tools")).to_have_attribute("data-step", stopped["beat"])
        assert abs(float(page.locator("#river-tools").get_attribute("data-progress")) - stopped["progress"]) < 1e-6

    for page in (teacher, student):
        assert_paused(page)
    before = student.locator(f"{river} #view").screenshot()
    student = reopen_projection(teacher, student)
    assert_paused(student)
    after = student.locator(f"{river} #view").screenshot()
    difference = ImageChops.difference(Image.open(BytesIO(before)).convert("RGB"), Image.open(BytesIO(after)).convert("RGB"))
    mean_difference = max(ImageStat.Stat(difference).mean)
    assert mean_difference < 2, f"投影重连后于都架桥画面偏差 {mean_difference:.2f}/255"
    assert_paused(teacher)

    expect(action).to_have_attribute("aria-label", "继续")
    action.click()
    student.wait_for_function("""t => {
      const dock = document.querySelector('#river-tools');
      return dock?.dataset.step === '看架桥' && Number(dock.dataset.progress) > t;
    }""", arg=stopped["progress"])
    expect(action).to_have_attribute("aria-label", "看夜渡", timeout=10000)
    teacher.get_by_role("button", name="史料", exact=True).click()
    expect(student.locator("#reading-title")).to_have_text("船与门板")
    expect(student.locator("#reading")).to_be_visible()
    teacher.get_by_role("button", name="收起材料", exact=True).click()
    for label, next_label in (("看夜渡","看收桥"), ("看收桥","重播")):
        expect(action).to_have_attribute("aria-label", label)
        action.click()
        expect(action).to_have_attribute("aria-label", next_label, timeout=10000)
    expect(student.locator("#river-tools")).to_have_attribute("data-playback","finished")
    caption = student.locator("#river-instruction")
    if student.viewport_size["width"] == 1920:
        expect(caption).to_have_css("font-size","32.64px")
        expect(student.locator(".river-label").first).to_have_css("font-size","26px")
    views = []
    for recall, text in (("夜渡","夜里能过河的时间有限"), ("收桥后","拂晓前撤桥")):
        teacher.get_by_role("button", name="史料", exact=True).click()
        expect(student.locator("#reading-title")).to_have_text("渡河计划")
        teacher.locator("#river-recall").get_by_role("button",name=recall,exact=True).click()
        expect(caption).to_contain_text(text)
        expect(caption.locator('[data-typed="false"]')).to_have_count(0)
        views.append(teacher.evaluate("""() => {
          const {eye,target,zoom}=explorationActivity.read().state; return [...eye,...target,zoom];
        }"""))
        assert caption.evaluate("""node => {
          const lines = document.createRange();
          lines.selectNodeContents(node);
          const fontSize = parseFloat(getComputedStyle(node).fontSize);
          const bounds = new Map();
          for (const rect of lines.getClientRects()) {
            if (!rect.width) continue;
            const y = Math.round(rect.top);
            const row = bounds.get(y) ?? [rect.left, rect.right];
            bounds.set(y, [Math.min(row[0], rect.left), Math.max(row[1], rect.right)]);
          }
          return node.scrollWidth <= node.clientWidth && bounds.size > 0 &&
            [...bounds.values()].every(([left,right]) => right-left >= 4 * fontSize);
        }"""), "投影提示溢出或出现过短的尾行"
    assert max(abs(a-b) for a,b in zip(*views)) < .0001, "夜渡回看机位发生变化"
    teacher.get_by_role("button", name="返回浮桥", exact=True).click()
    expect(student.locator(river)).to_have_count(0)
    expect(student.locator(".scene-head h1")).to_have_text("浮桥近景")
    print(f"  于都河岸五段、同机位回看、字号和重连通过，看架桥在 {stopped['progress']:.1%} 原位暂停", flush=True)
    return student


def verify_hall(teacher, student, book_first):
    hall = '.lesson-exploration[data-scene="zunyi-hall"][data-ready]'
    enter = teacher.get_by_role("button", name="进入材料厅", exact=True)
    exit_hall = teacher.get_by_role("button", name="返回会场", exact=True)
    nav = teacher.locator(".scene-navigation")

    def open_hall():
        enter.click()
        for page in (teacher, student):
            expect(page.locator(hall)).to_be_visible(timeout=26000)

    def canvas_drag(x, y):
        bounds = teacher.locator("#view").bounding_box()
        drag(teacher, x(bounds["width"]), y(bounds["height"]),
             start=(bounds["x"] + bounds["width"] / 2, bounds["y"] + bounds["height"] / 2))

    def exit_object():
        teacher.locator("#leave").click()
        elapsed_frames(teacher, .30)

    def read_map():
        teacher.keyboard.press("e")
        expect(teacher.locator("#instruction")).to_contain_text("拨动行军图")
        elapsed_frames(teacher, .30)
        canvas_drag(lambda width: width * .28, lambda _: 0)
        teacher.locator("#summary").click()
        expect(student.locator("#finding")).to_contain_text("黎平会议决定改向黔北")
        teacher.keyboard.press("Escape")
        teacher.locator("#route-stops").select_option("乌江")
        expect(student.locator("#reading-title")).to_have_text("乌江")
        teacher.get_by_role("button", name="收起材料", exact=True).click()

    def read_book():
        nonlocal student
        teacher.keyboard.press("e")
        expect(teacher.locator("#instruction")).to_have_text("拖动封面翻开")
        elapsed_frames(teacher, .30)
        canvas_drag(lambda width: -width * .20, lambda height: -height * .06)
        expect(student.locator("#instruction")).to_have_text("第 1 页")
        teacher.locator("#book-next").click()
        expect(student.locator("#instruction")).to_have_text("第 2 页")
        teacher.locator("#summary").click()
        expect(student.locator("#reading-title")).to_have_text("黎平改向")
        student = reopen_projection(teacher, student)
        expect(student.locator(hall)).to_be_visible(timeout=26000)
        expect(student.locator("#reading-title")).to_have_text("黎平改向")
        expect(student.locator("#book-next")).to_be_hidden()
        expect(student.locator("#presenter")).to_be_hidden()
        teacher.get_by_role("button", name="收起材料", exact=True).click()
        expect(teacher.locator("#reading")).to_be_hidden()
        teacher.locator("#view").focus()
        teacher.keyboard.press("ArrowLeft")
        expect(teacher.locator("#instruction")).to_have_text("第 1 页")
        expect(teacher.locator(".scene-head h1")).to_have_text("遵义会议室")
        teacher.locator("#book-next").click()
        expect(student.locator("#instruction")).to_have_text("第 2 页")
        return teacher.evaluate("readExplorationUpdate()")

    enter.evaluate("button => {button.click();button.click();}")
    expect(teacher.locator(".lesson-exploration")).to_have_count(0)
    open_hall()
    assert teacher.evaluate("!window.riverCanvas || window.riverCanvas === document.querySelector('.lesson-exploration #view')")
    teacher.keyboard.down("ArrowLeft")
    try:
        for page in (teacher, student):
            expect(page.locator(hall)).to_have_attribute("data-walking", "")
            expect(page.locator(".scene-head")).to_be_hidden()
            expect(page.locator(".lesson-footer")).to_be_hidden()
            expect(page.locator("#view")).to_be_visible()
        elapsed_frames(teacher,.20)
    finally:
        teacher.keyboard.up("ArrowLeft")
    for page in (teacher, student):
        expect(page.locator(".scene-head")).to_have_css("opacity", "1")
        expect(page.locator(".scene-head h1")).to_have_text("遵义会议室")
    expect(teacher.locator(".lesson-footer")).to_have_css("opacity", "1")
    teacher.keyboard.down("ArrowUp")
    expect(teacher.locator(hall)).to_have_attribute("data-walking", "")
    teacher.evaluate("window.dispatchEvent(new Event('blur'))")
    expect(teacher.locator(hall)).not_to_have_attribute("data-walking", "")
    teacher.keyboard.up("ArrowUp")
    teacher.get_by_role("button", name="重新开始", exact=True).click()
    canvas_drag(lambda _: 69, lambda _: 0)
    if book_first:
        walk(teacher,"w",2.54)
        expect(teacher.locator(hall)).to_have_attribute("data-area","材料厅")
        walk(teacher,"a",.95)
        stale = read_book()
        exit_object()
        walk(teacher,"d",.97)
        walk(teacher,"s",1.71)
        walk(teacher,"a",1.65)
        read_map()
    else:
        walk(teacher,"a",1.64)
        walk(teacher,"w",.84)
        read_map()
        exit_object()
        walk(teacher,"d",1.64)
        walk(teacher,"w",1.70)
        expect(teacher.locator(hall)).to_have_attribute("data-area","材料厅")
        walk(teacher,"a",.96)
        stale = read_book()

    saved = teacher.evaluate("explorationActivity.read().state")
    nav.get_by_role("button", name="下一页", exact=True).click()
    expect(student.locator(".scene-head h1")).to_have_text("会议桌上的两份材料")
    nav.get_by_role("button", name="上一页", exact=True).click()
    expect(student.locator(".scene-head h1")).to_have_text("遵义会议室")
    teacher.evaluate("""stale => sendProjection({
      type:'exploration', update:{...stale, version:++explorationVersion}
    })""", stale)
    elapsed_frames(student, .20)
    expect(student.locator(".lesson-exploration")).to_have_count(0)
    open_hall()
    restored = teacher.evaluate("explorationActivity.read().state")
    for key in ("player","eye","yaw","pitch","zoom","routeProgress","station","bookPage"):
        assert restored[key] == saved[key], f"材料厅回场状态发生变化 {key}"
    exit_hall.click()
    expect(student.locator(hall)).to_have_count(0)
    print("  遵义材料厅正式课页通过，" + ("先书后图" if book_first else "先图后书"), flush=True)
    return student


def open_practice(teacher, student, title):
    teacher.get_by_role("button", name=f"展开练习 · {title}", exact=True).click()
    expect(student.locator(".practice-title")).to_have_text(title)
    expect(student.locator(".practice-title")).to_be_visible()
    expect(student.locator(".practice-actions")).to_have_count(0)


def answer(teacher, student, option, correct):
    panel = teacher.locator(".practice")
    panel.get_by_role("button", name=option, exact=True).click()
    expect(student.locator('.practice-option[aria-pressed=true]')).to_have_count(0)
    expect(student.locator('.practice-option[data-correct=true]')).to_have_count(0)
    panel.get_by_role("button", name="核对", exact=True).click()
    if correct:
        expect(student.locator('.practice-option[data-correct=true]')).to_have_text(option)
        expect(student.locator(".practice-source")).to_be_visible()
    else:
        expect(student.locator('.practice-feedback[data-retry=true]')).to_be_visible()
        expect(student.locator('.practice-option[data-correct=true]')).to_have_count(0)


def verify_desk_inquiry(teacher, student, right_first=False):
    positions = exercise_desk(teacher, student, right_first)
    student = reopen_projection(teacher, student)
    for field, value in positions.items():
        expect(student.locator(".desk-live-frame")).to_have_attribute(field, value)
    expect(student.locator(".desk-live-transport")).not_to_be_visible()
    return student


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
    assert_scene_points(teacher)
    expect(teacher.locator(".top h1")).to_have_class("course-title")
    verify_pacing(teacher)
    teacher.get_by_role("button", name="教师备课", exact=True).click()
    expect(teacher.get_by_text("长征专题", exact=True)).to_be_visible()
    expect(teacher.locator("a[href], area[href], form[action]")).to_have_count(0)
    teacher.keyboard.press("Escape")
    expect(teacher.locator("#dialog")).to_be_hidden()

    def press(name, scope=teacher):
        scope.get_by_role("button", name=name, exact=True).click()

    def slide(title):
        expect(teacher.locator(".presenter-notes h2")).to_have_text(title)
        expect(student.locator(".scene-head h1")).to_have_text(title)
        chapters = teacher.locator(".lesson-footer > .chapter-rail")
        expect(chapters.locator(".chapter-link")).to_have_count(4)
        expect(chapters.locator("[aria-current=step]")).to_be_visible()
        expect(student.locator(".lesson-footer > .chapter-rail")).to_be_hidden()

    with teacher.expect_popup() as opened:
        press("开始双屏授课")
    student = opened.value
    student.set_viewport_size({"width": student_width, "height": student_height})
    status = teacher.locator(".presenter-status")
    expect(status).to_have_text("投影已连接")
    assert urldefrag(student.url).url == lesson_url
    expect(student.locator("a[href], area[href], form[action]")).to_have_count(0)
    expect(student.locator("#presenter")).to_be_empty()
    expect(student.get_by_text("教师备课", exact=True)).to_have_count(0)
    live_pace = teacher.locator("#live-pace")
    expect(teacher.locator(".presenter-time")).to_have_text("0:00–2:00")
    live_pace.select_option("50")
    expect(teacher.locator(".presenter-time")).to_have_text("0:00–3:00")
    expect(teacher.locator(".presenter-notes")).to_contain_text("初步判断")
    expect(student.get_by_text("开始计时",exact=True)).to_have_count(0)
    press("开始计时")
    expect(teacher.locator(".lesson-clock time")).not_to_have_text("0:00")
    press("停止计时")
    pace = "40" if student_width == 1920 else "50"
    live_pace.select_option(pace)
    verify_terrain(teacher,student)

    teacher.locator(".timeline button").filter(has_text="遵义会议").click()
    expect(student.locator(".event-card h2")).to_have_text("遵义会议")
    press("开始授课")
    student = verify_opening(teacher, student)
    slide("于都集结")
    assert_scene_points(teacher)
    teacher.keyboard.press("PageDown")
    slide("岸边备桥")
    student = verify_preparation_film(teacher,student)
    student = verify_river(teacher,student)
    slide("浮桥近景")
    expect(teacher.locator(".presenter-notes .presenter-question")).to_have_text("桥面靠什么托住？")
    expect(student.get_by_text("桥面靠什么托住？", exact=True)).to_have_count(0)
    expect(student.locator(".narration-row:visible")).to_have_text("浮桥由船体和桥板组成。")
    press("船体")
    expect(student.locator(".bridge-outline.is-drawn")).to_have_count(1)
    expect(student.locator(".slide-line")).to_contain_text("木船托住桥面")
    open_practice(teacher,student,"木板和船各做什么")
    expect(student.locator(".practice-prompt")).to_contain_text("船体")
    answer(teacher,student,"铺成通道",False)
    expect(student.locator(".practice-feedback")).to_contain_text("下方船身")
    answer(teacher,student,"托住桥面",True)
    student = reopen_projection(teacher,student)
    expect(student.locator(".practice-feedback")).to_contain_text("提供承托")
    expect(student.locator(".scene-spotlight")).to_have_class("scene-spotlight is-active")
    press("返回原页")
    expect(student.locator(".practice")).to_be_hidden()
    expect(student.locator(".slide-line")).to_contain_text("木船托住桥面")

    press("下一页")
    slide("夜渡于都河")
    playing = """() => {
        const video = document.querySelector('video');
        return video?.classList.contains('is-visible') && !video.paused && video.currentTime > 0.2;
    }"""
    for window in (teacher, student):
        window.wait_for_function(playing)
    expect(teacher.get_by_role("button", name="暂停短片", exact=True)).to_have_count(0)

    press("下一页")
    slide("湘江河谷")
    verify_xiang_film(teacher, student)
    press("下一页")
    slide("湘江渡口")
    press("湘江渡口现场")
    xiang_stage = '.lesson-exploration[data-scene="xiang-crossing"][data-ready]'
    for page in (teacher, student):
        expect(page.locator(xiang_stage)).to_be_visible(timeout=24000)
    teacher.locator('#xiang-cams button[data-preset="wade"]').click()
    teacher.locator("#xiang-scrubber").fill("72")
    teacher.locator("#xiang-scrubber").dispatch_event("input")
    expect(student.locator("#xiang-force-count")).to_have_text("4.3 万", timeout=10000)
    press("返回渡口")
    expect(student.locator(xiang_stage)).to_have_count(0)
    press("下一页")
    slide("兵力对照")
    press("渡过湘江 3 万余人")
    expect(student.locator(".troop-hud-row").filter(has_text="3 万余人")).to_have_attribute(
        "data-focus", "true"
    )
    expect(student.locator(".troop-period time")).to_have_text(["1934.10","1934.12"])
    teacher.get_by_role("slider",name="对比长征出发与渡过湘江后兵力滑杆").press("ArrowRight")
    slide("兵力对照")
    open_practice(teacher,student,"两个数字能说明什么")
    answer(teacher,student,"长征出发时",True)
    press("下一题")
    answer(teacher,student,"渡过湘江后",True)
    press("下一题")
    answer(teacher,student,"仅湘江战役期间",False)
    answer(teacher,student,"出发至渡过湘江之间",True)
    press("返回原页")
    expect(student.locator(".troop-hud-row[data-focus=true]")).to_contain_text("3 万余人")
    press("下一页")
    slide("渡江之后")
    open_practice(teacher,student,"结果与代价怎样同时成立")
    answer(teacher,student,"全州、兴安一带的渡江记录",True)
    press("下一题")
    answer(teacher,student,"两个时点的兵力对照",True)
    expect(student.locator(".practice-evidence p")).to_have_count(2)
    press("返回原页")

    press("下一页")
    slide("黎平翘街")
    press("下一页")
    slide("进军方向")
    open_practice(teacher,student,"哪条证据能解释改向")
    answer(teacher,student,"湘西北",False)
    expect(student.locator(".paper-node.east")).to_be_visible()
    expect(student.locator(".paper-node.west")).to_be_visible()
    answer(teacher,student,"贵州北部",True)
    press("下一题")
    answer(teacher,student,"两条路线的终点",False)
    answer(teacher,student,"渡江后兵力和行军处境",True)
    teacher.keyboard.press("Escape")
    expect(student.locator(".practice")).to_be_hidden()
    expect(student.locator(".paper-node.west")).to_be_hidden()
    press("推演原计划 · 湘西北")
    expect(student.locator(".paper-node.east")).to_be_visible()
    expect(student.locator(".paper-node.west")).to_be_hidden()
    press("推演新方向 · 贵州北部")
    expect(student.locator(".paper-node.west")).to_be_visible()

    press("下一页")
    slide("猴场会议")
    timeline = ".story-panel--chronology .story-rail"
    expect(teacher.locator(timeline).locator(".story-step")).to_have_count(3)
    expect(student.locator(timeline)).to_be_hidden()
    teacher.locator(timeline).get_by_text("重申北进方针", exact=True).click()
    expect(student.locator(".slide-line")).to_contain_text("重申黎平会议战略方针")
    expect(student.locator(timeline).locator(".story-stop:visible")).to_have_count(1)
    press("下一页")
    slide("渡过乌江")
    press("下一页")
    slide("遵义会议室")
    expect(teacher.locator(".presenter-time")).to_have_text("24:30–27:00" if pace=="40" else "31:30–35:00")
    expect(teacher.get_by_role("button", name="并排对照", exact=True)).to_have_count(0)
    student = verify_hall(teacher, student, book_first=pace=="50")
    press("下一页")
    slide("会议桌上的两份材料")
    assert_scene_points(teacher)
    expect(teacher.locator(".desk-live-frame video")).to_have_count(0)
    expect(teacher.locator(".presenter-time")).to_have_text("27:00–29:50" if pace=="40" else "35:00–38:50")
    expect(teacher.locator(".desk-live-clue")).to_have_count(2)
    student = verify_desk_inquiry(teacher, student, right_first=pace=="50")
    reading = student.locator(".desk-reader")
    expect(reading).to_be_hidden()
    press("翻阅左册 · 会前形势")
    expect(reading.get_by_role("heading", name="会前手记")).to_be_visible(timeout=18000)
    teacher.keyboard.press("Escape")
    expect(reading).to_be_hidden()
    press("翻阅右册 · 会议讨论")
    press("对照两份材料")
    expect(reading.locator(".desk-reader-pair article")).to_have_count(2)

    student.close()
    expect(status).to_have_text("投影窗口已关闭")
    with teacher.expect_popup() as reopened:
        press("重新打开投影")
    student = reopened.value
    student.set_viewport_size({"width": student_width, "height": student_height})
    expect(status).to_have_text("投影已连接")
    slide("会议桌上的两份材料")
    expect(student.locator(".desk-reader-pair article:visible")).to_have_count(2)
    press("下一页")
    slide("军事问题")
    expect(teacher.locator(".story-panel .story-step")).to_have_count(3)
    expect(student.locator(".story-panel")).to_be_hidden()
    press("回顾两段受挫经历")
    expect(student.locator(".story-panel .story-detail:visible")).to_have_count(1)
    press("回顾两段受挫经历")
    expect(student.locator(".story-panel .story-detail:visible")).to_have_count(0)
    press("下一页")
    slide("组织问题")
    press("调整中央领导机构")
    expect(student.locator(".story-detail:visible")).to_contain_text("改组中央最高核心领导层")
    open_practice(teacher,student,"两类问题怎么分")
    answer(teacher,student,"组织",False)
    answer(teacher,student,"军事",True)
    press("下一题")
    answer(teacher,student,"组织",True)
    student = reopen_projection(teacher,student)
    press("返回原页")
    expect(student.locator(".story-detail:visible")).to_contain_text("改组中央最高核心领导层")
    press("下一页")
    slide("遵义会议的转折意义")
    conclusion = student.locator(".assembly-conclusion")
    expect(conclusion).to_be_hidden()
    for name in ("湘江受挫","黎平转向","遵义调整"):
        press(name)
    expect(conclusion).to_be_visible()
    expect(student.locator(".story-panel .story-stop:visible")).to_have_count(3)
    press("课堂回顾")
    expect(student.locator(".review h1")).to_have_text("课堂回顾")
    expect(teacher.locator(".presenter-time")).to_have_text("35:30–38:15" if pace=="40" else "44:30–47:15")
    expect(student.locator(".recap-card")).to_be_hidden()
    press("湘江战役，查看视觉回顾")
    expect(student.locator(".recap-card")).to_be_visible()
    expect(student.locator(".recap-card .review-step")).to_have_text("渡江受挫")
    press("回看现场")
    press("返回回顾", teacher.locator(".scene-actions"))
    expect(student.locator(".recap-card .review-step")).to_have_text("渡江受挫")
    press("全景总结")
    expect(student.locator(".review h1")).to_have_text("全课结论")
    expect(teacher.locator(".presenter-time")).to_have_text("38:15–40:00" if pace=="40" else "47:15–50:00")
    press("揭示结论")
    expect(student.locator(".review-conclusion")).to_be_visible()
    press("结束双屏")
    expect(teacher.locator("#presenter")).to_be_hidden()
    assert student.is_closed(), "结束双屏后，投影窗口仍开着"
    assert not errors, errors
    assert not remote_requests, remote_requests


def verify_hall_fallback(browser, url):
    page = browser.new_page(offline=True, viewport={"width":1366,"height":768})
    page.goto(url)
    page.get_by_role("button", name="开始授课", exact=True).click()
    page.get_by_role("button", name="进入课堂", exact=True).click()
    page.locator(".chapter-nav").get_by_role("button", name="遵义会议", exact=True).click()
    page.get_by_role("button", name="进入材料厅", exact=True).click()
    expect(page.get_by_role("status").filter(has_text="遵义材料厅载入失败")).to_be_visible()
    expect(page.locator(".lesson-exploration")).to_have_count(0)
    page.locator(".scene-navigation").get_by_role("button", name="下一页", exact=True).click()
    expect(page.locator(".scene-head h1")).to_have_text("会议桌上的两份材料")
    print("通过禁用 WebGL 的材料厅回退验收", flush=True)


def main():
    parser = ArgumentParser()
    root = Path(__file__).resolve().parents[1]
    parser.add_argument("--html", type=Path, default=root / "课堂演示" / "从于都到遵义-课堂演示.html")
    parser.add_argument("--check-join", nargs=3, metavar=("CLIP", "ENTRY", "EXIT"),
                        help="只检查正式课件内的一支短片与指定的入片、出片图")
    args = parser.parse_args()
    with TemporaryDirectory() as folder:
        lesson = Path(folder) / "lesson.html"
        shutil.copyfile(args.html, lesson)
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(channel="msedge", headless=True)
            if args.check_join:
                try:
                    verify_asset_join(browser, lesson.as_uri(), *args.check_join)
                finally:
                    browser.close()
                return
            for teacher_width, student_width, student_height in (
                (1366, 1920, 1080),
                (1920, 1366, 768),
            ):
                context = browser.new_context(
                    offline=True, reduced_motion="no-preference", viewport={"width": teacher_width, "height": 768}
                )
                verify_lesson(context, lesson.as_uri(), student_width, student_height)
                print(
                    f"通过 Edge 离线双屏验收（教师宽度 {teacher_width}，"
                    f"投影 {student_width} × {student_height}）",
                    flush=True,
                )
                context.close()
            browser.close()
            with playwright.chromium.launch(channel="msedge", headless=True, args=["--disable-webgl"]) as fallback:
                verify_hall_fallback(fallback, lesson.as_uri())


if __name__ == "__main__":
    main()
