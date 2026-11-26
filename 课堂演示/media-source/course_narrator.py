"""Voice settings and audio filters shared by the course opening and the river tour."""

from pathlib import Path
import subprocess
import wave

import numpy as np


VOICE_NAME = "zh-CN-YunjianNeural"
VOICE_RATE = "-8%"
VOICE_PITCH = "-3Hz"

VOICE_FILTER = (
    "highpass=f=75,equalizer=f=155:t=q:w=1.2:g=2.5,equalizer=f=6800:t=q:w=1.5:g=-2.2,"
    "compand=attacks=0.015:decays=0.18:points=-70/-70|-26/-21|-12/-11|0/-3,volume=1.18"
)
MUSIC_DUCK = "sidechaincompress=threshold=0.022:ratio=4.2:attack=45:release=420:makeup=1"
MIX_LIMITER = "alimiter=limit=0.90:attack=5:release=60"


def trim_wav_silence(src_mp3: Path, dst_wav: Path, rate: int = 48000) -> float:
    raw = dst_wav.with_suffix(".raw.wav")
    try:
        subprocess.run(["ffmpeg", "-v", "error", "-nostdin", "-y", "-i", str(src_mp3),
                        "-ac", "1", "-ar", str(rate), "-c:a", "pcm_s16le", str(raw)], check=True)
        with wave.open(str(raw), "rb") as wav:
            samples = np.frombuffer(wav.readframes(wav.getnframes()), dtype="<i2")
        voiced = np.flatnonzero(np.abs(samples.astype(np.int32)) > 96)
        if not voiced.size:
            raise RuntimeError(f"音频无有效人声：{src_mp3}")
        lead, tail = int(0.03 * rate), int(0.09 * rate)
        cut = samples[max(0, int(voiced[0]) - lead):min(len(samples), int(voiced[-1]) + tail)]
        with wave.open(str(dst_wav), "wb") as wav:
            wav.setparams((1, 2, rate, 0, "NONE", ""))
            wav.writeframes(cut.tobytes())
        return len(cut) / rate
    finally:
        raw.unlink(missing_ok=True)
