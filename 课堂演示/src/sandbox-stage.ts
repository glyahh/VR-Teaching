type GeoPoint = [lon: number, lat: number];

type SandboxMapActionMark = 'continue' | 'rolled_back' | 'restored';

type SandboxForcePath = {
  id: string;
  role: 'main' | 'feint' | 'flank' | 'hold' | 'historical-ref';
  label: string;
  waypoints: GeoPoint[];
  phase: number;
  style: 'solid-gold' | 'dashed-vermilion' | 'dotted-slate';
  outcome: 'advance' | 'blocked' | 'stalled' | 'breakthrough';
};

type SandboxEnemyVector = {
  id: string;
  label: string;
  from: GeoPoint;
  to: GeoPoint;
  phase: number;
  posture: 'intercept' | 'encircle' | 'garrison';
};

type SandboxTacticalZone = {
  id: string;
  label: string;
  center: GeoPoint;
  radiusDeg: number;
  kind: 'enemy-blockade' | 'weak-gap' | 'rally';
  phase: number;
};

type SandboxMapPin = {
  label: string;
  point: GeoPoint;
  tone: 'neutral' | 'gold' | 'vermilion';
  phase: number;
};

type SandboxCameraCue = {
  center: GeoPoint;
  zoom: number;
  azimuth: number;
  tilt: number;
};

type SandboxScenePhase = {
  caption?: string;
  durationMs: number;
  redForces: SandboxForcePath[];
  enemyForces: SandboxEnemyVector[];
  zones: SandboxTacticalZone[];
  pins: SandboxMapPin[];
};

type SandboxScenePlan = {
  mode: 'simulate' | 'explain';
  title: string;
  analysis: string;
  riskLevel: 'critical' | 'high' | 'viable';
  historicalContrast: string;
  outOfBoundsNote?: string;
  camera: SandboxCameraCue;
  phases: SandboxScenePhase[];
  citedSourceIds: string[];
};

type SandboxTurnContext = {
  revision: number;
  isInitial: boolean;
  actionSinceLastTurn: SandboxMapActionMark;
  activeSummary: string;
  activeRoutes: { label: string; role: string; waypoints: GeoPoint[] }[];
  activeZones: { label: string; center: GeoPoint; kind: string }[];
};

type SandboxMapSnapshot = {
  readonly revision: number;
  readonly isInitial: boolean;
  readonly summary: string;
  readonly camera: SandboxCameraCue;
  readonly plan?: SandboxScenePlan;
};

type SandboxSnapshotState = {
  readonly stack: readonly SandboxMapSnapshot[];
  readonly pendingMarker: SandboxMapActionMark;
};

type SandboxSnapshotStack = {
  current: () => SandboxMapSnapshot;
  canRollback: () => boolean;
  depth: () => number;
  push: (rawPlan: unknown) => SandboxMapSnapshot;
  rollback: () => { changed: boolean; snapshot: SandboxMapSnapshot };
  restore: () => SandboxMapSnapshot;
  clear: () => SandboxMapSnapshot;
  markSent: () => void;
  toMapContext: () => SandboxTurnContext;
  getState: () => SandboxSnapshotState;
  serialize: () => string;
  hydrate: (raw: unknown) => boolean;
};

type SandboxStageOptions = {
  showControls?: boolean;
  viewportFocusRatioX?: number;
  onStateChange?: (state: SandboxSnapshotState) => void;
  onPhaseChange?: (phase: string) => void;
  terrain?: TerrainSurface;
};

type SandboxStageController = {
  applyPlan: (rawPlan: unknown, options?: { pushSnapshot?: boolean; animate?: boolean }) => SandboxScenePlan;
  replay: () => void;
  rollback: () => { changed: boolean; snapshot: SandboxMapSnapshot };
  restoreToInitial: () => SandboxMapSnapshot;
  clearAll: () => SandboxMapSnapshot;
  setRealRouteVisible: (visible: boolean) => void;
  isRealRouteVisible: () => boolean;
  setViewportFocusRatioX: (ratioX: number) => void;
  zoomBy: (factor: number) => void;
  toggleTilt: () => void;
  resetCamera: () => void;
  animateCameraTo: (cue: SandboxCameraCue, durationMs?: number) => void;
  getCameraState: () => SandboxCameraCue;
  getStackState: () => SandboxSnapshotState;
  toMapContext: () => SandboxTurnContext;
  canRollback: () => boolean;
  serializeState: () => string;
  hydrateState: (raw: unknown) => boolean;
  markTurnSent: () => void;
  dispose: () => void;
};

const sandboxGeoBounds = {
  minLon: 104.5,
  maxLon: 118.5,
  minLat: 23.85,
  maxLat: 30.65,
} as const;

const sandboxDefaultCamera: SandboxCameraCue = {
  center: [109.14, 26.72],
  zoom: 1.55,
  azimuth: -10,
  tilt: 34,
};

const sandboxInitialSummary =
  '1934年12月黎平战前态势：中央红军渡过湘江经通道抵黎平，湘西北敌军重兵封锁，黔北防备相对薄弱。';

const sandboxMaxSnapshots = 24;
const sandboxAspect = 1784 / 952;
const sandboxSvgNs = 'http://www.w3.org/2000/svg';

type SandboxCartographicLandmark = {
  id: string;
  label: string;
  point: GeoPoint;
  priority: number;
  role: 'anchor' | 'landmark' | 'minor';
  side: 'left' | 'top-left' | 'top-right' | 'bottom';
};

const sandboxPrebattleBase = {
  rivers: [
    {
      id: 'xiang-river',
      name: '湘江',
      points: [
        [110.22, 25.27], [110.58, 25.63], [110.73, 25.83], [111.15, 26.26],
        [111.61, 26.42], [112.15, 27.15], [112.61, 26.89], [112.98, 28.19],
      ] as GeoPoint[],
    },
    {
      id: 'qingshui-river',
      name: '清水江',
      points: [
        [107.98, 26.58], [108.42, 27.05], [108.95, 26.78], [109.20, 26.67],
        [109.75, 27.12], [110.00, 27.56], [110.39, 28.45],
      ] as GeoPoint[],
    },
    {
      id: 'wu-river',
      name: '乌江',
      points: [
        [106.58, 26.88], [107.02, 27.10], [107.47, 27.32], [107.88, 27.62],
        [108.25, 28.18], [108.19, 28.94],
      ] as GeoPoint[],
    },
  ],
  incomingTrail: [
    [110.73, 25.83],
    [110.18, 26.02],
    [109.6258, 26.31679],
    [109.14, 26.23],
  ] as GeoPoint[],
  blockadeZone: {
    id: 'nw-hunan-blockade',
    label: '湘西北重兵封锁',
    center: [110.15, 27.65] as GeoPoint,
    radiusDeg: 0.92,
    satellites: [
      { center: [110.38, 28.45] as GeoPoint, radiusDeg: 0.54 },
      { center: [109.72, 26.96] as GeoPoint, radiusDeg: 0.46 },
    ],
  },
  landmarks: [
    { id: 'liping', label: '黎平', point: [109.14, 26.23], priority: 0, role: 'anchor', side: 'left' },
    { id: 'zunyi', label: '遵义', point: [106.93, 27.69], priority: 1, role: 'landmark', side: 'top-left' },
    { id: 'wujiang', label: '乌江', point: [107.47, 27.32], priority: 1, role: 'landmark', side: 'top-right' },
    { id: 'houchang', label: '猴场', point: [107.47, 27.07], priority: 2, role: 'landmark', side: 'bottom' },
    { id: 'tongdao', label: '通道', point: [109.6258, 26.31679], priority: 2, role: 'landmark', side: 'bottom' },
    { id: 'xiangjiang', label: '湘江', point: [110.73, 25.83], priority: 2, role: 'landmark', side: 'bottom' },
    { id: 'jinping', label: '锦屏', point: [109.20, 26.67], priority: 3, role: 'minor', side: 'top-right' },
    { id: 'rongjiang', label: '榕江', point: [108.52, 25.93], priority: 3, role: 'minor', side: 'bottom' },
    { id: 'zhenyuan', label: '镇远', point: [108.42, 27.05], priority: 3, role: 'minor', side: 'top-left' },
    { id: 'sangzhi', label: '桑植', point: [110.16, 29.40], priority: 3, role: 'minor', side: 'top-right' },
  ] as readonly SandboxCartographicLandmark[],
};

const sandboxRealContrastRoute: readonly GeoPoint[] = [
  [109.14, 26.23],
  [108.58, 26.62],
  [107.90, 26.90],
  [107.47, 27.07],
  [107.47, 27.32],
  [106.93, 27.69],
];

function sandboxIsRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sandboxClampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, num));
}

