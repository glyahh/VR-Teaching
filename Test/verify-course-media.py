from argparse import ArgumentParser
from pathlib import Path

from course_cli import COURSE, launch
from support.course_media import MAX_JOIN_RGB_ERROR, video_frame_errors


def verify_asset_join(html, clip, entry, exit):
    with launch(html, {"width": 1920, "height": 1080}) as (context, lesson_url, _, _):
        page = context.new_page()
        page.goto(lesson_url)
        video_key = clip + "-video"
        missing = page.evaluate("""keys => keys.filter(key => !mediaAssets[key] &&
            (typeof courseMediaTypes === 'undefined' || !courseMediaTypes[key]))""", [video_key, entry, exit])
        if missing:
            raise SystemExit("成品中找不到资源 " + "、".join(missing))
        first, last = video_frame_errors(page, video_key, entry, exit)
        print(f"{clip} 与 {entry}、{exit} 平均 RGB 差 {first:.2f}、{last:.2f}/255", flush=True)
        if max(first, last) >= MAX_JOIN_RGB_ERROR:
            raise SystemExit("首尾帧有偏差。核对实际出入片画面的机位、裁切、亮度和物件状态。")


if __name__ == '__main__':
    parser = ArgumentParser()
    parser.add_argument('--html', type=Path, default=COURSE)
    parser.add_argument('--check-join', nargs=3, required=True, metavar=('CLIP', 'ENTRY', 'EXIT'))
    args = parser.parse_args()
    verify_asset_join(args.html, *args.check_join)
