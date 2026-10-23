// Attack and skill animation. Every animal moves differently, and every move has three clear
// parts so it can be read and answered: a WIND-UP (the telegraph), a fast STRIKE, then a RECOVERY.
import { SKILL_BY_ID } from '../../../shared/arena/animals';
import { CUSTOM_COMBO_IDS } from '../../../shared/arena/combat';

const HAS_OWN_CHAIN = new Set(CUSTOM_COMBO_IDS);

export interface Pose {
  y: number; // body offset up
  z: number; // body offset forward
  rx: number; // body pitch (negative = nose up)
  ry: number; // body yaw
  rz: number; // body roll
  hx: number; // head pitch (negative = up)
  hy: number; // head yaw
  fl: number; // front legs (pivot x): negative swings them forward / up
  fr: number;
  bl: number; // hind legs
  br: number;
  tail: number; // tail pitch
  sc: number; // overall scale
}

export const zeroPose = (): Pose => ({ y: 0, z: 0, rx: 0, ry: 0, rz: 0, hx: 0, hy: 0, fl: 0, fr: 0, bl: 0, br: 0, tail: 0, sc: 1 });

export type Style = 'bite' | 'swipe' | 'snap' | 'gore' | 'quill' | 'slap';
export const STYLE: Record<string, Style> = { house_cat: 'swipe', bobcat: 'swipe', lynx: 'swipe', cheetah: 'swipe', panther: 'swipe', tiger: 'swipe', lion: 'swipe', fox: 'bite', coyote: 'bite', jackal: 'bite', gray_wolf: 'bite', dhole: 'bite', hyena: 'bite', wild_dog: 'bite', weasel: 'bite', badger: 'bite', honey_badger: 'bite', wolverine: 'bite', gecko: 'bite', ant: 'bite', river_otter: 'slap', giant_otter: 'slap', sea_otter: 'slap', bombardier: 'slap', raccoon: 'swipe', black_bear: 'swipe', sloth_bear: 'swipe', grizzly: 'swipe', polar_bear: 'swipe', kodiak: 'swipe', panda: 'swipe', monitor: 'snap', snapping_turtle: 'snap', komodo: 'snap', cobra: 'snap', croc: 'snap', tortoise: 'snap', spider: 'snap', tarantula: 'snap', black_widow: 'snap', mudskipper: 'snap', piranha: 'snap', pufferfish: 'snap', bull_shark: 'snap', barracuda: 'snap', eel: 'snap', angler: 'snap', beetle: 'gore', hercules: 'gore' };

export interface Cue {
  kind: 'swing' | 'skill' | 'parry' | 'flex';
  animal: string;
  combo: number; // which strike of the chain this is (0 = the first)
  move?: string; // the strike type (claw, bite, slam...); animals with their own chain animate by it
  heavy: boolean;
  skill: string; // skill id
  fx: string; // skill effect kind
  start: number;
  wind: number; // telegraph seconds
  strike: number;
  rec: number;
}

export const STRIKE_TIME = 0.12;

const ease = (k: number) => k * k * (3 - 2 * k);
const out = (k: number) => 1 - (1 - k) * (1 - k);
const TAU = Math.PI * 2;

export type Stage = 'wind' | 'strike' | 'recover';
export interface Phase {
  stage: Stage;
  k: number;
  w: number; // wind-up amount 0..1 (rises during the telegraph, snaps back on the strike)
  s: number; // strike amount 0..1 (lunges out, then eases back during recovery)
}

export function phaseOf(c: Cue, now: number): Phase | null {
  const e = now - c.start;
  if (e < 0) return { stage: 'wind', k: 0, w: 0, s: 0 };
  if (e < c.wind) {
    const k = e / c.wind;
    return { stage: 'wind', k, w: ease(k), s: 0 };
  }
  if (e < c.wind + c.strike) {
    const k = (e - c.wind) / c.strike;
    return { stage: 'strike', k, w: 1 - out(k), s: out(k) };
  }
  if (e < c.wind + c.strike + c.rec) {
    const k = (e - c.wind - c.strike) / c.rec;
    return { stage: 'recover', k, w: 0, s: 1 - ease(k) };
  }
  return null;
}

