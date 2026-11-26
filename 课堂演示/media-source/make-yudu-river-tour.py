"""Assemble the approved river footage and the opening's narrator at fixed cut points."""

import argparse
import asyncio
from hashlib import sha256
import json
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory
import wave

import numpy as np

from course_narrator import MIX_LIMITER, MUSIC_DUCK, VOICE_FILTER, VOICE_NAME, VOICE_PITCH, VOICE_RATE, trim_wav_silence


SOURCE = Path(__file__).resolve().parent
ASSETS = SOURCE.parent / "assets"
SHORTS = ASSETS / "yudu-river" / "shorts"
BUILD = SOURCE.parents[1] / ".march-build"
FPS = 24
SAMPLE_RATE = 48000
FFMPEG = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-nostdin", "-y"]


def voice_file(directory: Path, key: str, text: str) -> Path:
    signature = sha256(f"{VOICE_NAME}|{VOICE_RATE}|{VOICE_PITCH}|{text}".encode()).hexdigest()[:12]
    return directory / f"{key}-{signature}.wav"


async def synthesize(voices: list[tuple[str, Path]]) -> None:
    deps = BUILD / "opening-tts-deps"
    if deps.is_dir():
        sys.path.insert(0, str(deps))
    import edge_tts

    for text, wav in voices:
        if wav.is_file():
            continue
        mp3 = wav.with_suffix(".mp3")
        for attempt in range(3):
            try:
                await edge_tts.Communicate(text, VOICE_NAME, rate=VOICE_RATE, pitch=VOICE_PITCH).save(str(mp3))
                break
            except Exception:
                if attempt == 2:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))
        trim_wav_silence(mp3, wav, SAMPLE_RATE)


def make_picture(order: list[str], frames: list[int], path: Path) -> None:
    command = FFMPEG.copy()
    filters = []
    for index, (key, count) in enumerate(zip(order, frames, strict=True)):
        command.extend(["-i", str(SHORTS / f"{key}.mp4")])
        filters.append(f"[{index}:v]trim=end_frame={count},setpts=PTS-STARTPTS[v{index}]")
    inputs = "".join(f"[v{index}]" for index in range(len(order)))
    filters.append(f"{inputs}concat=n={len(order)}:v=1:a=0,setpts=N/{FPS}/TB[video]")
    subprocess.run(command + ["-filter_complex", ";".join(filters), "-map", "[video]",
                               "-c:v", "libx264", "-crf", "17", "-pix_fmt", "yuv420p",
                               "-fps_mode", "cfr", "-r", str(FPS), str(path)], check=True)


def make_voice(voices: list[tuple[str, Path]], frames: list[int], target: Path) -> None:
    samples_per_frame = SAMPLE_RATE // FPS
    track = np.zeros(sum(frames) * samples_per_frame, dtype="<i2")
    cut = 0
    for (text, wav_path), frame_count in zip(voices, frames, strict=True):
        if not wav_path.is_file():
            raise FileNotFoundError(f"缺少云健旁白 {wav_path}，请加 --synthesize 合成。")
        with wave.open(str(wav_path), "rb") as wav:
            if (wav.getnchannels(), wav.getsampwidth(), wav.getframerate()) != (1, 2, SAMPLE_RATE):
                raise ValueError(f"旁白需要 48 kHz、16 位、单声道 WAV：{wav_path}")
            speech = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2").copy()
        start = cut + round(.14 * SAMPLE_RATE)
        end = start + len(speech)
        cut += frame_count * samples_per_frame
        if not len(speech) or end + round(.10 * SAMPLE_RATE) > cut:
            raise ValueError(f"旁白为空或超出对应镜头：{text}")
        fade = min(round(.012 * SAMPLE_RATE), len(speech) // 6)
        if fade:
            envelope = np.linspace(0, 1, fade)
            speech[:fade] = speech[:fade] * envelope
            speech[-fade:] = speech[-fade:] * envelope[::-1]
        track[start:end] = speech
        print(f"{text} {start / SAMPLE_RATE:.3f}–{end / SAMPLE_RATE:.3f} 秒", flush=True)
    with wave.open(str(target), "wb") as wav:
        wav.setparams((1, 2, SAMPLE_RATE, 0, "NONE", ""))
        wav.writeframes(track.tobytes())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--voice-dir", type=Path, default=BUILD / "河岸云健旁白" / "分句")
    parser.add_argument("--synthesize", action="store_true", help="联网补齐缺少的旁白分句")
    parser.add_argument("--picture", type=Path, help="逐包复用已验收的无字幕画面流")
    parser.add_argument("--output", type=Path, default=SHORTS / "river-tour.mp4")
    args = parser.parse_args()
    shots = {shot["key"]: shot for shot in json.loads((SOURCE / "yudu-shorts-qa.json").read_text(encoding="utf-8"))}
    order = json.loads((SOURCE / "yudu-river-tour-order.json").read_text(encoding="utf-8"))
    if len(order) != len(shots) or set(order) != set(shots) or any(shot["fps"] != FPS for shot in shots.values()):
        raise ValueError("于都河岸必须按 24 帧每秒各使用一次已验收镜头。")
    frames = [shots[key]["source_out_exclusive"] - shots[key]["source_in"] for key in order]
    captions = json.loads((SOURCE / "yudu-voice-captions.json").read_text(encoding="utf-8"))
    voices = [(captions[key], voice_file(args.voice_dir, key, captions[key])) for key in order]
    if args.synthesize:
        args.voice_dir.mkdir(parents=True, exist_ok=True)
        asyncio.run(synthesize(voices))

    duration = sum(frames) / FPS
    with TemporaryDirectory(dir=args.output.resolve().parent) as folder:
        work = Path(folder)
        picture = args.picture or work / "picture.mp4"
        if not args.picture:
            make_picture(order, frames, picture)
        voice = work / "voice.wav"
        make_voice(voices, frames, voice)
        filters = ";".join([
            f"[1:a]aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"{VOICE_FILTER},asplit=2[main][control]",
            f"[2:a]aresample={SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo,"
            f"apad=whole_dur={duration},atrim=duration={duration},volume=0.25[music]",
            f"[music][control]{MUSIC_DUCK}[bed]",
            f"[main][bed]amix=inputs=2:normalize=0:duration=first,{MIX_LIMITER}[mix]",
        ])
        result = work / "river-tour.mp4"
        subprocess.run(FFMPEG + ["-i", str(picture), "-i", str(voice), "-i", str(ASSETS / "recap-cello.mp3"),
                                 "-filter_complex", filters, "-map", "0:v:0", "-map", "[mix]",
                                 "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ar", str(SAMPLE_RATE),
                                 "-t", str(duration), "-movflags", "+faststart", str(result)], check=True)
        result.replace(args.output)


if __name__ == "__main__":
    main()