function sandboxRoundGeo(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function sandboxTrimText(value: unknown, maxChars: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.trim().replace(/\s+/g, ' ');
  if (!cleaned) return fallback;
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}

function sandboxIsGeoOutOfBounds(raw: unknown): boolean {
  if (!Array.isArray(raw) || raw.length < 2) return true;
  const [lon, lat] = raw;
  if (typeof lon !== 'number' || typeof lat !== 'number' || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    return true;
  }
  return (
    lon < sandboxGeoBounds.minLon ||
    lon > sandboxGeoBounds.maxLon ||
    lat < sandboxGeoBounds.minLat ||
    lat > sandboxGeoBounds.maxLat
  );
}

function clampSandboxGeoPoint(point: GeoPoint, margin = 0.25): GeoPoint {
  const safeMargin = sandboxClampNumber(margin, 0, 1.5, 0.25);
  const minLon = sandboxGeoBounds.minLon + safeMargin;
  const maxLon = sandboxGeoBounds.maxLon - safeMargin;
  const minLat = sandboxGeoBounds.minLat + safeMargin;
  const maxLat = sandboxGeoBounds.maxLat - safeMargin;
  const rawLon = Array.isArray(point) && typeof point[0] === 'number' && Number.isFinite(point[0])
    ? point[0] : sandboxDefaultCamera.center[0];
  const rawLat = Array.isArray(point) && typeof point[1] === 'number' && Number.isFinite(point[1])
    ? point[1] : sandboxDefaultCamera.center[1];
  return [
    sandboxRoundGeo(Math.max(minLon, Math.min(maxLon, rawLon))),
    sandboxRoundGeo(Math.max(minLat, Math.min(maxLat, rawLat))),
  ];
}

function sandboxClipPointFromAnchor(anchor: GeoPoint, rawTarget: unknown, margin = 0.25): {
  point: GeoPoint;
  outOfBounds: boolean;
} {
  const safeMargin = sandboxClampNumber(margin, 0, 1.5, 0.25);
  const outOfBounds = sandboxIsGeoOutOfBounds(rawTarget);
  if (!Array.isArray(rawTarget) || rawTarget.length < 2) {
    return { point: [...anchor], outOfBounds: true };
  }
  const rawLon = typeof rawTarget[0] === 'number' && Number.isFinite(rawTarget[0]) ? rawTarget[0] : anchor[0];
  const rawLat = typeof rawTarget[1] === 'number' && Number.isFinite(rawTarget[1]) ? rawTarget[1] : anchor[1];
  const minLon = sandboxGeoBounds.minLon + safeMargin;
  const maxLon = sandboxGeoBounds.maxLon - safeMargin;
  const minLat = sandboxGeoBounds.minLat + safeMargin;
  const maxLat = sandboxGeoBounds.maxLat - safeMargin;
  const targetInside = rawLon >= minLon && rawLon <= maxLon && rawLat >= minLat && rawLat <= maxLat;
  const anchorInside = anchor[0] >= minLon && anchor[0] <= maxLon && anchor[1] >= minLat && anchor[1] <= maxLat;
  if (targetInside || !anchorInside) {
    return { point: clampSandboxGeoPoint([rawLon, rawLat], safeMargin), outOfBounds };
  }
  const dx = rawLon - anchor[0];
  const dy = rawLat - anchor[1];
  let tMax = 1;
  if (dx > 1e-9) tMax = Math.min(tMax, (maxLon - anchor[0]) / dx);
  else if (dx < -1e-9) tMax = Math.min(tMax, (minLon - anchor[0]) / dx);
  if (dy > 1e-9) tMax = Math.min(tMax, (maxLat - anchor[1]) / dy);
  else if (dy < -1e-9) tMax = Math.min(tMax, (minLat - anchor[1]) / dy);
  tMax = Math.max(0, Math.min(1, tMax));
  return {
    point: clampSandboxGeoPoint([anchor[0] + dx * tMax, anchor[1] + dy * tMax], safeMargin),
    outOfBounds: true,
  };
}

function sandboxCloneCamera(camera: SandboxCameraCue): SandboxCameraCue {
  return {
    center: [camera.center[0], camera.center[1]],
    zoom: camera.zoom,
    azimuth: camera.azimuth,
    tilt: camera.tilt,
  };
}

function sanitizeSandboxCamera(raw: unknown): { camera: SandboxCameraCue; outOfBounds: boolean } {
  if (!sandboxIsRecord(raw)) {
    return { camera: sandboxCloneCamera(sandboxDefaultCamera), outOfBounds: false };
  }
  const outOfBounds = sandboxIsGeoOutOfBounds(raw.center);
  const center = clampSandboxGeoPoint(
    Array.isArray(raw.center) ? raw.center as GeoPoint : sandboxDefaultCamera.center
  );
  return {
    outOfBounds,
    camera: {
      center,
      zoom: sandboxRoundGeo(sandboxClampNumber(raw.zoom, 0.85, 2.5, sandboxDefaultCamera.zoom)),
      azimuth: sandboxRoundGeo(sandboxClampNumber(raw.azimuth, -38, 38, sandboxDefaultCamera.azimuth)),
      tilt: sandboxRoundGeo(sandboxClampNumber(raw.tilt, 0, 55, sandboxDefaultCamera.tilt)),
    },
  };
}

function sanitizeSandboxScenePlan(raw: unknown): SandboxScenePlan {
  const fallbackPhase: SandboxScenePhase = {
    durationMs: 1100,
    redForces: [],
    enemyForces: [],
    zones: [],
    pins: [],
  };
  if (!sandboxIsRecord(raw)) {
    return {
      mode: 'explain',
      title: '1934年12月黎平战前态势',
      analysis: sandboxInitialSummary,
      riskLevel: 'high',
      historicalContrast: '黎平会议决定放弃北上湘西北原计划，转向敌军兵力薄弱的贵州北部进军。',
      camera: sandboxCloneCamera(sandboxDefaultCamera),
      phases: [fallbackPhase],
      citedSourceIds: [],
    };
  }

  let sawOutOfBounds = false;
  const cameraResult = sanitizeSandboxCamera(raw.camera);
  if (cameraResult.outOfBounds && Array.isArray((raw.camera as Record<string, unknown> | undefined)?.center)) {
    sawOutOfBounds = true;
  }

  const mode: SandboxScenePlan['mode'] = raw.mode === 'explain' ? 'explain' : 'simulate';
  const riskLevel: SandboxScenePlan['riskLevel'] =
    raw.riskLevel === 'critical' || raw.riskLevel === 'high' || raw.riskLevel === 'viable'
      ? raw.riskLevel : 'high';
  const title = sandboxTrimText(raw.title, 24, '黎平战局推演');
  const analysis = typeof raw.analysis === 'string' ? raw.analysis.trim() : '';
  const historicalContrast = sandboxTrimText(
    raw.historicalContrast,
    180,
    '黎平会议果断放弃北上湘西北原计划，决定向敌军兵力相对薄弱的贵州北部进军。'
  );

  const rawPhases = Array.isArray(raw.phases) ? raw.phases.slice(0, 3) : [];
  const phases: SandboxScenePhase[] = [];

  rawPhases.forEach((rawPhase, phaseIndex) => {
    if (!sandboxIsRecord(rawPhase)) return;
    const caption = sandboxTrimText(rawPhase.caption, 20) || undefined;
    const durationMs = Math.round(sandboxClampNumber(rawPhase.durationMs, 900, 2200, 1300));

    const redForces: SandboxForcePath[] = [];
    const rawRed = Array.isArray(rawPhase.redForces) ? rawPhase.redForces.slice(0, 3) : [];
    rawRed.forEach((item, idx) => {
      if (!sandboxIsRecord(item) || !Array.isArray(item.waypoints) || item.waypoints.length < 2) return;
      const sliced = item.waypoints.slice(0, 8);
      const waypoints: GeoPoint[] = [];
      for (let i = 0; i < sliced.length; i++) {
        const rawPt = sliced[i];
        if (i === 0) {
          if (sandboxIsGeoOutOfBounds(rawPt)) sawOutOfBounds = true;
          waypoints.push(clampSandboxGeoPoint(rawPt as GeoPoint));
        } else {
          const clipped = sandboxClipPointFromAnchor(waypoints[waypoints.length - 1], rawPt);
          if (clipped.outOfBounds) sawOutOfBounds = true;
          waypoints.push(clipped.point);
        }
      }
      if (waypoints.length < 2) return;
      const role = item.role === 'main' || item.role === 'feint' || item.role === 'flank' ||
        item.role === 'hold' || item.role === 'historical-ref' ? item.role : 'main';
      const style = item.style === 'solid-gold' || item.style === 'dashed-vermilion' ||
        item.style === 'dotted-slate' ? item.style : (role === 'feint' ? 'dashed-vermilion' : 'solid-gold');
      const outcome = item.outcome === 'advance' || item.outcome === 'blocked' ||
        item.outcome === 'stalled' || item.outcome === 'breakthrough' ? item.outcome : 'advance';
      redForces.push({
        id: sandboxTrimText(item.id, 36, `red-${phaseIndex}-${idx}`),
        role,
        label: sandboxTrimText(item.label, 14, '行动分队'),
        waypoints,
        phase: Math.round(sandboxClampNumber(item.phase, 0, 2, phaseIndex)),
        style,
        outcome,
      });
    });

    const enemyForces: SandboxEnemyVector[] = [];
    const rawEnemy = Array.isArray(rawPhase.enemyForces) ? rawPhase.enemyForces.slice(0, 6) : [];
    rawEnemy.forEach((item, idx) => {
      if (!sandboxIsRecord(item)) return;
      if (sandboxIsGeoOutOfBounds(item.from)) sawOutOfBounds = true;
      const from = clampSandboxGeoPoint((Array.isArray(item.from) ? item.from : [110.15, 27.65]) as GeoPoint);
      const clippedTo = sandboxClipPointFromAnchor(from, item.to);
      if (clippedTo.outOfBounds) sawOutOfBounds = true;
      const posture = item.posture === 'intercept' || item.posture === 'encircle' || item.posture === 'garrison'
        ? item.posture : 'intercept';
      enemyForces.push({
        id: sandboxTrimText(item.id, 36, `enemy-${phaseIndex}-${idx}`),
        label: sandboxTrimText(item.label, 14, '敌军阻击'),
        from,
        to: clippedTo.point,
        phase: Math.round(sandboxClampNumber(item.phase, 0, 2, phaseIndex)),
        posture,
      });
    });

    const zones: SandboxTacticalZone[] = [];
    const rawZones = Array.isArray(rawPhase.zones) ? rawPhase.zones.slice(0, 6) : [];
    rawZones.forEach((item, idx) => {
      if (!sandboxIsRecord(item)) return;
      if (sandboxIsGeoOutOfBounds(item.center)) sawOutOfBounds = true;
      const center = clampSandboxGeoPoint((Array.isArray(item.center) ? item.center : [109.14, 26.23]) as GeoPoint);
      const kind = item.kind === 'enemy-blockade' || item.kind === 'weak-gap' || item.kind === 'rally'
        ? item.kind : 'enemy-blockade';
      zones.push({
        id: sandboxTrimText(item.id, 36, `zone-${phaseIndex}-${idx}`),
        label: sandboxTrimText(item.label, 14, '态势区域'),
        center,
        radiusDeg: sandboxRoundGeo(sandboxClampNumber(item.radiusDeg, 0.18, 1.35, 0.55)),
        kind,
        phase: Math.round(sandboxClampNumber(item.phase, 0, 2, phaseIndex)),
      });
    });

    const pins: SandboxMapPin[] = [];
    const rawPins = Array.isArray(rawPhase.pins) ? rawPhase.pins.slice(0, 8) : [];
    rawPins.forEach(item => {
      if (!sandboxIsRecord(item)) return;
      if (sandboxIsGeoOutOfBounds(item.point)) sawOutOfBounds = true;
      const point = clampSandboxGeoPoint((Array.isArray(item.point) ? item.point : [109.14, 26.23]) as GeoPoint);
      const tone = item.tone === 'neutral' || item.tone === 'gold' || item.tone === 'vermilion'
        ? item.tone : 'neutral';
      pins.push({
        label: sandboxTrimText(item.label, 14, '节点'),
        point,
        tone,
        phase: Math.round(sandboxClampNumber(item.phase, 0, 2, phaseIndex)),
      });
    });

    phases.push({ caption, durationMs, redForces, enemyForces, zones, pins });
  });

  if (!phases.length) phases.push(fallbackPhase);

  const citedSourceIds = Array.isArray(raw.citedSourceIds)
    ? [...new Set(raw.citedSourceIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0))].slice(0, 8)
    : [];

  let outOfBoundsNote = sandboxTrimText(raw.outOfBoundsNote, 120) || undefined;
  if (sawOutOfBounds && !outOfBoundsNote) {
    outOfBoundsNote = '部分行动方向超出湘桂黔战区图幅，推演已沿对应方向截停于图幅边界并受地形兵力约束。';
  }

  return {
    mode,
    title,
    analysis,
    riskLevel,
    historicalContrast,
    ...(outOfBoundsNote ? { outOfBoundsNote } : {}),
    camera: cameraResult.camera,
    phases,
    citedSourceIds,
  };
}

