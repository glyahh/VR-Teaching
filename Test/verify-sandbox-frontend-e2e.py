"""独立 3D 沙盘前端全流程端到端 Edge 验收（不修改后端，适配 --mock-harness 与纯离线）。

覆盖：
1. 纯离线单文件打开：进「进军方向」时「沙盘推演」隐藏，0 外部网络请求。
2. 连接网关：
   - 「沙盘推演」居中位于「推演原计划 · 湘西北」与「推演新方向 · 贵州北部」之间
   - 进入独立全屏 3D 沙盘页：隐藏「行迹副导」、默认展开右侧浅暖栏、暖灰石地形主题激活
   - 多视口截图（1920x1080、1366x768、718x811）
   - 上传 .txt 附件 + 多轮不同方向推演（含超图幅边界）、流式上屏与 3D 路径联动、对照真实黔北路线
   - 回档：撤回 3D 态势栈且聊天区 DOM 条数与正文零变化、下轮请求携带 rolled_back 静默同步标记
   - 还原：弹窗确认后恢复 1934.12 黎平初态且聊天保留、下轮请求携带 restored 静默同步标记
   - 跨页往返 + F5 刷新完整恢复对话与 3D 态势
   - 网关断连驻留当前页并锁定发送，恢复后可用
   - 清空：弹窗确认后清除沙盘对话与地图且不误伤「行迹副导」历史
   - 返回首页地图验证地形主题复位 'overview'
"""

from pathlib import Path
import json
import socket
import subprocess
import sys
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'Test'))

from playwright.sync_api import expect, sync_playwright
from course_cli import COURSE, launch, lesson_action

OUT = ROOT / '.march-build' / 'verify-sandbox-frontend'
OUT.mkdir(parents=True, exist_ok=True)


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


def goto_liping_directions(page):
  lesson_action(page, 'start').click()
  lesson_action(page, 'opening-next').click()
  expect(page.locator('h1')).to_have_text('于都集结')
  lesson_action(page, 'chapter-2').click()
  expect(page.locator('h1')).to_have_text('黎平翘街')
  lesson_action(page, 'next').click()
  expect(page.locator('h1')).to_have_text('进军方向')


def verify_pure_offline():
  requests_seen = []
  with launch(COURSE, {'width': 1366, 'height': 768}) as (context, url, _edge, errors):
    page = context.new_page()
    page.on('request', lambda req: requests_seen.append(req.url) if req.url.startswith(('http://', 'https://')) else None)
    page.goto(url)
    expect(page.locator('.map .terrain-surface.is-relief')).to_be_visible(timeout=20000)
    goto_liping_directions(page)
    expect(lesson_action(page, 'liping-sandbox')).to_be_hidden()
    expect(lesson_action(page, 'direction-east')).to_be_visible()
    expect(lesson_action(page, 'direction-west')).to_be_visible()
    assert not errors, f'离线模式出现页面异常：{errors}'
  assert not requests_seen, f'纯离线模式产生外部请求：{requests_seen}'
  print('[OK] 纯离线模式验证通过：沙盘入口隐藏且 0 网络请求')


