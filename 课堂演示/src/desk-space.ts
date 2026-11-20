async function createMeetingSpace(
  canvas: HTMLCanvasElement,
  assets: {manifest: string; mesh: string; front: string; left: string; right: string},
): Promise<{
  draw(pose: DeskPose): void;
  project(which: 'left' | 'right', pose: DeskPose): [number, number];
  pick(u: number, v: number, pose: DeskPose): 'left' | 'right' | null;
  dispose(): void;
}> {
  function record(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
  function numbers(value: unknown, count: number): value is number[] {
    return Array.isArray(value) && value.length === count && value.every(Number.isFinite);
  }
  function count(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
  }
  function readCamera(value: unknown) {
    if (!record(value) || !numbers(value.vp, 16) || !numbers(value.eye, 3)) {
      throw new Error('桌边机位数据有误');
    }
    return {vp: value.vp, eye: value.eye};
  }
  function readManifest(value: unknown) {
    if (!record(value) || value.version !== 1 || !numbers(value.size, 2) ||
        !numbers(value.projection, 16) || !numbers(value.cameraWorld, 16) ||
        !numbers(value.pivot, 3) || !numbers(value.sky, 3) ||
        !Array.isArray(value.views) || value.views.length !== 3 || !record(value.anchors) ||
        !numbers(value.anchors.left, 3) || !numbers(value.anchors.right, 3)) {
      throw new Error('桌边空间数据有误');
    }
    const mesh = value.mesh;
    if (!record(mesh) || !count(mesh.vertices) || !count(mesh.indices) ||
        (mesh.indexBytes !== 2 && mesh.indexBytes !== 4) || mesh.indices % 3 !== 0 ||
        !numbers(mesh.min, 3) || !numbers(mesh.span, 3)) {
      throw new Error('桌边网格数据有误');
    }
    return {
      aspect: value.size[0] / value.size[1], projection: value.projection,
      world: value.cameraWorld, pivot: value.pivot, sky: value.sky,
      views: value.views.map(readCamera), anchors: {left: value.anchors.left, right: value.anchors.right},
      vertices: mesh.vertices, indices: mesh.indices, indexBytes: mesh.indexBytes,
      min: mesh.min, span: mesh.span,
    };
  }
  function photo(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('桌边机位图片读取失败'));
      image.src = url;
    });
  }
  async function unpack(url: string) {
    const stream = (await fetch(url)).body;
    if (!stream) throw new Error('桌边网格读取失败');
    return new Response(stream.pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
  }
  function required<T>(value: T | null): T {
    if (value === null) throw new Error('无法创建桌边 WebGL 资源');
    return value;
  }

  const model = readManifest(JSON.parse(assets.manifest));
  const gl = required(canvas.getContext('webgl2', {alpha: false, depth: true, antialias: true}));
  const [raw, ...photos] = await Promise.all([
    unpack(assets.mesh), photo(assets.front), photo(assets.left), photo(assets.right),
  ]);
  const vertexBytes = model.vertices * 10;
  if (raw.byteLength !== vertexBytes + model.indices * model.indexBytes) {
    throw new Error('桌边网格长度与清单不符');
  }
  const indexType = model.indexBytes === 2 ? gl.UNSIGNED_SHORT : gl.UNSIGNED_INT;
  const cleanup: (() => void)[] = [];
  function own<T>(value: T | null, destroy: (item: T) => void): T {
    const item = required(value);
    cleanup.push(() => destroy(item));
    return item;
  }
  function dispose() {
    if (cleanup.length) {
      gl.useProgram(null);
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    while (cleanup.length) cleanup.pop()?.();
  }
  function program(vertex: string, fragment: string) {
    const result = own(gl.createProgram(), item => gl.deleteProgram(item));
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]] as const) {
      const shader = required(gl.createShader(type));
      try {
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
          throw new Error(gl.getShaderInfoLog(shader) || '桌边着色器编译失败');
        }
        gl.attachShader(result, shader);
      } finally {
        gl.deleteShader(shader);
      }
    }
    gl.linkProgram(result);
    if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(result) || '桌边着色器链接失败');
    }
    return result;
  }
  const vertexInputs = `
    layout(location=0) in vec3 aPosition;
    layout(location=1) in vec4 aColorAndPaper;
    uniform vec3 uMin, uSpan;
    uniform mat4 uVP;`;
  const solidVertex = `#version 300 es
    ${vertexInputs}
    flat out float vPaper;
    void main() {
      vPaper = aColorAndPaper.a;
      gl_Position = uVP * vec4(uMin + aPosition * uSpan, 1.);
    }`;
  const solidFragment = `#version 300 es
    precision highp float;
    flat in float vPaper;
    out vec4 frag;
    void main() { frag = vec4(vPaper, 0., 0., 1.); }`;

  const colorVertex = `#version 300 es
    ${vertexInputs}
    uniform mat4 uViews[3];
    uniform vec3 uEye, uSkyColor;
    uniform bool uSky;
    out vec4 vRef[3];
    out vec3 vWorld, vColor;
    void main() {
      vec4 point;
      if (uSky) {
        vec2 corner = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2) * 2. - 1.;
        gl_Position = vec4(corner, 1., 1.);
        vec4 farPoint = inverse(uVP) * gl_Position;
        point = vec4(farPoint.xyz / farPoint.w - uEye, 0.);
        vColor = uSkyColor;
      } else {
        point = vec4(uMin + aPosition * uSpan, 1.);
        gl_Position = uVP * point;
        vColor = aColorAndPaper.rgb;
      }
      vWorld = point.xyz;
      for (int i = 0; i < 3; ++i) vRef[i] = uViews[i] * point;
    }`;
  const colorFragment = `#version 300 es
    precision highp float;
    precision highp sampler2DArray;
    uniform sampler2D uFront, uLeft, uRight;
    uniform sampler2DArray uDepth;
    uniform bool uSky;
    uniform vec3 uEye, uEyes[3], uWeight, uLock;
    uniform int uExact;
    in vec4 vRef[3];
    in vec3 vWorld, vColor;
    out vec4 frag;

    vec3 photo(int i, vec2 uv, vec2 dx, vec2 dy) {
      if (i == 0) return textureGrad(uFront, uv, dx, dy).rgb;
      if (i == 1) return textureGrad(uLeft, uv, dx, dy).rgb;
      return textureGrad(uRight, uv, dx, dy).rgb;
    }
    vec2 visibility(int i, vec3 p, vec3 dx, vec3 dy, float w) {
      ivec2 size = textureSize(uDepth, 0).xy;
      vec2 pixel = p.xy * vec2(size) - .5;
      ivec2 base = ivec2(floor(pixel));
      vec2 fraction = fract(pixel);
      // 以该三角面的源机位深度斜率，把比较点移到每个深度纹素的中心。
      float det = dx.x*dy.y - dx.y*dy.x;
      vec2 slope = abs(det) < 1.e-14 || uSky ? vec2(0.) :
        vec2(dx.z*dy.y - dy.z*dx.y, dx.x*dy.z - dy.x*dx.z) / (det * vec2(size));
      float bias = .000002 + .000025 / (w*w);
      float z = uSky ? 1. : p.z;
      float coverage = 0., guard = 1.;
      for (int y = 0; y <= 1; ++y) for (int x = 0; x <= 1; ++x) {
        ivec2 corner = ivec2(x,y);
        ivec2 address = clamp(base + corner, ivec2(0), size-1);
        float nearest = texelFetch(uDepth, ivec3(address, i), 0).r;
        float surface = z + dot(vec2(corner) - fraction, slope);
        vec2 weight = 1. - abs(vec2(corner) - fraction);
        coverage += weight.x * weight.y * step(surface - bias, nearest);
        // 照片的抗锯齿和景深会把遮挡物颜色带出轮廓，优先使用轮廓外有余量的机位。
        ivec2 outer = 3*corner - 1;
        address = clamp(base + outer, ivec2(0), size-1);
        nearest = texelFetch(uDepth, ivec3(address, i), 0).r;
        guard = min(guard, step(z + dot(vec2(outer) - fraction, slope) - bias, nearest));
      }
      return vec2(coverage, guard);
    }
    void accumulate(int i, vec4 ref, vec3 normal, inout vec3 sum, inout float total, inout float strongest) {
      vec3 p = .5 + .5 * ref.xyz / ref.w;
      vec3 dx = dFdx(p), dy = dFdy(p);
      float edge = min(min(p.x, p.y), min(1. - p.x, 1. - p.y));
      if (ref.w <= 0. || edge <= 0.) return;
      vec2 visible = visibility(i, p, dx, dy, ref.w);
      float face = uSky ? 1. : smoothstep(-.015, .14, dot(normal, normalize(uEyes[i] - vWorld)));
      float valid = smoothstep(.12, .92, visible.x) * face;
      valid = mix(valid * smoothstep(0., .012, edge), 1., uLock[i]);
      float weight = valid * uWeight[i] * mix(.035, 1., max(visible.y, uLock[i]));
      sum += weight * photo(i, p.xy, dx.xy, dy.xy);
      total += weight;
      strongest = max(strongest, valid);
    }
    void main() {
      if (uExact >= 0) {
        vec4 ref = vRef[uExact];
        vec2 uv = ref.xy / ref.w * .5 + .5;
        frag = vec4(photo(uExact, uv, dFdx(uv), dFdy(uv)), 1.);
        return;
      }
      vec3 normal = cross(dFdx(vWorld), dFdy(vWorld));
      normal /= max(length(normal), 1.e-18);
      if (dot(normal, uEye - vWorld) < 0.) normal = -normal;
      vec3 sum = vec3(0.);
      float total = 0., strongest = 0.;
      // 在统一控制流中求各机位的屏幕导数，避免部分桌面驱动在带 continue 的循环里返回零。
      accumulate(0, vRef[0], normal, sum, total, strongest);
      accumulate(1, vRef[1], normal, sum, total, strongest);
      accumulate(2, vRef[2], normal, sum, total, strongest);
      frag = vec4(mix(vColor, sum / max(total, 1.e-12), smoothstep(.015, .45, strongest)), 1.);
    }`;

  const dot = (a: number[], b: number[]) => a[0]*b[0] + a[1]*b[1] + a[2]*b[2];
  function camera(pose: DeskPose) {
    const radians = Math.PI / 180;
    const cy = Math.cos(pose.yaw*radians), sy = Math.sin(pose.yaw*radians);
    const cp = Math.cos(-pose.pitch*radians), sp = Math.sin(-pose.pitch*radians);
    const base = model.world;
    const horizontal = Math.hypot(base[0], base[1]);
    const ax = base[0]/horizontal, ay = base[1]/horizontal;
    function turn([x, y, z]: number[]) {
      const parallel = (ax*x + ay*y) * (1-cp);
      const tx = cp*x + sp*ay*z + ax*parallel;
      const ty = cp*y - sp*ax*z + ay*parallel;
      return [cy*tx - sy*ty, sy*tx + cy*ty, cp*z + sp*(ax*y - ay*x)];
    }
    const right = turn(base.slice(0, 3)), up = turn(base.slice(4, 7)), back = turn(base.slice(8, 11));
    const pivot = model.pivot;
    const offset = turn(pivot.map((value, i) => base[12+i] - value));
    const eye = pivot.map((value, i) => value + offset[i]/pose.zoom);
    const view = [
      right[0], up[0], back[0], 0, right[1], up[1], back[1], 0,
      right[2], up[2], back[2], 0, -dot(right,eye), -dot(up,eye), -dot(back,eye), 1,
    ];
    const aspect = gl.drawingBufferWidth / Math.max(1, gl.drawingBufferHeight);
    const scale = [Math.max(1, model.aspect/aspect), Math.max(1, aspect/model.aspect), 1, 1];
    const vp = new Float32Array(16);
    for (let col = 0; col < 16; col += 4) {
      for (let row = 0; row < 4; row++) {
        for (let k = 0; k < 4; k++) vp[col+row] += model.projection[4*k+row] * view[col+k];
        vp[col+row] *= scale[row];
      }
    }
    const distances = model.views.map(ref => Math.hypot(...ref.eye.map((value, i) => value - eye[i])));
    return {
      vp, eye, distances,
      weights: distances.map(d => 1 / Math.max(.00001, d*d)),
      locks: distances.map(d => Math.max(0, 1 - d/.018)),
    };
  }
  function project(which: 'left' | 'right', pose: DeskPose): [number, number] {
    const {vp} = camera(pose);
    const [x, y, z] = model.anchors[which];
    const clip = (i: number) => vp[i]*x + vp[4+i]*y + vp[8+i]*z + vp[12+i];
    const w = clip(3);
    return w > 0 ? [.5 + .5*clip(0)/w, .5 - .5*clip(1)/w] : [NaN, NaN];
  }

  try {
    const vao = own(gl.createVertexArray(), item => gl.deleteVertexArray(item));
    gl.bindVertexArray(vao);
    function upload(target: number, bytes: Uint8Array) {
      const buffer = own(gl.createBuffer(), item => gl.deleteBuffer(item));
      gl.bindBuffer(target, buffer);
      gl.bufferData(target, bytes, gl.STATIC_DRAW);
    }
    upload(gl.ARRAY_BUFFER, new Uint8Array(raw, 0, vertexBytes));
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, 10, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.UNSIGNED_BYTE, true, 10, 6);
    upload(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(raw, vertexBytes));
    const triangles = () => gl.drawElements(gl.TRIANGLES, model.indices, indexType, 0);
    const solid = program(solidVertex, solidFragment);
    const shaded = program(colorVertex, colorFragment);
    function location(shader: WebGLProgram, name: string) {
      return required(gl.getUniformLocation(shader, name));
    }
    for (const shader of [solid, shaded]) {
      gl.useProgram(shader);
      gl.uniform3fv(location(shader, 'uMin'), model.min);
      gl.uniform3fv(location(shader, 'uSpan'), model.span);
    }
    const solidVP = location(solid, 'uVP');
    const shadedVP = location(shaded, 'uVP'), eye = location(shaded, 'uEye');
    const weight = location(shaded, 'uWeight'), lock = location(shaded, 'uLock');
    const sky = location(shaded, 'uSky'), exact = location(shaded, 'uExact');
    gl.uniformMatrix4fv(location(shaded, 'uViews[0]'), false, model.views.flatMap(view => view.vp));
    gl.uniform3fv(location(shaded, 'uEyes[0]'), model.views.flatMap(view => view.eye));
    gl.uniform3fv(location(shaded, 'uSkyColor'), model.sky);

    function newTexture(unit: number, target: number) {
      const texture = own(gl.createTexture(), item => gl.deleteTexture(item));
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(target, texture);
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return texture;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    photos.forEach((image, i) => {
      newTexture(i, gl.TEXTURE_2D);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.uniform1i(location(shaded, ['uFront', 'uLeft', 'uRight'][i]), i);
    });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    const depthTarget = gl.TEXTURE_2D_ARRAY;
    const depths = newTexture(3, depthTarget);
    const depthW = Math.min(1600, Math.max(...photos.map(image => image.naturalWidth)) * 1.25) | 0;
    const depthH = Math.round(depthW / model.aspect);
    gl.texStorage3D(depthTarget, 1, gl.DEPTH_COMPONENT24, depthW, depthH, 3);
    gl.texParameteri(depthTarget, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(depthTarget, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.uniform1i(location(shaded, 'uDepth'), 3);

    function framebuffer() {
      const target = own(gl.createFramebuffer(), item => gl.deleteFramebuffer(item));
      gl.bindFramebuffer(gl.FRAMEBUFFER, target);
      return target;
    }
    function checkFramebuffer() {
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('桌边深度缓冲不可用');
      }
    }
    framebuffer();
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DITHER);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(solid);
    gl.viewport(0, 0, depthW, depthH);
    model.views.forEach((view, i) => {
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, depths, 0, i);
      checkFramebuffer();
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(solidVP, false, view.vp);
      triangles();
    });
    // 点击时仅为指针覆盖的一个像素栅格化，所有遮挡物同纸面一起参与深度测试。
    const pickTarget = framebuffer();
    for (const [format, attachment] of [
      [gl.RGBA8, gl.COLOR_ATTACHMENT0], [gl.DEPTH_COMPONENT24, gl.DEPTH_ATTACHMENT],
    ]) {
      const buffer = own(gl.createRenderbuffer(), item => gl.deleteRenderbuffer(item));
      gl.bindRenderbuffer(gl.RENDERBUFFER, buffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, format, 1, 1);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, attachment, gl.RENDERBUFFER, buffer);
    }
    checkFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const hit = new Uint8Array(4);

    function draw(pose: DeskPose) {
      const view = camera(pose);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.bindVertexArray(vao);
      gl.useProgram(shaded);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.uniformMatrix4fv(shadedVP, false, view.vp);
      gl.uniform3fv(eye, view.eye);
      gl.uniform3fv(weight, view.weights);
      gl.uniform3fv(lock, view.locks);
      gl.uniform1i(exact, view.distances.findIndex(d => d < .00001));
      gl.uniform1i(sky, 0);
      triangles();
      gl.uniform1i(sky, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    function pick(u: number, v: number, pose: DeskPose): 'left' | 'right' | null {
      if (!(u >= 0 && v >= 0 && u < 1 && v < 1)) return null;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      gl.bindFramebuffer(gl.FRAMEBUFFER, pickTarget);
      gl.viewport(-Math.floor(u*w), Math.floor(v*h) + 1 - h, w, h);
      gl.bindVertexArray(vao);
      gl.useProgram(solid);
      gl.uniformMatrix4fv(solidVP, false, camera(pose).vp);
      gl.clearColor(0, 0, 0, 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      triangles();
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, hit);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, w, h);
      return hit[0] === 1 ? 'left' : hit[0] === 2 ? 'right' : null;
    }
    return {draw, project, pick, dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}
