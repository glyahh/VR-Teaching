"""从本机 SAPI、课件素材与两台精修机位制作 90 秒导览。见 guide-notes.md。"""

import argparse
import base64
import csv
import hashlib
import json
import math
import os
import subprocess
import wave
from bisect import bisect_right
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ASSETS = ROOT / '课堂演示/assets'
SCENE = ROOT / '展示材料/遵义会议室精修场景'
MODEL = SCENE / '会前的桌边.blend'
HERO = SCENE / '会前的桌边.png'
WORK = ROOT / '.march-build/desk-live/guide'
BLENDER = ROOT / '.march-build/blender-4.5.4-windows-x64/blender.exe'
ACTION = ASSETS / 'desk-action.mp4'
OUTPUT = ASSETS / 'desk-guide.mp4'
FPS, SECONDS = 24, 90
ROUTE_START_SECONDS = 26.8
ROUTE_DURATION_SECONDS = 13.6
SIZE = (1280, 720)
RATE = 24000
FRAMES = FPS * SECONDS
FLIP_AT = 60 * FPS
FLIP_FRAMES = 6 * FPS
FONTS = Path(os.environ['WINDIR']) / 'Fonts'

# 镜头首帧和叠化长度均以 24 fps 计。第 60–66 秒在合成时换入原翻页镜头。
CUTS = [(0, 'hero', 0), (132, 'street', 14), (414, 'table', 14),
        (624, 'map', 18), (1002, 'river', 17), (1188, 'dawn', 16),
        (1368, 'hero', 16), (FLIP_AT + FLIP_FRAMES, 'detail', 16), (1788, 'meeting', 16),
        (1980, 'hero', 20)]
PHOTOS = {'street': ('liping-street.jpg', 1.000, 1.045, .55, .54),
          'table': ('liping-table.jpg', 1.025, 1.085, .53, .70),
          'river': ('wujiang.jpg', 1.045, 1.000, .67, .54),
          'dawn': ('zunyi-dawn.jpg', 1.000, 1.035, .70, .56),
          'detail': ('detail.png', 1.000, 1.040, .39, .68)}


def probe(path):
    data = subprocess.check_output(['ffprobe', '-v', 'error', '-show_format', '-show_streams',
                                    '-of', 'json', str(path)])
    return json.loads(data)


def ffmpeg(*args, **kwargs):
    return subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
                           *map(str, args)], check=True, cwd=WORK, **kwargs)


def render_detail():
    detail = WORK / 'detail.png'
    script = HERE / 'guide-detail.py'
    if detail.is_file() and detail.stat().st_mtime_ns >= max(p.stat().st_mtime_ns for p in (MODEL, script)):
        return
    with (WORK / 'detail-render.log').open('wb') as log:
        subprocess.run([str(BLENDER), '-b', '-noaudio', '--disable-autoexec', str(MODEL),
                        '-t', '7', '--python-exit-code', '1', '-P', str(script)],
                       stdout=log, stderr=subprocess.STDOUT, check=True)


SAPI = r"""
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$voice = New-Object -ComObject SAPI.SpVoice
$chinese = @($voice.GetVoices() | Where-Object { ($_.GetAttribute('Language') -split ';') -match '^0?804$' })
if (!$chinese.Count) { throw 'SAPI needs a local zh-CN desktop voice.' }
$huihui = @($chinese | Where-Object { $_.GetDescription() -match 'Huihui' })
$voice.Voice = if ($huihui.Count) { $huihui[0] } else { $chinese[0] }
$voice.Rate = 0
$voice.Volume = 100
foreach ($cue in (Get-Content -LiteralPath 'speech.json' -Raw -Encoding UTF8 | ConvertFrom-Json)) {
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Format.Type = 26
    $stream.Open($cue.file, 3, $false)
    try {
        $voice.AudioOutputStream = $stream
        [void]$voice.Speak($cue.text, 16)
    } finally {
        $stream.Close()
    }
}
$voice.Voice.GetDescription()
"""


def ass_time(frame):
    # ASS 以百分秒计时，向下取整才能让事件在指定视频帧上生效。
    cents = frame * 100 // FPS
    return f'0:{cents // 6000:02d}:{cents // 100 % 60:02d}.{cents % 100:02d}'


