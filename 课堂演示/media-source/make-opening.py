"""将已核验的外部实拍、历史会址、配乐与课内场景剪成 95 秒纪实开场片。分镜与署名见 opening-sources.md。"""

import argparse
import csv
from dataclasses import dataclass
from hashlib import file_digest, sha256
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
from tempfile import TemporaryDirectory
from urllib.request import Request, urlopen
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


HERE = Path(__file__).resolve().parent
ASSETS = HERE.parent / "assets"
SOURCE_CACHE = HERE.parents[1] / ".march-build" / "opening-sources"
RECORDED_3D = SOURCE_CACHE / "recorded-3d"
VOICE_CACHE = SOURCE_CACHE / "voice-v2"
NARRATION_TSV = HERE / "opening-narration.tsv"
TTS_DEPS = HERE.parents[1] / ".march-build" / "opening-tts-deps"

FPS = 24
RATE = 48000
WIDTH, HEIGHT = 1280, 720
TOTAL_SECONDS = 95.0
TOTAL_FRAMES = round(TOTAL_SECONDS * FPS)  # 2280 帧
XFADE_FRAMES = 12  # 0.50 秒平滑叠化
VOICE_NAME = "zh-CN-YunjianNeural"
VOICE_RATE = "-8%"
VOICE_PITCH = "-3Hz"
MUSIC_START_SECONDS = 238.0
OUTRO_STILL_SECONDS = 1.40

FFMPEG = ["ffmpeg", "-v", "error", "-nostdin", "-y"]
FONTS = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts"

PEXELS = "Pexels License https://www.pexels.com/license/"
MIXKIT = "Mixkit Stock Video Free License https://mixkit.co/license/#videoFree"
CC_BY_3 = "CC BY 3.0 https://creativecommons.org/licenses/by/3.0/"
CC_BY_4 = "CC BY 4.0 https://creativecommons.org/licenses/by/4.0/"


@dataclass(frozen=True)
class Source:
    file: str
    url: str
    sha256: str
    credit: str


SOURCES = (
    Source(
        "mixkit-misty-mountains-100190.mp4",
        "https://mixkit.co/free-stock-video/misty-mountains-and-clouds-100190/",
        "09997dfdef23469bcf3a9f9c4ce2e555f0295880d44e713d6d03c1516f810edb",
        f"苍茫云山航拍｜Mixkit https://mixkit.co/free-stock-video/misty-mountains-and-clouds-100190/ ｜{MIXKIT}｜节选、调色、静音",
    ),
    Source(
        "pexels-karst-river-36932826.mp4",
        "https://www.pexels.com/video/scenic-view-of-karst-mountains-and-river-36932826/",
        "b5a2a9ed8694d36a0f2932f293d5753f1b6a83496ea6e50022d998570008f152",
        f"桂北喀斯特江山航拍｜Cfq938888 Chen https://www.pexels.com/video/scenic-view-of-karst-mountains-and-river-36932826/ ｜{PEXELS}｜节选、统一帧率、调色、静音",
    ),
    Source(
        "mixkit-rain-water-18312.mp4",
        "https://mixkit.co/free-stock-video/rain-falling-on-the-water-of-a-lake-seen-up-18312/",
        "6d5d1da080d1e2129e92c9d581894f62c55330204329cb59cb1ac0acefca7bde",
        f"细雨落水涟漪｜Mixkit https://mixkit.co/free-stock-video/rain-falling-on-the-water-of-a-lake-seen-up-18312/ ｜{MIXKIT}｜节选、冷青调色、静音",
    ),
    Source(
        "mixkit-rain-roof-2738.mp4",
        "https://mixkit.co/free-stock-video/cabin-on-rainy-day-2738/",
        "114d0febb227b14e54123a3b533a186e835e46de8e76367d4204ae2ae06f5464",
        f"青瓦老墙落雨｜Mixkit https://mixkit.co/free-stock-video/cabin-on-rainy-day-2738/ ｜{MIXKIT}｜节选、调色、静音",
    ),
    Source(
        "mixkit-river-canyon-41401.mp4",
        "https://mixkit.co/free-stock-video/fly-over-a-huge-canyon-covered-in-vegetation-41401/",
        "40d52e47ee71ee5666348243d8bf457c3f8c42fca1a2f6c7e670d3eba8843507",
        f"深谷悬崖江流航拍｜Mixkit https://mixkit.co/free-stock-video/fly-over-a-huge-canyon-covered-in-vegetation-41401/ ｜{MIXKIT}｜节选、调色、静音",
    ),
    Source(
        "pexels-shore.mp4",
        "https://www.pexels.com/video/a-close-up-shot-of-the-cascading-water-in-the-river-4058993/",
        "0926d8fc12f689c913e7da092b36904a42f58801d72625f4ff6fbaf0117c4bf4",
        f"急流近景与水声｜João Pavese https://www.pexels.com/video/a-close-up-shot-of-the-cascading-water-in-the-river-4058993/ ｜{PEXELS}｜节选、调色、低通混音",
    ),
    Source(
        "mixkit-sunrise-mist-28339.mp4",
        "https://mixkit.co/free-stock-video/forest-covered-by-mist-at-sunrise-from-the-heights-28339/",
        "b9f5487e78d9eabe420f0eca6c8941576708c5099fe8188beb7b311bc4c9c219",
        f"晨雾山林破晓日出航拍｜Mixkit https://mixkit.co/free-stock-video/forest-covered-by-mist-at-sunrise-from-the-heights-28339/ ｜{MIXKIT}｜节选、暖金调色、静音",
    ),
    Source(
        "sb-hiraeth.mp3",
        "https://www.scottbuckley.com.au/library/hiraeth/",
        "f790c7d53b8d802981ff7cdd8c59e22cdfe103ea66aba296c6cf1a65fe7fcf01",
        f"'Hiraeth' by Scott Buckley - released under CC-BY 4.0. www.scottbuckley.com.au ｜{CC_BY_4}｜节选后段、旁白闪避混音",
    ),
)


# 每个镜头在成片时间轴上的中点切换区间（单位：秒，按 24fps 对齐整数帧）。
# 相邻镜头在中点前后各重叠 XFADE_FRAMES / 2 帧。
TIMELINE_CUTS = (
    ("opening-terrain", 0.00, 1.85),
    ("misty-mountains", 1.85, 10.45),
    ("map-yudu-west", 10.45, 16.05),
    ("yudu-prep", 16.05, 18.00),
    ("yudu-bridge-3d", 18.00, 21.10),
    ("yudu-night-3d", 21.10, 23.45),
    ("yudu-crossing", 23.45, 26.45),
    ("karst-river", 26.45, 32.55),
    ("xiang-valley", 32.55, 36.15),
    ("xiang-rain", 36.15, 38.20),
    ("xiang-crossing-3d", 38.20, 43.30),
    ("liping-rain-roof", 43.30, 46.20),
    ("liping-street", 46.20, 48.75),
    ("map-liping-turn", 48.75, 60.25),
    ("canyon-aerial", 60.25, 65.95),
    ("shore-rapids", 65.95, 69.50),
    ("wujiang-march", 69.50, 72.25),
    ("zunyi-hall-3d", 72.25, 76.65),
    ("zunyi-meeting", 76.65, 79.85),
    ("zunyi-desk-3d", 79.85, 83.15),
    ("map-turning-recap", 83.15, 88.55),
    ("dawn-sunrise", 88.55, 91.60),
    ("ending-assembly", 91.60, TOTAL_SECONDS),
)

# 与课堂演示 src/content.ts 一致的关键地点经纬度。
ROUTE_STOPS = (
    ("于都", 115.41, 25.95),
    (None, 114.94, 25.39),
    (None, 113.95, 25.55),
    (None, 112.95, 25.40),
    ("湘江", 110.73, 25.83),
    ("通道", 109.6258, 26.31679),
    ("黎平", 109.14, 26.23),
    ("猴场", 107.47, 27.07),
    ("乌江", 107.47, 27.32),
    ("遵义", 106.93, 27.69),
)


def digest(path: Path) -> str:
    with path.open("rb") as file:
        return file_digest(file, "sha256").hexdigest()


def ease(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return t * t * (3.0 - 2.0 * t)


def ease_out(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return 1.0 - (1.0 - t) ** 3


def ease_in_out_cubic(t: float) -> float:
    t = min(1.0, max(0.0, t))
    return 4.0 * t * t * t if t < 0.5 else 1.0 - ((-2.0 * t + 2.0) ** 3) / 2.0


def load_font(name: str, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(FONTS / name), size)


def prepare_sources(cache: Path, download: bool) -> dict[str, Path]:
    paths: dict[str, Path] = {}
    for source in SOURCES:
        path = cache / source.file
        if not path.exists():
            if not download:
                raise FileNotFoundError(
                    f"缺少片头素材 {path}。请按 opening-sources.md 核验后放入 {cache}。"
                )
            cache.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix(path.suffix + ".part")
            try:
                req = Request(source.url, headers={"User-Agent": "Mozilla/5.0 VRTeachingMedia/2.0"})
                with urlopen(req, timeout=60) as resp, partial.open("wb") as dest:
                    shutil.copyfileobj(resp, dest)
                if digest(partial) != source.sha256:
                    raise ValueError(f"下载内容与核准版本不同，已停止使用 {source.file}")
                partial.replace(path)
            finally:
                partial.unlink(missing_ok=True)
        if digest(path) != source.sha256:
            raise ValueError(f"片源校验不符，请核对 {path}")
        paths[source.file] = path
    return paths


def load_narration_rows() -> list[dict[str, str]]:
    with NARRATION_TSV.open(encoding="utf-8", newline="") as file:
        rows = list(csv.DictReader(file, delimiter="\t"))
    if not rows:
        raise ValueError(f"旁白稿为空：{NARRATION_TSV}")
    return rows


def trim_wav_silence(src_mp3: Path, dst_wav: Path) -> float:
    raw = dst_wav.with_suffix(".raw.wav")
    try:
        subprocess.run(
            FFMPEG + ["-i", str(src_mp3), "-ac", "1", "-ar", str(RATE), "-c:a", "pcm_s16le", str(raw)],
            check=True,
        )
        with wave.open(str(raw), "rb") as wav:
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
        voiced = np.flatnonzero(np.abs(samples.astype(np.int32)) > 96)
        if not voiced.size:
            raise RuntimeError(f"音频无有效人声：{src_mp3}")
        lead = int(0.03 * RATE)
        tail = int(0.09 * RATE)
        cut = samples[max(0, int(voiced[0]) - lead):min(len(samples), int(voiced[-1]) + tail)]
        with wave.open(str(dst_wav), "wb") as wav:
            wav.setparams((1, 2, RATE, 0, "NONE", ""))
            wav.writeframes(cut.tobytes())
        return len(cut) / RATE
    finally:
        raw.unlink(missing_ok=True)


def prepare_narration(voice_dir: Path, synthesize: bool) -> dict:
    rows = load_narration_rows()
    timeline_path = voice_dir / "timeline.json"

    if not synthesize:
        if not timeline_path.exists():
            raise FileNotFoundError(f"缺少已合成旁白缓存 {timeline_path}，请加 --synthesize 首次合成。")
        data = json.loads(timeline_path.read_text(encoding="utf-8"))
        cues = data.get("cues", [])
        if len(cues) != len(rows) or any(
            c["spoken"] != (r["朗读"] or r["字幕"]) or c["caption"] != r["字幕"]
            for c, r in zip(cues, rows, strict=True)
        ):
            raise ValueError("opening-narration.tsv 已变动，请加 --synthesize 重新同步旁白缓存。")
        for cue in cues:
            wav_path = voice_dir / cue["file"]
            if not wav_path.exists():
                raise FileNotFoundError(f"缺少旁白分句缓存 {wav_path}")
        return data

    if TTS_DEPS.exists() and str(TTS_DEPS) not in sys.path:
        sys.path.insert(0, str(TTS_DEPS))
    import asyncio
    import edge_tts

    voice_dir.mkdir(parents=True, exist_ok=True)

    async def synth_one(spoken: str, mp3_path: Path) -> None:
        for attempt in range(5):
            try:
                comm = edge_tts.Communicate(spoken, VOICE_NAME, rate=VOICE_RATE, pitch=VOICE_PITCH)
                await comm.save(str(mp3_path))
                return
            except Exception:
                if attempt == 4:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))

    async def run_all() -> dict:
        cues = []
        cursor = 0.0
        for row in rows:
            idx = row["序号"].strip()
            spoken = (row["朗读"] or row["字幕"]).strip()
            caption = row["字幕"].strip()
            gap = float(row["停顿"])
            key = sha256(f"{VOICE_NAME}|{VOICE_RATE}|{VOICE_PITCH}|{spoken}".encode("utf-8")).hexdigest()[:12]
            mp3_path = voice_dir / f"line-{idx}-{key}.mp3"
            wav_path = voice_dir / f"line-{idx}-{key}.trim.wav"
            if not wav_path.exists():
                if not mp3_path.exists():
                    await synth_one(spoken, mp3_path)
                dur = trim_wav_silence(mp3_path, wav_path)
            else:
                with wave.open(str(wav_path), "rb") as wav:
                    dur = wav.getnframes() / wav.getframerate()
            start = cursor + gap
            end = start + dur
            cursor = end
            cues.append({
                "id": idx,
                "act": row["幕次"].strip(),
                "caption": caption,
                "spoken": spoken,
                "file": wav_path.name,
                "start": round(start, 3),
                "end": round(end, 3),
                "duration": round(dur, 3),
            })
        return {
            "voice": VOICE_NAME,
            "rate": VOICE_RATE,
            "pitch": VOICE_PITCH,
            "total": round(cursor + 2.2, 3),
            "cues": cues,
        }

    data = asyncio.run(run_all())
    timeline_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    return data


