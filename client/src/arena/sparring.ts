// Sparring in the lobby: your animal's attack and two signature skills, with the full wind-up animations,
// but nobody can be hurt. Damage numbers pop up and everyone shrugs it off.
import { ANIMAL_BY_ID } from '../../../shared/arena/animals';
import { comboOf } from '../../../shared/arena/combat';
import { STRIKE_TIME, type Cue } from './anim';

export type Slot = 'a' | 'q' | 'x';

const SKILL_WIND: Record<string, number> = { cone: 0.22, dash: 0.18, aoe: 0.3, proj: 0.16, grab: 0.2 };

/** Where a move lands, relative to the caster (who faces +fwd). */
export type Shape =
  | { k: 'cone'; range: number; arc: number } // arc in degrees, centred on facing
  | { k: 'circle'; r: number }
  | { k: 'line'; len: number; width: number }
  | { k: 'none' };

export interface Move {
  cue: Cue;
  shape: Shape;
  dmg: number; // the number shown (nobody loses anything)
  wind: number; // seconds until it lands
  cooldown: number;
  label: string;
  /** 0 = nothing, 1 = a short hop forward while it lands */
  lunge: number;
}

export const COOLDOWN: Record<Slot, number> = { a: 0.55, q: 1.8, x: 1.8 };

export function slotLabel(animal: string, slot: Slot): string {
  const def = ANIMAL_BY_ID.get(animal);
  if (!def) return '';
  return slot === 'a' ? 'Attack' : slot === 'q' ? def.skill.name : '';
}

/** Builds the animation cue, hit shape and damage number for one of an animal's three lobby moves. */
export function makeMove(animal: string, slot: Slot, combo: number, now: number): Move | null {
  const def = ANIMAL_BY_ID.get(animal);
  if (!def) return null;
  const atk = def.stats.atk;
  if (slot === 'a') {
    const seq = comboOf(animal);
    const c = seq[combo % seq.length];
    const heavy = c.heavy;
    return {
      cue: { kind: 'swing', animal, combo: combo % seq.length, heavy, move: c.kind, skill: '', fx: '', start: now, wind: c.wind * 1.2, strike: STRIKE_TIME * 1.2, rec: c.rec * 1.2 },
      shape: { k: 'cone', range: 2.8, arc: heavy ? 130 : 100 },
      dmg: Math.round(atk * (heavy ? 1.7 : 1.1)),
      wind: c.wind * 1.2,
      cooldown: COOLDOWN.a + (heavy ? 0.35 : 0),
      label: 'Attack',
      lunge: 0,
    };
  }
  if (slot === 'x') return null;
  const sk = def.skill;
  const fx = sk.fx;
  if (!fx) return null;
  const instant = fx.k === 'buff' || fx.k === 'heal' || fx.k === 'submerge';
  const wind = (SKILL_WIND[fx.k] ?? 0) * 1.2;
  const cue: Cue = { kind: instant ? 'flex' : 'skill', animal, combo: -1, heavy: fx.k === 'grab' || fx.k === 'aoe', skill: sk.id, fx: fx.k, start: now, wind, strike: STRIKE_TIME * 1.2, rec: 0.5 };
  const base = { cue, wind, cooldown: COOLDOWN[slot], label: sk.name, lunge: 0 };
  switch (fx.k) {
    case 'cone':
      return { ...base, shape: { k: 'cone', range: Math.min(5, fx.range), arc: fx.arc }, dmg: Math.round(atk * (fx.dmg || 0.8) * 1.3) };
    case 'dash':
      return { ...base, shape: { k: 'line', len: Math.min(7, fx.dist) + 1.2, width: 2.2 + (fx.aoe ?? 0) }, dmg: Math.round(atk * (fx.dmg || 0.8) * 1.3), lunge: 1 };
    case 'aoe':
      return { ...base, shape: { k: 'circle', r: Math.min(6, fx.r) }, dmg: Math.round(atk * (fx.dmg || 0.6) * 1.3) };
    case 'proj':
      return { ...base, shape: { k: 'line', len: Math.min(14, fx.range), width: 1.4 }, dmg: Math.round(atk * (fx.dmg || 0.8) * 1.3) };
    case 'grab':
      return { ...base, shape: { k: 'cone', range: Math.min(4, fx.range), arc: 60 }, dmg: Math.round(atk * 0.9) };
    default:
      return { ...base, shape: { k: 'none' }, dmg: 0 };
  }
}

/** Is a target at (tx, tz) hit by this shape cast from (ox, oz) facing (fx, fz)? */
export function inShape(s: Shape, ox: number, oz: number, fx: number, fz: number, tx: number, tz: number): boolean {
  const dx = tx - ox;
  const dz = tz - oz;
  const d = Math.hypot(dx, dz);
  switch (s.k) {
    case 'none':
      return false;
    case 'circle':
      return d <= s.r + 0.4;
    case 'cone': {
      if (d > s.range + 0.4) return false;
      if (d < 0.5) return true;
      const cos = (dx * fx + dz * fz) / d;
      return cos >= Math.cos((s.arc / 2) * (Math.PI / 180));
    }
    case 'line': {
      const along = dx * fx + dz * fz;
      const side = Math.abs(dx * -fz + dz * fx);
      return along >= -0.3 && along <= s.len && side <= s.width / 2 + 0.4;
    }
  }
}
