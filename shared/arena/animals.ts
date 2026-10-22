// Animals, stats and skills (data only). "A skill exists because the animal does it in nature."
// All numbers are first-pass values to tune in playtests (see the design doc).

export type SizeClass = 'small' | 'medium' | 'large';
export const STAT_KEYS = ['hp', 'atk', 'spd', 'sta', 'sen'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;
export const STAT_NAMES: Record<StatKey, string> = { hp: 'Health', atk: 'Attack', spd: 'Speed', sta: 'Stamina', sen: 'Senses' };

export const MAX_LEVEL = 20;
export const UNLOCK_LEVELS = [3, 7, 12, 18] as const;

/** XP needed to go from level L to L+1. */
export const xpNeed = (L: number) => Math.round(60 * Math.pow(L, 1.35));

/** XP a horde creature of a tier pays a player of level L. */
export const HORDE_XP = [0, 30, 85, 320, 2000];
export const HORDE_REF_LEVEL = [0, 1, 4, 8, 14];
export const hordeXp = (tier: number, L: number) => HORDE_XP[tier] * Math.max(0.2, 1 - 0.06 * (L - HORDE_REF_LEVEL[tier]));
/** XP for killing a player, with a catch-up bonus when the victim out-levels you. */
export const killXp = (victimTotalXp: number, victimLevel: number, myLevel: number) =>
  (150 + 0.5 * victimTotalXp) * Math.min(2, 1 + 0.1 * (victimLevel - myLevel));

export const SIZE = {
  small: { hp: 0.7, dmg: 0.9, speed: 1.06, radius: 0.4, reach: 1.5, noise: 0.6 },
  medium: { hp: 1, dmg: 1, speed: 1, radius: 0.55, reach: 2.0, noise: 1 },
  large: { hp: 1.55, dmg: 1.25, speed: 0.9, radius: 0.95, reach: 2.8, noise: 1.6 },
} as const;

// --- statuses and effects ------------------------------------------------------------------

export type Status =
  | { s: 'bleed'; dur: number; dps: number } // dps = fraction of the attacker's hit
  | { s: 'slow'; dur: number; f: number }
  | { s: 'mark'; dur: number }
  | { s: 'stun'; dur: number }
  | { s: 'scare'; dur: number };

export type Effect =
  | { k: 'cone'; range: number; arc: number; dmg: number; st?: Status[] }
  | { k: 'dash'; dist: number; dmg: number; st?: Status[]; knock?: number; aoe?: number; iframes?: number }
  | { k: 'aoe'; r: number; dmg: number; st?: Status[]; scare?: number }
  | { k: 'proj'; dmg: number; range: number; st?: Status[] }
  | { k: 'buff'; dur: number; speed?: number; dmg?: number; dr?: number; reflect?: number; free?: boolean; rof?: number }
  | { k: 'heal'; pct: number; sta?: boolean }
  | { k: 'grab'; dur: number; dps: number; range: number }
  | { k: 'submerge'; dur: number };

export interface Mods {
  hp?: number; // +fraction of max health
  dmg?: number;
  speed?: number;
  dr?: number; // damage reduction
  reflect?: number;
  lifesteal?: number;
  waterSpeed?: number;
  stamRegen?: number;
  senses?: number;
  markDmg?: number; // extra damage against marked targets
  lowHpDmg?: number; // extra damage while under 40% health
  executeDmg?: number; // extra damage against targets under 40% health
  eatBoost?: number;
  bleedOnHit?: number; // seconds of bleed on basic hits
  cheatDeath?: number; // survive a killing blow once, at this fraction of health
  regenOOC?: number; // fraction of max health per second after 6 s out of combat
  bleedImmune?: number;
  ambush?: number; // extra damage from a bush or from underwater
  attackerBleed?: number;
  // class numbers
  preyXp?: number; // extra XP from hunting wild animals
  dashCd?: number; // +slower / -faster dash recharge (fraction)
  parryWin?: number; // extra seconds in the parry window
  guardCost?: number; // +more / -less stamina spent guarding (fraction)
  reach?: number; // fraction of attack reach
  noise?: number; // extra noise (fraction)
  stealth?: number; // wild animals notice you this much less
}

export interface Skill {
  id: string;
  name: string;
  desc: string;
  cd?: number;
  cost?: number; // stamina
  fx?: Effect;
  mods?: Mods;
}

const act = (id: string, name: string, desc: string, cd: number, fx: Effect, cost = 0): Skill => ({ id, name, desc, cd, fx, cost });
const pas = (id: string, name: string, desc: string, mods: Mods): Skill => ({ id, name, desc, mods });

export interface AnimalDef {
  id: string;
  name: string;
  size: SizeClass;
  role: string;
  stats: Stats; // 100 base points
  swim: 'land' | 'water'; // water animals gain speed and stealth in deep water
  weakness: string;
  blurb: string;
  innate: Skill;
  sig: [Skill, Skill]; // bound to Q and E from level 1
  unlock: [[Skill, Skill], [Skill, Skill], [Skill, Skill], [Skill, Skill]]; // levels 3, 7, 12, 18
  cls: ClassId;
}

const st = (hp: number, atk: number, spd: number, sta: number, sen: number): Stats => ({ hp, atk, spd, sta, sen });

const BASE: Omit<AnimalDef, 'cls'>[] = [
  {
    id: 'wolf', name: 'Wolf', size: 'medium', role: 'Tracker', stats: st(18, 20, 24, 18, 20), swim: 'land',
    weakness: 'Weak defense when alone', blurb: 'Marks prey with a howl and runs it down.',
    innate: pas('pack_hunter', 'Pack Hunter', '+15% damage against marked targets.', { markDmg: 0.15 }),
    sig: [
      act('howl', 'Howl', 'Marks enemies within 40 m for 5 s: they glow for everyone and take extra damage.', 18, { k: 'aoe', r: 40, dmg: 0, st: [{ s: 'mark', dur: 5 }] }),
      act('lunge', 'Lunge', 'Spring up to 7 m at your prey and bite.', 7, { k: 'dash', dist: 7, dmg: 1.4 }, 12),
    ],
    unlock: [
      [
        act('pack_call', 'Pack Call', 'Rally yourself: +15% speed and damage for 6 s.', 25, { k: 'buff', dur: 6, speed: 0.15, dmg: 0.15 }),
        act('hamstring', 'Hamstring', 'A low bite that slows the target for 3 s.', 9, { k: 'cone', range: 2.4, arc: 70, dmg: 0.8, st: [{ s: 'slow', dur: 3, f: 0.5 }] }),
      ],
      [pas('keen_nose', 'Keen Nose', '+25% senses range.', { senses: 0.25 }), pas('thick_fur', 'Thick Fur', '10% damage reduction.', { dr: 0.1 })],
      [
        act('alpha_howl', 'Alpha Howl', 'A terrifying howl: hordes within 30 m flee and enemies are marked.', 30, { k: 'aoe', r: 30, dmg: 0, scare: 6, st: [{ s: 'mark', dur: 4 }] }),
        act('rend', 'Rend', 'A savage bite that bleeds for 5 s.', 12, { k: 'cone', range: 2.4, arc: 70, dmg: 1.6, st: [{ s: 'bleed', dur: 5, dps: 0.3 }] }),
      ],
      [pas('apex', 'Apex Predator', '+20% damage and 10% lifesteal.', { dmg: 0.2, lifesteal: 0.1 }), pas('endless_chase', 'Endless Chase', '+12% speed and faster stamina recovery.', { speed: 0.12, stamRegen: 0.4 })],
    ],
  },
  {
    id: 'bear', name: 'Bear', size: 'large', role: 'Bruiser', stats: st(28, 26, 10, 16, 20), swim: 'land',
    weakness: 'Slow, loud and a big target', blurb: 'Mauls everything in reach and scares off the small fry.',
    innate: pas('fat_reserves', 'Fat Reserves', 'Heals 1.5% health per second after 6 s without fighting.', { regenOOC: 0.015 }),
    sig: [
      act('maul', 'Maul', 'A huge swipe in front of you.', 5, { k: 'cone', range: 3.0, arc: 100, dmg: 1.8 }),
      act('roar', 'Roar', 'Small hordes within 16 m flee; enemies are slowed for 3 s.', 20, { k: 'aoe', r: 16, dmg: 0, scare: 6, st: [{ s: 'slow', dur: 3, f: 0.75 }] }),
    ],
    unlock: [
      [
        act('swipe_combo', 'Swipe Combo', 'A wide double swipe.', 6, { k: 'cone', range: 3.2, arc: 160, dmg: 1.3 }),
        act('bear_hug', 'Bear Hug', 'Grab a target for 2 s, crushing them.', 14, { k: 'grab', dur: 2, dps: 0.9, range: 2.6 }),
      ],
      [pas('iron_hide', 'Iron Hide', '12% damage reduction.', { dr: 0.12 }), pas('forager', 'Forager', 'Food heals 50% more.', { eatBoost: 0.5 })],
      [
        act('earthshaker', 'Earthshaker', 'Slam the ground: damage and a stun in 7 m.', 18, { k: 'aoe', r: 7, dmg: 1.2, st: [{ s: 'stun', dur: 1.2 }] }),
        act('salmon_feast', 'Salmon Feast', 'Heal 20% of your health.', 40, { k: 'heal', pct: 0.2 }),
      ],
      [pas('rage', 'Rage', '+25% damage while under 40% health.', { lowHpDmg: 0.25 }), pas('colossus', 'Colossus', '+20% health.', { hp: 0.2 })],
    ],
  },
  {
    id: 'cheetah', name: 'Cheetah', size: 'medium', role: 'Assassin', stats: st(12, 22, 36, 12, 18), swim: 'land',
    weakness: 'Tires fast, low health', blurb: 'Nothing is faster for three glorious seconds.',
    innate: pas('sprinter', 'Sprinter', '+8% speed.', { speed: 0.08 }),
    sig: [
      act('burst', 'Burst Sprint', '3 s of +55% speed that costs no stamina.', 14, { k: 'buff', dur: 3, speed: 0.55, free: true }),
      act('pounce', 'Pounce', 'Leap 9 m onto your prey.', 8, { k: 'dash', dist: 9, dmg: 1.5 }, 14),
    ],
    unlock: [
      [
        act('claw_rake', 'Claw Rake', 'A quick rake that bleeds for 4 s.', 6, { k: 'cone', range: 2.2, arc: 80, dmg: 1.0, st: [{ s: 'bleed', dur: 4, dps: 0.25 }] }),
        act('swerve', 'Swerve', 'Dodge: take 60% less damage for 0.8 s.', 10, { k: 'buff', dur: 0.8, dr: 0.6, speed: 0.2 }),
      ],
      [pas('lean', 'Lean Muscle', '+30% stamina recovery.', { stamRegen: 0.3 }), pas('hunters_eye', "Hunter's Eye", '+15% damage against targets under 40% health.', { executeDmg: 0.15 })],
      [
        act('second_wind', 'Second Wind', 'Refill stamina and heal 10%.', 35, { k: 'heal', pct: 0.1, sta: true }),
        act('throat_bite', 'Throat Bite', 'A single devastating bite.', 14, { k: 'cone', range: 2.0, arc: 50, dmg: 2.6 }),
      ],
      [pas('lightning', 'Lightning', '+10% speed.', { speed: 0.1 }), pas('ambush_cat', 'Ambush', '+35% damage from a bush.', { ambush: 0.35 })],
    ],
  },
  {
    id: 'badger', name: 'Honey Badger', size: 'small', role: 'Brawler', stats: st(22, 26, 18, 16, 18), swim: 'land',
    weakness: 'Short reach', blurb: 'Too angry to die.',
    innate: pas('loose_skin', 'Loose Skin', '10% damage reduction.', { dr: 0.1 }),
    sig: [
      act('thick_hide', 'Thick Hide', 'Take 50% less damage for 3 s.', 14, { k: 'buff', dur: 3, dr: 0.5 }),
      act('frenzy', 'Frenzy', '+35% damage and +20% speed for 5 s.', 20, { k: 'buff', dur: 5, dmg: 0.35, speed: 0.2 }),
    ],
    unlock: [
      [
        act('latch', 'Latch On', 'Clamp on to a target for 1.5 s.', 12, { k: 'grab', dur: 1.5, dps: 1.0, range: 1.8 }),
        act('musk_spray', 'Musk Spray', 'A stench cloud that slows and scares nearby animals.', 14, { k: 'aoe', r: 5, dmg: 0, scare: 4, st: [{ s: 'slow', dur: 3, f: 0.6 }] }),
      ],
      [pas('tough_skin', 'Tough Skin', '+8% damage reduction.', { dr: 0.08 }), pas('fearless', 'Fearless', '+10% damage.', { dmg: 0.1 })],
      [
        act('rampage', 'Rampage', '+50% damage for 6 s.', 30, { k: 'buff', dur: 6, dmg: 0.5 }),
        act('dig_in', 'Dig In', 'Heal 15% and take 30% less damage for 3 s.', 30, { k: 'heal', pct: 0.15 }),
      ],
      [pas('unkillable', 'Unkillable', 'Survive a killing blow once at 20% health.', { cheatDeath: 0.2 }), pas('venom_proof', 'Venom Proof', 'Immune to bleed and +10% health.', { bleedImmune: 1, hp: 0.1 })],
    ],
  },
  {
    id: 'croc', name: 'Crocodile', size: 'large', role: 'Ambusher', stats: st(26, 28, 12, 14, 20), swim: 'water',
    weakness: 'Slow on land', blurb: 'Waits under the surface, then does not let go.',
    innate: pas('cold_blooded', 'Cold Blooded', '+30% speed in water.', { waterSpeed: 0.3 }),
    sig: [
      act('submerge', 'Submerge', 'Vanish underwater for 6 s. Your next bite hits 50% harder.', 6, { k: 'submerge', dur: 6 }),
      act('death_roll', 'Death Roll', 'Grab and roll: 2.5 s of crushing damage (weaker on land).', 16, { k: 'grab', dur: 2.5, dps: 1.4, range: 3.0 }),
    ],
    unlock: [
      [
        act('tail_whip', 'Tail Whip', 'Sweep everything around you aside.', 8, { k: 'aoe', r: 4.5, dmg: 1.0, st: [{ s: 'slow', dur: 1.5, f: 0.6 }] }),
        act('croc_lunge', 'Lunge', 'Burst forward 6 m with open jaws.', 9, { k: 'dash', dist: 6, dmg: 1.5 }, 12),
      ],
      [pas('scutes', 'Armoured Scutes', '12% damage reduction.', { dr: 0.12 }), pas('lungs', 'Big Lungs', '+30% stamina recovery.', { stamRegen: 0.3 })],
      [
        act('bone_crusher', 'Bone Crusher', 'A bite that breaks bones.', 14, { k: 'cone', range: 3.0, arc: 60, dmg: 2.5, st: [{ s: 'bleed', dur: 4, dps: 0.3 }] }),
        act('basking', 'Basking', 'Heal 18% of your health.', 40, { k: 'heal', pct: 0.18 }),
      ],
      [pas('apex_ambush', 'Apex Ambusher', '+100% damage from underwater.', { ambush: 1.0 }), pas('primeval', 'Primeval', '+20% health, +10% damage.', { hp: 0.2, dmg: 0.1 })],
    ],
  },
  {
    id: 'boar', name: 'Wild Boar', size: 'medium', role: 'Charger', stats: st(24, 24, 18, 16, 18), swim: 'land',
    weakness: 'Turns poorly', blurb: 'Lowers its head and goes through whatever is there.',
    innate: pas('hard_skull', 'Hard Skull', '8% damage reduction.', { dr: 0.08 }),
    sig: [
      act('charge', 'Charge', 'Rush 10 m, knocking back whatever you hit.', 10, { k: 'dash', dist: 10, dmg: 1.4, knock: 5 }, 16),
      act('gore', 'Gore', 'Tusk strike that makes the target bleed for 5 s.', 6, { k: 'cone', range: 2.3, arc: 70, dmg: 1.2, st: [{ s: 'bleed', dur: 5, dps: 0.3 }] }),
    ],
    unlock: [
      [
        act('wallow', 'Mud Wallow', 'Plaster yourself in mud: 25% damage reduction for 4 s.', 18, { k: 'buff', dur: 4, dr: 0.25 }),
        act('trample', 'Trample', 'Charge through a crowd, hitting everyone around.', 12, { k: 'dash', dist: 6, dmg: 0.9, aoe: 3 }, 12),
      ],
      [pas('bristles', 'Thick Bristles', '10% damage reduction.', { dr: 0.1 }), pas('boar_stam', 'Tireless', '+30% stamina recovery.', { stamRegen: 0.3 })],
      [
        act('stampede', 'Stampede', '+30% speed and +20% damage for 6 s.', 30, { k: 'buff', dur: 6, speed: 0.3, dmg: 0.2 }),
        act('rooting', 'Rooting', 'Dig up roots and heal 15%.', 30, { k: 'heal', pct: 0.15 }),
      ],
      [pas('berserker', 'Berserker', '+20% damage.', { dmg: 0.2 }), pas('hardhead', 'Hardhead', '+15% health and 8% damage reduction.', { hp: 0.15, dr: 0.08 })],
    ],
  },
  {
    id: 'otter', name: 'Otter', size: 'small', role: 'Skirmisher', stats: st(14, 16, 28, 24, 18), swim: 'water',
    weakness: 'Fragile', blurb: 'Fast in the water, annoying everywhere else.',
    innate: pas('water_born', 'Water Born', '+40% speed in water.', { waterSpeed: 0.4 }),
    sig: [
      act('rock_throw', 'Rock Throw', 'Hurl a rock up to 22 m.', 4, { k: 'proj', dmg: 1.0, range: 22 }),
      act('slip', 'Slippery Dodge', 'Slide 5 m away, untouchable for 0.4 s.', 7, { k: 'dash', dist: 5, dmg: 0, iframes: 0.4 }, 10),
    ],
    unlock: [
      [
        act('skip_stone', 'Skipping Stone', 'A long throw that slows for 2 s.', 8, { k: 'proj', dmg: 0.7, range: 30, st: [{ s: 'slow', dur: 2, f: 0.6 }] }),
        act('splash', 'Splash', 'Kick up water: nearby animals are slowed and scared.', 14, { k: 'aoe', r: 5, dmg: 0, scare: 3, st: [{ s: 'slow', dur: 2, f: 0.6 }] }),
      ],
      [pas('sleek', 'Sleek Fur', '+6% speed.', { speed: 0.06 }), pas('playful', 'Playful', '+30% stamina recovery.', { stamRegen: 0.3 })],
      [
        act('rapid', 'Rapid Throws', 'Attack twice as fast for 6 s.', 25, { k: 'buff', dur: 6, rof: 2 }),
        act('shell_smash', 'Shell Smash', 'Smash a clam on a target: heavy damage.', 12, { k: 'proj', dmg: 2.0, range: 16 }),
      ],
      [pas('thick_otter', 'Dense Fur', '+15% health.', { hp: 0.15 }), pas('fish_hunter', 'Fish Hunter', '12% lifesteal.', { lifesteal: 0.12 })],
    ],
  },
  {
    id: 'porcupine', name: 'Porcupine', size: 'small', role: 'Counter-fighter', stats: st(30, 14, 12, 22, 22), swim: 'land',
    weakness: 'Low mobility and damage', blurb: 'Hurting it hurts you more.',
    innate: pas('quills', 'Quills', 'Reflects 10% of damage taken.', { reflect: 0.1 }),
    sig: [
      act('quill_coat', 'Quill Coat', 'Reflect 60% of damage and take 20% less for 4 s.', 16, { k: 'buff', dur: 4, reflect: 0.6, dr: 0.2 }),
      act('quill_shot', 'Quill Shot', 'Fire a quill up to 18 m; it bleeds.', 6, { k: 'proj', dmg: 1.1, range: 18, st: [{ s: 'bleed', dur: 3, dps: 0.25 }] }),
    ],
    unlock: [
      [
        act('quill_burst', 'Quill Burst', 'Shake out quills in all directions.', 14, { k: 'aoe', r: 5, dmg: 1.0 }),
        act('roll_up', 'Roll Up', 'Curl into a ball: take 60% less damage for 3 s.', 18, { k: 'buff', dur: 3, dr: 0.6, speed: -0.5 }),
      ],
      [pas('sharp', 'Sharp Quills', '+15% reflected damage.', { reflect: 0.15 }), pas('spines', 'Tough Spines', '8% damage reduction.', { dr: 0.08 })],
      [
        act('quill_storm', 'Quill Storm', 'A burst of quills within 10 m that bleed.', 25, { k: 'aoe', r: 10, dmg: 1.2, st: [{ s: 'bleed', dur: 4, dps: 0.25 }] }),
        act('prickly_pear', 'Prickly Pear', 'Eat a pear and heal 20%.', 35, { k: 'heal', pct: 0.2 }),
      ],
      [pas('pincushion', 'Pincushion', '+25% reflected damage.', { reflect: 0.25 }), pas('barbed', 'Barbed', 'Attackers bleed for 3 s.', { attackerBleed: 3 })],
    ],
  },
];


// --- more animals --------------------------------------------------------------------------------

const MORE: Omit<AnimalDef, 'cls'>[] = [
  {
    id: 'lion', name: 'Lion', size: 'medium', role: 'Pack leader', stats: st(22, 26, 20, 14, 18), swim: 'land',
    weakness: 'Tires in long chases', blurb: 'Rules with a pounce and a roar that rallies the hunt.',
    innate: pas('pride', 'Pride Instinct', '+8% damage, +10% more against marked prey.', { dmg: 0.08, markDmg: 0.1 }),
    sig: [
      act('pounce_strike', 'Pounce Strike', 'Leap 8 m onto prey and knock it back.', 8, { k: 'dash', dist: 8, dmg: 1.7, knock: 3 }, 14),
      act('kings_roar', "King's Roar", 'A mighty roar: hordes flee and enemies within 18 m are marked.', 22, { k: 'aoe', r: 18, dmg: 0, scare: 5, st: [{ s: 'mark', dur: 4 }] }),
    ],
    unlock: [
      [
        act('claw_flurry', 'Claw Flurry', 'A wide flurry of claws that bleeds.', 7, { k: 'cone', range: 2.6, arc: 120, dmg: 1.3, st: [{ s: 'bleed', dur: 3, dps: 0.25 }] }),
        act('hunt_rush', 'Hunt Rush', '+30% speed and +10% damage for 4 s.', 20, { k: 'buff', dur: 4, speed: 0.3, dmg: 0.1 }),
      ],
      [pas('muscle_memory', 'Muscle Memory', '+10% damage.', { dmg: 0.1 }), pas('mane', 'Thick Mane', '10% damage reduction.', { dr: 0.1 })],
      [
        act('tackle', 'Tackle', 'Bring prey down and hold it for 2 s.', 15, { k: 'grab', dur: 2, dps: 0.9, range: 2.6 }),
        act('rallying_roar', 'Rallying Roar', '+25% damage and +15% speed for 7 s.', 30, { k: 'buff', dur: 7, dmg: 0.25, speed: 0.15 }),
      ],
      [pas('apex_king', 'Apex King', '+18% damage and 8% lifesteal.', { dmg: 0.18, lifesteal: 0.08 }), pas('sunbaked', 'Sun-baked Hide', '+18% health, 6% damage reduction.', { hp: 0.18, dr: 0.06 })],
    ],
  },
  {
    id: 'hippo', name: 'Hippo', size: 'large', role: 'River titan', stats: st(34, 26, 8, 14, 18), swim: 'water',
    weakness: 'Very slow on land', blurb: 'The most dangerous animal in the river, and nearly as bad on shore.',
    innate: pas('river_titan', 'River Titan', '+30% speed in water, 8% damage reduction.', { waterSpeed: 0.3, dr: 0.08 }),
    sig: [
      act('jaw_crush', 'Jaw Crush', 'Open wide and crush: huge damage in a narrow cone.', 9, { k: 'cone', range: 3.0, arc: 90, dmg: 2.2 }),
      act('mud_bath', 'Mud Bath', 'Plaster yourself with mud: 40% damage reduction for 4 s.', 22, { k: 'buff', dur: 4, dr: 0.4 }),
    ],
    unlock: [
      [
        act('tusk_swipe', 'Tusk Swipe', 'A very wide sweep of the tusks.', 6, { k: 'cone', range: 3.2, arc: 150, dmg: 1.2 }),
        act('water_spout', 'Water Spout', 'Spit a jet of water that slows.', 8, { k: 'proj', dmg: 0.8, range: 20, st: [{ s: 'slow', dur: 2, f: 0.55 }] }),
      ],
      [pas('blubber', 'Thick Blubber', '12% damage reduction.', { dr: 0.12 }), pas('big_lungs', 'Big Lungs', '+40% stamina recovery.', { stamRegen: 0.4 })],
      [
        act('yawn', 'Yawn of Doom', 'A terrifying gape: damage and a stun in 6 m.', 20, { k: 'aoe', r: 6, dmg: 1.0, st: [{ s: 'stun', dur: 1.0 }] }),
        act('hippo_charge', 'River Charge', 'Rush 9 m, bowling over everything.', 14, { k: 'dash', dist: 9, dmg: 1.5, knock: 5, aoe: 3 }, 16),
      ],
      [pas('colossus_h', 'Colossus', '+22% health.', { hp: 0.22 }), pas('crusher', 'Bone Crusher', '+20% damage, +10% against wounded targets.', { dmg: 0.2, executeDmg: 0.1 })],
    ],
  },
  {
    id: 'redfox', name: 'Red Fox', size: 'small', role: 'Trickster', stats: st(12, 18, 30, 18, 22), swim: 'land',
    weakness: 'Fragile', blurb: 'Quick, clever and never where you swung.',
    innate: pas('keen_ears', 'Keen Ears', '+25% senses range.', { senses: 0.25 }),
    sig: [
      act('mouse_pounce', 'Mouse Pounce', 'A high pounce 6 m onto your target.', 6, { k: 'dash', dist: 6, dmg: 1.2 }, 10),
      act('fox_trot', 'Fox Trot', '+40% speed for 3 s that costs no stamina.', 12, { k: 'buff', dur: 3, speed: 0.4, free: true }),
    ],
    unlock: [
      [
        act('decoy_tail', 'Decoy Tail', 'Flash your tail: nearby animals are scared and slowed.', 14, { k: 'aoe', r: 4.5, dmg: 0, scare: 3, st: [{ s: 'slow', dur: 2, f: 0.5 }] }),
        act('nip', 'Nip', 'A quick bite that bleeds.', 4, { k: 'cone', range: 1.9, arc: 70, dmg: 1.0, st: [{ s: 'bleed', dur: 3, dps: 0.25 }] }),
      ],
      [pas('light_paws', 'Light Paws', '+8% speed.', { speed: 0.08 }), pas('sharp_senses', 'Sharp Senses', '+25% senses range.', { senses: 0.25 })],
      [
        act('trickster_dash', 'Trickster Dash', 'Slide 7 m, untouchable for 0.5 s.', 8, { k: 'dash', dist: 7, dmg: 0, iframes: 0.5 }, 10),
        act('snap', 'Snap', 'A single sharp bite.', 10, { k: 'cone', range: 2.0, arc: 50, dmg: 1.8 }),
      ],
      [pas('cunning', 'Cunning', '+15% damage, 6% lifesteal.', { dmg: 0.15, lifesteal: 0.06 }), pas('nimble', 'Nimble', '+10% speed, faster stamina recovery.', { speed: 0.1, stamRegen: 0.3 })],
    ],
  },
  {
    id: 'leopard', name: 'Leopard', size: 'medium', role: 'Lone stalker', stats: st(16, 28, 24, 12, 20), swim: 'land',
    weakness: 'Weak in open ground', blurb: 'Waits in the leaves, then ends the fight in one leap.',
    innate: pas('spotted_cloak', 'Spotted Cloak', '+40% damage from a bush.', { ambush: 0.4 }),
    sig: [
      act('ambush_leap', 'Ambush Leap', 'Spring 8 m out of cover.', 8, { k: 'dash', dist: 8, dmg: 1.6 }, 14),
      act('stalk', 'Stalk', '+20% speed and +30% damage for 5 s.', 18, { k: 'buff', dur: 5, speed: 0.2, dmg: 0.3 }),
    ],
    unlock: [
      [
        act('throat_rake', 'Throat Rake', 'A deep rake that bleeds for 4 s.', 7, { k: 'cone', range: 2.0, arc: 60, dmg: 1.6, st: [{ s: 'bleed', dur: 4, dps: 0.3 }] }),
        act('slip_away', 'Slip Away', 'Vanish 6 m, untouchable for 0.4 s.', 9, { k: 'dash', dist: 6, dmg: 0, iframes: 0.4 }, 10),
      ],
      [pas('padded_paws', 'Padded Paws', 'Hordes notice you 20% less.', { stealth: 0.2 }), pas('night_eyes', 'Night Eyes', '+25% senses range.', { senses: 0.25 })],
      [
        act('death_bite', 'Death Bite', 'The killing bite.', 14, { k: 'cone', range: 2.0, arc: 50, dmg: 2.8 }),
        act('drag_prey', 'Drag Prey', 'Seize prey and drag it down for 2 s.', 16, { k: 'grab', dur: 2, dps: 1.1, range: 2.2 }),
      ],
      [pas('perfect_ambush', 'Perfect Ambush', '+60% damage from a bush.', { ambush: 0.6 }), pas('nine_lives', 'Nine Lives', 'Survive a killing blow once at 20% health.', { cheatDeath: 0.2 })],
    ],
  },
  {
    id: 'gorilla', name: 'Gorilla', size: 'large', role: 'Silverback', stats: st(30, 30, 10, 14, 16), swim: 'land',
    weakness: 'Slow and noisy', blurb: 'Pounds its chest, then pounds you.',
    innate: pas('silverback', 'Silverback Strength', '+10% damage.', { dmg: 0.1 }),
    sig: [
      act('chest_pound', 'Chest Pound', 'A thunderous drumming: hordes flee and enemies slow.', 18, { k: 'aoe', r: 9, dmg: 0, scare: 5, st: [{ s: 'slow', dur: 2, f: 0.6 }] }),
      act('ground_smash', 'Ground Smash', 'Smash the ground: damage and a stun in 5 m.', 12, { k: 'aoe', r: 5, dmg: 1.5, st: [{ s: 'stun', dur: 1 }] }),
    ],
    unlock: [
      [
        act('haymaker', 'Haymaker', 'One enormous blow.', 9, { k: 'cone', range: 2.8, arc: 70, dmg: 2.2 }),
        act('vine_swing', 'Vine Swing', 'Swing 9 m away, untouchable for 0.3 s.', 10, { k: 'dash', dist: 9, dmg: 0, iframes: 0.3 }, 12),
      ],
      [pas('iron_fists', 'Iron Fists', '+12% damage.', { dmg: 0.12 }), pas('thick_hide_g', 'Tough Hide', '12% damage reduction.', { dr: 0.12 })],
      [
        act('berserk', 'Berserk', '+45% damage and +10% speed for 6 s.', 30, { k: 'buff', dur: 6, dmg: 0.45, speed: 0.1 }),
        act('banana_break', 'Banana Break', 'Heal 20% of your health.', 35, { k: 'heal', pct: 0.2 }),
      ],
      [pas('kong', 'Kong', '+20% health, +10% damage.', { hp: 0.2, dmg: 0.1 }), pas('rage_g', 'Rage', '+30% damage while under 40% health.', { lowHpDmg: 0.3 })],
    ],
  },
  {
    id: 'turtle', name: 'Snapping Turtle', size: 'medium', role: 'Armoured wall', stats: st(40, 10, 6, 24, 20), swim: 'water',
    weakness: 'Hits softly, moves slowly', blurb: 'You will not get through it. You will not get past it either.',
    innate: pas('shell', 'Shell', '15% damage reduction.', { dr: 0.15 }),
    sig: [
      act('shell_guard', 'Shell Guard', 'Withdraw into the shell: 70% less damage for 3 s, but you crawl.', 14, { k: 'buff', dur: 3, dr: 0.7, speed: -0.5 }),
      act('turtle_snap', 'Snap', 'A beak snap with real force.', 8, { k: 'cone', range: 2.2, arc: 60, dmg: 2.0 }),
    ],
    unlock: [
      [
        act('shell_spin', 'Shell Spin', 'Spin on the spot, shoving everything away.', 12, { k: 'aoe', r: 4.5, dmg: 1.1, st: [{ s: 'slow', dur: 2, f: 0.6 }] }),
        act('retreat', 'Retreat', 'Pull back and heal 18%.', 30, { k: 'heal', pct: 0.18 }),
      ],
      [pas('hard_shell', 'Hard Shell', '12% damage reduction.', { dr: 0.12 }), pas('slow_steady', 'Slow and Steady', '+50% stamina recovery.', { stamRegen: 0.5 })],
      [
        act('shell_bash', 'Shell Bash', 'Ram forward 5 m.', 12, { k: 'dash', dist: 5, dmg: 1.5, knock: 4 }, 12),
        act('wise_elder', 'Wise Elder', 'Heal 25% of your health.', 40, { k: 'heal', pct: 0.25 }),
      ],
      [pas('ancient', 'Ancient', '+25% health.', { hp: 0.25 }), pas('reflecting_shell', 'Reflecting Shell', 'Reflect 30% of damage taken.', { reflect: 0.3 })],
    ],
  },
  {
    id: 'kangaroo', name: 'Kangaroo', size: 'medium', role: 'Boxer', stats: st(20, 24, 26, 16, 14), swim: 'land',
    weakness: 'Poor senses', blurb: 'Hops in, kicks twice, hops out.',
    innate: pas('springy', 'Springy Legs', '+6% speed.', { speed: 0.06 }),
    sig: [
      act('roo_kick', 'Roo Kick', 'A flying kick with serious force.', 7, { k: 'cone', range: 2.4, arc: 60, dmg: 2.0 }),
      act('boxing', 'Boxing', 'Attack twice as fast for 5 s.', 20, { k: 'buff', dur: 5, rof: 2 }),
    ],
    unlock: [
      [
        act('hop_strike', 'Hop Strike', 'Bound 8 m and strike.', 7, { k: 'dash', dist: 8, dmg: 1.3 }, 12),
        act('tail_prop', 'Tail Prop', 'Lean on the tail: 35% less damage for 3 s.', 14, { k: 'buff', dur: 3, dr: 0.35 }),
      ],
      [pas('power_legs', 'Powerful Legs', '+10% damage.', { dmg: 0.1 }), pas('pouch', 'Pouch Snacks', 'Food heals 50% more.', { eatBoost: 0.5 })],
      [
        act('double_kick', 'Double Kick', 'Two kicks in one.', 12, { k: 'cone', range: 2.6, arc: 90, dmg: 2.4 }),
        act('outback_sprint', 'Outback Sprint', '+40% speed for 3 s, no stamina cost.', 20, { k: 'buff', dur: 3, speed: 0.4, free: true }),
      ],
      [pas('champion', 'Champion', '+20% damage, 6% lifesteal.', { dmg: 0.2, lifesteal: 0.06 }), pas('marathon', 'Marathon', '+10% health, much faster stamina recovery.', { hp: 0.1, stamRegen: 0.5 })],
    ],
  },
  {
    id: 'skunk', name: 'Skunk', size: 'small', role: 'Deterrent', stats: st(22, 14, 16, 20, 28), swim: 'land',
    weakness: 'Low damage', blurb: 'Everyone gives it room. That is the point.',
    innate: pas('foul', 'Foul Reputation', '5% damage reduction, +15% senses.', { dr: 0.05, senses: 0.15 }),
    sig: [
      act('stink_spray', 'Stink Spray', 'A nauseating cloud: nearby animals flee and slow.', 12, { k: 'aoe', r: 6, dmg: 0, scare: 5, st: [{ s: 'slow', dur: 3, f: 0.5 }] }),
      act('handstand', 'Handstand', 'The warning display: reflect 40% and take 25% less for 3 s.', 16, { k: 'buff', dur: 3, reflect: 0.4, dr: 0.25 }),
    ],
    unlock: [
      [
        act('tail_flick', 'Tail Flick', 'Flick a stinging spray 12 m.', 6, { k: 'proj', dmg: 0.8, range: 12, st: [{ s: 'slow', dur: 2, f: 0.6 }] }),
        act('noxious_cloud', 'Noxious Cloud', 'A wide cloud that hurts and slows.', 16, { k: 'aoe', r: 8, dmg: 0.4, st: [{ s: 'slow', dur: 2.5, f: 0.55 }] }),
      ],
      [pas('thick_fur_s', 'Thick Fur', '10% damage reduction.', { dr: 0.1 }), pas('strong_scent', 'Strong Scent', '+30% senses range.', { senses: 0.3 })],
      [
        act('gas_bomb', 'Gas Bomb', 'A choking blast: damage and a stun in 10 m.', 24, { k: 'aoe', r: 10, dmg: 1.2, st: [{ s: 'stun', dur: 0.8 }] }),
        act('burrow_rest', 'Burrow Rest', 'Heal 20% of your health.', 36, { k: 'heal', pct: 0.2 }),
      ],
      [pas('rank', 'Rank', 'Reflect 15% and attackers bleed for 4 s.', { reflect: 0.15, attackerBleed: 4 }), pas('skunked', 'Skunked', '+15% damage, +10% health.', { dmg: 0.15, hp: 0.1 })],
    ],
  },
];

export type ClassId = 'hunter' | 'titan' | 'ambusher' | 'brawler' | 'skirmisher' | 'guardian';

/** A class: a shared playstyle with real perks and real drawbacks, applied on top of each animal. */
export interface ClassDef {
  id: ClassId;
  name: string;
  icon: string;
  blurb: string;
  perks: string[];
  drawbacks: string[];
  mods: Mods;
}

export const CLASSES: ClassDef[] = [
  {
    id: 'hunter', name: 'Hunter', icon: '🏹', blurb: 'Runs prey down and finishes fights fast.',
    perks: ['+6% speed', '+25% XP from hunting prey', '+8% damage'], drawbacks: ['-12% health', 'Guarding costs 30% more stamina'],
    mods: { speed: 0.06, preyXp: 0.25, dmg: 0.08, hp: -0.12, guardCost: 0.3 },
  },
  {
    id: 'titan', name: 'Titan', icon: '🛡️', blurb: 'A wall of muscle that wins by outlasting.',
    perks: ['+18% health', '10% damage reduction'], drawbacks: ['-8% speed', 'Very loud: hordes hear you from 60% further', 'Dash recharges 25% slower'],
    mods: { hp: 0.18, dr: 0.1, speed: -0.08, noise: 0.6, dashCd: 0.25 },
  },
  {
    id: 'ambusher', name: 'Ambusher', icon: '🌿', blurb: 'Strikes from hiding, struggles in the open.',
    perks: ['+30% damage from a bush or underwater', 'Hordes notice you 30% less'], drawbacks: ['-10% health', '-4% speed', 'Dash recharges 20% slower'],
    mods: { ambush: 0.3, stealth: 0.3, hp: -0.1, speed: -0.04, dashCd: 0.2 },
  },
  {
    id: 'brawler', name: 'Brawler', icon: '🥊', blurb: 'Stays in your face and gets angrier when hurt.',
    perks: ['+12% damage under 40% health', '5% lifesteal'], drawbacks: ['-10% reach', '-10% senses range'],
    mods: { lowHpDmg: 0.12, lifesteal: 0.05, reach: -0.1, senses: -0.1 },
  },
  {
    id: 'skirmisher', name: 'Skirmisher', icon: '💨', blurb: 'Hits, dashes away and does it again.',
    perks: ['+10% speed', 'Dash recharges 30% faster', '+20% senses range'], drawbacks: ['-15% health', '-10% damage'],
    mods: { speed: 0.1, dashCd: -0.3, senses: 0.2, hp: -0.15, dmg: -0.1 },
  },
  {
    id: 'guardian', name: 'Guardian', icon: '⚔️', blurb: 'Master of the parry; a patient, punishing fighter.',
    perks: ['Parry window +0.09 s', 'Guarding costs 35% less stamina', '6% damage reduction'], drawbacks: ['-10% damage', '-6% speed'],
    mods: { parryWin: 0.09, guardCost: -0.35, dr: 0.06, dmg: -0.1, speed: -0.06 },
  },
];
export const CLASS_BY_ID = new Map(CLASSES.map((c) => [c.id, c]));

const CLASS_OF: Record<string, ClassId> = {
  wolf: 'hunter', cheetah: 'hunter', lion: 'hunter',
  bear: 'titan', hippo: 'titan', gorilla: 'titan',
  croc: 'ambusher', leopard: 'ambusher',
  badger: 'brawler', boar: 'brawler', kangaroo: 'brawler',
  otter: 'skirmisher', redfox: 'skirmisher',
  porcupine: 'guardian', turtle: 'guardian', skunk: 'guardian',
};

/** A class as a pseudo-skill so its numbers are summed with the animal's own. */
export const classSkill = (cls: ClassId): Skill => ({ id: `class_${cls}`, name: CLASS_BY_ID.get(cls)!.name, desc: '', mods: CLASS_BY_ID.get(cls)!.mods });

export const ANIMALS: AnimalDef[] = [...BASE, ...MORE].map((a) => ({ ...a, cls: CLASS_OF[a.id] }));
export const ANIMAL_BY_ID = new Map(ANIMALS.map((a) => [a.id, a]));
export const SKILL_BY_ID = new Map<string, Skill>();
for (const a of ANIMALS) {
  SKILL_BY_ID.set(a.innate.id, a.innate);
  for (const s of a.sig) SKILL_BY_ID.set(s.id, s);
  for (const pair of a.unlock) for (const s of pair) SKILL_BY_ID.set(s.id, s);
}

// --- derived numbers -----------------------------------------------------------------------

export interface Derived {
  maxHp: number;
  dmg: number;
  speed: number; // walking m/s
  maxSta: number;
  sense: number; // metres
  radius: number;
  reach: number;
}

export function sumMods(skills: Skill[]): Required<Mods> {
  const m: Required<Mods> = {
    hp: 0, dmg: 0, speed: 0, dr: 0, reflect: 0, lifesteal: 0, waterSpeed: 0, stamRegen: 0, senses: 0, markDmg: 0,
    lowHpDmg: 0, executeDmg: 0, eatBoost: 0, bleedOnHit: 0, cheatDeath: 0, regenOOC: 0, bleedImmune: 0, ambush: 0, attackerBleed: 0,
    preyXp: 0, dashCd: 0, parryWin: 0, guardCost: 0, reach: 0, noise: 0, stealth: 0,
  };
  for (const s of skills) {
    if (!s.mods) continue;
    for (const k of Object.keys(s.mods) as (keyof Mods)[]) m[k] += s.mods[k] ?? 0;
  }
  return m;
}

export function derive(def: AnimalDef, alloc: Stats, mods: Required<Mods>): Derived {
  const size = SIZE[def.size];
  const p = (k: StatKey) => def.stats[k] + alloc[k];
  return {
    maxHp: Math.round((45 + 4.5 * p('hp')) * size.hp * (1 + mods.hp)),
    dmg: (5 + 0.45 * p('atk')) * size.dmg,
    speed: (4.2 + 0.16 * p('spd')) * size.speed * (1 + mods.speed),
    maxSta: 40 + 3 * p('sta'),
    sense: (25 + 1.8 * p('sen')) * (1 + mods.senses),
    radius: size.radius,
    reach: size.reach * (1 + mods.reach),
  };
}

export const emptyStats = (): Stats => ({ hp: 0, atk: 0, spd: 0, sta: 0, sen: 0 });
