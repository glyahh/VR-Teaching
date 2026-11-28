import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';

const terrainSource = readFileSync(new URL('../课堂演示/src/terrain.ts', import.meta.url), 'utf8');
const stageUrl = new URL('../课堂演示/src/sandbox-stage.ts', import.meta.url);
let stageSource;
try {
  stageSource = readFileSync(stageUrl, 'utf8');
} catch {
  console.error('[RED] 缺少 课堂演示/src/sandbox-stage.ts');
  process.exit(1);
}

// 1. Classic-script 语法与去类型检验
for (const [name, source] of [['terrain.ts', terrainSource], ['sandbox-stage.ts', stageSource]]) {
  assert.equal(/\b(?:import|export)\s/m.test(source), false, `${name} 不得包含 ES module import/export`);
  assert.equal(/\b(?:enum|namespace)\s/m.test(source), false, `${name} 不得包含 enum/namespace`);
  const js = stripTypeScriptTypes(source);
  new vm.Script(js, { filename: name });
}

// 2. terrain.ts 主题契约与 WebGL 1 兼容性
assert.match(terrainSource, /type\s+TerrainTheme\s*=/, 'terrain.ts 应定义 TerrainTheme');
assert.match(terrainSource, /setTheme\s*:/, 'TerrainSurface 应声明 setTheme');
assert.match(terrainSource, /uniform\s+float\s+themeMix\b/, '片元着色器应声明 uniform float themeMix');
assert.equal(/\b(?:OES_standard_derivatives|dFdx|dFdy|fwidth)\b/.test(terrainSource), false,
  'terrain.ts 不得使用 OES_standard_derivatives / dFdx / dFdy / fwidth，须兼容 WebGL 1 SwiftShader');