/** The body pose for a cue at a moment in time, or null once the move is over. */
export function poseFor(c: Cue, now: number): Pose | null {
  const ph = phaseOf(c, now);
  if (!ph) return null;
  const p = zeroPose();
  const { w, s } = ph;
  const odd = c.combo % 2 === 1 ? -1 : 1;
  if (c.kind === 'parry') {
    // a sharp head-snap and a step in: the defender seizing the opening
    const k = Math.min(1, (now - c.start) / 0.3);
    const a = Math.sin(k * Math.PI);
    p.hx = -0.55 * a;
    p.rx = -0.2 * a;
    p.z = 0.18 * a;
    p.sc = 1 + 0.08 * a;
    return k >= 1 ? null : p;
  }
  if (c.kind === 'flex') {
    const k = Math.min(1, (now - c.start) / 0.45);
    p.sc = 1 + 0.12 * Math.sin(k * Math.PI);
    p.rz = Math.sin(k * 26) * 0.07 * (1 - k);
    p.y = -0.04 * Math.sin(k * Math.PI);
    return k >= 1 ? null : p;
  }
  if (c.kind === 'skill') return skillPose(c, ph, p);
  if (c.move && HAS_OWN_CHAIN.has(c.animal)) return strikePose(c, ph, p);
  const style = STYLE[c.animal] ?? 'bite';
  const big = c.animal === 'bear' || c.animal === 'gorilla' ? 1.25 : c.animal === 'croc' || c.animal === 'hippo' ? 1.1 : 1;
  switch (style) {
    case 'bite':
      if (c.combo < 2) {
        p.rx = -0.18 * w + 0.12 * s;
        p.z = -0.18 * w + 0.45 * s;
        p.hx = -0.25 * w + 0.6 * s;
        p.hy = 0.28 * odd * s - 0.2 * odd * w;
        p.fl = p.fr = -0.3 * w;
        p.bl = p.br = 0.3 * s;
        p.tail = -0.4 * w;
      } else {
        // the pounce: crouch low, then launch jaws-first
        p.y = -0.24 * w + 0.16 * s;
        p.rx = -0.38 * w + 0.5 * s;
        p.z = -0.32 * w + 0.95 * s;
        p.hx = -0.22 * w + 0.75 * s;
        p.bl = p.br = 0.7 * w + 0.8 * s;
        p.fl = p.fr = 0.2 * w - 1.0 * s;
        p.tail = 0.5 * w;
      }
      break;
    case 'swipe': {
      const leg = (side: 1 | -1, v: number) => (side === 1 ? (p.fl = v) : (p.fr = v));
      if (c.combo < 2) {
        // a raised paw, then a raking swipe across the body
        leg(odd === 1 ? 1 : -1, -1.55 * w + 0.7 * s);
        p.rz = 0.16 * odd * w - 0.1 * odd * s;
        p.ry = -0.5 * odd * s + 0.14 * odd * w;
        p.z = -0.1 * w + 0.32 * s * big;
        p.hx = 0.12 * s;
      } else {
        // rear up on the hind legs and slam both paws down
        p.rx = -0.62 * w * big + 0.38 * s;
        p.y = 0.12 * w * big - 0.1 * s;
        p.z = -0.12 * w + 0.5 * s;
        p.fl = p.fr = -1.75 * w + 0.85 * s;
        p.hx = -0.3 * w + 0.35 * s;
        p.sc = 1 + 0.06 * w;
      }
      break;
    }
    case 'snap':
      if (c.combo < 2) {
        // jaws open wide and tilt, then slam shut
        p.hx = -0.58 * w + 0.5 * s;
        p.hy = 0.35 * odd * w - 0.5 * odd * s;
        p.rx = -0.1 * w + 0.08 * s;
        p.z = -0.2 * w + 0.55 * s;
        p.tail = 0;
      } else {
        // the death roll: wind back, then spin the whole body
        p.hx = -0.7 * w + 0.4 * s;
        p.rz = ph.stage === 'strike' ? -TAU * ph.k : ph.stage === 'wind' ? -0.35 * w : 0;
        p.y = 0.05 * w;
        p.z = -0.15 * w + 0.5 * s;
      }
      break;
    case 'gore':
      if (c.combo < 2) {
        // head down, scraping a hoof, then an upward toss of the tusks
        p.hx = 0.55 * w - 0.78 * s;
        p.rx = 0.12 * w - 0.14 * s;
        p.y = -0.08 * w;
        p.fl = -0.9 * Math.abs(Math.sin(ph.k * 14)) * (ph.stage === 'wind' ? 1 : 0) + 0.2 * s;
        p.z = -0.1 * w + 0.5 * s;
        p.hy = 0.35 * odd * s;
      } else {
        p.hx = 0.7 * w - 0.95 * s;
        p.rx = 0.22 * w - 0.12 * s;
        p.y = -0.16 * w;
        p.fl = p.fr = -0.8 * Math.abs(Math.sin(ph.k * 18)) * (ph.stage === 'wind' ? 1 : 0);
        p.z = -0.2 * w + 1.15 * s;
        p.bl = p.br = 0.5 * s;
      }
      break;
    case 'quill':
      if (c.combo < 2) {
        // puff up and tremble, then butt forward with the quills flared
        p.sc = 1 + 0.2 * w + 0.12 * s;
        p.rz = Math.sin(ph.k * 40) * 0.07 * (ph.stage === 'wind' ? 1 : 0);
        p.rx = 0.12 * w;
        p.z = -0.08 * w + 0.4 * s;
        p.hx = 0.35 * s;
      } else {
        // curl into a ball and roll forward
        p.sc = 1 + 0.25 * w;
        p.y = 0.1 * w;
        p.rx = ph.stage === 'strike' ? TAU * ph.k : 0.5 * w;
        p.z = -0.1 * w + 0.7 * s;
        p.hx = 0.6 * w;
      }
      break;
    case 'slap':
      if (c.combo < 2) {
        // tail up, then a whipping slap and a quick nip
        p.tail = -1.3 * w + 0.8 * s;
        p.rx = -0.2 * w + 0.1 * s;
        p.z = -0.15 * w + 0.3 * s;
        p.hx = 0.45 * s;
        p.ry = 0.3 * odd * s;
      } else {
        p.tail = -1.4 * w + 0.9 * s;
        p.y = -0.08 * w;
        p.ry = ph.stage === 'strike' ? TAU * ph.k : -0.4 * w;
        p.z = -0.1 * w + 0.4 * s;
      }
      break;
  }
  return p;
}

