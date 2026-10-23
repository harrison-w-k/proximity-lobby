// The authoritative match simulation: 20 animals, a procedural map, horde AI, a closing lava
// ring, XP and skills. It knows nothing about sockets: a host feeds
// it client messages, calls tick() at 30 Hz and sends the snapshots it produces.
import {
  ANIMAL_BY_ID, ANIMALS, EVOLVE_TIME, MAX_LEVEL, SKILL_BY_ID, STAT_KEYS, derive, evolveOptions, emptyStats, hordeXp, killXp, sumMods, xpNeed,
  type AnimalDef, type Derived, type Effect, type Mods, type Skill, type Status, type Stats,
} from './animals';
import {
  MOBS, TIER_SHARE, mobDef,
  mobIndex, type MobDef,
} from './mobs';
import { JUMP_COST, JUMP_V, MAP_BOUND, medium, standY, stepPos, stepVertical, type Bound } from './move';
import {
  FL, ROLE_CODE, type ClientMatchMsg, type Global, type InvItem, type ItemKind, type MatchEvent, type Role, type RosterEntry,
  type ServerMatchMsg, type YouState,
} from './proto';
import { classSkill } from './animals';
import { COMBO, COMBO_RESET, DASH_COOLDOWN, DASH_SPEED, DASH_TIME, PARRY_HIT_CD, PARRY_MISS_CD, PARRY_MISS_STUN, PARRY_STUN, PARRY_WINDOW } from './combat';
import { mulberry32 } from './rng';
import { SPAWN_BY_ID, type SpawnId } from './spawn';
import { Biome, MAP_RADIUS, Terrain, WATER_Y } from './terrain';
import { botThink } from './bots';

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const PHASE_NAMES = ['Recess', 'Study Hall', 'Pop Quiz', 'Final Exam', 'Graduation'];
export const PHASE_AT = [0, 90, 240, 420, 600];
export const MATCH_LEN = 720;
export const PVP_DAMAGE = 0.6; // blows between players land at 60%: fights last longer
export const DASH_COST = 22; // stamina
export { DASH_COOLDOWN, DASH_TIME, DASH_SPEED };
export { COMBO, COMBO_RESET, PARRY_HIT_CD, PARRY_MISS_CD, PARRY_MISS_STUN, PARRY_STUN, PARRY_WINDOW };
/** Seconds of wind-up before each kind of skill lands: the telegraph others can react to. */
const SKILL_WIND: Record<string, number> = { cone: 0.22, dash: 0.18, aoe: 0.3, proj: 0.16, grab: 0.2 };
export const SCATTER_PEACE = 90; // no player-vs-player damage while everyone scatters
export const INV_SLOTS = 6;
export const MEAT_SPOIL = 70; // s carried before meat rots
export const HUNT_ROAR_EVERY = 45;
const BASE_RING_DPS = 0.05;

export interface RingStep {
  warn: number;
  start: number;
  dur: number;
  frac: number;
  dps: number; // fraction of max health per second inside the lava
}
export const RINGS: RingStep[] = [
  { warn: 150, start: 180, dur: 60, frac: 0.7, dps: 0.05 },
  { warn: 300, start: 330, dur: 60, frac: 0.4, dps: 0.07 },
  { warn: 450, start: 480, dur: 50, frac: 0.2, dps: 0.1 },
  { warn: 600, start: 630, dur: 50, frac: 0.08, dps: 0.14 },
  { warn: 690, start: 720, dur: 70, frac: 0.0, dps: 0.2 }, // sudden death
];
const R0 = MAP_RADIUS - 6;

/** The lava radius and damage rate at a match time. */
export function ringAt(time: number): { r: number; dps: number; n: number; closing: boolean } {
  let prev = R0;
  let dps = BASE_RING_DPS;
  for (let i = 0; i < RINGS.length; i++) {
    const s = RINGS[i];
    const to = R0 * s.frac;
    if (time < s.start) return { r: prev, dps, n: i + 1, closing: false };
    dps = s.dps;
    if (time < s.start + s.dur) {
      const k = (time - s.start) / s.dur;
      return { r: prev + (to - prev) * k, dps, n: i + 1, closing: true };
    }
    prev = to;
  }
  return { r: prev, dps, n: RINGS.length, closing: false };
}

// --- entities --------------------------------------------------------------------------------

export interface Input {
  s: number;
  dx: number;
  dz: number;
  yaw: number;
  sprint: boolean;
  crouch: boolean;
  at: boolean;
}

interface Body {
  kind: 'f' | 'm';
  x: number;
  z: number;
  y: number;
  yaw: number;
  hp: number;
  maxHp: number;
  r: number;
}

interface Buff {
  id: string;
  until: number;
  speed: number;
  dmg: number;
  dr: number;
  reflect: number;
  free: boolean;
  rof: number;
}

interface Chan {
  k: 'eat' | 'harvest' | 'drink' | 'loot' | 'evolve';
  to?: string;
  until: number;
  total: number;
  slot?: number;
  node?: number;
  x: number;
  z: number;
}

export interface Fighter extends Body {
  kind: 'f';
  paint?: [number, number]; // chosen fur colours (cosmetic)
  id: string;
  name: string;
  def: AnimalDef;
  team: number;
  bot: boolean;
  role: Role;
  level: number;
  xp: number;
  totalXp: number;
  pts: number;
  alloc: Stats;
  mods: Required<Mods>;
  dv: Derived;
  sta: number;
  input: Input;
  cdAt: number[];
  dashAt: number;
  streak: number;
  streakAt: number;
  combo: number;
  comboAt: number;
  swing: Swing | null;
  guarding: boolean;
  guardAt: number;
  guardCd: number;
  whiffUntil: number; // fumbling after a parry that caught nothing: can walk, nothing else
  counterUntil: number;
  jy: number;
  jv: number;
  atkAt: number;
  buffs: Buff[];
  // statuses
  bleed?: { until: number; dps: number; src: string };
  slow?: { until: number; f: number };
  markUntil: number;
  stunUntil: number;
  scareUntil: number;
  blindUntil: number;
  grab?: { by: Body; until: number; dps: number };
  holding?: Body;
  subUntil: number;
  invUntil: number;
  dash?: { dx: number; dz: number; speed: number; until: number; dmg: number; hit: Set<Body>; st?: Status[]; knock: number; aoe: number };
  hot?: { until: number; perSec: number };
  speedUntil: number;
  glideUntil: number;
  mudUntil: number;
  tusk: number;
  muskUntil: number;
  reedUntil: number;
  usedCheat: boolean;
  inv: (InvItem | null)[];
  chan: Chan | null;
  ability: { k: ItemKind; until: number } | null;
  kills: number;
  dmgDealt: number;
  place: number;
  lastHurt: number;
  lastCombat: number;
  hunted: boolean;
  lastAttacker: string;
  recentAttackers: Map<string, number>;
  atkFlash: number;
  roarFlash: number;
  deathX: number;
  deathZ: number;
  moving: boolean;
  sprinting: boolean;
  cmds: { s: number; dt: number; dx: number; dz: number; sprint: boolean; crouch: boolean; jump: boolean }[];
  ack: number;
  lastCmd: number;
  lastInputAt: number;
  walkSpeed: number;
  holdUntil: number;
  holdDps: number;
  view?: string; // spectators: whom they are watching
  bornAt: number;
}

interface Swing {
  at: number; // when it lands
  start: number;
  kind: 'basic' | 'skill';
  combo: number;
  heavy: boolean;
  skill?: Skill;
  fx?: Effect;
  yaw: number;
  wind: number;
}

type MobState = 'idle' | 'flee' | 'attack' | 'investigate' | 'stampede';

export interface Mob extends Body {
  kind: 'm';
  id: number;
  def: MobDef;
  state: MobState;
  until: number;
  tx: number;
  tz: number;
  homeX: number;
  homeZ: number;
  target: Fighter | null;
  pack: number;
  atkAt: number;
  awake: boolean;
  atkFlash: number;
  slowUntil: number;
  stunUntil: number;
  bleedUntil: number;
  bleedDps: number;
  scareUntil: number;
  wander: number;
  hurtFlash: number;
  strikeAt: number; // a boss attack lands at this time (0 = not winding up)
  fleeAt: number;
  jit: number; // a fleeing animal's wobble off a straight line
  pauseUntil: number; // and its habit of freezing
}

interface Drop {
  id: number;
  x: number;
  z: number;
  items: InvItem[];
  ttl: number; // match time it disappears
  pile: boolean;
}

interface Proj {
  id: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  left: number;
  dmg: number;
  src: Fighter;
  st?: Status[];
}

export interface Entrant {
  id: string;
  name: string;
  animal: string;
  team: number;
  bot: boolean;
  spawn?: string; // the environment this team asked to drop into
  paint?: [number, number]; // chosen colours
}

export interface Host {
  send(id: string, msg: ServerMatchMsg): void;
}

/** XP for eating one of the morsels scattered over the ground. */
const MORSEL_XP = 5;
const NODE_RESPAWN: Record<string, number> = { berry: 50, fruit: 90, herb: 80, mud: 45, hive: 120, reed: 30 };
const HARVEST_TIME: Record<string, number> = { berry: 2.2, fruit: 3, herb: 2.5, mud: 2, hive: 3.5, reed: 1.8 };


