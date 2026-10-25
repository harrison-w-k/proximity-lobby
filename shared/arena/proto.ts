// Messages between the match server and its clients (carried on the same socket as the lobby).
import type { StatKey, Stats } from './animals';

export type Role = 'alive' | 'out';
export const ROLE_CODE: Record<Role, number> = { alive: 0, out: 3 };

export type ItemKind = 'morsel' | 'meat' | 'berry' | 'herb' | 'water' | 'mud' | 'honey' | 'feather' | 'tusk' | 'musk' | 'reed';
export interface InvItem {
  k: ItemKind;
  n: number; // stack size, or sips for water
  born: number; // match time it was picked up (meat spoils)
}

// --- client -> server ------------------------------------------------------------------------

export type ClientMatchMsg =
  | { t: 'menter'; animal: string; paint?: [number, number] } // walk into the campus as this animal
  | { t: 'mq'; animal: string; team?: string; spawn?: string; paint?: [number, number] } // join the queue for the next match (and where to drop)
  | { t: 'mqx' } // leave the queue
  | { t: 'min'; s: number; dt: number; x: number; z: number; yaw: number; sp: 0 | 1; cr: 0 | 1; at: 0 | 1; j?: 0 | 1 } // a timed step: seq, ms it covers, direction (-1..1), camera yaw, sprint, crouch, attack held
  | { t: 'mskill'; i: number; yaw: number } // use the skill in slot 0..3 (Q E R F)
  | { t: 'mstat'; k: StatKey }
  | { t: 'mevolve'; to: string } // evolve into this form (needs level 5 / 10)
  | { t: 'muse'; i: number } // use or eat the inventory slot
  | { t: 'mact'; a: 'harvest' | 'loot' | 'drink' | 'drop'; i?: number }
  | { t: 'mguard'; on: 0 | 1 } // tap (on: 1) to parry: the guard stays up about half a second
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
  paint?: [number, number]; // chosen colours
  dummy?: boolean; // a target dummy on the island
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
  evolve: string[]; // forms you can evolve into right now (empty until level 5 / 10)
  cds: number[]; // seconds left for slots Q E R F
  cdMax: number[];
  dash: number; // seconds until you can dash again
  dashMax: number;
  jy: number; // height above the ground
  jv: number;
  parryWin: number; // seconds the parry window stays open
  parryCd: number; // seconds until you can parry again
  guard: boolean;
  wind: boolean; // winding up an attack
  guardAge: number; // seconds since the guard went up
  combo: number; // which swing of the chain comes next
  comboLen: number; // strikes in this animal's chain (3 to 5)
  comboHeavy: number; // bit mask of the heavy strikes in the chain
  counter: number; // seconds left of the counter-attack bonus after a parry
  inv: (InvItem | null)[];
  role: number;
  speed: number; // current movement speed (m/s) used for prediction
  noMove: number; // 1 while stunned / grabbed / dashing: do not predict
  buffs: string[];
  shield: number; // overhealth on top of your health, in health points
  view?: string; // a spectator is watching this fighter
  sense: number;
  ability: string; // active item ability, '' if none
  channel: { k: string; left: number; total: number } | null;
  kills: number;
}

export interface Global {
  time: number;
  phase: number; // 0..4
  ring: number; // current lava radius (m)
  ringTo: number; // radius it is closing to (m)
  ringAt: number; // match time it begins closing (0 if closing now / done)
  ringN: number; // which ring is next/closing (1..)
  alive: number;
  top: [id: string, lvl: number][]; // hunted
  mig: number; // 1 during the migration stampede
}

export type ServerMatchMsg =
  | { t: 'mq'; q: QueueInfo }
  | { t: 'mstart'; seed: number; you: string; roster: RosterEntry[]; nodes: [id: number, until: number][]; campus?: boolean; island?: boolean; pvp?: boolean }
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
  | { k: 'swing'; id: string; c: number; w: number; h: boolean; r: number; a: number; x: number; z: number; yaw: number; s: string; rc: number } // a basic attack winds up: s = the strike type, rc = its recovery
  | { k: 'mswing'; id: number; x: number; z: number; yaw: number; w: number; r: number; big: boolean } // a boss winds up
  | { k: 'whiff'; id: string; x: number; z: number } // a parry that caught nothing
  | { k: 'evolving'; id: string; to: string; x: number; z: number } // started to evolve
  | { k: 'evolve'; id: string; to: string; x: number; z: number } // finished evolving
  | { k: 'parry'; id: string; by: string; x: number; z: number; heavy: boolean; mob?: number; stun?: number }
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
  | { k: 'proj'; id: number; x: number; z: number; tx: number; tz: number; kind: string }
  | { k: 'lure'; x: number; z: number }
  | { k: 'soar'; id: string; x: number; z: number }
  | { k: 'shield'; id: string; x: number; z: number } // overhealth gained

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
  soar: 1048576, // gliding on outstretched wings
} as const;