/** The body language of each strike type. Forms with their own chain animate by this, so every strike reads differently. */
function strikePose(c: Cue, ph: Phase, p: Pose): Pose {
  const { w, s } = ph;
  const odd = c.combo % 2 === 1 ? -1 : 1;
  const leg = (side: 1 | -1, v: number) => (side === 1 ? (p.fl = v) : (p.fr = v));
  const winding = ph.stage === 'wind' ? 1 : 0;
  switch (c.move) {
    case 'claw':
      // a raised paw, then a raking swipe across the body
      leg(odd === 1 ? 1 : -1, -1.5 * w + 0.7 * s);
      p.rz = 0.16 * odd * w - 0.1 * odd * s;
      p.ry = -0.5 * odd * s + 0.14 * odd * w;
      p.z = -0.1 * w + 0.32 * s;
      p.hx = 0.12 * s;
      break;
    case 'rake': {
      // both forepaws scratching in quick alternation
      const flick = Math.sin(ph.k * TAU * 1.5);
      p.fl = -0.9 * w + 0.9 * s * flick;
      p.fr = -0.9 * w - 0.9 * s * flick;
      p.z = -0.06 * w + 0.28 * s;
      p.ry = 0.2 * odd * s;
      p.hx = 0.1 * s;
      break;
    }
    case 'bite':
      // jaws wide, then a snap with a twist of the head
      p.hx = -0.35 * w + 0.7 * s;
      p.hy = 0.3 * odd * w - 0.3 * odd * s;
      p.z = -0.12 * w + 0.45 * s;
      p.rx = -0.12 * w + 0.1 * s;
      p.fl = p.fr = -0.2 * w;
      break;
    case 'lunge':
      // crouch low, then spring jaws-first across the gap
      p.y = -0.24 * w + 0.14 * s;
      p.rx = -0.36 * w + 0.46 * s;
      p.z = -0.3 * w + 0.95 * s;
      p.hx = -0.2 * w + 0.7 * s;
      p.bl = p.br = 0.7 * w + 0.8 * s;
      p.fl = p.fr = 0.2 * w - 1.0 * s;
      p.tail = 0.5 * w;
      break;
    case 'jab':
      // a short, fast thrust: sting, stab or peck
      p.z = -0.22 * w + 0.62 * s;
      p.hx = -0.3 * w + 0.5 * s;
      p.rx = -0.1 * w + 0.08 * s;
      p.hy = 0.2 * odd * s;
      p.tail = -0.6 * w;
      break;
    case 'sweep':
      // wind the tail back, then spin the whole body round
      p.tail = -1.1 * w + 0.9 * s;
      p.ry = ph.stage === 'strike' ? TAU * 0.9 * ph.k * odd : -0.5 * odd * w;
      p.y = -0.05 * w;
      p.z = -0.08 * w + 0.3 * s;
      break;
    case 'rend':
      // both forelimbs up, then tearing down
      p.rx = -0.35 * w + 0.22 * s;
      p.y = 0.1 * w - 0.12 * s;
      p.fl = p.fr = -1.35 * w + 1.05 * s;
      p.hx = -0.25 * w + 0.5 * s;
      p.z = -0.1 * w + 0.32 * s;
      break;
    case 'slam':
      // rear up on the hind legs and crash both paws down
      p.rx = -0.62 * w + 0.38 * s;
      p.y = 0.14 * w - 0.1 * s;
      p.z = -0.12 * w + 0.5 * s;
      p.fl = p.fr = -1.75 * w + 0.85 * s;
      p.hx = -0.3 * w + 0.35 * s;
      p.sc = 1 + 0.06 * w;
      break;
    case 'ram':
      // head down, scraping the ground, then a charge
      p.hx = 0.7 * w - 0.95 * s;
      p.rx = 0.22 * w - 0.12 * s;
      p.y = -0.16 * w;
      p.fl = p.fr = -0.8 * Math.abs(Math.sin(ph.k * 18)) * winding;
      p.z = -0.2 * w + 1.15 * s;
      p.bl = p.br = 0.5 * s;
      break;
    case 'toss':
      // head dipped low, then a heave upward that flings the target
      p.hx = 0.6 * w - 1.0 * s;
      p.rx = 0.12 * w - 0.3 * s;
      p.y = -0.1 * w + 0.12 * s;
      p.fl = p.fr = 0.4 * w - 1.1 * s;
      p.z = -0.12 * w + 0.4 * s;
      break;
  }
  return p;
}

