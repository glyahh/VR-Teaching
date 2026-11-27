"""真实 Edge 端到端验收：
1. 纯离线单文件打开：0 网络请求、0 假 AI 输入框、0 AI 按钮残留。
2. 连接课堂 AI 网关后：
   - AI 实景副导：口令生成动作卡，确认后切换「进军方向」并显示双线对照
   - 1934 战地推演沙盘：SVG 红色假设推演轨迹 + 受阻红区脉动环 + 密电简报 + 一键对照真实抉择
   - 遵义会议桌 3D 现场：会议桌材料可翻阅，课件不挂载质询入口
   - 课尾「千班千面」实训复盘简报：生成面向国网岗位的实战映射简报
"""

from pathlib import Path
import argparse
import json
import re
import os
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'Test'))

from playwright.sync_api import expect, sync_playwright
from course_cli import COURSE, button, launch, lesson_action

OUT = ROOT / '.march-build' / 'verify-course-ai-edge'


def wait_harness(url, timeout=15):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f'{url}/api/course-ai/health', timeout=2) as resp:
                if resp.status == 200:
                    return json.loads(resp.read().decode('utf-8'))
        except Exception:
            time.sleep(0.25)
    raise RuntimeError(f'伴随服务未就绪：{url}')


def verify_pure_offline():
    requests_seen = []
    with launch(COURSE, {'width': 1366, 'height': 768}) as (context, url, edge, errors):
        page = context.new_page()
        page.on('request', lambda req: requests_seen.append(req.url) if req.url.startswith(('http://', 'https://')) else None)
        page.goto(url)
        expect(page.locator('.map .terrain-surface.is-relief')).to_be_visible(timeout=20000)
        lesson_action(page, 'start').click()
        lesson_action(page, 'opening-next').click()
        expect(page.locator('h1')).to_have_text('于都集结')
        expect(lesson_action(page, 'ai-director')).to_be_hidden()

        # 确认练习框已彻底清理旧伪 AI 输入框
        lesson_action(page, 'next').click()
        lesson_action(page, 'next').click()
        expect(page.locator('h1')).to_have_text('浮桥近景')
        page.locator('.practice-entry').click()
        expect(page.locator('.practice')).to_be_visible()
        assert page.locator('.practice-voice-input').count() == 0, '练习框中不应再存在旧伪 AI 输入框'
    assert not requests_seen, f'纯离线模式产生外部请求：{requests_seen}'
    return edge


