type CinemagraphKind = 'exclude' | 'sway' | 'water' | 'mist' | 'smoke' | 'rain' | 'flame';

type CinemagraphZone = {
  kind: CinemagraphKind;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  strength?: number;
  angle?: number;
  param?: number;
};

const ZONE_KIND_CODE: Record<CinemagraphKind, number> = {
  exclude: -1,
  sway: 1,
  water: 2,
  mist: 3,
  smoke: 4,
  rain: 5,
  flame: 6,
};

const MAX_CINEMAGRAPH_ZONES = 16;

const sceneCinemagraphs: Record<string, CinemagraphZone[]> = {
  'yudu-assembly': [
    // Strictly protect thick tree trunk, left roof eave, farmhouse walls/roofs (ridge at y~0.23), soldiers, and stone ditch wall
    { kind: 'exclude', cx: 0.35, cy: 0.25, rx: 0.07, ry: 0.26, angle: 0.14 },
    { kind: 'exclude', cx: 0.18, cy: 0.12, rx: 0.20, ry: 0.14 },
    { kind: 'exclude', cx: 0.49, cy: 0.36, rx: 0.14, ry: 0.145 },
    { kind: 'exclude', cx: 0.72, cy: 0.56, rx: 0.25, ry: 0.11 },
    { kind: 'exclude', cx: 0.84, cy: 0.86, rx: 0.17, ry: 0.045, angle: 0.18 },
    { kind: 'exclude', cx: 0.66, cy: 0.92, rx: 0.08, ry: 0.09 },
    // Outer leafy canopy tips right of trunk against sky & distant lone tree crown
    { kind: 'sway', cx: 0.53, cy: 0.115, rx: 0.11, ry: 0.10, strength: 0.0030, angle: 0.12, param: 1 },
    { kind: 'sway', cx: 0.785, cy: 0.415, rx: 0.036, ry: 0.035, strength: 0.0020, angle: 0.10, param: -1 },
    // Golden-green rice paddy field in bottom-right (cleanly below soldiers' feet & above stone ditch wall)
    { kind: 'sway', cx: 0.85, cy: 0.745, rx: 0.145, ry: 0.058, strength: 0.0028, angle: 0.0, param: -1 },
    // Narrow irrigation stream cleanly inside ditch below stone wall
    { kind: 'water', cx: 0.77, cy: 0.945, rx: 0.055, ry: 0.042, strength: 0.0028, angle: 0.45, param: 1.0 },
    // Distant hill valley mist upper-right
    { kind: 'mist', cx: 0.86, cy: 0.31, rx: 0.14, ry: 0.09, strength: 0.28, angle: 0.05 },
    // Doorway oil lamp wick flicker
    { kind: 'flame', cx: 0.145, cy: 0.268, rx: 0.011, ry: 0.018, strength: 0.20, param: 0.2 },
  ],
  'yudu-bank': [
    // Strictly protect thick trunk, lantern post + crossbar, both villagers, door plank, and boats
    { kind: 'exclude', cx: 0.05, cy: 0.28, rx: 0.06, ry: 0.30 },
    { kind: 'exclude', cx: 0.20, cy: 0.16, rx: 0.075, ry: 0.055 },
    { kind: 'exclude', cx: 0.18, cy: 0.38, rx: 0.038, ry: 0.24 },
    { kind: 'exclude', cx: 0.28, cy: 0.52, rx: 0.095, ry: 0.28 },
    { kind: 'exclude', cx: 0.56, cy: 0.48, rx: 0.065, ry: 0.24 },
    { kind: 'exclude', cx: 0.65, cy: 0.48, rx: 0.17, ry: 0.085 },
    { kind: 'exclude', cx: 0.84, cy: 0.68, rx: 0.19, ry: 0.19 },
    // Outer overhanging tree leaves (strictly right of lantern crossbar & above villager)
    { kind: 'sway', cx: 0.375, cy: 0.09, rx: 0.115, ry: 0.085, strength: 0.0030, angle: 0.15, param: 1 },
    // Pure river water pockets strictly between villagers, above moored boat, and right of boat bow
    { kind: 'water', cx: 0.44, cy: 0.388, rx: 0.075, ry: 0.032, strength: 0.0030, angle: 0.0, param: 0.85 },
    { kind: 'water', cx: 0.82, cy: 0.380, rx: 0.17, ry: 0.028, strength: 0.0030, angle: 0.0, param: 0.85 },
    { kind: 'water', cx: 0.90, cy: 0.442, rx: 0.095, ry: 0.045, strength: 0.0030, angle: 0.0, param: 0.85 },
    // Dusk clouds
    { kind: 'mist', cx: 0.60, cy: 0.09, rx: 0.26, ry: 0.09, strength: 0.26, angle: 0.02 },
    // Hanging lantern wick flicker
    { kind: 'flame', cx: 0.239, cy: 0.244, rx: 0.011, ry: 0.018, strength: 0.20, param: 0.2 },
  ],
  'yudu-bridge': [
    // Strictly protect moon disk, diagonal wooden pontoon hull, bridge deck, rope handrail, and right post
    { kind: 'exclude', cx: 0.130, cy: 0.075, rx: 0.032, ry: 0.045 },
    { kind: 'exclude', cx: 0.24, cy: 0.62, rx: 0.17, ry: 0.19, angle: 0.40 },
    { kind: 'exclude', cx: 0.43, cy: 0.68, rx: 0.18, ry: 0.14, angle: -0.22 },
    { kind: 'exclude', cx: 0.14, cy: 0.48, rx: 0.095, ry: 0.105 },
    { kind: 'exclude', cx: 0.84, cy: 0.64, rx: 0.18, ry: 0.11 },
    { kind: 'exclude', cx: 0.975, cy: 0.80, rx: 0.03, ry: 0.16 },
    // Left treetop outer leaves sway
    { kind: 'sway', cx: 0.06, cy: 0.10, rx: 0.06, ry: 0.10, strength: 0.0026, angle: 0.12, param: 1 },
    // Moonlit left river & golden lantern reflections on lower right under bridge
    { kind: 'water', cx: 0.11, cy: 0.73, rx: 0.11, ry: 0.24, strength: 0.0034, angle: 0.05, param: 1.15 },
    { kind: 'water', cx: 0.83, cy: 0.75, rx: 0.11, ry: 0.055, strength: 0.0034, angle: 0.0, param: 1.25 },
    // Moonlit clouds
    { kind: 'mist', cx: 0.28, cy: 0.11, rx: 0.20, ry: 0.10, strength: 0.26, angle: 0.04 },
    // Bridge post oil lamp
    { kind: 'flame', cx: 0.943, cy: 0.285, rx: 0.012, ry: 0.020, strength: 0.20, param: 0.15 },
  ],
  'xiang-ford': [
    // Strictly protect bamboo main culms, all 6 soldiers, stepping-stone rocks, and distant houses
    { kind: 'exclude', cx: 0.02, cy: 0.48, rx: 0.04, ry: 0.36 },
    { kind: 'exclude', cx: 0.14, cy: 0.65, rx: 0.08, ry: 0.30 },
    { kind: 'exclude', cx: 0.24, cy: 0.70, rx: 0.06, ry: 0.24 },
    { kind: 'exclude', cx: 0.34, cy: 0.62, rx: 0.045, ry: 0.14 },
    { kind: 'exclude', cx: 0.43, cy: 0.60, rx: 0.065, ry: 0.11 },
    // Upper weeping bamboo leaves (cleanly above soldiers)
    { kind: 'sway', cx: 0.22, cy: 0.16, rx: 0.18, ry: 0.15, strength: 0.0034, angle: 0.18, param: 1 },
    // Pure rock-free river water channels (above mid-stream boulder chain & in open foreground pockets)
    { kind: 'water', cx: 0.76, cy: 0.676, rx: 0.22, ry: 0.020, strength: 0.0028, angle: -0.04, param: 1.25 },
    { kind: 'water', cx: 0.58, cy: 0.785, rx: 0.09, ry: 0.032, strength: 0.0028, angle: -0.04, param: 1.25 },
    { kind: 'water', cx: 0.87, cy: 0.795, rx: 0.12, ry: 0.035, strength: 0.0028, angle: -0.04, param: 1.25 },
    // Karst valley mist (cleanly above village roofs)
    { kind: 'mist', cx: 0.68, cy: 0.28, rx: 0.30, ry: 0.10, strength: 0.30, angle: 0.04 },
  ],
  'xiang-aftermath': [
    // Strictly protect house roof, thick tree trunk + diagonal main limb, standing/sitting soldiers, wooded riverbank, and river rocks
    { kind: 'exclude', cx: 0.14, cy: 0.24, rx: 0.14, ry: 0.26 },
    { kind: 'exclude', cx: 0.20, cy: 0.34, rx: 0.06, ry: 0.18 },
    { kind: 'exclude', cx: 0.30, cy: 0.16, rx: 0.13, ry: 0.045, angle: -0.78 },
    { kind: 'exclude', cx: 0.71, cy: 0.76, rx: 0.12, ry: 0.22 },
    { kind: 'exclude', cx: 0.93, cy: 0.61, rx: 0.08, ry: 0.065 },
    { kind: 'exclude', cx: 0.81, cy: 0.725, rx: 0.028, ry: 0.028 },
    { kind: 'exclude', cx: 0.92, cy: 0.79, rx: 0.085, ry: 0.05 },
    // Autumn overhanging outer leafy twigs (cleanly above distant hill & right of trunk/limb)
    { kind: 'sway', cx: 0.46, cy: 0.082, rx: 0.16, ry: 0.078, strength: 0.0030, angle: 0.12, param: 1 },
    // Distant winding river in right valley (cleanly on open water away from rocks)
    { kind: 'water', cx: 0.86, cy: 0.705, rx: 0.075, ry: 0.055, strength: 0.0028, angle: -0.35, param: 0.85 },
    // Drifting valley mist
    { kind: 'mist', cx: 0.68, cy: 0.37, rx: 0.30, ry: 0.12, strength: 0.34, angle: 0.05 },
  ],
  'liping-street': [
    // Keep mountain ridges, roofs, stone street, and pedestrians steady
    { kind: 'exclude', cx: 0.62, cy: 0.25, rx: 0.24, ry: 0.06 },
    { kind: 'exclude', cx: 0.39, cy: 0.73, rx: 0.07, ry: 0.22 },
    { kind: 'exclude', cx: 0.81, cy: 0.72, rx: 0.05, ry: 0.16 },
    // Dusk sunset clouds cleanly above mountain silhouette & distant mountain haze
    { kind: 'mist', cx: 0.62, cy: 0.10, rx: 0.22, ry: 0.09, strength: 0.42, angle: 0.03 },
    { kind: 'mist', cx: 0.68, cy: 0.32, rx: 0.12, ry: 0.06, strength: 0.32, angle: 0.04 },
    // Hanging woven lanterns subtle wick flicker
    { kind: 'flame', cx: 0.148, cy: 0.312, rx: 0.013, ry: 0.022, strength: 0.24, param: 0.5 },
    { kind: 'flame', cx: 0.410, cy: 0.432, rx: 0.010, ry: 0.017, strength: 0.20, param: 0.4 },
    { kind: 'flame', cx: 0.900, cy: 0.512, rx: 0.010, ry: 0.018, strength: 0.22, param: 0.3 },
  ],
  'liping-table': [
    // Strictly protect foreground cloth sleeve, doorframe, and outdoor cobblestones
    { kind: 'exclude', cx: 0.94, cy: 0.69, rx: 0.14, ry: 0.25, angle: 0.42 },
    // Crisp outdoor rain strictly outside the upper open right doorway
    { kind: 'rain', cx: 0.935, cy: 0.23, rx: 0.060, ry: 0.22, strength: 0.48, angle: 0.24 },
    // Brass oil lamp flame flicker inside the glass chimney
    { kind: 'flame', cx: 0.776, cy: 0.438, rx: 0.012, ry: 0.021, strength: 0.22, param: 0.0 },
  ],
  'wujiang': [
    // Strictly protect thick upper-left trunk/branch, stone huts, soldiers, foreground cliff rock, mid-river boulder, and shore rocks
    { kind: 'exclude', cx: 0.06, cy: 0.07, rx: 0.08, ry: 0.08 },
    { kind: 'exclude', cx: 0.28, cy: 0.03, rx: 0.11, ry: 0.045, angle: 0.25 },
    { kind: 'exclude', cx: 0.16, cy: 0.24, rx: 0.15, ry: 0.15 },
    { kind: 'exclude', cx: 0.54, cy: 0.90, rx: 0.15, ry: 0.12 },
    { kind: 'exclude', cx: 0.54, cy: 0.76, rx: 0.045, ry: 0.045 },
    { kind: 'exclude', cx: 0.652, cy: 0.812, rx: 0.052, ry: 0.042 },
    { kind: 'exclude', cx: 0.92, cy: 0.74, rx: 0.11, ry: 0.14 },
    // Chimney smoke curling up slowly from stone hut chimney
    { kind: 'smoke', cx: 0.222, cy: 0.205, rx: 0.050, ry: 0.088, strength: 0.52, angle: 0.42 },
    // Surging Wujiang rapids (strictly pure water, all boulders/cliffs excluded)
    { kind: 'water', cx: 0.74, cy: 0.83, rx: 0.18, ry: 0.11, strength: 0.0040, angle: -0.25, param: 1.35 },
    // Gorge morning mist
    { kind: 'mist', cx: 0.56, cy: 0.34, rx: 0.25, ry: 0.15, strength: 0.38, angle: 0.08 },
    // Delicate upper cliff outer twigs only (foreground rocky grass removed)
    { kind: 'sway', cx: 0.39, cy: 0.09, rx: 0.08, ry: 0.065, strength: 0.0028, angle: 0.14, param: 1 },
  ],
  'zunyi-dawn': [
    // Strictly protect foreground wooden eave, roofs, and stone flagstones
    { kind: 'exclude', cx: 0.36, cy: 0.20, rx: 0.12, ry: 0.12 },
    // Golden sunrise mist drifting smoothly over the morning ridge
    { kind: 'mist', cx: 0.62, cy: 0.20, rx: 0.24, ry: 0.14, strength: 0.40, angle: 0.05 },
  ],
};

