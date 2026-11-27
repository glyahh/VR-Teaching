"""离线录制本课四套高精 3D 实时场景的电影级运镜短片，供片头 make-opening.py 剪辑使用。"""

from __future__ import annotations

import argparse
import math
import subprocess
import sys
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
COURSE_HTML = REPO / "课堂演示" / "从于都到遵义-课堂演示.html"
OUT_DIR = REPO / ".march-build" / "opening-sources" / "recorded-3d"

WIDTH = 1280
HEIGHT = 720
FPS = 24

HIDE_HUD_CSS = """
.scene-head, .scene-bottom, .chapter-rail, .scene-actions, .scene-note,
.exploration-hud, .exploration-load-status, .exploration-return,
#markers, #inspect, #river-tools, #reading, .hud,
.desk-live-pins, .desk-live-evidence, .desk-inquiry-cue, .desk-live-transport,
.lesson-caption, .narration-bar, .narration-box, .scene-progress,
.scene-footer, footer, header, nav, aside {
  display: none !important;
  opacity: 0 !important;
  visibility: hidden !important;
}
.scene, .scene-stage, .lesson-exploration, .exploration-stage, .desk-live-frame {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  background: #0a0c10 !important;
}
#view, .desk-live-canvas {
  position: fixed !important;
  inset: 0 !important;
  width: 100vw !important;
  height: 100vh !important;
  display: block !important;
}
"""