def build_voice_track(voice_dir: Path, timeline: dict, dst_wav: Path) -> None:
    total_samples = round(TOTAL_SECONDS * RATE)
    track = np.zeros(total_samples, dtype=np.float32)
    for cue in timeline["cues"]:
        wav_path = voice_dir / cue["file"]
        with wave.open(str(wav_path), "rb") as wav:
            src_rate = wav.getframerate()
            channels = wav.getnchannels()
            raw = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").astype(np.float32) / 32768.0
        if channels > 1:
            raw = raw.reshape(-1, channels).mean(axis=1)
        if src_rate != RATE:
            x_old = np.linspace(0.0, 1.0, len(raw), endpoint=False)
            new_len = round(len(raw) * RATE / src_rate)
            x_new = np.linspace(0.0, 1.0, new_len, endpoint=False)
            raw = np.interp(x_new, x_old, raw).astype(np.float32)
        fade = min(int(0.012 * RATE), len(raw) // 6)
        if fade > 0:
            raw[:fade] *= np.linspace(0.0, 1.0, fade, dtype=np.float32)
            raw[-fade:] *= np.linspace(1.0, 0.0, fade, dtype=np.float32)
        offset = round(float(cue["start"]) * RATE)
        end = min(total_samples, offset + len(raw))
        if offset >= total_samples:
            raise ValueError(f"旁白超出片长：{cue['caption']}")
        track[offset:end] += raw[:end - offset]
    peak = float(np.max(np.abs(track)))
    if peak > 0.96:
        track *= 0.94 / peak
    pcm = np.clip(track * 32767.0, -32768, 32767).astype("<i2")
    with wave.open(str(dst_wav), "wb") as wav:
        wav.setparams((1, 2, RATE, 0, "NONE", ""))
        wav.writeframes(pcm.tobytes())


def ass_time(seconds: float) -> str:
    cents = max(0, int(math.floor(seconds * 100.0 + 1e-6)))
    mins, rem = divmod(cents, 6000)
    secs, cs = divmod(rem, 100)
    return f"0:{mins:02d}:{secs:02d}.{cs:02d}"


def build_subtitles(timeline: dict, dst_ass: Path) -> None:
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: DocSub,Microsoft YaHei,34,&H00E6F2F8,&H00FFFFFF,&H1E100E0C,&H72080808,0,0,0,0,100,100,0.6,0,1,2.0,1.1,2,64,64,30,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    cues = timeline["cues"]
    max_sub_end = TOTAL_SECONDS - OUTRO_STILL_SECONDS - 0.05
    lines = []
    for idx, cue in enumerate(cues):
        start = float(cue["start"])
        next_start = float(cues[idx + 1]["start"]) - 0.06 if idx + 1 < len(cues) else max_sub_end
        end = min(float(cue["end"]) + 0.16, next_start, max_sub_end)
        text = cue["caption"].replace("\n", " ")
        lines.append(
            f"Dialogue: 0,{ass_time(start)},{ass_time(end)},DocSub,,0,0,0,,{{\\fad(90,110)}}{text}"
        )
    dst_ass.write_text(header + "\n".join(lines) + "\n", encoding="utf-8-sig")


def write_frames_video(target: Path, frames_iter) -> None:
    cmd = FFMPEG + [
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-",
        "-vf", "scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-crf", "8", "-preset", "veryfast",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
        "-threads", "4", str(target),
    ]
    with subprocess.Popen(cmd, stdin=subprocess.PIPE) as proc:
        assert proc.stdin is not None
        for frame in frames_iter:
            proc.stdin.write(frame.tobytes())
        proc.stdin.close()
        if proc.wait():
            raise subprocess.CalledProcessError(proc.returncode, cmd)


# ---------------------------------------------------------------------------
# 物理光影与纪录片矢量动效工具
# ---------------------------------------------------------------------------

def make_seamless_mist(w: int, h: int, seed: int = 7) -> np.ndarray:
    """生成水平无缝平铺的柔和低频雾气纹理（值域 0..1）。"""
    rng = np.random.default_rng(seed)
    field = np.zeros((h, w), dtype=np.float32)
    for freq_x, freq_y, weight in ((2, 2, 0.55), (4, 3, 0.30), (7, 5, 0.15)):
        small = rng.random((freq_y, freq_x), dtype=np.float32)
        # 水平首尾拼贴 3 份后做平滑放大，再取中段保证完全无缝。
        tiled = np.concatenate([small, small, small], axis=1)
        im = Image.fromarray((tiled * 255).astype("uint8"), mode="L").resize(
            (w * 3, h), Image.Resampling.BICUBIC
        )
        arr = np.asarray(im, dtype=np.float32)[:, w:2 * w] / 255.0
        field += arr * weight
    field = np.clip((field - 0.30) / 0.55, 0.0, 1.0)
    return field


def apply_radial_glow(
    arr: np.ndarray,
    cx_norm: float,
    cy_norm: float,
    radius_norm: float,
    color_rgb: tuple[float, float, float],
    intensity: float,
) -> None:
    """原地叠加柔和的屏幕混合径向光晕（模拟真实灯火呼吸、窗灯渐亮或破晓朝阳）。"""
    if intensity <= 0.002:
        return
    h, w, _ = arr.shape
    cx, cy = cx_norm * w, cy_norm * h
    rad = max(8.0, radius_norm * w)
    x0 = max(0, int(cx - rad * 2.2))
    x1 = min(w, int(cx + rad * 2.2) + 1)
    y0 = max(0, int(cy - rad * 2.2))
    y1 = min(h, int(cy + rad * 2.2) + 1)
    if x1 <= x0 or y1 <= y0:
        return
    yy, xx = np.ogrid[y0:y1, x0:x1]
    d2 = ((xx - cx) ** 2 + (yy - cy) ** 2) / (rad * rad)
    falloff = np.exp(-d2 * 1.45) * intensity
    patch = arr[y0:y1, x0:x1]
    col = np.array(color_rgb, dtype=np.float32)
    # Screen 混合：自然提亮而不死白，只影响灯具附近。
    add = col * falloff[:, :, None]
    arr[y0:y1, x0:x1] = 255.0 - (255.0 - patch) * (1.0 - np.clip(add / 255.0, 0.0, 0.92))


def apply_drifting_mist(
    arr: np.ndarray,
    mist_field: np.ndarray,
    y0_norm: float,
    y1_norm: float,
    t_sec: float,
    speed_px_per_sec: float,
    opacity: float,
    tint_rgb: tuple[float, float, float] = (192.0, 206.0, 212.0),
    x_mask_range: tuple[float, float] = (0.0, 1.0),
) -> None:
    """在指定山谷高度带平滑叠加匀速漂移的轻透雾气，赋予远景纵深感。"""
    h, w, _ = arr.shape
    y0, y1 = int(h * y0_norm), int(h * y1_norm)
    mh = y1 - y0
    if mh <= 2:
        return
    shift = int(round(t_sec * speed_px_per_sec)) % w
    band = np.roll(mist_field[:mh, :w], shift, axis=1)
    # 上下边缘柔滑羽化，防止 float32(pi) 微负值产生 NaN 像素线。
    vy = np.maximum(0.0, np.sin(np.linspace(0.0, math.pi, mh, dtype=np.float32))) ** 1.4
    vx = np.ones(w, dtype=np.float32)
    xl, xr = x_mask_range
    if xl > 0.0 or xr < 1.0:
        xn = np.linspace(0.0, 1.0, w, dtype=np.float32)
        fade_l = np.clip((xn - xl) / 0.18, 0.0, 1.0) if xl > 0.0 else 1.0
        fade_r = np.clip((xr - xn) / 0.18, 0.0, 1.0) if xr < 1.0 else 1.0
        vx = fade_l * fade_r
    alpha = (band * vy[:, None] * vx[None, :] * opacity)[:, :, None]
    tint = np.array(tint_rgb, dtype=np.float32)
    arr[y0:y1] = arr[y0:y1] * (1.0 - alpha) + tint * alpha


def draw_floating_motes(
    frame: Image.Image,
    t_sec: float,
    count: int,
    color_rgb: tuple[int, int, int],
    max_alpha: int,
    y_range: tuple[float, float] = (0.20, 0.80),
    seed: int = 19,
    fade_envelope: float = 1.0,
) -> Image.Image:
    """极细微的暖尘/晨光漂浮粒子，增添空气感。"""
    if fade_envelope <= 0.01:
        return frame
    rng = np.random.default_rng(seed)
    xs = rng.uniform(0.06, 0.94, count)
    ys = rng.uniform(y_range[0], y_range[1], count)
    vx = rng.uniform(-0.012, 0.018, count)
    vy = rng.uniform(-0.014, -0.004, count)
    radii = rng.uniform(1.4, 3.0, count)
    phases = rng.uniform(0.0, math.tau, count)

    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for x0, y0, dx, dy, rad, ph in zip(xs, ys, vx, vy, radii, phases):
        px = ((x0 + dx * t_sec) % 1.0) * WIDTH
        py = (y0 + dy * t_sec + 0.012 * math.sin(t_sec * 1.4 + ph)) * HEIGHT
        if py < y_range[0] * HEIGHT or py > y_range[1] * HEIGHT:
            continue
        twinkle = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(t_sec * 2.1 + ph))
        a = int(max_alpha * twinkle * fade_envelope)
        if a < 6:
            continue
        r_outer = rad * 2.2
        draw.ellipse((px - r_outer, py - r_outer, px + r_outer, py + r_outer), fill=(*color_rgb, a // 3))
        draw.ellipse((px - rad, py - rad, px + rad, py + rad), fill=(*color_rgb, a))
    return Image.alpha_composite(frame.convert("RGBA"), overlay).convert("RGB")


def draw_animated_corner_badge(
    frame: Image.Image,
    t_local: float,
    dur: float,
    title: str,
    subtitle: str,
    align: str = "right",
    start_delay: float = 0.50,
    end_margin: float = 0.65,
) -> Image.Image:
    """纪录片细金竖线舒展 + 裁切滑出地标卡（避开顶栏与底部字幕安全区）。"""
    t_in = t_local - start_delay
    t_out = (dur - end_margin) - t_local
    if t_in <= 0.0 or t_out <= -0.45:
        return frame
    fade_out = 1.0 if t_out >= 0.0 else max(0.0, 1.0 + t_out / 0.45)
    line_p = ease_out(t_in / 0.38)
    slide_p = ease_out((t_in - 0.14) / 0.46)
    if line_p <= 0.01 or fade_out <= 0.01:
        return frame

    font_main = load_font("msyhbd.ttc", 22)
    font_sub = load_font("msyh.ttc", 16)
    probe = ImageDraw.Draw(Image.new("RGBA", (10, 10)))
    w1 = probe.textbbox((0, 0), title, font=font_main)[2]
    w2 = probe.textbbox((0, 0), subtitle, font=font_sub)[2] if subtitle else 0
    box_w = max(w1, w2) + 34
    box_h = 56 if subtitle else 38
    y_top = HEIGHT - 144 if subtitle else HEIGHT - 128

    if align == "right":
        x_left = WIDTH - 48 - box_w
    else:
        x_left = 48

    # 独立文字层用于裁切滑出（reveal mask），文字从细金竖线边缘顺滑抽出。
    plate = Image.new("RGBA", (box_w + 12, box_h + 8), (0, 0, 0, 0))
    pdraw = ImageDraw.Draw(plate)
    bg_a = int(128 * slide_p * fade_out)
    pdraw.rounded_rectangle((4, 2, box_w + 4, box_h + 2), radius=5, fill=(14, 18, 17, bg_a))

    shift = round((1.0 - slide_p) * 20.0)
    tx = 18 - shift if align == "left" else 18 + shift
    ta = int(242 * slide_p * fade_out)
    sa = int(202 * slide_p * fade_out)
    if subtitle:
        pdraw.text((tx, 7), title, font=font_main, fill=(246, 234, 206, ta))
        pdraw.text((tx, 33), subtitle, font=font_sub, fill=(224, 198, 146, sa))
    else:
        pdraw.text((tx, 6), title, font=font_main, fill=(246, 234, 206, ta))

    # 用滑出进度做宽度裁切，形成干净的“从细线展开”效果。
    reveal_w = max(4, round((box_w + 12) * slide_p))
    if align == "left":
        crop_box = (0, 0, reveal_w, box_h + 8)
        paste_x = x_left - 4
    else:
        crop_box = (box_w + 12 - reveal_w, 0, box_w + 12, box_h + 8)
        paste_x = x_left - 4 + (box_w + 12 - reveal_w)

    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    overlay.paste(plate.crop(crop_box), (paste_x, y_top - 2))

    # 标志性 3px 细金竖线从垂直中点上下展开。
    odraw = ImageDraw.Draw(overlay)
    bar_x = x_left if align == "left" else x_left + box_w
    half_h = (box_h * 0.5) * line_p
    mid_y = y_top + box_h * 0.5
    odraw.line(
        [(bar_x, mid_y - half_h), (bar_x, mid_y + half_h)],
        fill=(232, 194, 122, int(245 * fade_out)),
        width=3,
    )
    return Image.alpha_composite(frame.convert("RGBA"), overlay).convert("RGB")


def draw_prologue_title_anim(frame: Image.Image, t_local: float) -> Image.Image:
    """序幕云山动态主纪年卡：细金横线向两侧舒展 + “1934 · 秋”渐展字距浮现。"""
    if t_local < 0.45 or t_local > 4.60:
        return frame
    in_p = ease_out((t_local - 0.50) / 0.85)
    out_p = 1.0 - ease((t_local - 3.65) / 0.85)
    alpha = in_p * out_p
    if alpha <= 0.01:
        return frame

    overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    font_year = load_font("simsun.ttc", 58)
    font_sub = load_font("msyh.ttc", 19)

    cx = WIDTH // 2
    # 轻微上浮入场 + 字距由紧到松缓缓舒展，纪录片电影片头质感。
    cy = round(HEIGHT * 0.43 + (1.0 - in_p) * 14.0)
    spread = round(26.0 + 18.0 * ease_out((t_local - 0.50) / 2.8))

    # 居中金点 + 左右对称展开文字。
    dot_a = int(245 * alpha)
    text_a = int(248 * alpha)
    sh_a = int(170 * alpha)
    draw.ellipse((cx - 4, cy - 4, cx + 4, cy + 4), fill=(236, 198, 128, dot_a))
    for txt, tx, anc in (("1934", cx - spread, "rm"), ("秋", cx + spread, "lm")):
        draw.text((tx, cy + 3), txt, font=font_year, fill=(10, 12, 12, sh_a), anchor=anc)
        draw.text((tx, cy), txt, font=font_year, fill=(247, 236, 212, text_a), anchor=anc)

    # 上下对称细金线从中心向两侧拉展。
    line_p = ease_out((t_local - 0.45) / 0.72) * out_p
    half_w = round(148.0 * line_p)
    if half_w > 4:
        line_col = (232, 196, 130, int(180 * alpha))
        draw.line([(cx - half_w, cy - 48), (cx + half_w, cy - 48)], fill=line_col, width=1)
        draw.line([(cx - half_w, cy + 48), (cx + half_w, cy + 48)], fill=line_col, width=1)

    # 细线下极克制的小字副题。
    sub_a = ease((t_local - 1.05) / 0.55) * out_p
    if sub_a > 0.01:
        draw.text(
            (cx, cy + 68),
            "中央红军战略转移",
            font=font_sub,
            fill=(232, 220, 194, int(218 * sub_a)),
            anchor="mt",
            stroke_width=2,
            stroke_fill=(12, 15, 14, int(165 * sub_a)),
        )

    return Image.alpha_composite(frame.convert("RGBA"), overlay).convert("RGB")


def draw_ripple_rings(
    draw: ImageDraw.ImageDraw,
    px: float,
    py: float,
    t_sec: float,
    color_rgb: tuple[int, int, int],
    period: float = 1.9,
    max_radius: float = 34.0,
    rings: int = 2,
    alpha_scale: float = 1.0,
) -> None:
    """持续向外平滑扩散消散的细环波纹（用于地图关键节点定位）。"""
    if alpha_scale <= 0.01:
        return
    for k in range(rings):
        phase = ((t_sec / period) + k / rings) % 1.0
        r = 7.0 + max_radius * ease_out(phase)
        a = int(195 * ((1.0 - phase) ** 1.5) * alpha_scale)
        if a > 4:
            draw.ellipse((px - r, py - r, px + r, py + r), outline=(*color_rgb, a), width=2)


def draw_once_burst(
    draw: ImageDraw.ImageDraw,
    px: float,
    py: float,
    elapsed: float,
    color_rgb: tuple[int, int, int],
    duration: float = 1.15,
    max_radius: float = 42.0,
) -> None:
    """节点首次被流光触发时的一次性柔光扩散波纹。"""
    if elapsed < 0.0 or elapsed > duration:
        return
    p = elapsed / duration
    r = 8.0 + max_radius * ease_out(p)
    a = int(235 * ((1.0 - p) ** 1.6))
    draw.ellipse((px - r, py - r, px + r, py + r), outline=(*color_rgb, a), width=3)


def draw_direction_arrow(
    draw: ImageDraw.ImageDraw,
    head: tuple[float, float],
    prev: tuple[float, float],
    fill: tuple[int, int, int, int],
    outline: tuple[int, int, int, int],
    size: float = 12.0,
) -> None:
    """沿路线切线方向的锐利小型行军箭头。"""
    dx, dy = head[0] - prev[0], head[1] - prev[1]
    norm = math.hypot(dx, dy)
    if norm < 1e-4:
        return
    ux, uy = dx / norm, dy / norm
    nx, ny = -uy, ux
    tip = (head[0] + ux * size * 0.55, head[1] + uy * size * 0.55)
    left = (head[0] - ux * size * 0.65 + nx * size * 0.52, head[1] - uy * size * 0.65 + ny * size * 0.52)
    right = (head[0] - ux * size * 0.65 - nx * size * 0.52, head[1] - uy * size * 0.65 - ny * size * 0.52)
    draw.polygon([tip, left, right], fill=fill, outline=outline)


def render_ken_burns(
    photo_path: Path,
    total_frames: int,
    zoom_start: float,
    zoom_end: float,
    focus_start: tuple[float, float] = (0.5, 0.5),
    focus_end: tuple[float, float] | None = None,
    hold_start_frames: int = 0,
    hold_end_frames: int = 0,
    grade_rgb: tuple[float, float, float] = (1.0, 1.0, 1.0),
    brightness: float = 0.0,
    crop_norm: tuple[float, float, float, float] | None = None,
    top_nd_alpha: float = 0.0,
    pre_crop_fx=None,
    overlay_fn=None,
) -> list[Image.Image]:
    """支持起止焦点的平滑运镜、原图空间物理光影（灯火/波纹/漂雾）与屏幕空间动效叠层。"""
    if focus_end is None:
        focus_end = focus_start
    with Image.open(photo_path) as raw:
        img = raw.convert("RGB")
    if crop_norm is not None:
        w, h = img.size
        img = img.crop((
            round(w * crop_norm[0]),
            round(h * crop_norm[1]),
            round(w * crop_norm[2]),
            round(h * crop_norm[3]),
        ))
    w, h = img.size
    target_ratio = WIDTH / HEIGHT
    if abs((w / h) - target_ratio) > 0.002:
        if w / h > target_ratio:
            nw = round(h * target_ratio)
            left = (w - nw) // 2
            img = img.crop((left, 0, left + nw, h))
        else:
            nh = round(w / target_ratio)
            top = (h - nh) // 2
            img = img.crop((0, top, w, top + nh))

    pure_img = img.resize((WIDTH, HEIGHT), Image.Resampling.LANCZOS)
    # 若需做逐帧原图空间特效（灯火/水波/漂雾），预先缩到适中工作分辨率（1440×810）兼顾速度与超采样清晰度。
    work_img = img
    if pre_crop_fx is not None and img.size[0] > 1440:
        work_img = img.resize((1440, 810), Image.Resampling.LANCZOS)

    base_arr = np.asarray(work_img, dtype=np.float32)
    if grade_rgb != (1.0, 1.0, 1.0) or brightness != 0.0 or top_nd_alpha > 0.0:
        base_arr = base_arr.copy()
        base_arr[..., 0] = base_arr[..., 0] * grade_rgb[0] + brightness
        base_arr[..., 1] = base_arr[..., 1] * grade_rgb[1] + brightness
        base_arr[..., 2] = base_arr[..., 2] * grade_rgb[2] + brightness
        if top_nd_alpha > 0.0:
            gh = base_arr.shape[0]
            y = np.linspace(0.0, 1.0, gh, dtype=np.float32)[:, None, None]
            mask = np.clip((0.28 - y) / 0.28, 0.0, 1.0) ** 1.6 * top_nd_alpha
            sky_tint = np.array([30.0, 38.0, 44.0], dtype=np.float32)
            base_arr = base_arr * (1.0 - mask) + sky_tint * mask
        base_arr = np.clip(base_arr, 0.0, 255.0)
    graded_static = Image.fromarray(base_arr.astype("uint8"))

    bw, bh = graded_static.size
    move_frames = max(1, total_frames - hold_start_frames - hold_end_frames)
    frames: list[Image.Image] = []
    for i in range(total_frames):
        pure_hold_start = (
            i < hold_start_frames
            and zoom_start == 1.0
            and grade_rgb == (1.0, 1.0, 1.0)
            and brightness == 0.0
        )
        pure_hold_end = (
            i >= total_frames - hold_end_frames
            and zoom_end == 1.0
            and grade_rgb == (1.0, 1.0, 1.0)
            and brightness == 0.0
        )
        if pure_hold_start or pure_hold_end:
            frame = pure_img.copy()
        else:
            if i < hold_start_frames:
                t = 0.0
            elif i >= total_frames - hold_end_frames:
                t = 1.0
            else:
                t = ease((i - hold_start_frames) / max(1, move_frames - 1))

            if pre_crop_fx is not None:
                cur_arr = base_arr.copy()
                pre_crop_fx(cur_arr, i, total_frames)
                src_im = Image.fromarray(np.clip(cur_arr, 0.0, 255.0).astype("uint8"))
            else:
                src_im = graded_static

            zoom = zoom_start + (zoom_end - zoom_start) * t
            fx = focus_start[0] + (focus_end[0] - focus_start[0]) * t
            fy = focus_start[1] + (focus_end[1] - focus_start[1]) * t
            cw, ch = bw / zoom, bh / zoom
            left = (bw - cw) * fx
            top = (bh - ch) * fy
            frame = src_im.resize(
                (WIDTH, HEIGHT), Image.Resampling.BICUBIC, box=(left, top, left + cw, top + ch)
            )
        if overlay_fn is not None:
            frame = overlay_fn(frame, i, total_frames)
        frames.append(frame)
    return frames


def draw_xiang_aftermath_overlay(shot_start_sec: float):
    """湘江渡江后动态兵力对比面板：8.6 万滚升展开，随旁白骤缩回 3 万余人。"""
    font_meta = load_font("msyh.ttc", 19)
    font_num = load_font("msyhbd.ttc", 28)

    def apply(frame: Image.Image, idx: int, total: int) -> Image.Image:
        t_global = shot_start_sec + idx / FPS
        in_panel = ease_out((t_global - 38.18) / 0.50)
        out_panel = 1.0 - ease((t_global - 42.65) / 0.45)
        alpha_panel = in_panel * out_panel
        if alpha_panel <= 0.01:
            return frame

        # 第一条：0.0 -> 8.6 万余人同步舒展与滚动计数。
        p1 = ease_out((t_global - 38.32) / 0.90)
        # 第二条：先在 8.6 万满格位置出现，再于 40.25–41.40s 向左骤缩至 3.0 万比例，直观呈现“锐减”。
        a2 = ease((t_global - 40.00) / 0.35)
        drop_p = ease_in_out_cubic((t_global - 40.25) / 1.15)
        ratio2 = 1.0 - (1.0 - 3.0 / 8.6) * drop_p
        val2 = 8.6 - 5.6 * drop_p

        overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        x0, y0, pw, ph = 800, 198, 428, 196
        shift_x = round((1.0 - in_panel) * 26.0)
        rx0 = x0 + shift_x

        draw.rounded_rectangle(
            (rx0, y0, rx0 + pw, y0 + ph),
            radius=10,
            fill=(16, 20, 19, int(146 * alpha_panel)),
            outline=(218, 194, 146, int(125 * alpha_panel)),
            width=1,
        )
        # 顶边细金高亮条由左向右滑入。
        accent_w = round((pw - 24) * in_panel)
        if accent_w > 4:
            draw.line(
                [(rx0 + 12, y0 + 1), (rx0 + 12 + accent_w, y0 + 1)],
                fill=(236, 202, 132, int(200 * alpha_panel)),
                width=2,
            )

        bar_x = rx0 + 24
        bar_max_w = pw - 48
        num1_str = f"{8.6 * p1:.1f} 万余人" if p1 < 0.995 else "8.6 万余人"
        draw.text((bar_x, y0 + 20), "1934.10  于都出发", font=font_meta, fill=(228, 217, 194, int(210 * alpha_panel)))
        draw.text((rx0 + pw - 24, y0 + 14), num1_str, font=font_num, fill=(244, 218, 158, int(246 * alpha_panel)), anchor="ra")
        draw.rounded_rectangle((bar_x, y0 + 58, bar_x + bar_max_w, y0 + 70), radius=4, fill=(255, 255, 255, int(24 * alpha_panel)))
        w1 = max(8, round(bar_max_w * p1))
        draw.rounded_rectangle((bar_x, y0 + 58, bar_x + w1, y0 + 70), radius=4, fill=(214, 174, 102, int(238 * alpha_panel)))

        # 中间分隔细线随第一条同步展开。
        div_w = round(bar_max_w * p1)
        draw.line((bar_x, y0 + 96, bar_x + div_w, y0 + 96), fill=(218, 194, 146, int(58 * alpha_panel)), width=1)

        if a2 > 0.01:
            ea2 = a2 * alpha_panel
            num2_str = f"{val2:.1f} 万余人" if drop_p < 0.985 else "3 万余人"
            draw.text((bar_x, y0 + 114), "1934.12  渡过湘江", font=font_meta, fill=(228, 217, 194, int(210 * ea2)))
            draw.text((rx0 + pw - 24, y0 + 108), num2_str, font=font_num, fill=(240, 126, 104, int(248 * ea2)), anchor="ra")
            draw.rounded_rectangle((bar_x, y0 + 152, bar_x + bar_max_w, y0 + 164), radius=4, fill=(255, 255, 255, int(24 * ea2)))
            w2 = max(8, round(bar_max_w * ratio2))
            # 骤缩经过的区域残留一层淡暗红残影，强化流失观感。
            if w2 < bar_max_w - 4:
                draw.rounded_rectangle(
                    (bar_x + w2, y0 + 153, bar_x + bar_max_w, y0 + 163),
                    radius=3,
                    fill=(170, 58, 46, int(52 * ea2 * (1.0 - 0.45 * drop_p))),
                )
            draw.rounded_rectangle((bar_x, y0 + 152, bar_x + w2, y0 + 164), radius=4, fill=(202, 74, 56, int(242 * ea2)))
            # 骤缩前沿微亮刻度线。
            if 0.02 < drop_p < 0.98:
                draw.line([(bar_x + w2, y0 + 148), (bar_x + w2, y0 + 168)], fill=(255, 224, 192, int(225 * ea2)), width=2)

        return Image.alpha_composite(frame.convert("RGBA"), overlay).convert("RGB")

    return apply


# ---------------------------------------------------------------------------
# 暗调立体动态地图渲染器（三段：于都西进、黎平改向、四站流光回望）
# ---------------------------------------------------------------------------

def build_dark_relief_base(west: float, north: float, east: float, south: float) -> Image.Image:
    """基于课件原生 elevation.png 生成暗调立体地形底图（YAVG ~76–86，与 terrain.jpg 同色系）。"""
    with Image.open(ASSETS / "elevation.png") as packed:
        w, h = packed.size
        box = (
            (west - 90.5) / 42.0 * w,
            (44.25 - north) / 34.0 * h,
            (east - 90.5) / 42.0 * w,
            (44.25 - south) / 34.0 * h,
        )
        x0, y0 = math.floor(box[0]), math.floor(box[1])
        x1, y1 = math.ceil(box[2]), math.ceil(box[3])
        tile = np.asarray(packed.crop((x0, y0, x1, y1)), dtype=np.float32)

    heights = Image.fromarray(tile[:, :, 0] * 256.0 + tile[:, :, 1] - 2048.0)
    z = np.asarray(
        heights.resize((WIDTH, HEIGHT), Image.Resampling.BICUBIC, box=(box[0] - x0, box[1] - y0, box[2] - x0, box[3] - y0)),
        dtype=np.float32,
    )
    gy, gx = np.gradient(z)
    shade = (0.68 - 0.030 * gx - 0.042 * gy) / np.sqrt(1.0 + (0.052 * gx) ** 2 + (0.052 * gy) ** 2)
    contour = np.clip(1.0 - np.abs((z + 100.0) % 200.0 - 100.0) / (1.8 + 0.9 * np.hypot(gx, gy)), 0.0, 1.0)
    elev_norm = np.clip((z - 120.0) / 1450.0, 0.0, 1.0)

    r = 34.0 + 38.0 * elev_norm + 26.0 * (shade - 0.5) - 6.0 * contour
    g = 48.0 + 36.0 * elev_norm + 28.0 * (shade - 0.5) - 7.0 * contour
    b = 43.0 + 22.0 * elev_norm + 22.0 * (shade - 0.5) - 5.0 * contour

    yy, xx = np.ogrid[:HEIGHT, :WIDTH]
    nx = (xx - WIDTH * 0.5) / (WIDTH * 0.55)
    ny = (yy - HEIGHT * 0.5) / (HEIGHT * 0.58)
    vignette = 1.0 - 0.28 * np.clip(nx * nx + ny * ny - 0.35, 0.0, 1.2)
    top_guard = 1.0 - 0.24 * np.clip((HEIGHT * 0.22 - yy) / (HEIGHT * 0.22), 0.0, 1.0) ** 1.5
    factor = vignette * top_guard

    rgb = np.stack([r * factor, g * factor, b * factor], axis=-1)
    base = Image.fromarray(np.clip(rgb, 0, 255).astype("uint8"), mode="RGB").convert("RGBA")

    grid = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    draw = ImageDraw.Draw(grid)
    lon_step = 2.0 if (east - west) > 7.0 else 1.0
    lat_step = 1.0
    lon_v = math.ceil(west / lon_step) * lon_step
    while lon_v < east:
        px = (lon_v - west) / (east - west) * WIDTH
        draw.line([(px, 0), (px, HEIGHT)], fill=(214, 206, 180, 16), width=1)
        lon_v += lon_step
    lat_v = math.ceil(south / lat_step) * lat_step
    while lat_v < north:
        py = (north - lat_v) / (north - south) * HEIGHT
        draw.line([(0, py), (WIDTH, py)], fill=(214, 206, 180, 16), width=1)
        lat_v += lat_step

    return Image.alpha_composite(base, grid).convert("RGB")


def catmull_rom_path(points: list[tuple[float, float]], samples_per_seg: int = 48) -> np.ndarray:
    pts = [np.array(p, dtype=np.float64) for p in points]
    if len(pts) < 2:
        return np.asarray(pts)
    padded = [pts[0], *pts, pts[-1]]
    out = []
    for i in range(1, len(padded) - 2):
        p0, p1, p2, p3 = padded[i - 1], padded[i], padded[i + 1], padded[i + 2]
        for s in range(samples_per_seg):
            t = s / samples_per_seg
            t2, t3 = t * t, t * t * t
            val = 0.5 * (
                (2.0 * p1)
                + (-p0 + p2) * t
                + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
                + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3
            )
            out.append(val)
    out.append(pts[-1])
    return np.asarray(out)


def draw_aa_polyline(
    size: tuple[int, int],
    pts: np.ndarray,
    color: tuple[int, int, int, int],
    width: int,
    glow: tuple[int, int, int, int] | None = None,
) -> Image.Image:
    if len(pts) < 2:
        return Image.new("RGBA", size, (0, 0, 0, 0))
    hi = Image.new("RGBA", (size[0] * 2, size[1] * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(hi)
    coords = [(float(p[0]) * 2.0, float(p[1]) * 2.0) for p in pts]
    if glow is not None:
        draw.line(coords, fill=glow, width=width * 2 + 12, joint="curve")
    draw.line(coords, fill=color, width=width * 2, joint="curve")
    return hi.resize(size, Image.Resampling.LANCZOS)


def draw_aa_dashed(
    size: tuple[int, int],
    pts: np.ndarray,
    color: tuple[int, int, int, int],
    width: int,
    dash_px: float = 16.0,
    gap_px: float = 12.0,
    phase_px: float = 0.0,
) -> Image.Image:
    """支持流动相位偏移的抗锯齿虚线（marching dashes）。"""
    if len(pts) < 2:
        return Image.new("RGBA", size, (0, 0, 0, 0))
    seg_len = np.linalg.norm(np.diff(pts, axis=0), axis=1)
    cum = np.r_[0.0, np.cumsum(seg_len)]
    total = cum[-1]
    hi = Image.new("RGBA", (size[0] * 2, size[1] * 2), (0, 0, 0, 0))
    draw = ImageDraw.Draw(hi)
    period = dash_px + gap_px
    pos = -(phase_px % period)
    while pos < total:
        s0 = max(0.0, pos)
        s1 = min(total, pos + dash_px)
        if s1 - s0 > 1.0:
            d0 = int(np.searchsorted(cum, s0))
            d1 = int(np.searchsorted(cum, s1))
            sub = [(np.interp(s0, cum, pts[:, 0]) * 2.0, np.interp(s0, cum, pts[:, 1]) * 2.0)]
            for k in range(max(1, d0), min(len(pts), d1)):
                sub.append((float(pts[k, 0]) * 2.0, float(pts[k, 1]) * 2.0))
            sub.append((np.interp(s1, cum, pts[:, 0]) * 2.0, np.interp(s1, cum, pts[:, 1]) * 2.0))
            if len(sub) >= 2:
                draw.line(sub, fill=color, width=width * 2, joint="curve")
        pos += period
    return hi.resize(size, Image.Resampling.LANCZOS)


def sample_subpath(curve: np.ndarray, cum_dist: np.ndarray, d_start: float, d_end: float) -> np.ndarray:
    """按弧长区间截取曲线段（用于绘制动态发光彗尾）。"""
    d_start = max(0.0, d_start)
    d_end = min(float(cum_dist[-1]), d_end)
    if d_end - d_start < 1.0:
        return np.empty((0, 2), dtype=np.float64)
    i0 = int(np.searchsorted(cum_dist, d_start))
    i1 = int(np.searchsorted(cum_dist, d_end))
    pts = [np.array([np.interp(d_start, cum_dist, curve[:, 0]), np.interp(d_start, cum_dist, curve[:, 1])])]
    for k in range(max(1, i0), min(len(curve), i1)):
        pts.append(curve[k])
    pts.append(np.array([np.interp(d_end, cum_dist, curve[:, 0]), np.interp(d_end, cum_dist, curve[:, 1])]))
    return np.asarray(pts)


def draw_map_label(
    draw: ImageDraw.ImageDraw,
    xy: tuple[float, float],
    text: str,
    font: ImageFont.FreeTypeFont,
    color: tuple[int, int, int, int],
    anchor: str = "lm",
    stroke_alpha: int = 210,
) -> None:
    draw.text(
        xy,
        text,
        font=font,
        fill=color,
        anchor=anchor,
        stroke_width=3,
        stroke_fill=(14, 20, 18, int(stroke_alpha * color[3] / 255)),
    )


def render_map_yudu_west(total_frames: int) -> list[Image.Image]:
    """暗调动态地图上篇：于都集结双环脉冲 + 滚动兵力数字 + 发光箭头路线西进湘江（全安全区内收）。"""
    west, north, east, south = 104.2, 29.25, 118.4, 23.35
    base = build_dark_relief_base(west, north, east, south)

    def proj(lon: float, lat: float) -> tuple[float, float]:
        return ((lon - west) / (east - west) * WIDTH, (north - lat) / (north - south) * HEIGHT)

    yudu_to_xiang = [proj(lon, lat) for _, lon, lat in ROUTE_STOPS[:5]]
    curve = catmull_rom_path(yudu_to_xiang, samples_per_seg=48)
    seg_dist = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))]
    total_len = seg_dist[-1]

    pt_yudu = proj(115.41, 25.95)
    pt_xiang = proj(110.73, 25.83)
    pt_liping = proj(109.14, 26.23)
    pt_zunyi = proj(106.93, 27.69)

    font_city = load_font("msyhbd.ttc", 28)
    font_sub = load_font("msyh.ttc", 19)
    font_dim = load_font("msyh.ttc", 22)

    frames: list[Image.Image] = []
    for i in range(total_frames):
        t = i / max(1, total_frames - 1)
        t_sec = i / FPS
        canvas = base.convert("RGBA")
        overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        for name, pt, off, anc in [
            ("黎平", pt_liping, (0, 22), "mt"),
            ("遵义", pt_zunyi, (-14, -4), "rm"),
        ]:
            px, py = pt
            draw.ellipse((px - 4, py - 4, px + 4, py + 4), fill=(186, 178, 154, 115))
            draw_map_label(draw, (px + off[0], py + off[1]), name, font_dim, (194, 188, 168, 130), anchor=anc)

        # 于都出发光点、双层扩散雷达波纹与滚动人数计数。
        a_yudu = ease(t / 0.14)
        count_p = ease_out(t_sec / 1.15)
        yx, yy = pt_yudu
        draw_ripple_rings(draw, yx, yy, t_sec, (236, 192, 112), period=1.8, max_radius=34.0, rings=2, alpha_scale=a_yudu)
        draw.ellipse((yx - 8, yy - 8, yx + 8, yy + 8), fill=(242, 200, 122, int(255 * a_yudu)), outline=(255, 245, 220, int(245 * a_yudu)), width=2)
        draw_map_label(draw, (yx - 20, yy - 32), "于都", font_city, (250, 232, 190, int(250 * a_yudu)), anchor="rm")
        troops_txt = f"1934.10 · {8.6 * count_p:.1f} 万余人" if count_p < 0.99 else "1934.10 · 8.6 万余人"
        draw_map_label(draw, (yx - 20, yy + 2), troops_txt, font_sub, (236, 210, 158, int(232 * a_yudu)), anchor="rm")

        # 路线推进 + 前端发光彗尾 + 切线行军箭头。
        prog = ease((t - 0.16) / 0.78)
        if prog > 0.005:
            cur_len = prog * total_len
            sub_pts = sample_subpath(curve, seg_dist, 0.0, cur_len)
            line_img = draw_aa_polyline(
                (WIDTH, HEIGHT),
                sub_pts,
                color=(208, 72, 54, 242),
                width=5,
                glow=(236, 120, 82, 74),
            )
            canvas = Image.alpha_composite(canvas, line_img)
            # 前端暖金发光彗尾（最后 65px）。
            comet = sample_subpath(curve, seg_dist, cur_len - 65.0, cur_len)
            if len(comet) >= 2:
                comet_img = draw_aa_polyline((WIDTH, HEIGHT), comet, color=(252, 216, 146, 225), width=4, glow=(248, 178, 92, 95))
                canvas = Image.alpha_composite(canvas, comet_img)
            head = (float(sub_pts[-1, 0]), float(sub_pts[-1, 1]))
            prev = (float(sub_pts[max(0, len(sub_pts) - 4), 0]), float(sub_pts[max(0, len(sub_pts) - 4), 1]))
            draw_direction_arrow(draw, head, prev, fill=(252, 232, 184, 252), outline=(188, 52, 38, 250), size=12.5)

        a_xiang = ease((t - 0.50) / 0.24)
        if a_xiang > 0.01:
            xx, xy = pt_xiang
            draw_once_burst(draw, xx, xy, t_sec - total_frames / FPS * 0.54, (226, 114, 92), duration=1.2, max_radius=32.0)
            draw.ellipse((xx - 6, xy - 6, xx + 6, xy + 6), fill=(214, 102, 82, int(235 * a_xiang)), outline=(248, 236, 212, int(225 * a_xiang)), width=2)
            draw_map_label(draw, (xx, xy + 24), "湘江", font_city, (242, 226, 200, int(244 * a_xiang)), anchor="mt")

        composed = Image.alpha_composite(canvas, overlay).convert("RGB")
        # 轻量动态跟拍，确保左右两端地名在 4:3 / 16:10 / 16:9 视口下全部处于中央安全区。
        p_cam = ease(t)
        zoom = 1.05 - 0.05 * p_cam
        cw, ch = WIDTH / zoom, HEIGHT / zoom
        left = (WIDTH - cw) * (0.64 - 0.16 * p_cam)
        top = (HEIGHT - ch) * 0.50
        composed = composed.resize((WIDTH, HEIGHT), Image.Resampling.BICUBIC, box=(left, top, left + cw, top + ch))
        frames.append(composed)
    return frames


def render_map_liping_turn(total_frames: int, shot_start_sec: float) -> list[Image.Image]:
    """暗调动态地图下篇：流动北上虚线遇动态脉冲重兵防线 -> 黎平波纹决策改向黔北（全安全区内收）。"""
    west, north, east, south = 104.5, 29.35, 113.0, 24.55
    base = build_dark_relief_base(west, north, east, south)

    def proj(lon: float, lat: float) -> tuple[float, float]:
        return ((lon - west) / (east - west) * WIDTH, (north - lat) / (north - south) * HEIGHT)

    pt_xiang = proj(110.73, 25.83)
    pt_tongdao = proj(109.6258, 26.31679)
    pt_liping = proj(109.14, 26.23)
    pt_houchang = proj(107.47, 27.07)
    pt_wujiang = proj(107.47, 27.32)
    pt_zunyi = proj(106.93, 27.69)

    past_curve = catmull_rom_path([pt_xiang, pt_tongdao, pt_liping], samples_per_seg=42)
    north_curve = catmull_rom_path(
        [pt_tongdao, proj(109.78, 26.95), proj(109.95, 27.68), proj(110.12, 28.10)],
        samples_per_seg=40,
    )
    north_dist = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(north_curve, axis=0), axis=1))]
    west_curve = catmull_rom_path(
        [pt_liping, proj(108.35, 26.52), pt_houchang, pt_wujiang, pt_zunyi],
        samples_per_seg=48,
    )
    west_dist = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(west_curve, axis=0), axis=1))]

    past_layer = draw_aa_polyline(
        (WIDTH, HEIGHT),
        past_curve,
        color=(182, 74, 58, 215),
        width=4,
        glow=(212, 102, 76, 48),
    )

    font_city = load_font("msyhbd.ttc", 28)
    font_small = load_font("msyh.ttc", 21)
    font_warn = load_font("msyhbd.ttc", 22)
    font_date = load_font("msyh.ttc", 18)

    frames: list[Image.Image] = []
    for i in range(total_frames):
        t_global = shot_start_sec + i / FPS
        t_sec = i / FPS
        canvas = Image.alpha_composite(base.convert("RGBA"), past_layer)

        north_prog = ease((t_global - 49.10) / 2.15)
        block_a = ease((t_global - 51.20) / 0.75)
        dim_north = 1.0 - 0.72 * ease((t_global - 54.65) / 1.00)

        if north_prog > 0.01:
            cur_n = north_prog * north_dist[-1]
            pts_n = sample_subpath(north_curve, north_dist, 0.0, cur_n)
            # 沿线向上流动的行军虚线（54.65s 转向后逐渐停止流动）。
            dash_phase = t_sec * 34.0 * (0.2 + 0.8 * dim_north)
            dash_layer = draw_aa_dashed(
                (WIDTH, HEIGHT),
                pts_n,
                color=(206, 216, 220, int(212 * dim_north)),
                width=3,
                dash_px=14.0,
                gap_px=10.0,
                phase_px=-dash_phase,
            )
            canvas = Image.alpha_composite(canvas, dash_layer)

        west_prog = ease((t_global - 54.80) / 4.70)
        head_pair = None
        if west_prog > 0.005:
            cur_w = west_prog * west_dist[-1]
            pts_w = sample_subpath(west_curve, west_dist, 0.0, cur_w)
            west_layer = draw_aa_polyline(
                (WIDTH, HEIGHT),
                pts_w,
                color=(222, 76, 54, 248),
                width=5,
                glow=(244, 134, 88, 86),
            )
            canvas = Image.alpha_composite(canvas, west_layer)
            comet = sample_subpath(west_curve, west_dist, cur_w - 75.0, cur_w)
            if len(comet) >= 2:
                comet_img = draw_aa_polyline((WIDTH, HEIGHT), comet, color=(254, 222, 152, 232), width=4, glow=(250, 184, 96, 102))
                canvas = Image.alpha_composite(canvas, comet_img)
            head_pair = (
                (float(pts_w[-1, 0]), float(pts_w[-1, 1])),
                (float(pts_w[max(0, len(pts_w) - 4), 0]), float(pts_w[max(0, len(pts_w) - 4), 1])),
            )

        overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        if north_prog > 0.25:
            na = ease((north_prog - 0.25) / 0.45) * dim_north
            nx, ny = proj(110.12, 28.10)
            draw_map_label(draw, (nx + 18, ny), "原定北上 · 湘西北", font_small, (206, 214, 218, int(225 * na)), anchor="lm")

        if block_a > 0.01:
            ba = block_a * dim_north
            bx, by = proj(109.90, 27.58)
            # 主双弧防线 + 动态向外扩散的克制红光警戒波。
            for radius, w_arc in ((34, 4), (48, 2)):
                draw.arc(
                    (bx - radius, by - radius, bx + radius, by + radius),
                    start=25, end=155,
                    fill=(226, 88, 72, int(240 * ba)),
                    width=w_arc,
                )
            pulse_phase = ((t_global - 51.20) / 1.35) % 1.0
            pr = 34.0 + 30.0 * ease_out(pulse_phase)
            pa = int(170 * (1.0 - pulse_phase) * ba)
            if pa > 5:
                draw.arc((bx - pr, by - pr, bx + pr, by + pr), start=25, end=155, fill=(242, 112, 92, pa), width=2)
            draw_map_label(draw, (bx + 54, by + 12), "前方重兵阻截", font_warn, (240, 128, 110, int(242 * ba)), anchor="lm")

        for name, pt, off, anc, is_focus in [
            ("湘江", pt_xiang, (16, 4), "lm", False),
            ("通道", pt_tongdao, (16, 12), "lm", False),
            ("黎平", pt_liping, (-16, 28), "rm", True),
        ]:
            px, py = pt
            if is_focus:
                glow_a = ease((t_global - 54.45) / 0.50)
                if glow_a > 0.01:
                    draw_once_burst(draw, px, py, t_global - 54.45, (246, 206, 126), duration=1.35, max_radius=46.0)
                    draw_ripple_rings(draw, px, py, t_sec, (238, 192, 112), period=2.0, max_radius=28.0, rings=1, alpha_scale=glow_a * 0.85)
                    draw_map_label(draw, (px - 16, py + 58), "1934.12.18  改向黔北", font_date, (244, 214, 152, int(238 * glow_a)), anchor="rm")
                draw.ellipse((px - 8, py - 8, px + 8, py + 8), fill=(244, 200, 118, 250), outline=(255, 246, 224, 240), width=2)
                draw_map_label(draw, (px + off[0], py + off[1]), name, font_city, (252, 236, 198, 250), anchor=anc)
            else:
                draw.ellipse((px - 5, py - 5, px + 5, py + 5), fill=(208, 112, 92, 225), outline=(246, 232, 210, 200), width=1)
                draw_map_label(draw, (px + off[0], py + off[1]), name, font_small, (226, 216, 196, 215), anchor=anc)

        for name, pt, trig, off, anc, major in [
            ("猴场", pt_houchang, 0.52, (-16, 12), "rm", False),
            ("乌江", pt_wujiang, 0.68, (18, -2), "lm", False),
            ("遵义", pt_zunyi, 0.80, (-18, -2), "rm", True),
        ]:
            la = ease((west_prog - trig) / 0.16)
            if la > 0.01:
                px, py = pt
                # 节点刚到达时绽放柔光扩散环。
                trig_t = 54.80 + 4.70 * trig
                draw_once_burst(draw, px, py, t_global - trig_t, (244, 200, 120) if major else (238, 146, 106), duration=1.1, max_radius=38.0 if major else 26.0)
                if major:
                    draw.ellipse((px - 17, py - 17, px + 17, py + 17), fill=(238, 184, 96, int(76 * la)))
                    draw.ellipse((px - 8, py - 8, px + 8, py + 8), fill=(248, 208, 130, int(252 * la)), outline=(255, 248, 232, int(245 * la)), width=2)
                    draw_map_label(draw, (px + off[0], py + off[1]), name, font_city, (254, 240, 206, int(252 * la)), anchor=anc)
                else:
                    draw.ellipse((px - 6, py - 6, px + 6, py + 6), fill=(236, 138, 102, int(242 * la)), outline=(252, 240, 218, int(230 * la)), width=2)
                    draw_map_label(draw, (px + off[0], py + off[1]), name, font_small, (242, 230, 204, int(238 * la)), anchor=anc)

        if head_pair is not None:
            draw_direction_arrow(draw, head_pair[0], head_pair[1], fill=(254, 234, 184, 254), outline=(196, 56, 40, 252), size=13.0)

        composed = Image.alpha_composite(canvas, overlay).convert("RGB")
        p_cam = ease(i / max(1, total_frames - 1))
        zoom = 1.00 + 0.04 * p_cam
        cw, ch = WIDTH / zoom, HEIGHT / zoom
        left = (WIDTH - cw) * (0.60 - 0.22 * p_cam)
        top = (HEIGHT - ch) * (0.52 - 0.12 * p_cam)
        composed = composed.resize((WIDTH, HEIGHT), Image.Resampling.BICUBIC, box=(left, top, left + cw, top + ch))
        frames.append(composed)
    return frames