function sandboxClonePlan(plan: SandboxScenePlan): SandboxScenePlan {
  return {
    ...plan,
    camera: sandboxCloneCamera(plan.camera),
    phases: plan.phases.map(phase => ({
      ...phase,
      redForces: phase.redForces.map(force => ({
        ...force,
        waypoints: force.waypoints.map(pt => [pt[0], pt[1]] as GeoPoint),
      })),
      enemyForces: phase.enemyForces.map(enemy => ({
        ...enemy,
        from: [enemy.from[0], enemy.from[1]] as GeoPoint,
        to: [enemy.to[0], enemy.to[1]] as GeoPoint,
      })),
      zones: phase.zones.map(zone => ({
        ...zone,
        center: [zone.center[0], zone.center[1]] as GeoPoint,
      })),
      pins: phase.pins.map(pin => ({
        ...pin,
        point: [pin.point[0], pin.point[1]] as GeoPoint,
      })),
    })),
    citedSourceIds: [...plan.citedSourceIds],
  };
}

function sandboxOutcomeText(outcome: SandboxForcePath['outcome']): string {
  if (outcome === 'blocked') return '受阻';
  if (outcome === 'stalled') return '迟滞';
  if (outcome === 'breakthrough') return '突破';
  return '推进';
}

function sandboxBuildPlanSummary(plan: SandboxScenePlan): string {
  const routes: string[] = [];
  const seen = new Set<string>();
  for (const phase of plan.phases) {
    for (const force of phase.redForces) {
      if (seen.has(force.label)) continue;
      seen.add(force.label);
      routes.push(`${force.label}（${sandboxOutcomeText(force.outcome)}）`);
    }
  }
  const detail = routes.length ? `：${routes.slice(0, 3).join('、')}` : '';
  const summary = `${plan.title}${detail}`;
  return summary.length > 160 ? summary.slice(0, 160) : summary;
}

function sandboxCollectVisualContext(stack: readonly SandboxMapSnapshot[]): {
  redForces: SandboxForcePath[];
  enemyForces: SandboxEnemyVector[];
  zones: SandboxTacticalZone[];
} {
  const current = stack[stack.length - 1];
  if (!current?.plan) {
    return { redForces: [], enemyForces: [], zones: [] };
  }
  const ownRed = current.plan.phases.flatMap(phase => phase.redForces);
  const ownEnemy = current.plan.phases.flatMap(phase => phase.enemyForces);
  const ownZones = current.plan.phases.flatMap(phase => phase.zones);
  if (current.plan.mode === 'simulate' || ownRed.length > 0) {
    return { redForces: ownRed, enemyForces: ownEnemy, zones: ownZones };
  }
  for (let i = stack.length - 2; i >= 1; i--) {
    const candidate = stack[i].plan;
    if (!candidate) continue;
    const red = candidate.phases.flatMap(phase => phase.redForces);
    if (red.length > 0 || candidate.mode === 'simulate') {
      return {
        redForces: red,
        enemyForces: ownEnemy.length ? ownEnemy : candidate.phases.flatMap(phase => phase.enemyForces),
        zones: [...candidate.phases.flatMap(phase => phase.zones), ...ownZones],
      };
    }
  }
  return { redForces: ownRed, enemyForces: ownEnemy, zones: ownZones };
}

function createSandboxSnapshotStack(): SandboxSnapshotStack {
  const makeInitialSnapshot = (): SandboxMapSnapshot => ({
    revision: 0,
    isInitial: true,
    summary: sandboxInitialSummary,
    camera: sandboxCloneCamera(sandboxDefaultCamera),
  });

  let stack: SandboxMapSnapshot[] = [makeInitialSnapshot()];
  let pendingMarker: SandboxMapActionMark = 'continue';
  let nextRevision = 1;

  function current(): SandboxMapSnapshot {
    return stack[stack.length - 1];
  }

  function cloneSnapshot(item: SandboxMapSnapshot): SandboxMapSnapshot {
    return {
      revision: item.revision,
      isInitial: item.isInitial,
      summary: item.summary,
      camera: sandboxCloneCamera(item.camera),
      ...(item.plan ? { plan: sandboxClonePlan(item.plan) } : {}),
    };
  }

  return {
    current: () => cloneSnapshot(current()),
    canRollback: () => stack.length > 1,
    depth: () => stack.length,
    push(rawPlan: unknown) {
      const plan = sanitizeSandboxScenePlan(rawPlan);
      const snapshot: SandboxMapSnapshot = {
        revision: nextRevision++,
        isInitial: false,
        summary: sandboxBuildPlanSummary(plan),
        camera: sandboxCloneCamera(plan.camera),
        plan,
      };
      if (stack.length >= sandboxMaxSnapshots) {
        stack = [stack[0], ...stack.slice(2), snapshot];
      } else {
        stack = [...stack, snapshot];
      }
      pendingMarker = 'continue';
      return cloneSnapshot(snapshot);
    },
    rollback() {
      if (stack.length <= 1) {
        return { changed: false, snapshot: cloneSnapshot(current()) };
      }
      stack = stack.slice(0, -1);
      pendingMarker = 'rolled_back';
      return { changed: true, snapshot: cloneSnapshot(current()) };
    },
    restore() {
      stack = [makeInitialSnapshot()];
      pendingMarker = 'restored';
      return cloneSnapshot(current());
    },
    clear() {
      stack = [makeInitialSnapshot()];
      pendingMarker = 'continue';
      nextRevision = 1;
      return cloneSnapshot(current());
    },
    markSent() {
      pendingMarker = 'continue';
    },
    toMapContext() {
      const top = current();
      const visual = sandboxCollectVisualContext(stack);
      return {
        revision: top.revision,
        isInitial: top.isInitial,
        actionSinceLastTurn: pendingMarker,
        activeSummary: top.summary,
        activeRoutes: visual.redForces.map(force => ({
          label: force.label,
          role: force.role,
          waypoints: force.waypoints.map(pt => [pt[0], pt[1]] as GeoPoint),
        })),
        activeZones: visual.zones.map(zone => ({
          label: zone.label,
          center: [zone.center[0], zone.center[1]] as GeoPoint,
          kind: zone.kind,
        })),
      };
    },
    getState() {
      return {
        stack: stack.map(cloneSnapshot),
        pendingMarker,
      };
    },
    serialize() {
      return JSON.stringify({
        version: 1,
        nextRevision,
        pendingMarker,
        stack,
      });
    },
    hydrate(raw: unknown) {
      let parsed: unknown = raw;
      if (typeof raw === 'string') {
        try {
          parsed = JSON.parse(raw);
        } catch {
          return false;
        }
      }
      if (!sandboxIsRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.stack) || parsed.stack.length === 0) {
        return false;
      }
      const nextStack: SandboxMapSnapshot[] = [];
      for (let i = 0; i < Math.min(sandboxMaxSnapshots, parsed.stack.length); i++) {
        const entry = parsed.stack[i];
        if (!sandboxIsRecord(entry) || typeof entry.revision !== 'number' || !Number.isSafeInteger(entry.revision)) {
          return false;
        }
        if (i === 0) {
          if (entry.isInitial !== true) return false;
          nextStack.push(makeInitialSnapshot());
          continue;
        }
        const plan = sanitizeSandboxScenePlan(entry.plan);
        const camera = sanitizeSandboxCamera(entry.camera).camera;
        nextStack.push({
          revision: entry.revision,
          isInitial: false,
          summary: sandboxTrimText(entry.summary, 160, sandboxBuildPlanSummary(plan)),
          camera,
          plan,
        });
      }
      if (!nextStack.length) return false;
      const marker: SandboxMapActionMark =
        parsed.pendingMarker === 'rolled_back' || parsed.pendingMarker === 'restored'
          ? parsed.pendingMarker : 'continue';
      const maxRev = nextStack.reduce((acc, item) => Math.max(acc, item.revision), 0);
      const candidateNextRev = typeof parsed.nextRevision === 'number' && Number.isSafeInteger(parsed.nextRevision)
        ? parsed.nextRevision : maxRev + 1;
      stack = nextStack;
      pendingMarker = marker;
      nextRevision = Math.max(maxRev + 1, candidateNextRev);
      return true;
    },
  };
}

function sandboxGeoToPercent([lon, lat]: GeoPoint): [number, number] {
  return [
    (lon - sandboxGeoBounds.minLon) / (sandboxGeoBounds.maxLon - sandboxGeoBounds.minLon) * 100,
    (sandboxGeoBounds.maxLat - lat) / (sandboxGeoBounds.maxLat - sandboxGeoBounds.minLat) * 100,
  ];
}

function sandboxSampleGeoPath(points: readonly GeoPoint[], subdivisions = 12): [number, number][] {
  if (!points.length) return [];
  const pct = points.map(sandboxGeoToPercent);
  if (pct.length === 1) return pct;
  const sampled: [number, number][] = [];
  for (let i = 1; i < pct.length; i++) {
    const [x0, y0] = pct[i - 1];
    const [x1, y1] = pct[i];
    for (let step = 0; step < subdivisions; step++) {
      const t = step / subdivisions;
      sampled.push([x0 + (x1 - x0) * t, y0 + (y1 - y0) * t]);
    }
  }
  sampled.push(pct[pct.length - 1]);
  return sampled;
}

