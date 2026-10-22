// The procedural map. Built from a seed, identically on the server and on every client, so the
// terrain never travels over the network (see "Procedural maps" in the design doc).
import { fbm, mulberry32 } from './rng';

export const MAP_RADIUS = 350; // m: a 700 m x 700 m map, with lava closing in from the edge
export const CELL = 2.5; // m per height-grid cell
const GRID = Math.ceil((MAP_RADIUS * 2) / CELL) + 1;
export const WATER_Y = 0;
export const DEEP_Y = -1.2; // below this you swim

export const Biome = { Forest: 0, Wetlands: 1, Grassland: 2, Highlands: 3 } as const;
export type Biome = (typeof Biome)[keyof typeof Biome];
export const BIOME_NAMES = ['Forest', 'Wetlands', 'Grassland', 'Highlands'] as const;

export type ResKind = 'tree' | 'pine' | 'stone' | 'bush' | 'rock' | 'berry' | 'herb' | 'mud' | 'hive' | 'reed' | 'fruit';
export interface Res {
  id: number;
  kind: ResKind;
  x: number;
  z: number;
  s: number; // scale
  r: number; // collision radius (0 = walk-through)
  h: number; // how tall it is: you can jump over anything lower than your jump
}

export interface SpawnPoint {
  x: number;
  z: number;
}

export class Terrain {
  readonly seed: number;
  private h = new Float32Array(GRID * GRID);
  private b = new Uint8Array(GRID * GRID);
  private grass = new Uint8Array(GRID * GRID); // 1 = long grass (slows you)
  res: Res[] = [];
  spawns: SpawnPoint[] = [];
  private cellsOfRes = new Map<number, number[]>();
  readonly attempt: number;

  constructor(seed: number) {
    this.seed = seed | 0;
    let attempt = 0;
    for (;; attempt++) {
      this.fill(this.seed + attempt * 7919);
      if (this.connected() || attempt > 8) break;
    }
    this.attempt = attempt;
    this.place(this.seed + attempt * 7919);
    this.pickSpawns(this.seed + attempt * 7919);
  }

  private idx(gx: number, gz: number) {
    return gz * GRID + gx;
  }