def render_map_turning_recap(total_frames: int) -> list[Image.Image]:
    """全线四站时空回望动态沙盘（安全区内收，底部四站时间轴交由前端响应式安全区叠层渲染）。"""
    west, north, east, south = 104.0, 29.55, 118.2, 23.15
    base = build_dark_relief_base(west, north, east, south)

    def proj(lon: float, lat: float) -> tuple[float, float]:
        return ((lon - west) / (east - west) * WIDTH, (north - lat) / (north - south) * HEIGHT)

    full_pts = [proj(lon, lat) for _, lon, lat in ROUTE_STOPS]
    curve = catmull_rom_path(full_pts, samples_per_seg=42)
    cum_dist = np.r_[0.0, np.cumsum(np.linalg.norm(np.diff(curve, axis=0), axis=1))]
    total_len = float(cum_dist[-1])

    # 预计算四个核心站点的曲线位置比例与坐标，地名严格收在中央水平安全区。
    milestones = [
        ("于都", "1934.10", "集结", proj(115.41, 25.95), 0.00, (-12, -32), "rb"),
        ("湘江", "1934.11", "血战", proj(110.73, 25.83), 0.44, (0, 24), "mt"),
        ("黎平", "1934.12", "改向", proj(109.14, 26.23), 0.64, (-16, 26), "rm"),
        ("遵义", "1935.01", "转折", proj(106.93, 27.69), 1.00, (16, -14), "lb"),
    ]

    # 常驻暗朱红全线底轨。
    base_route = draw_aa_polyline(
        (WIDTH, HEIGHT),
        curve,
        color=(180, 66, 50, 200),
        width=4,
        glow=(212, 92, 66, 52),
    )

    font_city = load_font("msyhbd.ttc", 26)
    font_major = load_font("msyhbd.ttc", 30)
    font_tl_date = load_font("msyh.ttc", 16)
    font_tl_name = load_font("msyhbd.ttc", 20)

    dur = total_frames / FPS
    frames: list[Image.Image] = []
    for i in range(total_frames):
        t = i / max(1, total_frames - 1)
        t_sec = i / FPS
        canvas = Image.alpha_composite(base.convert("RGBA"), base_route)

        # 暖金流光在 0.45s -> 4.15s 之间自东向西巡掠全线，点亮四站。
        sweep = ease_in_out_cubic((t_sec - 0.45) / 3.70)
        cur_d = sweep * total_len
        if sweep > 0.005:
            # 已被流光点亮的高亮轨迹。
            lit_pts = sample_subpath(curve, cum_dist, 0.0, cur_d)
            lit_layer = draw_aa_polyline(
                (WIDTH, HEIGHT),
                lit_pts,
                color=(232, 102, 72, 242),
                width=5,
                glow=(246, 170, 96, 82),
            )
            canvas = Image.alpha_composite(canvas, lit_layer)
            # 流光彗星头部（95px 暖金拖尾）。
            if sweep < 0.995:
                comet = sample_subpath(curve, cum_dist, cur_d - 95.0, cur_d)
                if len(comet) >= 2:
                    comet_layer = draw_aa_polyline(
                        (WIDTH, HEIGHT),
                        comet,
                        color=(255, 232, 168, 245),
                        width=5,
                        glow=(252, 198, 110, 120),
                    )
                    canvas = Image.alpha_composite(canvas, comet_layer)

        overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
        draw = ImageDraw.Draw(overlay)

        for idx_m, (name, date_s, kw, pt, frac, off, anc) in enumerate(milestones):
            px, py = pt
            is_last = idx_m == 3
            lit_t = 0.45 + 3.70 * frac
            lit_p = ease_out((t_sec - lit_t) / 0.45)
            # 未亮之前保持微暗坐标点，触达瞬间绽放波纹并点亮地名。
            if lit_p <= 0.01:
                draw.ellipse((px - 5, py - 5, px + 5, py + 5), fill=(190, 176, 150, 130))
            else:
                draw_once_burst(
                    draw, px, py, t_sec - lit_t,
                    (248, 208, 128) if is_last else (238, 176, 104),
                    duration=1.25,
                    max_radius=46.0 if is_last else 32.0,
                )
                if is_last:
                    draw_ripple_rings(draw, px, py, max(0.0, t_sec - lit_t), (244, 202, 120), period=1.6, max_radius=36.0, rings=2, alpha_scale=lit_p)
                r_dot = 9 if is_last else 7
                draw.ellipse(
                    (px - r_dot, py - r_dot, px + r_dot, py + r_dot),
                    fill=(250, 212, 132, int(252 * lit_p)) if is_last else (238, 152, 102, int(248 * lit_p)),
                    outline=(255, 248, 232, int(245 * lit_p)),
                    width=2,
                )
                draw_map_label(
                    draw,
                    (px + off[0], py + off[1]),
                    name,
                    font_major if is_last else font_city,
                    (254, 240, 204, int(252 * lit_p)),
                    anchor=anc,
                )

        composed = Image.alpha_composite(canvas, overlay).convert("RGB")

        # 运镜：先略贴近全线中心（1.08），平滑拉远展露整条东—西长征全线（1.00）。
        p_cam = ease_out(t)
        zoom = 1.08 - 0.08 * p_cam
        cw, ch = WIDTH / zoom, HEIGHT / zoom
        left = (WIDTH - cw) * (0.42 + 0.08 * p_cam)
        top = (HEIGHT - ch) * (0.36 + 0.14 * p_cam)
        composed = composed.resize((WIDTH, HEIGHT), Image.Resampling.BICUBIC, box=(left, top, left + cw, top + ch))

        frames.append(composed)
    return frames


