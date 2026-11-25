import * as THREE from 'three';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const roles = [
  ['#aa8662', '#847060', '#83725e'],
  ['#788d80', '#667264', '#807364'],
  ['#727972', '#7b7460', '#999282'],
];
const up = new THREE.Vector3(0, 1, 0);

function position(object) {
  return object.getWorldPosition(new THREE.Vector3());
}

function setWorldRotation(bone, rotation) {
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(rotation));
  bone.updateWorldMatrix(false, true);
}

function aim(bone, child, target) {
  const from = position(bone);
  const oldDirection = position(child).sub(from).normalize();
  const direction = target.clone().sub(from).normalize();
  const rotation = new THREE.Quaternion().setFromUnitVectors(oldDirection, direction)
    .multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  setWorldRotation(bone, rotation);
}

// 用两段骨长求肘或膝的位置，握点和踏点取河岸模型的实际坐标。
function reach(upper, lower, end, target, bend) {
  const origin = position(upper);
  const left = position(lower).distanceTo(origin);
  const right = position(end).distanceTo(position(lower));
  const direction = target.clone().sub(origin);
  const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(left - right) + 0.001, left + right - 0.001);
  direction.normalize();
  const along = (left * left + distance * distance - right * right) / (2 * distance);
  let side = bend.clone().addScaledVector(direction, -bend.dot(direction));
  if (side.lengthSq() < 0.00001) side = up.clone().addScaledVector(direction, -up.dot(direction));
  side.normalize();
  const hinge = origin.clone().addScaledVector(direction, along)
    .addScaledVector(side, Math.sqrt(Math.max(0, left * left - along * along)));
  aim(upper, lower, hinge);
  aim(lower, end, origin.addScaledVector(direction, distance));
}

export function createWorkers(scene, source, count) {
  const people = Array.from({ length: count }, (_, index) => {
    const model = clone(source);
    const bones = new Map();
    model.traverse(object => {
      if (object.isBone) bones.set(object.name, object);
      if (!object.isMesh) return;
      object.castShadow = object.receiveShadow = true;
      object.frustumCulled = false;
      const hue = roles[index % roles.length];
      const material = object.material;
      const slot = ['上衣', '长裤', '布帽'].findIndex(part => material.name.startsWith(part));
      if (slot >= 0) {
        object.material = material.clone();
        object.material.color.multiply(new THREE.Color(hue[slot]).multiplyScalar(1.85));
      }
    });
    const rest = [...bones.values()].map(bone => [bone, bone.position.clone(), bone.quaternion.clone()]);
    const pelvis = bones.get('pelvis');
    const spine = bones.get('spine_01');
    const sides = ['l', 'r'].map(side => Object.fromEntries([
      'upperarm', 'lowerarm', 'hand', 'middle_01', 'thigh', 'calf', 'foot',
    ].map(name => [name, bones.get(name + '_' + side)])));
    if (!pelvis || !spine || sides.some(side => Object.values(side).some(bone => !bone))) {
      throw new Error('于都人物骨架缺少动作骨骼');
    }
    const group = new THREE.Group();
    group.add(model);
    group.visible = false;
    scene.add(group);
    return { group, rest, pelvis, spine, sides };
  });

  function put(index, x, z, y, { yaw, grips, stepClock = 0, footing, pole = false,
    release = 0, stanceEdge = -Infinity }) {
    const { group, rest, pelvis, spine, sides } = people[index];
    for (const [bone, offset, rotation] of rest) {
      bone.position.copy(offset);
      bone.quaternion.copy(rotation);
    }
    group.position.set(x, y, z);
    group.rotation.y = yaw;
    group.updateMatrixWorld(true);
    const forward = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const low = Math.min(...grips.map(p => p.y)) - y;
    const crouch = pole ? 0.105 : (0.21 + 0.575 * (1 - THREE.MathUtils.smoothstep(low, 0.03, 0.82))) * (1 - release);
    const hip = position(pelvis).add(new THREE.Vector3(0, -crouch, 0))
      .addScaledVector(forward, -crouch * 0.19);
    pelvis.position.copy(pelvis.parent.worldToLocal(hip));
    pelvis.updateWorldMatrix(false, true);
    const pitch = 0.08 + 1.04 * (crouch / 0.785);
    const lean = new THREE.Quaternion().setFromAxisAngle(right, pitch)
      .multiply(spine.getWorldQuaternion(new THREE.Quaternion()));
    setWorldRotation(spine, lean);

    for (const [side, chain] of sides.entries()) {
      const sign = side ? -1 : 1;
      const stride = stepClock ? Math.sin(stepClock * 13 + index * 0.74) * sign : 0;
      const ankle = group.position.clone().addScaledVector(right, sign * 0.12)
        .addScaledVector(forward, stride * 0.100 - 0.019);
      ankle.z = Math.max(stanceEdge + 0.026, ankle.z);
      ankle.y = footing(ankle.x, ankle.z) + 0.069 + Math.max(0, stride) * 0.075;
      const footRotation = chain.foot.getWorldQuaternion(new THREE.Quaternion());
      reach(chain.thigh, chain.calf, chain.foot, ankle, forward);
      setWorldRotation(chain.foot, footRotation);

      const palm = grips[side];
      const palmLength = position(chain.middle_01).distanceTo(position(chain.hand));
      const handDirection = forward.clone().addScaledVector(up, pole ? -0.17 : 0.12).normalize();
      const wrist = palm.clone().addScaledVector(handDirection, -palmLength);
      const elbow = new THREE.Vector3(0, -1, 0).addScaledVector(right, 0.46 * sign);
      reach(chain.upperarm, chain.lowerarm, chain.hand, wrist, elbow);
      aim(chain.hand, chain.middle_01, palm);
    }
  }

  return {
    put,
    show(visible) { people.forEach(({ group }, index) => { group.visible = index < visible; }); },
  };
}

