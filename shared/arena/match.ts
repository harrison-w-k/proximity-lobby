// The authoritative match simulation: 20 animals, a procedural map, horde AI, a closing lava
// ring, XP and skills, the Gulag and Horde Leaders. It knows nothing about sockets: a host feeds
// it client messages, calls tick() at 30 Hz and sends the snapshots it produces.
import {
  ANIMAL_BY_ID, ANIMALS, MAX_LEVEL, SKILL_BY_ID, STAT_KEYS, UNLOCK_LEVELS, derive, emptyStats, hordeXp, killXp, sumMods, xpNeed,
  type AnimalDef, type Derived, type Effect, type Mods, type Skill, type Status, type Stats,
} from './animals';
import {
  LEADER_RESPAWN, MOBS, SWARMS, SWARM_BUDGET, SWARM_DAMAGE_CAP, SWARM_MIN, TIER_SHARE, mobDef, swarmChoices,
  mobIndex, type MobDef, type SwarmKind,
} from './mobs';
import { GULAG_R, GULAG_X, MAP_BOUND, inGulagZone, medium, standY, stepPos, type Bound } from './move';
import {
  FL, ROLE_CODE, type ClientMatchMsg, type Global, type InvItem, type ItemKind, type MatchEvent, type Role, type RosterEntry,
  type ServerMatchMsg, type YouState,
} from './proto';
import { mulberry32 } from './rng';
import { Biome, MAP_RADIUS, Terrain, WATER_Y } from './terrain';
import { botThink } from './bots';

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const PHASE_NAMES = ['Scatter', 'Farm', 'Clash', 'Cull', 'Final'];
export const PHASE_AT = [0, 90, 240, 420, 600];
export const MATCH_LEN = 720;
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
  k: 'eat' | 'harvest' | 'drink' | 'loot';
  until: number;
  total: number;
  slot?: number;
  node?: number;
  x: number;
  z: number;
}

export interface Fighter extends Body {
  kind: 'f';
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
  picks: number[];
  mods: Required<Mods>;
  dv: Derived;
  sta: number;
  input: Input;
  cdAt: number[];
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
  // gulag
  duel?: Duel;
  waitSince: number;
  deathX: number;
  deathZ: number;
  deathBiome: Biome;
  swarmPick: SwarmKind | null;
  defeated: boolean;
  // horde leader
  swarm?: SwarmKind;
  tier: number;
  eaten: number;
  order: 'free' | 'attack' | 'guard' | 'scatter';
  guardX: number;
  guardZ: number;
  respawnAt: number;
  frenzyUntil: number;
  swarmHurt: [number, number, string][]; // damage taken from swarms: [time, amount, leader]
  moving: boolean;
  sprinting: boolean;
  cmds: { s: number; dt: number; dx: number; dz: number; sprint: boolean; crouch: boolean }[];
  ack: number;
  lastCmd: number;
  lastInputAt: number;
  walkSpeed: number;
  holdUntil: number;
  holdDps: number;
  view?: string; // spectators: whom they are watching
  bornAt: number;
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
  owner: string; // leader id for swarm units
  awake: boolean;
  atkFlash: number;
  slowUntil: number;
  stunUntil: number;
  bleedUntil: number;
  bleedDps: number;
  scareUntil: number;
  wander: number;
  hurtFlash: number;
  warden?: boolean;
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

interface Duel {
  id: number;
  slot: number;
  a: Fighter;
  b: Fighter | null;
  warden: Mob | null;
  startedAt: number;
  cx: number;
  cz: number;
}

export interface Entrant {
  id: string;
  name: string;
  animal: string;
  team: number;
  bot: boolean;
}

export interface Host {
  send(id: string, msg: ServerMatchMsg): void;
}

const NODE_RESPAWN: Record<string, number> = { berry: 50, fruit: 90, herb: 80, mud: 45, hive: 120, reed: 30 };
const HARVEST_TIME: Record<string, number> = { berry: 2.2, fruit: 3, herb: 2.5, mud: 2, hive: 3.5, reed: 1.8 };

const FIXED_GULAG_ALLOC: Stats = { hp: 6, atk: 6, spd: 0, sta: 0, sen: 0 };
const NO_PICKS = [-1, -1, -1, -1];

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
  duels: Duel[] = [];
  gulagQueue: Fighter[] = [];
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
  private nextDuel = 1;
  private events: { e: MatchEvent; x?: number; z?: number }[] = [];
  private noises: { x: number; z: number; r: number }[] = [];
  private warned = new Set<number>();
  private closed = new Set<number>();
  private lastRoar = 0;
  private lastHunted = -10;
  private lastAwake = -10;
  private lastPop = 0;
  private lastSwarmAlloc = -10;
  private lastLava = 0;
  private teamsAlive = new Set<number>();
  private startTeams = 0;
  private rosterDirty = false;
  readonly humans = new Set<string>();

  constructor(
    seed: number,
    entrants: Entrant[],
    private host: Host,
  ) {
    this.seed = seed;
    this.terrain = new Terrain(seed);
    this.rnd = mulberry32(seed ^ 0xfaceb00c);
    this.createFighters(entrants);
    this.populateStart();
    this.startTeams = new Set(this.fighters.map((f) => f.team)).size;
    for (const f of this.fighters) if (!f.bot) this.humans.add(f.id);
  }

  // --- setup ---------------------------------------------------------------------------------

