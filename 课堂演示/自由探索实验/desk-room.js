import * as THREE from 'three';
import { loadModel } from './packed-model.js';

const blenderToWorld = new THREE.Matrix4().makeRotationX(-Math.PI / 2);
const worldToBlender = blenderToWorld.clone().invert();

const vertex = `
  uniform mat4 photoViews[3];
  varying vec4 photoPoints[3];
  varying vec3 roomPoint, roomColor;
  void main() {
    vec4 point = modelMatrix * vec4(position, 1.);
    roomPoint = point.xyz;
    roomColor = color;
    for (int i = 0; i < 3; i++) photoPoints[i] = photoViews[i] * point;
    gl_Position = projectionMatrix * viewMatrix * point;
  }
`;

const fragment = `
  uniform sampler2D frontPhoto, leftPhoto, rightPhoto, frontDepth, leftDepth, rightDepth;
  uniform vec3 photoEyes[3], weights, locks;
  uniform vec2 depthSize;
  uniform int exactView;
  varying vec4 photoPoints[3];
  varying vec3 roomPoint, roomColor;

  void blendPhoto(sampler2D image, sampler2D depth, vec4 clip, vec3 eye,
      vec3 normal, float weight, float locked, inout vec3 sum, inout float total, inout float coverage) {
    vec3 point = clip.xyz / clip.w * .5 + .5;
    vec3 dx = dFdx(point), dy = dFdy(point);
    float edge = min(min(point.x, point.y), min(1. - point.x, 1. - point.y));
    if (clip.w <= 0. || edge <= 0.) return;
    vec2 pixel = point.xy * depthSize - .5;
    vec2 center = floor(pixel);
    vec2 fraction = fract(pixel);
    float det = dx.x * dy.y - dx.y * dy.x;
    vec2 slope = abs(det) < 1.e-13 ? vec2(0.) :
      vec2(dx.z * dy.y - dy.z * dx.y, dx.x * dy.z - dy.x * dx.z) / (det * depthSize);
    float bias = .000004 + .000025 / (clip.w * clip.w);
    float visible = 0., clearEdge = 1.;
    for (int y = 0; y <= 1; y++) {
      for (int x = 0; x <= 1; x++) {
        vec2 offset = vec2(float(x), float(y));
        vec2 centerUV = (center + offset + .5) / depthSize;
        float z = point.z + dot(slope, offset - fraction) - bias;
        vec2 influence = 1. - abs(offset - fraction);
        visible += influence.x * influence.y * step(z, texture2D(depth, centerUV).r);
        vec2 guard = offset * 3. - 1.;
        vec2 guardUV = (center + guard + .5) / depthSize;
        float guardZ = point.z + dot(slope, guard - fraction) - bias;
        clearEdge = min(clearEdge, step(guardZ, texture2D(depth, guardUV).r));
      }
    }
    float facing = smoothstep(-.015, .14, dot(normal, normalize(eye - roomPoint)));
    float valid = mix(smoothstep(.12, .92, visible) * facing * smoothstep(0., .012, edge), 1., locked);
    float score = valid * weight * mix(.035, 1., max(clearEdge, locked));
    sum += score * textureGrad(image, point.xy, dx.xy, dy.xy).rgb;
    total += score;
    coverage = max(coverage, valid);
  }

  void main() {
    if (exactView == 0) {
      gl_FragColor = vec4(texture2D(frontPhoto, photoPoints[0].xy / photoPoints[0].w * .5 + .5).rgb, 1.);
    } else {
      vec3 normal = normalize(cross(dFdx(roomPoint), dFdy(roomPoint)));
      if (dot(normal, cameraPosition - roomPoint) < 0.) normal = -normal;
      vec3 sum = vec3(0.);
      float total = 0., coverage = 0.;
      blendPhoto(frontPhoto, frontDepth, photoPoints[0], photoEyes[0], normal, weights.x, locks.x, sum, total, coverage);
      blendPhoto(leftPhoto, leftDepth, photoPoints[1], photoEyes[1], normal, weights.y, locks.y, sum, total, coverage);
      blendPhoto(rightPhoto, rightDepth, photoPoints[2], photoEyes[2], normal, weights.z, locks.z, sum, total, coverage);
      vec3 linearColor = pow(roomColor, vec3(2.2));
      gl_FragColor = vec4(mix(linearColor, sum / max(total, 1.e-12), smoothstep(.015, .45, coverage)), 1.);
    }
    #include <colorspace_fragment>
  }
`;

function referenceCamera(vp) {
  const camera = new THREE.Camera();
  camera.projectionMatrix.copy(vp);
  camera.projectionMatrixInverse.copy(vp).invert();
  return camera;
}

function loadPhoto(loader, source) {
  return loader.loadAsync(source).then(texture => {
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  });
}

