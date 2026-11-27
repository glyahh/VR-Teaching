type CourseDeveloperHandoff = {
  nonce: string;
  reason?: string;
  gatewayUrl?: string;
  expiresAt?: number;
  proof?: string;
};

const courseDeveloper = (() => {
  const available = location.protocol === 'file:' && location.hash !== '#desk'
    && /^Win/i.test(navigator.platform)
    && location.pathname.endsWith('/' + encodeURIComponent('从于都到遵义-课堂演示.html'));
  let revealed = false;
  let panel: HTMLDialogElement | undefined;
  let opener: HTMLButtonElement | undefined;
  const failures: Record<string, string> = {
    'no-model-config': '模型配置缺失。请检查本机课堂 AI 配置。',
    'missing-dependencies': '缺少网关依赖。请先安装课堂网关依赖。',
    'port-in-use': '网关端口已被其他服务占用。请释放端口或修改配置。',
    'invalid-port': '网关端口配置无效。',
    'start-failed': '后端启动失败。请检查本机网关日志。',
    timeout: '后端启动超时，请重试。',
  };

  function waitForHandoff(nonce: string): Promise<CourseDeveloperHandoff | undefined> {
    return new Promise(resolve => {
      let script: HTMLScriptElement | undefined;
      let retry = 0;
      let attempt = 0;
      const finish = (result?: CourseDeveloperHandoff) => {
        clearTimeout(deadline);
        clearTimeout(retry);
        if (script) script.onload = script.onerror = null;
        script?.remove();
        window.removeEventListener('course-ai-dev-handoff', receive);
        resolve(result);
      };
      const receive = (event: Event) => {
        if (!(event instanceof CustomEvent) || event.detail?.nonce !== nonce) return;
        finish(event.detail);
      };
      const fetchFile = () => {
        script = document.createElement('script');
        script.src = `harness/.activation/${nonce}.js?attempt=${attempt++}`;
        script.onload = script.onerror = () => {
          script?.remove();
          retry = window.setTimeout(fetchFile, 500);
        };
        document.head.append(script);
      };
      const deadline = window.setTimeout(finish, 20000);
      window.addEventListener('course-ai-dev-handoff', receive);
      retry = window.setTimeout(fetchFile, 450);
    });
  }

  async function attach(handoff: CourseDeveloperHandoff) {
    const base = handoff.gatewayUrl;
    if (!base || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(base)
      || !handoff.expiresAt || handoff.expiresAt <= Date.now()) return false;
    let token = null;
    if (handoff.proof) {
      const response = await fetch(`${base}/api/course-ai/dev/attach`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nonce: handoff.nonce, expiresAt: handoff.expiresAt, proof: handoff.proof }),
        signal: AbortSignal.timeout(2500),
      });
      if (!response.ok) return false;
      const result = await response.json();
      if (!result.ok || typeof result.accessToken !== 'string') return false;
      token = result.accessToken;
    }
    return courseHarness.probe(base, token);
  }

  function open(button: HTMLButtonElement) {
    if (!panel) {
      panel = element('dialog', 'course-developer-panel');
      panel.setAttribute('aria-label', '开发者模式');
      const status = element('p', 'course-developer-status');
      status.setAttribute('role', 'status');
      const start = control('启动后端', async () => {
        if (start.disabled) return;
        start.disabled = true;
        status.textContent = '正在启动';
        try {
          const nonce = crypto.randomUUID().replace(/-/g, '');
          const pending = waitForHandoff(nonce);
          const link = document.createElement('a');
          link.href = `vrteaching-course-ai://start/${nonce}`;
          link.click();
          const handoff = await pending;
          if (!handoff) {
            status.textContent = '未收到启动结果。请确认已注册本机入口并允许 Edge 打开它，然后重试。';
          } else if (handoff.reason) {
            status.textContent = failures[handoff.reason] ?? failures['start-failed'];
          } else {
            status.textContent = await attach(handoff) ? '后端已连接' : '连接未完成，请重试。';
          }
        } catch {
          status.textContent = '连接未完成，请重试。';
        } finally {
          start.disabled = false;
        }
      });
      const close = control('收起', () => panel?.close());
      panel.append(element('strong', '', '开发者模式'), status, start, close);
      panel.addEventListener('close', () => {
        if (opener?.isConnected && !opener.hidden) opener.focus({ preventScroll: true });
      });
      window.addEventListener('course-harness-status', () => {
        if (!start.disabled && courseHarness.isOnline()) status.textContent = '后端已连接';
      });
      document.body.append(panel);
      status.textContent = courseHarness.isOnline() ? '后端已连接' : '后端未连接';
    }
    opener = button;
    if (!panel.open) panel.show();
  }

  if (available) {
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && panel?.open && panel.contains(document.activeElement)) {
        event.preventDefault();
        panel.close();
        return;
      }
      if (event.code !== 'KeyD' || !event.ctrlKey || !event.altKey || !event.shiftKey
        || event.metaKey || event.repeat || event.isComposing) return;
      const button = app.querySelector<HTMLButtonElement>('[data-lesson-action="developer-mode"]');
      if (!button) return;
      event.preventDefault();
      revealed = !revealed;
      button.hidden = !revealed;
      if (revealed) button.focus({ preventScroll: true });
      else if (panel?.open) panel.close();
    }, true);
  }

  return (toolbar: HTMLElement) => {
    if (!available) return;
    const button = lessonControl('developer-mode', '开发者模式', () => open(button));
    button.hidden = !revealed;
    toolbar.append(button);
  };
})();

function mountCourseDeveloperButton(toolbar: HTMLElement) {
  courseDeveloper(toolbar);
}