function sandboxProjectArc(points: readonly [number, number][], terrain: TerrainSurface): {
  projected: [number, number][];
  distances: number[];
  totalDistance: number;
} {
  const projected = points.map(pt => terrain.project(pt) as [number, number]);
  let totalDistance = 0;
  const distances = projected.map(([x, y], index) => {
    if (index > 0) {
      const [px, py] = projected[index - 1];
      totalDistance += Math.hypot((x - px) * sandboxAspect, y - py);
    }
    return totalDistance;
  });
  return { projected, distances, totalDistance };
}

function sandboxSliceProjectedArc(
  arc: { projected: [number, number][]; distances: number[]; totalDistance: number },
  fraction: number
): { d: string; head?: [number, number] } {
  const { projected, distances, totalDistance } = arc;
  if (fraction <= 0 || !projected.length) return { d: '' };
  if (fraction >= 1 || totalDistance <= 1e-6) {
    return {
      d: 'M ' + projected.map(pt => pt[0].toFixed(3) + ' ' + pt[1].toFixed(3)).join(' L '),
      head: projected[projected.length - 1],
    };
  }
  const target = totalDistance * fraction;
  const next = distances.findIndex(value => value > target);
  if (next < 1) return { d: '', head: projected[0] };
  const [x0, y0] = projected[next - 1];
  const [x1, y1] = projected[next];
  const span = Math.max(1e-6, distances[next] - distances[next - 1]);
  const t = (target - distances[next - 1]) / span;
  const head: [number, number] = [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
  const active = [...projected.slice(0, next), head];
  return {
    d: 'M ' + active.map(pt => pt[0].toFixed(3) + ' ' + pt[1].toFixed(3)).join(' L '),
    head,
  };
}

function sandboxCreateEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  text = ''
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function sandboxCreateSvg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {}
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(sandboxSvgNs, tag);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, value);
  }
  return node;
}

function sandboxIconButton(label: string, paths: readonly string[], onClick: () => void, className = ''): HTMLButtonElement {
  const button = sandboxCreateEl('button', `icon-button ${className}`.trim());
  button.type = 'button';
  button.setAttribute('aria-label', label);
  button.title = label;
  const svg = sandboxCreateSvg('svg', { class: 'icon', viewBox: '0 0 24 24', 'aria-hidden': 'true' });
  for (const d of paths) {
    svg.append(sandboxCreateSvg('path', { d }));
  }
  button.append(svg);
  button.addEventListener('click', onClick);
  return button;
}

