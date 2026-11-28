function mountSandboxPage({ root, onBack }: { root: HTMLElement; onBack: () => void }) {
  const sessionId = courseHarness.getSessionId();
  const life = new AbortController();
  const narrowQuery = matchMedia('(max-width: 900px)');
  const sampleProposals = [
    '分兵佯攻通道，主力西出黔北',
    '在黎平原地固守休整',
    '按原计划强攻湘西北会合',
  ];

  let dockOpen = true;
  let loadingHistory = true;
  let working = false;
  let clearing = false;
  let readingFiles = false;
  let attachments: SandboxAttachment[] = [];
  let activeTurnRequest: AbortController | undefined;
  let ownModalOpen = false;
  let compression = { version: 0, turnCount: 0 };
  let uiReady = false;

  function makeDockIcon(kind: 'send') {
    const paths: Record<'send', string> = {
      send: 'M12 20V4m-6 6 6-6 6 6',
    };
    const svg = document.createElementNS(svgNamespace, 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', paths[kind]);
    svg.append(path);
    return svg;
  }

  const shell = element('section', 'sandbox-shell');
  shell.dataset.dockOpen = 'true';
  const stageHost = element('div', 'sandbox-stage-host');

  const focusRatioForViewport = () => (narrowQuery.matches ? 0.5 : dockOpen ? 0.36 : 0.49);

  const stageTerrain = createTerrainSurface(() => {});
  stageTerrain.setTheme('sandbox');
  const stage = mountSandboxStage(stageHost, {
    terrain: stageTerrain,
    showControls: true,
    viewportFocusRatioX: focusRatioForViewport(),
    onStateChange: () => { if (uiReady) syncDockButtons(); },
  });

  const savedStage = loadSandboxStageSnapshot();
  let hydratedStage = false;

  const bottomBar = element('div', 'sandbox-bottom-bar');
  const cameraControls = stageHost.querySelector('.sandbox-camera-controls');
  if (cameraControls) bottomBar.append(cameraControls);
  const realRouteBtn = lessonControl(
    'sandbox-real-route',
    '对照真实黔北路线',
    () => setRealRoute(!stage.isRealRouteVisible(), false),
    'sandbox-real-route-btn',
    'compass'
  );
  realRouteBtn.setAttribute('aria-pressed', String(stage.isRealRouteVisible()));
  bottomBar.append(realRouteBtn);
  stageHost.append(bottomBar);

  const header = element('header', 'sandbox-top');
  const identity = element('div', 'sandbox-identity');
  const title = element('h1', 'sandbox-title', '黎平战地沙盘');
  title.tabIndex = -1;
  const coords = element('p', 'sandbox-coords', "26°13'N 109°08'E");
  identity.append(title, coords);

  const topActions = element('div', 'sandbox-top-actions');
  const backBtn = lessonControl('sandbox-back', '返回进军方向', () => onBack(), 'sandbox-frosted-btn', 'arrowLeft');
  const dockToggleBtn = lessonControl(
    'sandbox-dock-toggle',
    '沙盘推演',
    () => setDockOpen(!dockOpen),
    'sandbox-frosted-btn sandbox-dock-toggle',
    'compass'
  );
  dockToggleBtn.setAttribute('aria-expanded', 'true');
  dockToggleBtn.setAttribute('aria-controls', 'sandbox-ai-dock');
  topActions.append(backBtn, soundButton(), fullscreenButton(), dockToggleBtn);
  header.append(identity, topActions);

  const dock = element('section', 'sandbox-dock');
  dock.id = 'sandbox-ai-dock';
  dock.setAttribute('aria-labelledby', 'sandbox-dock-title');

  const dockHead = element('div', 'sandbox-dock-head');
  const dockTitle = element('h2', 'sandbox-dock-title', '沙盘推演');
  dockTitle.id = 'sandbox-dock-title';
  const dockActions = element('div', 'sandbox-dock-actions');
  const rollbackBtn = lessonControl('sandbox-rollback', '回档', handleRollback, 'sandbox-mini-btn');
  const restoreBtn = lessonControl('sandbox-restore', '还原', openRestoreModal, 'sandbox-mini-btn');
  const clearBtn = lessonControl('sandbox-clear', '清空', openClearModal, 'sandbox-mini-btn');
  const collapseBtn = lessonControl('sandbox-collapse', '收起', () => setDockOpen(false, true), 'sandbox-mini-btn');
  dockActions.append(rollbackBtn, restoreBtn, clearBtn, collapseBtn);
  dockHead.append(svgIcon('compass'), dockTitle, dockActions);

  const offlineBanner = element('p', 'sandbox-offline-banner', '教学网关连接已中断，重连后可继续推演');
  offlineBanner.setAttribute('role', 'status');

  const chat = element('div', 'sandbox-chat');
  const divider = element('p', 'sandbox-divider', '上下文已经完成压缩');
  divider.setAttribute('role', 'status');

  const presets = element('div', 'sandbox-presets');
  const presetChips = sampleProposals.map(label =>
    control(label, () => {
      input.value = label;
      void submitProposal(label);
    }, 'sandbox-chip')
  );
  presets.append(...presetChips);

  const attachmentsBox = element('div', 'sandbox-attachments');
  const attachmentError = element('p', 'sandbox-file-error');
  attachmentError.setAttribute('role', 'alert');
  attachmentError.hidden = true;

  const filePicker = document.createElement('input');
  filePicker.type = 'file';
  filePicker.accept = '.txt,.md,.csv,.json';
  filePicker.multiple = true;
  filePicker.hidden = true;

  const form = element('form', 'sandbox-form');
  const composer = element('div', 'sandbox-composer');
  const attachBtn = lessonControl('sandbox-attach', '', () => filePicker.click(), 'sandbox-attach-btn', 'plus');
  attachBtn.setAttribute('aria-label', '添加资料');
  attachBtn.title = '添加资料，支持 TXT、Markdown、CSV、JSON';

  const input = element('textarea', 'sandbox-input');
  input.rows = 1;
  input.maxLength = 280;
  input.placeholder = '输入你的进军方向或行动方案…';
  input.setAttribute('aria-label', '沙盘推演方案');

  const submitBtn = element('button', 'sandbox-submit');
  submitBtn.type = 'submit';
  submitBtn.dataset.lessonAction = 'sandbox-submit';
  submitBtn.setAttribute('aria-label', '开始沙盘推演');
  submitBtn.append(makeDockIcon('send'));
  composer.append(attachBtn, input);
  form.append(composer, submitBtn);

  dock.append(dockHead, offlineBanner, chat, presets, attachmentsBox, attachmentError, form, filePicker);
  shell.append(stageHost, header, dock);
  root.replaceChildren(shell);

  function setRealRoute(visible: boolean, focusCamera: boolean, interactionId?: string) {
    stage.setRealRouteVisible(visible);
    realRouteBtn.setAttribute('aria-pressed', String(visible));
    if (visible && focusCamera) {
      stage.animateCameraTo({ center: [108.05, 26.95], zoom: 1.48, azimuth: -12, tilt: 34 }, 540);
    }
    if (interactionId) {
      courseHarness.recordSandboxAction(interactionId, 'compare_real_route', 'succeeded');
    }
  }

  function setDockOpen(nextOpen: boolean, restoreFocus = false) {
    dockOpen = nextOpen;
    dock.hidden = !dockOpen;
    shell.dataset.dockOpen = String(dockOpen);
    dockToggleBtn.setAttribute('aria-expanded', String(dockOpen));
    stage.setViewportFocusRatioX(focusRatioForViewport());
    if (!dockOpen && restoreFocus && dockToggleBtn.isConnected) {
      dockToggleBtn.focus({ preventScroll: true });
    } else if (dockOpen) {
      input.focus({ preventScroll: true });
    }
  }

  function nearLatest() {
    return chat.scrollHeight - chat.clientHeight - chat.scrollTop <= 16;
  }

  function placeCompressionDivider() {
    if (!compression.version || !compression.turnCount) {
      divider.remove();
      return;
    }
    const replies = chat.querySelectorAll('.sandbox-msg-assistant');
    const target = replies[compression.turnCount - 1];
    if (target) target.after(divider);
    else divider.remove();
  }

  function syncDockButtons() {
    const online = courseHarness.isOnline();
    offlineBanner.hidden = online;
    const lockedByTurn = loadingHistory || clearing || readingFiles || working;
    submitBtn.disabled = !online || lockedByTurn;
    for (const chip of presetChips) chip.disabled = !online || lockedByTurn;
    attachBtn.disabled = !online || clearing || readingFiles || working;
    input.disabled = clearing;
    rollbackBtn.disabled = lockedByTurn || !stage.canRollback();
    const stackState = stage.getStackState();
    const atCleanInitial = stackState.stack.length <= 1 && stackState.stack[0]?.isInitial === true;
    restoreBtn.disabled = lockedByTurn || atCleanInitial;
    const hasChat = chat.querySelector('.sandbox-msg-user, .sandbox-msg-assistant') !== null;
    clearBtn.disabled = loadingHistory || clearing || readingFiles || (!hasChat && atCleanInitial);
  }

  function renderAttachments() {
    attachmentsBox.replaceChildren(...attachments.map(file => {
      const chip = element('span', 'sandbox-file-chip');
      const name = element('span', '', file.name);
      name.title = file.name;
      const remove = control('×', () => {
        attachments = attachments.filter(item => item !== file);
        renderAttachments();
      }, '');
      remove.setAttribute('aria-label', `移除 ${file.name}`);
      chip.append(name, remove);
      return chip;
    }));
  }

  function appendTurnNodes(proposalText: string) {
    const userBubble = element('p', 'sandbox-msg-user', proposalText);
    const replyCard = element('div', 'sandbox-msg-assistant');
    const headRow = element('div', 'sandbox-reply-head');
    const icon = svgIcon('compass');
    const bodyCol = element('div', 'sandbox-reply-body');
    const textNode = element('p', 'sandbox-reply-text');
    bodyCol.append(textNode);
    headRow.append(icon, bodyCol);
    replyCard.append(headRow);
    chat.append(userBubble, replyCard);
    return { userBubble, replyCard, bodyCol, textNode };
  }

  function decorateReplyCard(
    replyCard: HTMLElement,
    bodyCol: HTMLElement,
    textNode: HTMLElement,
    narration: string,
    plan: SandboxScenePlan,
    interactionId: string
  ) {
    const replyText = narration || plan.analysis;
    textNode.textContent = replyText;
    if (plan.outOfBoundsNote && !replyText.includes(plan.outOfBoundsNote)) {
      bodyCol.append(element('p', 'sandbox-oob-note', plan.outOfBoundsNote));
    }
    if (plan.historicalContrast) {
      bodyCol.append(element('p', 'sandbox-contrast-note', `历史对照：${plan.historicalContrast}`));
    }
    const actionsRow = element('div', 'sandbox-reply-actions');
    const compareBtn = control('对照真实黔北路线', () => {
      soundscape.playSfx('route');
      setRealRoute(true, true, interactionId);
    }, 'sandbox-action-card', 'compass');
    const replayBtn = control('重播推演', () => {
      soundscape.playSfx('route');
      stage.applyPlan(plan, { pushSnapshot: false, animate: true });
      courseHarness.recordSandboxAction(interactionId, 'replay_plan', 'succeeded');
    }, 'sandbox-action-card', 'play');
    actionsRow.append(compareBtn, replayBtn);
    replyCard.append(actionsRow);
  }

  function handleRollback() {
    if (working || clearing) return;
    const result = stage.rollback();
    if (result.changed) {
      saveSandboxStageSnapshot(stage.serializeState());
      soundscape.playSfx('paper-slide');
    }
    syncDockButtons();
  }

  function openConfirmDialog(titleText: string, message: string, confirmLabel: string, onConfirm: () => Promise<void> | void) {
    const body = element('p', '', message);
    const actions = element('div', 'sandbox-modal-actions');
    const cancel = control('取消', () => closeMaterial());
    const confirm = control(confirmLabel, async () => {
      confirm.disabled = true;
      cancel.disabled = true;
      try {
        await onConfirm();
        if (dialog.open) closeMaterial();
      } finally {
        confirm.disabled = false;
        cancel.disabled = false;
      }
    }, 'primary');
    actions.append(cancel, confirm);
    ownModalOpen = true;
    dialog.addEventListener('close', () => { ownModalOpen = false; }, { once: true });
    modal(titleText, body, actions);
  }

  function openRestoreModal() {
    if (restoreBtn.disabled) return;
    openConfirmDialog(
      '还原沙盘态势',
      '将 3D 沙盘地图恢复到 1934 年 12 月黎平战前初始态势，当前右侧推演对话记录将继续保留。',
      '确认还原',
      () => {
        stage.restoreToInitial();
        saveSandboxStageSnapshot(stage.serializeState());
        soundscape.playSfx('paper-slide');
        syncDockButtons();
      }
    );
  }

  function openClearModal() {
    if (clearBtn.disabled) return;
    openConfirmDialog(
      '清空沙盘对话',
      '将清除本场全部沙盘推演对话记录，并将三维沙盘还原回黎平战前初始态势。',
      '确认清空',
      async () => {
        clearing = true;
        activeTurnRequest?.abort();
        activeTurnRequest = undefined;
        working = false;
        syncDockButtons();
        try {
          await courseHarness.clearSandboxHistory(sessionId);
          if (life.signal.aborted) return;
          compression = { version: 0, turnCount: 0 };
          divider.remove();
          chat.replaceChildren();
          stage.clearAll();
          setRealRoute(false, false);
          saveSandboxStageSnapshot(stage.serializeState());
          soundscape.playSfx('paper-turn');
          input.focus({ preventScroll: true });
        } finally {
          clearing = false;
          if (!life.signal.aborted) syncDockButtons();
        }
      }
    );
  }

  async function submitProposal(rawText: string) {
    if (!courseHarness.isOnline() || loadingHistory || clearing || readingFiles || working) return;
    const files = attachments;
    const proposal = rawText.trim().slice(0, 280) || (files.length ? '请结合所附资料推演该行动方案。' : '');
    if (!proposal) return;

    const follow = nearLatest();
    attachments = [];
    renderAttachments();
    attachmentError.hidden = true;
    input.value = '';

    const request = activeTurnRequest = new AbortController();
    const mergedSignal = AbortSignal.any([request.signal, life.signal]);
    working = true;
    syncDockButtons();

    const { userBubble, replyCard, bodyCol, textNode } = appendTurnNodes(proposal);
    replyCard.dataset.working = 'true';
    textNode.textContent = '正在研判敌我态势与地形约束…';
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches && typeof userBubble.animate === 'function') {
      userBubble.animate([
        { transform: 'translateY(8px) scale(.97)', opacity: 0.55 },
        { transform: 'none', opacity: 1 },
      ], { duration: 240, easing: 'cubic-bezier(.22,1,.36,1)' });
    }
    if (follow) chat.scrollTop = chat.scrollHeight;

    try {
      const mapContext = stage.toMapContext();
      const reply = await courseHarness.runSandboxTurn({
        sessionId,
        proposal,
        ...(files.length ? { attachments: files } : {}),
        mapContext,
      }, mergedSignal, event => {
        if (mergedSignal.aborted || !dock.isConnected) return;
        const pin = nearLatest();
        textNode.textContent = event.text;
        if (pin) chat.scrollTop = chat.scrollHeight;
      });
      if (mergedSignal.aborted || !dock.isConnected) return;

      delete replyCard.dataset.working;
      stage.applyPlan(reply.plan, { pushSnapshot: true, animate: true });
      saveSandboxStageSnapshot(stage.serializeState());
      soundscape.playSfx('route');
      decorateReplyCard(replyCard, bodyCol, textNode, reply.narration, reply.plan, reply.interactionId);
      placeCompressionDivider();
      if (follow || nearLatest()) chat.scrollTop = chat.scrollHeight;
    } catch (error) {
      if (mergedSignal.aborted || !dock.isConnected) {
        userBubble.remove();
        replyCard.remove();
        return;
      }
      delete replyCard.dataset.working;
      textNode.dataset.error = 'true';
      textNode.textContent = error instanceof Error ? error.message : '沙盘推演失败，请重试。';
      if (!input.value) input.value = proposal;
      if (!attachments.length && files.length) {
        attachments = files;
        renderAttachments();
      }
    } finally {
      if (activeTurnRequest === request) activeTurnRequest = undefined;
      working = false;
      if (!life.signal.aborted) syncDockButtons();
    }
  }

  async function hydrateHistory() {
    try {
      const history = await courseHarness.loadSandboxHistory(sessionId);
      if (life.signal.aborted) return;
      for (const turn of history.turns) {
        const { replyCard, bodyCol, textNode } = appendTurnNodes(turn.proposal);
        decorateReplyCard(replyCard, bodyCol, textNode, turn.narration, turn.plan, turn.id ?? '');
      }
      if (history.compressionVersion > compression.version) {
        compression = { version: history.compressionVersion, turnCount: history.compressionTurnCount };
      }
      placeCompressionDivider();
      if (!hydratedStage && history.turns.length > 0) {
        const latestPlan = history.turns[history.turns.length - 1].plan;
        stage.applyPlan(latestPlan, { pushSnapshot: true, animate: false });
        saveSandboxStageSnapshot(stage.serializeState());
      }
      if (history.turns.length > 0) chat.scrollTop = chat.scrollHeight;
    } finally {
      loadingHistory = false;
      if (!life.signal.aborted) syncDockButtons();
    }
  }

  filePicker.addEventListener('change', async () => {
    const selected = [...(filePicker.files ?? [])];
    filePicker.value = '';
    if (!selected.length || readingFiles || clearing) return;
    readingFiles = true;
    syncDockButtons();
    attachmentError.hidden = true;
    try {
      const encode = new TextEncoder();
      const bytes = attachments.reduce((total, file) => total + encode.encode(file.text).length, 0);
      if (attachments.length + selected.length > 3 || selected.reduce((total, file) => total + file.size, bytes) > 4000) {
        throw new Error('每条消息最多添加 3 份资料，合计不超过 4 KB。');
      }
      const next = await Promise.all(selected.map(async file => {
        if (!/\.(txt|md|csv|json)$/i.test(file.name) || file.name.length > 120) {
          throw new Error('请选择 TXT、Markdown、CSV 或 JSON 文件。');
        }
        const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()).trim();
        if (!text || text.includes('\0')) throw new Error('请选择含文字的 UTF-8 文件。');
        return { name: file.name, text };
      }));
      if (!life.signal.aborted) {
        attachments.push(...next);
        renderAttachments();
        input.focus({ preventScroll: true });
      }
    } catch (error) {
      if (!life.signal.aborted) {
        attachmentError.textContent = error instanceof TypeError ? '文件无法按 UTF-8 读取。'
          : error instanceof Error ? error.message : '无法打开资料。';
        attachmentError.hidden = false;
      }
    } finally {
      readingFiles = false;
      if (!life.signal.aborted) syncDockButtons();
    }
  }, { signal: life.signal });

  input.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    form.requestSubmit();
  }, { signal: life.signal });

  form.addEventListener('submit', event => {
    event.preventDefault();
    void submitProposal(input.value);
  }, { signal: life.signal });

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || event.defaultPrevented || dialog.open || event.isComposing || event.keyCode === 229) return;
    if (dockOpen) {
      event.preventDefault();
      setDockOpen(false, true);
    }
  }, { signal: life.signal });

  window.addEventListener('course-harness-status', () => {
    syncDockButtons();
  }, { signal: life.signal });

  window.addEventListener('course-sandbox-compressed', event => {
    const detail = (event as CustomEvent<{ sessionId: string; version: number; turnCount: number }>).detail;
    if (!detail || detail.sessionId !== sessionId || clearing || detail.version <= compression.version) return;
    const follow = nearLatest();
    compression = { version: detail.version, turnCount: detail.turnCount };
    placeCompressionDivider();
    if (follow) chat.scrollTop = chat.scrollHeight;
  }, { signal: life.signal });

  const onNarrowChange = () => stage.setViewportFocusRatioX(focusRatioForViewport());
  narrowQuery.addEventListener('change', onNarrowChange, { signal: life.signal });

  uiReady = true;
  if (savedStage) hydratedStage = stage.hydrateState(savedStage);
  syncDockButtons();
  title.focus({ preventScroll: true });
  void hydrateHistory();

  return {
    dispose() {
      activeTurnRequest?.abort();
      activeTurnRequest = undefined;
      if (ownModalOpen && dialog.open) closeMaterial();
      life.abort();
      stage.dispose();
    },
  };
}