// 在隔离 VM 中测试 terrain.setTheme 状态持久化和 uniform 绑定
{
  const uniformCalls = [];
  const locations = new Map();
  let locCounter = 1;
  const createdElements = [];
  let pendingImage = null;

  const glMock = {
    VERTEX_SHADER: 0x8b31,
    FRAGMENT_SHADER: 0x8b30,
    COMPILE_STATUS: 0x8b81,
    LINK_STATUS: 0x8b82,
    ARRAY_BUFFER: 0x8892,
    ELEMENT_ARRAY_BUFFER: 0x8893,
    STATIC_DRAW: 0x88e4,
    FLOAT: 0x1406,
    TEXTURE_2D: 0x0de1,
    UNPACK_COLORSPACE_CONVERSION_WEBGL: 0x9243,
    NONE: 0,
    RGB: 0x1907,
    UNSIGNED_BYTE: 0x1401,
    TEXTURE_MIN_FILTER: 0x2801,
    TEXTURE_MAG_FILTER: 0x2800,
    LINEAR: 0x2601,
    TEXTURE_WRAP_S: 0x2802,
    TEXTURE_WRAP_T: 0x2803,
    CLAMP_TO_EDGE: 0x812f,
    DEPTH_TEST: 0x0b71,
    COLOR_BUFFER_BIT: 0x4000,
    DEPTH_BUFFER_BIT: 0x0100,
    TRIANGLES: 0x0004,
    UNSIGNED_SHORT: 0x1403,
    NO_ERROR: 0,
    MAX_TEXTURE_SIZE: 0x0d33,
    isContextLost: () => false,
    getParameter: () => 4096,
    createShader: () => ({}),
    shaderSource: () => {},
    compileShader: () => {},
    getShaderParameter: () => true,
    deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => {},
    getProgramParameter: () => true,
    deleteProgram: () => {},
    getUniformLocation: (_p, name) => {
      if (!locations.has(name)) locations.set(name, { name, id: locCounter++ });
      return locations.get(name);
    },
    getAttribLocation: () => 0,
    enableVertexAttribArray: () => {},
    vertexAttribPointer: () => {},
    createBuffer: () => ({}),
    bindBuffer: () => {},
    bufferData: () => {},
    createTexture: () => ({}),
    bindTexture: () => {},
    pixelStorei: () => {},
    texImage2D: () => {},
    texParameteri: () => {},
    viewport: () => {},
    enable: () => {},
    useProgram: () => {},
    clear: () => {},
    uniform2f: () => {},
    uniform4fv: () => {},
    uniform1f: (loc, val) => {
      uniformCalls.push({ name: loc?.name, val });
    },
    drawElements: () => {},
    getError: () => 0,
  };

  function makeElement(tag) {
    const classSet = new Set();
    const el = {
      tagName: tag.toUpperCase(),
      dataset: {},
      style: {},
      children: [],
      hidden: false,
      width: 4,
      height: 4,
      className: '',
      classList: {
        add: (...names) => names.forEach(n => classSet.add(n)),
        remove: (...names) => names.forEach(n => classSet.delete(n)),
        contains: n => classSet.has(n),
      },
      setAttribute: () => {},
      addEventListener: () => {},
      append: (...nodes) => el.children.push(...nodes),
      getContext: type => {
        if (type === 'webgl') return glMock;
        if (type === '2d') {
          return {
            drawImage: () => {},
            getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
          };
        }
        return null;
      },
    };
    createdElements.push(el);
    return el;
  }

  class MockImage {
    constructor() {
      this.width = 4;
      this.height = 4;
      this.naturalWidth = 4;
      this.complete = true;
      this.onload = null;
      pendingImage = this;
    }
    decode() {
      return Promise.resolve();
    }
  }

  const terrainCtx = vm.createContext({
    document: { createElement: makeElement },
    Image: MockImage,
    mediaAssets: { terrain: 'data:image/png;base64,' },
    acquireCourseAsset: () => Promise.resolve({ url: 'blob:mock', release: () => {} }),
    Float32Array,
    Uint16Array,
    Math,
  });
  vm.runInContext(stripTypeScriptTypes(terrainSource), terrainCtx);
  let changes = 0;
  const surface = terrainCtx.createTerrainSurface(() => { changes += 1; });
  assert.equal(typeof surface.setTheme, 'function');
  surface.setTheme('sandbox');
  assert.equal(surface.element.dataset.theme, 'sandbox');
  // 模拟高程图片加载完成前切主题后才 onload，themeMix 应自动保持为 1.0
  assert.ok(pendingImage?.onload);
  pendingImage.onload();
  assert.equal(surface.ready, true);
  assert.equal(uniformCalls.at(-1)?.name, 'themeMix');
  assert.equal(uniformCalls.at(-1)?.val, 1.0);
  // 切回 overview 后再查，应绑定 0.0 且不创建第二份 WebGL canvas
  surface.setTheme('overview');
  assert.equal(surface.element.dataset.theme, 'overview');
  assert.equal(uniformCalls.at(-1)?.val, 0.0);
  const canvasCount = createdElements.filter(el => el.tagName === 'CANVAS').length;
  // 1 个 WebGL canvas + 1 个 2d 采样 canvas（且不再多创建）
  assert.equal(canvasCount, 2);
  assert.ok(changes >= 2);
}

// 3. 在隔离 VM 中测试 sandbox-stage.ts 纯函数、快照栈状态机与舞台交互行为
const stageCtx = vm.createContext({
  Math,
  Number,
  String,
  Array,
  Object,
  JSON,
  Set,
  Map,
  RegExp,
});
vm.runInContext(stripTypeScriptTypes(stageSource), stageCtx);

const {
  sandboxGeoBounds,
  sandboxDefaultCamera,
  clampSandboxGeoPoint,
  sanitizeSandboxScenePlan,
  createSandboxSnapshotStack,
} = vm.runInContext(
  '({ sandboxGeoBounds, sandboxDefaultCamera, clampSandboxGeoPoint, sanitizeSandboxScenePlan, createSandboxSnapshotStack })',
  stageCtx
);

assert.ok(sandboxGeoBounds);
assert.equal(typeof clampSandboxGeoPoint, 'function');
assert.equal(typeof sanitizeSandboxScenePlan, 'function');
assert.equal(typeof createSandboxSnapshotStack, 'function');
assert.deepEqual([...sandboxDefaultCamera.center], [109.14, 26.72]);

