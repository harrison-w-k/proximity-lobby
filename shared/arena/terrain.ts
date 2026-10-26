// The procedural map. Built from a seed, identically on the server and on every client, so the
// terrain never travels over the network (see "Procedural maps" in the design doc).
import { fbm, mulberry32 } from './rng';

export const MAP_RADIUS = 350; // m: a 700 m x 700 m map, with lava closing in from the edge
export const CELL = 2.5; // m per height-grid cell
const GRID = Math.ceil((MAP_RADIUS * 2) / CELL) + 1;
export const WATER_Y = 0;

/** The lobby island: where everything on it stands. */
export const ISLAND = {
  shore: 44,
  plateau: { x: 24, z: -24, r: 8, h: 5 },
  pond: { x: -26, z: 8, r: 10 },
  grove: { x: 30, z: 18 },
  bushes: { x: -30, z: -24 },
  grass: { x: -6, z: -32, r: 9 },
};
export const DEEP_Y = -1.2; // below this you swim
const RIVER_W = 0.11; // half-width of a river in noise units: tuned so about half the map is water
const RIVER_SCALE = 150;

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

/** Things on the map that act on whoever stands in or over them. */
export type FeatureKind = 'geyser' | 'thermal' | 'spring' | 'mushroom' | 'tar' | 'vent';
export interface Feature {
  id: number;
  kind: FeatureKind;
  x: number;
  z: number;
  r: number; // metres
  period: number; // geysers: seconds between eruptions
  phase: number;
}
export const GEYSER_WARN = 2.6; // s of rumbling and steam before it blows
export const GEYSER_BLAST = 1.6; // s it spends erupting
export const GEYSER_LAUNCH = 18; // m/s straight up: about 6.5 m
export const BOUNCE_LAUNCH = 14; // m/s off a bounce mushroom
export const VENT_DAMAGE = 0.14; // share of max health a fire vent's blast burns
export const THERMAL_LIFT = 3.4; // m/s a glider is carried up
export const THERMAL_CEILING = 34; // m above the ground the updraft carries to
/** Where a geyser is in its cycle at `time`: 0 quiet, 1 warning, 2 erupting. `n` counts eruptions so one launches you once. */
export function geyserAt(f: Feature, time: number): { state: 0 | 1 | 2; n: number; t: number } {
  const u = time + f.phase;
  const n = Math.floor(u / f.period);
  const c = u - n * f.period;
  const blast = f.period - GEYSER_BLAST;
  if (c >= blast) return { state: 2, n, t: (c - blast) / GEYSER_BLAST };
  if (c >= blast - GEYSER_WARN) return { state: 1, n, t: (c - (blast - GEYSER_WARN)) / GEYSER_WARN };
  return { state: 0, n, t: 0 };
}

export class Terrain {
  readonly seed: number;
  features: Feature[] = [];
  private h = new Float32Array(GRID * GRID);
  private b = new Uint8Array(GRID * GRID);
  private grass = new Uint8Array(GRID * GRID); // 1 = long grass (slows you)
  res: Res[] = [];
  spawns: SpawnPoint[] = [];
  private cellsOfRes = new Map<number, number[]>();
  readonly attempt: number;

  /** 'island' is the small lobby map: a hand-built island with a pond, a plateau, obstacles and target dummies' ground. */
  readonly kind: 'wild' | 'island';

  constructor(seed: number, kind: 'wild' | 'island' = 'wild') {
    this.seed = seed | 0;
    this.kind = kind;
    if (kind === 'island') {
      this.attempt = 0;
      this.fillIsland();
      this.placeIsland();
      return;
    }
    let attempt = 0;
    for (;; attempt++) {
      this.fill(this.seed + attempt * 7919);
      if (this.connected() || attempt > 8) break;
    }
    this.attempt = attempt;
    this.place(this.seed + attempt * 7919);
    this.placeFeatures(this.seed + attempt * 7919);
    this.pickSpawns(this.seed + attempt * 7919);
  }

