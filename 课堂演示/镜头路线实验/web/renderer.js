(() => {
  'use strict';

  const radians = Math.PI / 180;
  const floatsPerVertex = 9;
  const pageSegments = 36;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
  const dot = (firstVector, secondVector) => firstVector[0] * secondVector[0] + firstVector[1] * secondVector[1] + firstVector[2] * secondVector[2];
  const cross = (firstVector, secondVector) => [firstVector[1] * secondVector[2] - firstVector[2] * secondVector[1], firstVector[2] * secondVector[0] - firstVector[0] * secondVector[2], firstVector[0] * secondVector[1] - firstVector[1] * secondVector[0]];
  function unit(vector) {
    const length = Math.hypot(...vector) || 1;
    return vector.map(component => component / length);
  }

  function perspective(eye, back, right, tanHalfFov, aspect, near, far) {
    const up = cross(back, right);
    const sx = 1 / (aspect * tanHalfFov);
    const sy = 1 / tanHalfFov;
    const projectionDepth = (near + far) / (near - far);
    const matrix = new Float32Array(16);
    for (let localIndex = 0; localIndex < 3; localIndex++) {
      matrix.set([sx * right[localIndex], sy * up[localIndex], projectionDepth * back[localIndex], -back[localIndex]], localIndex * 4);
    }
    matrix.set([-sx * dot(right, eye), -sy * dot(up, eye),
      -projectionDepth * dot(back, eye) + 2 * near * far / (near - far), dot(back, eye)], 12);
    return { eye, back, right, up, matrix };
  }

  function orbit(camera, pose, aspect, far) {
    const yaw = (pose?.yaw ?? camera.yaw) * radians;
    const pitch = (pose?.pitch ?? camera.pitch) * radians;
    const radius = pose?.radius ?? camera.radius;
    const back = [Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)];
    const eye = camera.target.map((component, localIndex) => component + radius * back[localIndex]);
    const tan = Math.tan(camera.fov * radians / 2);
    return perspective(eye, back, [Math.cos(yaw), 0, -Math.sin(yaw)], tan, aspect, Math.min(.10, radius * .15), far);
  }

  function joinRings(out, firstRing, nextRing) {
    for (let localIndex = 1; localIndex < firstRing.length; localIndex++) out.push(firstRing[localIndex - 1], nextRing[localIndex - 1], nextRing[localIndex], firstRing[localIndex - 1], nextRing[localIndex], firstRing[localIndex]);
  }

  function boxMesh(size, texture) {
    const out = [], radius = Math.min(.008, .09 * Math.min(...size));
    function face(normal, across, down) {
      const width = Math.abs(dot(size, across)), height = Math.abs(dot(size, down));
      const stops = span => radius < .0009 ? [0, 1] : [0, radius / span, 1 - radius / span, 1];
      const columns = stops(width);
      let previous;
      for (const axisV of stops(height)) {
        const row = columns.map(axisU => {
          let position = normal.map((component, localIndex) => size[localIndex] * (component / 2 + (axisU - .5) * across[localIndex] + (axisV - .5) * down[localIndex]));
          let unitNormal = normal;
          if (radius >= .0009) {
            const inner = position.map((component, localIndex) => clamp(component, radius - size[localIndex] / 2, size[localIndex] / 2 - radius));
            unitNormal = unit(position.map((component, localIndex) => component - inner[localIndex]));
            position = inner.map((component, localIndex) => component + unitNormal[localIndex] * radius);
          }
          let tu = axisU, tv = axisV;
          if (normal[1] !== 1 && texture === 'cover.jpg') {
            tu = .03; tv = .04;
          } else if (normal[1] === 0 && texture === 'wood.jpg') {
            tu = height > width ? (1 - axisV) * height / 2.56 : axisU * width / 2.56;
            tv = .09 + (height > width ? axisU * width : axisV * height) / 1.34;
          }
          return [...position, ...unitNormal, tu, tv];
        });
        if (previous) joinRings(out, previous, row);
        previous = row;
      }
    }
    face([0, 1, 0], [1, 0, 0], [0, 0, 1]);
    face([0, -1, 0], [1, 0, 0], [0, 0, -1]);
    face([0, 0, 1], [1, 0, 0], [0, -1, 0]);
    face([0, 0, -1], [-1, 0, 0], [0, -1, 0]);
    face([1, 0, 0], [0, 0, -1], [0, -1, 0]);
    face([-1, 0, 0], [0, 0, 1], [0, -1, 0]);
    return out;
  }

  function roundMesh(kind, size) {
    const [rx, ry, rz] = size.map(coordX => coordX / 2), slices = 40;
    const bevel = Math.min(.008, .09 * Math.min(...size));
    const out = [], rings = [];
    const spherical = kind === 'sphere';
    const rimAngles = [90, 45, 0, 0, -45, -90];
    const bandCount = spherical ? 16 : rimAngles.length - 1;
    for (let row = 0; row <= bandCount; row++) {
      const axisV = row / bandCount;
      const phi = spherical ? Math.PI * (.5 - axisV) : rimAngles[row] * radians;
      const vertical = Math.sin(phi), radial = Math.cos(phi);
      const inset = bevel * (1 - radial);
      const coordY = spherical ? ry * vertical : (row < 3 ? 1 : -1) * (ry - bevel) + bevel * vertical;
      const ring = [];
      for (let col = 0; col <= slices; col++) {
        const axisU = col / slices, sin = Math.sin(2 * Math.PI * axisU), cos = Math.cos(2 * Math.PI * axisU);
        const coordX = spherical ? rx * radial * sin : (rx - inset) * sin;
        const coordZ = spherical ? rz * radial * cos : (rz - inset) * cos;
        const side = unit([sin / rx, 0, cos / rz]);
        const unitNormal = spherical ? unit([radial * sin / rx, vertical / ry, radial * cos / rz]) : [radial * side[0], vertical, radial * side[2]];
        ring.push([coordX, coordY, coordZ, ...unitNormal, axisU, spherical ? axisV : .5 - coordY / size[1]]);
      }
      if (row) joinRings(out, rings[row - 1], ring);
      rings.push(ring);
    }
    if (!spherical) {
      for (const sign of [1, -1]) {
        const rim = rings[sign > 0 ? 0 : bandCount].map(([coordX, coordY, coordZ]) => [coordX, coordY, coordZ, 0, sign, 0, .5 + coordX / size[0], .5 + sign * coordZ / size[2]]);
        for (let localIndex = 1; localIndex <= slices; localIndex++) {
          out.push([0, sign * ry, 0, 0, sign, 0, .5, .5], rim[sign > 0 ? localIndex - 1 : localIndex], rim[sign > 0 ? localIndex : localIndex - 1]);
        }
      }
    }
    return out;
  }

  function staticMesh(scene) {
    const vertices = [], batches = [], groups = new Map();
    for (const node of scene.nodes) {
      if (!groups.has(node.material)) groups.set(node.material, []);
      groups.get(node.material).push(node);
    }
    const { hinge, width, depth } = scene.object;
    for (const [key, nodes] of groups) {
      const start = vertices.length / floatsPerVertex;
      const texture = scene.materials[key].texture;
      for (const node of nodes) {
        const [px, py, pz] = node.pos;
        const angle = (node.rotY || 0) * radians, cosine = Math.cos(angle), sine = Math.sin(angle);
        const cover = texture === 'cover.jpg' && Math.abs(px - hinge[0] - width / 2) <= width / 2 && Math.abs(pz - hinge[2]) <= depth / 2;
        const hit = Number(/^dossier(?:$|[-_])/.test(node.id) || node.id === 'case-binding' || cover);
        const mesh = node.kind === 'box' ? boxMesh(node.size, texture) : roundMesh(node.kind, node.size);
        for (const [coordX, coordY, coordZ, nx, ny, nz, axisU, axisV] of mesh) {
          vertices.push(px + cosine * coordX + sine * coordZ, py + coordY, pz - sine * coordX + cosine * coordZ,
            cosine * nx + sine * nz, ny, -sine * nx + cosine * nz, axisU, axisV, hit);
        }
      }
      batches.push({ key, start, count: vertices.length / floatsPerVertex - start });
    }
    return { vertices: new Float32Array(vertices), batches };
  }

  function pageAngle(progress) {
    const phase = clamp(progress, 0, 1);
    return phase === 0 || phase === 1 ? 0 : 1.95 * Math.sin(Math.PI * phase) ** 2;
  }

  function writePage(vertices, object, angle) {
    const { hinge, width, depth } = object, cosine = Math.cos(angle), sine = Math.sin(angle);
    let offset = 0;
    function vertex(axisU, axisV) {
      const coordX = width * axisU * cosine, coordY = (width * axisU + .022 * Math.sin(Math.PI * axisU)) * sine;
      const dx = width * cosine, dy = (width + .022 * Math.PI * Math.cos(Math.PI * axisU)) * sine;
      const length = Math.hypot(dx, dy);
      vertices.set([hinge[0] + coordX, hinge[1] + coordY, hinge[2] + depth * (axisV - .5), -dy / length, dx / length, 0, axisU, axisV, 1], offset);
      offset += floatsPerVertex;
    }
    for (let col = 0; col < pageSegments; col++) {
      const leftEdge = col / pageSegments, rightEdge = (col + 1) / pageSegments;
      vertex(leftEdge, 0); vertex(leftEdge, 1); vertex(rightEdge, 1);
      vertex(leftEdge, 0); vertex(rightEdge, 1); vertex(rightEdge, 0);
    }
  }

  function deskOcclusion(nodes) {
    const table = nodes.find(node => node.id === 'table' && node.kind === 'box');
    if (!table) return { pixels: new Uint8Array([255]), size: 1, rect: [0, 0, 1, 1], y: -10000 };
    const [sx, sy, sz] = table.size, [tx, ty, tz] = table.pos;
    const turn = (table.rotY || 0) * radians, cosine = Math.abs(Math.cos(turn)), sine = Math.abs(Math.sin(turn));
    const pixelWidth = cosine * sx + sine * sz, pixelHeight = sine * sx + cosine * sz, coordY = ty + sy / 2;
    const rect = [tx - pixelWidth / 2, tz - pixelHeight / 2, 1 / pixelWidth, 1 / pixelHeight];
    const size = 384, pixels = new Uint8Array(size * size).fill(255);
    for (const node of nodes) {
      const [coordX, cy, coordZ] = node.pos, [width, height, depth] = node.size;
      const gap = cy - height / 2 - coordY;
      if (gap < -.008 || gap > .075 || Math.min(width, depth) < .004 || height < .001) continue;
      const theta = (node.rotY || 0) * radians, cs = Math.cos(theta), sn = Math.sin(theta);
      const spread = clamp(.17 * Math.min(width, depth) + .12 * height, .007, .052);
      const rx = width / 2, rz = depth / 2;
      const ex = Math.abs(cs) * rx + Math.abs(sn) * rz + 3 * spread;
      const ez = Math.abs(sn) * rx + Math.abs(cs) * rz + 3 * spread;
      const x0 = Math.max(0, Math.floor((coordX - ex - rect[0]) / pixelWidth * size)), x1 = Math.min(size, Math.ceil((coordX + ex - rect[0]) / pixelWidth * size));
      const z0 = Math.max(0, Math.floor((coordZ - ez - rect[1]) / pixelHeight * size)), z1 = Math.min(size, Math.ceil((coordZ + ez - rect[1]) / pixelHeight * size));
      const strength = .57 * Math.exp(-Math.max(0, gap) / .026);
      for (let row = z0; row < z1; row++) {
        for (let col = x0; col < x1; col++) {
          const dx = rect[0] + (col + .5) / size * pixelWidth - coordX, dz = rect[1] + (row + .5) / size * pixelHeight - coordZ;
          const lx = Math.abs(cs * dx - sn * dz), lz = Math.abs(sn * dx + cs * dz);
          const distance = node.kind === 'box' ? Math.hypot(Math.max(0, lx - rx), Math.max(0, lz - rz))
            : Math.max(0, Math.hypot(lx / rx, lz / rz) - (node.kind === 'sphere' ? .38 : 1)) * Math.min(rx, rz);
          const shade = 255 * (1 - strength * Math.exp(-distance / spread));
          const index = row * size + col;
          pixels[index] = Math.min(pixels[index], Math.round(shade));
        }
      }
    }
    return { pixels, size, rect, y: coordY };
  }

  const unpackDepth = `
    float readDepth(vec3 packedRGB) {
      return dot(packedRGB, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
    }`;

  const frameProjection = `
    uniform sampler2D uFrame, uFrameDepth;
    uniform float uMatch, uCheckVisibility, uFar;
    varying vec4 vAnchor;
    ${unpackDepth}
    vec3 projectFrame(vec3 base, bool sky) {
      if (uMatch <= 0.0 || vAnchor.w <= 0.0) return base;
      vec2 ndc = vAnchor.xy / vAnchor.w;
      float edge = max(abs(ndc.x), abs(ndc.y));
      if (edge > 1.0) return base;
      vec2 uv = ndc * 0.5 + 0.5;
      float weight = uMatch;
      if (uCheckVisibility > 0.0) {
        float stored = readDepth(texture2D(uFrameDepth, uv).rgb);
        float tolerance = 0.004 + vAnchor.w * 0.003;
        float visible = sky ? step(0.99999, stored)
          : 1.0 - smoothstep(tolerance, 2.0 * tolerance, abs(stored * uFar - vAnchor.w));
        visible *= 1.0 - smoothstep(0.988, 1.0, edge);
        weight *= mix(1.0, visible, uCheckVisibility);
      }
      return mix(base, texture2D(uFrame, vec2(uv.x, 1.0 - uv.y)).rgb, weight);
    }`;

  const meshVertex = `
    attribute vec3 aPosition, aNormal;
    attribute vec2 aUv;
    uniform mat4 uVP, uLightVP, uAnchorVP;
    varying vec3 vWorld, vNormal;
    varying vec2 vUv;
    varying vec4 vLight, vAnchor;
    void main() {
      vec4 p = vec4(aPosition, 1.0);
      vWorld = aPosition; vNormal = aNormal; vUv = aUv;
      vLight = uLightVP * p; vAnchor = uAnchorVP * p;
      gl_Position = uVP * p;
    }`;

  function meshFragment(derivatives) {
    return `${derivatives ? '#extension GL_OES_standard_derivatives : enable' : ''}
    precision highp float;
    varying vec3 vWorld, vNormal;
    varying vec2 vUv;
    varying vec4 vLight;
    uniform sampler2D uSurface, uShadow, uContact;
    uniform vec3 uColor, uEye, uKey, uFill;
    uniform vec4 uMaterial, uLamp, uDeskRect;
    uniform float uDeskY, uPage, uShadowTexel, uLightSpan;
    ${frameProjection}

    float keyVisibility(float nl) {
      if (vLight.w <= 0.0 || nl <= 0.0) return 1.0;
      vec2 uv = vLight.xy / vLight.w * 0.5 + 0.5;
      if (max(abs(uv.x - 0.5), abs(uv.y - 0.5)) >= 0.5) return 1.0;
      float center = readDepth(texture2D(uShadow, uv).rgb) * uFar;
      float radius = 0.85 + 2.8 * smoothstep(0.0, 0.24, vLight.w - center);
      float slope = sqrt(max(0.0, 1.0 - nl * nl)) / max(0.16, nl);
      float bias = 0.001 + min(0.035, vLight.w * uShadowTexel * uLightSpan * (radius + 0.3) * slope);
      float lit = 0.0;
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec2 offset = vec2(float(x), float(y)) * uShadowTexel * radius;
          float depth = readDepth(texture2D(uShadow, uv + offset).rgb) * uFar;
          lit += step(vLight.w - bias, depth);
        }
      }
      return lit / 9.0;
    }

    void main() {
      vec3 tex = texture2D(uSurface, vUv).rgb;
      vec3 pigment = tex * uColor;
      vec3 n = normalize(vNormal);
      if (!gl_FrontFacing) {
        n = -n;
        if (uPage > 0.5) pigment = mix(vec3(0.86, 0.78, 0.62) * uColor, pigment, 0.18);
      }
      ${derivatives ? `if (uMaterial.w > 0.5) {
        vec3 dpX = dFdx(vWorld), dpY = dFdy(vWorld);
        vec3 a = cross(dpY, n), b = cross(n, dpX);
        float det = dot(dpX, a);
        vec3 grain = (dFdx(tex.r) * a + dFdy(tex.r) * b) * sign(det) / max(abs(det), 1.0e-9);
        n = normalize(n - clamp(0.0008 * grain, vec3(-0.12), vec3(0.12)));
      }` : ''}
      vec3 base = pow(pigment, vec3(2.2));
      vec3 kd = uKey - vWorld, fd = uFill - vWorld, ld = uLamp.xyz - vWorld;
      vec3 lk = normalize(kd), lf = normalize(fd), view = normalize(uEye - vWorld);
      float nl = max(dot(n, lk), 0.0), nf = max(dot(n, lf), 0.0);
      float shadow = keyVisibility(nl);
      float key = 3.0 / (1.1 + 0.64 * dot(kd, kd));
      float fill = 2.1 / (1.7 + 0.45 * dot(fd, fd));
      float lamp = uLamp.w * 0.023 * max(dot(n, ld * inversesqrt(max(dot(ld, ld), 0.0001))), 0.0) / (0.045 + dot(ld, ld));
      vec2 deskUv = (vWorld.xz - uDeskRect.xy) * uDeskRect.zw;
      float contact = (1.0 - smoothstep(0.001, 0.004, abs(vWorld.y - uDeskY))) * smoothstep(0.7, 0.95, n.y);
      float ao = mix(1.0, texture2D(uContact, deskUv).r, contact);
      vec3 hemi = mix(vec3(0.21, 0.16, 0.12), vec3(0.42, 0.46, 0.50), n.y * 0.5 + 0.5);
      vec3 warm = vec3(1.0, 0.80, 0.60), cool = vec3(0.60, 0.78, 1.0);
      vec3 diffuse = hemi * ao + warm * (key * nl * shadow) + cool * (fill * nf * ao) + vec3(1.0, 0.54, 0.20) * lamp;
      float rough = clamp(uMaterial.x, 0.12, 1.0), metal = uMaterial.z;
      float gloss = mix(125.0, 5.0, rough * rough);
      float keyGlint = pow(max(dot(n, normalize(lk + view)), 0.0), gloss) * key * nl * shadow;
      float fillGlint = pow(max(dot(n, normalize(lf + view)), 0.0), gloss * 0.58) * fill * nf;
      vec3 spec = mix(vec3(0.035), mix(base, pigment, 0.60), metal) * (1.0 - 0.76 * rough);
      vec3 energy = base * (diffuse * (1.0 - 0.25 * metal) + uMaterial.y) + spec * (warm * keyGlint + cool * fillGlint);
      vec3 displayColor = pow(energy / (1.0 + 0.20 * energy), vec3(1.0 / 2.2));
      gl_FragColor = vec4(projectFrame(min(displayColor, vec3(1.0)), false), 1.0);
    }`;
  }

  const skyVertex = `
    attribute vec2 aPosition;
    uniform mat4 uAnchorVP;
    uniform vec3 uRight, uUp, uBack;
    varying vec3 vRay;
    varying vec4 vAnchor;
    void main() {
      vRay = aPosition.x * uRight + aPosition.y * uUp - uBack;
      vAnchor = uAnchorVP * vec4(vRay, 0.0);
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }`;
  const skyFragment = `
    precision highp float;
    varying vec3 vRay;
    ${frameProjection}
    void main() {
      float up = smoothstep(-0.5, 0.7, normalize(vRay).y);
      vec3 room = mix(vec3(0.23, 0.19, 0.15), vec3(0.47, 0.47, 0.44), up);
      gl_FragColor = vec4(projectFrame(room, true), 1.0);
    }`;

  const depthVertex = `
    attribute vec3 aPosition;
    attribute float aHit;
    uniform mat4 uVP;
    uniform vec2 uCenter, uScale;
    varying float vDepth, vHit;
    void main() {
      vec4 clip = uVP * vec4(aPosition, 1.0);
      vDepth = clip.w; vHit = aHit;
      clip.xy = (clip.xy - uCenter * clip.w) * uScale;
      gl_Position = clip;
    }`;
  const depthFragment = `
    precision highp float;
    varying float vDepth, vHit;
    uniform float uFar;
    uniform bool uPick;
    void main() {
      if (uPick) {
        gl_FragColor = vec4(vHit, 0.0, 0.0, 1.0);
      } else {
        float depth = min(vDepth / uFar, 0.999999);
        vec3 enc = fract(depth * vec3(1.0, 255.0, 65025.0));
        enc.xy -= enc.yz / 255.0;
        gl_FragColor = vec4(enc, 1.0);
      }
    }`;

  function decodeImage(source, name) {
    if (!source) return Promise.resolve(null);
    if (typeof source !== 'string' || !/^data:image\//i.test(source)) throw new Error(`${name} 需要内嵌图像 data URL`);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`无法解码 ${name}`));
      image.src = source;
    });
  }

  function createProgram(gl, program, vertex, fragment) {
    const shaders = [];
    try {
      for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
        const shader = gl.createShader(type);
        shaders.push(shader);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
        gl.attachShader(program, shader);
      }
      ['aPosition', 'aNormal', 'aUv', 'aHit'].forEach((name, localIndex) => gl.bindAttribLocation(program, localIndex, name));
      gl.linkProgram(program);
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
    } finally {
      for (const shader of shaders) gl.deleteShader(shader);
    }
    const uniformLocations = {};
    for (let localIndex = 0; localIndex < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); localIndex++) {
      const { name } = gl.getActiveUniform(program, localIndex);
      uniformLocations[name] = gl.getUniformLocation(program, name);
    }
    return { program, u: uniformLocations };
  }

  function rgb(hex) {
    const value = parseInt((hex || '#ffffff').slice(1), 16);
    return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
  }

  async function createDeskRenderer(canvas, scene, textures, options = {}) {
    const paper = scene.materials.leaf ?? Object.values(scene.materials).find(spec => spec.texture === 'leaf.jpg');
    const leafSpec = { color: '#ffffff', ...paper, texture: 'leaf.jpg' };
    const names = new Set(scene.nodes.map(node => scene.materials[node.material].texture).filter(Boolean));
    names.add(leafSpec.texture);
    const [images, firstImage, tailImage] = await Promise.all([
      Promise.all(Array.from(names, async name => [name, await decodeImage(textures?.[name], name)])),
      decodeImage(options.anchorImage, '锚帧'), decodeImage(options.tailImage, '末帧'),
    ]);
    const gl = canvas.getContext('webgl', { alpha: false, depth: true, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('当前浏览器无法创建 WebGL 绘图上下文');
    const resources = [];
    let disposed = false;
    function own(kind) {
      const item = gl['create' + kind]();
      if (!item) throw new Error(`无法分配 WebGL ${kind}`);
      resources.push([kind, item]);
      return item;
    }
    function dispose() {
      if (disposed) return;
      disposed = true;
      gl.useProgram(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      for (let localIndex = resources.length - 1; localIndex >= 0; localIndex--) {
        const [kind, item] = resources[localIndex];
        gl['delete' + kind](item);
      }
      resources.length = 0;
    }

    try {
      gl.disable(gl.DITHER);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.BLEND);
      gl.depthFunc(gl.LEQUAL);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      const surface = createProgram(gl, own('Program'), meshVertex, meshFragment(!!gl.getExtension('OES_standard_derivatives')));
      const sky = createProgram(gl, own('Program'), skyVertex, skyFragment);
      const depth = createProgram(gl, own('Program'), depthVertex, depthFragment);
      const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
      const maxTarget = Math.min(maxTexture, gl.getParameter(gl.MAX_RENDERBUFFER_SIZE));
      const anisotropic = gl.getExtension('EXT_texture_filter_anisotropic');

      function newTexture(filter, wrap = gl.CLAMP_TO_EDGE) {
        const tex = own('Texture');
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
        return tex;
      }
      function imageTexture(image, mipmaps, repeat = false) {
        const tex = newTexture(gl.LINEAR, repeat ? gl.MIRRORED_REPEAT : gl.CLAMP_TO_EDGE);
        const size = lengthValue => Math.min(maxTexture, 2 ** Math.ceil(Math.log2(lengthValue)));
        let source = image;
        if (mipmaps) {
          const pixelWidth = size(image.naturalWidth), pixelHeight = size(image.naturalHeight);
          if (pixelWidth !== image.naturalWidth || pixelHeight !== image.naturalHeight) {
            source = document.createElement('canvas');
            source.width = pixelWidth; source.height = pixelHeight;
            source.getContext('2d').drawImage(image, 0, 0, pixelWidth, pixelHeight);
          }
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
        if (mipmaps) {
          gl.generateMipmap(gl.TEXTURE_2D);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
          if (anisotropic) gl.texParameterf(gl.TEXTURE_2D, anisotropic.TEXTURE_MAX_ANISOTROPY_EXT,
            Math.min(8, gl.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
        }
        return tex;
      }
      const white = newTexture(gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
      const maps = new Map();
      for (const [name, image] of images) if (image) maps.set(name, imageTexture(image, true, name === 'wood.jpg' || name === 'wall.jpg'));
      const desk = deskOcclusion(scene.nodes);
      const contact = newTexture(gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, desk.size, desk.size, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, desk.pixels);

      function target(pixelWidth, pixelHeight) {
        const texture = newTexture(gl.NEAREST);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, pixelWidth, pixelHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        const depthBuffer = own('Renderbuffer'), fbo = own('Framebuffer');
        gl.bindRenderbuffer(gl.RENDERBUFFER, depthBuffer);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, pixelWidth, pixelHeight);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthBuffer);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('无法创建深度绘制目标');
        return { texture, fbo, w: pixelWidth, h: pixelHeight };
      }
      function buffer(data, usage = gl.STATIC_DRAW) {
        const item = own('Buffer');
        gl.bindBuffer(gl.ARRAY_BUFFER, item);
        gl.bufferData(gl.ARRAY_BUFFER, data, usage);
        return item;
      }
      function bindMesh(item) {
        gl.bindBuffer(gl.ARRAY_BUFFER, item);
        const stride = floatsPerVertex * 4;
        for (let localIndex = 0; localIndex < 4; localIndex++) gl.enableVertexAttribArray(localIndex);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
        gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 32);
      }
      function useTexture(slot, tex) {
        gl.activeTexture(gl.TEXTURE0 + slot);
        gl.bindTexture(gl.TEXTURE_2D, tex);
      }

      const compiled = staticMesh(scene);
      const solids = buffer(compiled.vertices), solidCount = compiled.vertices.length / floatsPerVertex;
      const pageCount = pageSegments * 6;
      const pageData = new Float32Array(pageCount * floatsPerVertex);
      const page = buffer(pageData.byteLength, gl.DYNAMIC_DRAW);
      const skyTriangle = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
      let currentAngle = -1, shadowAngle = -1;
      function setPage(angle) {
        if (currentAngle === angle) return;
        writePage(pageData, scene.object, angle);
        gl.bindBuffer(gl.ARRAY_BUFFER, page);
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, pageData);
        currentAngle = angle;
      }
      const { camera, lighting } = scene;
      const extent = scene.nodes.reduce((reach, node) => Math.max(reach,
        Math.hypot(...node.pos.map((coordX, localIndex) => coordX - camera.target[localIndex])) + Math.hypot(...node.size) / 2), 0);
      const far = Math.max(32, 2 * extent + 3 * camera.radius + Math.hypot(...lighting.key));
      const aspect = () => Math.max(1, gl.drawingBufferWidth) / Math.max(1, gl.drawingBufferHeight);
      const viewAt = pose => orbit(camera, pose, aspect(), Math.max(far, (pose?.radius ?? camera.radius) + extent + 1));
      const anchorCamera = orbit(camera, camera, 16 / 9, far);
      const keyBack = unit(lighting.key.map((coordX, localIndex) => coordX - camera.target[localIndex]));
      const keyRight = Math.hypot(keyBack[0], keyBack[2]) > .0001 ? unit([keyBack[2], 0, -keyBack[0]]) : [1, 0, 0];
      const lightTan = Math.tan(55 * radians);
      const light = perspective(lighting.key, keyBack, keyRight, lightTan, 1, .08, far);
      const shadowSize = Math.min(1024, maxTarget);
      const shadow = target(shadowSize, shadowSize), pickTarget = target(1, 1);
      const pickedPixel = new Uint8Array(4);

      function depthPass(out, matrix, nx, ny) {
        const picking = nx !== undefined;
        gl.bindFramebuffer(gl.FRAMEBUFFER, out.fbo);
        gl.viewport(0, 0, out.w, out.h);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.clearColor(picking ? 0 : 1, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        gl.useProgram(depth.program);
        const passUniforms = depth.u;
        gl.uniformMatrix4fv(passUniforms.uVP, false, matrix);
        gl.uniform2f(passUniforms.uCenter, picking ? 2 * nx - 1 : 0, picking ? 1 - 2 * ny : 0);
        gl.uniform2f(passUniforms.uScale, picking ? gl.drawingBufferWidth : 1, picking ? gl.drawingBufferHeight : 1);
        gl.uniform1f(passUniforms.uFar, far);
        gl.uniform1i(passUniforms.uPick, Number(picking));
        bindMesh(solids); gl.drawArrays(gl.TRIANGLES, 0, solidCount);
        bindMesh(page); gl.drawArrays(gl.TRIANGLES, 0, pageCount);
      }
      function screenTarget() {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      }

      setPage(0);
      const anchorDepths = new Map();
      function frame(image) {
        if (!image) return null;
        const ratio = image.naturalWidth / image.naturalHeight;
        let calibration = anchorDepths.get(ratio);
        if (!calibration) {
          const view = orbit(camera, camera, ratio, far);
          const scale = Math.min(1, Math.min(1280, maxTarget) / Math.max(image.naturalWidth, image.naturalHeight));
          const map = target(Math.max(1, Math.round(image.naturalWidth * scale)), Math.max(1, Math.round(image.naturalHeight * scale)));
          depthPass(map, view.matrix);
          calibration = { view, depth: map.texture };
          anchorDepths.set(ratio, calibration);
        }
        return { ...calibration, texture: imageTexture(image, false) };
      }
      const first = frame(firstImage), last = frame(tailImage);
      screenTarget();
      const flame = scene.nodes.find(node => node.kind === 'sphere' && scene.materials[node.material].emission > 1);
      const lamp = flame ? [...flame.pos, scene.materials[flame.material].emission] : [0, 0, 0, 0];
      function surfaceMaterial(key, spec) {
        return { color: rgb(spec.color), texture: maps.get(spec.texture) || white,
          props: [spec.roughness ?? .73, spec.emission ?? 0, key === 'brass' ? .78 : 0, spec.texture === 'wood.jpg' ? 1 : 0] };
      }
      const batches = compiled.batches.map(batch => ({ ...batch, material: surfaceMaterial(batch.key, scene.materials[batch.key]) }));
      const leaf = surfaceMaterial('leaf', leafSpec);
      function setMaterial(material, isPage) {
        gl.uniform3fv(surface.u.uColor, material.color);
        gl.uniform4fv(surface.u.uMaterial, material.props);
        gl.uniform1f(surface.u.uPage, Number(isPage));
        useTexture(0, material.texture);
      }
      for (const pass of [surface, sky]) {
        gl.useProgram(pass.program);
        gl.uniform1i(pass.u.uFrame, 3); gl.uniform1i(pass.u.uFrameDepth, 4);
        gl.uniform1f(pass.u.uFar, far);
      }
      gl.useProgram(surface.program);
      gl.uniform1i(surface.u.uSurface, 0); gl.uniform1i(surface.u.uShadow, 1); gl.uniform1i(surface.u.uContact, 2);
      gl.uniformMatrix4fv(surface.u.uLightVP, false, light.matrix);
      gl.uniform3fv(surface.u.uKey, lighting.key); gl.uniform3fv(surface.u.uFill, lighting.fill);
      gl.uniform4fv(surface.u.uLamp, lamp); gl.uniform4fv(surface.u.uDeskRect, desk.rect);
      gl.uniform1f(surface.u.uDeskY, desk.y); gl.uniform1f(surface.u.uShadowTexel, 1 / shadowSize);
      gl.uniform1f(surface.u.uLightSpan, 2 * lightTan);

      function draw(pose, progress = 0, match = 0, useTail = false) {
        if (disposed) throw new Error('渲染器已释放');
        const angle = pageAngle(progress), view = viewAt(pose);
        setPage(angle);
        if (shadowAngle !== angle) {
          depthPass(shadow, light.matrix);
          shadowAngle = angle;
        }
        const image = useTail ? last || first : first;
        const delta = Math.acos(clamp(dot(view.back, anchorCamera.back), -1, 1));
        const zoom = Math.abs(Math.log((pose?.radius ?? camera.radius) / camera.radius));
        const depthTarget = Math.min(1, Math.hypot(delta / (14 * radians), zoom / .16));
        const weight = image ? clamp(match, 0, 1) * (1 - depthTarget * depthTarget * (3 - 2 * depthTarget)) : 0;
        const check = clamp(depthTarget * 14 + angle * 4, 0, 1);
        const matrix = image?.view.matrix || anchorCamera.matrix;
        useTexture(1, shadow.texture); useTexture(2, contact);
        useTexture(3, image?.texture || white); useTexture(4, image?.depth || white);
        screenTarget();
        gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        function useProjected(pass) {
          gl.useProgram(pass.program);
          gl.uniformMatrix4fv(pass.u.uAnchorVP, false, matrix);
          gl.uniform1f(pass.u.uMatch, weight); gl.uniform1f(pass.u.uCheckVisibility, check);
        }
        gl.disable(gl.DEPTH_TEST);
        useProjected(sky);
        const tan = Math.tan(camera.fov * radians / 2);
        gl.uniform3fv(sky.u.uRight, view.right.map(component => component * tan * aspect()));
        gl.uniform3fv(sky.u.uUp, view.up.map(component => component * tan));
        gl.uniform3fv(sky.u.uBack, view.back);
        gl.bindBuffer(gl.ARRAY_BUFFER, skyTriangle);
        for (let localIndex = 1; localIndex < 4; localIndex++) gl.disableVertexAttribArray(localIndex);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        gl.enable(gl.DEPTH_TEST);
        useProjected(surface);
        gl.uniformMatrix4fv(surface.u.uVP, false, view.matrix);
        gl.uniform3fv(surface.u.uEye, view.eye);
        bindMesh(solids);
        for (const batch of batches) {
          setMaterial(batch.material, false);
          gl.drawArrays(gl.TRIANGLES, batch.start, batch.count);
        }
        setMaterial(leaf, true); bindMesh(page); gl.drawArrays(gl.TRIANGLES, 0, pageCount);
      }

      function project(world, pose) {
        const view = viewAt(pose), offset = world.map((component, localIndex) => component - view.eye[localIndex]);
        const distance = -dot(view.back, offset);
        if (distance <= 0) return [NaN, NaN];
        const halfHeight = distance * Math.tan(camera.fov * radians / 2);
        return [.5 + dot(view.right, offset) / (2 * halfHeight * aspect()), .5 - dot(view.up, offset) / (2 * halfHeight)];
      }
      function pick(nx, ny, pose, progress = 0) {
        if (disposed || !(nx >= 0 && nx <= 1 && ny >= 0 && ny <= 1)) return false;
        setPage(pageAngle(progress));
        depthPass(pickTarget, viewAt(pose).matrix, nx, ny);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pickedPixel);
        screenTarget();
        return pickedPixel[0] > 127;
      }
      return { draw, project, pick, dispose };
    } catch (error) {
      dispose();
      throw error;
    }
  }

  globalThis.createDeskRenderer = createDeskRenderer;
})();