const VERT_SRC = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_tex;
uniform float u_time;
uniform float u_intensity;
uniform vec2 u_res;
uniform int u_count;
uniform vec4 u_rect[${MAX_CINEMAGRAPH_ZONES}];
uniform vec4 u_meta[${MAX_CINEMAGRAPH_ZONES}];

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * noise2(p);
    p = p * 2.04 + vec2(17.1, 31.7);
    a *= 0.5;
  }
  return v;
}

float ellipseMask(vec2 uv, vec4 r) {
  vec2 q = (uv - r.xy) / max(r.zw, vec2(0.001));
  return 1.0 - smoothstep(0.28, 1.0, length(q));
}

float excludeMask(vec2 uv, vec4 r, float ang) {
  vec2 d = uv - r.xy;
  if (abs(ang) > 0.001) {
    float c = cos(ang);
    float s = sin(ang);
    d = vec2(c * d.x + s * d.y, -s * d.x + c * d.y);
  }
  vec2 q = d / max(r.zw, vec2(0.001));
  return 1.0 - smoothstep(0.68, 1.0, length(q));
}

float rectMask(vec2 uv, vec4 r, float edgeStart) {
  vec2 q = abs(uv - r.xy) / max(r.zw, vec2(0.001));
  return 1.0 - smoothstep(edgeStart, 1.0, max(q.x, q.y));
}