def smooth(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def smoother(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return t * t * t * (t * (t * 6.0 - 15.0) + 10.0)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def lerp3(a: list[float], b: list[float], t: float) -> list[float]:
    return [lerp(a[i], b[i], t) for i in range(3)]


def open_encoder(dst: Path) -> subprocess.Popen:
    dst.parent.mkdir(parents=True, exist_ok=True)
    cmd = [
        "ffmpeg", "-v", "error", "-y",
        "-f", "image2pipe", "-vcodec", "mjpeg", "-framerate", str(FPS), "-i", "-",
        "-c:v", "libx264", "-preset", "medium", "-crf", "17",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart",
        str(dst),
    ]
    return subprocess.Popen(cmd, stdin=subprocess.PIPE)


def capture_frames(page, dst: Path, total_frames: int, step_fn) -> None:
    tmp = dst.with_suffix(".part.mp4")
    proc = open_encoder(tmp)
    assert proc.stdin is not None
    try:
        for i in range(total_frames):
            t = i / max(1, total_frames - 1)
            step_fn(i, t)
            # 等待两帧渲染管线落定
            page.evaluate("() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))")
            jpg = page.screenshot(type="jpeg", quality=93)
            proc.stdin.write(jpg)
        proc.stdin.close()
        rc = proc.wait()
        if rc != 0:
            raise RuntimeError(f"FFmpeg 编码失败：{dst} (exit={rc})")
        tmp.replace(dst)
        print(f"[OK] {dst.name} ({total_frames} frames, {total_frames/FPS:.2f}s, {dst.stat().st_size//1024} KB)")
    finally:
        if proc.poll() is None:
            proc.kill()
        tmp.unlink(missing_ok=True)


def wait_scene_canvas(page, selector: str = "#view") -> None:
    page.wait_for_selector(selector, state="visible", timeout=25000)
    page.wait_for_timeout(450)
    page.evaluate(
        """(css) => {
          let el = document.getElementById('rec-hide-hud');
          if (!el) {
            el = document.createElement('style');
            el.id = 'rec-hide-hud';
            document.head.appendChild(el);
          }
          el.textContent = css;
          window.dispatchEvent(new Event('resize'));
        }""",
        HIDE_HUD_CSS,
    )
    page.wait_for_timeout(200)


def clear_hide_hud(page) -> None:
    page.evaluate("""() => {
      document.getElementById('rec-hide-hud')?.remove();
      window.dispatchEvent(new Event('resize'));
    }""")
    page.wait_for_timeout(120)


def apply_exploration(page, scene_id: str, state: dict) -> None:
    page.evaluate(
        """([id, state]) => {
          const el = document.querySelector('.lesson-exploration');
          if (!el || !el.parentElement) throw new Error('missing exploration container');
          return explorationActivity.open(id, el.parentElement, state);
        }""",
        [scene_id, state],
    )


def record_yudu_river(page, force: bool) -> None:
    dst_bridge = OUT_DIR / "3d-yudu-bridge.mp4"
    dst_night = OUT_DIR / "3d-yudu-night.mp4"
    if not force and dst_bridge.exists() and dst_night.exists():
        print("[SKIP] 3d-yudu-bridge.mp4 / 3d-yudu-night.mp4 已存在")
        return

    page.evaluate("""() => {
      const idx = chapterPages.findIndex(x => x.page.activity === 'bridge');
      openScene(idx, 'lesson');
    }""")
    page.wait_for_selector("button:has-text('于都河岸')", timeout=15000)
    page.click("button:has-text('于都河岸')")
    wait_scene_canvas(page, "#view")
    page.wait_for_function("() => explorationActivity && explorationActivity.read()?.id === 'yudu-river'", timeout=25000)

    # 1) 黄昏架桥 3D 航拍近景推近（4.50 秒 = 108 帧），对准东门渡口浮桥 (x=4.9) 避开边界灰角
    def step_bridge(i: int, t: float) -> None:
        s = smoother(t)
        eye = lerp3([26.0, 29.0, 31.0], [18.5, 22.0, 22.0], s)
        target = lerp3([4.6, 0.4, 1.1], [4.9, 0.45, 0.9], s)
        zoom = lerp(3.2, 4.4, s)
        apply_exploration(page, "yudu-river", {
            "index": 2,
            "phase": "paused",
            "elapsed": round(lerp(0.5, 3.6, t), 4),
            "water": round(i / FPS, 4),
            "eye": eye,
            "target": target,
            "zoom": round(zoom, 4),
            "selected": None,
            "part": None,
            "recall": "night",
            "reading": False,
            "comparison": None,
        })

    capture_frames(page, dst_bridge, round(4.5 * FPS), step_bridge)

    # 2) 暮色星月夜渡 3D 低空滑移（5.00 秒 = 120 帧），聚焦东门浮桥过河人影与灯火
    def step_night(i: int, t: float) -> None:
        s = smoother(t)
        eye = lerp3([23.0, 24.0, 27.0], [15.5, 19.0, 19.5], s)
        target = lerp3([5.2, 0.4, 1.4], [4.5, 0.4, 0.6], s)
        zoom = lerp(3.4, 4.6, s)
        apply_exploration(page, "yudu-river", {
            "index": 3,
            "phase": "paused",
            "elapsed": round(lerp(0.5, 3.7, t), 4),
            "water": round(4.5 + i / FPS, 4),
            "eye": eye,
            "target": target,
            "zoom": round(zoom, 4),
            "selected": None,
            "part": None,
            "recall": "night",
            "reading": False,
            "comparison": None,
        })

    capture_frames(page, dst_night, round(5.0 * FPS), step_night)


def record_zunyi_hall(page, force: bool) -> None:
    dst = OUT_DIR / "3d-zunyi-hall.mp4"
    if not force and dst.exists():
        print("[SKIP] 3d-zunyi-hall.mp4 已存在")
        return

    clear_hide_hud(page)
    page.evaluate("""() => {
      const idx = chapterPages.findIndex(x => x.page.video && x.page.video.key === 'zunyi');
      openScene(idx, 'lesson');
    }""")
    page.wait_for_selector("button:has-text('进入材料厅')", timeout=15000)
    page.click("button:has-text('进入材料厅')")
    wait_scene_canvas(page, "#view")
    page.wait_for_function("() => explorationActivity && explorationActivity.read()?.id === 'zunyi-hall'", timeout=25000)

    # 6.80 秒 = 163 帧：暮色双宫灯庭院 -> 穿门入室 -> 缓缓转向暖灯木桌与翻开手记
    def step_hall(i: int, t: float) -> None:
        if t < 0.38:
            s = smoother(t / 0.38)
            x = lerp(0.95, 1.38, s)
            z = lerp(4.70, 0.65, s)
            yaw = lerp(-0.24, -0.02, s)
            pitch = lerp(0.08, 0.01, s)
            zoom = lerp(0.98, 1.03, s)
            book_pose = 0.0
        elif t < 0.72:
            s = smoother((t - 0.38) / 0.34)
            x = lerp(1.38, 0.15, s)
            z = lerp(0.65, -1.65, s)
            yaw = lerp(-0.02, 0.56, s)
            pitch = lerp(0.01, -0.10, s)
            zoom = lerp(1.03, 1.06, s)
            book_pose = lerp(0.0, 0.35, s)
        else:
            s = smoother((t - 0.72) / 0.28)
            x = lerp(0.15, -1.05, s)
            z = lerp(-1.65, -2.18, s)
            yaw = lerp(0.56, 0.78, s)
            pitch = lerp(-0.10, -0.24, s)
            zoom = lerp(1.06, 1.15, s)
            book_pose = lerp(0.35, 1.0, s)

        apply_exploration(page, "zunyi-hall", {
            "player": [round(x, 4), round(z, 4)],
            "eye": [round(x, 4), round(z, 4)],
            "yaw": round(yaw, 4),
            "pitch": round(pitch, 4),
            "zoom": round(zoom, 4),
            "focused": None,
            "approach": None,
            "routeProgress": round(min(1.0, t * 1.2), 4),
            "station": "",
            "seen": [],
            "bookPage": 1 if book_pose > 0.5 else 0,
            "bookPose": round(book_pose, 4),
            "reading": False,
            "walking": True,
            "lastClue": None,
        })

    capture_frames(page, dst, round(6.8 * FPS), step_hall)


def record_zunyi_desk(page, force: bool) -> None:
    dst = OUT_DIR / "3d-zunyi-desk.mp4"
    if not force and dst.exists():
        print("[SKIP] 3d-zunyi-desk.mp4 已存在")
        return

    clear_hide_hud(page)
    # 直接使用导出的 explorationStage.createDeskWorld 在全屏独立画布上逐帧渲染，绕过非投影模式的 restore 门禁
    page.evaluate("""async () => {
      let c = document.getElementById('rec-desk-canvas');
      if (!c) {
        c = document.createElement('canvas');
        c.id = 'rec-desk-canvas';
        Object.assign(c.style, {
          position: 'fixed', inset: '0', width: '100vw', height: '100vh',
          zIndex: '99999', display: 'block', background: '#0a0c10'
        });
        document.body.appendChild(c);
      }
      window.__recDeskWorld = await explorationStage.createDeskWorld(c, mediaAssets);
      window.__recDeskWorld.resize(1280, 720);
    }""")
    page.wait_for_timeout(300)

    # 6.80 秒 = 163 帧：煤油灯暖木桌弧线推近，物理丝滑翻左册、解右绳、揭封、展开路线图叠红金改向线
    def step_desk(i: int, t: float) -> None:
        s = smoother(t)
        yaw = lerp(-13.5, 8.5, s)
        pitch = lerp(-2.2, 2.5, s)
        zoom = lerp(0.98, 1.16, s)

        spread = 0
        dossier = "sealed"
        map_state = "stored"
        preview = None

        if t < 0.24:
            p = smoother(t / 0.24)
            preview = {"kind": "page", "direction": "forward", "progress": round(p, 4)}
        elif t < 0.44:
            spread = 1
            p = smoother((t - 0.24) / 0.20)
            preview = {"kind": "cord", "progress": round(p, 4)}
        elif t < 0.64:
            spread = 1
            dossier = "untied"
            p = smoother((t - 0.44) / 0.20)
            preview = {"kind": "cover", "progress": round(p, 4)}
        elif t < 0.84:
            spread = 1
            dossier = "open"
            p = smoother((t - 0.64) / 0.20)
            preview = {"kind": "map", "progress": round(p, 4)}
        else:
            spread = 1
            dossier = "open"
            map_state = "original"
            p = smoother((t - 0.84) / 0.16)
            preview = {"kind": "overlay", "progress": round(p, 4)}

        view = {
            "saved": {
                "camera": {"yaw": round(yaw, 3), "pitch": round(pitch, 3), "zoom": round(zoom, 4)},
                "spread": spread,
                "dossier": dossier,
                "sheets": [],
                "map": map_state,
            },
            "preview": preview,
            "evidence": "none",
            "investigating": True,
            "carried": False,
        }
        page.evaluate("([v, sec]) => window.__recDeskWorld.draw(v, sec)", [view, i / FPS])

    capture_frames(page, dst, round(6.8 * FPS), step_desk)
    page.evaluate("""() => {
      window.__recDeskWorld?.dispose();
      document.getElementById('rec-desk-canvas')?.remove();
    }""")


def main() -> int:
    parser = argparse.ArgumentParser(description="录制四套本课三维场景电影级运镜素材")
    parser.add_argument("--force", action="store_true", help="强制重录已存在片段")
    parser.add_argument("--only", choices=["yudu", "hall", "desk"], help="仅录制单个场景")
    args = parser.parse_args()

    if not COURSE_HTML.exists():
        raise FileNotFoundError(f"请先运行 node 课堂演示/build.mjs 生成 {COURSE_HTML}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    with sync_playwright() as p:
        browser = p.chromium.launch(
            channel="msedge",
            headless=True,
            args=["--use-gl=angle", "--enable-webgl"],
        )
        page = browser.new_page(viewport={"width": WIDTH, "height": HEIGHT}, device_scale_factor=1)
        page.goto(COURSE_HTML.resolve().as_uri())
        page.wait_for_selector("button:has-text('开始授课')", timeout=15000)

        if args.only in (None, "yudu"):
            record_yudu_river(page, args.force)
        if args.only in (None, "hall"):
            record_zunyi_hall(page, args.force)
        if args.only in (None, "desk"):
            record_zunyi_desk(page, args.force)

        browser.close()
    print("全部三维运镜素材已输出至:", OUT_DIR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