  private fill(seed: number) {
    for (let gz = 0; gz < GRID; gz++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x = gx * CELL - MAP_RADIUS;
        const z = gz * CELL - MAP_RADIUS;
        const i = this.idx(gx, gz);
        const r = Math.hypot(x, z);
        const elev = fbm(x / 170 + 10, z / 170 + 10, seed + 1, 4); // 0..1
        const moist = fbm(x / 140 + 50, z / 140 - 30, seed + 2, 3);
        const tree = fbm(x / 110 - 20, z / 110 + 70, seed + 3, 3);
        const detail = fbm(x / 22, z / 22, seed + 4, 3);
        // highlands rise where the elevation noise is high
        let hgt = 1.5 + (elev - 0.45) * 5 + detail * 1.4;
        const high = Math.max(0, elev - 0.6) / 0.4;
        hgt += high * high * 30 + Math.max(0, elev - 0.6) * 16;
        // wetlands: a wet, low area is carved into lakes
        const wet = moist > 0.58 && elev < 0.6 && r > 55 ? Math.min(1, (moist - 0.58) / 0.15) : 0;
        hgt -= wet * 9 * Math.min(1, wet * 3);
        // the centre: a flat clearing around the Alpha den with the watering hole in it
        const centre = Math.max(0, 1 - r / 55);
        hgt = hgt * (1 - centre * 0.85) + 1.6 * centre * 0.85;
        const pond = Math.max(0, 1 - r / 15);
        hgt -= pond * pond * 4.2;
        // the rim sinks a little so the lava has somewhere to sit
        if (r > MAP_RADIUS - 14) hgt -= ((r - (MAP_RADIUS - 14)) / 14) * 3;
        this.h[i] = hgt;
        let bio: Biome;
        if (elev > 0.6) bio = Biome.Highlands;
        else if (moist > 0.58) bio = Biome.Wetlands;
        else if (tree > 0.47) bio = Biome.Forest;
        else bio = Biome.Grassland;
        if (r < 55 && bio !== Biome.Wetlands) bio = Biome.Grassland;
        this.b[i] = bio;
        this.grass[i] = bio === Biome.Grassland && detail > 0.55 ? 1 : 0;
      }
    }
  }

  /** At least 85% of the walkable ground must be one connected piece. */
  private connected(): boolean {
    const step = 2;
    const n = Math.floor(GRID / step);
    const ok = (gx: number, gz: number) => {
      const x = gx * step * CELL - MAP_RADIUS;
      const z = gz * step * CELL - MAP_RADIUS;
      return Math.hypot(x, z) < MAP_RADIUS - 20 && this.h[this.idx(gx * step, gz * step)] > DEEP_Y;
    };
    const seen = new Uint8Array(n * n);
    let total = 0;
    for (let gz = 0; gz < n; gz++) for (let gx = 0; gx < n; gx++) if (ok(gx, gz)) total++;
    let best = 0;
    const dirs = [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (let gz = 0; gz < n; gz++) {
      for (let gx = 0; gx < n; gx++) {
        if (!ok(gx, gz) || seen[gz * n + gx]) continue;
        let size = 0;
        const stack = [gz * n + gx];
        seen[gz * n + gx] = 1;
        while (stack.length) {
          const c = stack.pop()!;
          size++;
          const cx = c % n;
          const cz = (c - cx) / n;
          for (const [dx, dz] of dirs) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= n || nz >= n || seen[nz * n + nx] || !ok(nx, nz)) continue;
            seen[nz * n + nx] = 1;
            stack.push(nz * n + nx);
          }
        }
        best = Math.max(best, size);
      }
    }
    return total > 0 && best / total >= 0.85;
  }

  private gridPos(x: number, z: number): [number, number, number, number] {
    const fx = Math.min(GRID - 1.001, Math.max(0, (x + MAP_RADIUS) / CELL));
    const fz = Math.min(GRID - 1.001, Math.max(0, (z + MAP_RADIUS) / CELL));
    const gx = Math.floor(fx);
    const gz = Math.floor(fz);
    return [gx, gz, fx - gx, fz - gz];
  }

  /** Ground height (m) at a point; below WATER_Y is lake bed. */
  heightAt(x: number, z: number): number {
    const [gx, gz, tx, tz] = this.gridPos(x, z);
    const i = this.idx(gx, gz);
    const a = this.h[i];
    const b = this.h[i + 1];
    const c = this.h[i + GRID];
    const d = this.h[i + GRID + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  biomeAt(x: number, z: number): Biome {
    const [gx, gz, tx, tz] = this.gridPos(x, z);
    return this.b[this.idx(gx + (tx > 0.5 ? 1 : 0), gz + (tz > 0.5 ? 1 : 0))] as Biome;
  }

  /** Long grass slows you down. */
  tallGrass(x: number, z: number): boolean {
    const [gx, gz] = this.gridPos(x, z);
    return this.grass[this.idx(gx, gz)] === 1;
  }

  /** Water depth (m) at a point: 0 on land. */
  depthAt(x: number, z: number): number {
    return Math.max(0, WATER_Y - this.heightAt(x, z));
  }
  isWater(x: number, z: number) {
    return this.heightAt(x, z) < WATER_Y - 0.05;
  }
  isDeep(x: number, z: number) {
    return this.heightAt(x, z) < DEEP_Y;
  }
  /** True if standing here you are hidden in a bush. */
  inBush(x: number, z: number): boolean {
    for (const r of this.near(x, z, 2)) if (r.kind === 'bush' && Math.hypot(r.x - x, r.z - z) < r.s * 1.1) return true;
    return false;
  }

  // --- resources ---------------------------------------------------------------------------

  private key(cx: number, cz: number) {
    return (cx + 200) * 1000 + (cz + 200);
  }

  private addRes(r: Res) {
    this.res.push(r);
    const k = this.key(Math.floor(r.x / 8), Math.floor(r.z / 8));
    const list = this.cellsOfRes.get(k);
    if (list) list.push(r.id);
    else this.cellsOfRes.set(k, [r.id]);
  }

  /** Resources within `range` m of a point. */
  near(x: number, z: number, range: number): Res[] {
    const out: Res[] = [];
    const c0x = Math.floor((x - range - 4) / 8);
    const c1x = Math.floor((x + range + 4) / 8);
    const c0z = Math.floor((z - range - 4) / 8);
    const c1z = Math.floor((z + range + 4) / 8);
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cz = c0z; cz <= c1z; cz++) {
        const list = this.cellsOfRes.get(this.key(cx, cz));
        if (!list) continue;
        for (const id of list) {
          const r = this.res[id];
          if (Math.abs(r.x - x) <= range + r.s && Math.abs(r.z - z) <= range + r.s) out.push(r);
        }
      }
    }
    return out;
  }

  /**
   * How high (above the ground) the top of the rock under you is, if you can stand on it: 0 if none.
   * A rock counts when its top is no more than a small step above your feet, so you land on one by jumping onto it.
   */
  floorAt(x: number, z: number, feet: number): number {
    let best = 0;
    for (const r of this.near(x, z, 3)) {
      if (r.r <= 0 || r.h < 0.15 || r.h > feet + 0.35) continue;
      if (Math.hypot(x - r.x, z - r.z) < r.r * 0.95 && r.h > best) best = r.h;
    }
    return best;
  }

  /** Push a circle out of trees and rocks. Returns the corrected position. */
  collide(x: number, z: number, radius: number, feet = 0): { x: number; z: number; hit: boolean } {
    let hit = false;
    for (const r of this.near(x, z, radius + 3)) {
      if (r.r <= 0) continue;
      if (feet > 0 && feet >= r.h - 0.12) continue; // hopping over a low rock
      const dx = x - r.x;
      const dz = z - r.z;
      const d = Math.hypot(dx, dz);
      const min = r.r + radius;
      if (d < min) {
        hit = true;
        if (d < 1e-4) x += min;
        else {
          x = r.x + (dx / d) * min;
          z = r.z + (dz / d) * min;
        }
      }
    }
    return { x, z, hit };
  }

  /** Does a straight line pass through a tree or rock? (trees block line of sight) */
  blocked(ax: number, az: number, bx: number, bz: number): boolean {
    const len = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(len / 3);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t;
      const z = az + (bz - az) * t;
      for (const r of this.near(x, z, 1)) {
        if (r.r > 0.4 && r.h > 1.6 && Math.hypot(r.x - x, r.z - z) < r.r) return true;
      }
    }
    return false;
  }

  private place(seed: number) {
    const rnd = mulberry32(seed ^ 0x51ed);
    const R = MAP_RADIUS - 18;
    type Layer = { kind: ResKind; spacing: number; tries: number; want: (b: Biome) => number; size: [number, number]; solid: number };
    const layers: Layer[] = [
      { kind: 'tree', spacing: 8.5, tries: 40000, want: (b) => (b === Biome.Forest ? 1 : b === Biome.Grassland ? 0.07 : b === Biome.Wetlands ? 0.12 : 0), size: [1.0, 1.7], solid: 0.4 },
      { kind: 'pine', spacing: 9.5, tries: 30000, want: (b) => (b === Biome.Highlands ? 0.3 : b === Biome.Forest ? 0.25 : 0), size: [1.0, 1.8], solid: 0.38 },
      { kind: 'bush', spacing: 6, tries: 30000, want: (b) => (b === Biome.Grassland ? 0.25 : b === Biome.Forest ? 0.4 : b === Biome.Wetlands ? 0.2 : 0.08), size: [0.9, 1.5], solid: 0 },
      { kind: 'stone', spacing: 6.5, tries: 30000, want: (b) => (b === Biome.Highlands ? 0.5 : b === Biome.Grassland ? 0.22 : b === Biome.Forest ? 0.2 : 0.12), size: [0.55, 1.1], solid: 0.8 },
      { kind: 'rock', spacing: 11, tries: 20000, want: (b) => (b === Biome.Highlands ? 0.9 : 0.06), size: [1.0, 3.2], solid: 0.8 },
      { kind: 'berry', spacing: 22, tries: 6000, want: (b) => (b === Biome.Forest || b === Biome.Grassland ? 0.9 : 0.2), size: [1, 1], solid: 0 },
      { kind: 'fruit', spacing: 40, tries: 3000, want: (b) => (b === Biome.Forest ? 0.9 : b === Biome.Grassland ? 0.3 : 0), size: [1.4, 1.8], solid: 0.6 },
      { kind: 'herb', spacing: 26, tries: 5000, want: (b) => (b === Biome.Forest || b === Biome.Wetlands ? 0.9 : 0.1), size: [1, 1], solid: 0 },
      { kind: 'hive', spacing: 70, tries: 3000, want: (b) => (b === Biome.Forest ? 1 : 0), size: [1.6, 2], solid: 0.6 },
    ];
    for (const L of layers) {
      const cell = L.spacing;
      const grid = new Map<string, Res[]>();
      for (let t = 0; t < L.tries; t++) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(rnd()) * R;
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        if (rnd() > L.want(this.biomeAt(x, z))) continue;
        if (this.heightAt(x, z) < WATER_Y + 0.3) continue;
        if (Math.hypot(x, z) < 20 && L.kind !== 'bush' && L.kind !== 'berry') continue; // keep the den open
        const gx = Math.floor(x / cell);
        const gz = Math.floor(z / cell);
        let ok = true;
        for (let dx = -1; dx <= 1 && ok; dx++) {
          for (let dz = -1; dz <= 1 && ok; dz++) {
            for (const o of grid.get(`${gx + dx},${gz + dz}`) ?? []) {
              if (Math.hypot(o.x - x, o.z - z) < L.spacing) {
                ok = false;
                break;
              }
            }
          }
        }
        if (!ok) continue;
        const s = L.size[0] + rnd() * (L.size[1] - L.size[0]);
        const tall = L.kind === 'rock' ? s * 0.9 : L.kind === 'stone' ? s * 0.8 : 99; // trees are never hopped
        const res: Res = { id: this.res.length, kind: L.kind, x, z, s, r: L.solid * s, h: tall };
        const key = `${gx},${gz}`;
        const g = grid.get(key);
        if (g) g.push(res);
        else grid.set(key, [res]);
        this.addRes(res);
      }
    }
    // reeds and mud along the water's edge
    let reeds = 0;
    let mud = 0;
    for (let t = 0; t < 60000 && (reeds < 160 || mud < 24); t++) {
      const a = rnd() * Math.PI * 2;
      const rr = Math.sqrt(rnd()) * R;
      const x = Math.cos(a) * rr;
      const z = Math.sin(a) * rr;
      const hh = this.heightAt(x, z);
      if (hh > WATER_Y + 0.5 || hh < WATER_Y - 0.6) continue;
      if (mud < 24 && this.biomeAt(x, z) === Biome.Wetlands && hh >= WATER_Y - 0.05 && rnd() < 0.1) {
        this.addRes({ id: this.res.length, kind: 'mud', x, z, s: 1, r: 0, h: 0 });
        mud++;
      } else if (reeds < 160 && rnd() < 0.5) {
        this.addRes({ id: this.res.length, kind: 'reed', x, z, s: 0.8 + rnd() * 0.8, r: 0, h: 0 });
        reeds++;
      }
    }
  }

  private pickSpawns(seed: number) {
    const rnd = mulberry32(seed ^ 0xabc);
    const rings = [
      { r: 315, n: 12 },
      { r: 185, n: 8 },
    ];
    const spawns: SpawnPoint[] = [];
    const base = rnd() * Math.PI * 2;
    const dry = (x: number, z: number) => this.heightAt(x, z) > WATER_Y + 0.4 && !this.collide(x, z, 1.5).hit;
    for (const [ri, ring] of rings.entries()) {
      for (let i = 0; i < ring.n; i++) {
        const a = base + (i / ring.n) * Math.PI * 2 + ri * (Math.PI / ring.n);
        // look for dry ground near the ideal spot that keeps its distance from the others
        for (const gap of [120, 105, 90, 60, 0]) {
          let best: SpawnPoint | null = null;
          for (let off = 0; off < 70 && !best; off += 4) {
            for (let k = 0; k < 12 && !best; k++) {
              const ang = (k / 12) * Math.PI * 2;
              const x = Math.cos(a) * ring.r + Math.cos(ang) * off;
              const z = Math.sin(a) * ring.r + Math.sin(ang) * off;
              if (Math.hypot(x, z) > MAP_RADIUS - 25 || !dry(x, z)) continue;
              if (spawns.every((p) => Math.hypot(p.x - x, p.z - z) >= gap)) best = { x, z };
            }
          }
          if (best) {
            spawns.push(best);
            break;
          }
        }
      }
    }
    this.spawns = spawns;
  }

  /** A dry spot of the wanted biome, spaced away from the spawn points already used. */
  spawnIn(biome: Biome, taken: SpawnPoint[], rnd: () => number): SpawnPoint | null {
    const dry = (x: number, z: number) => this.heightAt(x, z) > WATER_Y + 0.4 && !this.collide(x, z, 1.5).hit;
    for (const gap of [110, 80, 55, 30, 0]) {
      for (let i = 0; i < 500; i++) {
        const a = rnd() * Math.PI * 2;
        const r = 120 + rnd() * (MAP_RADIUS - 150);
        const x = Math.cos(a) * r;
        const z = Math.sin(a) * r;
        if (this.biomeAt(x, z) !== biome || !dry(x, z)) continue;
        if (taken.every((p) => Math.hypot(p.x - x, p.z - z) >= gap)) return { x, z };
      }
    }
    return null;
  }

  /** Open water near (x, z): fish always start in a lake or river. Falls back to any water on the map. */
  findWater(x: number, z: number, rnd: () => number): { x: number; z: number } | null {
    const ok = (px: number, pz: number) => Math.hypot(px, pz) < MAP_RADIUS - 30 && this.depthAt(px, pz) > 0.8;
    for (let r = 0; r <= 160; r += 6) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2 + r;
        const px = x + Math.cos(a) * r;
        const pz = z + Math.sin(a) * r;
        if (ok(px, pz)) return { x: px, z: pz };
      }
    }
    for (let i = 0; i < 600; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * (MAP_RADIUS - 40);
      if (ok(Math.cos(a) * r, Math.sin(a) * r)) return { x: Math.cos(a) * r, z: Math.sin(a) * r };
    }
    return null;
  }

  /** A random point on dry land inside `radius`. */
  randomLand(rnd: () => number, radius: number, minRadius = 0): { x: number; z: number } {
    for (let i = 0; i < 80; i++) {
      const a = rnd() * Math.PI * 2;
      const r = minRadius + Math.sqrt(rnd()) * (radius - minRadius);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.heightAt(x, z) > WATER_Y + 0.3 && !this.collide(x, z, 0.8).hit) return { x, z };
    }
    return { x: 0, z: 8 };
  }
  randomWater(rnd: () => number, radius: number): { x: number; z: number } | null {
    for (let i = 0; i < 160; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * radius;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.heightAt(x, z) < WATER_Y - 0.6) return { x, z };
    }
    return null;
  }

  /** Raw grids for the renderer. */
  get gridSize() {
    return GRID;
  }
  heightGrid() {
    return this.h;
  }
  biomeGrid() {
    return this.b;
  }
  grassGrid() {
    return this.grass;
  }
}
