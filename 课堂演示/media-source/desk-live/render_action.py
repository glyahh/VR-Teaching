"""从仓库根目录运行 python -B "课堂演示/media-source/desk-live/render_action.py"。

需要 Blender 4.5.4、Pillow、NumPy 和 PATH 中的 ffmpeg、ffprobe。
默认先生成 MP4，再将同一批姿态另存为已打包的 Blender 动画工程。
--stage render 只渲染，--stage finish 合成并复核 MP4，--stage animation 复建可编辑工程。
相同工程和设置复用已完成的姿态。--threads 控制 Blender 的 CPU 线程数。
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parents[3]
SOURCE = ROOT / "展示材料/遵义会议室精修场景"
BLEND = SOURCE / "会前的桌边.blend"
STILL = SOURCE / "会前的桌边.png"
BLENDER = ROOT / ".march-build/blender-4.5.4-windows-x64/blender.exe"
WORKER = Path(__file__).with_name("action-cycles.py")
WORK = ROOT / ".march-build/desk-live/action"
MOVIE = ROOT / "课堂演示/assets/desk-action.mp4"
ANIMATION = SOURCE / "会前的桌边-翻阅动画.blend"
SIZE = (1280, 720)
SAMPLES = 32


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path, data):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temporary.replace(path)


def render_cache(model_digest):
    settings = [model_digest, digest(WORKER), int(BLENDER.stat().st_mtime), SIZE, SAMPLES, 16]
    key = hashlib.sha256(json.dumps(settings).encode()).hexdigest()[:16]
    return WORK / f"cycles-{key}"


def call_blender(model, script, arguments, threads, log_path):
    cmd = [str(BLENDER), "-b", "--factory-startup", "--disable-autoexec", str(model),
           "-t", str(threads), "--python-exit-code", "1", "-P", str(script), "--", *arguments]
    temp = WORK / "temp"
    temp.mkdir(exist_ok=True)
    env = dict(os.environ, TEMP=str(temp), TMP=str(temp), OPENBLAS_NUM_THREADS="1",
               OMP_NUM_THREADS=str(threads), PYTHONDONTWRITEBYTECODE="1")
    with log_path.open("ab") as log:
        log.write(b"\n")
        log.flush()
        result = subprocess.run(cmd, stdout=log, stderr=subprocess.STDOUT, env=env)
    if result.returncode:
        raise RuntimeError(log_path.read_bytes()[-2200:].decode("utf-8", errors="replace"))


def run_blender(cache, stage, samples, threads, poses=()):
    arguments = [stage, str(cache), "--samples", str(samples)]
    if poses:
        arguments.extend(["--poses", *map(str, poses)])
    call_blender(BLEND, WORKER, arguments, threads, cache / f"{stage}.log")


def rgb(path):
    with Image.open(path) as image:
        return np.array(image.convert("RGB"))


def coherent_change(delta, radius):
    # 先平滑带符号的差值，异号采样噪声相消，留下成片投影和间接光变化。
    change = np.zeros(delta.shape[:2], dtype=np.float32)
    for channel in delta.transpose(2, 0, 1):
        positive = Image.fromarray(np.maximum(channel, 0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))
        negative = Image.fromarray(np.maximum(-channel, 0).astype(np.uint8)).filter(ImageFilter.GaussianBlur(radius))
        np.maximum(change, np.abs(np.asarray(positive, dtype=np.int16) - np.asarray(negative)), out=change)
    return change


def find_crop(cache):
    info = read_json(cache / "geometry.json")
    left, top, right, bottom = info["survey_box"]
    baseline = rgb(cache / "survey/00.png").astype(np.int16)
    if baseline.shape[:2] != ((bottom - top) // 2, (right - left) // 2):
        raise ValueError("半分辨率采样区域与相机像素不符")
    with np.load(cache / "projection.npz") as data:
        pixels = data["pixels"].reshape(-1, 2)
        low, high = pixels.min(axis=0), pixels.max(axis=0)
    peak_change = np.zeros(baseline.shape[:2], np.float32)
    for index in (15, 25, 33, info["last_pose"]):
        delta = rgb(cache / "survey" / f"{index:02d}.png") - baseline
        # 半分辨率预采样中连续超过三个色阶的照度差也纳入正式渲区。
        np.maximum(peak_change, coherent_change(delta, 3), out=peak_change)
    active = peak_change > 3
    y, x = np.nonzero(active)
    low = np.minimum(low, [left + 2 * x.min(), top + 2 * y.min()])
    high = np.maximum(high, [left + 2 * (x.max() + 1), top + 2 * (y.max() + 1)])
    low = np.maximum([left, top], np.floor((low - 24) / 4) * 4)
    high = np.minimum([right, bottom], np.ceil((high + 24) / 4) * 4)
    box = [int(v) for v in (*low, *high)]
    x0, y0, x1, y1 = box
    outside = np.ones(active.shape, bool)
    outside[(y0-top)//2:(y1-top)//2, (x0-left)//2:(x1-left)//2] = False
    data = {"survey_box": info["survey_box"], "render_box": box,
            "survey_support_fullres_pixels": int(active.sum()) * 4, "guard_pixels": 24,
            "max_coherent_change_outside_at_half_resolution": int(peak_change[outside].max(initial=0))}
    write_json(cache / "crop.json", data)
    return box


def render_poses(cache, threads):
    cache.mkdir(parents=True, exist_ok=True)
    survey = [cache / "survey" / f"{pose:02d}.png" for pose in (0, 15, 25, 33, 45)]
    if not all(p.is_file() for p in [*survey, cache / "geometry.json", cache / "projection.npz"]):
        run_blender(cache, "survey", 16, threads)
    box = find_crop(cache)
    last = read_json(cache / "geometry.json")["last_pose"]
    print(f"正式局部渲区 {box}，{SAMPLES} 采样，{threads} 线程", flush=True)
    for group in ([last // 2], [0], list(range(1, last + 1))):
        missing = [i for i in group if not (cache / "render" / f"{i:02d}.png").is_file()]
        if missing:
            start = time.monotonic()
            run_blender(cache, "render", SAMPLES, threads, missing)
            if len(missing) == 1:
                print(f"姿态 {missing[0]:02d} 试渲 {time.monotonic() - start:.1f} 秒", flush=True)


def reference(camera):
    with Image.open(STILL) as image:
        stored = image.info.get("Camera", "")
        if stored != camera:
            stored = stored.encode("latin1").decode("utf-8")
        if stored != camera or image.size != (1920, 1080):
            raise ValueError("主视图 PNG 的相机或像素尺寸不符")
        return np.array(image.convert("RGB").resize(SIZE, Image.Resampling.LANCZOS))


def mask_of_faces(start, current, faces, box):
    left, top, right, bottom = box
    mask = Image.new("L", (right - left, bottom - top))
    draw = ImageDraw.Draw(mask)
    # 只有实际越过亚像素覆盖范围的面片需要替换底片；固定装订带继续用原图。
    travel = np.linalg.norm(current - start, axis=1)
    moving = faces[travel[faces].max(axis=1) > 0.40]
    for position in (start, current):
        points = (position - [left, top]).tolist()
        for a, b, c, d in moving:
            draw.polygon([tuple(points[a]), tuple(points[b]), tuple(points[c]), tuple(points[d])], fill=255)
    # 只在投影轮廓给抗锯齿和景深留出两三个像素。
    return np.asarray(mask.filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.GaussianBlur(1.15)),
                      dtype=np.float32) / 255


def ramp(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


def pixel_box(mask, origin):
    bounds = Image.fromarray(mask).getbbox()
    if bounds is None:
        return None
    x, y = origin
    return [bounds[0] + x, bounds[1] + y, bounds[2] + x, bounds[3] + y]


def compose(cache, plate, box, peak):
    left, top, right, bottom = box
    original = plate[top:bottom, left:right]
    closed = rgb(cache / "render/00.png").astype(np.int16)
    if original.shape != closed.shape:
        raise ValueError("正式渲区尺寸与底片不符")
    with np.load(cache / "projection.npz") as data:
        pixels, faces = data["pixels"], data["faces"]
    h, w = closed.shape[:2]
    y, x = np.ogrid[:h, :w]
    edge_distance = np.minimum(np.minimum(x, w-1-x), np.minimum(y, h-1-y))
    guard = ramp((edge_distance - 1) / 14)
    patches = [original]
    shadows = []
    overlay = None
    for index in range(1, len(pixels)):
        current = rgb(cache / "render" / f"{index:02d}.png")
        delta = current.astype(np.int16) - closed
        mesh = mask_of_faces(pixels[0], pixels[index], faces, box)
        # 原桌面保留自身纹理，仅加同种子开合两次实渲的照度差。
        # 平滑只参与阴影边界估计；轮廓以内直接使用该姿态的实渲像素。
        magnitude = coherent_change(delta, 2)
        support = ramp((magnitude - 1) / 3) * guard
        lighting = original + delta * support[:, :, None]
        combined = lighting + (current - lighting) * mesh[:, :, None]
        patches.append(np.rint(combined).clip(0, 255).astype(np.uint8))
        # 排除物体前后轮廓和抗锯齿边后，在固定接收面上计量实际亮、暗变化。
        luma = delta @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        receiver = (mesh < 0.01) & (support > 0.90)
        darker = receiver & (luma <= -6)
        lighter = receiver & (luma >= 6)
        shadows.append({"pose": index, "darker_px": int(darker.sum()), "lighter_px": int(lighter.sum()),
                        "receiver_delta_box": pixel_box(darker | lighter, (left, top))})
        if index == peak:
            # 原纸面的中排顶点投影，在同一相机里量弯曲弧与两端连线的距离。
            stride = int(faces[0, 3] - faces[0, 0])
            if len(pixels[index]) % stride:
                raise ValueError("封面横排拓扑改变")
            strip = pixels[index].reshape(-1, stride, 2)[len(pixels[index]) // stride // 2]
            chord = strip[-1] - strip[0]
            distances = np.abs((strip[:, 0] - strip[0, 0]) * chord[1]
                               - (strip[:, 1] - strip[0, 1]) * chord[0]) / np.linalg.norm(chord)
            overlay = (darker, lighter, strip, float(distances.max()))
    return patches, closed, shadows, overlay


def timeline(last):
    sequence = [0] * 12 + list(range(1, last + 1)) + [last] * 25 + list(range(last - 1, -1, -1))
    if len(sequence) >= 144:
        raise ValueError("姿态数量超过六秒时间线")
    return sequence + [0] * (144 - len(sequence))


def encode(candidate, plate, box, patches, sequence):
    left, top, right, bottom = box
    frame = plate.copy()
    cmd = ["ffmpeg", "-v", "error", "-y", "-filter_threads", "1", "-f", "rawvideo",
           "-pix_fmt", "rgb24", "-s:v", "1280x720", "-framerate", "24", "-i", "pipe:0", "-an",
           "-vf", "scale=in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p",
           "-c:v", "libx264", "-preset", "medium", "-qp", "14", "-threads", "3", "-g", "144",
           "-bf", "0", "-sc_threshold", "0", "-forced-idr", "1", "-force_key_frames", "expr:eq(n,143)",
           "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1",
           "-color_range", "tv", "-movflags", "+faststart", str(candidate)]
    log_path = WORK / "encode.log"
    with log_path.open("wb") as log, subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=log) as encoder:
        try:
            for n, pose in enumerate(sequence):
                frame[top:bottom, left:right] = patches[pose]
                if n in (0, len(sequence) - 1) and not np.array_equal(frame, plate):
                    raise ValueError("编码输入的首尾帧未还原原静帧")
                encoder.stdin.write(frame.tobytes())
        finally:
            encoder.stdin.close()
        if encoder.wait():
            raise RuntimeError(log_path.read_text(encoding="utf-8", errors="replace"))


def decode_frames(candidate, indices):
    indices = sorted(set(indices))
    select = "+".join(f"eq(n\\,{i})" for i in indices)
    filters = f"select={select},scale=in_color_matrix=bt709:in_range=tv:out_range=pc,format=rgb24"
    data = subprocess.check_output([
        "ffmpeg", "-v", "error", "-threads", "2", "-filter_threads", "1", "-i", str(candidate),
        "-map", "0:v:0", "-vf", filters, "-fps_mode", "passthrough", "-an", "-f", "rawvideo",
        "-threads", "1", "pipe:1",
    ])
    frames = np.frombuffer(data, np.uint8).reshape(len(indices), SIZE[1], SIZE[0], 3)
    return dict(zip(indices, frames))


def errors(actual, expected):
    delta = actual.astype(np.int16) - expected.astype(np.int16)
    absolute = np.abs(delta)
    mse = np.square(delta.astype(np.float32)).mean()
    return {"mean_abs_rgb": round(float(absolute.mean()), 4),
            "p95_abs_channel": int(np.percentile(absolute, 95)), "max_abs_channel": int(absolute.max()),
            "psnr_db": round(float(10 * np.log10(255**2 / mse)), 3) if mse else None,
            "pixels_max_channel_ge12": int((absolute.max(axis=2) >= 12).sum())}


def registration(closed, plate):
    # 用局部原始重渲独立检查两条路径的取景、裁切原点和像素中心。
    h, w = closed.shape[:2]
    reference_patch = plate.astype(np.int16)
    candidates = []
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            offset = reference_patch[3+dy:h-3+dy, 3+dx:w-3+dx]
            candidates.append((float(np.abs(closed[3:-3, 3:-3] - offset).mean()), dx, dy))
    _, dx, dy = min(candidates)
    return [dx, dy]


def probe_movie(candidate):
    metadata = json.loads(subprocess.check_output([
        "ffprobe", "-v", "error", "-count_frames", "-show_entries",
        "format=duration:stream=codec_type,codec_name,width,height,pix_fmt,avg_frame_rate,nb_read_frames,"
        "color_space,color_transfer,color_range", "-of", "json", str(candidate),
    ]))
    stream, = metadata["streams"]
    expected = {"codec_type": "video", "codec_name": "h264", "width": SIZE[0], "height": SIZE[1],
                "pix_fmt": "yuv420p", "avg_frame_rate": "24/1", "nb_read_frames": "144"}
    if any(stream.get(k) != v for k, v in expected.items()) or float(metadata["format"]["duration"]) != 6:
        raise ValueError(f"视频交付规格不符 {metadata}")
    return metadata


def font(size):
    directory = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    for filename in ("msyh.ttc", "simhei.ttf"):
        if (directory / filename).exists():
            return ImageFont.truetype(str(directory / filename), size)
    return ImageFont.load_default(size=size)


def proof_sheets(plate, decoded, cards, box, peak_frame, overlay, stats):
    left, top, right, bottom = box
    panel_w = 460
    panel_h = round(panel_w * (bottom - top) / (right - left))
    gap, caption = 12, 40
    ink, paper = "#24211e", "#f5f2ec"
    sheet = Image.new("RGB", (3 * panel_w + 4 * gap, 2 * (panel_h + caption) + 3 * gap), paper)
    draw = ImageDraw.Draw(sheet)
    for i, (n, title) in enumerate(cards):
        x, y = gap + (i % 3) * (panel_w + gap), gap + (i // 3) * (panel_h + caption + gap)
        view = Image.fromarray(decoded[n]).crop(tuple(box)).resize((panel_w, panel_h), Image.Resampling.LANCZOS)
        sheet.paste(view, (x, y))
        draw.text((x + 3, y + panel_h + 5), f"{n/24:.2f} 秒   {title}", font=font(20), fill=ink)
    sheet.save(WORK / "action-proof.png")

    darker, lighter, strip, sag = overlay
    view = Image.fromarray(decoded[peak_frame]).crop(tuple(box))
    marked = view.copy()
    for support, color in ((darker, (39, 163, 236)), (lighter, (250, 196, 73))):
        mask = Image.fromarray(support.astype(np.uint8) * 255).filter(ImageFilter.MedianFilter(3))
        marked.paste(color, (0, 0), mask.point(lambda v: v // 2))
    line = ImageDraw.Draw(marked)
    points = [(float(x - left), float(y - top)) for x, y in strip]
    line.line([points[0], points[-1]], fill="#cc7387", width=1)
    line.line(points, fill="#e1fff4", width=3)
    w, h = view.size
    proof = Image.new("RGB", (2*w + 3*gap, h + 70), paper)
    proof.paste(view, (gap, gap))
    proof.paste(marked, (w + 2*gap, gap))
    draw = ImageDraw.Draw(proof)
    draw.text((gap, h+19), f"{peak_frame/24:.2f} 秒   成片解码", font=font(20), fill=ink)
    draw.text((w+2*gap, h+18), f"蓝为变暗，黄为变亮。白线纸弧距弦最远 {sag:.1f} 像素", font=font(18), fill=ink)
    proof.save(WORK / "shadow-proof.png")

    width, height = 404, 227
    triptych = Image.new("RGB", (3*width+4*gap, height+66), paper)
    draw = ImageDraw.Draw(triptych)
    delta = np.abs(decoded[0].astype(np.int16) - plate.astype(np.int16))
    for i, (picture, label) in enumerate(((plate, "原主视图等比缩至 720p"),
                                           (decoded[0], "视频首帧，末帧解码相同"),
                                           (np.minimum(delta*12, 255).astype(np.uint8),
                                            f"绝对色差 ×12，平均 {stats['mean_abs_rgb']:.2f} / 255"))):
        x = gap + i*(width+gap)
        triptych.paste(Image.fromarray(picture).resize((width, height), Image.Resampling.LANCZOS), (x, gap))
        draw.text((x, height+22), label, font=font(18), fill=ink)
    triptych.save(WORK / "closure-proof.png")


def finish(cache, source_hash):
    info = read_json(cache / "geometry.json")
    box = read_json(cache / "crop.json")["render_box"]
    left, top, right, bottom = box
    plate = reference(info["camera"])
    plate_crop = plate[top:bottom, left:right]
    peak = max(range(len(info["poses"])), key=lambda i: info["poses"][i]["max_lift_m"])
    patches, closed, shadows, overlay = compose(cache, plate, box, peak)
    distinct = len({hashlib.sha256(patch.tobytes()).digest() for patch in patches})
    if distinct != len(info["poses"]):
        raise ValueError("独立姿态存在重复画面")
    alignment = registration(closed, plate_crop)
    if alignment != [0, 0]:
        raise ValueError(f"渲区与底片的像素偏移 {alignment}")
    sequence = timeline(info["last_pose"])
    candidate = WORK / "desk-action.candidate.mp4"
    encode(candidate, plate, box, patches, sequence)
    metadata = probe_movie(candidate)
    last = info["last_pose"]
    hold = sequence.index(last) + sequence.count(last) // 2
    peak_frame = sequence.index(peak)
    cards = [(0, "闭合"), (sequence.index(15), "外角抬起"), (peak_frame, "翻到最高处"),
             (hold, "停留，内页露出"), (len(sequence)-1-sequence[::-1].index(20), "放回"), (143, "合拢")]
    decoded = decode_frames(candidate, [frame for frame, _ in cards])
    first, end = decoded[0], decoded[143]
    still_error = errors(first, plate)
    if not np.array_equal(first, end) or still_error["mean_abs_rgb"] > 2:
        raise ValueError(f"首尾闭合校验失败 {errors(first, end)} {still_error}")
    action = errors(decoded[hold], first)
    if action["pixels_max_channel_ge12"] < 20000 or max(s["darker_px"] for s in shadows) < 500:
        raise ValueError("未检测到足够的翻页或接收面阴影变化")
    outside = np.ones(plate.shape[:2], bool)
    outside[top:bottom, left:right] = False
    outside_difference = np.abs(decoded[hold].astype(np.int16) - first.astype(np.int16)).max(axis=2)[outside]
    if max(p["spine_max_displacement_m"] for p in info["poses"]) != 0 or digest(BLEND) != source_hash:
        raise ValueError("固定带位移或源工程发生变化")
    proof_sheets(plate, decoded, cards, box, peak_frame, overlay, still_error)
    for image, name in ((plate, "reference-720"), (first, "decoded-first"), (end, "decoded-last")):
        Image.fromarray(image).save(WORK / (name + ".png"))
    metrics = {
        "video": metadata, "sha256_blend": source_hash, "sha256_reference": digest(STILL),
        "sha256_mp4": digest(candidate), "camera": info["camera"], "source_mesh": info["object"],
        "original_vertices": info["vertices"], "pinned_vertices": info["fixed_vertices"],
        "max_spine_displacement_m": 0.0, "independent_open_poses": last, "distinct_images_with_rest": distinct,
        "cycles_samples": SAMPLES,
        "peak_lift_m": info["poses"][peak]["max_lift_m"], "peak_projected_sag_px": overlay[3],
        "render": read_json(cache / "crop.json"), "raw_closed_crop_vs_still": errors(closed, plate_crop),
        "best_registration_offset_px": alignment, "preencode_endpoint_max_diff": 0,
        "decoded_first_vs_still": still_error, "decoded_last_vs_still": errors(end, plate),
        "decoded_first_vs_last": errors(first, end), "open_vs_closed_decoded": action,
        "decoded_change_ge12_outside_crop_px": int((outside_difference >= 12).sum()),
        "geometry_and_light_cache": cache.name, "receiver_changes": shadows, "frame_to_pose": sequence,
        "proof_frames": cards,
    }
    write_json(WORK / "validation.json", metrics)
    MOVIE.parent.mkdir(parents=True, exist_ok=True)
    if MOVIE.is_file() and digest(MOVIE) == metrics["sha256_mp4"]:
        candidate.unlink()
    else:
        candidate.replace(MOVIE)
    print(f"{MOVIE} | 144 帧 | 首尾解码相同 | 全开显著变化 {action['pixels_max_channel_ge12']} 像素",
          flush=True)


def build_animation(source_hash, threads):
    movie = read_json(WORK / "validation.json")
    if source_hash != movie["sha256_blend"] or digest(MOVIE) != movie["sha256_mp4"]:
        raise ValueError("需要同一原工程已核验的成片和时间线")
    folder = WORK / "isolated-animation"
    folder.mkdir(exist_ok=True)
    candidate = folder / ANIMATION.name
    script = Path(__file__).with_name("action-animation.py")
    for mode, model in (("bake", BLEND), ("verify", candidate)):
        call_blender(model, script, [mode, str(WORK), str(candidate)], threads, WORK / f"animation-{mode}.log")
    if digest(BLEND) != source_hash:
        raise ValueError("生成动画期间输入工程发生变化")
    report = read_json(WORK / "animation-validation.json")
    frames = [1, 72, 144]
    decoded = decode_frames(MOVIE, [n-1 for n in frames])
    box = tuple(movie["render"]["render_box"])
    native = [Image.open(WORK / f"native-{n:03d}.png").convert("RGB") for n in frames]
    w, h = native[0].size
    sheet = Image.new("RGB", (3*w+32, h+52), "#f5f2ec")
    draw = ImageDraw.Draw(sheet)
    report["native_render_vs_decoded_at_half_resolution"] = {}
    for i, (n, view) in enumerate(zip(frames, native)):
        target = Image.fromarray(decoded[n-1]).crop(box).resize(view.size, Image.Resampling.LANCZOS)
        comparison = errors(np.asarray(view), np.asarray(target))
        if comparison["mean_abs_rgb"] > 6:
            raise ValueError(f"动画工程第 {n} 帧重渲画面偏离成片 {comparison}")
        report["native_render_vs_decoded_at_half_resolution"][n] = comparison
        x = 8+i*(w+8)
        sheet.paste(view, (x, 8))
        draw.text((x, h+15), f"工程重渲   第 {n} 帧", font=font(17), fill="#24211e")
    sheet.save(WORK / "animation-proof.png")
    report.update(sha256_editable_blend=digest(candidate), sha256_source_blend=source_hash,
                  sha256_validated_movie=movie["sha256_mp4"])
    write_json(WORK / "animation-validation.json", report)
    candidate.replace(ANIMATION)
    print(f"{ANIMATION} | {report['frames_evaluated']} 帧顶点已与成片核对", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--stage", choices=("all", "render", "finish", "animation"), default="all")
    parser.add_argument("--threads", type=int, default=7, choices=range(1, (os.cpu_count() or 1) + 1))
    args = parser.parse_args()
    source_hash = digest(BLEND)
    cache = render_cache(source_hash)
    if args.stage in ("all", "render"):
        render_poses(cache, args.threads)
    if args.stage in ("all", "finish"):
        finish(cache, source_hash)
    if args.stage in ("all", "animation"):
        build_animation(source_hash, args.threads)


if __name__ == "__main__":
    main()
