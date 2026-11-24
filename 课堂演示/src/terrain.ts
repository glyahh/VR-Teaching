const terrainAspect = 1784 / 952;
const terrainColumns = 177;
const terrainRows = 97;
// The raster covers three map widths and five map heights. The relief uses the central two of each.
const textureScale: [number,number] = [2/3,2/5];
type TerrainAngle = [azimuth: number, tilt: number];
const mapHomeAngle: TerrainAngle = [0, 32];
type TerrainSurface = {
  element: HTMLDivElement;
  ready: boolean;
  lost?: boolean;
  onChange: () => void;
  orient: (angle: TerrainAngle) => void;
  project: (point: Point) => Point;
};
let terrainSurface: TerrainSurface | undefined;

function createTerrainSurface(onChange: () => void): TerrainSurface {
  if (terrainSurface && !terrainSurface.lost) {
    terrainSurface.onChange = onChange;
    return terrainSurface;
  }
  const surface = document.createElement('div');
  surface.className = 'terrain-surface';
  surface.setAttribute('role','img');
  surface.setAttribute('aria-label','长征沿线地形');
  surface.style.backgroundImage = `url(${mediaAssets.terrain})`;
  const elevations = new Float32Array(terrainColumns*terrainRows);
  let angle: TerrainAngle | undefined;
  let basis: [number,number,number,number] = [1,0,1,0];
  const terrain: TerrainSurface = {
    element:surface,ready:false,onChange,
    project:([x,y])=>{
      if (!terrain.ready) return [x,y];
      const u = x/200+.25, v = y/200+.25;
      const [east,north,height] = [(2*u-1)*terrainAspect,1-2*v,elevationAt(u,v)];
      const [cx,sx,cy,sy] = basis;
      const rotated = sx*east+cx*north;
      return [50+(cx*east-sx*north)/terrainAspect*100,50-(rotated*cy+height*sy)*100];
    },
    orient:([azimuth,tilt])=>{
      if (angle?.[0] === azimuth && angle[1] === tilt) return;
      angle = [azimuth,tilt];
      const yaw = azimuth*Math.PI/180, pitch = tilt*Math.PI/180;
      basis = [Math.cos(yaw),Math.sin(yaw),Math.cos(pitch),Math.sin(pitch)];
      if (terrain.ready) draw();
    },
  };
  terrainSurface = terrain;

  function elevationAt(u:number,v:number) {
    const x = Math.max(0,Math.min(terrainColumns-1,u*(terrainColumns-1)));
    const y = Math.max(0,Math.min(terrainRows-1,v*(terrainRows-1)));
    const col = Math.min(terrainColumns-2,Math.floor(x));
    const row = Math.min(terrainRows-2,Math.floor(y));
    const tx = x-col, ty = y-row, i = row*terrainColumns+col;
    const a = elevations[i], b = elevations[i+1], c = elevations[i+terrainColumns], d = elevations[i+terrainColumns+1];
    return tx+ty <= 1 ? a+(b-a)*tx+(c-a)*ty : d+(c-d)*(1-tx)+(b-d)*(1-ty);
  }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {alpha:true, antialias:true, preserveDrawingBuffer:true});
  if (!gl) return terrain;
  const vertexSource = `
    attribute vec3 point;
    uniform vec4 orientation;
    varying vec2 uv;
    void main() {
      uv = (point.xy - 0.5) * vec2(${textureScale.join(',')}) + 0.5;
      vec2 ground = vec2((point.x * 2.0 - 1.0) * ${terrainAspect}, 1.0 - point.y * 2.0);
      float east = dot(ground, vec2(orientation.x, -orientation.y));
      float north = dot(ground, vec2(orientation.y, orientation.x));
      gl_Position = vec4(east / ${terrainAspect}, north * orientation.z + point.z * orientation.w,
        (north * orientation.w - point.z * orientation.z) * 0.25, 1.0);
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
  function compile(context:WebGLRenderingContext, type:number, source:string) {
    const shader = context.createShader(type);
    if (!shader) return null;
    context.shaderSource(shader,source);
    context.compileShader(shader);
    if (context.getShaderParameter(shader,context.COMPILE_STATUS)) return shader;
    context.deleteShader(shader);
    return null;
  }
  const programLocation: { orientation: WebGLUniformLocation | null } = { orientation: null };
  const cells = (terrainColumns-1)*(terrainRows-1);
  let meshVertices: Float32Array | undefined;
  let meshIndices: Uint16Array | undefined;

  function setupProgram() {
    if (!gl || gl.isContextLost() || !meshVertices || !meshIndices || !elevation.complete || !elevation.naturalWidth) return false;
    const program = gl.createProgram();
    const vertex = compile(gl,gl.VERTEX_SHADER,vertexSource);
    const fragment = compile(gl,gl.FRAGMENT_SHADER,fragmentSource);
    if (!program || !vertex || !fragment) {
      if (vertex) gl.deleteShader(vertex);
      if (fragment) gl.deleteShader(fragment);
      if (program) gl.deleteProgram(program);
      return false;
    }
    gl.attachShader(program,vertex);
    gl.attachShader(program,fragment);
    gl.linkProgram(program);
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    if (!gl.getProgramParameter(program,gl.LINK_STATUS)) {
      gl.deleteProgram(program);
      return false;
    }
    programLocation.orientation = gl.getUniformLocation(program,'orientation');
    canvas.width = 1784;
    canvas.height = 952;
    gl.viewport(0,0,canvas.width,canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER,meshVertices,gl.STATIC_DRAW);
    const point = gl.getAttribLocation(program,'point');
    gl.enableVertexAttribArray(point);
    gl.vertexAttribPointer(point,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,gl.createBuffer());
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,meshIndices,gl.STATIC_DRAW);
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
    gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,elevation);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.uniform2f(gl.getUniformLocation(program,'sampleStep'),1/elevation.width,1/elevation.height);
    draw();
    return gl.getError() === gl.NO_ERROR;
  }

  function draw() {
    if (!gl || gl.isContextLost() || !programLocation.orientation) return;
    gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
    gl.uniform4fv(programLocation.orientation,basis);
    gl.drawElements(gl.TRIANGLES,cells*6,gl.UNSIGNED_SHORT,0);
  }

  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault();
    terrain.ready = false;
    terrain.lost = true;
    surface.classList.remove('is-relief');
    surface.style.backgroundImage = `url(${mediaAssets.terrain})`;
    canvas.hidden = true;
    if (terrainSurface === terrain) terrainSurface = undefined;
    terrain.onChange();
  });
  canvas.addEventListener('webglcontextrestored', () => {
    if (!setupProgram()) return;
    terrain.lost = false;
    terrain.ready = true;
    canvas.hidden = false;
    surface.classList.add('is-relief');
    surface.style.backgroundImage = '';
    if (!terrainSurface) terrainSurface = terrain;
    terrain.onChange();
  });
  const elevation = new Image();
  elevation.onload = () => {
    const maximum = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    if (gl.isContextLost() || Math.max(elevation.width,elevation.height) > maximum) return;
    const sampler = document.createElement('canvas');
    sampler.width = elevation.width;
    sampler.height = elevation.height;
    const samples = sampler.getContext('2d');
    if (!samples) return;
    samples.drawImage(elevation,0,0);
    const pixels = samples.getImageData(0,0,sampler.width,sampler.height).data;
    meshVertices = new Float32Array(elevations.length*3);
    meshIndices = new Uint16Array(cells*6);
    let cursor = 0;
    for (let row=0;row<terrainRows;row++) {
      const v = row/(terrainRows-1);
      const pixelY = Math.round(((v-.5)*textureScale[1]+.5)*(sampler.height-1));
      for (let col=0;col<terrainColumns;col++) {
        const u = col/(terrainColumns-1);
        const pixelX = Math.round(((u-.5)*textureScale[0]+.5)*(sampler.width-1));
        const index = row*terrainColumns+col;
        const offset = (pixelY*sampler.width+pixelX)*4;
        const z = Math.max(0,pixels[offset]*256+pixels[offset+1]-2048)/18800;
        elevations[index] = z;
        meshVertices.set([u,v,z],index*3);
        if (row < terrainRows-1 && col < terrainColumns-1) {
          const lower = index+terrainColumns;
          meshIndices.set([index,index+1,lower,index+1,lower+1,lower],cursor);
          cursor += 6;
        }
      }
    }
    if (!setupProgram()) return;
    terrain.ready = true;
    surface.classList.add('is-relief');
    surface.style.backgroundImage = '';
    surface.append(canvas);
    terrain.onChange();
  };
  elevation.src = mediaAssets.elevation;
  return terrain;
}
