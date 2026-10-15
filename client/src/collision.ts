export interface Circle {
  x: number;
  z: number;
}

/**
 * Push a circle at (x, z) out of every other circle it overlaps so centres stay at least
 * `minDist` apart. A few relaxation passes settle the case of being squeezed between several players.
 */
export function pushOut(x: number, z: number, others: Iterable<Circle>, minDist: number): Circle {
  const list = [...others];
  for (let pass = 0; pass < 8; pass++) {
    let moved = false;
    for (const o of list) {
      const dx = x - o.x;
      const dz = z - o.z;
      const d = Math.hypot(dx, dz);
      if (d >= minDist) continue;
      if (d < 1e-6) {
        x += minDist; // exactly on top of each other: pick an arbitrary direction
        moved = true;
        continue;
      }
      const k = (minDist - d) / d;
      x += dx * k;
      z += dz * k;
      moved = true;
    }
    if (!moved) break;
  }
  return { x, z };
}