void main() {
  vec2 uv = v_uv;
  float edgeFade = smoothstep(0.0, 0.025, uv.x) * smoothstep(1.0, 0.975, uv.x)
                 * smoothstep(0.0, 0.025, uv.y) * smoothstep(1.0, 0.975, uv.y);

  float excl = 1.0;
  for (int i = 0; i < ${MAX_CINEMAGRAPH_ZONES}; i++) {
    if (i >= u_count) break;
    if (u_meta[i].x < -0.5) {
      excl *= 1.0 - excludeMask(uv, u_rect[i], u_meta[i].z);
    }
  }

  vec2 uvOffset = vec2(0.0);
  float waterGlint = 0.0;
  float waterMaskTotal = 0.0;
  float mistLayer = 0.0;
  float smokeLayer = 0.0;
  float rainLayer = 0.0;
  float flameGlow = 0.0;
  float flameHalo = 0.0;

  for (int i = 0; i < ${MAX_CINEMAGRAPH_ZONES}; i++) {
    if (i >= u_count) break;
    float kind = u_meta[i].x;
    if (kind < 0.5) continue;

    vec4 r = u_rect[i];
    float strength = u_meta[i].y;
    float ang = u_meta[i].z;
    float param = u_meta[i].w;
    vec2 dir = vec2(cos(ang), sin(ang));

    if (kind < 1.5) {
      // SWAY: slow natural breeze on outer leaves and rice
      float m = rectMask(uv, r, 0.55) * excl * edgeFade;
      if (m > 0.001) {
        float hinge = param >= 0.0
          ? clamp((uv.y - (r.y - r.w)) / max(2.0 * r.w, 0.001), 0.0, 1.0)
          : clamp(((r.y + r.w) - uv.y) / max(2.0 * r.w, 0.001), 0.0, 1.0);
        hinge = smoothstep(0.04, 0.92, hinge);
        float gust = sin(u_time * 0.55 + uv.x * 8.5 + uv.y * 4.0) * 0.56
                   + sin(u_time * 1.10 - uv.x * 16.0 + uv.y * 9.5) * 0.30
                   + sin(u_time * 1.85 + uv.x * 29.0 - uv.y * 17.0) * 0.14;
        vec2 perp = vec2(-dir.y, dir.x);
        uvOffset -= (dir * gust + perp * (gust * 0.24)) * strength * m * hinge;
      }
    } else if (kind < 2.5) {
      // WATER: calm river flow & specular glints aligned with channel angle
      float m = rectMask(uv, r, 0.60) * excl * edgeFade;
      if (m > 0.001) {
        vec2 d = uv - r.xy;
        float c = cos(ang);
        float s = sin(ang);
        vec2 rotUv = vec2(c * d.x + s * d.y, -s * d.x + c * d.y) + r.xy;
        vec2 p = rotUv * vec2(26.0, 76.0 / max(param, 0.45));
        float w1 = sin(dot(p, vec2(1.0, 0.32)) - u_time * 1.05 + sin(p.y * 0.42 + u_time * 0.42) * 1.55);
        float w2 = cos(dot(p * 1.55, vec2(-0.72, 0.85)) - u_time * 0.82);
        float w3 = sin(p.y * 1.75 + p.x * 0.55 - u_time * 1.30);
        vec2 localRipple = vec2(w1 * 0.65 + w2 * 0.35, (w2 * 0.52 + w3 * 0.48) * 0.45);
        vec2 ripple = vec2(c * localRipple.x - s * localRipple.y, s * localRipple.x + c * localRipple.y);
        uvOffset += ripple * strength * m;
        waterGlint += (w1 * 0.6 + w2 * 0.4) * m;
        waterMaskTotal = max(waterMaskTotal, m);
      }
    } else if (kind < 3.5) {
      // MIST / CLOUD: slow atmospheric drift weighted to sky/valley mist without warping rock silhouettes
      float m = ellipseMask(uv, r) * excl * edgeFade;
      if (m > 0.001) {
        float n1 = fbm(uv * vec2(7.5, 11.0) - dir * (u_time * 0.18));
        float n2 = fbm(uv * vec2(14.0, 19.0) - dir * (u_time * 0.27) + 5.3);
        float n = n1 * 0.58 + n2 * 0.42;
        mistLayer += (n - 0.22) * strength * m;
      }
    } else if (kind < 4.5) {
      // SMOKE: slow curling village chimney plume rising upward
      vec2 q = (uv - r.xy) / max(r.zw, vec2(0.001));
      float rise = clamp((1.0 - q.y) * 0.5, 0.0, 1.0);
      float plumeHalfW = mix(0.14, 0.95, pow(rise, 0.72));
      float xDist = abs(q.x - rise * (dir.x * 0.55)) / plumeHalfW;
      float shape = (1.0 - smoothstep(0.25, 1.0, xDist))
                  * smoothstep(0.0, 0.14, rise)
                  * (1.0 - smoothstep(0.62, 1.0, rise)) * excl;
      if (shape > 0.001) {
        float curl = fbm(vec2(uv.x * 24.0 - u_time * 0.12, uv.y * 20.0 + u_time * 0.34));
        float wisp = smoothstep(0.24, 0.76, curl);
        uvOffset.y += (curl - 0.5) * 0.0040 * shape * edgeFade;
        smokeLayer += wisp * shape * strength;
      }
    } else if (kind < 5.5) {
      // RAIN: calm fine diagonal streaks clipped strictly to outdoor doorway
      float m = rectMask(uv, r, 0.85) * excl;
      if (m > 0.001) {
        vec2 rp = vec2(uv.x * cos(ang) + uv.y * sin(ang), -uv.x * sin(ang) + uv.y * cos(ang));
        vec2 g1 = vec2(rp.x * 165.0, rp.y * 12.0 - u_time * 6.2);
        vec2 g2 = vec2(rp.x * 240.0 + 17.3, rp.y * 16.0 - u_time * 8.0);
        float c1 = floor(g1.x);
        float c2 = floor(g2.x);
        float r1 = hash21(vec2(c1, floor(g1.y + hash21(vec2(c1, 3.1)) * 7.0)));
        float r2 = hash21(vec2(c2, floor(g2.y + hash21(vec2(c2, 9.7)) * 7.0)));
        float s1 = smoothstep(0.70, 0.98, r1) * (1.0 - abs(fract(g1.x) - 0.5) * 2.2);
        float s2 = smoothstep(0.76, 0.99, r2) * (1.0 - abs(fract(g2.x) - 0.5) * 2.4);
        float f1 = smoothstep(0.0, 0.25, fract(g1.y)) * (1.0 - smoothstep(0.45, 0.95, fract(g1.y)));
        float f2 = smoothstep(0.0, 0.25, fract(g2.y)) * (1.0 - smoothstep(0.40, 0.90, fract(g2.y)));
        rainLayer += max(s1 * f1, s2 * f2 * 0.75) * m * strength;
      }
    } else {
      // FLAME: calm organic wick shimmer with local warm ambient breathing
      float halo = ellipseMask(uv, vec4(r.xy, r.zw * 2.8)) * edgeFade;
      if (halo > 0.001) {
        float fl = sin(u_time * 2.8 + r.x * 41.0) * 0.52
                 + sin(u_time * 5.4 + r.y * 23.0) * 0.33
                 + sin(u_time * 8.2) * 0.15;
        float m = ellipseMask(uv, r) * edgeFade;
        if (m > 0.001) {
          float sway = param > 0.01 ? sin(u_time * 0.75 + r.x * 19.0) * 0.0006 * param : 0.0;
          uvOffset += vec2(sway + fl * 0.0004, abs(fl) * 0.0006) * m;
          flameGlow += fl * strength * m;
        }
        flameHalo += (0.5 + 0.5 * fl) * halo * 0.05;
      }
    }
  }

  float intensity = clamp(u_intensity, 0.0, 1.0);
  vec3 baseCol = texture(u_tex, clamp(uv + uvOffset * intensity, 0.001, 0.999)).rgb;
  float luma = dot(baseCol, vec3(0.299, 0.587, 0.114));

  if (waterMaskTotal > 0.001) {
    float hi = smoothstep(0.26, 0.74, luma);
    baseCol += baseCol * (waterGlint * 0.11 * hi * intensity);
  }

  if (mistLayer > 0.001) {
    float skyWeight = smoothstep(0.20, 0.58, luma);
    vec3 mistTint = mix(baseCol, vec3(0.78, 0.84, 0.90), 0.38);
    baseCol = mix(baseCol, mistTint, clamp(mistLayer * skyWeight * 0.56 * intensity, 0.0, 0.22));
  }

  if (smokeLayer > 0.001) {
    vec3 smokeCol = vec3(0.73, 0.79, 0.85);
    baseCol = mix(baseCol, smokeCol, clamp(smokeLayer * 0.54 * intensity, 0.0, 0.36));
  }

  if (rainLayer > 0.001) {
    baseCol += vec3(0.72, 0.82, 0.92) * clamp(rainLayer * 0.45 * intensity, 0.0, 0.28);
  }

  if (abs(flameGlow) > 0.001) {
    float core = smoothstep(0.45, 0.90, luma);
    baseCol += vec3(1.0, 0.76, 0.38) * (flameGlow * 0.16 * core * intensity);
  }

  if (flameHalo > 0.001) {
    baseCol += vec3(1.0, 0.72, 0.34) * (flameHalo * (1.0 - 0.35 * luma) * intensity);
  }

  outColor = vec4(clamp(baseCol, 0.0, 1.0), 1.0);
}`;

type CinemagraphController = {
  stop: () => void;
  setIntensity: (target: number) => void;
  setPaused: (paused: boolean) => void;
};

let activeCinemagraphs: CinemagraphController[] = [];
let cinemagraphTargetIntensity = 1;

function stopCinemagraphs() {
  for (const item of activeCinemagraphs) item.stop();
  activeCinemagraphs = [];
}

function setCinemagraphIntensity(target: number) {
  cinemagraphTargetIntensity = Math.max(0, Math.min(1, target));
  for (const item of activeCinemagraphs) item.setIntensity(cinemagraphTargetIntensity);
}

function setCinemagraphsPaused(paused: boolean) {
  for (const item of activeCinemagraphs) item.setPaused(paused);
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function attachCinemagraph(imageKey: string, img: HTMLImageElement, extraClass = '') {
  const zones = sceneCinemagraphs[imageKey];
  if (!zones?.length) return undefined;

  let canvas: HTMLCanvasElement | null = null;
  let disposed = false;
  let started = false;
  let paused = reducedMotion.matches;
  let rafId = 0;
  let gl: WebGL2RenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let texture: WebGLTexture | null = null;
  let vbo: WebGLBuffer | null = null;
  let timeLoc: WebGLUniformLocation | null = null;
  let intensityLoc: WebGLUniformLocation | null = null;
  let width = 0;
  let height = 0;
  let shown = false;
  let simTime = 0;
  let lastNow = 0;
  let currentIntensity = cinemagraphTargetIntensity;
  let targetIntensity = cinemagraphTargetIntensity;

  const stopLoop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    lastNow = 0;
  };

  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    stopLoop();
    if (gl) {
      if (texture) gl.deleteTexture(texture);
      if (vbo) gl.deleteBuffer(vbo);
      if (program) gl.deleteProgram(program);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      gl = null;
    }
    canvas?.remove();
    canvas = null;
  };

  const draw = (now: number) => {
    rafId = 0;
    if (disposed || !gl || !canvas?.isConnected) {
      cleanup();
      return;
    }
    if (paused || reducedMotion.matches) {
      lastNow = 0;
      return;
    }
    if (!document.hidden) {
      const dt = lastNow ? Math.min((now - lastNow) * 0.001, 0.1) : 0;
      lastNow = now;
      currentIntensity += (targetIntensity - currentIntensity) * Math.min(1, dt * 6);
      simTime += dt * (0.25 + 0.75 * currentIntensity);
      gl.viewport(0, 0, width, height);
      gl.uniform1f(timeLoc, simTime);
      gl.uniform1f(intensityLoc, currentIntensity);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      if (!shown) {
        shown = true;
        canvas.classList.add('is-ready');
      }
    } else {
      lastNow = 0;
    }
    rafId = requestAnimationFrame(draw);
  };

  const startLoop = () => {
    if (disposed || paused || reducedMotion.matches || !gl || rafId) return;
    lastNow = 0;
    rafId = requestAnimationFrame(draw);
  };

  const init = () => {
    if (disposed || started || paused || reducedMotion.matches || !img.isConnected || !img.naturalWidth) return;
    started = true;
    canvas = element('canvas', 'scene-motion' + (extraClass ? ' ' + extraClass : ''));
    canvas.setAttribute('aria-hidden', 'true');
    img.after(canvas);

    width = Math.min(img.naturalWidth, 1280);
    height = Math.round((width * img.naturalHeight) / img.naturalWidth);
    canvas.width = width;
    canvas.height = height;

    gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) {
      cleanup();
      return;
    }

    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);
      cleanup();
      return;
    }

    program = gl.createProgram()!;
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      cleanup();
      return;
    }

    gl.useProgram(program);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(program, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);

    const count = Math.min(zones.length, MAX_CINEMAGRAPH_ZONES);
    const rectData = new Float32Array(MAX_CINEMAGRAPH_ZONES * 4);
    const metaData = new Float32Array(MAX_CINEMAGRAPH_ZONES * 4);
    for (let i = 0; i < count; i++) {
      const z = zones[i];
      rectData[i * 4] = z.cx;
      rectData[i * 4 + 1] = z.cy;
      rectData[i * 4 + 2] = z.rx;
      rectData[i * 4 + 3] = z.ry;
      metaData[i * 4] = ZONE_KIND_CODE[z.kind];
      metaData[i * 4 + 1] = z.strength ?? 0.005;
      metaData[i * 4 + 2] = z.angle ?? 0;
      metaData[i * 4 + 3] = z.param ?? 1;
    }

    gl.uniform1i(gl.getUniformLocation(program, 'u_count'), count);
    gl.uniform4fv(gl.getUniformLocation(program, 'u_rect'), rectData);
    gl.uniform4fv(gl.getUniformLocation(program, 'u_meta'), metaData);
    gl.uniform2f(gl.getUniformLocation(program, 'u_res'), width, height);
    timeLoc = gl.getUniformLocation(program, 'u_time');
    intensityLoc = gl.getUniformLocation(program, 'u_intensity');
    startLoop();
  };

  const scheduleStart = () => {
    if (!disposed && !paused && !reducedMotion.matches) requestAnimationFrame(init);
  };

  const controller: CinemagraphController = {
    stop: cleanup,
    setIntensity(next) {
      targetIntensity = Math.max(0, Math.min(1, next));
    },
    setPaused(next) {
      paused = next;
      if (paused) {
        stopLoop();
        if (canvas) canvas.hidden = true;
      } else {
        if (canvas) {
          canvas.hidden = false;
          startLoop();
        } else if (img.complete && img.naturalWidth > 0) {
          scheduleStart();
        }
      }
    },
  };
  activeCinemagraphs.push(controller);

  if (img.complete && img.naturalWidth > 0) scheduleStart();
  else img.addEventListener('load', scheduleStart, { once: true });

  return controller;
}