  private newFighter(e: Entrant): Fighter {
    const def = ANIMAL_BY_ID.get(e.animal) ?? ANIMALS[0];
    const f: Fighter = {
      kind: 'f', id: e.id, name: e.name, def, team: e.team, bot: e.bot, role: 'alive', level: 1, xp: 0, totalXp: 0, pts: 0,
      alloc: emptyStats(), picks: [...NO_PICKS], mods: sumMods([def.innate]), dv: derive(def, emptyStats(), sumMods([def.innate])),
      x: 0, z: 0, y: 0, yaw: 0, hp: 1, maxHp: 1, r: 0.5, sta: 100,
      input: { s: 0, dx: 0, dz: 0, yaw: 0, sprint: false, crouch: false, at: false },
      cdAt: [0, 0, 0, 0], atkAt: 0, buffs: [], markUntil: 0, stunUntil: 0, scareUntil: 0, blindUntil: 0, subUntil: 0, invUntil: 0,
      speedUntil: 0, glideUntil: 0, mudUntil: 0, tusk: 0, muskUntil: 0, reedUntil: 0, usedCheat: false,
      inv: new Array(INV_SLOTS).fill(null), chan: null, ability: null, kills: 0, dmgDealt: 0, place: 0, lastHurt: -99, lastCombat: -99,
      hunted: false, lastAttacker: '', recentAttackers: new Map(), atkFlash: 0, roarFlash: 0, waitSince: 0, deathX: 0, deathZ: 0,
      deathBiome: Biome.Grassland, swarmPick: null, defeated: false, tier: 1, eaten: 0, order: 'free', guardX: 0, guardZ: 0,
      respawnAt: 0, frenzyUntil: 0, swarmHurt: [], moving: false, sprinting: false, cmds: [], ack: 0, lastCmd: 0, lastInputAt: 0, walkSpeed: 0, holdUntil: 0, holdDps: 0, bornAt: 0,
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
    const spawns = this.terrain.spawns;
    teams.forEach((team, i) => {
      const sp = spawns[i % spawns.length];
      let k = 0;
      for (const f of this.fighters) {
        if (f.team !== team) continue;
        const a = (k++ / 4) * Math.PI * 2;
        const p = this.terrain.collide(sp.x + Math.cos(a) * 2.5 * (k > 1 ? 1 : 0), sp.z + Math.sin(a) * 2.5 * (k > 1 ? 1 : 0), 0.6);
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
    for (let i = 0; i < 95; i++) this.spawnWild(1, MAP_RADIUS - 25, 0);
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
      id: f.id, name: f.name, animal: f.def.id, team: f.team, bot: f.bot, role: ROLE_CODE[f.role], swarm: f.swarm, tier: f.role === 'leader' ? f.tier : undefined,
    }));
  }

  private inGulag(f: Fighter) {
    return f.role === 'gulag';
  }

  /** Skills the fighter currently has: slots Q E R F. */
  slotSkills(f: Fighter): (Skill | null)[] {
    const u = f.def.unlock;
    return [f.def.sig[0], f.def.sig[1], f.picks[0] >= 0 ? u[0][f.picks[0]] : null, f.picks[2] >= 0 ? u[2][f.picks[2]] : null];
  }

  recompute(f: Fighter, fill = false) {
    const picks = f.role === 'gulag' ? NO_PICKS : f.picks;
    const skills: Skill[] = [f.def.innate];
    if (picks[1] >= 0) skills.push(f.def.unlock[1][picks[1]]);
    if (picks[3] >= 0) skills.push(f.def.unlock[3][picks[3]]);
    f.mods = sumMods(skills);
    const oldMax = f.maxHp;
    if (f.role === 'leader') {
      f.dv = { maxHp: 55 + f.tier * 15, dmg: 4 + f.tier, speed: 6.6 + f.tier * 0.4, maxSta: 100, sense: 40, radius: 0.4, reach: 1.8 };
    } else {
      f.dv = derive(f.def, f.role === 'gulag' ? FIXED_GULAG_ALLOC : f.alloc, f.mods);
      if (f.role === 'gulag') f.dv.maxHp = Math.max(f.dv.maxHp, 180);
    }
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
    if (f.blindUntil > this.time) m -= 0.25;
    if (f.scareUntil > this.time) m -= 0.25;
    return Math.max(0.2, m);
  }

  private teamOf(b: Body | null): number {
    if (!b) return -1;
    if (b.kind === 'f') return (b as Fighter).team;
    const o = (b as Mob).owner;
    return o ? (this.byId.get(o)?.team ?? -1) : -1;
  }

  /** May `src` hurt `t`? Wildlife and leaders only hurt living players; the Gulag is separate. */
  private canHit(src: Body | null, t: Body): boolean {
    if (t.kind === 'f') {
      const tf = t as Fighter;
      if (tf.role === 'out') return false;
      if (tf.role === 'gulag') {
        if (!tf.duel || tf.defeated) return false;
        if (!src) return false;
        if (src.kind === 'f') return (src as Fighter).duel === tf.duel;
        return (src as Mob).warden === true && tf.duel.warden === src;
      }
      if (src === null) return true;
      if (src.kind === 'f') {
        const sf = src as Fighter;
        if (sf.role === 'gulag') return false;
        if (sf.team === tf.team && sf !== tf) return false;
        if (tf.role === 'leader' && sf.role === 'leader') return false;
        if (sf.role === 'alive' && tf.role === 'alive' && this.time < SCATTER_PEACE) return false; // first contact comes in the Farm phase
        return true;
      }
      // a mob
      const m = src as Mob;
      if (m.warden) return false;
      if (tf.role !== 'alive') return false;
      if (m.owner) return (this.byId.get(m.owner)?.team ?? -2) !== tf.team;
      return true;
    }
    // t is a mob
    const tm = t as Mob;
    if (!src || src.kind === 'm') return false;
    const sf = src as Fighter;
    if (tm.warden) return sf.role === 'gulag' && sf.duel?.warden === tm;
    if (sf.role === 'gulag') return false;
    if (tm.owner) return sf.role === 'alive' && (this.byId.get(tm.owner)?.team ?? -2) !== sf.team;
    return sf.role === 'alive';
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
          f.cmds.push({ s: msg.s, dt: dtm, dx: Number.isFinite(msg.x) ? msg.x * k : 0, dz: Number.isFinite(msg.z) ? msg.z * k : 0, sprint: msg.sp === 1, crouch: msg.cr === 1 });
          if (f.cmds.length > 12) f.cmds.shift();
        } else if (f.cmds.length) f.cmds.push({ s: msg.s, dt: 0, dx: 0, dz: 0, sprint: false, crouch: false });
        else f.ack = msg.s;
        break;
      }
      case 'mskill':
        this.castSkill(f, msg.i | 0, Number.isFinite(msg.yaw) ? msg.yaw : f.input.yaw);
        break;
      case 'mstat':
        this.spendStat(f, msg.k);
        break;
      case 'mpick':
        this.pickSkill(f, msg.i | 0, msg.o | 0);
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
      case 'mcmd':
        this.command(f, msg.c, msg.yaw);
        break;
      case 'mswarm':
        this.chooseSwarm(f, msg.k);
        break;
      case 'mleave':
        this.release(id);
        break;
    }
  }

  /** A human left: the AI takes over so the match goes on. */
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

  pickSkill(f: Fighter, tier: number, opt: number): boolean {
    if (f.role !== 'alive' || tier < 0 || tier > 3 || (opt !== 0 && opt !== 1)) return false;
    if (f.level < UNLOCK_LEVELS[tier] || f.picks[tier] !== -1) return false;
    f.picks[tier] = opt;
    this.recompute(f);
    return true;
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
    if (f.role === 'leader') return this.leaderSkill(f, slot);
    if (f.role === 'out') return false;
    if (f.role === 'gulag' && (!f.duel || f.defeated)) return false;
    if (f.stunUntil > this.time || f.grab) return false;
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
    this.emit({ k: 'skill', id: f.id, s: skill.id, x: f.x, z: f.z, yaw }, f.x, f.z);
    this.noise(f.x, f.z, 22 * (f.def.size === 'large' ? 1.5 : 1));
    this.runEffect(f, skill, fx);
    if (fx.k !== 'submerge' && fx.k !== 'buff' && fx.k !== 'heal' && f.subUntil > this.time) f.subUntil = 0;
    return true;
  }

  private statusTo(src: Fighter | Mob | null, t: Body, st: Status[] | undefined, base: number) {
    if (!st) return;
    for (const s of st) {
      if (t.kind === 'f') {
        const f = t as Fighter;
        switch (s.s) {
          case 'bleed':
            if (f.mods.bleedImmune <= 0) f.bleed = { until: this.time + s.dur, dps: base * s.dps, src: src && src.kind === 'f' ? (src as Fighter).id : ((src as Mob | null)?.owner ?? '') };
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
            break;
          case 'scare':
            f.scareUntil = this.time + s.dur;
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
            break;
          case 'scare':
            this.scareMob(m, s.dur);
            break;
        }
      }
    }
  }

  private scareMob(m: Mob, dur: number) {
    if (m.def.behavior === 'alpha' || m.warden) return;
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
          this.hurt(b, base * fx.dmg * dm(b), f, { kind: skill.id });
          this.statusTo(f, b, fx.st, base);
          if (++hit >= (f.def.size === 'large' ? 6 : 3)) break;
        }
        break;
      }
      case 'aoe': {
        const bs = this.bodies(f.x, f.z, fx.r, hitPred);
        for (const b of bs) {
          if (fx.dmg > 0) this.hurt(b, base * fx.dmg * dm(b), f, { kind: skill.id });
          this.statusTo(f, b, fx.st, base);
          if (fx.scare && b.kind === 'm') this.scareMob(b as Mob, fx.scare);
          if (fx.scare && b.kind === 'f') (b as Fighter).scareUntil = this.time + fx.scare * 0.5;
        }
        // wild animals that are not "hit" still hear and react
        if (fx.scare) for (const m of this.mobs) if (m.hp > 0 && !m.owner && dist(m, f) < fx.r) this.scareMob(m, fx.scare);
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

  // --- basic attack --------------------------------------------------------------------------

  private basicAttack(f: Fighter) {
    if (this.time < f.atkAt || f.stunUntil > this.time || f.grab || f.chan) return;
    const rof = f.role === 'leader' ? 1 : this.buffSum(f, 'rof');
    f.atkAt = this.time + 0.62 / rof;
    f.atkFlash = 0.28;
    f.lastCombat = this.time;
    const reach = f.dv.reach * (f.blindUntil > this.time ? 0.5 : 1);
    this.noise(f.x, f.z, 16 * (f.def.size === 'large' ? 1.5 : f.def.size === 'small' ? 0.6 : 1));
    // an animal that can throw (otter) hurls a stone
    const bs = this.bodies(f.x, f.z, reach, (b) => b !== f && this.canHit(f, b)).filter((b) => this.inCone(f, b, reach, 110));
    bs.sort((a, b) => dist(a, f) - dist(b, f));
    const cleave = f.def.size === 'large' && f.role === 'alive' ? 2 : 1;
    for (const b of bs.slice(0, cleave)) {
      const amount = f.dv.dmg * this.dmgMult(f, b);
      this.hurt(b, amount, f, { kind: 'bite' });
      if (f.mods.bleedOnHit > 0) this.statusTo(f, b, [{ s: 'bleed', dur: f.mods.bleedOnHit, dps: 0.2 }], f.dv.dmg);
      if (f.tusk > 0) {
        f.tusk--;
        this.statusTo(f, b, [{ s: 'bleed', dur: 5, dps: 0.3 }], f.dv.dmg);
      }
    }
    if (f.subUntil > this.time && bs.length) f.subUntil = 0;
  }

  // --- damage --------------------------------------------------------------------------------

  hurt(t: Body, raw: number, src: Body | null, o: { kind?: string; noReflect?: boolean; lava?: boolean; dot?: boolean } = {}): number {
    if (raw <= 0 || t.hp <= 0) return 0;
    const srcF = src?.kind === 'f' ? (src as Fighter) : null;
    const srcOwner = src?.kind === 'm' ? ((src as Mob).owner ? this.byId.get((src as Mob).owner) ?? null : null) : srcF;
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
      if (srcF && !m.owner && !m.warden) this.provoke(m, srcF);
      if (m.hp <= 0) this.killMob(m, srcF);
      return amount;
    }
    const f = t as Fighter;
    if (f.role === 'out') return 0;
    if (f.invUntil > this.time && !o.lava) return 0;
    let dr = Math.min(0.8, f.mods.dr + this.buffSum(f, 'dr'));
    if (o.lava) dr = this.time < f.mudUntil ? 0.6 : 0;
    let amount = raw * (1 - dr);
    // swarms may deal at most 30% of a player's health per 10 s
    const swarmId = src?.kind === 'm' ? (src as Mob).owner : srcF?.role === 'leader' ? srcF.id : '';
    if (swarmId) {
      f.swarmHurt = f.swarmHurt.filter(([t0]) => this.time - t0 < 10);
      const used = f.swarmHurt.reduce((s, [, a, id]) => (id === swarmId ? s + a : s), 0);
      const room = Math.max(0, f.maxHp * SWARM_DAMAGE_CAP - used);
      amount = Math.min(amount, room);
      if (amount <= 0) return 0;
      f.swarmHurt.push([this.time, amount, swarmId]);
    }
    f.hp -= amount;
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
    const b = m.def.behavior;
    if (m.pack && (b === 'pack' || b === 'skittish')) {
      for (const o of this.mobs) if (o.pack === m.pack && o.hp > 0 && !o.owner) this.aggro(o, by);
    } else this.aggro(m, by);
  }
  private aggro(m: Mob, by: Fighter) {
    const b = m.def.behavior;
    if (b === 'flee') {
      m.state = 'flee';
      m.until = this.time + 7;
      m.target = by;
    } else {
      m.state = 'attack';
      m.target = by;
      m.until = this.time + 12;
    }
  }

  // --- deaths --------------------------------------------------------------------------------

  private killMob(m: Mob, by: Fighter | null) {
    m.hp = 0;
    if (m.warden) return; // handled by the duel
    if (by && by.role === 'alive') {
      let xp = hordeXp(m.def.tier, by.level);
      if (m.owner) xp = hordeXp(1, by.level) * 0.35;
      this.gainXp(by, xp);
      by.lastCombat = this.time;
    }
    if (m.owner) return;
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
    if (f.role === 'gulag') {
      // a duel loss: the fighter keeps their body, the duel resolves
      f.hp = 1;
      f.defeated = true;
      f.invUntil = this.time + 99;
      return;
    }
    if (f.role === 'leader') {
      f.hp = 0;
      f.respawnAt = this.time + LEADER_RESPAWN;
      this.removeUnits(f.id);
      this.emit({ k: 'kill', killer: killer?.id ?? '', victim: f.id, how }, f.x, f.z);
      if (killer?.role === 'alive') this.gainXp(killer, hordeXp(2, killer.level) * 0.5);
      return;
    }
    if (f.role !== 'alive') return;
    // a living player falls: drop everything as a loot pile, credit the kill
    const items = f.inv.filter((i): i is InvItem => !!i && (i.k !== 'water' || i.n > 0));
    f.inv.fill(null);
    if (items.length) this.addDrop(f.x, f.z, items, 180, true);
    if (killer && killer.role === 'alive' && killer !== f) {
      killer.kills++;
      this.gainXp(killer, killXp(f.totalXp, f.level, killer.level));
      for (const tm of this.fighters) {
        if (tm !== killer && tm.team === killer.team && tm.role === 'alive' && dist(tm, killer) < 70) this.gainXp(tm, killXp(f.totalXp, f.level, tm.level) * 0.25);
      }
      killer.hp = Math.min(killer.maxHp, killer.hp + killer.maxHp * 0.15);
    } else if (killer && killer.role === 'leader') {
      killer.kills++;
    }
    // assists and credit when the killing blow was lava
    if (!killer || killer === f) {
      const recent = [...f.recentAttackers.entries()].filter(([, t]) => this.time - t < 10).sort((a, b) => b[1] - a[1])[0];
      if (recent) {
        const k = this.byId.get(recent[0]);
        if (k && k.role === 'alive' && k !== f) {
          k.kills++;
          this.gainXp(k, killXp(f.totalXp, f.level, k.level) * 0.7);
        }
      }
    }
    this.emit({ k: 'kill', killer: killer?.id ?? '', victim: f.id, how }, f.x, f.z);
    f.deathX = f.x;
    f.deathZ = f.z;
    f.deathBiome = this.terrain.biomeAt(f.x, f.z);
    f.chan = null;
    f.dash = undefined;
    f.grab = undefined;
    f.holding = undefined;
    f.bleed = undefined;
    f.subUntil = 0;
    f.buffs = [];
    f.hunted = false;
    f.role = 'gulag';
    f.defeated = false;
    f.waitSince = this.time;
    f.swarmPick = null;
    f.input.at = false;
    this.recompute(f, true);
    f.invUntil = 0;
    const pen = this.penSpot();
    f.x = pen.x;
    f.z = pen.z;
    f.y = 0;
    this.gulagQueue.push(f);
    // team elimination
    if (!this.fighters.some((o) => o.team === f.team && o.role === 'alive')) {
      this.teamsAlive.delete(f.team);
      const place = this.teamsAlive.size + 1;
      for (const o of this.fighters) if (o.team === f.team) o.place = place;
    }
    this.rosterDirty = true;
    this.emit({ k: 'toast', to: f.id, text: 'You were eliminated. Survive the Gulag to return as a Horde Leader.' });
  }

  private penSpot() {
    const a = this.rnd() * Math.PI * 2;
    const r = 4 + this.rnd() * 10;
    return { x: GULAG_X - 70 + Math.cos(a) * r, z: Math.sin(a) * r };
  }

  private addDrop(x: number, z: number, items: InvItem[], ttl: number, pile = false) {
    this.drops.push({ id: this.nextDrop++, x, z, items, ttl: this.time + ttl, pile });
  }

  // --- inventory and harvesting ------------------------------------------------------------------

  private give(f: Fighter, item: InvItem): boolean {
    // stack berries (3) and top up the water pouch
    for (const s of f.inv) {
      if (s && s.k === item.k && item.k === 'berry' && s.n < 3) {
        const add = Math.min(3 - s.n, item.n);
        s.n += add;
        item.n -= add;
        if (item.n <= 0) return true;
      }
    }
    if (item.k === 'water') {
      const w = f.inv.find((s) => s?.k === 'water');
      if (w) {
        w.n = Math.min(2, w.n + item.n);
        return true;
      }
    }
    const idx = f.inv.indexOf(null);
    if (idx < 0) return false;
    f.inv[idx] = { ...item };
    return true;
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
    if (f.role !== 'alive' && f.role !== 'leader') return;
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
    if (i < 0) return;
    const d = this.drops[i];
    if (f.role === 'leader') {
      // leaders eat: it makes them stronger
      f.eaten += d.items.reduce((s, it) => s + (it.k === 'meat' ? it.n : 1), 0);
      this.drops.splice(i, 1);
      f.hp = Math.min(f.maxHp, f.hp + 10);
      this.checkTier(f);
      return;
    }
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
        f.chan = { k: 'eat', until: this.time + 1.6, total: 1.6, slot, x: f.x, z: f.z };
        this.noise(f.x, f.z, 18);
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
    switch (it.k) {
      case 'meat': {
        const spoiled = this.time - it.born > MEAT_SPOIL;
        if (!spoiled) f.hot = { until: this.time + 5, perSec: (f.maxHp * 0.035 * Math.min(it.n, 3) * boost) / 1 };
        else this.toast(f.id, 'The meat was rotten!');
        f.inv[slot] = null;
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

  // --- horde leaders -----------------------------------------------------------------------------

  chooseSwarm(f: Fighter, k: SwarmKind) {
    if (f.role !== 'gulag') return;
    if (!swarmChoices(f.deathBiome).some((s) => s.id === k)) return;
    f.swarmPick = k;
  }

  command(f: Fighter, c: string, yaw?: number) {
    if (f.role !== 'leader' || f.hp <= 0) return;
    if (c === 'attack') f.order = 'attack';
    else if (c === 'free') f.order = 'free';
    else if (c === 'scatter') f.order = 'scatter';
    else if (c === 'guard') {
      f.order = 'guard';
      f.guardX = f.x;
      f.guardZ = f.z;
    } else if (c === 'skill') this.leaderSkill(f, 0);
    else if (c === 'frenzy') this.leaderSkill(f, 1);
    if (yaw !== undefined && Number.isFinite(yaw)) f.yaw = yaw;
  }

  private leaderSkill(f: Fighter, slot: number): boolean {
    if (f.hp <= 0 || this.time < f.cdAt[slot]) return false;
    const def = SWARMS.find((s) => s.id === f.swarm);
    if (!def) return false;
    if (slot === 1) {
      if (f.tier < 3) {
        this.toast(f.id, 'Reach Tier III by eating to unlock Frenzy.');
        return false;
      }
      f.frenzyUntil = this.time + 8;
      f.cdAt[1] = this.time + 25;
      this.emit({ k: 'skill', id: f.id, s: 'frenzy', x: f.x, z: f.z, yaw: f.yaw }, f.x, f.z);
      return true;
    }
    if (slot !== 0) return false;
    // find the nearest living enemy in front
    const foes = this.bodies(f.x, f.z, 28, (b) => b.kind === 'f' && (b as Fighter).role === 'alive' && (b as Fighter).team !== f.team) as Fighter[];
    foes.sort((a, b) => dist(a, f) - dist(b, f));
    const tgt = foes.find((b) => Math.abs(angDiff(yawOf(b.x - f.x, b.z - f.z), f.yaw)) < 1.2) ?? foes[0];
    if (!tgt) {
      this.toast(f.id, 'No target in range.');
      return false;
    }
    f.cdAt[0] = this.time + def.skill.cd;
    this.emit({ k: 'skill', id: f.id, s: `sw_${def.id}`, x: tgt.x, z: tgt.z, yaw: f.yaw, r: 12 }, tgt.x, tgt.z);
    if (def.id === 'rat') this.statusTo(f, tgt, [{ s: 'bleed', dur: 8, dps: (tgt.maxHp * 0.018) / Math.max(1, f.dv.dmg) }], f.dv.dmg);
    else if (def.id === 'bird') {
      for (const b of this.bodies(tgt.x, tgt.z, 7, (x) => x.kind === 'f' && (x as Fighter).role === 'alive' && (x as Fighter).team !== f.team) as Fighter[]) {
        b.blindUntil = this.time + 3.5;
        this.hurt(b, 4, f, { kind: 'dive' });
      }
    } else {
      const wet = this.terrain.depthAt(tgt.x, tgt.z) > 0.1 || this.nearWater(tgt.x, tgt.z);
      for (const b of this.bodies(tgt.x, tgt.z, 12, (x) => x.kind === 'f' && (x as Fighter).role === 'alive' && (x as Fighter).team !== f.team) as Fighter[]) {
        b.slow = { until: this.time + 4, f: wet ? 0.5 : 0.25 };
      }
    }
    return true;
  }

  private checkTier(f: Fighter) {
    const t = f.eaten >= 14 ? 3 : f.eaten >= 6 ? 2 : 1;
    if (t > f.tier) {
      f.tier = t;
      this.recompute(f);
      this.toast(f.id, t === 3 ? 'Tier III! Frenzy unlocked (E).' : 'Tier II! Your swarm grows.');
      this.rosterDirty = true;
    }
  }

  private becomeLeader(f: Fighter, tier: number) {
    f.role = 'leader';
    f.tier = tier;
    f.eaten = tier === 2 ? 6 : 0;
    f.swarm = f.swarmPick ?? swarmChoices(f.deathBiome)[0].id;
    f.duel = undefined;
    f.defeated = false;
    f.invUntil = 0;
    f.order = 'free';
    f.cdAt = [0, 0, 0, 0];
    this.recompute(f, true);
    // return to the world near where they fell, inside the lava ring
    const ring = ringAt(this.time).r;
    let x = f.deathX;
    let z = f.deathZ;
    const d = Math.hypot(x, z);
    if (d > ring - 10) {
      x *= (ring - 10) / d;
      z *= (ring - 10) / d;
    }
    const p = this.terrain.randomLand(this.rnd, 1, 0);
    if (this.terrain.heightAt(x, z) < WATER_Y + 0.2 && f.swarm !== 'shoal') {
      const q = this.terrain.randomLand(this.rnd, Math.max(20, ring - 10), 0);
      x = q.x;
      z = q.z;
    }
    void p;
    f.x = x;
    f.z = z;
    f.y = standY(this.terrain, x, z);
    this.rosterDirty = true;
    this.emit({ k: 'toast', to: f.id, text: `You return as ${SWARMS.find((s) => s.id === f.swarm)?.name}. Command your swarm (1 attack, 2 scatter, 3 guard).` });
    this.allocateSwarms(true);
  }

  private leaderUnits(id: string) {
    return this.mobs.filter((m) => m.owner === id && m.hp > 0);
  }
  private removeUnits(id: string) {
    for (const m of this.mobs) if (m.owner === id) m.hp = 0;
  }

  /** The shared 60-animal budget: more leaders means smaller swarms. */
  swarmWant = new Map<string, number>();
  private allocateSwarms(force = false) {
    if (!force && this.time - this.lastSwarmAlloc < 2) return;
    this.lastSwarmAlloc = this.time;
    const leaders = this.fighters.filter((f) => f.role === 'leader' && f.hp > 0);
    const share = leaders.reduce((s, f) => s + TIER_SHARE[f.tier], 0) || 1;
    this.swarmWant.clear();
    for (const f of leaders) this.swarmWant.set(f.id, this.disbanded ? 0 : Math.max(SWARM_MIN, Math.floor((SWARM_BUDGET * TIER_SHARE[f.tier]) / share)));
  }

  // --- gulag -----------------------------------------------------------------------------------

  private updateGulag() {
    // pair up waiting players, or send a lone player against the Warden
    const waiting = this.gulagQueue.filter((f) => f.role === 'gulag' && !f.duel);
    const freeSlot = () => {
      for (let s = 0; s < 4; s++) if (!this.duels.some((d) => d.slot === s)) return s;
      return -1;
    };
    while (waiting.length >= 2) {
      const s = freeSlot();
      if (s < 0) break;
      const a = waiting.shift()!;
      const b = waiting.shift()!;
      this.startDuel(s, a, b);
    }
    if (waiting.length === 1 && this.time - waiting[0].waitSince > 10) {
      const s = freeSlot();
      if (s >= 0) this.startDuel(s, waiting.shift()!, null);
    }
    this.gulagQueue = this.gulagQueue.filter((f) => f.role === 'gulag' && !f.duel);

    for (const d of [...this.duels]) {
      const { a, b } = d;
      let winner: Fighter | null = null;
      let loser: Fighter | null = null;
      if (d.warden) {
        if (a.defeated) {
          winner = null;
          loser = a;
        } else if (d.warden.hp <= 0) winner = a;
      } else if (b) {
        if (a.defeated) {
          winner = b;
          loser = a;
        } else if (b.defeated) {
          winner = a;
          loser = b;
        }
      }
      const timeout = this.time - d.startedAt > 55;
      if (!winner && !loser && !timeout) continue;
      if (timeout && !winner && !loser) {
        if (d.warden) loser = a;
        else if (b) {
          const pa = a.hp / a.maxHp;
          const pb = b.hp / b.maxHp;
          winner = pa >= pb ? a : b;
          loser = winner === a ? b : a;
        }
      }
      this.duels = this.duels.filter((x) => x !== d);
      if (d.warden) d.warden.hp = 0;
      if (winner) this.finishGulag(winner, 2, true);
      if (loser) this.finishGulag(loser, 1, false);
    }
  }

  private finalFight() {
    return this.disbanded || (this.fighters.length > 3 && this.fighters.filter((o) => o.role === 'alive').length <= 3);
  }

  private finishGulag(f: Fighter, tier: number, won: boolean) {
    this.emit({ k: 'gulag', id: f.id, winner: won });
    if (this.finalFight()) {
      // the final fight is already on: there is no swarm to lead
      f.role = 'out';
      f.duel = undefined;
      f.hp = f.maxHp;
      f.defeated = false;
      f.invUntil = 0;
      this.rosterDirty = true;
      this.toast(f.id, 'The final fight has begun. Watch it unfold.');
      return;
    }
    this.becomeLeader(f, tier);
  }

  private startDuel(slot: number, a: Fighter, b: Fighter | null) {
    const cx = GULAG_X;
    const cz = -120 + slot * 80;
    const duel: Duel = { id: this.nextDuel++, slot, a, b, warden: null, startedAt: this.time, cx, cz };
    this.duels.push(duel);
    a.duel = duel;
    if (b) b.duel = duel;
    for (const [i, f] of [a, b].entries()) {
      if (!f) continue;
      f.x = cx + (i === 0 ? -9 : 9);
      f.z = cz;
      f.yaw = i === 0 ? Math.PI / 2 : -Math.PI / 2;
      f.input.yaw = f.yaw;
      f.defeated = false;
      f.invUntil = this.time + 2.5; // a moment to get ready
      f.cdAt = [this.time + 1, this.time + 1, 0, 0];
      this.recompute(f, true);
    }
    if (!b) {
      const def = mobDef('alpha_bear');
      const w = this.makeMob({ ...def, id: 'warden', name: 'The Warden', hp: 380, dmg: 16, speed: 6, r: 1.2, tier: 3 }, cx + 9, cz, 0);
      w.warden = true;
      w.state = 'attack';
      w.target = a;
      w.until = Infinity;
      w.awake = true;
      duel.warden = w;
      this.mobs.push(w);
    }
    this.emit({ k: 'toast', to: a.id, text: b ? `Gulag duel vs ${b.name}!` : 'Gulag duel vs the Warden!' });
    if (b) this.emit({ k: 'toast', to: b.id, text: `Gulag duel vs ${a.name}!` });
  }

  // --- mobs -----------------------------------------------------------------------------------

  private makeMob(def: MobDef, x: number, z: number, pack: number): Mob {
    return {
      kind: 'm', id: this.nextMob++, def, x, z, y: 0, yaw: this.rnd() * 6.28, hp: def.hp, maxHp: def.hp, r: def.r, state: 'idle', until: 0, tx: x, tz: z,
      homeX: x, homeZ: z, target: null, pack, atkAt: 0, owner: '', awake: false, atkFlash: 0, slowUntil: 0, stunUntil: 0, bleedUntil: 0, bleedDps: 0,
      scareUntil: 0, wander: this.rnd() * 5, hurtFlash: 0,
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
      const pos = wet ?? this.terrain.randomLand(this.rnd, radius, tier >= 3 ? 20 : 0);
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
    const pts = this.fighters.filter((f) => f.hp > 0 && f.role !== 'out' && f.role !== 'gulag');
    for (const m of this.mobs) {
      if (m.warden) {
        m.awake = true;
        continue;
      }
      let near = this.migrating > 0 && !m.def.aquatic;
      if (!near) {
        for (const f of pts) {
          if (Math.abs(f.x - m.x) < 120 && Math.abs(f.z - m.z) < 120) {
            near = true;
            break;
          }
        }
      }
      if (m.owner) near = true;
      if (near && !m.awake) {
        m.awake = true;
        m.wander = this.rnd() * 3;
      }
      if (!near) m.awake = false;
    }
  }

  private maintainPopulation() {
    if (this.time - this.lastPop < 4) return;
    this.lastPop = this.time;
    const ring = ringAt(this.time).r;
    const wild = this.mobs.filter((m) => m.hp > 0 && !m.owner && !m.warden);
    const count = (t: number) => wild.filter((m) => m.def.tier === t).length;
    const targets: [number, number, number][] = [
      [1, this.time < 240 ? 330 : 260, Math.min(ring - 15, MAP_RADIUS - 25)],
      [2, this.time > 90 ? 150 : 0, Math.min(ring - 15, MAP_RADIUS * 0.7)],
      [3, this.time > 90 ? 34 : 0, Math.min(ring - 15, MAP_RADIUS * 0.5)],
    ];
    for (const [tier, want, radius] of targets) {
      if (want === 0 || radius < 40) continue;
      let have = count(tier);
      let guard = 0;
      while (have < want * (tier === 1 ? 1 : 0.9) && guard++ < 3) {
        if (!this.spawnWild(tier, radius, 70)) break;
        have += tier === 3 ? 1 : 3;
      }
    }
    // compact the dead
    this.mobs = this.mobs.filter((m) => m.hp > 0 || m.warden);
    this.mobs = this.mobs.filter((m) => !(m.warden && m.hp <= 0));
    this.drops = this.drops.filter((d) => d.ttl > this.time && d.items.length);
  }

  private updateMobs() {
    const ring = ringAt(this.time);
    const dt = DT;
    const living = this.fighters.filter((f) => f.role === 'alive' && f.hp > 0 && f.subUntil <= this.time);
    const mig = this.migrating > 0;
    for (const m of this.mobs) {
      if (m.hp <= 0 || !m.awake) continue;
      if (m.owner) {
        this.unitAi(m, dt);
        continue;
      }
      m.atkFlash = Math.max(0, m.atkFlash - dt);
      m.hurtFlash = Math.max(0, m.hurtFlash - dt);
      if (m.stunUntil > this.time) continue;
      if (m.bleedUntil > this.time) this.hurt(m, m.bleedDps * dt, null, { dot: true });
      if (m.hp <= 0) continue;
      const slow = m.slowUntil > this.time ? 0.55 : 1;
      let speed = m.def.speed * slow;
      const behavior = m.def.behavior;
      const threatR = m.def.behavior === 'alpha' ? 24 : behavior === 'elite' ? 10 : behavior === 'pack' ? 12 : behavior === 'skittish' ? 6 : 13;

      // lava drives wildlife inward
      const rr = Math.hypot(m.x, m.z);
      if (rr > ring.r - 4 && !m.warden) {
        this.moveMob(m, -m.x, -m.z, speed, dt);
        continue;
      }

      if (m.warden) {
        const t = m.target;
        if (t && t.hp > 0 && !t.defeated) this.chaseAndBite(m, t, speed, dt);
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
      const detect = threatR * stealth;

      switch (m.state) {
        case 'flee': {
          const t = m.target ?? nearest;
          if (t && dist(t, m) < 28 && m.until > this.time) this.moveMob(m, m.x - t.x, m.z - t.z, speed * 1.15, dt);
          else if (m.scareUntil > this.time) this.moveMob(m, m.x - (nearest?.x ?? 0), m.z - (nearest?.z ?? 0), speed * 1.2, dt);
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
        if (m.hp <= 0 || !m.awake || m.owner || m.warden || m.state !== 'idle') continue;
        if (m.def.behavior === 'flee' || m.def.behavior === 'skittish') continue;
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
    const b = m.def.behavior;
    if (b === 'flee' || b === 'skittish') {
      m.state = 'flee';
      m.target = f;
      m.until = this.time + 5;
    } else {
      // a whole pack joins in
      if (m.pack) {
        for (const o of this.mobs) if (o.pack === m.pack && o.hp > 0 && o.state !== 'attack') this.aggro(o, f);
      }
      this.aggro(m, f);
    }
  }

  private chaseAndBite(m: Mob, t: Fighter, speed: number, dt: number) {
    const d = dist(m, t);
    const reach = m.r + t.r + 0.5;
    if (d > reach) this.moveMob(m, t.x - m.x, t.z - m.z, speed * (m.def.behavior === 'alpha' ? 1 : 1.05), dt);
    else {
      m.yaw = yawOf(t.x - m.x, t.z - m.z);
      if (this.time >= m.atkAt) {
        m.atkAt = this.time + (m.def.behavior === 'alpha' ? 1.4 : 1.1);
        m.atkFlash = 0.3;
        if (m.def.behavior === 'alpha') {
          // a sweeping blow
          for (const b of this.bodies(m.x, m.z, m.r + 2.4, (x) => x.kind === 'f' && this.canHit(m, x))) {
            this.hurt(b, m.def.dmg, m, { kind: 'alpha' });
            this.statusTo(m, b, [{ s: 'slow', dur: 1.5, f: 0.5 }], m.def.dmg);
          }
        } else this.hurt(t, m.def.dmg * (0.85 + this.rnd() * 0.3), m, { kind: m.def.id });
      }
    }
    m.y = this.mobY(m);
  }

  private moveMob(m: Mob, dx: number, dz: number, speed: number, dt: number) {
    const l = Math.hypot(dx, dz);
    if (l < 1e-4) return;
    m.yaw = yawOf(dx, dz);
    if (m.owner && !m.warden) {
      // swarm units fly/skim over everything
      m.x += (dx / l) * speed * dt;
      m.z += (dz / l) * speed * dt;
      return;
    }
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

  // --- swarm units -------------------------------------------------------------------------------

  private unitAi(m: Mob, dt: number) {
    const L = this.byId.get(m.owner);
    m.atkFlash = Math.max(0, m.atkFlash - dt);
    if (!L || L.role !== 'leader' || L.hp <= 0 || this.disbanded) {
      m.hp = 0;
      return;
    }
    const frenzy = L.frenzyUntil > this.time;
    const speed = m.def.speed * (frenzy ? 1.3 : 1) * (L.tier === 3 ? 1.1 : 1);
    const dmg = m.def.dmg * (1 + (L.tier - 1) * 0.25) * (frenzy ? 1.6 : 1);
    const anchorX = L.order === 'guard' ? L.guardX : L.x;
    const anchorZ = L.order === 'guard' ? L.guardZ : L.z;
    const ring = ringAt(this.time);
    if (Math.hypot(m.x, m.z) > ring.r) this.hurt(m, m.maxHp * ring.dps * dt, null, { lava: true });
    const aggroR = L.order === 'guard' ? 14 : 16;
    let tgt: Fighter | null = null;
    if (L.order !== 'scatter') {
      let bd = L.order === 'attack' ? 70 : aggroR;
      for (const f of this.fighters) {
        if (f.role !== 'alive' || f.hp <= 0 || f.team === L.team || f.subUntil > this.time) continue;
        const d = L.order === 'attack' ? dist(f, L) : dist(f, { x: anchorX, z: anchorZ });
        if (d < bd) {
          bd = d;
          tgt = f;
        }
      }
    }
    if (tgt) {
      const d = dist(m, tgt);
      if (d > m.r + tgt.r + 0.4) this.moveMob(m, tgt.x - m.x, tgt.z - m.z, speed, dt);
      else if (this.time >= m.atkAt) {
        m.atkAt = this.time + 1;
        m.atkFlash = 0.25;
        this.hurt(tgt, dmg, m, { kind: 'swarm' });
      }
    } else if (L.order === 'scatter') {
      m.wander -= dt;
      if (m.wander <= 0) {
        m.wander = 1.5 + this.rnd() * 2;
        const a = this.rnd() * 6.28;
        m.tx = L.x + Math.cos(a) * (14 + this.rnd() * 20);
        m.tz = L.z + Math.sin(a) * (14 + this.rnd() * 20);
      }
      this.moveMob(m, m.tx - m.x, m.tz - m.z, speed * 0.8, dt);
    } else {
      m.wander -= dt;
      const d = dist(m, { x: anchorX, z: anchorZ });
      if (m.wander <= 0) {
        m.wander = 1 + this.rnd() * 2;
        const a = this.rnd() * 6.28;
        const r = 2 + this.rnd() * (L.order === 'guard' ? 4 : 5);
        m.tx = anchorX + Math.cos(a) * r;
        m.tz = anchorZ + Math.sin(a) * r;
      }
      if (d > 14) this.moveMob(m, anchorX - m.x, anchorZ - m.z, speed * 1.4, dt);
      else if (dist(m, { x: m.tx, z: m.tz }) > 0.6) this.moveMob(m, m.tx - m.x, m.tz - m.z, speed * 0.6, dt);
    }
    const g = Math.max(this.terrain.heightAt(m.x, m.z), WATER_Y);
    m.y = g + (m.def.flies ? 1.1 + Math.sin(this.time * 8 + m.id) * 0.2 : 0);
  }

  private topUpSwarms() {
    this.allocateSwarms();
    for (const f of this.fighters) {
      if (f.role !== 'leader' || f.hp <= 0) continue;
      const want = this.swarmWant.get(f.id) ?? 0;
      const units = this.leaderUnits(f.id);
      if (units.length > want) {
        for (const m of units.slice(want)) m.hp = 0;
      } else if (units.length < want && this.tickN % 10 === 0) {
        const kind = SWARMS.find((s) => s.id === f.swarm)!;
        const def = mobDef(kind.unit);
        for (let i = 0; i < Math.min(3, want - units.length); i++) {
          const a = this.rnd() * 6.28;
          const m = this.makeMob(def, f.x + Math.cos(a) * 2.5, f.z + Math.sin(a) * 2.5, 0);
          m.owner = f.id;
          m.awake = true;
          this.mobs.push(m);
        }
      }
    }
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
        this.hurt(hit, p.dmg, p.src, { kind: 'proj' });
        this.statusTo(p.src, hit, p.st, p.src.dv.dmg);
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
    if (f.role === 'leader' && f.hp <= 0) {
      if (t >= f.respawnAt && !this.disbanded) {
        f.hp = f.maxHp;
        const a = this.rnd() * 6.28;
        const ring = ringAt(t).r;
        let x = f.x + Math.cos(a) * 8;
        let z = f.z + Math.sin(a) * 8;
        const d = Math.hypot(x, z);
        if (d > ring - 10) {
          x *= (ring - 10) / d;
          z *= (ring - 10) / d;
        }
        f.x = x;
        f.z = z;
        f.invUntil = t + 2;
        this.toast(f.id, 'Your swarm is called back.');
      }
      return;
    }
    if (f.hp <= 0) return;

    // statuses
    const stunned = f.stunUntil > t;
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
    const med = medium(this.terrain, f.x, f.z, f.def.swim === 'water' && f.role === 'alive', f.mods.waterSpeed);
    let base = f.dv.speed * (1 + this.buffSum(f, 'speed')) * med.mul;
    if (f.speedUntil > t) base *= 1.12;
    if (f.slow && f.slow.until > t) base *= 1 - f.slow.f;
    else f.slow = undefined;
    if (f.subUntil > t) base *= 1.2;
    if (f.role === 'leader' && f.frenzyUntil > t) base *= 1.15;
    f.walkSpeed = base;
    const bound: Bound = f.role === 'gulag' && f.duel ? { cx: f.duel.cx, cz: f.duel.cz, r: GULAG_R } : f.role === 'gulag' ? { cx: GULAG_X - 70, cz: 0, r: 19 } : MAP_BOUND;
    f.moving = false;
    f.sprinting = false;
    if (f.dash) {
      const d = f.dash;
      if (t > d.until) {
        f.dash = undefined;
      } else {
        stepPos(this.terrain, f, d.dx, d.dz, d.speed * dt, f.r, bound);
        const bs = this.bodies(f.x, f.z, d.aoe ? d.aoe : f.r + 0.4, (b) => b !== f && this.canHit(f, b) && !d.hit.has(b));
        for (const b of bs) {
          d.hit.add(b);
          if (d.dmg > 0) this.hurt(b, d.dmg * this.dmgMult(f, b), f, { kind: 'dash' });
          this.statusTo(f, b, d.st, f.dv.dmg);
          if (d.knock > 0) {
            const p = { x: b.x, z: b.z };
            stepPos(this.terrain, p, d.dx, d.dz, d.knock, b.r, MAP_BOUND);
            b.x = p.x;
            b.z = p.z;
          }
        }
      }
      // the player's queued steps are skipped, not saved up
      for (const c of f.cmds) f.ack = c.s;
      f.cmds.length = 0;
    } else if (f.bot) {
      this.applyMove(f, inp.dx, inp.dz, inp.sprint, inp.crouch, dt, base, med.noSprint, blocked, bound);
    } else {
      // humans send timed steps; run as many as the clock allows so nobody outruns the server
      let spent = 0;
      const budget = dt * 1.35;
      while (f.cmds.length && spent < budget - 1e-6) {
        const c = f.cmds[0];
        const take = Math.min(c.dt, budget - spent);
        if (take > 0) this.applyMove(f, c.dx, c.dz, c.sprint, c.crouch, take, base, med.noSprint, blocked, bound);
        else if (c.dt > 0) break;
        c.dt -= take;
        spent += take;
        if (c.dt < 1e-4) {
          f.ack = c.s;
          f.cmds.shift();
        }
      }
      if (spent === 0) this.applyMove(f, 0, 0, false, false, dt, base, med.noSprint, blocked, bound);
      // a client that went quiet should not keep attacking
      if (t - f.lastInputAt > 0.5) inp.at = false;
    }
    if (!f.dash && !blocked && !f.chan && inp.at) {
      f.yaw = inp.yaw; // attacking faces the camera
      if (f.role === 'leader' || f.role === 'alive' || (f.role === 'gulag' && f.duel && !f.defeated)) this.basicAttack(f);
    }
    f.y = standY(this.terrain, f.x, f.z);
    (f as { speedNow?: number }).speedNow = base;

    // submerged / reed hiding needs water
    if (f.subUntil > t && !(this.terrain.depthAt(f.x, f.z) > 0.2)) f.subUntil = 0;
    if (f.reedUntil > t && !(this.terrain.depthAt(f.x, f.z) > 0.2)) f.reedUntil = 0;

    // lava
    if (f.role !== 'gulag' && !inGulagZone(f.x)) {
      const ring = ringAt(t);
      if (Math.hypot(f.x, f.z) > ring.r && f.glideUntil <= t) {
        this.hurt(f, f.maxHp * ring.dps * dt, null, { lava: true, kind: 'lava' });
      }
    }
  }

  /** One step of walking: stamina, facing, and the move itself. */
  private applyMove(f: Fighter, dx: number, dz: number, sprint: boolean, crouch: boolean, dt: number, base: number, noSprint: boolean, blocked: boolean, bound: Bound) {
    const k = Math.hypot(dx, dz);
    const moving = k > 0.05;
    let sp = base;
    let sprinting = false;
    if (sprint && moving && !noSprint && f.role !== 'leader' && (f.sta > 1 || this.hasFree(f))) {
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
      if (!blocked && !moving && f.input.at) f.yaw += clampTurn(angDiff(f.input.yaw, f.yaw), 14 * dt);
      return;
    }
    f.moving = true;
    f.sprinting = sprinting;
    stepPos(this.terrain, f, dx, dz, sp * dt * Math.min(1, k), f.r, bound);
    // face where they walk (the camera yaw only steers)
    f.yaw += clampTurn(angDiff(yawOf(dx, dz), f.yaw), (f.def.size === 'large' ? 7 : 12) * dt);
  }

  // --- hunted mark -----------------------------------------------------------------------------

  private updateHunted() {
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
      for (let i = 0; i < 38; i++) this.spawnWild(2, MAP_RADIUS * 0.7, 40);
      for (let i = 0; i < 26; i++) this.spawnWild(3, MAP_RADIUS * 0.5, 40);
    }
  }

  private checkEnd() {
    const alive = this.fighters.filter((f) => f.role === 'alive');
    const teams = new Set(alive.map((f) => f.team));
    // 3 players left: every swarm disbands for a clean final fight
    if (!this.disbanded && alive.length <= 3 && this.fighters.length > 3) {
      this.disbanded = true;
      for (const f of this.fighters) {
        if (f.role === 'leader') {
          this.removeUnits(f.id);
          f.role = 'out';
          f.hp = f.maxHp;
        }
      }
      for (const d of this.duels) d.warden && (d.warden.hp = 0);
      this.emit({ k: 'disband' });
      this.emit({ k: 'toast', text: 'Three left! All swarms disband.' });
      this.rosterDirty = true;
    }
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
    this.topUpSwarms();
    this.updateGulag();
    this.updateHunted();
    this.maintainPopulation();
    if (this.tickN % 15 === 0) this.checkEnd();
    // wild animals and swarm units also burn
    if (this.time - this.lastLava > 0.5) {
      const dtl = this.time - this.lastLava;
      this.lastLava = this.time;
      const ring = ringAt(this.time);
      for (const m of this.mobs) {
        if (m.hp > 0 && !m.warden && !m.owner && Math.hypot(m.x, m.z) > ring.r) this.hurt(m, m.maxHp * ring.dps * dtl * 1.5, null, { lava: true });
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
    const ring = ringAt(this.time);
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
      leaders: this.fighters.filter((f) => f.role === 'leader').length,
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
    if (f.stunUntil > t) fl |= FL.stun;
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
    return fl;
  }

  private statusNames(f: Fighter): string[] {
    const t = this.time;
    const out = f.buffs.filter((b) => b.until > t).map((b) => b.id);
    if (f.blindUntil > t) out.push('blind');
    if (f.bleed && f.bleed.until > t) out.push('bleeding');
    if (f.stunUntil > t) out.push('stunned');
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
    const cdMax = [0, 1, 2, 3].map((i) => (f.role === 'leader' ? (i === 0 ? (SWARMS.find((s) => s.id === f.swarm)?.skill.cd ?? 10) : 25) : (sk[i]?.cd ?? 0)));
    const you: YouState = {
      x: r1(f.x), z: r1(f.z), hp: Math.max(0, Math.round(f.hp)), maxHp: f.maxHp, sta: Math.round(f.sta), maxSta: f.dv.maxSta,
      lvl: f.level, xp: Math.round(f.xp), need: f.level >= MAX_LEVEL ? 1 : xpNeed(f.level), pts: f.pts, alloc: f.alloc, picks: f.picks,
      cds: cds.map((c) => Math.round(c * 10) / 10), cdMax, inv: f.inv, role: ROLE_CODE[f.role], speed: f.walkSpeed || f.dv.speed,
      noMove: f.stunUntil > t || f.grab || f.dash || f.chan ? 1 : 0, buffs: this.statusNames(f), sense: Math.round(f.dv.sense),
      ability: f.ability && f.ability.until > t ? f.ability.k : '', channel: f.chan ? { k: f.chan.k, left: Math.max(0, f.chan.until - t), total: f.chan.total } : null, kills: f.kills,
    };
    if (f.role === 'leader') {
      you.swarm = {
        kind: f.swarm!, tier: f.tier, units: this.leaderUnits(f.id).length, want: this.swarmWant.get(f.id) ?? 0, order: f.order, eaten: f.eaten,
        next: f.tier === 1 ? 6 : f.tier === 2 ? 14 : 0, respawn: f.hp <= 0 ? Math.max(0, f.respawnAt - t) : 0,
      };
    }
    if (f.role === 'gulag') {
      const foe = f.duel ? (f.duel.warden ? 'The Warden' : ((f.duel.a === f ? f.duel.b : f.duel.a)?.name ?? '')) : '';
      you.gulag = { phase: f.duel ? 'duel' : 'wait', foe, left: f.duel ? Math.max(0, 55 - (t - f.duel.startedAt)) : 0, choose: swarmChoices(f.deathBiome).map((s) => s.id) };
    }
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
      const inGulag = inGulagZone(cx);
      const f: [string, number, number, number, number, number, number][] = [];
      for (const o of this.fighters) {
        if (o === me || o.role === 'out') continue;
        if (o.role === 'leader' && o.hp <= 0) continue;
        const d = Math.hypot(o.x - cx, o.z - cz);
        if (d > 170) continue;
        if (inGulagZone(o.x) !== inGulag) continue;
        const friend = o.team === me.team;
        const hidden = o.subUntil > this.time || o.reedUntil > this.time || (this.terrain.inBush(o.x, o.z) && !o.moving && !inGulag);
        if (hidden && !friend && d > Math.max(8, sense * 0.2)) continue;
        f.push([o.id, r1(o.x), r1(o.z), Math.round(o.yaw * 100) / 100, Math.round((o.hp / o.maxHp) * 100), o.level, this.flags(o) | (hidden ? FL.hidden : 0)]);
      }
      if (focus !== me) f.push([focus.id, r1(focus.x), r1(focus.z), Math.round(focus.yaw * 100) / 100, Math.round((focus.hp / focus.maxHp) * 100), focus.level, this.flags(focus)]);
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
        if (o.owner) fl |= 16;
        if (o.stunUntil > this.time) fl |= 32;
        if (o.warden) fl |= 64;
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