  /** Geysers, updrafts and hot springs, scattered so every part of the map has something to use. */
  private placeFeatures(seed: number) {
    const rnd = mulberry32(seed ^ 0x6e7a);
    const R = MAP_RADIUS - 30;
    const want: { kind: FeatureKind; n: number; gap: number; r: number; ok: (x: number, z: number, h: number, b: Biome) => boolean }[] = [
      { kind: 'geyser', n: 14, gap: 75, r: 2.4, ok: (_x, _z, h, b) => h > WATER_Y + 0.8 && (b === Biome.Highlands || b === Biome.Grassland || rnd() < 0.15) },
      { kind: 'thermal', n: 10, gap: 95, r: 9, ok: (_x, _z, h, b) => h > WATER_Y + 0.6 && b !== Biome.Wetlands },
      { kind: 'mushroom', n: 18, gap: 50, r: 1.7, ok: (_x, _z, h, b) => h > WATER_Y + 0.5 && (b === Biome.Forest || b === Biome.Grassland) },
      { kind: 'tar', n: 8, gap: 90, r: 4.5, ok: (_x, _z, h, b) => h > WATER_Y + 0.3 && (b === Biome.Wetlands || b === Biome.Highlands) },
      { kind: 'vent', n: 8, gap: 100, r: 2.6, ok: (_x, _z, h, b) => h > WATER_Y + 0.8 && b === Biome.Highlands },
      { kind: 'spring', n: 8, gap: 85, r: 3.4, ok: (_x, _z, h, b) => h > WATER_Y + 0.05 && h < WATER_Y + 1.4 && (b === Biome.Wetlands || b === Biome.Forest) },
    ];
    for (const w of want) {
      let made = 0;
      for (let t = 0; t < 30000 && made < w.n; t++) {
        const a = rnd() * Math.PI * 2;
        const rr = Math.sqrt(rnd()) * R;
        const x = Math.cos(a) * rr;
        const z = Math.sin(a) * rr;
        if (Math.hypot(x, z) < 35) continue; // keep the den quiet
        const h = this.heightAt(x, z);
        if (!w.ok(x, z, h, this.biomeAt(x, z))) continue;
        // flat enough to stand on, and clear of trees and rocks
        const slope = Math.hypot(this.heightAt(x + 2, z) - this.heightAt(x - 2, z), this.heightAt(x, z + 2) - this.heightAt(x, z - 2)) / 4;
        if (slope > (w.kind === 'thermal' ? 0.6 : 0.3) || this.collide(x, z, w.kind === 'thermal' ? 2 : w.r + 1).hit) continue; // an updraft is only air: it can sit over trees
        if (this.features.some((f) => f.kind === w.kind && Math.hypot(f.x - x, f.z - z) < w.gap)) continue;
        this.features.push({ id: this.features.length, kind: w.kind, x, z, r: w.r, period: 11 + Math.floor(rnd() * 8), phase: rnd() * 30 });
        made++;
      }
    }
  }

  /** Is this spot in a tar pit (slow and sticky)? */
  tarAt(x: number, z: number): boolean {
    for (const f of this.features) if (f.kind === 'tar' && Math.hypot(f.x - x, f.z - z) < f.r) return true;
    return false;
  }