function bakedGeometry(root) {
  const all = [];
  root.updateWorldMatrix(true, true);
  root.traverse(object => {
    if (!object.isMesh) return;
    const geom = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
    geom.applyMatrix4(object.matrixWorld);
    for (const attr of Object.keys(geom.attributes)) {
      if (attr !== 'position' && attr !== 'normal') geom.deleteAttribute(attr);
    }
    const color = object.material.color;
    const rgb = new Float32Array(geom.attributes.position.count * 3);
    for (let i = 0; i < rgb.length; i += 3) {
      rgb[i] = color.r;
      rgb[i + 1] = color.g;
      rgb[i + 2] = color.b;
    }
    geom.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
    all.push(geom);
  });
  return mergeGeometries(all);
}

export function createCrowd(scene, source, maxCount) {
  const coat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  const poses = ['idle', 'walk-0', 'walk-1', 'walk-2', 'walk-3'].map(name => {
    const model = source.getObjectByName(name);
    if (!model) throw new Error('于都远景缺少姿态 ' + name);
    const batch = new THREE.InstancedMesh(bakedGeometry(model), coat, maxCount);
    batch.count = 0;
    batch.frustumCulled = false;
    batch.receiveShadow = true;
    batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(batch);
    return batch;
  });
  const entity = new THREE.Object3D();
  const shades = [0xb1b5ae, 0xa7aaa0, 0xbab197, 0xaab3a9, 0xb6af9d].map(hex => new THREE.Color(hex));

  return {
    show() { poses.forEach(batch => { batch.count = 0; }); },
    put(index, x, z, ground, time, yaw = Math.PI) {
      const frame = time ? 1 + Math.floor((time * 6.8 + index * 0.71) % 4) : 0;
      const batch = poses[frame];
      const item = batch.count++;
      entity.position.set(x, ground(x, z), z);
      entity.rotation.y = yaw + (index % 3 - 1) * 0.082;
      entity.updateMatrix();
      batch.setMatrixAt(item, entity.matrix);
      batch.setColorAt(item, shades[index % shades.length]);
    },
    update() {
      for (const batch of poses) {
        batch.instanceMatrix.needsUpdate = true;
        if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
      }
    },
  };
}
