"""通过真实的离线 Edge 操作《从于都到遵义》，保存可复核的执行记录。"""

import argparse
from contextlib import contextmanager, suppress
from datetime import datetime
from hashlib import file_digest
import json
from os import environ
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
from traceback import format_exc

from playwright.sync_api import TimeoutError, expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
COURSE = ROOT / '课堂演示' / '从于都到遵义-课堂演示.html'
VIDEO_COMPLETION_TIMEOUT = 60000
EXPLORATION_LOAD_TIMEOUT = 60000
SCREENSHOT_TIMEOUT = 60000


def size(value):
    try:
        width, height = map(int, value.lower().split('x'))
        if width > 0 and height > 0:
            return {'width': width, 'height': height}
    except ValueError:
        pass
    raise argparse.ArgumentTypeError('请输入宽x高，例如 1366x768')


def button(page, name):
    return page.get_by_role('button', name=name, exact=True)


def lesson_action(page, action):
    return page.locator(f'button[data-lesson-action="{action}"]')


class Classroom:
    def __init__(self, page, output, reduced=False):
        self.page = page
        self.output = output
        self.reduced = reduced
        self.steps = []

    def shot(self, name, page=None):
        if not name or Path(name).name != name or any(char in name for char in '/\\:'):
            raise ValueError('截图名须使用单个文件名')
        page = page or self.page
        target = self.output / (name + '.png')
        software_runner = environ.get('COURSE_EDGE_RENDER_SCALE')
        try:
            page.screenshot(path=target, timeout=15000 if software_runner else SCREENSHOT_TIMEOUT)
        except TimeoutError:
            if not software_runner:
                raise
            self.steps.append(f'截图超时 {target.name}')
            return
        self.steps.append(f'截图 {target.name}')


@contextmanager
def launch(html, viewport, reduced='no-preference', video_dir=None):
    with TemporaryDirectory(prefix='long-march-edge-') as directory, sync_playwright() as playwright:
        standalone = Path(directory) / 'lesson.html'
        copyfile(html, standalone)
        scale = environ.get('COURSE_EDGE_RENDER_SCALE')
        options = {'device_scale_factor': float(scale)} if scale else {}
        flags = ['--enable-unsafe-swiftshader']
        if scale:
            flags += ['--use-gl=angle', '--use-angle=swiftshader']
        with playwright.chromium.launch(channel='msedge', headless=True, args=flags) as browser:
            video = {'record_video_dir': video_dir, 'record_video_size': viewport} if video_dir else {}
            with browser.new_context(offline=True, service_workers='block', viewport=viewport,
                    reduced_motion=reduced, **options, **video) as context:
                if scale:
                    context.set_default_timeout(60000)
                    expect.set_options(timeout=15000)
                errors = []
                context.on('weberror', lambda event: errors.append(str(event.error)))
                yield context, standalone.as_uri(), browser.version, errors
                if errors:
                    raise AssertionError('课件运行出错\n' + '\n'.join(errors))


def play(classroom, steps):
    page = classroom.page
    for step in steps:
        action = step['do']
        if action == 'shot':
            classroom.shot(step['name'], page)
        elif action == 'click':
            item = button(page, step['button']) if 'button' in step else page.locator(step['selector'])
            item.click()
        elif action == 'press':
            if 'selector' in step:
                page.locator(step['selector']).press(step['key'])
            else:
                page.keyboard.press(step['key'])
        elif action == 'select':
            page.locator(step['selector']).select_option(label=step['label'])
        elif action == 'wheel':
            page.locator(step['selector']).hover()
            page.mouse.wheel(step.get('dx',0),step['dy'])
        elif action == 'drag':
            start = page.locator(step['from']).bounding_box()
            finish = page.locator(step['to']).bounding_box() if 'to' in step else None
            if start is None or ('to' in step and finish is None):
                raise AssertionError('拖放目标当前不可见')
            x, y = start['x'] + start['width']/2, start['y'] + start['height']/2
            end = (finish['x'] + finish['width']/2, finish['y'] + finish['height']/2) if finish else (x + step['dx'], y + step['dy'])
            page.mouse.move(x, y)
            page.mouse.down()
            page.mouse.move(*end, steps=12)
            page.mouse.up()
        elif action == 'expect':
            target = expect(page.locator(step['selector']))
            if 'text' in step:
                target.to_have_text(step['text'])
            elif 'attribute' in step:
                target.to_have_attribute(step['attribute'], step['value'])
            else:
                target.to_be_visible()
        else:
            raise ValueError(f'未知操作 {action}')
        if action != 'shot':
            classroom.steps.append(step)


def main():
    from support.course_checks import FEATURES
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path, default=COURSE, help='课件文件，默认正式构建产物')
    parser.add_argument('--viewport', type=size, default=size('1366x768'))
    parser.add_argument('--output', type=Path, help='本次证据目录')
    parser.add_argument('--reduced-motion', action='store_true')
    sub = parser.add_subparsers(dest='mode', required=True)
    sub.add_parser('doctor', help='检查单文件和 Edge 启动')
    run = sub.add_parser('run', help='验收一项教学流程')
    run.add_argument('feature', choices=FEATURES)
    flow = sub.add_parser('play', help='逐项执行 JSON 中的真实操作')
    flow.add_argument('script', type=Path)
    flow.add_argument('--desk', action='store_true', help='打开独立的遵义实景入口')
    args = parser.parse_args()
    html = args.html.resolve()
    if not html.is_file():
        parser.error('找不到课件文件。请检查 --html 或先运行现有构建入口。')
    output = args.output or ROOT / '.march-build' / '验收' / datetime.now().strftime('%Y%m%d-%H%M%S-%f')
    output.mkdir(parents=True, exist_ok=True)
    with html.open('rb') as source:
        checksum = file_digest(source, 'sha256').hexdigest()
    report = {'file': str(html), 'sha256': checksum, 'window': args.viewport}
    try:
        with launch(html, args.viewport, 'reduce' if args.reduced_motion else 'no-preference') as (context, url, edge, errors):
            report['edge'] = edge
            teacher = context.new_page()
            room = Classroom(teacher, output,args.reduced_motion)
            report['steps'] = room.steps
            report['browserErrors'] = errors
            try:
                if args.mode == 'doctor':
                    teacher.goto(url)
                    expect(button(teacher, '开始授课')).to_be_visible(timeout=18000)
                    room.shot('地图入口')
                elif args.mode == 'run':
                    FEATURES[args.feature](room, url)
                else:
                    teacher.goto(url + ('#desk' if args.desk else ''))
                    play(room, json.loads(args.script.read_text(encoding='utf-8-sig')))
            except Exception:
                if not teacher.is_closed():
                    with suppress(Exception):
                        room.shot('失败现场')
                raise
            room.shot('终态')
        report['passed'] = True
    except Exception as error:
        report['passed'] = False
        report['error'] = str(error) or repr(error)
        report['traceback'] = format_exc()
    target = output / 'report.json'
    target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(('通过' if report['passed'] else report['error']) + '\n' + str(target), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
