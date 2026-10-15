import assert from 'node:assert/strict';
import { pushOut, pushOutBoxes, pushOutDiscs } from './collision';

const min = 0.8;
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

// no overlap: unchanged
assert.deepEqual(pushOut(5, 5, [{ x: 0, z: 0 }], min), { x: 5, z: 5 });
// overlap: pushed out to exactly min distance along the line of centres
const a = pushOut(0.3, 0, [{ x: 0, z: 0 }], min);
assert.ok(Math.abs(dist(a, { x: 0, z: 0 }) - min) < 1e-9 && a.z === 0 && a.x > 0);
// exactly on top: still separated
assert.ok(dist(pushOut(2, 2, [{ x: 2, z: 2 }], min), { x: 2, z: 2 }) >= min - 1e-9);
// walking into a player diagonally slides rather than sticks
const s = pushOut(0.5, 0.5, [{ x: 0, z: 0 }], min);
assert.ok(dist(s, { x: 0, z: 0 }) >= min - 1e-9 && s.x > 0.5 && s.z > 0.5);
// two neighbours: ends up clear of both
const two = [{ x: 0, z: 0 }, { x: 1.2, z: 0 }];
const p = pushOut(0.6, 0.1, two, min);
assert.ok(two.every((o) => dist(p, o) >= min - 1e-3));

// boxes: outside overlap is pushed out to the radius, inside is ejected through the nearest face
const box = { minX: 0, maxX: 10, minZ: 0, maxZ: 2 };
const out = pushOutBoxes(5, 2.1, [box], 0.4);
assert.ok(Math.abs(out.z - 2.4) < 1e-9 && out.x === 5);
const inside = pushOutBoxes(5, 1.7, [box], 0.4);
assert.ok(Math.abs(inside.z - 2.4) < 1e-9);
assert.deepEqual(pushOutBoxes(5, 5, [box], 0.4), { x: 5, z: 5 });
const corner = pushOutBoxes(-0.1, -0.1, [box], 0.4);
assert.ok(Math.hypot(corner.x - 0, corner.z - 0) >= 0.4 - 1e-9);
// discs
const d = pushOutDiscs(3, 0, [{ x: 0, z: 0, r: 4 }], 0.4);
assert.ok(Math.abs(Math.hypot(d.x, d.z) - 4.4) < 1e-9);
assert.deepEqual(pushOutDiscs(10, 0, [{ x: 0, z: 0, r: 4 }], 0.4), { x: 10, z: 0 });
console.log('collision tests passed');
