"""通过真实的离线 Edge 操作《从于都到遵义》，保存可复核的执行记录。"""

import argparse
from contextlib import contextmanager, suppress
from datetime import datetime
from hashlib import file_digest
import json
from pathlib import Path
from shutil import copyfile
from tempfile import TemporaryDirectory
from traceback import format_exc

from playwright.sync_api import expect, sync_playwright


ROOT = Path(__file__).resolve().parents[1]
COURSE = ROOT / '课堂演示' / '从于都到遵义-课堂演示.html'


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


class Classroom:
    def __init__(self, teacher, output, projector, reduced=False):
        self.teacher = teacher
        self.screen = None
        self.output = output
        self.projector = projector
        self.reduced = reduced
        self.steps = []

    def project(self):
        label = '重新打开投影' if self.screen is not None else None
        if label is None:
            label = '双屏授课' if button(self.teacher, '双屏授课').is_visible() else '开始双屏授课'
        with self.teacher.expect_popup() as opening:
            button(self.teacher, label).click()
        self.screen = opening.value
        self.screen.set_viewport_size(self.projector)
        expect(self.teacher.locator('.presenter-status')).to_have_text('投影已连接', timeout=18000)
        self.steps.append(label)
        return self.screen

    def close_projection(self):
        if self.screen is None:
            raise ValueError('此时没有打开的投影')
        self.screen.close()
        expect(self.teacher.locator('.presenter-status')).to_have_text('投影窗口已关闭')
        self.steps.append('关闭投影')

    def shot(self, name, page=None):
        if not name or Path(name).name != name or any(char in name for char in '/\\:'):
            raise ValueError('截图名须使用单个文件名')
        page = page or self.teacher
        target = self.output / (name + '.png')
        page.screenshot(path=target)
        self.steps.append(f'截图 {target.name}')


@contextmanager
def launch(html, viewport, reduced='no-preference'):
    with TemporaryDirectory(prefix='long-march-edge-') as directory, sync_playwright() as playwright:
        standalone = Path(directory) / 'lesson.html'
        copyfile(html, standalone)
        with playwright.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-swiftshader']) as browser:
            with browser.new_context(offline=True, service_workers='block', viewport=viewport, reduced_motion=reduced) as context:
                errors = []
                context.on('weberror', lambda event: errors.append(str(event.error)))
                yield context, standalone.as_uri(), browser.version, errors
                if errors:
                    raise AssertionError('课件运行出错\n' + '\n'.join(errors))


def select_page(classroom, target):
    if target == 'teacher':
        return classroom.teacher
    if target == 'projection' and classroom.screen and not classroom.screen.is_closed():
        return classroom.screen
    raise ValueError(f'找不到窗口 {target}')


def play(classroom, steps):
    page = classroom.teacher
    for step in steps:
        action = step['do']
        if action == 'project':
            classroom.project()
        elif action == 'close-projection':
            classroom.close_projection()
        elif action == 'window':
            page = select_page(classroom, step['target'])
        elif action == 'shot':
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
        if action not in ('project', 'close-projection', 'shot'):
            classroom.steps.append(step)


def main():
    from course_checks import FEATURES
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--html', type=Path, default=COURSE, help='课件文件，默认正式构建产物')
    parser.add_argument('--viewport', type=size, default=size('1366x768'))
    parser.add_argument('--projector', type=size, default=size('1920x1080'))
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
    report = {'file': str(html), 'sha256': checksum, 'window': args.viewport, 'projection': args.projector}
    try:
        with launch(html, args.viewport, 'reduce' if args.reduced_motion else 'no-preference') as (context, url, edge, errors):
            report['edge'] = edge
            teacher = context.new_page()
            room = Classroom(teacher, output, args.projector,args.reduced_motion)
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
