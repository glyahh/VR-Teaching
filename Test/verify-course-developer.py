"""Exercise the current-tab handoff in Windows Edge with the registered OS handler."""
import json
import os
from pathlib import Path
import re

from playwright.sync_api import expect, sync_playwright

from course_cli import COURSE, lesson_action


def main():
    output = Path(__file__).resolve().parents[1] / '.march-build' / 'verify-course-developer'
    output.mkdir(parents=True, exist_ok=True)
    schemes = []

    def launch_protocol(uri):
        assert re.fullmatch(r'vrteaching-course-ai://start/[0-9a-f]{32}', uri)
        schemes.append(uri)
        os.startfile(uri)

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel='msedge', headless=True)
        context = browser.new_context(viewport={'width': 1366, 'height': 768})
        page = context.new_page()
        page.expose_function('launchTestCourseProtocol', launch_protocol)
        page.add_init_script("""(() => {
          const click = HTMLAnchorElement.prototype.click;
          HTMLAnchorElement.prototype.click = function () {
            if (this.protocol === 'vrteaching-course-ai:') {
              void window.launchTestCourseProtocol(this.href);
            } else {
              click.call(this);
            }
          };
        })()""")
        requests = []
        page.on('request', lambda request: requests.append(request.url)
                if request.url.startswith(('http://', 'https://')) else None)
        page.goto(COURSE.as_uri())
        expect(lesson_action(page, 'developer-mode')).to_be_hidden()
        lesson_action(page, 'start').click()
        lesson_action(page, 'opening-next').click()
        lesson_action(page, 'next').click()
        expect(page.locator('h1')).to_have_text('岸边备桥')
        page.keyboard.press('Control+Alt+Shift+D')
        lesson_action(page, 'developer-mode').click()
        panel = page.get_by_role('dialog', name='开发者模式')
        expect(panel.get_by_role('status')).to_have_text('后端未连接')
        assert not requests
        snapshot = page.evaluate("sessionStorage.getItem('long-march-lesson')")
        start = panel.get_by_role('button', name='启动后端')
        start.click()
        expect(start).to_be_disabled()
        expect(panel.get_by_role('status')).to_have_text('后端已连接', timeout=23000)
        assert len(schemes) == 1 and len(context.pages) == 1
        assert page.url == COURSE.as_uri()
        assert snapshot == page.evaluate("sessionStorage.getItem('long-march-lesson')")
        expect(page.locator('h1')).to_have_text('岸边备桥')
        expect(lesson_action(page, 'ai-director')).to_be_visible()
        page.screenshot(path=output / '当前课页接入.png')

        start.click()
        expect(start).to_be_disabled()
        expect(panel.get_by_role('status')).to_have_text('后端已连接', timeout=23000)
        assert len(schemes) == 2 and len(context.pages) == 1
        page.keyboard.press('Control+Alt+Shift+D')
        expect(lesson_action(page, 'developer-mode')).to_be_hidden()
        expect(panel).to_be_hidden()
        lesson_action(page, 'ai-director').click()
        dock = page.locator('.harness-director-bar')
        question = '打开黎平的「进军方向」课页，并对照当时的两条路线。'
        dock.locator('.harness-input').fill(question)
        with page.expect_response(lambda response: response.url.endswith('/api/course-ai/director'), timeout=45000) as reply:
            dock.locator('.harness-submit').click()
        assert reply.value.ok, f'模型接口返回 HTTP {reply.value.status}: {reply.value.json().get("code")}'
        expect(lesson_action(page, 'director-confirm')).to_be_visible()
        narration = dock.locator('[data-current-message] .harness-status-line').inner_text()
        expect(page.locator('h1')).to_have_text('岸边备桥')
        lesson_action(page, 'director-confirm').click()
        expect(page.locator('h1')).to_have_text('进军方向')
        page.screenshot(path=output / '真实模型联动.png')
        lesson_action(page, 'ai-director').click()
        expect(dock.locator('.harness-director-user').first).to_have_text(question)
        expect(dock.locator('.harness-status-line').first).to_have_text(narration)
        expect(lesson_action(page, 'director-confirm')).to_be_hidden()
        dock.locator('.harness-input').fill('刚才那两条各自往哪里走？请只回答，保持当前课页。')
        with page.expect_response(lambda response: response.url.endswith('/api/course-ai/director'), timeout=45000) as follow_up:
            dock.locator('.harness-submit').click()
        assert follow_up.value.ok, f'追问接口返回 HTTP {follow_up.value.status}: {follow_up.value.json().get("code")}'
        expect(dock.locator('[data-current-message] .harness-status-line')).to_have_text(
            re.compile(r'(?=.*湘西北)(?=.*(?:黔北|贵州北部))'))
        expect(lesson_action(page, 'director-confirm')).to_be_hidden()
        expect(page.locator('h1')).to_have_text('进军方向')
        page.screenshot(path=output / '真实模型跨页续问.png', animations='disabled')
        report = {'passed': True, 'browser': browser.version, 'same_tab': True, 'same_progress': True,
                  'protocol_dispatched_by_windows_shell': True, 'real_model': True, 'cross_page_memory': True}
        (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
        print(output / 'report.json')
        browser.close()


if __name__ == '__main__':
    main()
