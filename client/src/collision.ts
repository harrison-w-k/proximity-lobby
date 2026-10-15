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

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Disc {
  x: number;
  z: number;
  r: number;
}

/** Push a circle of `radius` at (x, z) out of any axis-aligned boxes it overlaps. */
export function pushOutBoxes(x: number, z: number, boxes: Iterable<Box>, radius: number): Circle {
  for (const b of boxes) {
    const cx = Math.max(b.minX, Math.min(b.maxX, x));
    const cz = Math.max(b.minZ, Math.min(b.maxZ, z));
    const dx = x - cx;
    const dz = z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= radius * radius) continue;
    if (d2 > 1e-12) {
      const k = radius / Math.sqrt(d2);
      x = cx + dx * k;
      z = cz + dz * k;
    } else {
      // centre is inside the box: leave through the nearest face
      const l = x - b.minX;
      const r = b.maxX - x;
      const t = z - b.minZ;
      const u = b.maxZ - z;
      const m = Math.min(l, r, t, u);
      if (m === l) x = b.minX - radius;
      else if (m === r) x = b.maxX + radius;
      else if (m === t) z = b.minZ - radius;
      else z = b.maxZ + radius;
    }
  }
  return { x, z };
}

/** Push a circle of `radius` at (x, z) out of any solid discs (pillars, round tanks). */
export function pushOutDiscs(x: number, z: number, discs: Iterable<Disc>, radius: number): Circle {
  for (const d of discs) {
    const dx = x - d.x;
    const dz = z - d.z;
    const dist = Math.hypot(dx, dz);
    const min = d.r + radius;
    if (dist >= min) continue;
    if (dist < 1e-6) {
      x += min;
      continue;
    }
    const k = min / dist;
    x = d.x + dx * k;
    z = d.z + dz * k;
  }
  return { x, z };
}