// 越界点钳位测试
const clampedHigh = clampSandboxGeoPoint([140, 50]);
assert.ok(clampedHigh[0] <= sandboxGeoBounds.maxLon - 0.25 + 1e-6);
assert.ok(clampedHigh[1] <= sandboxGeoBounds.maxLat - 0.25 + 1e-6);
const clampedLow = clampSandboxGeoPoint([80, 10]);
assert.ok(clampedLow[0] >= sandboxGeoBounds.minLon + 0.25 - 1e-6);
assert.ok(clampedLow[1] >= sandboxGeoBounds.minLat + 0.25 - 1e-6);
const inside = clampSandboxGeoPoint([109.14, 26.23]);
assert.deepEqual([...inside], [109.14, 26.23]);

// 畸形与越界剧本清洗测试
const dirtyPlan = {
  mode: 'simulate',
  title: '向正东突进',
  analysis: '尝试沿直线跨越战区东界。',
  riskLevel: 'critical',
  historicalContrast: '黎平会议决定改向贵州北部。',
  camera: { center: [150, 45], zoom: 9, azimuth: 90, tilt: -15 },
  phases: [0, 1, 2, 3, 4].map(idx => ({
    caption: `阶段 ${idx} `.repeat(6),
    durationMs: idx === 0 ? 100 : 9999,
    redForces: [0, 1, 2, 3, 4].map(pathIdx => ({
      id: `r-${idx}-${pathIdx}`,
      role: 'main',
      label: `分队 ${pathIdx}`,
      waypoints: [[109.14, 26.23], [140, 50]],
      phase: idx,
      style: 'solid-gold',
      outcome: 'blocked',
    })),
    enemyForces: [{ id: 'e-1', label: '敌拦截', from: [110.2, 27.6], to: [140, 27.6], phase: idx, posture: 'intercept' }],
    zones: [{ id: 'z-1', label: '封锁区', center: [140, 50], radiusDeg: 8, kind: 'enemy-blockade', phase: idx }],
    pins: [{ label: '边界', point: [140, 50], tone: 'vermilion', phase: idx }],
  })),
  citedSourceIds: ['src-liping-turn'],
};

const clean = sanitizeSandboxScenePlan(dirtyPlan);
assert.equal(clean.phases.length, 3);
assert.equal(clean.phases[0].durationMs, 900);
assert.equal(clean.phases[1].durationMs, 2200);
assert.ok(clean.phases[0].caption.length <= 20);
assert.equal(clean.phases[0].redForces.length, 3);
assert.equal(clean.camera.zoom, 2.5);
assert.equal(clean.camera.azimuth, 38);
assert.equal(clean.camera.tilt, 0);
assert.ok(clean.camera.center[0] <= sandboxGeoBounds.maxLon);
assert.ok(clean.camera.center[1] <= sandboxGeoBounds.maxLat);
assert.ok(clean.phases[0].zones[0].radiusDeg <= 1.35);
assert.ok(typeof clean.outOfBoundsNote === 'string' && clean.outOfBoundsNote.length > 0, '越界路径应触发 outOfBoundsNote');
const endPt = clean.phases[0].redForces[0].waypoints[1];
assert.ok(endPt[0] <= sandboxGeoBounds.maxLon && endPt[1] <= sandboxGeoBounds.maxLat);
// 射线截断校验：从 [109.14, 26.23] 指向 [140, 50] 先碰到北边界 30.40，经度应在 ~114.55 而非被硬夹到右下或右上角 118.25
assert.ok(endPt[0] < 116.5 && endPt[1] >= 30.39, `射线截断应在北边界附近停驻，实际为 ${JSON.stringify(endPt)}`);

// 损坏对象容错
const fallback = sanitizeSandboxScenePlan(null);
assert.equal(fallback.phases.length, 1);

// 快照栈状态机测试
const stack = createSandboxSnapshotStack();
assert.equal(stack.current().revision, 0);
assert.equal(stack.current().isInitial, true);
assert.equal(stack.canRollback(), false);
assert.equal(stack.toMapContext().actionSinceLastTurn, 'continue');

const makeSimPlan = (title, wp) => ({
  mode: 'simulate',
  title,
  analysis: title,
  riskLevel: 'viable',
  historicalContrast: '对比真实路线',
  camera: { center: [108.5, 26.8], zoom: 1.6, azimuth: -12, tilt: 32 },
  phases: [{
    durationMs: 1200,
    redForces: [{
      id: 'main-1', role: 'main', label: title,
      waypoints: [[109.14, 26.23], wp], phase: 0, style: 'solid-gold', outcome: 'advance',
    }],
    enemyForces: [],
    zones: [{ id: 'z1', label: '封锁区', center: [110.15, 27.65], radiusDeg: 0.6, kind: 'enemy-blockade', phase: 0 }],
    pins: [],
  }],
  citedSourceIds: ['src-liping-turn'],
});

