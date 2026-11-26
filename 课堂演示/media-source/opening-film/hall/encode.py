"""Encode and validate the full-frame Zunyi entry source for the opening edit."""

import argparse
import json
import subprocess
from pathlib import Path


WIDTH, HEIGHT, FPS = 1280, 720, 24
FRAMES = round(76.65 * FPS) - round(72.25 * FPS) + 12


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("frames", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    expected = [args.frames / f"hall-{frame:04}.png" for frame in range(1, FRAMES + 1)]
    missing = [file.name for file in expected if not file.is_file()]
    if missing:
        raise ValueError("Missing rendered frames: " + ", ".join(missing))
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    staged = output.with_suffix(".part.mp4")
    try:
        subprocess.run([
            "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
            "-framerate", str(FPS), "-start_number", "1", "-i", str(args.frames / "hall-%04d.png"),
            "-frames:v", str(FRAMES), "-an", "-vf",
            "scale=in_range=full:out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1",
            "-c:v", "libx264", "-preset", "slow", "-crf", "15", "-threads", "4",
            "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
            "-color_range", "tv", "-movflags", "+faststart", str(staged),
        ], check=True)
        result = subprocess.check_output([
            "ffprobe", "-v", "error", "-count_frames", "-show_entries",
            "stream=codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,nb_read_frames",
            "-of", "json", str(staged),
        ], text=True)
        streams = json.loads(result)["streams"]
        expected_stream = {
            "codec_name": "h264",
            "codec_type": "video",
            "width": WIDTH,
            "height": HEIGHT,
            "r_frame_rate": f"{FPS}/1",
            "avg_frame_rate": f"{FPS}/1",
            "nb_read_frames": str(FRAMES),
        }
        if streams != [expected_stream]:
            raise ValueError(f"Unexpected encoded streams: {streams}")
        staged.replace(output)
        print(result.strip())
    finally:
        staged.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