export async function createDeskRoom(renderer, assets, manifest) {
  const loader = new THREE.TextureLoader();
  const [room, front, left, right] = await Promise.all([
    loadModel(assets['desk-world']),
    ...['front', 'left', 'right'].map(name => loadPhoto(loader, assets['desk-world-' + name])),
  ]);
  const photos = [front, left, right];
  const refMatrices = manifest.views.map(view => new THREE.Matrix4().fromArray(view.vp).multiply(worldToBlender));
  const photoEyes = manifest.views.map(view => new THREE.Vector3().fromArray(view.eye).applyMatrix4(blenderToWorld));
  const depthSize = new THREE.Vector2(1152, 648);
  const depthMaterial = new THREE.MeshDepthMaterial({side: THREE.DoubleSide, colorWrite: false});
  const meshes = [];
  room.traverse(obj => {
    if (!obj.isMesh) return;
    obj.material.dispose();
    obj.material = depthMaterial;
    obj.frustumCulled = false;
    meshes.push(obj);
  });

  const scene = new THREE.Scene();
  scene.add(room);
  const targets = refMatrices.map(vp => {
    const depthTexture = new THREE.DepthTexture(depthSize.x, depthSize.y, THREE.UnsignedIntType);
    depthTexture.minFilter = depthTexture.magFilter = THREE.NearestFilter;
    const target = new THREE.WebGLRenderTarget(depthSize.x, depthSize.y, {depthTexture});
    renderer.setRenderTarget(target);
    renderer.render(scene, referenceCamera(vp));
    return target;
  });
  renderer.setRenderTarget(null);
  scene.remove(room);
  depthMaterial.dispose();

  const uniforms = {
    frontPhoto: {value: front}, leftPhoto: {value: left}, rightPhoto: {value: right},
    frontDepth: {value: targets[0].depthTexture},
    leftDepth: {value: targets[1].depthTexture},
    rightDepth: {value: targets[2].depthTexture},
    photoViews: {value: refMatrices}, photoEyes: {value: photoEyes}, depthSize: {value: depthSize},
    weights: {value: new THREE.Vector3()}, locks: {value: new THREE.Vector3()}, exactView: {value: -1},
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: vertex, fragmentShader: fragment,
    side: THREE.DoubleSide, vertexColors: true, toneMapped: false,
  });
  for (const mesh of meshes) mesh.material = material;

  return {
    room,
    update(eye) {
      for (let i = 0; i < photoEyes.length; i++) {
        const distance = photoEyes[i].distanceTo(eye);
        uniforms.weights.value.setComponent(i, 1 / Math.max(.00001, distance * distance));
        uniforms.locks.value.setComponent(i, Math.max(0, 1 - distance / .018));
      }
      uniforms.exactView.value = eye.distanceTo(photoEyes[0]) < .00001 ? 0 : -1;
    },
    dispose() {
      for (const mesh of meshes) mesh.geometry.dispose();
      for (const target of targets) target.dispose();
      for (const photo of photos) photo.dispose();
      material.dispose();
    },
  };
}

export function createDeskCamera(manifest) {
  const camera = new THREE.PerspectiveCamera();
  const rotation = new THREE.Matrix4().fromArray(manifest.cameraWorld).premultiply(blenderToWorld);
  const rest = new THREE.Vector3().setFromMatrixPosition(rotation);
  const restDirection = new THREE.Quaternion().setFromRotationMatrix(rotation);
  const pivot = new THREE.Vector3().fromArray(manifest.pivot).applyMatrix4(blenderToWorld);
  const horizontal = new THREE.Vector3().setFromMatrixColumn(rotation, 0);
  horizontal.y = 0;
  horizontal.normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const tilt = new THREE.Quaternion(), yaw = new THREE.Quaternion();
  const offset = new THREE.Vector3(), target = new THREE.Vector3();
  const move = new THREE.Vector3();
  const baseAspect = manifest.size[0] / manifest.size[1];

  function resize(aspect) {
    camera.projectionMatrix.fromArray(manifest.projection);
    camera.projectionMatrix.elements[0] *= Math.max(1, baseAspect / aspect);
    camera.projectionMatrix.elements[5] *= Math.max(1, aspect / baseAspect);
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
  }
  resize(baseAspect);
  return {
    camera, resize,
    set(pose, inspection) {
      tilt.setFromAxisAngle(horizontal, THREE.MathUtils.degToRad(-pose.pitch));
      yaw.setFromAxisAngle(up, THREE.MathUtils.degToRad(pose.yaw)).multiply(tilt);
      offset.subVectors(rest, pivot).applyQuaternion(yaw).divideScalar(pose.zoom);
      camera.position.copy(pivot).add(offset);
      camera.quaternion.copy(yaw).multiply(restDirection);
      if (inspection) {
        const fraction = .60;
        target.set(inspection.x, .80, inspection.z);
        move.subVectors(target, pivot).multiplyScalar(.86);
        camera.position.copy(pivot).addScaledVector(offset, fraction).add(move);
        camera.lookAt(pivot.clone().add(move));
      }
      camera.updateMatrixWorld(true);
    },
  };
}