const s1 = stack.push(makeSimPlan('西进榕江', [108.52, 25.93]));
assert.equal(s1.revision, 1);
assert.equal(s1.isInitial, false);
assert.equal(stack.canRollback(), true);
assert.equal(stack.toMapContext().activeRoutes.length, 1);

const s2 = stack.push(makeSimPlan('北渡乌江', [107.47, 27.32]));
assert.equal(s2.revision, 2);
assert.equal(stack.depth(), 3);

// 回档：回到 rev=1 且标记 rolled_back
const rb1 = stack.rollback();
assert.equal(rb1.changed, true);
assert.equal(rb1.snapshot.revision, 1);
assert.equal(stack.toMapContext().revision, 1);
assert.equal(stack.toMapContext().actionSinceLastTurn, 'rolled_back');

// 回档后继续演进：版本单调递增 (rev=3)，标记清除为 continue
const s3 = stack.push({
  mode: 'explain',
  title: '观察乌江地形',
  analysis: '解释乌江谷地渡口地形。',
  riskLevel: 'viable',
  historicalContrast: '猴场会议重申渡乌江。',
  camera: { center: [107.47, 27.32], zoom: 1.9, azimuth: -15, tilt: 38 },
  phases: [{ durationMs: 1100, redForces: [], enemyForces: [], zones: [], pins: [{ label: '乌江', point: [107.47, 27.32], tone: 'gold', phase: 0 }] }],
  citedSourceIds: ['src-houchang-wujiang'],
});
assert.equal(s3.revision, 3);
assert.equal(stack.toMapContext().actionSinceLastTurn, 'continue');
// explain 态不抹除上一帧地图上的路线
assert.equal(stack.toMapContext().activeRoutes.length, 1);

// 回档至 rev=1，再回档至 rev=0
assert.equal(stack.rollback().snapshot.revision, 1);
const rbRoot = stack.rollback();
assert.equal(rbRoot.changed, true);
assert.equal(rbRoot.snapshot.revision, 0);
assert.equal(rbRoot.snapshot.isInitial, true);
assert.equal(stack.rollback().changed, false);

// 还原与清空语义
stack.push(makeSimPlan('试探一', [109.2, 26.67]));
const restored = stack.restore();
assert.equal(restored.isInitial, true);
assert.equal(restored.revision, 0);
assert.equal(stack.toMapContext().actionSinceLastTurn, 'restored');

const cleared = stack.clear();
assert.equal(cleared.isInitial, true);
assert.equal(stack.toMapContext().actionSinceLastTurn, 'continue');

// 上限 24 步与初态保留校验
for (let i = 0; i < 30; i++) {
  stack.push(makeSimPlan(`步 ${i}`, [108.5, 26.5]));
}
assert.equal(stack.depth(), 24);
while (stack.canRollback()) stack.rollback();
assert.equal(stack.current().isInitial, true);
assert.equal(stack.current().revision, 0);

// 序列化与损坏恢复校验
stack.clear();
stack.push(makeSimPlan('序列化测试', [108.42, 27.05]));
stack.rollback();
const saved = stack.serialize();
const nextStack = createSandboxSnapshotStack();
assert.equal(nextStack.hydrate(saved), true);
assert.equal(nextStack.toMapContext().actionSinceLastTurn, 'rolled_back');
assert.equal(nextStack.hydrate('{bad-json'), false);
assert.equal(nextStack.hydrate({ version: 999 }), false);
assert.equal(nextStack.toMapContext().actionSinceLastTurn, 'rolled_back');