  /** The updraft (m/s) carrying a glider at this spot, if it is over a thermal. */
  liftAt(x: number, z: number): number {
    for (const f of this.features) {
      if (f.kind !== 'thermal') continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < f.r) return THERMAL_LIFT * (1 - (d / f.r) ** 2 * 0.6);
    }
    return 0;
  }

  private idx(gx: number, gz: number) {
    return gz * GRID + gx;
  }

  // --- the island ---------------------------------------------------------------------------

  private fillIsland() {
    const sm = (a: number, b: number, x: number) => {
      const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
      return t * t * (3 - 2 * t);
    };
    const P = ISLAND.plateau;
    const inward = { x: -P.x / Math.hypot(P.x, P.z), z: -P.z / Math.hypot(P.x, P.z) };
    for (let gz = 0; gz < GRID; gz++) {
      for (let gx = 0; gx < GRID; gx++) {
        const x = gx * CELL - MAP_RADIUS;
        const z = gz * CELL - MAP_RADIUS;
        const i = this.idx(gx, gz);
        const r = Math.hypot(x, z);
        const detail = fbm(x / 14 + 5, z / 14 + 9, 11, 2);
        // flat ground in the middle, a beach, then deep sea
        let hgt = 1.6 + (-3.4 - 1.6) * sm(ISLAND.shore, ISLAND.shore + 18, r) + (detail - 0.5) * 0.35 * (1 - sm(30, 46, r));
        // the plateau: a long gentle ramp up on the side facing the middle, a cliff on the other sides
        const dp = Math.hypot(x - P.x, z - P.z);
        if (dp < P.r + 20) {
          const cosA = dp < 1e-3 ? 1 : ((x - P.x) * inward.x + (z - P.z) * inward.z) / dp;
          const w = 0.6 + 15 * Math.min(1, Math.max(0, cosA * 1.4 + 0.1));
          hgt += P.h * (1 - sm(P.r, P.r + w, dp));
        }
        // the pond
        const dq = Math.hypot(x - ISLAND.pond.x, z - ISLAND.pond.z);
        hgt -= 4.4 * (1 - sm(ISLAND.pond.r * 0.45, ISLAND.pond.r, dq));
        this.h[i] = hgt;
        let bio: Biome = Biome.Grassland;
        if (dq < ISLAND.pond.r + 6) bio = Biome.Wetlands;
        else if (dp < P.r + 4) bio = Biome.Highlands;
        else if (Math.hypot(x - ISLAND.grove.x, z - ISLAND.grove.z) < 12) bio = Biome.Forest;
        this.b[i] = bio;
        this.grass[i] = Math.hypot(x - ISLAND.grass.x, z - ISLAND.grass.z) < ISLAND.grass.r ? 1 : 0;
      }
    }
  }

  private placeIsland() {
    const add = (kind: ResKind, x: number, z: number, s: number, solid: number, h: number) =>
      this.addRes({ id: this.res.length, kind, x, z, s, r: solid * s, h });
    // a jumping course: low stones you hop over, then three steps that climb
    [[-9, 24, 0.6], [-2, 24, 0.8], [5, 24, 1.05]].forEach(([x, z, s]) => add('stone', x, z, s, 0.8, s * 0.8));
    [[14, 26, 1.0], [18.5, 26, 1.6], [23, 26, 2.3]].forEach(([x, z, s]) => add('rock', x, z, s, 0.8, s * 0.9));
    // a wall to dash into, throw things over, and hide a dummy behind
    for (let i = 0; i < 6; i++) add('rock', -7 + i * 2.6, -14, 1.5, 0.8, 1.35);
    // a grove of trees that blocks sight
    [[-2, 3], [3, -1], [-3, -4], [2, 4], [6, 1]].forEach(([dx, dz]) => add('tree', ISLAND.grove.x + dx, ISLAND.grove.z + dz, 1.2, 0.4, 99));
    // bushes to hide in
    [[-3, 1], [2, -2], [0, 3], [-1, -3]].forEach(([dx, dz]) => add('bush', ISLAND.bushes.x + dx, ISLAND.bushes.z + dz, 1.3, 0, 99));
    // mud and reeds
    add('mud', 0, -34, 1, 0, 0);
    add('mud', 5, -32, 1, 0, 0);
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      add('reed', ISLAND.pond.x + Math.cos(a) * (ISLAND.pond.r - 1.5), ISLAND.pond.z + Math.sin(a) * (ISLAND.pond.r - 1.5), 0.9, 0, 0);
    }
    // food: berries and herbs to heal with
    add('berry', 8, -6, 1, 0, 99);
    add('berry', -10, 12, 1, 0, 99);
    add('herb', 12, 6, 1, 0, 99);
    // a few rocks round the edge of the beach
    [[-40, -20], [38, 8], [-30, 34], [10, 42]].forEach(([x, z], k) => add('rock', x, z, 2 + (k % 2) * 0.8, 0.8, (2 + (k % 2) * 0.8) * 0.9));
    this.spawns = [];
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      this.spawns.push({ x: Math.cos(a) * 8, z: Math.sin(a) * 8 });
    }
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
        let riverM = 0;
        hgt += high * high * 30 + Math.max(0, elev - 0.6) * 16;
        // wetlands: a wet, low area is carved into lakes
        const wet = moist > 0.58 && elev < 0.6 && r > 55 ? Math.min(1, (moist - 0.58) / 0.15) : 0;
        hgt -= wet * 9 * Math.min(1, wet * 3);
        // rivers: ridges of a warped noise field, so winding channels run right across the map (about half of it is water)
        {
          const wx = x + (fbm(x / 130 + 3, z / 130 + 9, seed + 6, 2) - 0.5) * 140;
          const wz = z + (fbm(x / 130 - 8, z / 130 + 2, seed + 7, 2) - 0.5) * 140;
          const ridge = Math.abs(fbm(wx / RIVER_SCALE + 21, wz / RIVER_SCALE - 14, seed + 5, 3) - 0.5);
          let m = 1 - Math.min(1, Math.max(0, (ridge - RIVER_W * 0.55) / (RIVER_W * 0.45)));
          m *= 1 - Math.min(0.6, high * 0.7); // rivers favour the valleys but cut canyons through the hills
          m *= Math.min(1, Math.max(0, (r - 48) / 22)); // and leave the central clearing alone
          const ford = fbm(x / 55 + 40, z / 55 - 40, seed + 8, 2) > 0.6; // shallow crossings
          const bed = ford ? -0.8 : -3.4;
          hgt = hgt * (1 - m) + bed * m;
          riverM = m;
        }
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

  /** At least half of the walkable ground must be one connected piece. */
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
    return total > 0 && best / total >= 0.5; // rivers split the land, but everything can swim across
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
          for (let off = 0; off < 150 && !best; off += 5) {
            for (let k = 0; k < 16 && !best; k++) {
              const ang = (k / 16) * Math.PI * 2;
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
  randomLand(rnd: () => number, radius: number, minRadius = 0, clear = 0.8): { x: number; z: number } {
    for (let i = 0; i < 80; i++) {
      const a = rnd() * Math.PI * 2;
      const r = minRadius + Math.sqrt(rnd()) * (radius - minRadius);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (this.heightAt(x, z) > WATER_Y + 0.3 && !this.collide(x, z, clear).hit) return { x, z };
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