def verify_connected_sandbox():
  with socket.socket() as listener:
    listener.bind(('127.0.0.1', 0))
    port = listener.getsockname()[1]
  harness_url = f'http://127.0.0.1:{port}'
  server = ROOT / '课堂演示' / 'harness' / 'course-ai-server.mjs'
  proc = subprocess.Popen(
    ['node', str(server), '--port', str(port), '--mock-harness'],
    cwd=str(ROOT),
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
  )
  try:
    health = wait_harness(harness_url)
    assert health['ok'] is True

    with sync_playwright() as p:
      browser = p.chromium.launch(channel='msedge', headless=True, args=['--enable-unsafe-swiftshader'])
      context = browser.new_context(viewport={'width': 1920, 'height': 1080})
      errors = []
      context.on('weberror', lambda ev: errors.append(str(ev.error)))

      page = context.new_page()
      page.goto(f'{COURSE.as_uri()}?ai={harness_url}')
      expect(page.locator('.map .terrain-surface.is-relief')).to_be_visible(timeout=20000)

      # 先在「行迹副导」留一条对话用于隔离验证
      goto_liping_directions(page)
      director_btn = lesson_action(page, 'ai-director')
      expect(director_btn).to_be_visible(timeout=8000)
      director_btn.click()
      page.locator('.harness-director-bar .harness-input').fill('只回答：请保持在当前进军方向页。')
      page.locator('.harness-director-bar .harness-submit').click()
      expect(page.locator('.harness-director-bar')).to_have_attribute('data-turn', 'reply', timeout=10000)
      page.keyboard.press('Escape')

      # 1. 验证三个按钮严格居中水平排列
      east = lesson_action(page, 'direction-east')
      sandbox_entry = lesson_action(page, 'liping-sandbox')
      west = lesson_action(page, 'direction-west')
      expect(sandbox_entry).to_be_visible(timeout=8000)
      east_box = east.bounding_box()
      mid_box = sandbox_entry.bounding_box()
      west_box = west.bounding_box()
      assert east_box and mid_box and west_box
      assert east_box['x'] + east_box['width'] <= mid_box['x'] + 2, f'沙盘按钮应在东线右侧：{east_box} vs {mid_box}'
      assert mid_box['x'] + mid_box['width'] <= west_box['x'] + 2, f'沙盘按钮应在西线左侧：{mid_box} vs {west_box}'
      assert abs(east_box['y'] - mid_box['y']) < 4 and abs(mid_box['y'] - west_box['y']) < 4, '三按钮应在同一排水平对齐'

      # 2. 进入独立 3D 沙盘全屏页（1920x1080 与 1366x768）
      sandbox_entry.click()
      expect(page.locator('.sandbox-shell')).to_be_visible()
      expect(page.locator('.sandbox-title')).to_have_text('黎平战地沙盘')
      expect(page.locator('.sandbox-dock')).to_be_visible()
      expect(lesson_action(page, 'ai-director')).to_have_count(0)
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-theme', 'sandbox')
      expect(page.locator('.terrain-surface.is-relief')).to_have_attribute('data-theme', 'sandbox')
      expect(page.locator('.sandbox-rally-core')).to_be_visible()
      expect(page.locator('.sandbox-blockade-ring.is-primary')).to_be_visible()
      expect(page.locator('.sandbox-ruler-tick').first).to_be_attached()
      page.wait_for_timeout(450)
      page.screenshot(path=OUT / '1-沙盘初始战前态势-1920x1080.png')

      page.set_viewport_size({'width': 1366, 'height': 768})
      page.wait_for_timeout(350)
      page.screenshot(path=OUT / '2-沙盘初始战前态势-1366x768.png')

      # 3. 上传附件 + 第1轮推演（分兵佯攻）
      with page.expect_file_chooser() as picker:
        lesson_action(page, 'sandbox-attach').click()
      picker.value.set_files({
        'name': '地形侦察备忘.txt',
        'mimeType': 'text/plain',
        'buffer': '情报摘录：通道以北山隘已有湘敌重兵设防，榕江西侧道路可隐蔽迂回。'.encode('utf-8'),
      })
      expect(page.locator('.sandbox-file-chip')).to_contain_text('地形侦察备忘.txt')
      sandbox_input = page.locator('.sandbox-input')
      sandbox_input.fill('分出一支小分队佯攻通道吸引湘敌，主力绕道榕江向西南转移')
      with page.expect_request(lambda req: req.method == 'POST' and req.url.endswith('/api/course-ai/sandbox')) as req1:
        lesson_action(page, 'sandbox-submit').click()
      body1 = req1.value.post_data_json
      assert body1['mapContext']['isInitial'] is True
      assert body1['mapContext']['actionSinceLastTurn'] == 'continue'
      assert len(body1['attachments']) == 1 and body1['attachments'][0]['name'] == '地形侦察备忘.txt'

      expect(page.locator('.sandbox-stage')).to_have_attribute('data-revision', '1', timeout=10000)
      expect(page.locator('.sandbox-msg-assistant .sandbox-action-card', has_text='对照真实黔北路线')).to_be_visible(timeout=10000)
      expect(page.locator('.sandbox-force-path').first).to_be_visible()
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-phase', 'complete', timeout=8000)
      page.wait_for_timeout(200)
      page.screenshot(path=OUT / '3-沙盘第一轮推演.png')

      # 4. 对照真实黔北路线
      page.locator('.sandbox-msg-assistant .sandbox-action-card', has_text='对照真实黔北路线').first.click()
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-real-route', 'true')
      expect(page.locator('.sandbox-real-contrast-path')).to_be_visible()
      page.wait_for_timeout(450)
      page.screenshot(path=OUT / '4-沙盘对照真实黔北路线.png')

      # 5. 第2轮推演 -> 回档验证
      sandbox_input.fill('若主力继续折向乌江北上直取遵义')
      lesson_action(page, 'sandbox-submit').click()
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-revision', '2', timeout=10000)
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-stack-depth', '3')

      user_msgs_before = page.locator('.sandbox-msg-user').all_inner_texts()
      assistant_msgs_before = page.locator('.sandbox-msg-assistant .sandbox-reply-text').all_inner_texts()

      lesson_action(page, 'sandbox-rollback').click()
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-revision', '1')
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-stack-depth', '2')
      assert page.locator('.sandbox-msg-user').all_inner_texts() == user_msgs_before, '回档不应改动聊天记录'
      assert page.locator('.sandbox-msg-assistant .sandbox-reply-text').all_inner_texts() == assistant_msgs_before, '回档不应插入可见消息'
      page.wait_for_timeout(250)
      page.screenshot(path=OUT / '5-沙盘回档后.png')

      # 第3轮请求验证静默同步标记 rolled_back
      sandbox_input.fill('向西南印度方向继续前进')
      with page.expect_request(lambda req: req.method == 'POST' and req.url.endswith('/api/course-ai/sandbox')) as req3:
        lesson_action(page, 'sandbox-submit').click()
      body3 = req3.value.post_data_json
      assert body3['mapContext']['actionSinceLastTurn'] == 'rolled_back', f"期望 rolled_back，实际 {body3['mapContext']}"
      assert body3['mapContext']['revision'] == 1
      last_reply = page.locator('.sandbox-msg-assistant').last
      expect(last_reply.locator('.sandbox-oob-note')).to_contain_text('战区西缘', timeout=10000)
      assert last_reply.locator('.sandbox-reply-text').inner_text() != last_reply.locator('.sandbox-oob-note').inner_text()

      # 6. 还原弹窗确认：恢复初态且聊天保留
      msg_count_before_restore = page.locator('.sandbox-msg-user').count()
      lesson_action(page, 'sandbox-restore').click()
      dialog = page.locator('dialog[open]')
      expect(dialog).to_be_visible()
      dialog.get_by_role('button', name='确认还原').click()
      expect(dialog).to_be_hidden()
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-revision', '0')
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-phase', 'initial')
      assert page.locator('.sandbox-msg-user').count() == msg_count_before_restore, '还原应保留聊天记录'

      sandbox_input.fill('按原计划强攻湘西北会合')
      with page.expect_request(lambda req: req.method == 'POST' and req.url.endswith('/api/course-ai/sandbox')) as req4:
        lesson_action(page, 'sandbox-submit').click()
      body4 = req4.value.post_data_json
      assert body4['mapContext']['actionSinceLastTurn'] == 'restored'
      assert body4['mapContext']['isInitial'] is True
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-stack-depth', '2', timeout=10000)
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-revision', '4')

      # 7. 跨页往返 + F5 刷新恢复
      lesson_action(page, 'sandbox-back').click()
      expect(page.locator('h1')).to_have_text('进军方向')
      lesson_action(page, 'liping-sandbox').click()
      expect(page.locator('.sandbox-shell')).to_be_visible()
      expect(page.locator('.sandbox-msg-user')).to_have_count(4)
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-stack-depth', '2')
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-revision', '4')

      page.reload()
      expect(page.locator('.sandbox-shell')).to_be_visible(timeout=15000)
      expect(page.locator('.sandbox-msg-user')).to_have_count(4)
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-stack-depth', '2')
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-revision', '4')

      # 8. 窄屏 718x811 检查（无溢出）
      page.set_viewport_size({'width': 718, 'height': 811})
      page.wait_for_timeout(300)
      assert page.locator('.sandbox-dock').evaluate('el => el.scrollWidth <= el.clientWidth + 1')
      page.screenshot(path=OUT / '7-沙盘窄屏适配-718x811.png')
      page.set_viewport_size({'width': 1366, 'height': 768})

      # 9. 网关断连驻留并锁定发送，恢复后解锁
      readiness = '**/api/course-ai/ready'
      page.route(readiness, lambda route: route.fulfill(
        status=503, headers={'Access-Control-Allow-Origin': '*'}, json={'ok': False},
      ))
      expect(page.locator('.sandbox-offline-banner')).to_be_visible(timeout=6500)
      expect(page.locator('.sandbox-shell')).to_be_visible()
      expect(lesson_action(page, 'sandbox-submit')).to_be_disabled()
      page.unroute(readiness)
      expect(page.locator('.sandbox-offline-banner')).to_be_hidden(timeout=6500)
      expect(lesson_action(page, 'sandbox-submit')).to_be_enabled()

      # 10. 清空确认：清除沙盘且不误伤行迹副导
      lesson_action(page, 'sandbox-clear').click()
      dialog = page.locator('dialog[open]')
      expect(dialog).to_be_visible()
      dialog.get_by_role('button', name='确认清空').click()
      expect(dialog).to_be_hidden()
      expect(page.locator('.sandbox-msg-user')).to_have_count(0)
      expect(page.locator('.sandbox-stage')).to_have_attribute('data-revision', '0')

      # 11. 回到进军方向检查行迹副导记录保留，并回到首页地图确认主题复位 'overview'
      lesson_action(page, 'sandbox-back').click()
      expect(page.locator('h1')).to_have_text('进军方向')
      lesson_action(page, 'ai-director').click()
      expect(page.locator('.harness-director-user').first).to_contain_text('只回答：请保持在当前进军方向页')
      page.keyboard.press('Escape')

      lesson_action(page, 'map').click()
      expect(page.locator('.map .terrain-surface.is-relief')).to_be_visible()
      expect(page.locator('.terrain-surface.is-relief')).to_have_attribute('data-theme', 'overview')
      page.wait_for_timeout(250)
      page.screenshot(path=OUT / '6-首页地图回归.png')

      assert not errors, f'沙盘页面出现运行时异常：{errors}'
      browser.close()
  finally:
    proc.terminate()
    proc.wait(timeout=5)
  print('[OK] 连接网关 3D 沙盘端到端全流程验收通过')


if __name__ == '__main__':
  verify_pure_offline()
  verify_connected_sandbox()