function mountSandboxStage(host: HTMLElement, options: SandboxStageOptions = {}): SandboxStageController {
  const stack = createSandboxSnapshotStack();
  const reducedMotionQuery = typeof matchMedia === 'function'
    ? matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };
  const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const scheduleFrame = (fn: () => void): number =>
    typeof requestAnimationFrame === 'function' ? requestAnimationFrame(fn) : Number(setTimeout(fn, 16));
  const cancelFrame = (id: number) => {
    if (!id) return;
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id);
    else clearTimeout(id);
  };

  let viewportFocusRatioX = typeof options.viewportFocusRatioX === 'number'
    ? sandboxClampNumber(options.viewportFocusRatioX, 0.25, 0.7, 0.36) : 0.36;
  let realRouteVisible = false;
  let disposed = false;

  let camera: SandboxCameraCue = sandboxCloneCamera(sandboxDefaultCamera);
  let stageWidth = 0;
  let stageHeight = 0;
  let worldWidth = 0;
  let worldHeight = 0;
  let worldOffset: [number, number] = [0, 0];
  let viewportRectOffset: [number, number] = [0, 0];
  let projectedDirty = true;
  let cameraRaf = 0;
  let cameraTweenRaf = 0;
  let phaseRaf = 0;
  let renderedTransform = '';
  let renderedZoom = 0;
  let projectedAngleKey = '';
  let projectedReady: boolean | undefined;

  const terrain: TerrainSurface = options.terrain ?? createTerrainSurface(() => {
    projectedDirty = true;
    scheduleCameraRender();
  });
  terrain.onChange = () => {
    projectedDirty = true;
    scheduleCameraRender();
  };
  terrain.setTheme('sandbox');

  host.classList.add('sandbox-stage');
  host.dataset.theme = 'sandbox';
  host.dataset.phase = 'initial';
  host.dataset.revision = '0';
  host.dataset.stackDepth = '1';
  host.dataset.realRoute = 'false';
  host.dataset.terrain = terrain.ready ? 'relief' : 'raster';

  const viewport = sandboxCreateEl('div', 'sandbox-viewport');
  viewport.setAttribute('aria-label', '黎平三维沙盘地形视口');
  const world = sandboxCreateEl('div', 'sandbox-world');
  const svg = sandboxCreateSvg('svg', {
    class: 'sandbox-vector-layer',
    viewBox: '0 0 100 100',
    preserveAspectRatio: 'none',
    'aria-hidden': 'true',
  });
  const defs = sandboxCreateSvg('defs');
  const dotPattern = sandboxCreateSvg('pattern', {
    id: 'sandbox-blockade-dots',
    width: '0.85',
    height: (0.85 * sandboxAspect).toFixed(3),
    patternUnits: 'userSpaceOnUse',
  });
  dotPattern.append(sandboxCreateSvg('ellipse', {
    cx: '0.42',
    cy: (0.42 * sandboxAspect).toFixed(3),
    rx: '0.14',
    ry: (0.14 * sandboxAspect).toFixed(3),
    fill: '#a9483b',
    opacity: '0.42',
  }));
  const weakPattern = sandboxCreateSvg('pattern', {
    id: 'sandbox-weak-dots',
    width: '0.95',
    height: (0.95 * sandboxAspect).toFixed(3),
    patternUnits: 'userSpaceOnUse',
  });
  weakPattern.append(sandboxCreateSvg('ellipse', {
    cx: '0.47',
    cy: (0.47 * sandboxAspect).toFixed(3),
    rx: '0.13',
    ry: (0.13 * sandboxAspect).toFixed(3),
    fill: '#b88f46',
    opacity: '0.38',
  }));
  const enemyMarker = sandboxCreateSvg('marker', {
    id: 'sandbox-enemy-arrow',
    viewBox: '0 0 10 10',
    refX: '7.5',
    refY: '5',
    markerWidth: '4.5',
    markerHeight: '4.5',
    orient: 'auto-start-reverse',
  });
  enemyMarker.append(sandboxCreateSvg('path', { d: 'M 1 1.5 L 8.5 5 L 1 8.5 z', fill: '#9f3d30' }));
  const redMarker = sandboxCreateSvg('marker', {
    id: 'sandbox-red-arrow',
    viewBox: '0 0 10 10',
    refX: '7.5',
    refY: '5',
    markerWidth: '4.2',
    markerHeight: '4.2',
    orient: 'auto-start-reverse',
  });
  redMarker.append(sandboxCreateSvg('path', { d: 'M 1 1.5 L 8.5 5 L 1 8.5 z', fill: '#c8963e' }));
  defs.append(dotPattern, weakPattern, enemyMarker, redMarker);

  const riversGroup = sandboxCreateSvg('g', { class: 'sandbox-rivers' });
  const baseGroup = sandboxCreateSvg('g', { class: 'sandbox-base-layer' });
  const realRouteGroup = sandboxCreateSvg('g', { class: 'sandbox-real-route', hidden: 'true' });
  const zonesGroup = sandboxCreateSvg('g', { class: 'sandbox-plan-zones' });
  const enemyGroup = sandboxCreateSvg('g', { class: 'sandbox-plan-enemy' });
  const redGroup = sandboxCreateSvg('g', { class: 'sandbox-plan-red' });
  svg.append(defs, riversGroup, baseGroup, realRouteGroup, zonesGroup, enemyGroup, redGroup);

  world.append(terrain.element, svg);

  const labelLayer = sandboxCreateEl('div', 'sandbox-label-layer');
  labelLayer.setAttribute('aria-hidden', 'true');
  const rulers = sandboxCreateEl('div', 'sandbox-rulers');
  rulers.setAttribute('aria-hidden', 'true');
  const captionPill = sandboxCreateEl('div', 'sandbox-caption-pill');
  captionPill.hidden = true;
  viewport.append(world, labelLayer, rulers, captionPill);

  const riverPaths = sandboxPrebattleBase.rivers.map(river => {
    const path = sandboxCreateSvg('path', { class: 'sandbox-river-vein', 'data-river': river.id });
    riversGroup.append(path);
    return { sampled: sandboxSampleGeoPath(river.points, 8), path };
  });
  const incomingSampled = sandboxSampleGeoPath(sandboxPrebattleBase.incomingTrail, 10);
  const incomingPath = sandboxCreateSvg('path', { class: 'sandbox-incoming-trail' });
  baseGroup.append(incomingPath);

  const blockadeCircles = [
    { center: sandboxPrebattleBase.blockadeZone.center, radiusDeg: sandboxPrebattleBase.blockadeZone.radiusDeg, primary: true },
    ...sandboxPrebattleBase.blockadeZone.satellites.map(s => ({ ...s, primary: false })),
  ].map(zone => {
    const fillCircle = sandboxCreateSvg('ellipse', {
      class: 'sandbox-blockade-field',
      fill: 'url(#sandbox-blockade-dots)',
    });
    const ring = sandboxCreateSvg('ellipse', {
      class: zone.primary ? 'sandbox-blockade-ring is-primary' : 'sandbox-blockade-ring',
    });
    baseGroup.append(fillCircle, ring);
    return { zone, fillCircle, ring };
  });

  const lipingAnchorOuter = sandboxCreateSvg('ellipse', { class: 'sandbox-rally-pulse' });
  const lipingAnchorCore = sandboxCreateSvg('ellipse', { class: 'sandbox-rally-core' });
  baseGroup.append(lipingAnchorOuter, lipingAnchorCore);

  const realRouteSampled = sandboxSampleGeoPath(sandboxRealContrastRoute, 12);
  const realRoutePath = sandboxCreateSvg('path', { class: 'sandbox-real-contrast-path' });
  realRouteGroup.append(realRoutePath);

  const lonTicks = [106, 108, 110, 112, 114, 116].map(lon => {
    const topTick = sandboxCreateEl('span', 'sandbox-ruler-tick is-top', `${lon}°E`);
    const bottomTick = sandboxCreateEl('span', 'sandbox-ruler-tick is-bottom', `${lon}°E`);
    rulers.append(topTick, bottomTick);
    return { lon, topTick, bottomTick };
  });
  const latTicks = [25, 27, 29].map(lat => {
    const leftTick = sandboxCreateEl('span', 'sandbox-ruler-tick is-left', `${lat}°N`);
    const rightTick = sandboxCreateEl('span', 'sandbox-ruler-tick is-right', `${lat}°N`);
    rulers.append(leftTick, rightTick);
    return { lat, leftTick, rightTick };
  });

  type LabelItem = {
    id: string;
    label: string;
    geo: GeoPoint;
    pct: [number, number];
    priority: number;
    role: 'anchor' | 'landmark' | 'minor' | 'dynamic';
    tone: 'neutral' | 'gold' | 'vermilion';
    side: 'left' | 'top-left' | 'top-right' | 'bottom';
    pin: HTMLSpanElement;
    text: HTMLSpanElement;
    width: number;
    height: number;
    slot: number;
    opacity: number;
  };

  function makeLabelItem(
    id: string,
    label: string,
    geo: GeoPoint,
    priority: number,
    role: LabelItem['role'],
    tone: LabelItem['tone'],
    side: LabelItem['side']
  ): LabelItem {
    const pin = sandboxCreateEl('span', `sandbox-landmark-pin is-${role} is-tone-${tone}`);
    const text = sandboxCreateEl('span', `sandbox-landmark-name is-${role} is-tone-${tone}`, label);
    labelLayer.append(pin, text);
    return {
      id,
      label,
      geo,
      pct: sandboxGeoToPercent(geo),
      priority,
      role,
      tone,
      side,
      pin,
      text,
      width: Math.max(36, label.length * 14 + 14),
      height: 22,
      slot: -1,
      opacity: 1,
    };
  }

  const baseLandmarks: LabelItem[] = [
    ...sandboxPrebattleBase.landmarks.map(item =>
      makeLabelItem(item.id, item.label, item.point, item.priority, item.role, item.id === 'liping' ? 'gold' : 'neutral', item.side)
    ),
    makeLabelItem('blockade-label', sandboxPrebattleBase.blockadeZone.label, sandboxPrebattleBase.blockadeZone.center, 2, 'minor', 'vermilion', 'top-right'),
  ];
  let dynamicLabels: LabelItem[] = [];

  let controlsBar: HTMLDivElement | undefined;
  let zoomOutBtn: HTMLButtonElement | undefined;
  let zoomInBtn: HTMLButtonElement | undefined;
  let zoomReadoutEl: HTMLSpanElement | undefined;
  let tiltBtn: HTMLButtonElement | undefined;
  let resetBtn: HTMLButtonElement | undefined;

  if (options.showControls !== false) {
    controlsBar = sandboxCreateEl('div', 'sandbox-camera-controls');
    zoomOutBtn = sandboxIconButton('缩小沙盘', ['M5 12h14'], () => zoomBy(1 / 1.22));
    zoomReadoutEl = sandboxCreateEl('span', 'sandbox-zoom-readout', '155%');
    zoomReadoutEl.setAttribute('aria-live', 'polite');
    zoomInBtn = sandboxIconButton('放大沙盘', ['M12 5v14', 'M5 12h14'], () => zoomBy(1.22));
    tiltBtn = sandboxIconButton(
      '切换俯视或斜视',
      ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z', 'M16.24 7.76l-2.12 6.36-6.36 2.12 2.12-6.36 6.36-2.12z'],
      () => toggleTilt()
    );
    resetBtn = sandboxIconButton(
      '重置沙盘视角',
      ['M3 12a9 9 0 1 0 3-6.7L3 8', 'M3 3v5h5'],
      () => resetCamera()
    );
    controlsBar.append(zoomOutBtn, zoomReadoutEl, zoomInBtn, tiltBtn, resetBtn);
    host.append(viewport, controlsBar);
  } else {
    host.append(viewport);
  }

  type ActiveForceAnim = {
    data: SandboxForcePath;
    phase: number;
    sampled: [number, number][];
    arc?: { projected: [number, number][]; distances: number[]; totalDistance: number };
    pathEl: SVGPathElement;
    headEl: SVGEllipseElement;
    endEl: SVGPathElement;
    progress: number;
  };
  type ActiveEnemyAnim = {
    data: SandboxEnemyVector;
    phase: number;
    sampled: [number, number][];
    arc?: { projected: [number, number][]; distances: number[]; totalDistance: number };
    pathEl: SVGPathElement;
    progress: number;
  };
  type ActiveZoneAnim = {
    data: SandboxTacticalZone;
    phase: number;
    fillEl: SVGEllipseElement;
    ringEl: SVGEllipseElement;
    opacity: number;
  };
  type ActivePinAnim = {
    data: SandboxMapPin;
    phase: number;
    item: LabelItem;
  };

  let activeForces: ActiveForceAnim[] = [];
  let activeEnemies: ActiveEnemyAnim[] = [];
  let activeZones: ActiveZoneAnim[] = [];
  let activePins: ActivePinAnim[] = [];
  let baseProjectedReady = false;

  function focusTargetPixel(): [number, number] {
    const narrow = stageWidth <= 820;
    const rx = narrow ? 0.5 : viewportFocusRatioX;
    const ry = narrow ? 0.44 : 0.48;
    return [stageWidth * rx, stageHeight * ry];
  }

  function applyWorldCenterFromCamera() {
    if (!stageWidth || !stageHeight || !worldWidth || !worldHeight) return;
    terrain.orient([camera.azimuth, camera.tilt]);
    const [cxPct, cyPct] = terrain.project(sandboxGeoToPercent(camera.center)) as [number, number];
    const [targetX, targetY] = focusTargetPixel();
    worldOffset = [
      targetX - worldWidth * camera.zoom * (cxPct / 100),
      targetY - worldHeight * camera.zoom * (cyPct / 100),
    ];
  }

  function clampPanOffset([tx, ty]: [number, number]): [number, number] {
    if (!stageWidth || !stageHeight || !worldWidth || !worldHeight) return [tx, ty];
    const scaledW = worldWidth * camera.zoom;
    const scaledH = worldHeight * camera.zoom;
    const minX = stageWidth * 0.15 - scaledW;
    const maxX = stageWidth * 0.85;
    const minY = stageHeight * 0.15 - scaledH;
    const maxY = stageHeight * 0.85;
    return [
      Math.max(minX, Math.min(maxX, tx)),
      Math.max(minY, Math.min(maxY, ty)),
    ];
  }

  function syncCameraCenterFromWorldOffset() {
    if (!stageWidth || !stageHeight || !worldWidth || !worldHeight) return;
    const [targetX, targetY] = focusTargetPixel();
    const targetPctX = (targetX - worldOffset[0]) / (worldWidth * camera.zoom) * 100;
    const targetPctY = (targetY - worldOffset[1]) / (worldHeight * camera.zoom) * 100;
    const rawLon = sandboxGeoBounds.minLon + (targetPctX / 100) * (sandboxGeoBounds.maxLon - sandboxGeoBounds.minLon);
    const rawLat = sandboxGeoBounds.maxLat - (targetPctY / 100) * (sandboxGeoBounds.maxLat - sandboxGeoBounds.minLat);
    camera.center = clampSandboxGeoPoint([rawLon, rawLat], 0);
  }

  function measureViewportOffset() {
    if (typeof viewport.getBoundingClientRect !== 'function') return;
    const rect = viewport.getBoundingClientRect();
    viewportRectOffset = [rect.left, rect.top];
  }

  function layoutViewport() {
    measureViewportOffset();
    const nextW = viewport.clientWidth || 1280;
    const nextH = viewport.clientHeight || 720;
    if (nextW === stageWidth && nextH === stageHeight) return;
    stageWidth = nextW;
    stageHeight = nextH;
    const narrow = stageWidth <= 820;
    worldWidth = Math.max(stageWidth * (narrow ? 1.02 : 0.96), stageHeight * (narrow ? 0.58 : 0.93) * sandboxAspect);
    worldHeight = worldWidth / sandboxAspect;
    world.style.width = worldWidth + 'px';
    world.style.height = worldHeight + 'px';
    applyWorldCenterFromCamera();
    projectedDirty = true;
    scheduleCameraRender();
  }

  function projectGeoRadiusToSvg(centerGeo: GeoPoint, radiusDeg: number): [number, number] {
    const cPct = terrain.project(sandboxGeoToPercent(centerGeo)) as [number, number];
    const rxPct = terrain.project(sandboxGeoToPercent([centerGeo[0] + radiusDeg, centerGeo[1]])) as [number, number];
    const ryPct = terrain.project(sandboxGeoToPercent([centerGeo[0], centerGeo[1] + radiusDeg])) as [number, number];
    const rx = Math.max(1.2, Math.hypot(rxPct[0] - cPct[0], rxPct[1] - cPct[1]));
    const ry = Math.max(1.0, Math.hypot(ryPct[0] - cPct[0], ryPct[1] - cPct[1]));
    return [rx, ry];
  }

  function projectGeometry() {
    const angleKey = `${camera.azimuth.toFixed(2)},${camera.tilt.toFixed(2)}`;
    const reliefReady = terrain.ready;
    if (!projectedDirty && angleKey === projectedAngleKey && reliefReady === projectedReady) return;
    projectedDirty = false;
    projectedAngleKey = angleKey;
    projectedReady = reliefReady;
    host.dataset.terrain = reliefReady ? 'relief' : 'raster';
    terrain.orient([camera.azimuth, camera.tilt]);

    riverPaths.forEach(({ sampled, path }) => {
      const pts = sampled.map(pt => terrain.project(pt));
      path.setAttribute('d', 'M ' + pts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L '));
    });
    const inPts = incomingSampled.map(pt => terrain.project(pt));
    incomingPath.setAttribute('d', 'M ' + inPts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L '));

    blockadeCircles.forEach(({ zone, fillCircle, ring }) => {
      const [cx, cy] = terrain.project(sandboxGeoToPercent(zone.center));
      const [rx, ry] = projectGeoRadiusToSvg(zone.center, zone.radiusDeg);
      for (const el of [fillCircle, ring]) {
        el.setAttribute('cx', cx.toFixed(2));
        el.setAttribute('cy', cy.toFixed(2));
        el.setAttribute('rx', rx.toFixed(2));
        el.setAttribute('ry', ry.toFixed(2));
      }
    });

    const [lx, ly] = terrain.project(sandboxGeoToPercent([109.14, 26.23]));
    lipingAnchorOuter.setAttribute('cx', lx.toFixed(2));
    lipingAnchorOuter.setAttribute('cy', ly.toFixed(2));
    lipingAnchorOuter.setAttribute('rx', '1.08');
    lipingAnchorOuter.setAttribute('ry', (1.08 * sandboxAspect).toFixed(2));
    lipingAnchorCore.setAttribute('cx', lx.toFixed(2));
    lipingAnchorCore.setAttribute('cy', ly.toFixed(2));
    lipingAnchorCore.setAttribute('rx', '0.32');
    lipingAnchorCore.setAttribute('ry', (0.32 * sandboxAspect).toFixed(2));

    const realPts = realRouteSampled.map(pt => terrain.project(pt));
    realRoutePath.setAttribute('d', 'M ' + realPts.map(p => p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join(' L '));

    activeForces.forEach(force => {
      force.arc = sandboxProjectArc(force.sampled, terrain);
    });
    activeEnemies.forEach(enemy => {
      enemy.arc = sandboxProjectArc(enemy.sampled, terrain);
    });
    activeZones.forEach(zone => {
      const [cx, cy] = terrain.project(sandboxGeoToPercent(zone.data.center));
      const [rx, ry] = projectGeoRadiusToSvg(zone.data.center, zone.data.radiusDeg);
      for (const el of [zone.fillEl, zone.ringEl]) {
        el.setAttribute('cx', cx.toFixed(2));
        el.setAttribute('cy', cy.toFixed(2));
        el.setAttribute('rx', rx.toFixed(2));
        el.setAttribute('ry', ry.toFixed(2));
      }
    });

    baseProjectedReady = true;
    repaintAnimatedVectors();
  }

  function repaintAnimatedVectors() {
    if (!baseProjectedReady) return;
    for (const force of activeForces) {
      if (!force.arc) continue;
      const { d, head } = sandboxSliceProjectedArc(force.arc, force.progress);
      force.pathEl.setAttribute('d', d);
      const visible = force.progress > 0.01;
      force.pathEl.style.opacity = visible ? '1' : '0';
      if (head && force.progress > 0.02 && force.progress < 0.995) {
        force.headEl.setAttribute('cx', head[0].toFixed(2));
        force.headEl.setAttribute('cy', head[1].toFixed(2));
        force.headEl.style.opacity = '1';
      } else {
        force.headEl.style.opacity = '0';
      }
      if (force.progress >= 0.96 && (force.data.outcome === 'blocked' || force.data.outcome === 'stalled')) {
        const pts = force.arc.projected;
        const last = pts[pts.length - 1];
        const prev = pts[Math.max(0, pts.length - 2)];
        const vx = last[0] - prev[0];
        const vy = last[1] - prev[1];
        const len = Math.max(1e-4, Math.hypot(vx, vy));
        const nx = -vy / len * 1.1;
        const ny = vx / len * 1.1;
        force.endEl.setAttribute(
          'd',
          `M ${(last[0] - nx).toFixed(2)} ${(last[1] - ny).toFixed(2)} L ${(last[0] + nx).toFixed(2)} ${(last[1] + ny).toFixed(2)}`
        );
        force.endEl.style.opacity = '1';
      } else {
        force.endEl.style.opacity = '0';
      }
    }

    for (const enemy of activeEnemies) {
      if (!enemy.arc) continue;
      const { d } = sandboxSliceProjectedArc(enemy.arc, enemy.progress);
      enemy.pathEl.setAttribute('d', d);
      enemy.pathEl.style.opacity = enemy.progress > 0.01 ? '0.9' : '0';
    }

    for (const zone of activeZones) {
      const o = String(zone.opacity);
      zone.fillEl.style.opacity = o;
      zone.ringEl.style.opacity = o;
    }
  }

  function layoutLabelsAndRulers() {
    if (!stageWidth || !stageHeight || !worldWidth || !worldHeight) return;
    const scaledW = worldWidth * camera.zoom;
    const scaledH = worldHeight * camera.zoom;
    const [tx, ty] = worldOffset;

    const dockCompact = stageWidth <= 900 || viewportFocusRatioX >= 0.45;
    const rightBound = dockCompact ? stageWidth - 28 : Math.max(360, stageWidth - 462);
    for (const tick of lonTicks) {
      const [u] = terrain.project(sandboxGeoToPercent([tick.lon, 27.0]));
      const px = tx + scaledW * u / 100;
      const topVis = px >= 255 && px <= stageWidth - 355;
      const botVis = px >= 415 && px <= rightBound;
      tick.topTick.hidden = !topVis;
      tick.bottomTick.hidden = !botVis;
      if (topVis) tick.topTick.style.left = px.toFixed(1) + 'px';
      if (botVis) tick.bottomTick.style.left = px.toFixed(1) + 'px';
    }
    for (const tick of latTicks) {
      const [, v] = terrain.project(sandboxGeoToPercent([109.14, tick.lat]));
      const py = ty + scaledH * v / 100;
      const leftVis = py >= 115 && py <= stageHeight - 95;
      const rightVis = dockCompact && py >= 95 && py <= stageHeight - 95;
      tick.leftTick.hidden = !leftVis;
      tick.rightTick.hidden = !rightVis;
      if (leftVis) tick.leftTick.style.top = py.toFixed(1) + 'px';
      if (rightVis) tick.rightTick.style.top = py.toFixed(1) + 'px';
    }

    type Box = { x: number; y: number; w: number; h: number };
    const uiGuardBoxes: Box[] = [
      { x: 0, y: 0, w: 268, h: 96 },
      { x: Math.max(0, stageWidth - 380), y: 0, w: 380, h: 72 },
      { x: 0, y: Math.max(0, stageHeight - 86), w: 425, h: 86 },
      ...(dockCompact ? [] : [{ x: Math.max(0, stageWidth - 462), y: 66, w: 462, h: Math.max(0, stageHeight - 66) }]),
    ];
    const used: Box[] = [...uiGuardBoxes];
    const overlaps = (a: Box, b: Box) => !(a.x + a.w + 6 < b.x || b.x + b.w + 6 < a.x || a.y + a.h + 5 < b.y || b.y + b.h + 5 < a.y);
    const inBounds = (rect: Box) =>
      rect.x >= 12 && rect.y >= 12 && rect.x + rect.w <= stageWidth - 12 && rect.y + rect.h <= stageHeight - 12;
    const clearOfUsed = (rect: Box) => used.every(box => !overlaps(rect, box));
    const clearOfUi = (rect: Box) => uiGuardBoxes.every(box => !overlaps(rect, box));
    const slotsFor = (w: number, h: number, side: LabelItem['side']): [number, number][] => {
      const topRight: [number, number] = [9, -h - 7];
      const topLeft: [number, number] = [-9 - w, -h - 7];
      const left: [number, number] = [-10 - w, -h / 2];
      const right: [number, number] = [10, -h / 2];
      const bottom: [number, number] = [-w / 2, 10];
      const top: [number, number] = [-w / 2, -h - 9];
      if (side === 'left') return [left, topLeft, top, bottom, right, topRight];
      if (side === 'top-left') return [topLeft, left, top, topRight, bottom, right];
      if (side === 'bottom') return [bottom, topRight, topLeft, left, right, top];
      return [topRight, right, top, bottom, topLeft, left];
    };

    const allLabels = [...baseLandmarks, ...dynamicLabels].sort((a, b) => a.priority - b.priority);
    for (const item of allLabels) {
      const [u, v] = terrain.project(item.pct);
      const x = tx + scaledW * u / 100;
      const y = ty + scaledH * v / 100;
      const onStage = item.opacity > 0.01 && x >= 8 && x <= stageWidth - 8 && y >= 8 && y <= stageHeight - 8;
      item.pin.style.opacity = onStage ? String(item.opacity) : '0';
      if (!onStage) {
        item.text.style.opacity = '0';
        continue;
      }
      item.pin.style.left = x.toFixed(1) + 'px';
      item.pin.style.top = y.toFixed(1) + 'px';
      const candidates = slotsFor(item.width, item.height, item.side)
        .map(([dx, dy]): Box => ({ x: x + dx, y: y + dy, w: item.width, h: item.height }));
      let picked: Box | undefined;
      if (item.slot >= 0 && item.slot < candidates.length && inBounds(candidates[item.slot]) && clearOfUsed(candidates[item.slot])) {
        picked = candidates[item.slot];
      }
      if (!picked) {
        const hit = candidates.findIndex(rect => inBounds(rect) && clearOfUsed(rect));
        if (hit >= 0) {
          item.slot = hit;
          picked = candidates[hit];
        }
      }
      if (!picked && item.priority <= 1) {
        const uiSafe = candidates.findIndex(rect => inBounds(rect) && clearOfUi(rect));
        if (uiSafe >= 0) {
          picked = candidates[uiSafe];
          item.slot = uiSafe;
        }
      }
      if (picked) {
        item.text.style.opacity = String(item.opacity);
        item.text.style.left = picked.x.toFixed(1) + 'px';
        item.text.style.top = picked.y.toFixed(1) + 'px';
        used.push(picked);
      } else {
        item.text.style.opacity = '0';
      }
    }
  }

  function renderFrame() {
    cameraRaf = 0;
    if (disposed) return;
    projectGeometry();
    const [tx, ty] = worldOffset;
    const transform = `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${camera.zoom.toFixed(4)})`;
    if (renderedTransform !== transform) {
      renderedTransform = transform;
      world.style.transform = transform;
    }
    if (renderedZoom !== camera.zoom) {
      renderedZoom = camera.zoom;
      world.style.setProperty?.('--inverse-zoom', String(1 / camera.zoom));
      if (zoomOutBtn) zoomOutBtn.disabled = camera.zoom <= 0.855;
      if (zoomInBtn) zoomInBtn.disabled = camera.zoom >= 2.495;
      if (zoomReadoutEl) zoomReadoutEl.textContent = Math.round(camera.zoom * 100) + '%';
    }
    layoutLabelsAndRulers();
  }

  function scheduleCameraRender() {
    if (!cameraRaf && !disposed) {
      cameraRaf = scheduleFrame(renderFrame);
    }
  }

  function cancelCameraTween() {
    if (cameraTweenRaf) {
      cancelFrame(cameraTweenRaf);
      cameraTweenRaf = 0;
    }
  }

  function cancelPhaseAnimation() {
    if (phaseRaf) {
      cancelFrame(phaseRaf);
      phaseRaf = 0;
    }
  }

  function animateCameraTo(cue: SandboxCameraCue, durationMs = 520) {
    cancelCameraTween();
    const target = sanitizeSandboxCamera(cue).camera;
    if (reducedMotionQuery.matches || durationMs <= 0 || !stageWidth) {
      camera = target;
      applyWorldCenterFromCamera();
      projectedDirty = true;
      scheduleCameraRender();
      return;
    }
    const startCam = sandboxCloneCamera(camera);
    const startTime = nowMs();
    const tick = () => {
      if (disposed) return;
      const elapsed = nowMs() - startTime;
      const raw = Math.min(1, elapsed / durationMs);
      const ease = 1 - Math.pow(1 - raw, 3);
      camera = {
        center: [
          startCam.center[0] + (target.center[0] - startCam.center[0]) * ease,
          startCam.center[1] + (target.center[1] - startCam.center[1]) * ease,
        ],
        zoom: startCam.zoom + (target.zoom - startCam.zoom) * ease,
        azimuth: startCam.azimuth + (target.azimuth - startCam.azimuth) * ease,
        tilt: startCam.tilt + (target.tilt - startCam.tilt) * ease,
      };
      applyWorldCenterFromCamera();
      projectedDirty = true;
      renderFrame();
      if (raw < 1) {
        cameraTweenRaf = scheduleFrame(tick);
      } else {
        cameraTweenRaf = 0;
      }
    };
    cameraTweenRaf = scheduleFrame(tick);
  }

  function zoomAt(nextZoom: number, anchorPoint?: [number, number]) {
    cancelCameraTween();
    const prev = camera.zoom;
    const next = sandboxClampNumber(nextZoom, 0.85, 2.5, prev);
    if (Math.abs(next - prev) < 1e-5) return;
    const anchor = anchorPoint ?? focusTargetPixel();
    const ratio = next / prev;
    camera.zoom = next;
    worldOffset = clampPanOffset([
      anchor[0] - (anchor[0] - worldOffset[0]) * ratio,
      anchor[1] - (anchor[1] - worldOffset[1]) * ratio,
    ]);
    syncCameraCenterFromWorldOffset();
    scheduleCameraRender();
  }

  function zoomBy(factor: number) {
    zoomAt(camera.zoom * factor);
  }

  function toggleTilt() {
    cancelCameraTween();
    const nextTilt = camera.tilt < 12 ? 34 : 0;
    animateCameraTo({ ...camera, tilt: nextTilt }, 380);
  }

  function resetCamera() {
    animateCameraTo(sandboxDefaultCamera, 460);
  }

  function clearPlanElements() {
    zonesGroup.replaceChildren();
    enemyGroup.replaceChildren();
    redGroup.replaceChildren();
    for (const base of baseLandmarks) {
      delete base.text.dataset.highlight;
    }
    for (const item of dynamicLabels) {
      item.pin.remove();
      item.text.remove();
    }
    dynamicLabels = [];
    activeForces = [];
    activeEnemies = [];
    activeZones = [];
    activePins = [];
    captionPill.hidden = true;
    captionPill.textContent = '';
  }

  function renderSceneFromPlan(plan: SandboxScenePlan, animate: boolean, crossFade = false, includeTopInRetained = false) {
    cancelPhaseAnimation();
    clearPlanElements();

    const showRetainedContext = plan.mode === 'explain' && plan.phases.every(p => p.redForces.length === 0);
    const fullStack = stack.getState().stack;
    const priorStack = includeTopInRetained ? fullStack : fullStack.slice(0, -1);
    const retainedContext = showRetainedContext
      ? sandboxCollectVisualContext(priorStack)
      : { redForces: [], enemyForces: [], zones: [] };
    const forcesToRender = showRetainedContext
      ? retainedContext.redForces.map(force => ({ ...force, phase: -1 }))
      : plan.phases.flatMap((phase, idx) => phase.redForces.map(force => ({ ...force, phase: idx })));
    const enemiesToRender = [
      ...retainedContext.enemyForces.map(enemy => ({ ...enemy, phase: -1 })),
      ...plan.phases.flatMap((phase, idx) => phase.enemyForces.map(enemy => ({ ...enemy, phase: idx }))),
    ];
    const zonesToRender = [
      ...retainedContext.zones.map(zone => ({ ...zone, phase: -1 })),
      ...plan.phases.flatMap((phase, idx) => phase.zones.map(zone => ({ ...zone, phase: idx }))),
    ];

    activeZones = zonesToRender.map(zone => {
      const fillPattern = zone.kind === 'weak-gap' ? 'url(#sandbox-weak-dots)' : 'url(#sandbox-blockade-dots)';
      const fillEl = sandboxCreateSvg('ellipse', {
        class: `sandbox-zone-fill is-${zone.kind}`,
        fill: zone.kind === 'rally' ? 'rgba(200, 150, 62, 0.14)' : fillPattern,
      });
      const ringEl = sandboxCreateSvg('ellipse', {
        class: `sandbox-zone-ring is-${zone.kind}`,
      });
      zonesGroup.append(fillEl, ringEl);
      return { data: zone, phase: zone.phase, fillEl, ringEl, opacity: 0 };
    });

    activeEnemies = enemiesToRender.map(enemy => {
      const pathEl = sandboxCreateSvg('path', {
        class: `sandbox-enemy-vector is-${enemy.posture}`,
        'marker-end': 'url(#sandbox-enemy-arrow)',
      });
      enemyGroup.append(pathEl);
      return {
        data: enemy,
        phase: enemy.phase,
        sampled: sandboxSampleGeoPath([enemy.from, enemy.to], 12),
        pathEl,
        progress: 0,
      };
    });

    activeForces = forcesToRender.map(force => {
      const pathEl = sandboxCreateSvg('path', {
        class: `sandbox-force-path is-${force.style} is-${force.outcome}`,
        ...(force.outcome === 'advance' || force.outcome === 'breakthrough'
          ? { 'marker-end': 'url(#sandbox-red-arrow)' } : {}),
      });
      const headEl = sandboxCreateSvg('ellipse', {
        class: 'sandbox-force-head',
        rx: '0.45',
        ry: (0.45 * sandboxAspect).toFixed(2),
      });
      const endEl = sandboxCreateSvg('path', {
        class: 'sandbox-force-block',
      });
      redGroup.append(pathEl, endEl, headEl);
      return {
        data: force,
        phase: force.phase,
        sampled: sandboxSampleGeoPath(force.waypoints, 14),
        pathEl,
        headEl,
        endEl,
        progress: 0,
      };
    });

    activePins = plan.phases.flatMap((phase, idx) =>
      phase.pins.flatMap((pin, pinIdx) => {
        const existingBase = baseLandmarks.find(base => base.label === pin.label);
        if (existingBase) {
          existingBase.text.dataset.highlight = pin.tone;
          return [];
        }
        const item = makeLabelItem(
          `dyn-${idx}-${pinIdx}`,
          pin.label,
          pin.point,
          1,
          'dynamic',
          pin.tone,
          'top-right'
        );
        item.opacity = 0;
        dynamicLabels.push(item);
        return [{ data: pin, phase: idx, item }];
      })
    );

    projectedDirty = true;
    projectGeometry();

    const shouldAnimate = animate && !reducedMotionQuery.matches;
    if (!shouldAnimate || crossFade) {
      activeForces.forEach(f => { f.progress = 1; });
      activeEnemies.forEach(e => { e.progress = 1; });
      activeZones.forEach(z => { z.opacity = 1; });
      activePins.forEach(p => { p.item.opacity = 1; });
      const lastCaption = [...plan.phases].reverse().find(p => p.caption)?.caption;
      if (lastCaption) {
        captionPill.textContent = lastCaption;
        captionPill.hidden = false;
      }
      host.dataset.phase = 'complete';
      options.onPhaseChange?.('complete');
      repaintAnimatedVectors();
      layoutLabelsAndRulers();
      if (crossFade && !reducedMotionQuery.matches && typeof redGroup.animate === 'function') {
        for (const layer of [zonesGroup, enemyGroup, redGroup]) {
          layer.animate([{ opacity: 0.25 }, { opacity: 1 }], { duration: 240, easing: 'ease-out' });
        }
      }
      return;
    }

    const phaseStartTimes: number[] = [];
    let totalDuration = 0;
    for (const phase of plan.phases) {
      phaseStartTimes.push(totalDuration);
      totalDuration += phase.durationMs;
    }

    const startTime = nowMs();
    let lastStageLabel = '';

    const stepAnimation = () => {
      if (disposed) return;
      const elapsed = nowMs() - startTime;
      let currentPhaseIndex = plan.phases.length - 1;
      for (let i = 0; i < plan.phases.length; i++) {
        if (elapsed >= phaseStartTimes[i]) currentPhaseIndex = i;
      }
      const currentPhase = plan.phases[currentPhaseIndex];
      const nextPhaseTag = elapsed >= totalDuration ? 'complete' : `phase-${currentPhaseIndex}`;
      if (host.dataset.phase !== nextPhaseTag) {
        host.dataset.phase = nextPhaseTag;
        options.onPhaseChange?.(nextPhaseTag);
      }
      const nextCaption = currentPhase?.caption || '';
      if (nextCaption !== lastStageLabel) {
        lastStageLabel = nextCaption;
        captionPill.textContent = nextCaption;
        captionPill.hidden = !nextCaption;
      }

      const phaseFraction = (phaseIdx: number) => {
        if (phaseIdx < 0) return 1;
        const startAt = phaseStartTimes[phaseIdx] ?? 0;
        const dur = plan.phases[phaseIdx]?.durationMs ?? 1200;
        const raw = (elapsed - startAt) / dur;
        return Math.max(0, Math.min(1, raw));
      };

      activeForces.forEach(f => {
        const t = phaseFraction(f.phase);
        f.progress = t < 1 ? 1 - Math.pow(1 - t, 2.2) : 1;
      });
      activeEnemies.forEach(e => {
        const t = phaseFraction(e.phase);
        e.progress = t < 1 ? 1 - Math.pow(1 - t, 2) : 1;
      });
      activeZones.forEach(z => {
        const t = phaseFraction(z.phase);
        z.opacity = Math.min(1, t * 2.2);
      });
      activePins.forEach(p => {
        const t = phaseFraction(p.phase);
        p.item.opacity = Math.min(1, t * 2.6);
      });

      repaintAnimatedVectors();
      layoutLabelsAndRulers();

      if (elapsed < totalDuration) {
        phaseRaf = scheduleFrame(stepAnimation);
      } else {
        phaseRaf = 0;
      }
    };
    phaseRaf = scheduleFrame(stepAnimation);
  }

  function syncSnapshotAttributes(snapshot: SandboxMapSnapshot) {
    host.dataset.revision = String(snapshot.revision);
    host.dataset.stackDepth = String(stack.depth());
    if (snapshot.isInitial) {
      host.dataset.phase = 'initial';
      options.onPhaseChange?.('initial');
    }
    options.onStateChange?.(stack.getState());
  }

  function applySnapshot(
    snapshot: SandboxMapSnapshot,
    animate: boolean,
    crossFade = false,
    includeTopInRetained = false
  ) {
    syncSnapshotAttributes(snapshot);
    animateCameraTo(snapshot.camera, animate ? 520 : 0);
    if (snapshot.plan) {
      renderSceneFromPlan(snapshot.plan, animate, crossFade, includeTopInRetained);
    } else {
      cancelPhaseAnimation();
      clearPlanElements();
      scheduleCameraRender();
    }
  }

  const life = new AbortController();
  const { signal } = life;

  type DragState =
    | { kind: 'orbit'; id: number; start: [number, number]; startAngle: [number, number] }
    | { kind: 'pan'; id: number; start: [number, number]; startOffset: [number, number] }
    | { kind: 'pinch'; a: { id: number; pt: [number, number] }; b: { id: number; pt: [number, number] } };
  let drag: DragState | undefined;

  const isControlTarget = (target: EventTarget | null) =>
    typeof Element === 'function' && target instanceof Element && Boolean(target.closest('button,.sandbox-camera-controls'));

  viewport.addEventListener('wheel', (event: WheelEvent) => {
    if (isControlTarget(event.target)) return;
    event.preventDefault();
    const factor = Math.exp(-Math.sign(event.deltaY) * 0.12);
    const localAnchor: [number, number] = [event.clientX - viewportRectOffset[0], event.clientY - viewportRectOffset[1]];
    zoomAt(camera.zoom * factor, localAnchor);
  }, { passive: false, signal });

  viewport.addEventListener('contextmenu', (event: MouseEvent) => {
    if (!isControlTarget(event.target)) event.preventDefault();
  }, { signal });

  viewport.addEventListener('pointerdown', (event: PointerEvent) => {
    if (isControlTarget(event.target)) return;
    const isTouch = event.pointerType === 'touch';
    const isRight = event.pointerType === 'mouse' && event.button === 2;
    if (event.button !== 0 && !isRight && !isTouch) return;
    cancelCameraTween();
    const pt: [number, number] = [event.clientX, event.clientY];
    if (drag && isTouch && drag.kind !== 'pinch') {
      drag = {
        kind: 'pinch',
        a: { id: drag.id, pt: drag.start },
        b: { id: event.pointerId, pt },
      };
    } else if (!drag) {
      const usePan = isRight || event.shiftKey;
      drag = usePan
        ? { kind: 'pan', id: event.pointerId, start: pt, startOffset: [worldOffset[0], worldOffset[1]] }
        : { kind: 'orbit', id: event.pointerId, start: pt, startAngle: [camera.azimuth, camera.tilt] };
    }
    try { viewport.setPointerCapture?.(event.pointerId); } catch {}
    viewport.classList.add('dragging');
  }, { signal });

  viewport.addEventListener('pointermove', (event: PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'pinch') {
      const target = drag.a.id === event.pointerId ? drag.a : drag.b.id === event.pointerId ? drag.b : undefined;
      if (!target) return;
      const beforeDist = Math.max(1, Math.hypot(drag.b.pt[0] - drag.a.pt[0], drag.b.pt[1] - drag.a.pt[1]));
      const beforeCenter: [number, number] = [
        (drag.a.pt[0] + drag.b.pt[0]) / 2 - viewportRectOffset[0],
        (drag.a.pt[1] + drag.b.pt[1]) / 2 - viewportRectOffset[1],
      ];
      target.pt = [event.clientX, event.clientY];
      const afterDist = Math.max(1, Math.hypot(drag.b.pt[0] - drag.a.pt[0], drag.b.pt[1] - drag.a.pt[1]));
      const afterCenter: [number, number] = [
        (drag.a.pt[0] + drag.b.pt[0]) / 2 - viewportRectOffset[0],
        (drag.a.pt[1] + drag.b.pt[1]) / 2 - viewportRectOffset[1],
      ];
      const prevZoom = camera.zoom;
      const nextZoom = sandboxClampNumber(prevZoom * afterDist / beforeDist, 0.85, 2.5, prevZoom);
      const ratio = nextZoom / prevZoom;
      camera.zoom = nextZoom;
      worldOffset = clampPanOffset([
        afterCenter[0] - (beforeCenter[0] - worldOffset[0]) * ratio,
        afterCenter[1] - (beforeCenter[1] - worldOffset[1]) * ratio,
      ]);
      syncCameraCenterFromWorldOffset();
      scheduleCameraRender();
      return;
    }
    if (drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.start[0];
    const dy = event.clientY - drag.start[1];
    if (drag.kind === 'orbit') {
      const nextAz = sandboxClampNumber(drag.startAngle[0] + dx * 0.14, -38, 38, camera.azimuth);
      const nextTilt = sandboxClampNumber(drag.startAngle[1] + dy * 0.16, 0, 55, camera.tilt);
      if (nextAz === camera.azimuth && nextTilt === camera.tilt) return;
      camera.azimuth = nextAz;
      camera.tilt = nextTilt;
      applyWorldCenterFromCamera();
      projectedDirty = true;
      scheduleCameraRender();
    } else {
      worldOffset = clampPanOffset([drag.startOffset[0] + dx, drag.startOffset[1] + dy]);
      syncCameraCenterFromWorldOffset();
      scheduleCameraRender();
    }
  }, { signal });

  const finishDrag = (event: PointerEvent) => {
    if (!drag) return;
    if (drag.kind === 'pinch') {
      if (event.pointerId === drag.a.id) {
        drag = { kind: 'pan', id: drag.b.id, start: drag.b.pt, startOffset: [worldOffset[0], worldOffset[1]] };
      } else if (event.pointerId === drag.b.id) {
        drag = { kind: 'pan', id: drag.a.id, start: drag.a.pt, startOffset: [worldOffset[0], worldOffset[1]] };
      }
      return;
    }
    if (drag.id === event.pointerId) {
      drag = undefined;
      viewport.classList.remove('dragging');
    }
  };
  viewport.addEventListener('pointerup', finishDrag, { signal });
  viewport.addEventListener('pointercancel', finishDrag, { signal });
  viewport.addEventListener('lostpointercapture', finishDrag, { signal });

  const resizeObserver = typeof ResizeObserver === 'function'
    ? new ResizeObserver(layoutViewport) : undefined;
  resizeObserver?.observe(viewport);
  if (typeof window !== 'undefined') {
    window.addEventListener('scroll', measureViewportOffset, { passive: true, signal });
  }
  layoutViewport();
  renderFrame();

  return {
    applyPlan(rawPlan: unknown, applyOptions = {}) {
      const animate = applyOptions.animate !== false;
      const pushSnapshot = applyOptions.pushSnapshot !== false;
      const sanitized = sanitizeSandboxScenePlan(rawPlan);
      const snapshot = pushSnapshot
        ? stack.push(sanitized)
        : {
          revision: stack.current().revision,
          isInitial: false,
          summary: sandboxBuildPlanSummary(sanitized),
          camera: sandboxCloneCamera(sanitized.camera),
          plan: sanitized,
        };
      applySnapshot(snapshot, animate, false, !pushSnapshot);
      return snapshot.plan!;
    },
    replay() {
      const top = stack.current();
      if (!top.plan) {
        animateCameraTo(sandboxDefaultCamera, 460);
        return;
      }
      applySnapshot(top, true);
    },
    rollback() {
      const result = stack.rollback();
      if (result.changed) {
        applySnapshot(result.snapshot, true, true);
      }
      return result;
    },
    restoreToInitial() {
      const snapshot = stack.restore();
      applySnapshot(snapshot, true);
      return snapshot;
    },
    clearAll() {
      const snapshot = stack.clear();
      applySnapshot(snapshot, true);
      return snapshot;
    },
    setRealRouteVisible(visible: boolean) {
      realRouteVisible = Boolean(visible);
      host.dataset.realRoute = String(realRouteVisible);
      if (realRouteVisible) {
        realRouteGroup.removeAttribute('hidden');
      } else {
        realRouteGroup.setAttribute('hidden', 'true');
      }
      projectedDirty = true;
      scheduleCameraRender();
    },
    isRealRouteVisible: () => realRouteVisible,
    setViewportFocusRatioX(ratioX: number) {
      viewportFocusRatioX = sandboxClampNumber(ratioX, 0.25, 0.7, 0.36);
      applyWorldCenterFromCamera();
      scheduleCameraRender();
    },
    zoomBy,
    toggleTilt,
    resetCamera,
    animateCameraTo,
    getCameraState: () => sandboxCloneCamera(camera),
    getStackState: () => stack.getState(),
    toMapContext: () => stack.toMapContext(),
    canRollback: () => stack.canRollback(),
    serializeState: () => stack.serialize(),
    hydrateState(raw: unknown) {
      if (!stack.hydrate(raw)) return false;
      applySnapshot(stack.current(), false);
      return true;
    },
    markTurnSent: () => stack.markSent(),
    dispose() {
      if (disposed) return;
      disposed = true;
      life.abort();
      resizeObserver?.disconnect();
      cancelFrame(cameraRaf);
      cancelCameraTween();
      cancelPhaseAnimation();
      terrain.onChange = () => {};
      terrain.setTheme('overview');
    },
  };
}