function skillPose(c: Cue, ph: Phase, p: Pose): Pose {
  const { w, s } = ph;
  const id = c.skill;
  switch (c.fx) {
    case 'dash':
      // crouch and coil, then stretch out into the leap
      p.y = -0.26 * w + 0.12 * s;
      p.rx = -0.32 * w + 0.28 * s;
      p.z = -0.25 * w + 0.7 * s;
      p.bl = p.br = 0.85 * w + 0.9 * s;
      p.fl = p.fr = 0.2 * w - 1.2 * s;
      p.hx = 0.15 * w + 0.3 * s;
      p.tail = 0.5 * w - 0.3 * s;
      break;
    case 'aoe':
      if (id === 'howl' || id === 'alpha_howl') {
        // head thrown back at the sky
        p.hx = -0.95 * w + 0.1 * s;
        p.rx = -0.3 * w;
        p.fl = p.fr = 0.2 * w;
      } else if (id === 'roar') {
        // rear up and bellow, shaking
        p.rx = -0.75 * w + 0.35 * s;
        p.hx = -0.55 * w + 0.5 * s;
        p.fl = p.fr = -1.3 * w + 0.6 * s;
        p.rz = Math.sin(ph.k * 36) * 0.05 * (ph.stage === 'wind' ? 1 : 0);
        p.sc = 1 + 0.1 * w;
      } else if (id === 'tail_whip') {
        p.tail = -1.0 * w + 0.9 * s;
        p.ry = ph.stage === 'strike' ? TAU * ph.k : -0.5 * w;
        p.y = -0.05 * w;
      } else if (id === 'earthshaker') {
        // up high and slammed down
        p.rx = -0.7 * w + 0.45 * s;
        p.y = 0.26 * w - 0.14 * s;
        p.fl = p.fr = -1.6 * w + 0.9 * s;
        p.z = 0.35 * s;
      } else {
        p.rx = -0.4 * w + 0.25 * s;
        p.sc = 1 + 0.14 * w - 0.06 * s;
        p.rz = Math.sin(ph.k * 30) * 0.06 * (ph.stage === 'wind' ? 1 : 0);
        p.hx = -0.3 * w + 0.3 * s;
      }
      break;
    case 'proj':
      // lean back, then a flick of the head and body
      p.rx = -0.25 * w + 0.2 * s;
      p.hx = -0.5 * w + 0.7 * s;
      p.z = -0.2 * w + 0.28 * s;
      p.tail = -0.4 * w;
      break;
    case 'grab':
      p.rx = -0.3 * w + 0.35 * s;
      p.fl = p.fr = -0.9 * w + 0.5 * s;
      p.z = -0.15 * w + 0.6 * s;
      p.hx = -0.2 * w + 0.4 * s;
      break;
    case 'cone':
    default: {
      const style = STYLE[c.animal] ?? 'bite';
      const heavy = c.heavy || style === 'snap';
      // a skill swing is a bigger version of the animal's own heavy attack
      const cue: Cue = { ...c, kind: 'swing', combo: 2, heavy: true };
      void heavy;
      const base = poseFor({ ...cue, start: c.start }, c.start + (ph.stage === 'wind' ? ph.k * cue.wind : ph.stage === 'strike' ? cue.wind + ph.k * cue.strike : cue.wind + cue.strike + ph.k * cue.rec));
      return base ?? p;
    }
  }
  return p;
}

/** The ground marking that shows where a move is about to land. */
export interface Telegraph {
  shape: 'arc' | 'circle' | 'line';
  r: number; // radius or length
  arc: number; // degrees, for arcs
  width: number; // for lines
}

export function telegraphFor(skillId: string): Telegraph | null {
  const fx = SKILL_BY_ID.get(skillId)?.fx;
  if (!fx) return null;
  switch (fx.k) {
    case 'cone':
      return { shape: 'arc', r: fx.range, arc: fx.arc, width: 0 };
    case 'aoe':
      return fx.dmg > 0 ? { shape: 'circle', r: fx.r, arc: 360, width: 0 } : null;
    case 'dash':
      return fx.dmg > 0 ? { shape: 'line', r: fx.dist, arc: 0, width: 1.6 } : null;
    case 'proj':
      return { shape: 'line', r: fx.range, arc: 0, width: 0.7 };
    case 'grab':
      return { shape: 'arc', r: fx.range, arc: 120, width: 0 };
  }
  return null;
}
