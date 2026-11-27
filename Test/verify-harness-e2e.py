"""真实 Edge 端到端验收：
1. 纯离线单文件打开：0 网络请求、0 假 AI 输入框、0 AI 按钮残留。
2. 连接课堂 AI 网关后：
   - AI 实景副导：口令驱动自动跳转「进军方向」并双线对照 + 纪实播报条
   - 1934 战地推演沙盘：SVG 红色假设推演轨迹 + 受阻红区脉动环 + 密电简报 + 一键对照真实抉择
   - 遵义会议桌 3D 现场：1935 会场质询 + 持证回应触发 3D 破晓光影推进与卷宗高亮
   - 课尾「千班千面」实训复盘简报：生成面向国网岗位的实战映射简报
"""

from pathlib import Path
import argparse
import json
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
            expect(bar.locator('.harness-badge')).to_have_text('AI 实景副导')
            bar_text = bar.inner_text().lower()
            for forbidden in ('opencode', 'vercel', 'deepseek', 'mock-harness'):
                assert forbidden not in bar_text, f'界面不应暴露模型或技术栈字样：{forbidden} -> {bar_text}'
            bar_box = bar.bounding_box()
            assert bar_box and bar_box['x'] >= 1366 * 0.55 and bar_box['y'] <= 150, f'AI 副导卡片应位于右上角：{bar_box}'
            page.screenshot(path=OUT / '0-AI副导右上卡片.png')

            page.locator('.harness-director-bar .harness-input').fill(
                '请切换到黎平的「进军方向」课页，同时对照湘西北原计划和改向贵州北部的两条路线。'
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
            page.locator('.harness-director-bar .harness-submit').click()
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

            # ② 1934 战地推演沙盘：推演「强攻湘西北」绘制红线与阻击区
            sandbox_btn = lesson_action(page, 'liping-sandbox')
            expect(sandbox_btn).to_be_visible()
            sandbox_btn.click()
            expect(page.locator('.sandbox-panel')).to_be_visible()
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
                bar.get_by_role('button', name='进入遵义会议桌翻看卷宗').click()
            expect(page.locator('h1')).to_have_text('会议桌上的两份材料', timeout=ai_timeout)
            expect(page.locator('.desk-live-frame')).to_have_attribute('data-space', 'ready', timeout=30000)
            expect(page.locator('.desk-live-frame')).to_have_attribute('data-reading', 'dossier')
            page.keyboard.press('Escape')
            expect(page.locator('.desk-live-frame')).to_have_attribute('data-reading', '')
            debate_btn = lesson_action(page, 'zunyi-debate')
            expect(debate_btn).to_be_visible()
            debate_btn.click()
            expect(page.locator('.debate-panel')).to_be_visible()
            expect(page.locator('.debate-message')).to_be_visible(timeout=ai_timeout)
            question = page.locator('.debate-message').inner_text()
            left_book = page.locator('.debate-actions').get_by_role('button', name='翻看左册 · 会前形势')
            if left_book.is_visible():
                left_book.click()
            else:
                page.locator('.debate-panel').get_by_role('button', name='收起').click()
                page.get_by_role('button', name='翻阅左册 · 会前形势').click()
            expect(page.locator('.debate-panel')).to_be_hidden()
            expect(page.locator('.desk-live-frame')).to_have_attribute('data-reading', 'journal')
            page.keyboard.press('Escape')
            debate_btn.click()
            expect(page.locator('.debate-message')).to_have_text(question)
            page.locator('.debate-panel .harness-input').fill(
                '黎平改向解决了当时走哪条路线的问题。遵义会议依据第五次反围剿和长征初期的实际失利，'
                '纠正脱离实际的军事指挥，增选毛泽东为常委并调整领导分工，让军事纠偏有明确的组织责任并能持续落实。'
            )
            with page.expect_request(lambda req: req.method == 'POST' and req.url.endswith('/zunyi-debate')) as reply:
                page.locator('.debate-panel .harness-submit').click()
            assert reply.value.post_data_json['question'] == question
            assert set(reply.value.post_data_json['seenObjects']) == {'dossier', 'journal'}
            expect(page.locator('.debate-message[data-accepted="true"]')).to_be_visible(timeout=ai_timeout)
            expect(page.locator('.desk-live-frame')).to_have_attribute('data-dawn', 'resolved')
            page.screenshot(path=OUT / '3-遵义3D持证辩论破晓.png')

            # ④ 课尾「千班千面」实训复盘简报
            for _ in range(4):
                if page.locator('h1').inner_text().strip() == '遵义会议的转折意义':
                    break
                lesson_action(page, 'next').click()
            button(page, '课堂回顾').click()
            expect(page.locator('.recap-stage')).to_be_visible()
            report_btn = lesson_action(page, 'recap-report')
            expect(report_btn).to_be_visible()
            report_btn.click()
            dialog = page.locator('dialog[open]')
            expect(dialog).to_be_visible()
            dialog.get_by_role('button', name='特高压运维').click()
            dialog.locator('.harness-submit').click()
            expect(dialog.locator('.report-card').first).to_be_visible(timeout=60000 if live else ai_timeout)
            expect(dialog.get_by_role('heading', name='历史抉择对照')).to_be_visible()
            page.screenshot(path=OUT / '4-课尾实训复盘简报.png')
            dialog.get_by_role('button', name='配网抢修').click()
            with page.expect_download() as result:
                dialog.get_by_role('button', name='导出归档 HTML').click()
            assert '特高压运维' in result.value.suggested_filename
            archive = result.value.path().read_text(encoding='utf-8')
            assert '岗位方向：特高压运维' in archive

            assert not errors, f'浏览器运行时报错：{errors}'
            browser.close()
            return health['model']
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()


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
        'mode': 'live' if args.live else 'mock',
        'model': model,
        'screenshots': [
            str(OUT / '0-AI副导右上卡片.png'),
            str(OUT / '1-AI实景副导联动黎平.png'),
            str(OUT / '2-黎平战地沙盘推演.png'),
            str(OUT / '3-遵义3D持证辩论破晓.png'),
            str(OUT / '4-课尾实训复盘简报.png'),
        ],
    }
    (OUT / 'report.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding='utf-8')
    print('VERIFY_COURSE_AI_EDGE_PASS')
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
