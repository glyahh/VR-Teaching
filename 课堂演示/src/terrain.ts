let terrainSurface: HTMLDivElement | undefined;

function createTerrainSurface() {
  if (terrainSurface) return terrainSurface;
  const surface = document.createElement('div');
  surface.className = 'terrain-surface';
  surface.setAttribute('role','img');
  surface.setAttribute('aria-label','长征沿线地形');
  surface.style.backgroundImage = `url(${mediaAssets.terrain})`;
  terrainSurface = surface;

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {alpha:false, antialias:false, preserveDrawingBuffer:true});
  if (!gl) return surface;
  const vertexSource = `
    attribute vec2 position;
    varying vec2 uv;
    void main() {
      gl_Position = vec4(position, 0.0, 1.0);
      uv = vec2(position.x + 1.0, 1.0 - position.y) * 0.5;
    }`;
  const fragmentSource = `
    precision highp float;
    uniform sampler2D elevations;
    uniform vec2 sampleStep;
    varying vec2 uv;
    float heightAt(vec2 point) {
      vec2 value = texture2D(elevations, point).rg;
      return dot(value, vec2(65280.0, 255.0)) - 2048.0;
    }
    void main() {
      float height = heightAt(uv);
      float dx = heightAt(uv + vec2(sampleStep.x, 0.0)) - heightAt(uv - vec2(sampleStep.x, 0.0));
      float dy = heightAt(uv + vec2(0.0, sampleStep.y)) - heightAt(uv - vec2(0.0, sampleStep.y));
      vec3 normal = normalize(vec3(-dx * 0.0035, -dy * 0.0035, 1.0));
      float shade = max(0.0, dot(normal, normalize(vec3(-0.46, -0.58, 0.67))));
      vec3 lowland = vec3(0.135, 0.184, 0.143);
      vec3 highland = vec3(0.40, 0.40, 0.28);
      vec3 earth = mix(lowland, highland, clamp(height / 4600.0, 0.0, 1.0));
      vec3 color = earth * (0.49 + shade * 1.21);
      gl_FragColor = vec4(mix(vec3(0.081, 0.126, 0.141), color, smoothstep(-2.0, 10.0, height)), 1.0);
    }`;
  function compile(type: number, source: string) {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, source);
    gl!.compileShader(shader);
    return shader;
  }
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return surface;

  canvas.addEventListener('webglcontextlost',()=>canvas.remove());
  const elevation = new Image();
  elevation.onload = () => {
    if (gl.isContextLost() || elevation.width > gl.getParameter(gl.MAX_TEXTURE_SIZE)) return;
    canvas.width = elevation.width;
    canvas.height = elevation.height;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.useProgram(program);
    const vertices = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program,'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,elevation);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform2f(gl.getUniformLocation(program,'sampleStep'),1/canvas.width,1/canvas.height);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (gl.getError() === gl.NO_ERROR) surface.append(canvas);
  };
  elevation.src = mediaAssets.elevation;
  return surface;
}