def narration():
    with (HERE / 'guide-narration.tsv').open(encoding='utf-8', newline='') as file:
        cues = list(csv.DictReader(file, delimiter='\t'))
    requests = [{'text': row['朗读'] or row['字幕'], 'file': str(WORK / f'voice-{i:02d}.wav')}
                for i, row in enumerate(cues, 1)]
    (WORK / 'speech.json').write_text(json.dumps(requests, ensure_ascii=False), encoding='utf-8')
    command = base64.b64encode(SAPI.encode('utf-16le')).decode()
    voice = subprocess.check_output(['powershell.exe', '-NoProfile', '-NonInteractive', '-Sta',
                                     '-EncodedCommand', command], cwd=WORK).decode('utf-8').strip()
    track = np.zeros(SECONDS * RATE, dtype='<i2')
    timeline = []
    end = 0
    for cue, request in zip(cues, requests, strict=True):
        with wave.open(request['file'], 'rb') as wav:
            if (wav.getframerate(), wav.getsampwidth(), wav.getnchannels()) != (RATE, 2, 1):
                raise ValueError('SAPI 需要输出 24 kHz 单声道 16 位 PCM')
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2')
        voiced = np.flatnonzero(np.abs(samples.astype(np.int32)) > 48)
        if not voiced.size:
            raise ValueError(f'未合成语音 {cue["字幕"]}')
        samples = samples[max(0, voiced[0] - 420):voiced[-1] + 1440]
        onset = cue['入点']
        start = round(float(onset) * FPS) + (end if onset.startswith('+') else 0)
        if start < end:
            raise ValueError(f'{cue["字幕"]} 入点 {start/FPS:.2f} 早于上句结束 {end/FPS:.2f}')
        end = start + math.ceil(len(samples) * FPS / RATE)
        if start < FPS or end > FRAMES - FPS:
            raise ValueError(f'首尾须各留一秒空镜，检查 {cue["字幕"]}，结束 {end/FPS:.2f}')
        offset = start * RATE // FPS
        track[offset:offset + len(samples)] = samples
        timeline.append({'start': start, 'end': end, 'text': cue['字幕']})
    with wave.open(str(WORK / 'narration.wav'), 'wb') as wav:
        wav.setparams((1, 2, RATE, 0, 'NONE', ''))
        wav.writeframes(track.tobytes())

    # 把字幕多留两帧，让句末可读。
    header = """[Script Info]
ScriptType: v4.00+
PlayResX: 1280
PlayResY: 720
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Guide,Microsoft YaHei,40,&H00F4F7FA,&H00FFFFFF,&H28201C18,&H75131010,0,0,0,0,100,100,0.4,0,1,2.2,1.2,2,64,64,39,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events = []
    for i, cue in enumerate(timeline):
        next_start = timeline[i + 1]['start'] if i + 1 < len(timeline) else FRAMES - FPS
        cue['caption_end'] = min(cue['end'] + 2, next_start)
        events.append(f'Dialogue: 0,{ass_time(cue["start"])},{ass_time(cue["caption_end"])},'
                      f'Guide,,0,0,0,,{cue["text"]}')
    (WORK / 'guide.ass').write_text(header + '\n'.join(events) + '\n', encoding='utf-8-sig')
    (WORK / 'cues.json').write_text(json.dumps({'voice': voice, 'cues': timeline}, ensure_ascii=False,
                                               indent=2), encoding='utf-8')
    print(voice)
    print(f'{len(timeline)} 条旁白，首句 {timeline[0]["start"]/FPS:.2f} 秒，'
          f'末句结束 {timeline[-1]["end"]/FPS:.2f} 秒', flush=True)


def ease(t):
    t = min(1., max(0., t))
    return t * t * (3. - 2. * t)


def route_art():
    # 与课件 elevation.png 一致的等经纬网格。只给有原始坐标的两座城市落点。
    west, north, east, south = 105.55, 28.20, 110.75, 25.60
    with Image.open(ASSETS / 'elevation.png') as packed:
        w, h = packed.size
        box = ((west-90.5)/42*w, (44.25-north)/34*h, (east-90.5)/42*w, (44.25-south)/34*h)
        x, y = math.floor(box[0]), math.floor(box[1])
        tile = np.asarray(packed.crop((x, y, math.ceil(box[2]), math.ceil(box[3]))), dtype=np.float32)
    heights = Image.fromarray(tile[:, :, 0]*256 + tile[:, :, 1] - 2048)
    z = np.asarray(heights.resize(SIZE, Image.Resampling.BICUBIC,
                                  box=(box[0]-x, box[1]-y, box[2]-x, box[3]-y)))
    gy, gx = np.gradient(z)
    shade = (.70 - .026*gx - .038*gy) / np.sqrt(1 + (.055*gx)**2 + (.055*gy)**2)
    contour = np.clip(1 - np.abs((z + 85) % 170 - 85) / (1 + .8*np.hypot(gx, gy)), 0, 1)
    tone = 23*shade - .009*z - 14*contour
    paper = np.clip(np.array([216, 207, 179]) + tone[:, :, None], 0, 255).astype('uint8')
    base = Image.fromarray(paper)
    ink, red = '#302e26', '#932f20'
    song = ImageFont.truetype(str(FONTS / 'simsun.ttc'), 37)
    sans = ImageFont.truetype(str(FONTS / 'msyh.ttc'), 24)
    labels = ImageFont.truetype(str(FONTS / 'msyhbd.ttc'), 35)

    def point(lon, lat):
        return np.array([(lon-west)/(east-west)*SIZE[0], (north-lat)/(north-south)*SIZE[1]])

    first, via, last = point(109.14, 26.23), point(107.47, 27.32), point(106.93, 27.69)
    # 两段光滑示意线经过课件地图的中间控制点，不给渡口指定经纬度。
    curves = [(first, first+[-92, -14], via+[104, 85], via),
              (via, via+[-82, -63], last+[65, 4], last)]
    path = []
    for a, b, c, d in curves:
        for t in np.linspace(0., 1., 140):
            path.append((1-t)**3*a + 3*(1-t)**2*t*b + 3*(1-t)*t*t*c + t**3*d)
    path = np.asarray(path)
    distance = np.r_[0., np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))]
    draw = ImageDraw.Draw(base)
    draw.text((64, 52), '进军方向示意', font=song, fill=ink)
    draw.line([(1199, 58), (1199, 101)], fill=ink, width=2)
    draw.polygon([(1199, 48), (1194, 64), (1204, 64)], fill=ink)
    draw.text((1199, 111), '北', font=sans, fill=ink, anchor='mt')
    for pt, name, label_offset in [(first, '黎平', (20, -2)), (last, '遵义', (-19, -1))]:
        px, py = pt
        draw.ellipse((px-7, py-7, px+7, py+7), fill=ink)
        draw.text((px+label_offset[0], py+label_offset[1]), name, font=labels, fill=ink,
                  anchor='lm' if label_offset[0] > 0 else 'rm',
                  stroke_width=2, stroke_fill='#dfd4b9')
    painted = Image.new('RGBA', (SIZE[0]*2, SIZE[1]*2))
    pen = ImageDraw.Draw(painted)
    points = [tuple(2*v) for v in path]
    pen.line(points, fill='#eadfc1', width=15, joint='curve')
    pen.line(points, fill=red, width=8, joint='curve')
    painted = painted.resize(SIZE, Image.Resampling.LANCZOS)
    route = base.copy()
    route.paste(painted, (0, 0), painted)

    def animated(frame):
        # 地名随旁白出现。线的进度按弧长，向西北推进时保持匀顺。
        part = ease((frame/FPS - ROUTE_START_SECONDS) / ROUTE_DURATION_SECONDS) * distance[-1]
        px, py = (np.interp(part, distance, path[:, i]) for i in range(2))
        left = math.floor(px)
        shot = base.copy()
        shot.paste(route.crop((left, 0, SIZE[0], SIZE[1])), (left, 0))
        pen = ImageDraw.Draw(shot)
        pen.ellipse((px-8, py-8, px+8, py+8), fill=red, outline='#fff0d3', width=2)
        for at, xy, label in [(31.35, (649, 479), '经猴场'), (38.67, (466, 285), '渡乌江')]:
            if frame >= round(at*FPS):
                pen.text(xy, label, font=sans, fill=ink, stroke_width=2, stroke_fill='#e4d9bd')
        return shot
    return animated


def opener_title():
    mask_y, mask_x = np.ogrid[:SIZE[1], :SIZE[0]]
    density = np.exp(-((mask_x-170)/375)**2 - ((mask_y-78)/105)**2) * 154
    plate = Image.new('RGBA', SIZE, (19, 17, 15))
    plate.putalpha(Image.fromarray(density.astype('uint8')))
    pen = ImageDraw.Draw(plate)
    title = ImageFont.truetype(str(FONTS / 'simsun.ttc'), 58)
    pen.text((66, 58), '从黎平到遵义', font=title, fill='#fff3da', stroke_width=1,
             stroke_fill='#655846')
    return plate


def prepare_picture():
    render_detail()
    detail = WORK / 'detail.png'
    body = WORK / 'picture.mkv'
    assets = [__file__, HERO, detail, ASSETS/'elevation.png', ASSETS/'zunyi.mp4',
              *(ASSETS/v[0] for k, v in PHOTOS.items() if k != 'detail'),
              *(FONTS/f for f in ('simsun.ttc', 'msyh.ttc', 'msyhbd.ttc'))]
    if body.exists() and body.stat().st_mtime_ns >= max(Path(p).stat().st_mtime_ns for p in assets):
        return body

    pictures = {}
    for key, (name, *_) in PHOTOS.items():
        with Image.open(detail if key == 'detail' else ASSETS/name) as photo:
            pictures[key] = photo.convert('RGB')
    with Image.open(HERO) as source:
        if source.size != (1920, 1080):
            raise ValueError('片头片尾需要精修 1920 × 1080 主视图')
        hero = source.convert('RGB').resize(SIZE, Image.Resampling.LANCZOS)
    route_frame = route_art()
    title = opener_title()
    starts = [entry[0] for entry in CUTS]
    room_index = next(i for i, entry in enumerate(CUTS) if entry[1] == 'meeting')
    room_count = starts[room_index+1] + CUTS[room_index+1][2] - starts[room_index]
    room_dir = WORK / 'meeting'
    room_dir.mkdir(exist_ok=True)
    ffmpeg('-ss', '0.5', '-i', ASSETS/'zunyi.mp4', '-vf', 'fps=24', '-frames:v', room_count,
           '-q:v', 2, '-threads', 3, '-start_number', 0, room_dir/'%03d.jpg')

    def shot(i, frame):
        start, key, _ = CUTS[i]
        if key == 'hero':
            return hero
        if key == 'map':
            return route_frame(frame)
        if key == 'meeting':
            with Image.open(room_dir / f'{frame-start:03d}.jpg') as source:
                return source.convert('RGB')
        photo = pictures[key]
        _, begin, finish, focus_x, focus_y = PHOTOS[key]
        t = ease((frame - start) / (starts[i+1] - start))
        scale = begin + (finish-begin)*t
        w, h = photo.size
        dx, dy = w-w/scale, h-h/scale
        x, y = dx*focus_x, dy*focus_y
        picture = photo.resize(SIZE, Image.Resampling.BICUBIC, box=(x, y, w-dx+x, h-dy+y))
        if key == 'street':
            opacity = ease((frame/FPS-6.25)/.70) * ease((12.4-frame/FPS)/.70)
            if opacity:
                titled = picture.copy()
                titled.paste(title, (0, 0), title)
                picture = Image.blend(picture, titled, opacity)
        return picture

    tmp = WORK / 'picture-building.mkv'
    command = ['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo',
               '-pixel_format', 'rgb24', '-video_size', '1280x720', '-framerate', str(FPS),
               '-i', 'pipe:0', '-vf', 'scale=out_color_matrix=bt709,format=yuv420p',
               '-an', '-c:v', 'libx264', '-threads', '4', '-preset', 'veryfast', '-crf', '12',
               '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1', str(tmp)]
    with subprocess.Popen(command, stdin=subprocess.PIPE) as writer:
        try:
            for frame in range(FRAMES):
                i = bisect_right(starts, frame) - 1
                start, key, fade = CUTS[i]
                if start == frame:
                    print(f'{frame/FPS:5.2f} 秒  {key}', flush=True)
                picture = shot(i, frame)
                if frame - start < fade:
                    picture = Image.blend(shot(i-1, frame), picture, ease((frame-start)/fade))
                writer.stdin.write(picture.tobytes())
        finally:
            writer.stdin.close()
        if writer.wait():
            raise RuntimeError('FFmpeg 未完成底片编码')
    tmp.replace(body)
    return body


def action_source():
    if not ACTION.is_file():
        raise FileNotFoundError(f'正式合成需要真实翻页镜头 {ACTION}')
    video = next(s for s in probe(ACTION)['streams'] if s['codec_type'] == 'video')
    if (video['width'], video['height'], video['avg_frame_rate']) != (*SIZE, '24/1'):
        raise ValueError('翻页原片应为 1280 × 720、24 fps，以便逐帧对位')
    if int(video['nb_frames']) < FLIP_FRAMES:
        raise ValueError('翻页原片不足剪辑所需的 144 帧')
    return ACTION


def assemble(body):
    action = action_source()
    candidate = WORK / 'guide-candidate.mp4'
    # 直接拼接原片的 144 帧；底片中的对应帧不会进入输出流。
    filters = (f'[0:v]setsar=1,settb=1/{FPS},setpts=N,split[head][tail];'
               f'[head]trim=end_frame={FLIP_AT},setpts=PTS-STARTPTS[h];'
               f'[1:v]trim=end_frame={FLIP_FRAMES},setsar=1,settb=1/{FPS},setpts=N[a];'
               f'[tail]trim=start_frame={FLIP_AT+FLIP_FRAMES},setpts=PTS-STARTPTS[t];'
               '[h][a][t]concat=n=3:v=1:a=0,ass=guide.ass[v]')
    ffmpeg('-i', body, '-i', action, '-i', WORK/'narration.wav', '-filter_complex_threads', 3,
           '-filter_complex', filters, '-map', '[v]', '-map', '2:a:0',
           '-af', 'volume=5dB,alimiter=limit=0.79:attack=4:release=60:level=0:latency=1,aresample=48000',
           '-r', FPS, '-fps_mode', 'cfr', '-t', SECONDS, '-c:v', 'libx264', '-preset', 'slow',
           '-threads:v', 5, '-crf', 22, '-maxrate:v', '2400k', '-bufsize:v', '4800k',
           '-g', 48, '-keyint_min', 48, '-sc_threshold', 0, '-pix_fmt', 'yuv420p',
           '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'iec61966-2-1',
           '-color_range', 'tv', '-video_track_timescale', 24000, '-c:a', 'aac', '-b:a', '88k',
           '-ar', 48000, '-ac', 1, '-movflags', '+faststart', '-metadata', 'title=从黎平到遵义',
           '-metadata', 'comment=场景画面为教学情境复原，桌面材料为教学摘要。', candidate)
    return candidate


def read_frames(path, start, count, size):
    result = ffmpeg('-ss', f'{start/FPS:.7f}', '-threads', 2, '-i', path, '-an',
                    '-frames:v', count, '-filter_threads', 1,
                    '-vf', f'scale={size[0]}:{size[1]}:flags=bicubic,format=rgb24',
                    '-threads', 1, '-f', 'rawvideo', 'pipe:1', stdout=subprocess.PIPE)
    return np.frombuffer(result.stdout, dtype='uint8').reshape(count, size[1], size[0], 3)


def caption_edges(movie, body, action, cues):
    # 抽取每个切点相邻两帧，与相同底图的字幕区域逐像素比对。
    frames = sorted({n for c in cues for edge in (c['start'], c['caption_end']) for n in (edge-1, edge)})

    def bands(path, numbers):
        if not numbers:
            return {}
        select = '+'.join(f'eq(n,{n})' for n in numbers)
        filters = f"select='{select}',scale=640:360:flags=bicubic,format=gray,crop=640:64:0:296"
        data = ffmpeg('-threads', 3, '-i', path, '-an', '-filter_threads', 1, '-vf', filters,
                      '-fps_mode', 'passthrough', '-threads', 1, '-f', 'rawvideo', 'pipe:1',
                      stdout=subprocess.PIPE)
        pixels = np.frombuffer(data.stdout, dtype='uint8').reshape(len(numbers), 64, 640)
        return dict(zip(numbers, pixels, strict=True))

    flip = [n for n in frames if FLIP_AT <= n < FLIP_AT + FLIP_FRAMES]
    clean = bands(body, [n for n in frames if n not in flip])
    for n, band in bands(action, [f-FLIP_AT for f in flip]).items():
        clean[n+FLIP_AT] = band
    visible, blank = [], []
    for n, band in bands(movie, frames).items():
        count = int((np.abs(band.astype('int16') - clean[n]) > 40).sum())
        active = any(c['start'] <= n < c['caption_end'] for c in cues)
        (visible if active else blank).append(count)
        if (active and count < 220) or (not active and count > 150):
            raise ValueError(f'第 {n} 帧字幕边界与旁白时间表不符，差异像素 {count}')
    return {'frames_checked': len(frames), 'min_visible_pixels': min(visible), 'max_blank_pixels': max(blank)}


def verify(path, body):
    def require(condition, message):
        if not condition:
            raise ValueError(message)

    metadata = probe(path)
    video, audio = metadata['streams']
    require((video['codec_name'], video['pix_fmt'], video['width'], video['height'],
             video['r_frame_rate'], video['avg_frame_rate'], int(video['nb_frames'])) ==
            ('h264', 'yuv420p', *SIZE, '24/1', '24/1', FRAMES), '视频规格或帧数错误')
    require((audio['codec_name'], audio['sample_rate'], audio['channels']) == ('aac', '48000', 1),
            '旁白音轨规格错误')
    for stream in [metadata['format'], video, audio]:
        require(float(stream['duration']) == SECONDS and float(stream['start_time']) == 0,
                '容器、视频和音轨均须从零开始，严格 90 秒')
    # 跳过盒体后检查真正的顶层 moov 和 mdat，避免在压缩载荷中误匹配字节。
    boxes = []
    with path.open('rb') as movie:
        while header := movie.read(8):
            length = int.from_bytes(header[:4], 'big')
            boxes.append(header[4:].decode('ascii'))
            if length == 0:
                break
            if length == 1:
                length = int.from_bytes(movie.read(8), 'big') - 8
            require(length >= 8, 'MP4 盒长度错误')
            movie.seek(length - 8, 1)
    require(boxes.index('moov') < boxes.index('mdat'), '索引必须在媒体数据之前')
    keyframes = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey',
        '-show_entries', 'frame=best_effort_timestamp_time', '-of', 'json', str(path)]))
    times = [float(f['best_effort_timestamp_time']) for f in keyframes['frames']]
    interval = max(np.diff(times + [SECONDS]))
    require(times[0] == 0 and interval <= 2.001, '随机定位的关键帧间隔超过 2 秒')
    ffmpeg('-xerror', '-err_detect', 'explode', '-threads', 3, '-i', path,
           '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-')

    cue_data = json.loads((WORK/'cues.json').read_text(encoding='utf-8'))
    cues = cue_data['cues']
    clean = [(0, cues[0]['start']), (cues[-1]['caption_end'], FRAMES - cues[-1]['caption_end'])]
    with Image.open(HERO) as original:
        reference = original.convert('RGB').resize(SIZE, Image.Resampling.LANCZOS)
    test_size = (512, 288)
    reference = np.asarray(reference.resize(test_size, Image.Resampling.BICUBIC), dtype='int16')
    worst_mean, worst_block = 0., 0.
    for start, count in clean:
        require(count >= FPS/2, '首尾净画面不足半秒')
        frames = read_frames(path, start, count, test_size)
        for frame in frames:
            delta = np.abs(reference - frame).mean(axis=2)
            worst_mean = max(worst_mean, float(delta.mean()))
            worst_block = max(worst_block, float(delta.reshape(18, 16, 32, 16).mean(axis=(1, 3)).max()))
    require(worst_mean < 3.5 and worst_block < 10., '净画面的构图、文字或颜色与已审主图有差异')

    # 遮去底部字幕区，只在真实翻页过程中发生明显变化的像素上对比两条序列。
    action = action_source()
    size = (384, 216)
    src = read_frames(action, 0, FLIP_FRAMES, size)[:, :178]
    out = read_frames(path, FLIP_AT, FLIP_FRAMES, size)[:, :178]
    moved = np.ptp(src, axis=0).mean(axis=2) > 25
    require(moved.sum() > 120, '翻页原片中未检出足够的纸页运动')
    expected, actual = src[:, moved].astype('float32'), out[:, moved].astype('float32')
    action_error = float(np.abs(expected - actual).mean())
    expected -= expected.mean(axis=0)
    actual -= actual.mean(axis=0)
    motion_corr = float(np.sum(expected*actual) / np.sqrt(np.sum(expected**2)*np.sum(actual**2)))
    require(action_error < 4.5 and motion_corr > .96, '成片翻页动作与原片的逐帧变化不符')

    with wave.open(str(WORK/'narration.wav'), 'rb') as wav:
        reference_audio = np.frombuffer(wav.readframes(wav.getnframes()), dtype='<i2')
    decoded = ffmpeg('-i', path, '-map', '0:a:0', '-ar', RATE, '-ac', 1, '-f', 's16le',
                     'pipe:1', stdout=subprocess.PIPE)
    speech = np.frombuffer(decoded.stdout, dtype='<i2')
    require(abs(len(speech) - SECONDS*RATE) < 1024, '解码音频长度异常')
    correlations, delays = [], []
    for cue in cues:
        span = slice(cue['start']*RATE//FPS, cue['end']*RATE//FPS)
        original, spoken = reference_audio[span], speech[span]
        correlations.append(float(np.corrcoef(original, spoken)[0, 1]))
        # 在前后两帧内找波形互相关的峰，量出 AAC 解码后每句的实际偏移。
        nfft = 1 << (2*len(original)-1).bit_length()
        corr = np.fft.irfft(np.fft.rfft(spoken, nfft) * np.fft.rfft(original, nfft).conj(), nfft)
        window = 2*RATE//FPS
        delays.append(int(np.argmax(np.r_[corr[-window:], corr[:window+1]])) - window)
    require(min(correlations) > .94, '成片旁白与字幕时间轴不同步')
    max_lag = max(abs(delay) for delay in delays)
    require(max_lag < RATE/FPS, '旁白切点偏离一帧以上')
    for start, count in clean:
        data = speech[start*RATE//FPS:(start+count)*RATE//FPS]
        require(np.max(np.abs(data.astype('int32'))) < 32, '净画面有非预期声音')

    edges = caption_edges(path, body, action, cues)

    def digest(item):
        with item.open('rb') as file:
            return hashlib.file_digest(file, 'sha256').hexdigest()

    report = {'duration': SECONDS, 'frames': FRAMES, 'picture': '1280x720, H.264, 24 fps',
              'audio': 'AAC, 48000 Hz, mono', 'voice': cue_data['voice'], 'cues': len(cues),
              'bytes': path.stat().st_size, 'faststart': True, 'keys': len(times),
              'max_seek_interval_s': float(interval), 'clean_intervals_frames': clean,
              'clean_worst_mean_abs_rgb': round(worst_mean, 3),
              'clean_worst_16px_block_error': round(worst_block, 3),
              'flip_interval_frames': [FLIP_AT, FLIP_AT+FLIP_FRAMES],
              'flip_pixels_checked': int(moved.sum()), 'flip_mean_abs_rgb': round(action_error, 3),
              'flip_motion_correlation': round(motion_corr, 5),
              'min_cue_audio_correlation': round(min(correlations), 5),
              'max_cue_lag_samples_at_24000Hz': max_lag, 'caption_edges': edges,
              'sha256': {p.name: digest(p) for p in (MODEL, HERO, action)}}
    report['sha256'][OUTPUT.name] = digest(path)
    (WORK/'verification.json').write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding='utf-8')
    print(json.dumps(report, indent=2, ensure_ascii=False), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('prepare', 'build', 'verify'), default='build', nargs='?')
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    narration()
    body = prepare_picture()
    if args.mode == 'verify':
        verify(OUTPUT, body)
    elif args.mode == 'build':
        candidate = assemble(body)
        verify(candidate, body)
        candidate.replace(OUTPUT)
        print(OUTPUT)


if __name__ == '__main__':
    main()