def create_edge_vignette_png(dst_png: Path) -> None:
    """上下柔和影调保护膜：护航顶栏标题清晰度与底字幕后排可读性。"""
    y = np.linspace(0.0, 1.0, HEIGHT, dtype=np.float32)
    top_a = np.clip((0.19 - y) / 0.19, 0.0, 1.0) ** 1.65 * 0.50
    bot_a = np.clip((y - 0.77) / 0.23, 0.0, 1.0) ** 1.55 * 0.62
    alpha = np.clip(np.maximum(top_a, bot_a) * 255.0, 0, 255).astype("uint8")
    rgba = np.zeros((HEIGHT, WIDTH, 4), dtype="uint8")
    rgba[:, :, 0] = 10
    rgba[:, :, 1] = 12
    rgba[:, :, 2] = 13
    rgba[:, :, 3] = alpha[:, None]
    Image.fromarray(rgba, mode="RGBA").save(dst_png)


def render_video_clip(src: Path, dst: Path, start_sec: float, frames: int, vf_extra: str = "", overlay_fn=None) -> None:
    chain = [
        f"fps={FPS}",
        f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=increase:flags=lanczos:out_color_matrix=bt709:out_range=tv",
        f"crop={WIDTH}:{HEIGHT}",
        "setsar=1",
        f"trim=end_frame={frames}",
        "setpts=PTS-STARTPTS",
    ]
    if vf_extra:
        chain.append(vf_extra)

    if overlay_fn is None:
        chain.append("format=yuv420p")
        cmd = FFMPEG + [
            "-ss", f"{start_sec:.6f}", "-i", str(src),
            "-an", "-vf", ",".join(chain), "-frames:v", str(frames),
            "-c:v", "libx264", "-crf", "12", "-preset", "veryfast",
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
            "-threads", "4", str(dst),
        ]
        subprocess.run(cmd, check=True)
        return

    # 流式解码原片并在内存中叠加矢量动画后编码（用于序幕动态主标题卡与地标牌）。
    dec_chain = chain + ["scale=in_color_matrix=bt709:in_range=tv:out_range=full,format=rgb24"]
    dec_cmd = FFMPEG + [
        "-ss", f"{start_sec:.6f}", "-i", str(src),
        "-an", "-vf", ",".join(dec_chain), "-frames:v", str(frames),
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    enc_cmd = FFMPEG + [
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{WIDTH}x{HEIGHT}", "-r", str(FPS), "-i", "-",
        "-vf", "scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p",
        "-c:v", "libx264", "-crf", "10", "-preset", "veryfast",
        "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
        "-threads", "4", str(dst),
    ]
    frame_bytes = WIDTH * HEIGHT * 3
    with subprocess.Popen(dec_cmd, stdout=subprocess.PIPE) as dec, subprocess.Popen(enc_cmd, stdin=subprocess.PIPE) as enc:
        assert dec.stdout is not None and enc.stdin is not None
        for idx in range(frames):
            buf = dec.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            im = Image.frombytes("RGB", (WIDTH, HEIGHT), buf)
            im = overlay_fn(im, idx, frames)
            enc.stdin.write(im.tobytes())
        enc.stdin.close()
        if dec.wait() or enc.wait():
            raise RuntimeError(f"流式动效叠加失败：{src}")


def compute_shot_specs() -> list[dict]:
    half = XFADE_FRAMES // 2
    specs = []
    for idx, (name, t0, t1) in enumerate(TIMELINE_CUTS):
        f0 = round(t0 * FPS)
        f1 = round(t1 * FPS)
        pad_left = 0 if idx == 0 else half
        pad_right = 0 if idx == len(TIMELINE_CUTS) - 1 else half
        frames = (f1 - f0) + pad_left + pad_right
        specs.append({
            "index": idx,
            "name": name,
            "t0": t0,
            "t1": t1,
            "f0": f0,
            "f1": f1,
            "frames": frames,
            "shot_start_sec": (f0 - pad_left) / FPS,
        })
    total = sum(s["frames"] for s in specs) - XFADE_FRAMES * (len(specs) - 1)
    if total != TOTAL_FRAMES:
        raise RuntimeError(f"分镜总帧数 {total} != 目标 {TOTAL_FRAMES}")
    return specs


def render_all_shots(work: Path, sources: dict[str, Path]) -> list[tuple[dict, Path]]:
    specs = compute_shot_specs()
    rendered: list[tuple[dict, Path]] = []

    for s in specs:
        name = s["name"]
        frames = s["frames"]
        dst = work / f"shot-{s['index']:02d}-{name}.mkv"

        if name == "opening-terrain":
            # 首 0.58s 严格原图静止对齐首帧，随后向赣南中央苏区缓推并亮起定位微芒波纹。
            def terrain_overlay(frame: Image.Image, idx: int, total: int) -> Image.Image:
                if idx < 15:
                    return frame
                elapsed = (idx - 15) / FPS
                overlay = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
                draw = ImageDraw.Draw(overlay)
                # 与 zoom 推近同步微调于都中心坐标，视觉上紧贴赣南山脉。
                p = ease((idx - 14) / max(1, total - 15))
                zoom = 1.0 + 0.115 * p
                fx, fy = 0.593, 0.557
                # 围绕 focus=(fx, fy) 缩放后，该点在屏幕上的位置保持精确不变！
                px, py = fx * WIDTH, fy * HEIGHT
                a = ease(elapsed / 0.35)
                draw_once_burst(draw, px, py, elapsed, (242, 200, 122), duration=1.25, max_radius=46.0)
                draw.ellipse((px - 10, py - 10, px + 10, py + 10), fill=(242, 198, 118, int(92 * a)))
                draw.ellipse((px - 4, py - 4, px + 4, py + 4), fill=(255, 238, 196, int(235 * a)))
                return Image.alpha_composite(frame.convert("RGBA"), overlay).convert("RGB")

            seq = render_ken_burns(
                ASSETS / "terrain.jpg",
                frames,
                zoom_start=1.0,
                zoom_end=1.115,
                focus_start=(0.593, 0.557),
                hold_start_frames=14,
                overlay_fn=terrain_overlay,
            )
            write_frames_video(dst, seq)

        elif name == "misty-mountains":
            # 纯净苍茫云山航拍（序幕主纪年与中央苏区标牌由前端响应式安全区叠层同步渲染，彻底避免非 16:9 视口裁切）。
            render_video_clip(
                sources["mixkit-misty-mountains-100190.mp4"],
                dst,
                start_sec=1.2,
                frames=frames,
                vf_extra="eq=brightness=-0.10:contrast=1.09:saturation=0.56,colorbalance=bs=0.05:gs=0.02:rs=-0.03",
            )

        elif name == "map-yudu-west":
            write_frames_video(dst, render_map_yudu_west(frames))

        elif name == "yudu-prep":
            render_video_clip(
                ASSETS / "yudu-preparation.mp4",
                dst,
                start_sec=0.0,
                frames=frames,
                vf_extra="eq=brightness=-0.02:contrast=1.03:saturation=0.92",
            )

        elif name == "yudu-bridge-3d":
            # 本课 3D 于都河岸黄昏架桥航拍（替代原违和欧美独木舟实拍）。
            render_video_clip(
                RECORDED_3D / "3d-yudu-bridge.mp4",
                dst,
                start_sec=0.2,
                frames=frames,
                vf_extra="eq=brightness=-0.03:contrast=1.08:saturation=0.92",
            )

        elif name == "yudu-night-3d":
            # 本课 3D 于都河岸星月夜渡低空滑移，与实景浮桥过河形成远近双机位衔接。
            render_video_clip(
                RECORDED_3D / "3d-yudu-night.mp4",
                dst,
                start_sec=0.2,
                frames=frames,
                vf_extra="eq=brightness=-0.02:contrast=1.07:saturation=0.94",
            )

        elif name == "yudu-crossing":
            render_video_clip(
                ASSETS / "yudu.mp4",
                dst,
                start_sec=0.5,
                frames=frames,
                vf_extra="eq=brightness=-0.01:contrast=1.03:saturation=0.95",
            )

        elif name == "karst-river":
            render_video_clip(
                sources["pexels-karst-river-36932826.mp4"],
                dst,
                start_sec=2.0,
                frames=frames,
                vf_extra="eq=brightness=-0.09:contrast=1.10:saturation=0.56,colorbalance=bs=0.05:gs=0.01:rs=-0.03",
            )

        elif name == "xiang-valley":
            render_video_clip(
                ASSETS / "xiang.mp4",
                dst,
                start_sec=0.5,
                frames=frames,
                vf_extra="eq=brightness=-0.05:contrast=1.06:saturation=0.84",
            )

        elif name == "xiang-rain":
            # 细雨砸落暗色江面泛起层层涟漪，烘托湘江惨重代价。
            render_video_clip(
                sources["mixkit-rain-water-18312.mp4"],
                dst,
                start_sec=2.5,
                frames=frames,
                vf_extra="eq=brightness=-0.12:contrast=1.12:saturation=0.38,colorbalance=bs=0.07:gs=0.02:rs=-0.05",
            )

        elif name == "xiang-crossing-3d":
            # 本课 3D 湘江寒江抢渡高空俯冲（替代原静图缩放与硬烧右侧兵力面板；兵力对比卡由前端响应式安全区叠层渲染）。
            render_video_clip(
                RECORDED_3D / "3d-xiang-crossing.mp4",
                dst,
                start_sec=0.3,
                frames=frames,
                vf_extra="eq=brightness=-0.04:contrast=1.08:saturation=0.88",
            )

        elif name == "liping-rain-roof":
            # 青瓦老墙屋檐落雨动态实拍（贵州黎平标牌交由前端响应式安全区叠层渲染）。
            render_video_clip(
                sources["mixkit-rain-roof-2738.mp4"],
                dst,
                start_sec=0.3,
                frames=frames,
                vf_extra="eq=brightness=-0.11:contrast=1.12:saturation=0.58,colorbalance=bs=0.06:gs=0.02:rs=-0.03",
            )

        elif name == "liping-street":
            def liping_fx(arr: np.ndarray, idx: int, total: int) -> None:
                t_sec = idx / FPS
                f1 = 0.22 + 0.08 * math.sin(t_sec * 4.7) + 0.04 * math.sin(t_sec * 10.3)
                f2 = 0.18 + 0.07 * math.sin(t_sec * 5.3 + 1.4)
                f3 = 0.20 + 0.07 * math.sin(t_sec * 4.1 + 2.6)
                apply_radial_glow(arr, 0.144, 0.294, 0.075, (255, 194, 102), f1)
                apply_radial_glow(arr, 0.407, 0.454, 0.050, (255, 188, 98), f2)
                apply_radial_glow(arr, 0.909, 0.497, 0.060, (255, 190, 100), f3)

            def liping_overlay(frame: Image.Image, idx: int, total: int) -> Image.Image:
                return draw_floating_motes(frame, idx / FPS, count=14, color_rgb=(255, 224, 166), max_alpha=68, seed=42)

            seq = render_ken_burns(
                ASSETS / "liping-street.jpg",
                frames,
                zoom_start=1.00,
                zoom_end=1.06,
                focus_start=(0.50, 0.56),
                focus_end=(0.58, 0.50),
                grade_rgb=(0.95, 0.93, 0.91),
                brightness=-7.0,
                pre_crop_fx=liping_fx,
                overlay_fn=liping_overlay,
            )
            write_frames_video(dst, seq)

        elif name == "map-liping-turn":
            write_frames_video(dst, render_map_liping_turn(frames, s["shot_start_sec"]))

        elif name == "canyon-aerial":
            render_video_clip(
                sources["mixkit-river-canyon-41401.mp4"],
                dst,
                start_sec=4.0,
                frames=frames,
                vf_extra="eq=brightness=-0.11:contrast=1.11:saturation=0.45,colorbalance=bs=0.07:gs=0.02:rs=-0.05",
            )

        elif name == "shore-rapids":
            render_video_clip(
                sources["pexels-shore.mp4"],
                dst,
                start_sec=2.0,
                frames=frames,
                vf_extra="eq=brightness=-0.12:contrast=1.12:saturation=0.52,colorbalance=bs=0.06:gs=0.01:rs=-0.04",
            )

        elif name == "wujiang-march":
            mist = make_seamless_mist(1440, 340, seed=63)

            def wujiang_fx(arr: np.ndarray, idx: int, total: int) -> None:
                t_sec = idx / FPS
                apply_drifting_mist(arr, mist, 0.16, 0.54, t_sec, speed_px_per_sec=-26.0, opacity=0.26, tint_rgb=(188, 204, 214), x_mask_range=(0.28, 0.95))

            seq = render_ken_burns(
                ASSETS / "wujiang.jpg",
                frames,
                zoom_start=1.085,
                zoom_end=1.00,
                focus_start=(0.72, 0.58),
                focus_end=(0.45, 0.52),
                grade_rgb=(0.91, 0.94, 0.97),
                brightness=-8.0,
                pre_crop_fx=wujiang_fx,
            )
            write_frames_video(dst, seq)

        elif name == "zunyi-hall-3d":
            # 本课 3D 遵义材料厅暮色庭院一镜穿门运镜（替代原静态会址老照片缩放，贵州遵义标牌交由前端安全区叠层）。
            render_video_clip(
                RECORDED_3D / "3d-zunyi-hall.mp4",
                dst,
                start_sec=0.3,
                frames=frames,
                vf_extra="eq=brightness=-0.02:contrast=1.06:saturation=0.94",
            )

        elif name == "zunyi-meeting":
            render_video_clip(
                ASSETS / "zunyi.mp4",
                dst,
                start_sec=0.5,
                frames=frames,
                vf_extra="eq=brightness=-0.01:contrast=1.04:saturation=0.95",
            )

        elif name == "zunyi-desk-3d":
            # 本课精修 3D 会议桌实景特写（煤油灯下翻开手记、解绳揭封、展开路线图），自然呼应“集中解决军事和组织问题”。
            render_video_clip(
                RECORDED_3D / "3d-zunyi-desk.mp4",
                dst,
                start_sec=0.8,
                frames=frames,
                vf_extra="eq=brightness=-0.01:contrast=1.06:saturation=0.96",
            )

        elif name == "map-turning-recap":
            # 四站流光全线回望动态沙盘（底部时间轴交由前端响应式叠层渲染）。
            write_frames_video(dst, render_map_turning_recap(frames))

        elif name == "dawn-sunrise":
            # 晨雾山林破晓日出实拍航拍（彻底替代原静图 zunyi-dawn.jpg），压稳左上高光护航顶栏标题。
            render_video_clip(
                sources["mixkit-sunrise-mist-28339.mp4"],
                dst,
                start_sec=11.0,
                frames=frames,
                vf_extra="eq=brightness=-0.12:contrast=1.08:saturation=0.86,colorbalance=rs=0.05:gs=0.02:bs=-0.04",
            )

        elif name == "ending-assembly":
            hold_end = round(OUTRO_STILL_SECONDS * FPS)
            move_end = frames - hold_end

            def assembly_fx(arr: np.ndarray, idx: int, total: int) -> None:
                # 仅在归位前段给左上门檐马灯微加一丝柔和灯火，随后彻底收归 0 确保尾帧纯净对齐。
                fade = 1.0 - ease((idx - (move_end - 14)) / 14.0)
                if fade > 0.01:
                    flicker = (0.18 + 0.06 * math.sin(idx * 0.35)) * fade
                    apply_radial_glow(arr, 0.164, 0.263, 0.070, (255, 194, 104), flicker)

            seq = render_ken_burns(
                ASSETS / "yudu-assembly.jpg",
                frames,
                zoom_start=1.045,
                zoom_end=1.00,
                focus_start=(0.38, 0.52),
                focus_end=(0.50, 0.50),
                hold_end_frames=hold_end,
                pre_crop_fx=assembly_fx,
            )
            write_frames_video(dst, seq)

        else:
            raise ValueError(f"未知镜头：{name}")

        rendered.append((s, dst))
    return rendered


def mix_audio(work: Path, voice_wav: Path, sources: dict[str, Path], dst_wav: Path) -> None:
    """三轨纪录片混音：沉稳男声（EQ+压缩）+ 大提琴配乐（旁白侧链闪避）+ 河段限定水声。"""
    music_src = sources["sb-hiraeth.mp3"]
    shore_src = sources["pexels-shore.mp4"]

    water_env = (
        "volume='"
        "0.085*min(1,max(0,(t-16.5)/1.4))*min(1,max(0,(26.6-t)/1.2))"
        "+0.095*min(1,max(0,(t-26.2)/1.4))*min(1,max(0,(38.3-t)/1.4))"
        "+0.145*min(1,max(0,(t-64.8)/1.4))*min(1,max(0,(72.4-t)/1.1))"
        "':eval=frame"
    )

    filter_complex = ";".join([
        f"[0:a]aresample={RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
        "highpass=f=75,equalizer=f=155:t=q:w=1.2:g=2.5,equalizer=f=6800:t=q:w=1.5:g=-2.2,"
        "compand=attacks=0.015:decays=0.18:points=-70/-70|-26/-21|-12/-11|0/-3,"
        "volume=1.18,asplit=2[voice_main][voice_sc]",
        f"[1:a]aresample={RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
        f"atrim=start={MUSIC_START_SECONDS}:duration={TOTAL_SECONDS},asetpts=PTS-STARTPTS,"
        f"afade=t=in:st=0:d=1.6,afade=t=out:st={TOTAL_SECONDS - 3.4:.3f}:d=3.4,"
        "volume=0.25[music_raw]",
        "[music_raw][voice_sc]sidechaincompress=threshold=0.022:ratio=4.2:attack=45:release=420:makeup=1[music_duck]",
        f"[2:a]aresample={RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
        f"atrim=duration={TOTAL_SECONDS},asetpts=PTS-STARTPTS,"
        f"highpass=f=110,lowpass=f=3000,{water_env}[water_bed]",
        "[voice_main][music_duck][water_bed]amix=inputs=3:normalize=0:duration=first,"
        "alimiter=limit=0.90:attack=5:release=60[mix]",
    ])

    subprocess.run(
        FFMPEG + [
            "-i", str(voice_wav),
            "-i", str(music_src),
            "-stream_loop", "8", "-i", str(shore_src),
            "-filter_complex", filter_complex,
            "-map", "[mix]", "-ar", str(RATE), "-ac", "2", "-c:a", "pcm_s16le",
            "-t", f"{TOTAL_SECONDS:.6f}", str(dst_wav),
        ],
        check=True,
    )


def assemble_final(work: Path, rendered: list[tuple[dict, Path]], ass_path: Path, mixed_wav: Path, target: Path) -> None:
    vignette_png = work / "edge-vignette.png"
    create_edge_vignette_png(vignette_png)

    inputs: list[str] = []
    for _, path in rendered:
        inputs.extend(["-i", str(path)])
    vig_idx = len(rendered)
    inputs.extend(["-loop", "1", "-framerate", str(FPS), "-i", str(vignette_png)])
    aud_idx = vig_idx + 1
    inputs.extend(["-i", str(mixed_wav)])

    filters: list[str] = []
    for idx in range(len(rendered)):
        filters.append(f"[{idx}:v]fps={FPS},settb=1/{FPS},setpts=PTS-STARTPTS,format=yuv420p[s{idx}]")

    cur_label = "s0"
    cur_frames = rendered[0][0]["frames"]
    xfade_sec = XFADE_FRAMES / FPS
    for idx in range(1, len(rendered)):
        offset_frames = cur_frames - XFADE_FRAMES
        out_label = f"x{idx}"
        filters.append(
            f"[{cur_label}][s{idx}]xfade=transition=fade:duration={xfade_sec:.6f}:"
            f"offset={offset_frames / FPS:.6f}[{out_label}]"
        )
        cur_label = out_label
        cur_frames = offset_frames + rendered[idx][0]["frames"]

    if cur_frames != TOTAL_FRAMES:
        raise RuntimeError(f"叠化串联后总帧数 {cur_frames} != {TOTAL_FRAMES}")

    vig_end = TOTAL_SECONDS - OUTRO_STILL_SECONDS - 0.15
    filters.append(
        f"[{vig_idx}:v]format=rgba,trim=end_frame={TOTAL_FRAMES},setpts=PTS-STARTPTS,"
        f"fade=t=in:st=0.65:d=0.65:alpha=1,fade=t=out:st={vig_end - 0.70:.3f}:d=0.70:alpha=1[vig]"
    )
    filters.append(
        f"[{cur_label}][vig]overlay=0:0:shortest=1:enable='between(t,0.65,{vig_end:.3f})',"
        f"trim=end_frame={TOTAL_FRAMES},setpts=PTS-STARTPTS,format=yuv420p[picture]"
    )

    credits = "\n".join(source.credit for source in SOURCES)
    end_zone_start = TOTAL_FRAMES - round(OUTRO_STILL_SECONDS * FPS) - 6
    zones = f"zones=0,20,crf=15/{end_zone_start},{TOTAL_FRAMES - 1},crf=15"
    subprocess.run(
        FFMPEG + ["-filter_complex_threads", "4"] + inputs + [
            "-filter_complex", ";".join(filters),
            "-map", "[picture]", "-map", f"{aud_idx}:a",
            "-c:v", "libx264", "-crf", "24", "-preset", "slow", "-g", "72",
            "-maxrate", "3600k", "-bufsize", "6000k", "-x264-params", zones,
            "-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", "-color_range", "tv",
            "-threads", "4",
            "-c:a", "aac", "-b:a", "96k", "-ar", str(RATE), "-ac", "2",
            "-movflags", "+faststart",
            "-metadata", "title=从于都到遵义 · 开场",
            "-metadata", f"comment={credits}",
            str(target),
        ],
        check=True,
        cwd=work,
    )


def verify_output(target: Path) -> tuple[float, float]:
    info = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size:stream=codec_type,nb_frames,width,height", "-of", "json", str(target),
    ]))
    streams = {s["codec_type"]: s for s in info["streams"]}
    video = streams.get("video")
    audio = streams.get("audio")
    seconds = float(info["format"]["duration"])
    size_mb = int(info["format"]["size"]) / (1024 * 1024)
    if (
        not video or not audio
        or int(video["nb_frames"]) != TOTAL_FRAMES
        or (video["width"], video["height"]) != (WIDTH, HEIGHT)
        or abs(seconds - TOTAL_SECONDS) > 0.08
    ):
        raise RuntimeError(f"开场片参数不符：{video}，时长 {seconds:.3f}s")
    return seconds, size_mb


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=SOURCE_CACHE)
    parser.add_argument("--voice-dir", type=Path, default=VOICE_CACHE)
    parser.add_argument("--download", action="store_true", help="下载并校验外部片源")
    parser.add_argument("--synthesize", action="store_true", help="按 opening-narration.tsv 重新合成男声旁白")
    parser.add_argument("--output", type=Path, default=ASSETS / "opening.mp4")
    args = parser.parse_args()

    sources = prepare_sources(args.source_dir, args.download)
    timeline = prepare_narration(args.voice_dir, args.synthesize)

    with TemporaryDirectory(dir=args.output.resolve().parent) as folder:
        work = Path(folder)
        voice_wav = work / "voice.wav"
        mixed_wav = work / "mixed.wav"
        ass_path = work / "opening.ass"
        candidate = work / "opening.mp4"

        build_voice_track(args.voice_dir, timeline, voice_wav)
        build_subtitles(timeline, ass_path)
        rendered = render_all_shots(work, sources)
        mix_audio(work, voice_wav, sources, mixed_wav)
        assemble_final(work, rendered, ass_path, mixed_wav, candidate)

        seconds, size_mb = verify_output(candidate)
        candidate.replace(args.output)

    print(
        f"开场纪录片生成完毕：{seconds:.2f} 秒，{TOTAL_FRAMES} 帧，{size_mb:.2f} MB，"
        f"含 {len(timeline['cues'])} 句纪实男声、后排字幕、三段暗调动态地图与全片物理动效。"
    )


if __name__ == "__main__":
    main()