def verify_connected_harness(live=False):
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    harness_url = f'http://127.0.0.1:{port}'
    server = ROOT / '课堂演示' / 'harness' / 'course-ai-server.mjs'
    args = ['node', str(server), '--port', str(port)]
    token = ''
    if live:
        token = subprocess.check_output([
            'node', '--input-type=module', '-e',
            "import {resolveCourseAIConfig} from './课堂演示/harness/course-ai-server.mjs'; "
            "process.stdout.write(resolveCourseAIConfig().accessToken)",
        ], cwd=ROOT, encoding='utf-8').strip()
    else:
        args.append('--mock-harness')
    ai_timeout = 40000 if live else 8000
    proc = subprocess.Popen(
        args,
        cwd=str(ROOT),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env={**os.environ, 'COURSE_AI_CONTEXT_METRICS': '1'} if live else None,
    )
    try:
        health = wait_harness(harness_url)
        assert health['ok'] is True
        assert health['engine'] == ('vercel-ai-sdk' if live else 'course-ai-mock')

        with sync_playwright() as p:
            browser = p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-swiftshader'])
            context = browser.new_context(viewport={'width': 1366, 'height': 768})
            errors = []
            context.on('weberror', lambda ev: errors.append(str(ev.error)))
            plain = context.new_page()
            plain_requests = []
            plain.on('request', lambda req: plain_requests.append(req.url) if req.url.startswith(('http://', 'https://')) else None)
            plain.goto(COURSE.as_uri())
            lesson_action(plain, 'start').click()
            lesson_action(plain, 'opening-next').click()
            expect(lesson_action(plain, 'ai-director')).to_be_hidden()
            assert not plain_requests, f'直接打开课件时发出了 HTTP 请求：{plain_requests}'
            plain.close()

            page = context.new_page()
            url = f'{COURSE.as_uri()}?ai={harness_url}'
            page.goto(f'{url}#ai-access={token}' if token else url)
            expect(page.locator('.map .terrain-surface.is-relief')).to_be_visible(timeout=20000)

            lesson_action(page, 'start').click()
            lesson_action(page, 'opening-next').click()
            expect(page.locator('h1')).to_have_text('于都集结')

            # ① AI 实景副导：唤醒至右上区域、清理模型与技术标识，并用指令切到黎平「进军方向」并双线对照
            director_btn = lesson_action(page, 'ai-director')
            expect(director_btn).to_be_visible(timeout=8000)
            director_btn.click()
            bar = page.locator('.harness-director-bar')
            expect(bar).to_be_visible()
            expect(bar.locator('.harness-badge')).to_have_text('行迹副导')
            expect(director_btn).to_have_text('行迹副导')
            bar_text = bar.inner_text().lower()
            for forbidden in ('opencode', 'vercel', 'deepseek', 'mock-harness'):
                assert forbidden not in bar_text, f'界面不应暴露模型或技术栈字样：{forbidden} -> {bar_text}'
            page.wait_for_function("""() => {
                const panel = document.querySelector('.harness-director-bar').getBoundingClientRect();
                const toolbar = document.querySelector('.scene-actions').getBoundingClientRect();
                return Math.abs(panel.top - toolbar.bottom - 8) < 3;
            }""")
            bar_box = bar.bounding_box()
            assert bar_box and bar_box['x'] >= 1366 * 0.55 and bar_box['y'] <= 150, f'AI 副导卡片应位于右上角：{bar_box}'
            page.screenshot(path=OUT / '0-AI副导右上卡片.png')

            director_input = bar.locator('textarea.harness-input')
            expect(director_input).to_be_visible()
            expect(bar.locator('.harness-director-voice-status,.harness-director-progress')).to_have_count(0)
            assert bar.evaluate("""dock => {
                const center = selector => { const box = dock.querySelector(selector).getBoundingClientRect(); return box.top + box.height / 2; };
                const plus = dock.querySelector('[data-lesson-action=director-attach]').getBoundingClientRect();
                const capsule = dock.querySelector('.harness-director-composer').getBoundingClientRect();
                return Math.abs(center('[data-lesson-action=director-clear]') - center('.harness-director-head-actions button:last-child')) < 1
                  && Math.abs(center('[data-lesson-action=director-attach]') - center('.harness-submit')) < 1
                  && plus.left > capsule.left + 4 && plus.top > capsule.top + 3 && plus.bottom < capsule.bottom - 3;
            }""")
            director_input.fill('第一行')
            director_input.press('Shift+Enter')
            expect(director_input).to_have_value('第一行\n')
            director_input.fill('\n'.join(f'第 {index} 行：核对课堂线索' for index in range(1, 12)))
            assert director_input.evaluate("""input => {
                const style = getComputedStyle(input);
                const height = input.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
                return Math.abs(height / parseFloat(style.lineHeight) - 3) < .1
                  && input.scrollHeight > input.clientHeight;
            }""")
            director_input.evaluate('(input) => { input.scrollTop = 0; }')
            director_input.hover()
            page.mouse.wheel(0, 560)
            page.wait_for_function("document.querySelector('textarea.harness-input').scrollTop > 0")
            page.screenshot(path=OUT / '9-AI副导多行输入.png')
            director_input.fill('')

            button(page, '全屏').click()
            page.wait_for_function('document.fullscreenElement !== null')
            expect(page.get_by_role('button', name=re.compile('语音|麦克风'))).to_have_count(0)
            director_input.fill('全屏文字输入')
            expect(director_input).to_have_value('全屏文字输入')
            button(page, '退出全屏').click()
            page.wait_for_function('document.fullscreenElement === null')

            page.locator('.harness-director-bar .harness-input').fill(
                '请切换到黎平的「进军方向」课页，同时对照湘西北原计划和改向贵州北部的两条路线。'
                if live else '带我看黎平的两条路线'
            )
            if not live:
                first_failure = '当前 AI 服务额度已用完，请稍后重试。'
                page.route('**/api/course-ai/director', lambda route: route.fulfill(
                    status=429, headers={'Access-Control-Allow-Origin': '*'},
                    json={'ok': False, 'message': first_failure},
                ), times=1)
                page.locator('.harness-director-bar .harness-submit').click()
                expect(bar.locator('.harness-status-line')).to_have_text(first_failure)
                expect(page.locator('h1')).to_have_text('于都集结')
            bar.evaluate("""dock => {
                const observer = new MutationObserver(() => {
                    const text = dock.querySelector('[data-current-message] .harness-status-line')?.textContent;
                    if (dock.dataset.turn === 'working' && text
                      && !dock.querySelector('[data-lesson-action="director-confirm"]')) {
                        window.directorPartialBeforeResult = true;
                        observer.disconnect();
                    }
                });
                observer.observe(dock, {childList:true, subtree:true, attributes:true});
            }""")
            if not live:
                pending = []
                page.route('**/api/course-ai/director', lambda route: pending.append(route), times=1)
                bar.locator('form').evaluate("""form => form.addEventListener('submit', () => {
                    const bubble = form.closest('section').querySelector('.harness-director-user[data-current-message]');
                    window.directorBubbleBounced = bubble.getAnimations().some(animation =>
                      animation.effect.getKeyframes().some(frame => frame.transform?.includes('scale(1.025)')));
                }, {once:true})""")
                bar.locator('.harness-submit').click()
                assert page.evaluate('window.directorBubbleBounced === true')
                expect(bar.locator('.harness-submit')).to_be_disabled()
                expect(lesson_action(page, 'director-confirm')).to_be_hidden()
                has_working_motion = """el => el.getAnimations({subtree:true})
                    .some(animation => animation.effect.getTiming().iterations === Infinity)"""
                assert bar.evaluate(has_working_motion)
                assert bar.locator('.harness-director-reply[data-current-message] .icon path:last-child').evaluate("""needle => {
                    const loop = needle.getAnimations().find(animation => animation.animationName === 'director-needle-loop');
                    return getComputedStyle(needle).transformBox === 'view-box'
                      && loop?.effect.getKeyframes().every(frame => frame.easing === 'linear');
                }""")
                page.emulate_media(reduced_motion='reduce')
                assert not bar.evaluate(has_working_motion)
                page.screenshot(path=OUT / '7-AI副导处理中.png', animations='disabled')
                page.emulate_media(reduced_motion='no-preference')
                assert len(pending) == 1
                pending[0].continue_()
            else:
                bar.locator('.harness-submit').click()
            confirm = lesson_action(page, 'director-confirm')
            expect(confirm).to_be_visible(timeout=ai_timeout)
            assert page.evaluate('window.directorPartialBeforeResult === true')
            expect(page.locator('h1')).to_have_text('于都集结')
            original_reply = bar.locator('[data-current-message] .harness-status-line').inner_text()
            original_question = bar.locator('.harness-director-user').last.inner_text()
            page.screenshot(path=OUT / '5-AI副导动作确认.png', animations='disabled')
            if not live:
                expect(confirm).to_contain_text('对照黎平路线')
                page.set_viewport_size({'width': 430, 'height': 760})
                expect(confirm).to_be_in_viewport()
                assert bar.evaluate('(el) => el.scrollWidth <= el.clientWidth')
                page.screenshot(path=OUT / '6-AI副导窄窗.png', animations='disabled')
                page.set_viewport_size({'width': 1366, 'height': 768})
                page.keyboard.press('Escape')
                expect(bar).to_be_hidden()
                expect(director_btn).to_be_focused()
                expect(page.locator('h1')).to_have_text('于都集结')
                director_btn.click()
                expect(confirm).to_be_hidden()
                bar.locator('.harness-input').fill('对照黎平双线与转向贵州')
                bar.locator('.harness-input').press('Enter')
                expect(confirm).to_be_visible(timeout=ai_timeout)
            confirm.click()
            expect(page.locator('h1')).to_have_text('进军方向', timeout=ai_timeout)
            banner = page.locator('.harness-director-banner')
            expect(banner).to_be_visible(timeout=8000)
            banner_box = banner.bounding_box()
            assert banner_box and banner_box['x'] >= 1366 * 0.55 and banner_box['y'] <= 150, f'AI 副导播报条应位于右上角：{banner_box}'
            deck_box = page.locator('.tabletop-deck').bounding_box()
            assert deck_box and not (
                banner_box['x'] < deck_box['x'] + deck_box['width']
                and banner_box['x'] + banner_box['width'] > deck_box['x']
                and banner_box['y'] < deck_box['y'] + deck_box['height']
                and banner_box['y'] + banner_box['height'] > deck_box['y']
            ), f'播报条与黎平按钮组不应重叠：banner={banner_box}, deck={deck_box}'
            page.screenshot(path=OUT / '1-AI实景副导联动黎平.png')

            lesson_action(page, 'ai-director').click()
            expect(bar.locator('.harness-director-user').first).to_have_text(original_question)
            expect(bar.locator('.harness-status-line').first).to_have_text(original_reply)
            expect(confirm).to_be_hidden()
            follow_up = '刚才那两条各自往哪里走？请只回答，保持当前课页。'
            bar.locator('.harness-input').fill(follow_up)
            bar.locator('.harness-submit').click()
            expect(bar.locator('[data-current-message] .harness-status-line')).to_have_text(
                re.compile(r'(?=.*湘西北)(?=.*(?:黔北|贵州北部))'), timeout=ai_timeout)
            expect(confirm).to_be_hidden()
            expect(page.locator('h1')).to_have_text('进军方向')
            if not live:
                ledger_events = page.evaluate("JSON.parse(sessionStorage.getItem('long-march-classroom-events')).events")
                inputs = {event['interactionId']: event['data'] for event in ledger_events if event['kind'] == 'input'}
                outcomes = {
                    inputs[event['interactionId']]['utterance']: {item['outcome'] for item in event['data']['results']}
                    for event in ledger_events if event['route'] == 'director' and event['kind'] == 'operations'
                }
                assert outcomes[original_question] == {'cancelled'}
                assert outcomes['对照黎平双线与转向贵州'] == {'succeeded'}
            page.screenshot(path=OUT / '8-AI副导跨页续问.png', animations='disabled')
            page.keyboard.press('Escape')
            expect(bar).to_be_hidden()
            if not live:
                page.reload()
                expect(page.locator('h1')).to_have_text('进军方向')
                lesson_action(page, 'ai-director').click()
                expect(bar.locator('.harness-director-user').filter(has_text=follow_up)).to_be_visible()
                expect(confirm).to_be_hidden()
                page.keyboard.press('Escape')

            # ② 1934 战地推演沙盘：推演「强攻湘西北」绘制红线与阻击区
            sandbox_btn = lesson_action(page, 'liping-sandbox')
            expect(sandbox_btn).to_be_visible()
            sandbox_btn.click()
            expect(page.locator('.sandbox-panel')).to_be_visible()
            expect(page.locator('.sandbox-panel').get_by_role('button', name=re.compile('语音|麦克风'))).to_have_count(0)
            page.locator('.sandbox-panel .harness-input').fill('按原计划强攻湘西北与二六军团会合')
            page.locator('.sandbox-panel .harness-submit').click()
            expect(page.locator('.sandbox-hypothesis-tag')).to_be_visible(timeout=ai_timeout)
            expect(page.locator('.sandbox-sim-path')).to_be_visible()
            expect(page.locator('.sandbox-choke-badge')).to_be_visible()
            page.screenshot(path=OUT / '2-黎平战地沙盘推演.png')

            # 一键对照真实历史抉择
            page.locator('.sandbox-restore-btn').click()
            expect(page.locator('.sandbox-panel')).to_be_hidden()
            expect(lesson_action(page, 'direction-west')).to_have_attribute('aria-pressed', 'true')

            # ③ 遵义会议桌 3D 现场：1935 会场质询与持证回应推进破晓光影
            lesson_action(page, 'ai-director').click()
            if live:
                bar.locator('.harness-input').fill('打开遵义会议桌上的右册「会议讨论」。')
                bar.locator('.harness-submit').click()
            else:
                bar.get_by_role('button', name='打开遵义会议桌').click()
            expect(lesson_action(page, 'director-confirm')).to_be_visible(timeout=ai_timeout)
            expect(page.locator('h1')).to_have_text('进军方向')
            lesson_action(page, 'director-confirm').click()
            expect(page.locator('h1')).to_have_text('会议桌上的两份材料', timeout=ai_timeout)
            expect(page.locator('.desk-live-frame')).to_have_attribute('data-space', 'ready', timeout=30000)
            expect(page.locator('.desk-live-frame')).to_have_attribute('data-reading', 'dossier')
            page.keyboard.press('Escape')
            expect(page.locator('.desk-live-frame')).to_have_attribute('data-reading', '')
            expect(lesson_action(page, 'zunyi-debate')).to_have_count(0)
            expect(page.locator('.debate-panel')).to_have_count(0)
            page.get_by_role('button', name='翻阅左册 · 会前形势').click()
            expect(page.locator('.desk-live-frame')).to_have_attribute('data-reading', 'journal')
            page.screenshot(path=OUT / '3-遵义会议桌材料.png')
            page.keyboard.press('Escape')
            # ③ 课尾「千班千面」实训复盘简报
            for _ in range(4):
                if page.locator('h1').inner_text().strip() == '遵义会议的转折意义':
                    break
                lesson_action(page, 'next').click()
            if live:
                button(page, '课堂回顾').click()
            else:
                lesson_action(page, 'ai-director').click()
                bar.locator('.harness-input').fill('打开课堂回顾')
                bar.locator('.harness-submit').click()
                expect(confirm).to_be_visible(timeout=ai_timeout)
                confirm.click()
            expect(page.locator('.recap-stage')).to_be_visible()
            lesson_action(page, 'ai-director').click()
            expect(bar.locator('.harness-director-user').filter(has_text=follow_up)).to_be_visible()
            expect(confirm).to_be_hidden()
            page.keyboard.press('Escape')
            report_btn = lesson_action(page, 'recap-report')
            expect(report_btn).to_be_visible()
            report_btn.click()
            dialog = page.locator('dialog[open]')
            expect(dialog).to_be_visible()
            dialog.get_by_role('button', name='特高压运维').click()
            dialog.locator('.harness-submit').click()
            report_card = dialog.locator('.report-card').first
            if live:
                report_error = dialog.locator('.sandbox-error')
                expect(report_card.or_(report_error)).to_be_visible(timeout=65000)
                if report_error.is_visible():
                    expect(report_error).to_have_text(re.compile('响应超时|结果格式不完整'))
                    print('LIVE_RETRY: 通过课件入口重试复盘一次')
                    dialog.locator('.harness-submit').click()
            expect(report_card).to_be_visible(timeout=65000 if live else ai_timeout)
            expect(dialog.get_by_role('heading', name='历史抉择对照')).to_be_visible()
            page.screenshot(path=OUT / '4-课尾实训复盘简报.png')
            dialog.get_by_role('button', name='配网抢修').click()
            with page.expect_download() as result:
                dialog.get_by_role('button', name='导出归档 HTML').click()
            assert '特高压运维' in result.value.suggested_filename
            archive = result.value.path().read_text(encoding='utf-8')
            assert '岗位方向：特高压运维' in archive

            readiness = '**/api/course-ai/ready'
            page.route(readiness, lambda route: route.fulfill(
                status=503, headers={'Access-Control-Allow-Origin': '*'}, json={'ok': False},
            ))
            expect(report_btn).to_be_hidden(timeout=6500)
            expect(dialog).to_be_hidden()
            page.unroute(readiness)
            expect(report_btn).to_be_visible(timeout=6500)

            if live:
                lesson_action(page, 'ai-director').click()
                expect(bar.locator('.harness-submit')).to_be_enabled()
                with page.expect_file_chooser() as picker:
                    lesson_action(page, 'director-attach').click()
                picker.value.set_files({
                    'name': '演示资料.txt', 'mimeType': 'text/plain', 'buffer': '本次课堂演示核对词为银杏灯塔。'.encode(),
                })
                expect(bar.locator('.harness-director-file')).to_have_text('演示资料.txt×')
                bar.locator('.harness-input').fill('附件中的课堂演示核对词是什么？只回答。')
                bar.locator('.harness-submit').click()
                expect(bar).to_have_attribute('data-turn', 'reply', timeout=45000)
                expect(bar.locator('[data-current-message] .harness-status-line')).to_contain_text('银杏灯塔')
                page.screenshot(path=OUT / '12-真实模型读取附件.png')
                page.keyboard.press('Escape')

            if not live:
                lesson_action(page, 'ai-director').click()
                expect(bar.locator('.harness-submit')).to_be_enabled()
                marker_count = bar.locator('.harness-director-user:visible').count() + 1
                page.route('**/api/course-ai/director/compact', lambda route: route.fulfill(
                    headers={'Access-Control-Allow-Origin': '*'},
                    json={'ok': True, 'version': 1, 'turnCount': marker_count},
                ), times=1)
                with page.expect_file_chooser() as picker:
                    lesson_action(page, 'director-attach').click()
                picker.value.set_files({
                    'name': '课堂记录.txt', 'mimeType': 'text/plain', 'buffer': '词条：课堂研讨。'.encode(),
                })
                expect(bar.locator('.harness-director-file')).to_have_text('课堂记录.txt×')
                bar.locator('.harness-input').fill('打开课堂回顾')
                with page.expect_request(lambda req: req.method == 'POST' and req.url.endswith('/api/course-ai/director')) as uploaded:
                    bar.locator('.harness-submit').click()
                assert uploaded.value.post_data_json['attachments'] == [{'name': '课堂记录.txt', 'text': '词条：课堂研讨。'}]
                expect(bar.locator('.harness-director-divider')).to_have_text('上下文已经完成压缩')
                page.screenshot(path=OUT / '11-上下文已经完成压缩.png')
                with page.expect_response(lambda res: res.url.endswith('/director/clear') and res.ok):
                    lesson_action(page, 'director-clear').click()
                expect(bar.locator('.harness-director-chat')).to_be_hidden()
                expect(page.locator('h1')).to_have_text('课堂回顾')
                page.keyboard.press('Escape')
                lesson_action(page, 'ai-director').click()
                expect(bar.locator('.harness-submit')).to_be_enabled()
                expect(bar.locator('.harness-director-chat')).to_be_hidden()
                page.keyboard.press('Escape')

                diagnostics = []
                page.on('console', lambda message: diagnostics.append(message.text) if message.type == 'warning' else None)
                original_session = page.evaluate("sessionStorage.getItem('long-march-director-session')")
                page.evaluate("""() => {
                    window.originalSetItem = Storage.prototype.setItem;
                    Storage.prototype.setItem = function (key, value) {
                        if (key === 'long-march-classroom-events') throw new DOMException('fixture', 'QuotaExceededError');
                        return window.originalSetItem.call(this, key, value);
                    };
                }""")
                lesson_action(page, 'ai-director').click()
                bar.locator('.harness-input').fill('打开课堂回顾')
                bar.locator('.harness-submit').click()
                expect(confirm).to_be_visible(timeout=ai_timeout)
                assert any('浏览器保存失败' in warning for warning in diagnostics)
                assert page.evaluate("sessionStorage.getItem('long-march-director-session')") is None
                page.keyboard.press('Escape')
                lesson_action(page, 'ai-director').click()
                expect(bar.locator('.harness-director-user').filter(has_text='打开课堂回顾').last).to_be_visible()
                page.evaluate("""() => {
                    Storage.prototype.setItem = window.originalSetItem;
                    sessionStorage.setItem('long-march-classroom-events', '{broken');
                }""")
                page.reload()
                expect(page.locator('h1')).to_have_text('课堂回顾')
                lesson_action(page, 'ai-director').click()
                expect(bar.locator('.harness-submit')).to_be_enabled()
                expect(bar.locator('.harness-director-chat')).to_be_hidden()
                assert page.evaluate("sessionStorage.getItem('long-march-director-session')") != original_session

            assert not errors, f'浏览器运行时报错：{errors}'
            browser.close()
            return health['model']
    finally:
        proc.terminate()
        try:
            logs, _ = proc.communicate(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
            logs, _ = proc.communicate()
        if live:
            marker = '[课堂模型用量] '
            metrics = [json.loads(line.split(marker, 1)[1]) for line in logs.decode('utf-8', errors='replace').splitlines()
                       if marker in line]
            (OUT / 'model-usage.json').write_text(json.dumps(metrics, ensure_ascii=False, indent=2), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--live', action='store_true', help='使用本机配置的真实模型')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    global OUT
    if args.output:
        OUT = args.output
    elif args.live:
        OUT = OUT.with_name(OUT.name + '-live')
    OUT.mkdir(parents=True, exist_ok=True)
    edge = verify_pure_offline()
    model = verify_connected_harness(args.live)
    summary = {
        'edge': edge,
        'offline_verified': True,
        'harness_e2e_verified': True,
        'cross_page_memory': True,
        'voice_input_removed': True,
        'mode': 'live' if args.live else 'mock',
        'model': model,
        'screenshots': [
            str(OUT / '0-AI副导右上卡片.png'),
            str(OUT / '1-AI实景副导联动黎平.png'),
            str(OUT / '2-黎平战地沙盘推演.png'),
            str(OUT / '3-遵义会议桌材料.png'),
            str(OUT / '4-课尾实训复盘简报.png'),
            str(OUT / '5-AI副导动作确认.png'),
            *([str(OUT / '6-AI副导窄窗.png'), str(OUT / '7-AI副导处理中.png')] if not args.live else []),
            str(OUT / '8-AI副导跨页续问.png'),
            str(OUT / '9-AI副导多行输入.png'),
            *([str(OUT / '11-上下文已经完成压缩.png')] if not args.live else []),
            *([str(OUT / '12-真实模型读取附件.png')] if args.live else []),
        ],
    }
    (OUT / 'report.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print('VERIFY_COURSE_AI_EDGE_PASS')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
