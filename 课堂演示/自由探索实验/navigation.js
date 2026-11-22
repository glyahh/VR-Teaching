import { obstacles, scale } from './world.js';

export function canStand(x, z, margin = 0.231) {
  return x >= scale.left + margin && x <= scale.right - margin &&
    z >= scale.back + margin && z <= scale.front - margin &&
    !obstacles.some(([left, right, back, front]) =>
      x > left - margin && x < right + margin && z > back - margin && z < front + margin);
}

export function slide(position, dx, dz) {
  if (canStand(position.x + dx, position.y)) position.x += dx;
  if (canStand(position.x, position.y + dz)) position.y += dz;
}

