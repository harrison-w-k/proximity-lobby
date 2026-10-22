// Messages between the match server and its clients (carried on the same socket as the lobby).
import type { StatKey, Stats } from './animals';
import type { SwarmKind } from './mobs';

export type Role = 'alive' | 'gulag' | 'leader' | 'out';
export const ROLE_CODE: Record<Role, number> = { alive: 0, gulag: 1, leader: 2, out: 3 };

export type ItemKind = 'meat' | 'berry' | 'herb' | 'water' | 'mud' | 'honey' | 'feather' | 'tusk' | 'musk' | 'reed';
export interface InvItem {
  k: ItemKind;
  n: number; // stack size, or sips for water
  born: number; // match time it was picked up (meat spoils)
}

// --- client -> server ------------------------------------------------------------------------

export type ClientMatchMsg =
  | { t: 'mq'; animal: string; team?: string } // join the queue for the next match
  | { t: 'mqx' } // leave the queue
  | { t: 'min'; s: number; dt: number; x: number; z: number; yaw: number; sp: 0 | 1; cr: 0 | 1; at: 0 | 1; j?: 0 | 1 } // a timed step: seq, ms it covers, direction (-1..1), camera yaw, sprint, crouch, attack held
  | { t: 'mskill'; i: number; yaw: number } // use the skill in slot 0..3 (Q E R F)
  | { t: 'mstat'; k: StatKey }
  | { t: 'mpick'; i: number; o: number } // choose option o (0/1) at unlock tier i (0..3)
  | { t: 'muse'; i: number } // use or eat the inventory slot
  | { t: 'mact'; a: 'harvest' | 'loot' | 'drink' | 'drop'; i?: number }
  | { t: 'mcmd'; c: 'attack' | 'scatter' | 'guard' | 'skill' | 'frenzy'; yaw?: number }
  | { t: 'mswarm'; k: SwarmKind }
  | { t: 'mguard'; on: 0 | 1 } // hold to guard; a guard raised just before a hit is a parry
  | { t: 'mdash'; x: number; z: number } // burst of speed toward (x, z), or where you face if both are 0
  | { t: 'mleave' };

// --- server -> client ------------------------------------------------------------------------

export interface RosterEntry {
  id: string;
  name: string;
  animal: string;
  team: number;
  bot: boolean;
  role: number; // ROLE_CODE
  swarm?: SwarmKind;
  tier?: number;
}

export interface QueueInfo {
  queued: number; // humans waiting
  startsIn: number | null; // seconds, or null if no countdown is running
  inMatch: boolean; // a match is running (the next one forms after it)
  you: boolean; // you are queued
  slots: number;
}

export interface YouState {
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  sta: number;
  maxSta: number;
  lvl: number;
  xp: number;
  need: number;
  pts: number;
  alloc: Stats;
  picks: number[]; // -1 = not chosen, else 0/1
  cds: number[]; // seconds left for slots Q E R F
  cdMax: number[];
  dash: number; // seconds until you can dash again
  dashMax: number;
  jy: number; // height above the ground
  jv: number;
  guard: boolean;
  wind: boolean; // winding up an attack
  guardAge: number; // seconds since the guard went up (a parry needs it under ~0.24)
  combo: number; // 0..2: which swing of the combo comes next
  counter: number; // seconds left of the counter-attack bonus after a parry
  inv: (InvItem | null)[];
  role: number;
  speed: number; // current movement speed (m/s) used for prediction
  noMove: number; // 1 while stunned / grabbed / dashing: do not predict
  buffs: string[];
  view?: string; // a spectator is watching this fighter
  sense: number;
  ability: string; // active item ability, '' if none
  channel: { k: string; left: number; total: number } | null;
  kills: number;
  swarm?: { kind: SwarmKind; tier: number; units: number; want: number; order: string; eaten: number; next: number; respawn: number };
  gulag?: { phase: 'wait' | 'duel' | 'done'; foe: string; left: number; choose: SwarmKind[] };
}

export interface Global {
  time: number;
  phase: number; // 0..4
  ring: number; // current lava radius (m)
  ringTo: number; // radius it is closing to (m)
  ringAt: number; // match time it begins closing (0 if closing now / done)
  ringN: number; // which ring is next/closing (1..)
  alive: number;
  leaders: number;
  top: [id: string, lvl: number][]; // hunted
  mig: number; // 1 during the migration stampede
}

export type ServerMatchMsg =
  | { t: 'mq'; q: QueueInfo }
  | { t: 'mstart'; seed: number; you: string; roster: RosterEntry[]; nodes: [id: number, until: number][] }
  | { t: 'mros'; r: RosterEntry[] }
  | {
      t: 'snap';
      ack: number;
      you: YouState;
      g: Global;
      f: [id: string, x: number, z: number, yaw: number, hp: number, lvl: number, flags: number, jy: number][];
      m: [id: number, def: number, x: number, z: number, yaw: number, hp: number, flags: number][];
      d: [id: number, kind: string, x: number, z: number, n: number][]; // ground drops near you
      ev: MatchEvent[];
    }
  | { t: 'mend'; winner: string; team: number; results: { id: string; name: string; animal: string; lvl: number; kills: number; place: number; dmg: number }[] };

export type MatchEvent =
  | { k: 'hit'; id: string; x: number; z: number; n: number; crit?: boolean }
  | { k: 'mobhit'; x: number; z: number; n: number }
  | { k: 'skill'; id: string; s: string; x: number; z: number; yaw: number; r?: number; w?: number } // a skill was started (w = seconds of wind-up)
  | { k: 'strike'; id: string; s: string; x: number; z: number; yaw: number } // the skill lands
  | { k: 'swing'; id: string; c: number; w: number; h: boolean; r: number; a: number; x: number; z: number; yaw: number } // a basic attack winds up
  | { k: 'mswing'; id: number; x: number; z: number; yaw: number; w: number; r: number; big: boolean } // a boss winds up
  | { k: 'parry'; id: string; by: string; x: number; z: number; heavy: boolean }
  | { k: 'block'; id: string; x: number; z: number; broke: boolean }
  | { k: 'dodge'; id: string; x: number; z: number }
  | { k: 'pickup'; id: string; item: string; n: number }
  | { k: 'streak'; id: string; n: number } // kills in a row without falling
  | { k: 'kill'; killer: string; victim: string; how: string }
  | { k: 'level'; id: string; lvl: number }
  | { k: 'phase'; n: number; name: string }
  | { k: 'ringwarn'; n: number; in: number; to: number }
  | { k: 'ring'; n: number; to: number }
  | { k: 'roar'; id: string; x: number; z: number }
  | { k: 'migration' }
  | { k: 'alpha'; x: number; z: number }
  | { k: 'node'; id: number; until: number }
  | { k: 'toast'; to?: string; text: string }
  | { k: 'disband' }
  | { k: 'proj'; id: number; x: number; z: number; tx: number; tz: number; kind: string }
  | { k: 'lure'; x: number; z: number }
  | { k: 'gulag'; id: string; winner?: boolean };

// flag bits in snapshots
export const FL = {
  hunted: 1,
  marked: 2,
  bleed: 4,
  stun: 8,
  grabbed: 16,
  hidden: 32,
  buff: 64,
  atk: 128,
  dash: 256,
  sprint: 512,
  crouch: 1024,
  slow: 2048,
  scared: 4096,
  moving: 8192,
  roar: 16384,
  guard: 32768,
  wind: 65536, // winding up an attack
  air: 131072,
  counter: 262144,
  heavy: 524288, // the wind-up is a heavy attack
} as const;