// 4. mountSandboxStage 舞台集成生命周期、交互与 theme 复原测试
{
  const makeNode = (tag) => {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const node = {
      tagName: String(tag).toUpperCase(),
      className: '',
      textContent: '',
      hidden: false,
      disabled: false,
      clientWidth: 1280,
      clientHeight: 720,
      dataset: {},
      children: [],
      style: { setProperty: () => {} },
      classList: {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: n => classes.has(n),
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => attrs.get(k) ?? null,
      removeAttribute: k => attrs.delete(k),
      append: (...nodes) => node.children.push(...nodes),
      replaceChildren: (...nodes) => { node.children = [...nodes]; },
      remove: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatch: (type, event) => {
        for (const fn of listeners.get(type) ?? []) fn(event);
      },
    };
    return node;
  };

  const domCtx = vm.createContext({
    Math, Number, String, Array, Object, JSON, Set, Map, RegExp, AbortController,
    performance: { now: () => 0 },
    setTimeout,
    clearTimeout,
    matchMedia: () => ({ matches: true }),
    document: {
      createElement: tag => makeNode(tag),
      createElementNS: (_ns, tag) => makeNode(tag),
    },
  });
  vm.runInContext(stripTypeScriptTypes(stageSource), domCtx);

  const themeHistory = [];
  const terrainMock = {
    element: makeNode('div'),
    ready: true,
    onChange: () => {},
    setTheme: theme => themeHistory.push(theme),
    orient: () => {},
    project: pt => pt,
    captureFrame: () => undefined,
  };
  const host = makeNode('section');
  const stage = domCtx.mountSandboxStage(host, { terrain: terrainMock });

  assert.equal(themeHistory.at(-1), 'sandbox');
  assert.equal(host.dataset.theme, 'sandbox');
  assert.equal(host.dataset.phase, 'initial');
  assert.equal(host.dataset.revision, '0');
  assert.equal(host.dataset.realRoute, 'false');

  stage.applyPlan(makeSimPlan('桂北迂回', [108.52, 25.93]), { animate: false });
  assert.equal(host.dataset.revision, '1');
  assert.equal(host.dataset.stackDepth, '2');
  assert.equal(host.dataset.phase, 'complete');
  assert.equal(stage.canRollback(), true);

  stage.setRealRouteVisible(true);
  assert.equal(host.dataset.realRoute, 'true');

  const zoomBefore = stage.getCameraState().zoom;
  stage.zoomBy(1.2);
  assert.ok(stage.getCameraState().zoom > zoomBefore);

  // 指针拖拽轨道旋转测试
  const viewportEl = host.children[0];
  const azBefore = stage.getCameraState().azimuth;
  viewportEl.dispatch('pointerdown', { pointerType: 'mouse', button: 0, pointerId: 1, clientX: 200, clientY: 200, shiftKey: false });
  viewportEl.dispatch('pointermove', { pointerId: 1, clientX: 250, clientY: 230 });
  viewportEl.dispatch('pointerup', { pointerId: 1, clientX: 250, clientY: 230 });
  assert.ok(stage.getCameraState().azimuth > azBefore);

  // 回档与释放测试
  const rb = stage.rollback();
  assert.equal(rb.changed, true);
  assert.equal(host.dataset.revision, '0');
  assert.equal(host.dataset.phase, 'initial');
  assert.equal(stage.toMapContext().actionSinceLastTurn, 'rolled_back');

  stage.dispose();
  assert.equal(themeHistory.at(-1), 'overview');
}

// 4b. 动态多阶段编排与指针打断自动运镜测试 (reducedMotion = false)
{
  const makeNode = (tag) => {
    const classes = new Set();
    const attrs = new Map();
    const listeners = new Map();
    const node = {
      tagName: String(tag).toUpperCase(),
      className: '',
      textContent: '',
      hidden: false,
      disabled: false,
      clientWidth: 1280,
      clientHeight: 720,
      dataset: {},
      children: [],
      style: { setProperty: () => {} },
      classList: {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: n => classes.has(n),
      },
      setAttribute: (k, v) => attrs.set(k, String(v)),
      getAttribute: k => attrs.get(k) ?? null,
      removeAttribute: k => attrs.delete(k),
      append: (...nodes) => node.children.push(...nodes),
      replaceChildren: (...nodes) => { node.children = [...nodes]; },
      remove: () => {},
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
      addEventListener: (type, fn) => {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(fn);
      },
      dispatch: (type, event) => {
        for (const fn of listeners.get(type) ?? []) fn(event);
      },
    };
    return node;
  };

  let fakeNow = 0;
  let rafId = 1;
  const rafQueue = new Map();
  const animCtx = vm.createContext({
    Math, Number, String, Array, Object, JSON, Set, Map, RegExp, AbortController,
    performance: { now: () => fakeNow },
    requestAnimationFrame: fn => {
      const id = rafId++;
      rafQueue.set(id, fn);
      return id;
    },
    cancelAnimationFrame: id => {
      rafQueue.delete(id);
    },
    matchMedia: () => ({ matches: false }),
    document: {
      createElement: tag => makeNode(tag),
      createElementNS: (_ns, tag) => makeNode(tag),
    },
  });
  vm.runInContext(stripTypeScriptTypes(stageSource), animCtx);
  const phasesObserved = [];
  const host = makeNode('section');
  const stage = animCtx.mountSandboxStage(host, {
    terrain: {
      element: makeNode('div'),
      ready: true,
      onChange: () => {},
      setTheme: () => {},
      orient: () => {},
      project: pt => pt,
      captureFrame: () => undefined,
    },
    onPhaseChange: tag => phasesObserved.push(tag),
  });

  const flushRaf = (nextNow) => {
    fakeNow = nextNow;
    const batch = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, fn] of batch) fn();
  };

  stage.applyPlan({
    mode: 'simulate',
    title: '两阶段迂回',
    analysis: '分两步推进。',
    riskLevel: 'viable',
    historicalContrast: '黎平转向。',
    camera: { center: [107.8, 27.1], zoom: 1.9, azimuth: -18, tilt: 40 },
    phases: [
      {
        caption: '佯攻通道', durationMs: 1000,
        redForces: [{ id: 'f1', role: 'feint', label: '通道佯攻', waypoints: [[109.14, 26.23], [109.63, 26.32]], phase: 0, style: 'dashed-vermilion', outcome: 'blocked' }],
        enemyForces: [], zones: [], pins: [],
      },
      {
        caption: '西进黔北', durationMs: 1000,
        redForces: [{ id: 'f2', role: 'main', label: '主力西进', waypoints: [[109.14, 26.23], [107.47, 27.07]], phase: 1, style: 'solid-gold', outcome: 'breakthrough' }],
        enemyForces: [], zones: [], pins: [],
      },
    ],
    citedSourceIds: ['src-liping-turn'],
  }, { animate: true });

  flushRaf(150);
  assert.equal(host.dataset.phase, 'phase-0');
  // 滚轮应立刻中止自动运镜缓动而不干扰矢量阶段推进
  const zoomAtInterrupt = stage.getCameraState().zoom;
  host.children[0].dispatch('wheel', { deltaY: -100, clientX: 500, clientY: 300, preventDefault: () => {} });
  const zoomAfterWheel = stage.getCameraState().zoom;
  assert.ok(zoomAfterWheel > zoomAtInterrupt);
  flushRaf(1200);
  assert.equal(host.dataset.phase, 'phase-1');
  // 验证相机缩放未被后续 phase 帧覆写回自动运镜目标
  assert.equal(stage.getCameraState().zoom, zoomAfterWheel);
  flushRaf(2200);
  assert.equal(host.dataset.phase, 'complete');
  assert.deepEqual(phasesObserved.slice(-3), ['phase-0', 'phase-1', 'complete']);
  stage.dispose();
}

// 5. 全仓经典脚本拼接零冲突校验
{
  const buildSource = readFileSync(new URL('../课堂演示/build.mjs', import.meta.url), 'utf8');
  const namesMatch = buildSource.match(/const scriptNames = \[([\s\S]*?)\];/);
  assert.ok(namesMatch, '应从 build.mjs 解析现有 scriptNames');
  const existingNames = [...namesMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  const insertAt = existingNames.indexOf('harness-bridge') + 1;
  const combinedNames = existingNames.includes('sandbox-stage')
    ? existingNames
    : [...existingNames.slice(0, insertAt), 'sandbox-stage', ...existingNames.slice(insertAt)];
  const combinedJs = combinedNames.map(name => {
    const src = readFileSync(new URL(`../课堂演示/src/${name}.ts`, import.meta.url), 'utf8');
    return stripTypeScriptTypes(src);
  }).join('\n');
  new vm.Script(combinedJs, { filename: 'combined-course-classic-scripts.js' });
}

console.log('[GREEN] verify-sandbox-stage 全部断言通过。');