const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const yawOf = (dx: number, dz: number) => Math.atan2(dx, dz);
const angDiff = (a: number, b: number) => {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
const r1 = (v: number) => Math.round(v * 10) / 10;

export class Match {
  readonly terrain: Terrain;
  readonly seed: number;
  time = 0;
  tickN = 0;
  finished = false;
  winnerTeam = -1;
  fighters: Fighter[] = [];
  byId = new Map<string, Fighter>();
  mobs: Mob[] = [];
  drops: Drop[] = [];
  projs: Proj[] = [];
  nodeUntil = new Map<number, number>();
  rnd: () => number;
  phase = 0;
  alphaSpawned = false;
  migrating = 0;
  migrationDone = false;
  disbanded = false;
  lure: { x: number; z: number; until: number } | null = null;
  results: { id: string; name: string; animal: string; lvl: number; kills: number; place: number; dmg: number }[] = [];
  private nextMob = 1;
  private nextDrop = 1;
  private nextProj = 1;
  private nextPack = 1;
  private events: { e: MatchEvent; x?: number; z?: number }[] = [];
  private noises: { x: number; z: number; r: number }[] = [];
  private warned = new Set<number>();
  private closed = new Set<number>();
  private lastRoar = 0;
  private lastHunted = -10;
  private lastAwake = -10;
  private lastPop = 0;
  private lastLava = 0;
  private teamsAlive = new Set<number>();
  private startTeams = 0;
  /** What the last call to hurt() did: 'hit', or the guard 'block'ed / 'parry'ed it, or a 'dodge' avoided it. */
  lastResult: 'hit' | 'block' | 'parry' | 'dodge' = 'hit';
  private rosterDirty = false;
  readonly humans = new Set<string>();
  /** The campus: the lobby as a permanent, non-lethal match. Nobody can be hurt, there is no lava or clock, and players come and go. */
  readonly campus: boolean;

  constructor(
    seed: number,
    entrants: Entrant[],
    private host: Host,
    opts: { campus?: boolean } = {},
  ) {
    this.campus = !!opts.campus;
    if (this.campus) this.phase = 1;
    this.seed = seed;
    this.terrain = new Terrain(seed);
    this.rnd = mulberry32(seed ^ 0xfaceb00c);
    this.createFighters(entrants);
    this.populateStart();
    this.scatterMorsels(400);
    if (this.campus) {
      // farming has to be worth it for the whole evolution path, so every tier of horde is out from the start
      for (let i = 0; i < 110; i++) this.spawnWild(2, MAP_RADIUS * 0.7, 0);
      for (let i = 0; i < 50; i++) this.spawnWild(3, MAP_RADIUS * 0.5, 0);
    }
    this.startTeams = new Set(this.fighters.map((f) => f.team)).size;
    for (const f of this.fighters) if (!f.bot) this.humans.add(f.id);
  }

  // --- setup ---------------------------------------------------------------------------------

  private newFighter(e: Entrant): Fighter {
    const def = ANIMAL_BY_ID.get(e.animal) ?? ANIMALS[0];
    const f: Fighter = {
      paint: e.paint,
      kind: 'f', id: e.id, name: e.name, def, team: e.team, bot: e.bot, role: 'alive', level: 1, xp: 0, totalXp: 0, pts: 0,
      alloc: emptyStats(), mods: sumMods([def.innate]), dv: derive(def, emptyStats(), sumMods([def.innate])),
      x: 0, z: 0, y: 0, yaw: 0, hp: 1, maxHp: 1, r: 0.5, sta: 100,
      input: { s: 0, dx: 0, dz: 0, yaw: 0, sprint: false, crouch: false, at: false },
      cdAt: [0, 0, 0, 0], dashAt: 0, streak: 0, streakAt: -99, combo: 0, comboAt: -9, swing: null, guarding: false, guardAt: -9, guardCd: 0, whiffUntil: 0, counterUntil: 0, jy: 0, jv: 0, atkAt: 0, buffs: [], markUntil: 0, stunUntil: 0, scareUntil: 0, blindUntil: 0, subUntil: 0, invUntil: 0,
      speedUntil: 0, glideUntil: 0, mudUntil: 0, tusk: 0, muskUntil: 0, reedUntil: 0, usedCheat: false,
      inv: new Array(INV_SLOTS).fill(null), chan: null, ability: null, kills: 0, dmgDealt: 0, place: 0, lastHurt: -99, lastCombat: -99,
      hunted: false, lastAttacker: '', recentAttackers: new Map(), atkFlash: 0, roarFlash: 0, deathX: 0, deathZ: 0,
     
      moving: false, sprinting: false, cmds: [], ack: 0, lastCmd: 0, lastInputAt: 0, walkSpeed: 0, holdUntil: 0, holdDps: 0, bornAt: 0,
    };
    this.recompute(f, true);
    // everyone starts with an empty water pouch
    f.inv[0] = { k: 'water', n: 2, born: 0 };
    return f;
  }

  private createFighters(entrants: Entrant[]) {
    for (const e of entrants) {
      const f = this.newFighter(e);
      this.fighters.push(f);
      this.byId.set(f.id, f);
    }
    // teams share a spawn point; teams are spread over the 20 points
    const teams = [...new Set(entrants.map((e) => e.team))];
    for (let i = teams.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1));
      [teams[i], teams[j]] = [teams[j], teams[i]];
    }
    // teams that asked for an environment are placed first; the rest take what is left
    const free = [...this.terrain.spawns];
    const used: { x: number; z: number }[] = [];
    const wanted = new Map<number, Biome>();
    for (const e of entrants) {
      const c = SPAWN_BY_ID.get(e.spawn as SpawnId);
      if (c?.biome != null && !wanted.has(e.team)) wanted.set(e.team, c.biome);
    }
    const placed = new Map<number, { x: number; z: number }>();
    for (const team of teams) {
      const biome = wanted.get(team);
      if (biome === undefined) continue;
      let i = free.findIndex((p) => this.terrain.biomeAt(p.x, p.z) === biome);
      let sp: { x: number; z: number } | null = null;
      if (i >= 0) sp = free.splice(i, 1)[0];
      else sp = this.terrain.spawnIn(biome, used, this.rnd);
      if (sp) {
        placed.set(team, sp);
        used.push(sp);
      }
    }
    for (const team of teams) {
      if (placed.has(team)) continue;
      const sp = free.shift() ?? this.terrain.spawns[placed.size % this.terrain.spawns.length];
      placed.set(team, sp);
      used.push(sp);
    }
    teams.forEach((team) => {
      const sp = placed.get(team)!;
      let k = 0;
      for (const f of this.fighters) {
        if (f.team !== team) continue;
        const a = (k++ / 4) * Math.PI * 2;
        let p = this.terrain.collide(sp.x + Math.cos(a) * 2.5 * (k > 1 ? 1 : 0), sp.z + Math.sin(a) * 2.5 * (k > 1 ? 1 : 0), 0.6);
        if (f.def.swim === 'water') {
          // fish start in the water, as close to their drop point as there is a lake
          const w = this.terrain.findWater(sp.x, sp.z, this.rnd);
          if (w) p = { x: w.x + Math.cos(a) * 1.5 * (k > 1 ? 1 : 0), z: w.z + Math.sin(a) * 1.5 * (k > 1 ? 1 : 0), hit: false };
        }
        f.x = p.x;
        f.z = p.z;
        f.y = standY(this.terrain, f.x, f.z);
        f.yaw = yawOf(-sp.x, -sp.z); // face the centre
        f.input.yaw = f.yaw;
        this.teamsAlive.add(team);
      }
    });
  }

  private populateStart() {
    // tier 1 hordes everywhere, plus a few beside each spawn so nobody starts hungry
    for (let i = 0; i < 170; i++) this.spawnWild(1, MAP_RADIUS - 25, 0);
    for (const f of this.fighters) {
      if (this.fighters.some((o) => o !== f && o.team === f.team && o.id < f.id)) continue;
      for (let k = 0; k < 3; k++) {
        const p = this.terrain.randomLand(this.rnd, 38, 14);
        this.spawnWildAt(1, f.x + p.x, f.z + p.z);
      }
    }
  }

  // --- helpers -------------------------------------------------------------------------------

  private emit(e: MatchEvent, x?: number, z?: number) {
    this.events.push({ e, x, z });
  }
  toast(id: string | undefined, text: string) {
    this.emit({ k: 'toast', to: id, text });
  }

  roster(): RosterEntry[] {
    return this.fighters.map((f) => ({
      id: f.id, name: f.name, animal: f.def.id, team: f.team, bot: f.bot, role: ROLE_CODE[f.role], paint: f.paint,
    }));
  }

  /** Skills the fighter currently has: slots Q E R F. */
  slotSkills(f: Fighter): (Skill | null)[] {
    return [f.def.skill, f.def.skill2, null, null]; // Q: the signature skill, E: a second move from stage 2 on
  }

  recompute(f: Fighter, fill = false) {
    const skills: Skill[] = [f.def.innate];
    skills.push(classSkill(f.def.cls));
    f.mods = sumMods(skills);
    const oldMax = f.maxHp;
    f.dv = derive(f.def, f.alloc, f.mods);
    f.maxHp = f.dv.maxHp;
    f.r = f.dv.radius;
    if (fill) f.hp = f.maxHp;
    else if (f.maxHp > oldMax) f.hp += f.maxHp - oldMax;
    f.hp = Math.min(f.hp, f.maxHp);
    if (fill) f.sta = f.dv.maxSta;
    f.sta = Math.min(f.sta, f.dv.maxSta);
  }

  private buffSum(f: Fighter, key: 'speed' | 'dmg' | 'dr' | 'reflect' | 'rof'): number {
    let v = key === 'rof' ? 1 : 0;
    for (const b of f.buffs) {
      if (b.until < this.time) continue;
      if (key === 'rof') v = Math.max(v, b.rof || 1);
      else v += b[key];
    }
    return v;
  }
  private hasFree(f: Fighter) {
    return f.buffs.some((b) => b.free && b.until >= this.time);
  }

  private dmgMult(f: Fighter, t: Body | null): number {
    let m = 1 + f.mods.dmg + this.buffSum(f, 'dmg');
    if (f.hp < f.maxHp * 0.4) m += f.mods.lowHpDmg;
    if (t?.kind === 'f') {
      if ((t as Fighter).markUntil > this.time) m += f.mods.markDmg + 0.1;
      if (t.hp < t.maxHp * 0.4) m += f.mods.executeDmg;
    } else if (t && t.hp < t.maxHp * 0.4) m += f.mods.executeDmg;
    if (f.subUntil > this.time) m += 0.5 + f.mods.ambush;
    else if (f.mods.ambush > 0 && f.role === 'alive' && this.terrain.inBush(f.x, f.z)) m += f.mods.ambush;
    if (f.counterUntil > this.time) m += 0.5; // a parry opens the enemy up
    if (f.blindUntil > this.time) m -= 0.25;
    if (f.scareUntil > this.time) m -= 0.25;
    return Math.max(0.2, m);
  }

  private teamOf(b: Body | null): number {
    if (!b) return -1;
    return b.kind === 'f' ? (b as Fighter).team : -1;
  }

  /** May `src` hurt `t`? Wild animals only hurt living players, and nobody hurts a teammate or a spectator. */
  private canHit(src: Body | null, t: Body): boolean {
    if (t.kind === 'f') {
      const tf = t as Fighter;
      if (tf.role === 'out') return false;
      if (src === null) return true;
      if (src.kind === 'f') {
        const sf = src as Fighter;
        if (sf.team === tf.team && sf !== tf) return false;
        if (sf.role === 'alive' && tf.role === 'alive' && this.time < SCATTER_PEACE) return false; // first contact comes in the Farm phase
        return true;
      }
      return tf.role === 'alive'; // a wild animal
    }
    // t is a wild animal
    if (!src || src.kind === 'm') return false;
    return (src as Fighter).role === 'alive';
  }

  private bodies(x: number, z: number, r: number, pred: (b: Body) => boolean): Body[] {
    const out: Body[] = [];
    for (const f of this.fighters) {
      if (f.role === 'out' || f.hp <= 0) continue;
      if (Math.abs(f.x - x) > r + f.r || Math.abs(f.z - z) > r + f.r) continue;
      if (Math.hypot(f.x - x, f.z - z) <= r + f.r && pred(f)) out.push(f);
    }
    for (const m of this.mobs) {
      if (m.hp <= 0) continue;
      if (Math.abs(m.x - x) > r + m.r || Math.abs(m.z - z) > r + m.r) continue;
      if (Math.hypot(m.x - x, m.z - z) <= r + m.r && pred(m)) out.push(m);
    }
    return out;
  }

  private noise(x: number, z: number, r: number) {
    this.noises.push({ x, z, r });
  }

  // --- input from clients ----------------------------------------------------------------------

  handle(id: string, msg: ClientMatchMsg) {
    const f = this.byId.get(id);
    if (!f || f.bot) return;
    switch (msg.t) {
      case 'min': {
        if (!(msg.s > f.lastCmd) || !Number.isFinite(msg.s)) return;
        f.lastCmd = msg.s;
        f.lastInputAt = this.time;
        const i = f.input;
        if (Number.isFinite(msg.yaw)) i.yaw = msg.yaw;
        i.at = msg.at === 1;
        const l = Math.hypot(msg.x, msg.z);
        const k = l > 1 ? 1 / l : 1;
        const dtm = Number.isFinite(msg.dt) ? Math.max(0, Math.min(0.1, msg.dt / 1000)) : 0;
        if (dtm > 0) {
          f.cmds.push({ s: msg.s, dt: dtm, dx: Number.isFinite(msg.x) ? msg.x * k : 0, dz: Number.isFinite(msg.z) ? msg.z * k : 0, sprint: msg.sp === 1, crouch: msg.cr === 1, jump: msg.j === 1 });
          if (f.cmds.length > 12) f.cmds.shift();
        } else if (f.cmds.length) f.cmds.push({ s: msg.s, dt: 0, dx: 0, dz: 0, sprint: false, crouch: false, jump: false });
        else f.ack = msg.s;
        break;
      }
      case 'mskill':
        this.castSkill(f, msg.i | 0, Number.isFinite(msg.yaw) ? msg.yaw : f.input.yaw);
        break;
      case 'mstat':
        this.spendStat(f, msg.k);
        break;
      case 'mevolve':
        this.evolve(f, typeof msg.to === 'string' ? msg.to : '');
        break;
      case 'muse':
        this.useItem(f, msg.i | 0);
        break;
      case 'mact':
        if (msg.a === 'harvest') this.startHarvest(f);
        else if (msg.a === 'loot') this.startLoot(f);
        else if (msg.a === 'drink') this.startDrink(f);
        else if (msg.a === 'drop') this.dropItem(f, msg.i ?? 0);
        break;
      case 'mguard':
        this.setGuard(f, msg.on === 1);
        break;
      case 'mdash':
        this.dash(f, Number.isFinite(msg.x) ? msg.x : 0, Number.isFinite(msg.z) ? msg.z : 0);
        break;
      case 'mleave':
        this.release(id);
        break;
    }
  }

  /** A human left: the AI takes over so the match goes on. */
  /** Campus: a player walks in as a stage 1 animal at a random spot. Joining again swaps the animal (and resets your progress). */
  addPlayer(e: Entrant): Fighter {
    this.removePlayer(e.id);
    const team = 1 + this.fighters.reduce((m, f) => Math.max(m, f.team), -1);
    const f = this.newFighter({ ...e, team, bot: false });
    const spot = f.def.swim === 'water' ? this.terrain.findWater(0, 0, this.rnd) : this.terrain.randomLand(this.rnd, 170, 30);
    const p = spot ?? this.terrain.randomLand(this.rnd, 170, 30);
    f.x = p.x;
    f.z = p.z;
    f.y = standY(this.terrain, f.x, f.z);
    f.yaw = Math.atan2(-p.x, -p.z);
    f.input.yaw = f.yaw;
    f.lastInputAt = this.time;
    this.fighters.push(f);
    this.byId.set(f.id, f);
    this.humans.add(f.id);
    this.teamsAlive.add(team);
    this.rosterDirty = true;
    return f;
  }

  /** Campus: a player leaves (or goes off to a real match). */
  removePlayer(id: string) {
    const f = this.byId.get(id);
    if (!f) return;
    this.humans.delete(id);
    this.byId.delete(id);
    const i = this.fighters.indexOf(f);
    if (i >= 0) this.fighters.splice(i, 1);
    for (const m of this.mobs) {
      if (m.target === f) {
        m.target = null;
        if (m.state === 'attack') m.state = 'idle';
      }
    }
    this.rosterDirty = true;
  }

  /** The message that starts the match on a client. */
  startMsg(id: string): ServerMatchMsg {
    return { t: 'mstart', seed: this.seed, you: id, roster: this.roster(), nodes: [...this.nodeUntil], campus: this.campus || undefined };
  }

  release(id: string) {
    const f = this.byId.get(id);
    if (!f || f.bot) return;
    f.bot = true;
    this.humans.delete(id);
    this.rosterDirty = true;
  }

  // --- progression ---------------------------------------------------------------------------

  spendStat(f: Fighter, k: string): boolean {
    if (f.pts <= 0 || f.role !== 'alive' || !(STAT_KEYS as readonly string[]).includes(k)) return false;
    f.alloc[k as keyof Stats]++;
    f.pts--;
    this.recompute(f);
    return true;
  }

  /** Start evolving: three seconds standing still. Any form of the next stage in your tree, once you are high enough a level. */
  evolve(f: Fighter, to: string): boolean {
    if (f.role !== 'alive' || f.chan || f.stunUntil > this.time || f.grab || f.holding) return false;
    const target = evolveOptions(f.def, f.level).find((a) => a.id === to);
    if (!target) return false;
    f.swing = null;
    f.guarding = false;
    f.chan = { k: 'evolve', until: this.time + EVOLVE_TIME, total: EVOLVE_TIME, to: target.id, x: f.x, z: f.z };
    this.emit({ k: 'evolving', id: f.id, to: target.id, x: f.x, z: f.z }, f.x, f.z);
    return true;
  }

  private finishEvolve(f: Fighter, to: string) {
    const def = ANIMAL_BY_ID.get(to);
    if (!def || f.role !== 'alive') return;
    f.def = def;
    f.cdAt = [0, 0, 0, 0];
    this.recompute(f, true); // health refills when it completes
    this.rosterDirty = true;
    this.emit({ k: 'evolve', id: f.id, to: def.id, x: f.x, z: f.z }, f.x, f.z);
  }

  gainXp(f: Fighter, amount: number) {
    if (f.role !== 'alive' || amount <= 0) return;
    f.xp += amount;
    f.totalXp += amount;
    while (f.level < MAX_LEVEL && f.xp >= xpNeed(f.level)) {
      f.xp -= xpNeed(f.level);
      f.level++;
      f.pts++;
      f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.2);
      this.emit({ k: 'level', id: f.id, lvl: f.level }, f.x, f.z);
    }
    if (f.level >= MAX_LEVEL) f.xp = 0;
  }

  // --- skills --------------------------------------------------------------------------------

  castSkill(f: Fighter, slot: number, yaw: number): boolean {
    if (slot < 0 || slot > 3 || f.hp <= 0) return false;
    if (f.role === 'out') return false;
    if (f.stunUntil > this.time || f.whiffUntil > this.time || f.grab) return false;
    const skill = this.slotSkills(f)[slot];
    if (!skill?.fx || this.time < f.cdAt[slot]) return false;
    const cost = skill.cost ?? 0;
    if (f.sta < cost && !this.hasFree(f)) return false;
    const fx = skill.fx;
    if (fx.k === 'submerge' && !(this.terrain.depthAt(f.x, f.z) > 0.25)) {
      this.toast(f.id, 'You need water to submerge.');
      return false;
    }
    if (fx.k === 'grab' && !this.findGrab(f, fx.range)) return false;
    f.chan = null;
    f.yaw = yaw;
    f.input.yaw = yaw;
    if (!this.hasFree(f)) f.sta -= cost;
    f.cdAt[slot] = this.time + (skill.cd ?? 5);
    f.lastCombat = this.time;
    f.atkFlash = 0.35;
    f.guarding = false;
    const wind = (SKILL_WIND[fx.k] ?? 0) / Math.max(1, this.buffSum(f, 'rof'));
    this.noise(f.x, f.z, 22 * (f.def.size === 'large' ? 1.5 : 1));
    this.emit({ k: 'skill', id: f.id, s: skill.id, w: wind, x: f.x, z: f.z, yaw }, f.x, f.z);
    if (wind > 0.001) {
      // the telegraph: everyone can see it coming and answer with a guard, a dodge or distance
      f.swing = { at: this.time + wind, start: this.time, kind: 'skill', combo: -1, heavy: fx.k === 'grab' || (fx.k === 'aoe' && fx.dmg > 0), skill, fx, yaw, wind };
      f.atkAt = Math.max(f.atkAt, this.time + wind + 0.25);
    } else this.fireSkill(f, skill, fx, yaw);
    return true;
  }

  private fireSkill(f: Fighter, skill: Skill, fx: Effect, yaw: number) {
    this.emit({ k: 'strike', id: f.id, s: skill.id, x: f.x, z: f.z, yaw }, f.x, f.z);
    this.runEffect(f, skill, fx);
    if (fx.k !== 'submerge' && fx.k !== 'buff' && fx.k !== 'heal' && f.subUntil > this.time) f.subUntil = 0;
  }

  private statusTo(src: Fighter | Mob | null, t: Body, st: Status[] | undefined, base: number) {
    if (!st) return;
    for (const s of st) {
      if (t.kind === 'f') {
        const f = t as Fighter;
        switch (s.s) {
          case 'bleed':
            if (f.mods.bleedImmune <= 0) f.bleed = { until: this.time + s.dur, dps: base * s.dps, src: src && src.kind === 'f' ? (src as Fighter).id : '' };
            break;
          case 'slow':
            f.slow = { until: this.time + s.dur, f: s.f };
            break;
          case 'mark':
            f.markUntil = this.time + s.dur;
            break;
          case 'stun':
            f.stunUntil = Math.max(f.stunUntil, this.time + s.dur);
            f.chan = null;
            f.swing = null;
            f.guarding = false;
            break;
          case 'scare':
            f.scareUntil = this.time + s.dur;
            break;
          case 'blind':
            f.blindUntil = Math.max(f.blindUntil, this.time + s.dur);
            break;
        }
      } else {
        const m = t as Mob;
        switch (s.s) {
          case 'bleed':
            m.bleedUntil = this.time + s.dur;
            m.bleedDps = base * s.dps;
            break;
          case 'slow':
            m.slowUntil = this.time + s.dur;
            break;
          case 'stun':
            m.stunUntil = this.time + s.dur;
            m.strikeAt = 0;
            break;
          case 'scare':
            this.scareMob(m, s.dur);
            break;
          case 'blind':
            m.slowUntil = this.time + s.dur; // a blinded animal stumbles
            break;
        }
      }
    }
  }

  private scareMob(m: Mob, dur: number) {
    if (m.def.behavior === 'alpha') return;
    if (m.state !== 'flee') m.fleeAt = this.time;
    m.scareUntil = this.time + dur;
    m.state = 'flee';
    m.until = this.time + dur;
  }

  private runEffect(f: Fighter, skill: Skill, fx: Effect) {
    const base = f.dv.dmg;
    const dm = (t: Body | null) => this.dmgMult(f, t);
    const hitPred = (b: Body) => b !== f && this.canHit(f, b);
    switch (fx.k) {
      case 'cone': {
        let hit = 0;
        const bs = this.bodies(f.x, f.z, fx.range, hitPred).filter((b) => this.inCone(f, b, fx.range, fx.arc));
        bs.sort((a, b) => dist(a, f) - dist(b, f));
        for (const b of bs) {
          this.hurt(b, base * fx.dmg * dm(b), f, { kind: skill.id, blockable: true, heavy: fx.dmg >= 1.6 });
          if (this.lastResult === 'hit') this.statusTo(f, b, fx.st, base);
          if (++hit >= (f.def.size === 'large' ? 6 : 3)) break;
        }
        break;
      }
      case 'aoe': {
        const bs = this.bodies(f.x, f.z, fx.r, hitPred);
        for (const b of bs) {
          if (fx.dmg > 0) this.hurt(b, base * fx.dmg * dm(b), f, { kind: skill.id, blockable: true, heavy: true });
          if (fx.dmg <= 0 || this.lastResult === 'hit') this.statusTo(f, b, fx.st, base);
          if (fx.scare && b.kind === 'm') this.scareMob(b as Mob, fx.scare);
          if (fx.scare && b.kind === 'f') (b as Fighter).scareUntil = this.time + fx.scare * 0.5;
        }
        // wild animals that are not "hit" still hear and react
        if (fx.scare) for (const m of this.mobs) if (m.hp > 0 && dist(m, f) < fx.r) this.scareMob(m, fx.scare);
        break;
      }
      case 'dash': {
        const dx = Math.sin(f.yaw);
        const dz = Math.cos(f.yaw);
        const dur = 0.22;
        f.dash = { dx, dz, speed: fx.dist / dur, until: this.time + dur, dmg: base * fx.dmg, hit: new Set(), st: fx.st, knock: fx.knock ?? 0, aoe: fx.aoe ?? 0 };
        if (fx.iframes) f.invUntil = this.time + fx.iframes;
        break;
      }
      case 'proj': {
        const sp = 30;
        const p: Proj = { id: this.nextProj++, x: f.x + Math.sin(f.yaw) * (f.r + 0.2), z: f.z + Math.cos(f.yaw) * (f.r + 0.2), vx: Math.sin(f.yaw) * sp, vz: Math.cos(f.yaw) * sp, left: fx.range, dmg: base * fx.dmg * dm(null), src: f, st: fx.st };
        this.projs.push(p);
        this.emit({ k: 'proj', id: p.id, x: p.x, z: p.z, tx: p.x + Math.sin(f.yaw) * fx.range, tz: p.z + Math.cos(f.yaw) * fx.range, kind: skill.id }, p.x, p.z);
        break;
      }
      case 'buff':
        f.buffs = f.buffs.filter((b) => b.id !== skill.id && b.until >= this.time);
        f.buffs.push({ id: skill.id, until: this.time + fx.dur, speed: fx.speed ?? 0, dmg: fx.dmg ?? 0, dr: fx.dr ?? 0, reflect: fx.reflect ?? 0, free: !!fx.free, rof: fx.rof ?? 0 });
        break;
      case 'heal':
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * fx.pct);
        if (fx.sta) f.sta = f.dv.maxSta;
        if (skill.id === 'dig_in') f.buffs.push({ id: 'dig_in', until: this.time + 3, speed: 0, dmg: 0, dr: 0.3, reflect: 0, free: false, rof: 0 });
        break;
      case 'grab': {
        const t = this.findGrab(f, fx.range);
        if (!t) break;
        let dps = fx.dps;
        if (skill.id === 'death_roll' && this.terrain.depthAt(f.x, f.z) < 0.2) dps *= 0.6;
        const g = { by: f as Body, until: this.time + fx.dur, dps: dps * base * dm(t) };
        if (t.kind === 'f') (t as Fighter).grab = g;
        else {
          (t as Mob).stunUntil = this.time + fx.dur;
        }
        f.holding = t;
        f.holdUntil = this.time + fx.dur;
        f.holdDps = g.dps;
        break;
      }
      case 'submerge':
        f.subUntil = this.time + fx.dur;
        break;
    }
  }

  private findGrab(f: Fighter, range: number): Body | null {
    const bs = this.bodies(f.x, f.z, range, (b) => b !== f && this.canHit(f, b)).filter((b) => this.inCone(f, b, range, 120));
    bs.sort((a, b) => dist(a, f) - dist(b, f));
    return bs[0] ?? null;
  }

  private inCone(f: Fighter, b: Body, range: number, arcDeg: number): boolean {
    const dx = b.x - f.x;
    const dz = b.z - f.z;
    const d = Math.hypot(dx, dz);
    if (d - b.r > range) return false;
    if (d < b.r + f.r + 0.4) return true;
    return Math.abs(angDiff(yawOf(dx, dz), f.yaw)) <= (arcDeg * Math.PI) / 360;
  }

  /** Every animal can dash: a short burst of speed, for timing a dodge or a chase. */
  dash(f: Fighter, dx: number, dz: number): boolean {
    if (f.hp <= 0 || f.role === 'out') return false;
    if (f.stunUntil > this.time || f.whiffUntil > this.time || f.grab || f.holding || f.dash || this.time < f.dashAt) return false;
    if (f.sta < DASH_COST && !this.hasFree(f)) return false;
    const l = Math.hypot(dx, dz);
    const ux = l > 0.1 ? dx / l : Math.sin(f.yaw);
    const uz = l > 0.1 ? dz / l : Math.cos(f.yaw);
    if (!this.hasFree(f)) f.sta -= DASH_COST;
    f.chan = null;
    f.swing = null; // a dash cancels a wind-up
    f.guarding = false;
    f.invUntil = Math.max(f.invUntil, this.time + 0.16); // slip through an attack that is landing
    f.dashAt = this.time + DASH_COOLDOWN * (1 + f.mods.dashCd);
    if (f.bot) f.yaw = Math.atan2(ux, uz); // a player keeps facing the camera while dashing
    const base = f.walkSpeed || f.dv.speed;
    f.dash = { dx: ux, dz: uz, speed: base * DASH_SPEED, until: this.time + DASH_TIME, dmg: 0, hit: new Set(), knock: 0, aoe: 0 };
    this.emit({ k: 'skill', id: f.id, s: 'dash', x: f.x, z: f.z, yaw: f.yaw }, f.x, f.z);
    return true;
  }

  // --- basic attack --------------------------------------------------------------------------

  /** Start the next swing of the combo. The damage lands after the wind-up, so it can be read and answered. */
  private basicAttack(f: Fighter) {
    if (this.time < f.atkAt || f.swing || f.stunUntil > this.time || f.whiffUntil > this.time || f.grab || f.chan || f.guarding) return;
    const combo = this.time - f.comboAt < COMBO_RESET ? (f.combo + 1) % 3 : 0;
    const c = COMBO[combo];
    const free = this.hasFree(f);
    if (!free) {
      if (f.sta < c.cost) return; // too tired to swing
      f.sta -= c.cost;
    }
    const rof = this.buffSum(f, 'rof');
    const wind = c.wind / rof;
    f.combo = combo;
    f.comboAt = this.time;
    f.lastCombat = this.time;
    f.atkFlash = wind + 0.2;
    f.swing = { at: this.time + wind, start: this.time, kind: 'basic', combo, heavy: combo === 2, yaw: f.yaw, wind };
    f.atkAt = this.time + (c.wind + c.rec) / rof;
    const reach = f.dv.reach * c.reach * (f.blindUntil > this.time ? 0.5 : 1);
    this.emit({ k: 'swing', id: f.id, c: combo, w: wind, h: combo === 2, r: reach, a: c.arc, x: f.x, z: f.z, yaw: f.yaw }, f.x, f.z);
    this.noise(f.x, f.z, 16 * (f.def.size === 'large' ? 1.5 : f.def.size === 'small' ? 0.6 : 1) * (1 + f.mods.noise));
  }

  /** An instant basic attack on one animal: what a dash turns into when it runs into something. */
  private strikeNow(f: Fighter, b: Body) {
    const c = COMBO[0];
    f.swing = null;
    f.combo = 0;
    f.comboAt = this.time;
    f.lastCombat = this.time;
    f.atkAt = this.time + c.rec;
    f.atkFlash = 0.3;
    const reach = f.dv.reach * c.reach;
    this.emit({ k: 'swing', id: f.id, c: 0, w: 0.05, h: false, r: reach, a: c.arc, x: f.x, z: f.z, yaw: f.yaw }, f.x, f.z);
    this.hurt(b, f.dv.dmg * c.dmg * this.dmgMult(f, b), f, { kind: 'bite', blockable: true });
    if (this.lastResult === 'hit') {
      if (f.mods.bleedOnHit > 0) this.statusTo(f, b, [{ s: 'bleed', dur: f.mods.bleedOnHit, dps: 0.2 }], f.dv.dmg);
      if (f.tusk > 0) {
        f.tusk--;
        this.statusTo(f, b, [{ s: 'bleed', dur: 5, dps: 0.3 }], f.dv.dmg);
      }
    }
    this.noise(f.x, f.z, 16 * (f.def.size === 'large' ? 1.5 : f.def.size === 'small' ? 0.6 : 1) * (1 + f.mods.noise));
  }

  /** The wind-up is over: the swing (or skill) lands now. */
  private resolveSwing(f: Fighter) {
    const sw = f.swing;
    f.swing = null;
    if (!sw) return;
    if (sw.kind === 'skill') {
      if (sw.skill && sw.fx) this.fireSkill(f, sw.skill, sw.fx, f.yaw);
      return;
    }
    const c = COMBO[sw.combo];
    const reach = f.dv.reach * c.reach * (f.blindUntil > this.time ? 0.5 : 1);
    const bs = this.bodies(f.x, f.z, reach, (b) => b !== f && this.canHit(f, b)).filter((b) => this.inCone(f, b, reach, c.arc));
    bs.sort((a, b) => dist(a, f) - dist(b, f));
    const cleave = f.def.size === 'large' && f.role === 'alive' ? 2 : 1;
    for (const b of bs.slice(0, cleave)) {
      const amount = f.dv.dmg * c.dmg * this.dmgMult(f, b);
      this.hurt(b, amount, f, { kind: 'bite', blockable: true, heavy: sw.heavy });
      if (this.lastResult !== 'hit') continue;
      if (f.mods.bleedOnHit > 0) this.statusTo(f, b, [{ s: 'bleed', dur: f.mods.bleedOnHit, dps: 0.2 }], f.dv.dmg);
      if (f.tusk > 0) {
        f.tusk--;
        this.statusTo(f, b, [{ s: 'bleed', dur: 5, dps: 0.3 }], f.dv.dmg);
      }
      if (sw.heavy && b.kind === 'f') (b as Fighter).slow = { until: this.time + 0.8, f: 0.5 };
    }
    if (f.subUntil > this.time && bs.length) f.subUntil = 0;
  }

  // --- guard, parry -------------------------------------------------------------------------

  /**
   * Tap to parry: the guard is up for a short window and cannot be taken back. A blow from the front that
   * lands inside it is parried; if nothing lands you are left fumbling (see `whiff`).
   */
  setGuard(f: Fighter, on: boolean) {
    if (!on) return; // releasing the button does nothing: a parry runs its course
    if (f.hp <= 0 || f.role === 'out') return;
    const t = this.time;
    if (f.guarding || t < f.guardCd || f.stunUntil > t || f.whiffUntil > t || f.grab || f.dash || f.holding) return;
    if (f.swing) {
      // changing your mind mid-swing: a feint, at a small stamina cost
      f.swing = null;
      f.sta = Math.max(0, f.sta - 6);
      f.atkAt = t + 0.2;
    }
    f.chan = null;
    f.guarding = true;
    f.guardAt = t;
  }

  /** The parry window ran out without catching a blow: guard down, a short fumble, a long recharge. */
  private whiff(f: Fighter) {
    f.guarding = false;
    f.whiffUntil = this.time + PARRY_MISS_STUN;
    f.guardCd = this.time + PARRY_MISS_CD;
    f.swing = null;
    this.emit({ k: 'whiff', id: f.id, x: f.x, z: f.z }, f.x, f.z);
  }

  // --- damage --------------------------------------------------------------------------------

  hurt(t: Body, raw: number, src: Body | null, o: { kind?: string; noReflect?: boolean; lava?: boolean; dot?: boolean; blockable?: boolean; heavy?: boolean } = {}): number {
    this.lastResult = 'hit';
    if (raw <= 0 || t.hp <= 0) return 0;
    const srcF = src?.kind === 'f' ? (src as Fighter) : null;
    const srcOwner = srcF;
    if (t.kind === 'm') {
      const m = t as Mob;
      let amount = raw;
      if (m.def.behavior === 'alpha') amount *= 1;
      m.hp -= amount;
      m.hurtFlash = 0.2;
      if (srcF) {
        srcF.dmgDealt += amount;
        srcF.lastCombat = this.time;
        if (srcF.mods.lifesteal > 0) srcF.hp = Math.min(srcF.maxHp, srcF.hp + amount * srcF.mods.lifesteal);
      }
      if (!o.dot && !o.lava) this.emit({ k: 'mobhit', x: m.x, z: m.z, n: Math.round(amount) }, m.x, m.z);
      // wake up and respond
      if (srcF) this.provoke(m, srcF);
      if (m.hp <= 0) this.killMob(m, srcF);
      return amount;
    }
    const f = t as Fighter;
    if (f.role === 'out') return 0;
    if (f.invUntil > this.time && !o.lava) {
      if (o.blockable) {
        this.lastResult = 'dodge';
        this.emit({ k: 'dodge', id: f.id, x: f.x, z: f.z }, f.x, f.z);
      }
      return 0;
    }
    let dr = Math.min(0.8, f.mods.dr + this.buffSum(f, 'dr'));
    if (o.lava) dr = this.time < f.mudUntil ? 0.6 : 0;
    let amount = raw * (1 - dr);
    if (srcF && srcF !== f && srcF.role === 'alive' && !o.lava && !o.dot) amount *= PVP_DAMAGE;
    // a blow from the front that lands inside the parry window is parried
    if (o.blockable && src && f.guarding && !o.lava && !o.dot) {
      const front = Math.abs(angDiff(yawOf(src.x - f.x, src.z - f.z), f.yaw)) < 1.3;
      if (front) {
        this.lastResult = 'parry';
        const heavy = !!o.heavy;
        if (src.kind === 'f') {
          const a = src as Fighter;
          a.stunUntil = Math.max(a.stunUntil, this.time + PARRY_STUN);
          a.swing = null;
          a.chan = null;
          a.guarding = false;
          a.sta = Math.max(0, a.sta - (heavy ? 18 : 10));
        } else {
          const m = src as Mob;
          m.stunUntil = this.time + PARRY_STUN;
          m.strikeAt = 0;
        }
        f.guarding = false;
        f.guardCd = this.time + PARRY_HIT_CD; // a clean parry recharges fast
        f.sta = Math.min(f.dv.maxSta, f.sta + 18);
        f.counterUntil = this.time + 1.6;
        this.emit({ k: 'parry', id: f.id, by: src.kind === 'f' ? (src as Fighter).id : '', x: f.x, z: f.z, heavy, mob: src.kind === 'm' ? (src as Mob).id : undefined, stun: PARRY_STUN }, f.x, f.z);
        return 0;
      }
    }
    if (!this.campus) f.hp -= amount; // in the campus the numbers fly but nobody loses anything
    f.lastHurt = this.time;
    f.lastCombat = this.time;
    f.chan = null;
    if (srcOwner && srcOwner !== f) {
      f.lastAttacker = srcOwner.id;
      f.recentAttackers.set(srcOwner.id, this.time);
    }
    if (srcF && srcF !== f) {
      srcF.dmgDealt += amount;
      srcF.lastCombat = this.time;
      if (srcF.mods.lifesteal > 0) srcF.hp = Math.min(srcF.maxHp, srcF.hp + amount * srcF.mods.lifesteal);
    }
    if (!o.dot && !o.lava) this.emit({ k: 'hit', id: f.id, x: f.x, z: f.z, n: Math.round(amount) }, f.x, f.z);
    // thorns
    const refl = f.mods.reflect + this.buffSum(f, 'reflect');
    if (refl > 0 && src && !o.noReflect && !o.lava && !o.dot) this.hurt(src, amount * refl, f, { noReflect: true, kind: 'quill' });
    if (f.mods.attackerBleed > 0 && src && src.kind === 'f' && !o.dot && !o.lava) this.statusTo(f, src, [{ s: 'bleed', dur: f.mods.attackerBleed, dps: 0.2 }], f.dv.dmg);
    if (f.hp <= 0) {
      if (f.mods.cheatDeath > 0 && !f.usedCheat && f.role === 'alive') {
        f.usedCheat = true;
        f.hp = f.maxHp * f.mods.cheatDeath;
        f.invUntil = this.time + 1.2;
        this.toast(f.id, 'Unkillable!');
        return amount;
      }
      this.kill(f, srcOwner, o.lava ? 'lava' : (o.kind ?? 'bite'));
    }
    return amount;
  }

  private provoke(m: Mob, by: Fighter) {
    if (m.pack) {
      for (const o of this.mobs) if (o.pack === m.pack && o.hp > 0) this.aggro(o, by);
    } else this.aggro(m, by);
  }
  private aggro(m: Mob, by: Fighter) {
    if (m.def.behavior === 'alpha') {
      m.state = 'attack';
      m.target = by;
      m.until = this.time + 12;
      return;
    }
    // everything else stays put: wild animals do not run away
  }

  // --- deaths --------------------------------------------------------------------------------

  private killMob(m: Mob, by: Fighter | null) {
    m.hp = 0;
    if (by && by.role === 'alive') {
      let xp = hordeXp(m.def.tier, by.level);
      xp *= 1 + by.mods.preyXp;
      this.gainXp(by, xp);
      by.lastCombat = this.time;
    }
    // drops
    const def = m.def;
    if (def.meat > 0) this.addDrop(m.x, m.z, [{ k: 'meat', n: def.meat, born: this.time }], 90);
    if (def.id === 'sparrow' && this.rnd() < 0.08) this.addDrop(m.x, m.z, [{ k: 'feather', n: 1, born: this.time }], 120);
    if (def.id === 'wildpig' && this.rnd() < 0.5) this.addDrop(m.x + 0.6, m.z, [{ k: 'tusk', n: 1, born: this.time }], 120);
    if (def.behavior === 'alpha') {
      this.addDrop(m.x, m.z, [{ k: 'musk', n: 1, born: this.time }], 240);
      this.addDrop(m.x + 1, m.z + 1, [{ k: 'tusk', n: 1, born: this.time }], 240);
      this.emit({ k: 'toast', text: `The ${def.name} has fallen!` });
    }
  }

  private kill(f: Fighter, killer: Fighter | null, how: string) {
    if (f.role !== 'alive') return;
    // a living player falls: drop everything as a loot pile, credit the kill
    const items = f.inv.filter((i): i is InvItem => !!i && (i.k !== 'water' || i.n > 0));
    f.inv.fill(null);
    if (items.length) this.addDrop(f.x, f.z, items, 180, true);
    f.streak = 0; // falling ends your streak
    if (killer && killer.role === 'alive' && killer !== f) {
      killer.kills++;
      this.creditStreak(killer);
      this.gainXp(killer, killXp(f.totalXp, f.level, killer.level));
      for (const tm of this.fighters) {
        if (tm !== killer && tm.team === killer.team && tm.role === 'alive' && dist(tm, killer) < 70) this.gainXp(tm, killXp(f.totalXp, f.level, tm.level) * 0.25);
      }
      killer.hp = Math.min(killer.maxHp, killer.hp + killer.maxHp * 0.15);
    }
    // assists and credit when the killing blow was lava
    if (!killer || killer === f) {
      const recent = [...f.recentAttackers.entries()].filter(([, t]) => this.time - t < 10).sort((a, b) => b[1] - a[1])[0];
      if (recent) {
        const k = this.byId.get(recent[0]);
        if (k && k.role === 'alive' && k !== f) {
          k.kills++;
          this.creditStreak(k);
          this.gainXp(k, killXp(f.totalXp, f.level, k.level) * 0.7);
        }
      }
    }
    this.emit({ k: 'kill', killer: killer?.id ?? '', victim: f.id, how }, f.x, f.z);
    f.deathX = f.x;
    f.deathZ = f.z;
    f.chan = null;
    f.dash = undefined;
    f.grab = undefined;
    f.holding = undefined;
    f.bleed = undefined;
    f.subUntil = 0;
    f.buffs = [];
    f.hunted = false;
    // death is final: you spectate, untouchable, until the match ends
    f.role = 'out';
    f.input.at = false;
    f.moving = false;
    f.hp = f.maxHp;
    f.invUntil = this.time + 9999;
    // team elimination
    if (!this.fighters.some((o) => o.team === f.team && o.role === 'alive')) {
      this.teamsAlive.delete(f.team);
      const place = this.teamsAlive.size + 1;
      for (const o of this.fighters) if (o.team === f.team) o.place = place;
    }
    this.rosterDirty = true;
    this.emit({ k: 'toast', to: f.id, text: 'You were eliminated. Click to watch someone else, or head back to the campus.' });
  }

  /** Kills in quick succession build a streak that the whole match gets to see. */
  private creditStreak(k: Fighter) {
    k.streak = this.time - k.streakAt < 25 ? k.streak + 1 : 1;
    k.streakAt = this.time;
    if (k.streak >= 2) this.emit({ k: 'streak', id: k.id, n: k.streak });
  }

  private addDrop(x: number, z: number, items: InvItem[], ttl: number, pile = false) {
    this.drops.push({ id: this.nextDrop++, x, z, items, ttl: this.time + ttl, pile });
  }

  // --- inventory and harvesting ------------------------------------------------------------------

  private give(f: Fighter, item: InvItem): boolean {
    const cap = item.k === 'berry' ? 3 : item.k === 'meat' ? 4 : 1;
    if (item.k === 'water') {
      const w = f.inv.find((s) => s?.k === 'water');
      if (w) {
        w.n = Math.min(2, w.n + item.n);
        return true;
      }
    }
    // top up stacks first (berries 3, meat 4), then use empty slots
    if (cap > 1) {
      for (const st of f.inv) {
        if (!st || st.k !== item.k || st.n >= cap) continue;
        const add = Math.min(cap - st.n, item.n);
        st.n += add;
        st.born = Math.min(st.born, item.born); // a stack is as stale as its oldest piece
        item.n -= add;
        if (item.n <= 0) return true;
      }
      while (item.n > 0) {
        const idx = f.inv.indexOf(null);
        if (idx < 0) return false;
        const n = Math.min(cap, item.n);
        f.inv[idx] = { k: item.k, n, born: item.born };
        item.n -= n;
      }
      return true;
    }
    const idx = f.inv.indexOf(null);
    if (idx < 0) return false;
    f.inv[idx] = { ...item };
    return true;
  }

  /** Walking over fresh meat (and trophies) picks it up: no button, no wait. */
  private autoPickup(f: Fighter) {
    for (let i = this.drops.length - 1; i >= 0; i--) {
      const d = this.drops[i];
      if (d.items[0]?.k === 'morsel') {
        // a morsel is eaten the moment you touch it: a little XP and a nibble of health
        if (Math.hypot(d.x - f.x, d.z - f.z) > 1.6) continue;
        this.drops.splice(i, 1);
        this.gainXp(f, MORSEL_XP);
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.01);
        f.sta = Math.min(f.dv.maxSta, f.sta + 3);
        this.emit({ k: 'pickup', id: f.id, item: 'morsel', n: 1 }, f.x, f.z);
        continue;
      }
      if (d.pile || Math.abs(d.x - f.x) > 1.9 || Math.abs(d.z - f.z) > 1.9 || Math.hypot(d.x - f.x, d.z - f.z) > 1.9) continue;
      const before = d.items.reduce((s, it) => s + it.n, 0);
      d.items = d.items.filter((it) => !this.give(f, { ...it }));
      const left = d.items.reduce((s, it) => s + it.n, 0);
      const got = before - left;
      if (got > 0) this.emit({ k: 'pickup', id: f.id, item: before === got ? (d.items[0]?.k ?? 'meat') : 'meat', n: got }, f.x, f.z);
      if (!d.items.length) this.drops.splice(i, 1);
    }
  }

  private startHarvest(f: Fighter) {
    if (f.role !== 'alive' || f.chan || f.stunUntil > this.time) return;
    let best: { id: number; kind: string; d: number } | null = null;
    for (const r of this.terrain.near(f.x, f.z, 3.4)) {
      if (!(r.kind in HARVEST_TIME)) continue;
      if ((this.nodeUntil.get(r.id) ?? 0) > this.time) continue;
      const d = Math.hypot(r.x - f.x, r.z - f.z);
      if (d < 3.4 + r.s * 0.4 && (!best || d < best.d)) best = { id: r.id, kind: r.kind, d };
    }
    if (!best) {
      this.toast(f.id, 'Nothing to harvest here.');
      return;
    }
    if (best.kind !== 'hive' && best.kind !== 'mud' && best.kind !== 'reed' && f.inv.every((s) => s) && !f.inv.some((s) => s?.k === 'berry' && s.n < 3)) {
      this.toast(f.id, 'Inventory full.');
      return;
    }
    const total = HARVEST_TIME[best.kind];
    f.chan = { k: 'harvest', until: this.time + total, total, node: best.id, x: f.x, z: f.z };
    this.noise(f.x, f.z, 20);
  }

  private finishHarvest(f: Fighter, id: number) {
    const r = this.terrain.res[id];
    if (!r || (this.nodeUntil.get(id) ?? 0) > this.time) return;
    let item: InvItem | null = null;
    switch (r.kind) {
      case 'berry':
        item = { k: 'berry', n: 2, born: this.time };
        break;
      case 'fruit':
        item = { k: 'berry', n: 3, born: this.time };
        break;
      case 'herb':
        item = { k: 'herb', n: 1, born: this.time };
        break;
      case 'mud':
        item = { k: 'mud', n: 1, born: this.time };
        break;
      case 'hive':
        item = { k: 'honey', n: 1, born: this.time };
        this.hurt(f, 4, null, { dot: true, kind: 'bees' }); // bees object
        break;
      case 'reed':
        item = { k: 'reed', n: 1, born: this.time };
        break;
    }
    if (!item) return;
    if (!this.give(f, item)) {
      this.toast(f.id, 'Inventory full.');
      return;
    }
    const until = this.time + (NODE_RESPAWN[r.kind] ?? 60);
    this.nodeUntil.set(id, until);
    this.emit({ k: 'node', id, until });
  }

  private startDrink(f: Fighter) {
    if (f.role !== 'alive' || f.chan) return;
    if (this.terrain.depthAt(f.x, f.z) < 0.12 && !this.nearWater(f.x, f.z)) {
      this.toast(f.id, 'Find water to fill your pouch.');
      return;
    }
    const w = f.inv.find((s) => s?.k === 'water');
    if (w && w.n >= 2) {
      this.toast(f.id, 'Your pouch is full.');
      return;
    }
    if (!w && f.inv.every((s) => s)) {
      this.toast(f.id, 'Inventory full.');
      return;
    }
    f.chan = { k: 'drink', until: this.time + 1.6, total: 1.6, x: f.x, z: f.z };
  }
  private nearWater(x: number, z: number) {
    for (let a = 0; a < 8; a++) if (this.terrain.depthAt(x + Math.cos(a * 0.785) * 2.2, z + Math.sin(a * 0.785) * 2.2) > 0.15) return true;
    return false;
  }

  startLoot(f: Fighter) {
    if (f.chan || f.stunUntil > this.time) return;
    if (f.role !== 'alive') return;
    const d = this.nearestDrop(f.x, f.z, 3.2);
    if (!d) {
      this.toast(f.id, 'Nothing to pick up.');
      return;
    }
    f.chan = { k: 'loot', until: this.time + (d.pile ? 1.2 : 0.7), total: d.pile ? 1.2 : 0.7, node: d.id, x: f.x, z: f.z };
  }
  private nearestDrop(x: number, z: number, r: number): Drop | null {
    let best: Drop | null = null;
    let bd = r;
    for (const d of this.drops) {
      const dd = Math.hypot(d.x - x, d.z - z);
      if (dd < bd) {
        bd = dd;
        best = d;
      }
    }
    return best;
  }
  private finishLoot(f: Fighter, id: number) {
    const i = this.drops.findIndex((d) => d.id === id);
    if (i < 0 || this.drops[i].items[0]?.k === 'morsel') return;
    const d = this.drops[i];
    const left: InvItem[] = [];
    for (const it of d.items) {
      if (it.k === 'meat') it.born = this.time;
      if (!this.give(f, { ...it })) left.push(it);
    }
    if (left.length) {
      d.items = left;
      this.toast(f.id, 'Inventory full.');
    } else this.drops.splice(i, 1);
  }

  private dropItem(f: Fighter, slot: number) {
    const it = f.inv[slot];
    if (!it || f.role !== 'alive') return;
    f.inv[slot] = null;
    this.addDrop(f.x + Math.sin(f.yaw) * 1.5, f.z + Math.cos(f.yaw) * 1.5, [it], 120);
  }

  useItem(f: Fighter, slot: number): boolean {
    const it = f.inv[slot];
    if (!it || f.role !== 'alive' || f.chan || f.stunUntil > this.time) return false;
    switch (it.k) {
      case 'meat':
        f.chan = { k: 'eat', until: this.time + 0.9, total: 0.9, slot, x: f.x, z: f.z };
        this.noise(f.x, f.z, 12);
        return true;
      case 'berry':
        f.chan = { k: 'eat', until: this.time + 0.9, total: 0.9, slot, x: f.x, z: f.z };
        return true;
      case 'herb':
        f.chan = { k: 'eat', until: this.time + 1.0, total: 1.0, slot, x: f.x, z: f.z };
        return true;
      case 'water':
        if (it.n <= 0) {
          this.toast(f.id, 'The pouch is empty. Fill it at water.');
          return false;
        }
        f.chan = { k: 'eat', until: this.time + 0.8, total: 0.8, slot, x: f.x, z: f.z };
        return true;
      default: {
        if (f.ability && f.ability.until > this.time) {
          this.toast(f.id, 'Only one item ability at a time.');
          return false;
        }
        this.activateAbility(f, slot, it);
        return true;
      }
    }
  }

  private finishEat(f: Fighter, slot: number) {
    const it = f.inv[slot];
    if (!it) return;
    const boost = 1 + f.mods.eatBoost;
    if (f.role === 'alive' && f.hp >= f.maxHp - 0.5 && (it.k === 'meat' || it.k === 'berry')) this.gainXp(f, 8); // a full belly still teaches you something
    switch (it.k) {
      case 'meat': {
        // one piece at a time: a stack of four keeps you fed through a fight
        const spoiled = this.time - it.born > MEAT_SPOIL;
        if (!spoiled) f.hot = { until: this.time + 4, perSec: Math.max(f.hot?.perSec ?? 0, f.maxHp * 0.032 * boost) };
        else this.toast(f.id, 'The meat was rotten!');
        it.n--;
        if (it.n <= 0) f.inv[slot] = null;
        break;
      }
      case 'berry':
        f.hp = Math.min(f.maxHp, f.hp + f.maxHp * 0.05 * boost);
        f.sta = Math.min(f.dv.maxSta, f.sta + 30);
        it.n--;
        if (it.n <= 0) f.inv[slot] = null;
        break;
      case 'herb':
        f.bleed = undefined;
        f.speedUntil = this.time + 10;
        f.inv[slot] = null;
        break;
      case 'water':
        f.sta = Math.min(f.dv.maxSta, f.sta + 55);
        it.n--;
        break;
    }
  }

  private activateAbility(f: Fighter, slot: number, it: InvItem) {
    const t = this.time;
    switch (it.k) {
      case 'mud':
        f.mudUntil = t + 14;
        f.ability = { k: 'mud', until: t + 14 };
        break;
      case 'honey': {
        const x = f.x + Math.sin(f.yaw) * 12;
        const z = f.z + Math.cos(f.yaw) * 12;
        this.lure = { x, z, until: t + 14 };
        f.ability = { k: 'honey', until: t + 3 };
        this.emit({ k: 'lure', x, z }, x, z);
        break;
      }
      case 'feather':
        f.glideUntil = t + 4;
        f.ability = { k: 'feather', until: t + 4 };
        break;
      case 'tusk':
        f.tusk = 5;
        f.ability = { k: 'tusk', until: t + 20 };
        break;
      case 'musk':
        f.muskUntil = t + 20;
        f.hunted = false;
        f.ability = { k: 'musk', until: t + 20 };
        break;
      case 'reed':
        f.reedUntil = t + 12;
        f.ability = { k: 'reed', until: t + 12 };
        break;
      default:
        return;
    }
    f.inv[slot] = null;
  }

  // --- mobs -----------------------------------------------------------------------------------

  /** Wild prey has half the health (it is food); the alpha keeps its own. */
  private mobHp(def: MobDef): number {
    const keep = def.behavior === 'alpha';
    return keep ? def.hp : Math.max(3, Math.round(def.hp * 0.5));
  }

  private makeMob(def: MobDef, x: number, z: number, pack: number): Mob {
    return {
      kind: 'm', id: this.nextMob++, def, x, z, y: 0, yaw: this.rnd() * 6.28, hp: this.mobHp(def), maxHp: this.mobHp(def), r: def.r, state: 'idle', until: 0, tx: x, tz: z,
      homeX: x, homeZ: z, target: null, pack, atkAt: 0, awake: false, atkFlash: 0, slowUntil: 0, stunUntil: 0, bleedUntil: 0, bleedDps: 0,
      scareUntil: 0, wander: this.rnd() * 5, hurtFlash: 0, strikeAt: 0, fleeAt: 0, jit: 0, pauseUntil: 0,
    };
  }

  private pickDef(tier: number, biome: Biome | null): MobDef | null {
    const pool = MOBS.filter((m) => m.tier === tier && (biome === null || m.biomes.includes(biome)));
    return pool.length ? pool[Math.floor(this.rnd() * pool.length)] : null;
  }

  /** Spawn a group of `tier` somewhere inside `radius`, not within `avoidPlayers` metres of a fighter. */
  spawnWild(tier: number, radius: number, avoidPlayers: number): boolean {
    for (let attempt = 0; attempt < 14; attempt++) {
      const wet = tier <= 3 && this.rnd() < 0.2 ? this.terrain.randomWater(this.rnd, radius) : null;
      const pos = wet ?? this.terrain.randomLand(this.rnd, radius, tier >= 3 ? Math.min(20, radius * 0.3) : 0);
      if (avoidPlayers > 0 && this.fighters.some((f) => f.role === 'alive' && dist(f, pos) < avoidPlayers)) continue;
      if (this.spawnWildAt(tier, pos.x, pos.z)) return true;
    }
    return false;
  }

  spawnWildAt(tier: number, x: number, z: number): boolean {
    const water = this.terrain.heightAt(x, z) < WATER_Y - 0.6;
    const biome = this.terrain.biomeAt(x, z);
    const pool = MOBS.filter((d) => d.tier === tier && (water ? d.aquatic : !d.aquatic && d.biomes.includes(biome)));
    if (!pool.length) return false;
    const def = pool[Math.floor(this.rnd() * pool.length)];
    const n = def.group[0] + Math.floor(this.rnd() * (def.group[1] - def.group[0] + 1));
    const pack = n > 1 ? this.nextPack++ : 0;
    for (let i = 0; i < n; i++) {
      let px = x + (this.rnd() - 0.5) * 7;
      let pz = z + (this.rnd() - 0.5) * 7;
      if (def.aquatic) {
        if (this.terrain.heightAt(px, pz) > WATER_Y - 0.5) {
          px = x;
          pz = z;
        }
      } else {
        const c = this.terrain.collide(px, pz, def.r);
        px = c.x;
        pz = c.z;
        if (this.terrain.heightAt(px, pz) < WATER_Y + 0.1 && !def.amphibious) {
          px = x;
          pz = z;
        }
      }
      const m = this.makeMob(def, px, pz, pack);
      m.y = this.mobY(m);
      this.mobs.push(m);
    }
    return true;
  }

  private mobY(m: Mob): number {
    const h = this.terrain.heightAt(m.x, m.z);
    if (m.def.aquatic) return WATER_Y - 0.5;
    if (m.def.flies) return Math.max(h, WATER_Y) + 0.9 + Math.sin(this.time * 9 + m.id) * 0.25;
    return Math.max(h, WATER_Y - 0.4);
  }

  private spawnAlpha() {
    this.alphaSpawned = true;
    const gator = this.terrain.heightAt(0, 0) < WATER_Y - 0.6 && this.rnd() < 0.5;
    const def = mobDef(gator ? 'alpha_gator' : 'alpha_bear');
    const x = gator ? 0 : 0;
    const z = gator ? 0 : 18;
    const m = this.makeMob(def, x, z, 0);
    m.awake = true;
    this.mobs.push(m);
    this.emit({ k: 'alpha', x, z });
    this.emit({ k: 'toast', text: `An ${def.name} has appeared at the centre!` });
  }

  private updateAwake() {
    if (this.time - this.lastAwake < 0.5) return;
    this.lastAwake = this.time;
    const pts = this.fighters.filter((f) => f.hp > 0 && f.role !== 'out');
    for (const m of this.mobs) {
      let near = this.migrating > 0 && !m.def.aquatic;
      if (!near) {
        for (const f of pts) {
          if (Math.abs(f.x - m.x) < 120 && Math.abs(f.z - m.z) < 120) {
            near = true;
            break;
          }
        }
      }
      if (near && !m.awake) {
        m.awake = true;
        m.wander = this.rnd() * 3;
      }
      if (!near) m.awake = false;
    }
  }

  /** Small food scattered at random over the ground, like the pellets in deeeep.io: always something to nibble. */
  private scatterMorsels(max: number) {
    const ring = ringAt(this.ringTime()).r;
    const want = this.campus ? 300 : 240;
    let have = 0;
    for (const d of this.drops) if (d.items[0]?.k === 'morsel') have++;
    for (let i = 0; i < Math.min(want - have, max); i++) {
      const p = this.terrain.randomLand(this.rnd, Math.min(ring - 6, MAP_RADIUS - 25));
      this.drops.push({ id: this.nextDrop++, x: p.x, z: p.z, items: [{ k: 'morsel', n: 1, born: this.time }], ttl: this.time + 1500, pile: false });
    }
  }

  private maintainPopulation() {
    if (this.time - this.lastPop < 4) return;
    this.lastPop = this.time;
    this.scatterMorsels(40);
    const ring = ringAt(this.ringTime()).r;
    // only animals still inside the lava count, and the herds shrink with the ring (a small ring cannot hold hundreds)
    const wild = this.mobs.filter((m) => m.hp > 0 && Math.hypot(m.x, m.z) < ring);
    const count = (t: number) => wild.filter((m) => m.def.tier === t).length;
    const area = Math.pow(Math.min(1, ring / (MAP_RADIUS - 6)), 2);
    const inner = ring - 6; // never spawn on the lava's edge
    const targets: [number, number, number][] = [
      [1, Math.max(16, Math.round((this.time < 240 ? 500 : 400) * area)), Math.min(inner, MAP_RADIUS - 25)],
      [2, this.time > 90 ? Math.max(12, Math.round(230 * area)) : 0, Math.min(inner, MAP_RADIUS * 0.7)],
      [3, this.time > 90 ? Math.max(6, Math.round(55 * area)) : 0, Math.min(inner, MAP_RADIUS * 0.5)],
    ];
    // late in the match there must still be food to heal on: keep spawning, closer to the players when the ring is small
    const avoid = Math.min(70, Math.max(10, inner * 0.3));
    for (const [tier, want, radius] of targets) {
      if (want === 0 || radius < 14) continue;
      let have = count(tier);
      let guard = 0;
      while (have < want * (tier === 1 ? 1 : 0.9) && guard++ < (ring < 120 ? 5 : 3)) {
        if (!this.spawnWild(tier, radius, avoid)) break;
        have += tier === 3 ? 1 : 3;
      }
    }
    // compact the dead
    this.mobs = this.mobs.filter((m) => m.hp > 0);
    this.drops = this.drops.filter((d) => d.ttl > this.time && d.items.length);
  }

  private updateMobs() {
    const ring = ringAt(this.ringTime());
    const dt = DT;
    const living = this.fighters.filter((f) => f.role === 'alive' && f.hp > 0 && f.subUntil <= this.time);
    const mig = this.migrating > 0;
    for (const m of this.mobs) {
      if (m.hp <= 0 || !m.awake) continue;
      m.atkFlash = Math.max(0, m.atkFlash - dt);
      m.hurtFlash = Math.max(0, m.hurtFlash - dt);
      if (m.stunUntil > this.time) {
        m.strikeAt = 0;
        continue;
      }
      if (m.bleedUntil > this.time) this.hurt(m, m.bleedDps * dt, null, { dot: true });
      if (m.hp <= 0) continue;
      const slow = m.slowUntil > this.time ? 0.55 : 1;
      let speed = m.def.speed * slow;
      const behavior = m.def.behavior;
      const threatR = m.def.behavior === 'alpha' ? 24 : behavior === 'elite' ? 5 : behavior === 'pack' ? 6 : behavior === 'skittish' ? 3 : 6;

      // lava drives wildlife inward
      const rr = Math.hypot(m.x, m.z);
      if (rr > ring.r - 4) {
        this.moveMob(m, -m.x, -m.z, speed, dt);
        continue;
      }

      if (mig && m.state !== 'attack' && !m.def.aquatic && m.def.behavior !== 'alpha' && Math.hypot(m.x, m.z) > 35) {
        m.state = 'stampede';
        this.moveMob(m, -m.x, -m.z, speed * 1.35, dt);
        // trampling
        for (const f of living) {
          if (dist(f, m) < f.r + m.r + 0.3 && this.time - m.atkAt > 1) {
            m.atkAt = this.time;
            this.hurt(f, 2 + m.def.tier * 2, m, { kind: 'stampede' });
          }
        }
        continue;
      }
      if (m.state === 'stampede') m.state = 'idle';

      // honey draws the herd
      if (this.lure && this.lure.until > this.time && dist(m, this.lure) < 45 && m.def.behavior !== 'alpha' && !m.def.aquatic) {
        if (dist(m, this.lure) > 2.5) this.moveMob(m, this.lure.x - m.x, this.lure.z - m.z, speed, dt);
        continue;
      }

      // find the nearest living player
      let nearest: Fighter | null = null;
      let nd = Infinity;
      for (const f of living) {
        const d = dist(f, m);
        if (d < nd && d < 40) {
          nd = d;
          nearest = f;
        }
      }
      const stealth = nearest ? (nearest.input.crouch ? 0.5 : 1) * (this.terrain.inBush(nearest.x, nearest.z) ? 0.4 : 1) * (nearest.muskUntil > this.time ? 0.7 : 1) : 1;
      const detect = threatR * stealth * (nearest ? Math.max(0.3, 1 - nearest.mods.stealth) : 1);

      switch (m.state) {
        case 'flee': {
          const t = m.target ?? nearest;
          // not very bright: it zig-zags, sometimes freezes, tires fast and soon forgets what scared it
          m.wander -= dt;
          if (m.wander <= 0) {
            m.wander = 0.45 + this.rnd() * 0.9;
            m.jit = (this.rnd() - 0.5) * 2.2;
            if (this.rnd() < 0.3) m.pauseUntil = this.time + 0.4 + this.rnd() * 0.5;
          }
          const tired = 1 - Math.min(0.55, Math.max(0, this.time - m.fleeAt - 1.2) * 0.2);
          if (this.time < m.pauseUntil) {
            // frozen in place
          } else if (t && dist(t, m) < 18 && m.until > this.time) {
            const ax = m.x - t.x;
            const az = m.z - t.z;
            const c = Math.cos(m.jit);
            const sn = Math.sin(m.jit);
            this.moveMob(m, ax * c - az * sn, ax * sn + az * c, speed * 0.92 * tired, dt);
          } else if (m.scareUntil > this.time) this.moveMob(m, m.x - (nearest?.x ?? 0), m.z - (nearest?.z ?? 0), speed * 1.0, dt);
          else m.state = 'idle';
          if (m.until <= this.time) m.state = 'idle';
          break;
        }
        case 'attack': {
          const t = m.target;
          const leash = m.def.behavior === 'alpha' ? 45 : m.def.behavior === 'elite' ? 30 : 32;
          if (!t || t.hp <= 0 || t.role !== 'alive' || dist(t, m) > leash || m.until < this.time || (t.subUntil > this.time && dist(t, m) > 6)) {
            m.state = 'idle';
            m.target = null;
            m.tx = m.homeX;
            m.tz = m.homeZ;
            break;
          }
          if (m.def.behavior === 'alpha' && Math.hypot(m.x, m.z) > 60) {
            m.state = 'idle';
            break;
          }
          this.chaseAndBite(m, t, speed, dt);
          break;
        }
        case 'investigate': {
          if (dist(m, { x: m.tx, z: m.tz }) < 3 || m.until < this.time) m.state = 'idle';
          else this.moveMob(m, m.tx - m.x, m.tz - m.z, speed * 0.8, dt);
          if (nearest && nd < detect) this.engage(m, nearest);
          break;
        }
        default: {
          if (nearest && nd < detect) {
            this.engage(m, nearest);
            break;
          }
          // wander around home
          m.wander -= dt;
          if (m.wander <= 0) {
            m.wander = 2 + this.rnd() * 5;
            if (this.rnd() < 0.55) {
              const a = this.rnd() * 6.28;
              const r = this.rnd() * 7;
              m.tx = m.homeX + Math.cos(a) * r;
              m.tz = m.homeZ + Math.sin(a) * r;
            } else {
              m.tx = m.x;
              m.tz = m.z;
            }
          }
          if (dist(m, { x: m.tx, z: m.tz }) > 0.8) this.moveMob(m, m.tx - m.x, m.tz - m.z, speed * 0.4, dt);
        }
      }
      m.y = this.mobY(m);
    }
    // react to noises
    for (const n of this.noises) {
      for (const m of this.mobs) {
        if (m.hp <= 0 || !m.awake || m.state !== 'idle') continue;
        if (m.def.behavior !== 'alpha') continue; // prey does not walk toward trouble
        if (dist(m, n) < n.r) {
          m.state = 'investigate';
          m.tx = n.x;
          m.tz = n.z;
          m.until = this.time + 8;
        }
      }
    }
    this.noises.length = 0;
  }

  private engage(m: Mob, f: Fighter) {
    if (m.def.behavior === 'alpha') {
      this.aggro(m, f);
      return;
    }
    // everything else stands its ground: wild animals do not run away
  }

  /** Alphas: a slow, readable attack. The wind-up can be parried to stagger the beast. */
  private chaseAndBite(m: Mob, t: Fighter, speed: number, dt: number) {
    const d = dist(m, t);
    const alpha = m.def.behavior === 'alpha';
    const reach = m.r + t.r + 0.5 + (alpha ? 1.4 : 0);
    if (m.strikeAt) {
      if (this.time >= m.strikeAt) {
        m.strikeAt = 0;
        if (alpha) {
          for (const b of this.bodies(m.x, m.z, m.r + 2.6, (x) => x.kind === 'f' && this.canHit(m, x))) {
            const f = b as Fighter;
            if (Math.abs(angDiff(yawOf(f.x - m.x, f.z - m.z), m.yaw)) > 1.5 && dist(f, m) > m.r + 1.2) continue; // it swings forward
            this.hurt(f, m.def.dmg, m, { kind: 'alpha', blockable: true, heavy: true });
            if (this.lastResult === 'hit') this.statusTo(m, f, [{ s: 'slow', dur: 1.5, f: 0.5 }], m.def.dmg);
          }
        } else if (dist(m, t) < reach + 0.4) this.hurt(t, m.def.dmg * (0.85 + this.rnd() * 0.3), m, { kind: m.def.id, blockable: true, heavy: false });
      }
    } else if (d > reach) this.moveMob(m, t.x - m.x, t.z - m.z, speed * (alpha ? 1 : 1.05), dt);
    else if (this.time >= m.atkAt) {
      const wind = alpha ? 0.62 : 0.42;
      m.yaw = yawOf(t.x - m.x, t.z - m.z);
      m.strikeAt = this.time + wind;
      m.atkAt = this.time + (alpha ? 2.3 : 1.3);
      m.atkFlash = wind + 0.25;
      this.emit({ k: 'mswing', id: m.id, x: m.x, z: m.z, yaw: m.yaw, w: wind, r: m.r + (alpha ? 2.6 : 1.4), big: alpha }, m.x, m.z);
    }
    m.y = this.mobY(m);
  }

  private moveMob(m: Mob, dx: number, dz: number, speed: number, dt: number) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    m.yaw = yawOf(dx, dz);
    const p = { x: m.x, z: m.z };
    const wasDeep = this.terrain.isDeep(m.x, m.z);
    if (m.def.aquatic) {
      const nx = m.x + (dx / l) * speed * dt;
      const nz = m.z + (dz / l) * speed * dt;
      if (this.terrain.heightAt(nx, nz) < WATER_Y - 0.4) {
        m.x = nx;
        m.z = nz;
      } else {
        // bounce off the shore
        m.state = m.state === 'attack' ? 'idle' : m.state;
        m.tx = m.homeX;
        m.tz = m.homeZ;
      }
      return;
    }
    stepPos(this.terrain, p, dx, dz, speed * dt * (wasDeep && !m.def.amphibious ? 0.4 : 1), m.r, MAP_BOUND);
    if (!m.def.amphibious && this.terrain.heightAt(p.x, p.z) < WATER_Y - 0.5) return; // stays out of deep water
    m.x = p.x;
    m.z = p.z;
  }

  // --- projectiles -------------------------------------------------------------------------------

  private updateProjs() {
    for (const p of this.projs) {
      const step = Math.min(p.left, Math.hypot(p.vx, p.vz) * DT);
      p.x += (p.vx / Math.hypot(p.vx, p.vz)) * step;
      p.z += (p.vz / Math.hypot(p.vx, p.vz)) * step;
      p.left -= step;
      const hit = this.bodies(p.x, p.z, 0.4, (b) => b !== p.src && this.canHit(p.src, b))[0];
      if (hit) {
        this.hurt(hit, p.dmg, p.src, { kind: 'proj', blockable: true });
        if (this.lastResult === 'hit') this.statusTo(p.src, hit, p.st, p.src.dv.dmg);
        p.left = 0;
      } else if (this.terrain.collide(p.x, p.z, 0.1).hit) p.left = 0;
    }
    this.projs = this.projs.filter((p) => p.left > 0);
  }

  // --- fighters -----------------------------------------------------------------------------------

  private updateFighter(f: Fighter) {
    const dt = DT;
    const t = this.time;
    if (f.role === 'out') return;
    f.atkFlash = Math.max(0, f.atkFlash - dt);
    f.roarFlash = Math.max(0, f.roarFlash - dt);
    if (f.hp <= 0) return;

    // statuses
    const stunned = f.stunUntil > t;
    if (stunned) {
      f.swing = null;
      f.guarding = false;
    }
    if (f.swing && t >= f.swing.at) this.resolveSwing(f);
    if (f.guarding && t >= f.guardAt + PARRY_WINDOW + f.mods.parryWin) this.whiff(f);
    if (this.tickN % 3 === 0 && f.role === 'alive') this.autoPickup(f);
    if (f.bleed && f.bleed.until > t) this.hurt(f, f.bleed.dps * dt, this.byId.get(f.bleed.src) ?? null, { dot: true, kind: 'bleed' });
    else f.bleed = undefined;
    if (f.hot) {
      if (f.hot.until > t) f.hp = Math.min(f.maxHp, f.hp + f.hot.perSec * dt);
      else f.hot = undefined;
    }
    if (f.mods.regenOOC > 0 && t - f.lastHurt > 6 && f.role === 'alive') f.hp = Math.min(f.maxHp, f.hp + f.maxHp * f.mods.regenOOC * dt);
    if (f.hp <= 0) return;

    // holding a victim
    if (f.holding) {
      const h = f.holding;
      if (f.holdUntil < t || h.hp <= 0 || stunned) {
        f.holding = undefined;
        if (h.kind === 'f') (h as Fighter).grab = undefined;
      } else this.hurt(h, f.holdDps * dt, f, { kind: 'grab', dot: true });
    }
    if (f.grab && (f.grab.until < t || f.grab.by.hp <= 0)) f.grab = undefined;

    // channelled actions
    if (f.chan) {
      if (stunned) f.chan = null;
      else if (t >= f.chan.until) {
        const c = f.chan;
        f.chan = null;
        if (c.k === 'harvest') this.finishHarvest(f, c.node!);
        else if (c.k === 'eat') this.finishEat(f, c.slot!);
        else if (c.k === 'loot') this.finishLoot(f, c.node!);
        else if (c.k === 'evolve') this.finishEvolve(f, c.to!);
        else if (c.k === 'drink') {
          const w = f.inv.find((s) => s?.k === 'water');
          if (w) w.n = 2;
          else this.give(f, { k: 'water', n: 2, born: t });
        }
      }
    }
    if (f.ability && f.ability.until < t) f.ability = null;
    if (f.role === 'alive') {
      // spoiled meat rots away
      for (let i = 0; i < f.inv.length; i++) {
        const it = f.inv[i];
        if (it?.k === 'meat' && t - it.born > MEAT_SPOIL + 30) f.inv[i] = null;
      }
    }

    // movement
    const inp = f.input;
    const blocked = stunned || !!f.grab || !!f.holding;
    const med = medium(this.terrain, f.x, f.z, f.def.swim !== 'land' && f.role === 'alive', f.mods.waterSpeed);
    let base = f.dv.speed * (1 + this.buffSum(f, 'speed')) * med.mul;
    if (f.def.landMul < 1 && !med.swim && !med.shallow && f.role === 'alive') base *= f.def.landMul; // fish out of water
    if (f.speedUntil > t) base *= 1.12;
    if (f.slow && f.slow.until > t) base *= 1 - f.slow.f;
    else f.slow = undefined;
    if (f.subUntil > t) base *= 1.2;
    if (f.swing) base *= 0.45; // committed to the swing
    else if (f.guarding) base *= 0.75;
    f.walkSpeed = base;
    const bound: Bound = MAP_BOUND;
    f.moving = false;
    f.sprinting = false;
    if (f.dash) {
      const d = f.dash;
      if (t > d.until) {
        f.dash = undefined;
      } else {
        stepPos(this.terrain, f, d.dx, d.dz, d.speed * dt, f.r, bound);
        const bs = this.bodies(f.x, f.z, d.aoe ? d.aoe : f.r + 0.4, (b) => b !== f && this.canHit(f, b)).sort((a, b) => dist(a, f) - dist(b, f));
        if (bs.length) {
          // a dash stops dead on the first animal it hits, and becomes a basic attack on it
          const b = bs[0];
          f.dash = undefined;
          f.yaw = yawOf(b.x - f.x, b.z - f.z);
          this.strikeNow(f, b);
        }
      }
      // the player's queued steps are skipped, not saved up
      for (const c of f.cmds) f.ack = c.s;
      f.cmds.length = 0;
      stepVertical(f, dt, this.terrain.floorAt(f.x, f.z, f.jy));
    } else if (f.bot) {
      this.applyMove(f, inp.dx, inp.dz, inp.sprint, inp.crouch, false, dt, base, med.noSprint, blocked, bound);
    } else {
      // humans send timed steps; run as many as the clock allows so nobody outruns the server
      let spent = 0;
      const budget = dt * 1.35;
      while (f.cmds.length && spent < budget - 1e-6) {
        const c = f.cmds[0];
        const take = Math.min(c.dt, budget - spent);
        if (take > 0) this.applyMove(f, c.dx, c.dz, c.sprint, c.crouch, c.jump, take, base, med.noSprint, blocked, bound);
        else if (c.dt > 0) break;
        c.dt -= take;
        spent += take;
        if (c.dt < 1e-4) {
          f.ack = c.s;
          f.cmds.shift();
        }
      }
      if (spent === 0) this.applyMove(f, 0, 0, false, false, false, dt, base, med.noSprint, blocked, bound);
      // a client that went quiet should not keep attacking
      if (t - f.lastInputAt > 0.5) inp.at = false;
    }
    if (!f.dash && !blocked && !f.chan && inp.at) {
      f.yaw = inp.yaw; // attacking faces the camera
      if (f.role === 'alive') this.basicAttack(f);
    }
    f.y = standY(this.terrain, f.x, f.z);
    (f as { speedNow?: number }).speedNow = base;

    // submerged / reed hiding needs water
    if (f.subUntil > t && !(this.terrain.depthAt(f.x, f.z) > 0.2)) f.subUntil = 0;
    if (f.reedUntil > t && !(this.terrain.depthAt(f.x, f.z) > 0.2)) f.reedUntil = 0;

    // lava
    {
      const ring = ringAt(this.campus ? 0 : t);
      if (Math.hypot(f.x, f.z) > ring.r && f.glideUntil <= t) {
        this.hurt(f, f.maxHp * ring.dps * dt, null, { lava: true, kind: 'lava' });
      }
    }
  }

  /** One step of walking: stamina, facing, and the move itself. */
  private applyMove(f: Fighter, dx: number, dz: number, sprint: boolean, crouch: boolean, jump: boolean, dt: number, base: number, noSprint: boolean, blocked: boolean, bound: Bound) {
    // jumping: a hop that clears low rocks and stones
    if (jump && !blocked && this.time >= f.whiffUntil && f.jy <= this.terrain.floorAt(f.x, f.z, f.jy) + 0.001 && f.jv <= 0.001 && !this.terrain.isDeep(f.x, f.z)) {
      if (f.sta >= JUMP_COST || this.hasFree(f)) {
        if (!this.hasFree(f)) f.sta -= JUMP_COST;
        f.jv = JUMP_V;
        f.chan = null;
      }
    }
    const wasAir = f.jy > this.terrain.floorAt(f.x, f.z, f.jy) + 0.001 || f.jv > 0.001;
    const k = Math.hypot(dx, dz);
    const moving = k > 0.05;
    let sp = base;
    let sprinting = false;
    // players only run forward: strafing and backpedalling are at walking pace (bots do not use a camera)
    const forward = f.bot || (k > 0.05 && (dx * Math.sin(f.input.yaw) + dz * Math.cos(f.input.yaw)) / k > 0.55);
    if (sprint && forward && moving && !noSprint && !f.guarding && !f.swing && (f.sta > 1 || this.hasFree(f))) {
      sprinting = true;
      sp *= 1.45;
      if (!this.hasFree(f)) f.sta -= 14 * dt;
    } else {
      f.sta = Math.min(f.dv.maxSta, f.sta + (f.sta < 1 ? 6 : 11) * (1 + f.mods.stamRegen) * dt * (moving ? 0.8 : 1.4));
    }
    if (crouch) sp *= 0.6;
    f.input.sprint = sprint;
    f.input.crouch = crouch;
    if (f.chan && k > 0.25) f.chan = null; // walking away cancels harvesting and eating
    if (blocked || f.chan || !moving) {
      if (!blocked && !moving && (f.input.at || !f.bot)) f.yaw += clampTurn(angDiff(f.input.yaw, f.yaw), 14 * dt);
      stepVertical(f, dt, this.terrain.floorAt(f.x, f.z, f.jy));
      if (wasAir && f.jy <= this.terrain.floorAt(f.x, f.z, f.jy) + 0.001) this.landed(f);
      return;
    }
    f.moving = true;
    f.sprinting = sprinting;
    stepPos(this.terrain, f, dx, dz, sp * dt * Math.min(1, k), f.r, bound, f.jy);
    stepVertical(f, dt, this.terrain.floorAt(f.x, f.z, f.jy));
    if (wasAir && f.jy <= this.terrain.floorAt(f.x, f.z, f.jy) + 0.001) this.landed(f);
    // a player always faces the camera, so strafing and backpedalling never turn the animal around; bots face where they walk
    f.yaw += clampTurn(angDiff(f.bot ? yawOf(dx, dz) : f.input.yaw, f.yaw), (f.def.size === 'large' ? 7 : 12) * dt);
  }

  /** Back on the ground: if we came down inside a rock, step out of it. */
  private landed(f: Fighter) {
    const c = this.terrain.collide(f.x, f.z, f.r, f.jy); // landing on a rock keeps you on it
    f.x = c.x;
    f.z = c.z;
  }

  // --- hunted mark -----------------------------------------------------------------------------

  /** The lava clock: in the campus it never starts. */
  private ringTime() {
    return this.campus ? 0 : this.time;
  }

  private updateHunted() {
    if (this.campus) return;
    if (this.time - this.lastHunted < 2) return;
    this.lastHunted = this.time;
    for (const f of this.fighters) f.hunted = false;
    if (this.time < PHASE_AT[2]) return;
    // the highest level on each team carries the mark for the team; the top three teams are hunted
    const best = new Map<number, Fighter>();
    for (const f of this.fighters) {
      if (f.role !== 'alive' || f.muskUntil > this.time) continue;
      const cur = best.get(f.team);
      if (!cur || f.totalXp > cur.totalXp) best.set(f.team, f);
    }
    const ranked = [...best.values()].sort((a, b) => b.totalXp - a.totalXp).slice(0, 3);
    for (const f of ranked) f.hunted = true;
    if (ranked[0] && this.time - this.lastRoar >= HUNT_ROAR_EVERY) {
      this.lastRoar = this.time;
      ranked[0].roarFlash = 1.5;
      this.emit({ k: 'roar', id: ranked[0].id, x: ranked[0].x, z: ranked[0].z });
      this.noise(ranked[0].x, ranked[0].z, 40);
    }
  }

  // --- the clock -------------------------------------------------------------------------------

  private updateClock() {
    if (this.campus) return;
    const ph = PHASE_AT.reduce((p, at, i) => (this.time >= at ? i : p), 0);
    if (ph !== this.phase) {
      this.phase = ph;
      this.emit({ k: 'phase', n: ph, name: PHASE_NAMES[ph] });
    }
    for (const [i, s] of RINGS.entries()) {
      const to = R0 * s.frac;
      if (this.time >= s.warn && !this.warned.has(i)) {
        this.warned.add(i);
        this.emit({ k: 'ringwarn', n: i + 1, in: Math.max(0, s.start - this.time), to });
      }
      if (this.time >= s.start && !this.closed.has(i)) {
        this.closed.add(i);
        this.emit({ k: 'ring', n: i + 1, to });
      }
    }
    if (this.time >= PHASE_AT[2] && !this.alphaSpawned) this.spawnAlpha();
    if (this.time >= 300 && !this.migrationDone) {
      this.migrationDone = true;
      this.migrating = 45;
      this.emit({ k: 'migration' });
      this.emit({ k: 'toast', text: 'The herds are stampeding toward the centre!' });
    }
    if (this.migrating > 0) this.migrating = Math.max(0, this.migrating - DT);
    // the mid-tier hordes arrive at the start of the Farm phase
    if (this.time >= PHASE_AT[1] && this.time < PHASE_AT[1] + DT * 1.5) {
      for (let i = 0; i < 60; i++) this.spawnWild(2, MAP_RADIUS * 0.7, 40);
      for (let i = 0; i < 40; i++) this.spawnWild(3, MAP_RADIUS * 0.5, 40);
    }
  }

  private checkEnd() {
    if (this.campus) return; // the campus never ends
    const alive = this.fighters.filter((f) => f.role === 'alive');
    const teams = new Set(alive.map((f) => f.team));
    if (teams.size <= 1 && this.startTeams > 1 && this.time > 5) this.finish(teams.size === 1 ? [...teams][0] : -1);
    else if (this.time > MATCH_LEN + 140) this.finish(-1);
  }

  private finish(team: number) {
    if (this.finished) return;
    this.finished = true;
    this.winnerTeam = team;
    for (const f of this.fighters) if (f.team === team) f.place = 1;
    // anyone without a place died last
    for (const f of this.fighters) if (!f.place) f.place = this.teamsAlive.size + 1;
    this.results = this.fighters
      .map((f) => ({ id: f.id, name: f.name, animal: f.def.id, lvl: f.level, kills: f.kills, place: f.place, dmg: Math.round(f.dmgDealt) }))
      .sort((a, b) => a.place - b.place || b.kills - a.kills);
    const winner = this.fighters.find((f) => f.team === team)?.name ?? 'Nobody';
    for (const id of this.humans) this.host.send(id, { t: 'mend', winner, team, results: this.results });
  }

  // --- main tick -----------------------------------------------------------------------------

  tick() {
    if (this.finished) return;
    this.time += DT;
    this.tickN++;
    this.updateClock();
    this.updateAwake();
    for (const f of this.fighters) {
      if (f.bot && f.hp > 0) botThink(this, f, DT);
    }
    for (const f of this.fighters) this.updateFighter(f);
    this.updateProjs();
    this.updateMobs();
    this.updateHunted();
    this.maintainPopulation();
    if (this.tickN % 15 === 0) this.checkEnd();
    // wild animals burn too
    if (this.time - this.lastLava > 0.5) {
      const dtl = this.time - this.lastLava;
      this.lastLava = this.time;
      const ring = ringAt(this.ringTime());
      for (const m of this.mobs) {
        if (m.hp > 0 && Math.hypot(m.x, m.z) > ring.r) this.hurt(m, m.maxHp * ring.dps * dtl * 1.5, null, { lava: true });
      }
    }
    if (this.rosterDirty) {
      this.rosterDirty = false;
      const r = this.roster();
      for (const id of this.humans) this.host.send(id, { t: 'mros', r });
    }
    if (this.tickN % 2 === 0) this.sendSnapshots();
    else this.trimEvents();
  }

  private trimEvents() {
    if (this.events.length > 400) this.events.splice(0, this.events.length - 400);
  }

  // --- snapshots -----------------------------------------------------------------------------

  globalState(): Global {
    const ring = ringAt(this.ringTime());
    const next = RINGS.find((s) => s.start > this.time);
    const top = this.fighters.filter((f) => f.hunted).map((f): [string, number] => [f.id, f.level]);
    return {
      time: r1(this.time),
      phase: this.phase,
      ring: r1(ring.r),
      ringTo: r1(R0 * (ring.closing ? RINGS[ring.n - 1].frac : (next?.frac ?? 0))),
      ringAt: ring.closing ? 0 : (next?.start ?? 0),
      ringN: ring.n,
      alive: this.fighters.filter((f) => f.role === 'alive').length,
      top,
      mig: this.migrating > 0 ? 1 : 0,
    };
  }

  private flags(f: Fighter): number {
    const t = this.time;
    let fl = 0;
    if (f.hunted) fl |= FL.hunted;
    if (f.markUntil > t) fl |= FL.marked;
    if (f.bleed && f.bleed.until > t) fl |= FL.bleed;
    if (f.stunUntil > t || f.whiffUntil > t) fl |= FL.stun;
    if (f.grab) fl |= FL.grabbed;
    if (f.subUntil > t || f.reedUntil > t) fl |= FL.hidden;
    if (f.buffs.some((b) => b.until > t)) fl |= FL.buff;
    if (f.atkFlash > 0) fl |= FL.atk;
    if (f.dash) fl |= FL.dash;
    if (f.input.sprint && f.moving) fl |= FL.sprint;
    if (f.input.crouch) fl |= FL.crouch;
    if (f.slow && f.slow.until > t) fl |= FL.slow;
    if (f.scareUntil > t) fl |= FL.scared;
    if (f.moving) fl |= FL.moving;
    if (f.roarFlash > 0) fl |= FL.roar;
    if (f.guarding) fl |= FL.guard;
    if (f.swing) fl |= FL.wind | (f.swing.heavy ? FL.heavy : 0);
    if (f.jy - this.terrain.floorAt(f.x, f.z, f.jy) > 0.05) fl |= FL.air;
    if (f.counterUntil > t) fl |= FL.counter;
    return fl;
  }

  private statusNames(f: Fighter): string[] {
    const t = this.time;
    const out = f.buffs.filter((b) => b.until > t).map((b) => b.id);
    if (f.blindUntil > t) out.push('blind');
    if (f.bleed && f.bleed.until > t) out.push('bleeding');
    if (f.stunUntil > t) out.push('stunned');
    if (f.whiffUntil > t) out.push('fumbled');
    if (f.slow && f.slow.until > t) out.push('slowed');
    if (f.markUntil > t) out.push('marked');
    if (f.scareUntil > t) out.push('scared');
    if (f.hot) out.push('healing');
    if (f.speedUntil > t) out.push('swift');
    if (f.tusk > 0) out.push(`tusk x${f.tusk}`);
    if (f.subUntil > t) out.push('submerged');
    if (f.reedUntil > t) out.push('hidden in reeds');
    if (f.glideUntil > t) out.push('gliding');
    if (f.mudUntil > t) out.push('mud coat');
    if (f.muskUntil > t) out.push('musk');
    return out;
  }

  private youState(f: Fighter): YouState {
    const t = this.time;
    const sk = this.slotSkills(f);
    const cds = [0, 1, 2, 3].map((i) => Math.max(0, f.cdAt[i] - t));
    const cdMax = [0, 1, 2, 3].map((i) => (sk[i]?.cd ?? 0));
    const you: YouState = {
      x: r1(f.x), z: r1(f.z), hp: Math.max(0, Math.round(f.hp)), maxHp: f.maxHp, sta: Math.round(f.sta), maxSta: f.dv.maxSta,
      lvl: f.level, xp: Math.round(f.xp), need: f.level >= MAX_LEVEL ? 1 : xpNeed(f.level), pts: f.pts, alloc: f.alloc, evolve: f.role === 'alive' ? evolveOptions(f.def, f.level).map((a) => a.id) : [],
      cds: cds.map((c) => Math.round(c * 10) / 10), cdMax, dash: Math.max(0, Math.round((f.dashAt - t) * 10) / 10), dashMax: DASH_COOLDOWN * (1 + f.mods.dashCd), inv: f.inv, role: ROLE_CODE[f.role], speed: f.walkSpeed || f.dv.speed,
      jy: Math.round(f.jy * 100) / 100, jv: Math.round(f.jv * 100) / 100, parryWin: PARRY_WINDOW + f.mods.parryWin, parryCd: Math.max(0, Math.round((f.guardCd - t) * 10) / 10), guard: f.guarding, wind: !!f.swing, guardAge: f.guarding ? Math.round((t - f.guardAt) * 100) / 100 : 0, combo: this.time - f.comboAt < COMBO_RESET ? (f.combo + 1) % 3 : 0, counter: Math.max(0, Math.round((f.counterUntil - t) * 10) / 10),
      noMove: f.stunUntil > t || f.grab || f.dash || f.chan ? 1 : 0, buffs: this.statusNames(f), sense: Math.round(f.dv.sense),
      ability: f.ability && f.ability.until > t ? f.ability.k : '', channel: f.chan ? { k: f.chan.k, left: Math.max(0, f.chan.until - t), total: f.chan.total } : null, kills: f.kills,
    };
    return you;
  }

  private sendSnapshots() {
    const g = this.globalState();
    for (const id of this.humans) {
      const me = this.byId.get(id);
      if (!me) continue;
      // spectators watch the strongest living player
      let focus: Fighter = me;
      if (me.role === 'out') {
        const alive = this.fighters.filter((f) => f.role === 'alive');
        focus = (me.view ? this.byId.get(me.view) : undefined) ?? alive.sort((a, b) => b.totalXp - a.totalXp)[0] ?? me;
        if (focus.role !== 'alive') {
          const next = alive.sort((a, b) => b.totalXp - a.totalXp)[0];
          if (next) focus = next;
        }
        me.view = focus.id;
      }
      const cx = focus.x;
      const cz = focus.z;
      const sense = me.dv.sense;
      const f: [string, number, number, number, number, number, number, number][] = [];
      for (const o of this.fighters) {
        if (o === me || o.role === 'out') continue;
        const d = Math.hypot(o.x - cx, o.z - cz);
        if (d > 170) continue;
        const friend = o.team === me.team;
        const hidden = o.subUntil > this.time || o.reedUntil > this.time || (this.terrain.inBush(o.x, o.z) && !o.moving);
        if (hidden && !friend && d > Math.max(8, sense * 0.2)) continue;
        f.push([o.id, r1(o.x), r1(o.z), Math.round(o.yaw * 100) / 100, Math.round((o.hp / o.maxHp) * 100), o.level, this.flags(o) | (hidden ? FL.hidden : 0), Math.round(o.jy * 100) / 100]);
      }
      if (focus !== me) f.push([focus.id, r1(focus.x), r1(focus.z), Math.round(focus.yaw * 100) / 100, Math.round((focus.hp / focus.maxHp) * 100), focus.level, this.flags(focus), Math.round(focus.jy * 100) / 100]);
      const m: [number, number, number, number, number, number, number][] = [];
      const nearMobs: { m: Mob; d: number }[] = [];
      for (const o of this.mobs) {
        if (o.hp <= 0) continue;
        const d = Math.hypot(o.x - cx, o.z - cz);
        if (d < 110) nearMobs.push({ m: o, d });
      }
      nearMobs.sort((a, b) => a.d - b.d);
      for (const { m: o } of nearMobs.slice(0, 140)) {
        let fl = 0;
        if (o.state === 'attack') fl |= 1;
        if (o.state === 'flee') fl |= 2;
        if (o.atkFlash > 0) fl |= 4;
        if (o.hurtFlash > 0) fl |= 8;
        if (o.stunUntil > this.time) fl |= 32;
        if (o.strikeAt) fl |= 128; // winding up a bite
        m.push([o.id, mobIndex(o.def.id), r1(o.x), r1(o.z), Math.round(o.yaw * 100) / 100, Math.round((o.hp / o.maxHp) * 100), fl]);
      }
      const d: [number, string, number, number, number][] = [];
      for (const dr of this.drops) {
        if (Math.hypot(dr.x - cx, dr.z - cz) < 60) d.push([dr.id, dr.pile ? 'pile' : dr.items[0].k, r1(dr.x), r1(dr.z), dr.items.length]);
      }
      const ev: MatchEvent[] = [];
      for (const e of this.events) {
        if (e.x === undefined || Math.hypot(e.x - cx, (e.z ?? 0) - cz) < 140) {
          if (e.e.k === 'toast' && e.e.to && e.e.to !== id) continue;
          ev.push(e.e);
        }
      }
      const you = this.youState(me);
      if (focus !== me) {
        you.x = r1(focus.x);
        you.z = r1(focus.z);
        you.view = focus.id;
      }
      this.host.send(id, { t: 'snap', ack: me.bot ? me.input.s : me.ack, you, g, f, m, d, ev });
    }
    this.events.length = 0;
  }
}

const clampTurn = (d: number, max: number) => Math.max(-max, Math.min(max, d));
