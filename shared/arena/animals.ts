// Animals, stats and skills (data only). "A skill exists because the animal does it in nature."
// All numbers are first-pass values to tune in playtests (see the design doc).

export type SizeClass = 'small' | 'medium' | 'large';
export const STAT_KEYS = ['hp', 'atk', 'spd', 'sta', 'sen'] as const;
export type StatKey = (typeof STAT_KEYS)[number];
export type Stats = Record<StatKey, number>;
export const STAT_NAMES: Record<StatKey, string> = { hp: 'Health', atk: 'Attack', spd: 'Speed', sta: 'Stamina', sen: 'Senses' };

export const MAX_LEVEL = 20;

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
  | { s: 'scare'; dur: number }
  | { s: 'blind'; dur: number };

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


// --- the seven evolution trees ---------------------------------------------------------------------
// Everyone starts as a small stage 1 animal and evolves twice (level 7, level 14), into any form of their tree.
// Every form at a stage has the same stat budget; each skill trades power for a cooldown or a weakness.

export const EVOLVE_LEVELS = [7, 14] as const; // to stage 2, to stage 3
export const STAGE_BUDGET = [100, 160, 230] as const;
export const EVOLVE_TIME = 3; // seconds standing still; a hit cancels it

export interface AnimalDef {
  id: string;
  name: string;
  tree: string;
  stage: 1 | 2 | 3;
  size: SizeClass;
  role: string;
  stats: Stats; // the stage's budget (100 / 160 / 230 points)
  swim: 'land' | 'semi' | 'water'; // semi: strong swimmers; water: fish, slow on land
  landMul: number; // speed on land (1 for everything but fish)
  weakness: string;
  blurb: string;
  innate: Skill; // a passive that comes with the form
  skill: Skill; // the signature skill, on Q. Evolving replaces it.
  cls: ClassId;
}

export type ClassId = 'hunter' | 'titan' | 'ambusher' | 'brawler' | 'skirmisher' | 'guardian';

/** Split a budget across the five stats in the proportions of `w`, so the parts add up exactly. */
function split(budget: number, w: [number, number, number, number, number]): Stats {
  const total = w.reduce((a, b) => a + b, 0);
  const raw = w.map((x) => (x / total) * budget);
  const out = raw.map(Math.floor);
  let left = budget - out.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (left <= 0) break;
    out[i]++;
    left--;
  }
  return { hp: out[0], atk: out[1], spd: out[2], sta: out[3], sen: out[4] };
}

interface FormIn {
  id: string;
  name: string;
  tree: string;
  stage: 1 | 2 | 3;
  size: SizeClass;
  role: string;
  w: [number, number, number, number, number]; // health, attack, speed, stamina, senses (relative)
  cls: ClassId;
  blurb: string;
  weak: string;
  passive: Skill;
  skill: Skill;
  swim?: 'semi' | 'water';
  landMul?: number;
}

const FORMS: AnimalDef[] = [];
const form = (f: FormIn) =>
  FORMS.push({
    id: f.id, name: f.name, tree: f.tree, stage: f.stage, size: f.size, role: f.role, stats: split(STAGE_BUDGET[f.stage - 1], f.w),
    swim: f.swim ?? 'land', landMul: f.landMul ?? 1, weakness: f.weak, blurb: f.blurb, innate: f.passive, skill: f.skill, cls: f.cls,
  });
const slow = (dur: number, f: number): Status => ({ s: 'slow', dur, f });
const bleed = (dur: number, dps: number): Status => ({ s: 'bleed', dur, dps });
const mark = (dur: number): Status => ({ s: 'mark', dur });
const stun = (dur: number): Status => ({ s: 'stun', dur });
const blind = (dur: number): Status => ({ s: 'blind', dur });

// Cats: stealth and burst
form({ id: 'house_cat', name: 'House Cat', tree: 'cats', stage: 1, size: 'small', role: 'Pouncer', w: [16, 22, 28, 16, 18], cls: 'skirmisher',
  blurb: 'Quick, quiet and always lands on its feet.', weak: 'Fragile in a straight fight',
  passive: pas('nine_lives', 'Light Paws', '+4% speed.', { speed: 0.04 }),
  skill: act('pounce', 'Pounce', 'A short leap onto your target. No fall damage.', 8, { k: 'dash', dist: 5, dmg: 1.0 }, 8) });
form({ id: 'bobcat', name: 'Bobcat', tree: 'cats', stage: 2, size: 'medium', role: 'Stalker', w: [18, 24, 22, 16, 20], cls: 'ambusher',
  blurb: 'Waits in the brush and strikes from hiding.', weak: 'Weak when spotted in the open',
  passive: pas('brush_hunter', 'Brush Hunter', '+30% damage from a bush. Hordes notice you 25% less.', { ambush: 0.3, stealth: 0.25 }),
  skill: act('stalk', 'Stalk', 'For 5 s your strikes hit 35% harder.', 16, { k: 'buff', dur: 5, dmg: 0.35 }) });
form({ id: 'lynx', name: 'Lynx', tree: 'cats', stage: 2, size: 'medium', role: 'Spotter', w: [16, 24, 20, 16, 24], cls: 'hunter',
  blurb: 'Sharp eyes and a long jump.', weak: 'Thin defence',
  passive: pas('keen_eyes', 'Keen Eyes', '+35% senses range: you spot hidden animals from further away.', { senses: 0.35 }),
  skill: act('leap', 'Leap', 'A long jump strike.', 12, { k: 'dash', dist: 9, dmg: 1.5 }, 12) });
form({ id: 'cheetah', name: 'Cheetah', tree: 'cats', stage: 3, size: 'medium', role: 'Assassin', w: [12, 24, 34, 14, 16], cls: 'hunter',
  blurb: 'The fastest thing on four legs.', weak: 'Tires fast, low health',
  passive: pas('sprinter', 'Sprinter', '+8% speed.', { speed: 0.08 }),
  skill: act('sprint', 'Sprint', '3 s of +55% speed that costs no stamina.', 18, { k: 'buff', dur: 3, speed: 0.55, free: true }) });
form({ id: 'panther', name: 'Panther', tree: 'cats', stage: 3, size: 'medium', role: 'Shadow', w: [16, 28, 22, 14, 20], cls: 'ambusher',
  blurb: 'Nearly invisible in shade and thick brush.', weak: 'Easy to find in the open',
  passive: pas('night_hunter', 'Night Hunter', 'Hordes notice you 45% less. +20% damage from a bush.', { stealth: 0.45, ambush: 0.2 }),
  skill: act('shadow', 'Shadow', 'For 6 s: +15% speed and +25% damage.', 20, { k: 'buff', dur: 6, speed: 0.15, dmg: 0.25 }) });
form({ id: 'tiger', name: 'Tiger', tree: 'cats', stage: 3, size: 'large', role: 'Ambusher', w: [14, 20, 16, 18, 22], cls: 'ambusher', swim: 'semi',
  blurb: 'A heavy pounce from water or brush.', weak: 'Slow turns, loud',
  passive: pas('striped_swimmer', 'Striped Swimmer', 'Swims fast. +25% damage from a bush or the water.', { waterSpeed: 0.35, ambush: 0.25 }),
  skill: act('ambush', 'Ambush', 'A heavy pounce that knocks the target back.', 16, { k: 'dash', dist: 7, dmg: 2.0, knock: 2 }, 14) });
form({ id: 'lion', name: 'Lion', tree: 'cats', stage: 3, size: 'medium', role: 'Pack leader', w: [18, 22, 18, 16, 26], cls: 'hunter',
  blurb: 'Rules with a roar that rallies the hunt.', weak: 'Pride before a fall: loud',
  passive: pas('pride', 'Pride', '+8% damage, +10% against marked targets.', { dmg: 0.08, markDmg: 0.1 }),
  skill: act('roar', 'Roar', 'A mighty roar: hordes flee and enemies within 18 m are scared for 5 s.', 22, { k: 'aoe', r: 18, dmg: 0, st: [{ s: 'scare', dur: 5 }] }) });

// Canines and scavengers: pack and tracking
form({ id: 'fox', name: 'Fox', tree: 'canines', stage: 1, size: 'small', role: 'Trickster', w: [16, 18, 26, 18, 22], cls: 'skirmisher',
  blurb: 'Quick, clever and never where you swung.', weak: 'Low damage',
  passive: pas('cunning', 'Cunning', '+10% senses, hordes notice you 10% less.', { senses: 0.1, stealth: 0.1 }),
  skill: act('dig', 'Dig', 'Dive into a short burrow: a quick dash you cannot be hit during.', 10, { k: 'dash', dist: 4, dmg: 0, iframes: 0.5 }, 8) });
form({ id: 'coyote', name: 'Coyote', tree: 'canines', stage: 2, size: 'medium', role: 'Scavenger', w: [20, 22, 22, 20, 16], cls: 'brawler',
  blurb: 'Eats anything, never goes hungry.', weak: 'Average at everything',
  passive: pas('scavenger_gut', 'Scavenger Gut', 'Food heals 60% more, even spoiled meat.', { eatBoost: 0.6 }),
  skill: act('gut_feeling', 'Second Wind', 'Heal 18% of your health.', 26, { k: 'heal', pct: 0.18 }) });
form({ id: 'jackal', name: 'Jackal', tree: 'canines', stage: 2, size: 'medium', role: 'Tracker', w: [16, 22, 24, 16, 22], cls: 'hunter',
  blurb: 'Smells trouble from far away.', weak: 'Thin defence',
  passive: pas('carrion_sense', 'Carrion Sense', '+35% senses range.', { senses: 0.35 }),
  skill: act('scent', 'Scent', 'Marks enemies within 25 m for 4 s: they glow for everyone.', 20, { k: 'aoe', r: 25, dmg: 0, st: [mark(4)] }) });
form({ id: 'gray_wolf', name: 'Gray Wolf', tree: 'canines', stage: 3, size: 'medium', role: 'Tracker', w: [20, 24, 26, 18, 22], cls: 'hunter',
  blurb: 'Marks prey with a howl and runs it down.', weak: 'Weak defence alone',
  passive: pas('pack_hunter', 'Pack Hunter', '+20% damage against marked targets.', { markDmg: 0.2 }),
  skill: act('howl', 'Howl', 'Marks enemies within 40 m for 5 s: they glow for everyone and take extra damage.', 18, { k: 'aoe', r: 40, dmg: 0, st: [mark(5)] }) });
form({ id: 'dhole', name: 'Dhole', tree: 'canines', stage: 3, size: 'medium', role: 'Pack hunter', w: [18, 26, 24, 18, 14], cls: 'hunter',
  blurb: 'Hunts in a whistling pack.', weak: 'Weaker alone',
  passive: pas('whistle', 'Whistle', '+6% damage, +10% senses.', { dmg: 0.06, senses: 0.1 }),
  skill: act('pack_hunt', 'Pack Hunt', 'For 6 s: +30% damage and +10% speed.', 18, { k: 'buff', dur: 6, dmg: 0.3, speed: 0.1 }) });
form({ id: 'hyena', name: 'Spotted Hyena', tree: 'canines', stage: 3, size: 'medium', role: 'Crusher', w: [24, 28, 18, 16, 14], cls: 'brawler',
  blurb: 'Jaws that break shells and shields.', weak: 'Slow to start a chase',
  passive: pas('bone_jaws', 'Bone Jaws', '+10% damage, 5% lifesteal.', { dmg: 0.1, lifesteal: 0.05 }),
  skill: act('bone_crush', 'Bone Crush', 'A crushing bite that stuns for 0.5 s.', 10, { k: 'cone', range: 2.6, arc: 80, dmg: 2.2, st: [stun(0.5)] }) });
form({ id: 'wild_dog', name: 'African Wild Dog', tree: 'canines', stage: 3, size: 'medium', role: 'Runner', w: [16, 22, 26, 26, 16], cls: 'skirmisher',
  blurb: 'Runs all day.', weak: 'Low health',
  passive: pas('tireless', 'Tireless', 'Stamina recovers 60% faster.', { stamRegen: 0.6 }),
  skill: act('endurance', 'Endurance', 'For 7 s: +25% speed that costs no stamina.', 20, { k: 'buff', dur: 7, speed: 0.25, free: true }) });

// Mustelids: brawlers and swimmers
form({ id: 'weasel', name: 'Weasel', tree: 'mustelids', stage: 1, size: 'small', role: 'Squeezer', w: [14, 24, 24, 16, 22], cls: 'skirmisher',
  blurb: 'Fits through anywhere and bites hard for its size.', weak: 'Tiny and frail',
  passive: pas('slinky', 'Slinky', '+4% speed, hordes notice you 20% less.', { speed: 0.04, stealth: 0.2 }),
  skill: act('squeeze', 'Squeeze', 'A quick dash that slips through a blow.', 8, { k: 'dash', dist: 6, dmg: 0.4, iframes: 0.3 }, 8) });
form({ id: 'river_otter', name: 'River Otter', tree: 'mustelids', stage: 2, size: 'medium', role: 'Swimmer', w: [16, 20, 28, 18, 18], cls: 'skirmisher', swim: 'semi',
  blurb: 'Fast in the water, annoying everywhere else.', weak: 'Fragile',
  passive: pas('swimmer', 'Swimmer', 'Swims much faster.', { waterSpeed: 0.5, stealth: 0.1 }),
  skill: act('slick', 'Slick', 'A slippery dash you cannot be hit during.', 9, { k: 'dash', dist: 6, dmg: 0.5, iframes: 0.45 }, 8) });
form({ id: 'badger', name: 'Badger', tree: 'mustelids', stage: 2, size: 'medium', role: 'Digger', w: [24, 22, 16, 22, 16], cls: 'brawler',
  blurb: 'Digs in and refuses to move.', weak: 'Slow',
  passive: pas('tough', 'Tough Skin', '+10% health.', { hp: 0.1 }),
  skill: act('dig_in', 'Dig In', 'For 5 s: take 45% less damage.', 18, { k: 'buff', dur: 5, dr: 0.45 }) });
form({ id: 'giant_otter', name: 'Giant Otter', tree: 'mustelids', stage: 3, size: 'medium', role: 'Shoal hunter', w: [20, 26, 24, 18, 18], cls: 'skirmisher', swim: 'semi',
  blurb: 'Hunts in the water in a family pack.', weak: 'Weak on dry land',
  passive: pas('river_pack', 'River Pack', 'Swims fast. +30% damage from the water.', { waterSpeed: 0.4, ambush: 0.3 }),
  skill: act('shoal_hunt', 'Shoal Hunt', 'A wide bite for heavy damage.', 9, { k: 'cone', range: 3, arc: 90, dmg: 1.6 }) });
form({ id: 'sea_otter', name: 'Sea Otter', tree: 'mustelids', stage: 3, size: 'medium', role: 'Rock thrower', w: [18, 24, 22, 20, 22], cls: 'skirmisher', swim: 'semi',
  blurb: 'Cracks shells with a thrown rock.', weak: 'Fragile',
  passive: pas('shell_cracker', 'Shell Cracker', '+6% damage, swims fast.', { dmg: 0.06, waterSpeed: 0.35 }),
  skill: act('rock_throw', 'Rock Throw', 'Throw a rock 14 m. It stuns for 0.7 s.', 8, { k: 'proj', dmg: 1.5, range: 14, st: [stun(0.7)] }) });
form({ id: 'honey_badger', name: 'Honey Badger', tree: 'mustelids', stage: 3, size: 'medium', role: 'Brawler', w: [24, 26, 20, 20, 12], cls: 'brawler',
  blurb: 'Fears nothing and gets angrier when hurt.', weak: 'Short reach',
  passive: pas('frenzy', 'Frenzy', '+35% damage under 40% health.', { lowHpDmg: 0.35 }),
  skill: act('thick_hide', 'Thick Hide', 'For 6 s: take 35% less damage and deal 10% more.', 20, { k: 'buff', dur: 6, dr: 0.35, dmg: 0.1 }) });
form({ id: 'wolverine', name: 'Wolverine', tree: 'mustelids', stage: 3, size: 'medium', role: 'Tracker', w: [20, 26, 22, 20, 20], cls: 'brawler',
  blurb: 'Follows a bleeding trail to the end.', weak: 'Average speed',
  passive: pas('gnaw', 'Gnaw', 'Your bites make targets bleed for 3 s.', { bleedOnHit: 3 }),
  skill: act('blood_trail', 'Blood Trail', 'A bite that bleeds and slows the target.', 11, { k: 'cone', range: 2.6, arc: 90, dmg: 1.3, st: [bleed(4, 0.25), slow(2, 0.35)] }) });

// Bears: bruisers and foragers
form({ id: 'raccoon', name: 'Raccoon', tree: 'bears', stage: 1, size: 'small', role: 'Forager', w: [22, 18, 16, 24, 20], cls: 'skirmisher',
  blurb: 'Clever hands that harvest in a flash.', weak: 'Slow',
  passive: pas('nimble_hands', 'Nimble Hands', 'Food heals 40% more, +15% XP from hunting.', { eatBoost: 0.4, preyXp: 0.15 }),
  skill: act('scramble', 'Scramble', 'A quick scramble away from danger.', 9, { k: 'dash', dist: 4, dmg: 0.3, iframes: 0.3 }, 8) });
form({ id: 'black_bear', name: 'Black Bear', tree: 'bears', stage: 2, size: 'medium', role: 'Scout', w: [24, 22, 18, 20, 20], cls: 'guardian',
  blurb: 'Climbs a tree to scout, or to escape.', weak: 'Average damage',
  passive: pas('lookout', 'Lookout', '+30% senses range, hordes notice you 10% less.', { senses: 0.3, stealth: 0.1 }),
  skill: act('climb', 'Climb', 'Up a tree for 4 s: +20% speed and 30% less damage.', 18, { k: 'buff', dur: 4, speed: 0.2, dr: 0.3 }) });
form({ id: 'sloth_bear', name: 'Sloth Bear', tree: 'bears', stage: 2, size: 'medium', role: 'Raider', w: [22, 24, 18, 20, 16], cls: 'brawler',
  blurb: 'Raids hives and dens, and shrugs off stings.', weak: 'Slow to react',
  passive: pas('raider', 'Raider', '+20% XP from hunting, immune to bleeding.', { preyXp: 0.2, bleedImmune: 1 }),
  skill: act('claw_rake', 'Claw Rake', 'A raking swipe that slows.', 9, { k: 'cone', range: 2.6, arc: 100, dmg: 1.4, st: [slow(2, 0.3)] }) });
form({ id: 'grizzly', name: 'Grizzly', tree: 'bears', stage: 3, size: 'large', role: 'Bruiser', w: [20, 22, 14, 20, 24], cls: 'titan',
  blurb: 'Mauls everything in reach.', weak: 'Slow, loud, a big target',
  passive: pas('intimidate', 'Intimidate', '+10% health.', { hp: 0.1 }),
  skill: act('maul', 'Maul', 'A huge swipe in front of you.', 10, { k: 'cone', range: 3.4, arc: 100, dmg: 2.4 }) });
form({ id: 'polar_bear', name: 'Polar Bear', tree: 'bears', stage: 3, size: 'large', role: 'Swim hunter', w: [18, 22, 18, 22, 22], cls: 'ambusher', swim: 'semi',
  blurb: 'A quiet swimmer that ambushes from the water.', weak: 'Slow on land',
  passive: pas('quiet_swimmer', 'Quiet Swimmer', 'Swims fast and quiet. +30% damage from the water.', { waterSpeed: 0.45, ambush: 0.3, noise: -0.25 }),
  skill: act('swim_hunter', 'Swim Hunter', 'A powerful lunge that knocks the target back.', 15, { k: 'dash', dist: 7, dmg: 1.8, knock: 2 }, 12) });
form({ id: 'kodiak', name: 'Kodiak Bear', tree: 'bears', stage: 3, size: 'large', role: 'Forager', w: [26, 20, 12, 24, 18], cls: 'titan',
  blurb: 'Eats the whole feast and heals from it.', weak: 'Slowest of all',
  passive: pas('feast', 'Feast', 'Food heals twice as much.', { eatBoost: 1.0 }),
  skill: act('salmon_feast', 'Salmon Feast', 'Heal 30% of your health.', 28, { k: 'heal', pct: 0.3 }) });
form({ id: 'panda', name: 'Giant Panda', tree: 'bears', stage: 3, size: 'medium', role: 'Roller', w: [26, 20, 18, 22, 14], cls: 'guardian',
  blurb: 'Rolls out of danger and heals on bamboo.', weak: 'Gentle damage',
  passive: pas('bamboo_diet', 'Bamboo Diet', 'Plants heal 60% more. Slowly heals out of combat.', { eatBoost: 0.6, regenOOC: 0.02 }),
  skill: act('bamboo_roll', 'Bamboo Roll', 'Roll out of danger: a dash you cannot be hit during.', 11, { k: 'dash', dist: 6, dmg: 0.7, iframes: 0.5 }, 10) });

// Reptiles: venom and armor
form({ id: 'gecko', name: 'Gecko', tree: 'reptiles', stage: 1, size: 'small', role: 'Climber', w: [20, 16, 18, 22, 24], cls: 'skirmisher',
  blurb: 'Clings to anything and drops its tail to escape.', weak: 'Weak bite',
  passive: pas('tail_drop', 'Tail Drop', 'Hordes notice you 20% less, 4% damage reduction.', { stealth: 0.2, dr: 0.04 }),
  skill: act('cling', 'Cling', 'Scurry away: a short dash you cannot be hit during.', 9, { k: 'dash', dist: 4, dmg: 0, iframes: 0.35 }, 8) });
form({ id: 'monitor', name: 'Monitor Lizard', tree: 'reptiles', stage: 2, size: 'medium', role: 'Venom biter', w: [20, 24, 20, 18, 18], cls: 'brawler',
  blurb: 'A venomous bite that keeps hurting.', weak: 'Slow to finish a fight',
  passive: pas('venom_glands', 'Venom Glands', 'Your bites make targets bleed for 3 s.', { bleedOnHit: 3 }),
  skill: act('venom_bite', 'Venom Bite', 'A bite with strong poison over time.', 8, { k: 'cone', range: 2.4, arc: 80, dmg: 0.9, st: [bleed(5, 0.35)] }) });
form({ id: 'snapping_turtle', name: 'Snapping Turtle', tree: 'reptiles', stage: 2, size: 'medium', role: 'Armor', w: [26, 20, 12, 22, 20], cls: 'guardian', swim: 'semi',
  blurb: 'Hides in its shell and bites back.', weak: 'Very slow',
  passive: pas('armored', 'Armored', '10% damage reduction and +10% health, but 6% slower.', { dr: 0.1, hp: 0.1, speed: -0.06 }),
  skill: act('shell', 'Shell', 'For 4 s: take 80% less damage.', 18, { k: 'buff', dur: 4, dr: 0.8 }) });
form({ id: 'komodo', name: 'Komodo Dragon', tree: 'reptiles', stage: 3, size: 'medium', role: 'Venom hunter', w: [22, 28, 18, 18, 18], cls: 'brawler',
  blurb: 'Rotting venom that is deadly to the wounded.', weak: 'Slow to build up',
  passive: pas('septic', 'Septic', '+30% damage against targets under 40% health.', { executeDmg: 0.3 }),
  skill: act('rotting_bite', 'Rotting Bite', 'A bite with a heavy, lasting venom.', 10, { k: 'cone', range: 2.6, arc: 80, dmg: 1.4, st: [bleed(6, 0.45)] }) });
form({ id: 'cobra', name: 'King Cobra', tree: 'reptiles', stage: 3, size: 'medium', role: 'Spitter', w: [16, 26, 22, 18, 22], cls: 'ambusher',
  blurb: 'Spits venom that blinds.', weak: 'Fragile',
  passive: pas('hood', 'Hood', '8% reflect, 5% damage reduction.', { reflect: 0.08, dr: 0.05 }),
  skill: act('spit', 'Spit', 'Spit venom 14 m: damages and blinds.', 11, { k: 'proj', dmg: 0.8, range: 14, st: [blind(3)] }) });
form({ id: 'croc', name: 'Saltwater Crocodile', tree: 'reptiles', stage: 3, size: 'large', role: 'Ambusher', w: [20, 24, 10, 20, 22], cls: 'ambusher', swim: 'semi',
  blurb: 'Waits under the surface, then does not let go.', weak: 'Slow on land',
  passive: pas('ambush_predator', 'Ambush Predator', 'Swims fast. +35% damage from the water.', { ambush: 0.35, waterSpeed: 0.4 }),
  skill: act('death_roll', 'Death Roll', 'Grab a target and roll it for 2.5 s of damage.', 18, { k: 'grab', dur: 2.5, dps: 0.55, range: 3.2 }) });
form({ id: 'tortoise', name: 'Giant Tortoise', tree: 'reptiles', stage: 3, size: 'large', role: 'Fortress', w: [30, 18, 8, 22, 18], cls: 'guardian',
  blurb: 'A walking fortress with a crushing stomp.', weak: 'The slowest animal there is',
  passive: pas('fortress', 'Fortress', '25% damage reduction, but 10% slower.', { dr: 0.25, speed: -0.1 }),
  skill: act('stomp', 'Crushing Stomp', 'Stomp the ground: damages and stuns everything within 5.5 m.', 16, { k: 'aoe', r: 5.5, dmg: 1.2, st: [stun(1.0)] }) });

// Bugs and arachnids (scaled up so they stay readable): traps and bursts
form({ id: 'ant', name: 'Ant', tree: 'bugs', stage: 1, size: 'small', role: 'Forager', w: [14, 22, 22, 20, 22], cls: 'skirmisher',
  blurb: 'Tiny, tireless and never really alone.', weak: 'Very fragile',
  passive: pas('colony', 'Colony', '+5% health, stamina recovers 30% faster.', { hp: 0.05, stamRegen: 0.3 }),
  skill: act('trail', 'Trail Rush', 'Follow the scent trail: +25% speed for 6 s.', 12, { k: 'buff', dur: 6, speed: 0.25 }) });
form({ id: 'beetle', name: 'Beetle', tree: 'bugs', stage: 2, size: 'medium', role: 'Armor', w: [26, 20, 14, 22, 18], cls: 'guardian',
  blurb: 'Takes hits on its shell.', weak: 'Slow',
  passive: pas('chitin', 'Chitin', '8% damage reduction and +8% health.', { dr: 0.08, hp: 0.08 }),
  skill: act('carapace', 'Carapace', 'For 5 s: take 55% less damage.', 18, { k: 'buff', dur: 5, dr: 0.55 }) });
form({ id: 'spider', name: 'Spider', tree: 'bugs', stage: 2, size: 'medium', role: 'Trapper', w: [16, 24, 22, 16, 22], cls: 'ambusher',
  blurb: 'Snares prey with a line of silk.', weak: 'Fragile',
  passive: pas('webwalker', 'Webwalker', 'Hordes notice you 20% less. +15% damage from a bush.', { stealth: 0.2, ambush: 0.15 }),
  skill: act('silk', 'Silk', 'Shoot a line of silk 14 m that snares the target.', 10, { k: 'proj', dmg: 0.5, range: 14, st: [slow(2.5, 0.6)] }) });
form({ id: 'hercules', name: 'Hercules Beetle', tree: 'bugs', stage: 3, size: 'large', role: 'Charger', w: [24, 24, 14, 18, 20], cls: 'titan',
  blurb: 'Flips its enemies with a mighty horn.', weak: 'Slow to turn',
  passive: pas('horn', 'Horn', '+6% damage, +10% health.', { dmg: 0.06, hp: 0.1 }),
  skill: act('horn_flip', 'Horn Flip', 'A charge that flips the target and knocks it back.', 14, { k: 'dash', dist: 7, dmg: 1.6, knock: 4 }, 12) });
form({ id: 'bombardier', name: 'Bombardier Beetle', tree: 'bugs', stage: 3, size: 'medium', role: 'Sprayer', w: [20, 26, 20, 18, 22], cls: 'ambusher',
  blurb: 'A boiling spray that burns and blinds.', weak: 'Short range',
  passive: pas('boil', 'Boil', '12% reflect.', { reflect: 0.12 }),
  skill: act('acid_spray', 'Acid Spray', 'A short burst that damages and blinds.', 11, { k: 'cone', range: 3.5, arc: 70, dmg: 1.3, st: [blind(3)] }) });
form({ id: 'tarantula', name: 'Tarantula', tree: 'bugs', stage: 3, size: 'medium', role: 'Pouncer', w: [22, 28, 20, 16, 18], cls: 'ambusher',
  blurb: 'A heavy venom pounce, and itchy hairs for anyone who hits back.', weak: 'Patient but slow',
  passive: pas('urticating', 'Urticating Hairs', '10% reflect, and attackers bleed for 3 s.', { reflect: 0.1, attackerBleed: 3 }),
  skill: act('leap_bite', 'Leap Bite', 'A pounce with a heavy venom bite.', 13, { k: 'dash', dist: 6, dmg: 1.8, st: [bleed(5, 0.4)] }, 12) });
form({ id: 'black_widow', name: 'Black Widow', tree: 'bugs', stage: 3, size: 'medium', role: 'Trapper', w: [18, 24, 22, 18, 22], cls: 'ambusher',
  blurb: 'Lays webs that slow and poison.', weak: 'Fragile',
  passive: pas('widow_venom', 'Widow Venom', 'Your bites make targets bleed for 3 s.', { bleedOnHit: 3 }),
  skill: act('web_trap', 'Web Trap', 'A web in a 5 m circle: slows and poisons everything in it.', 18, { k: 'aoe', r: 5, dmg: 0.5, st: [slow(3, 0.7), bleed(5, 0.3)] }) });

// Fish: water control and bursts. They always spawn in water and are slow on land.
form({ id: 'mudskipper', name: 'Mudskipper', tree: 'fish', stage: 1, size: 'small', role: 'Hopper', w: [20, 20, 22, 20, 18], cls: 'skirmisher', swim: 'water', landMul: 0.75,
  blurb: 'Leaps between ponds, and the only fish that really walks.', weak: 'Weak bite',
  passive: pas('amphibious', 'Amphibious', 'Swims fast, and is the least slow of the fish on land.', { waterSpeed: 0.2 }),
  skill: act('skitter', 'Skitter', 'A quick leap that carries you across short gaps.', 7, { k: 'dash', dist: 6, dmg: 0.3, iframes: 0.2 }, 6) });
form({ id: 'piranha', name: 'Piranha', tree: 'fish', stage: 2, size: 'medium', role: 'Biter', w: [16, 28, 22, 16, 18], cls: 'hunter', swim: 'water', landMul: 0.5,
  blurb: 'Faster and harder against anything bleeding.', weak: 'Fragile, helpless on land',
  passive: pas('scent_of_blood', 'Scent of Blood', '+35% damage against targets under 40% health.', { executeDmg: 0.35 }),
  skill: act('blood_frenzy', 'Blood Frenzy', 'For 5 s: +30% damage and +20% speed.', 16, { k: 'buff', dur: 5, dmg: 0.3, speed: 0.2 }) });
form({ id: 'pufferfish', name: 'Pufferfish', tree: 'fish', stage: 2, size: 'medium', role: 'Defender', w: [24, 18, 18, 20, 20], cls: 'guardian', swim: 'water', landMul: 0.5,
  blurb: 'Swells up and punishes whatever hits it.', weak: 'Helpless on land',
  passive: pas('toxin', 'Toxin', 'Attackers bleed for 3 s.', { attackerBleed: 3 }),
  skill: act('inflate', 'Inflate', 'For 4 s: take 65% less damage and reflect 25%.', 18, { k: 'buff', dur: 4, dr: 0.65, reflect: 0.25 }) });
form({ id: 'bull_shark', name: 'Bull Shark', tree: 'fish', stage: 3, size: 'large', role: 'Apex', w: [20, 24, 20, 20, 26], cls: 'hunter', swim: 'water', landMul: 0.45,
  blurb: 'Feels every animal in the water.', weak: 'Almost helpless on land',
  passive: pas('apex', 'Apex', '+8% damage, swims faster.', { dmg: 0.08, waterSpeed: 0.3 }),
  skill: act('lateral_line', 'Lateral Line', 'Marks every animal within 50 m for 5 s, even hidden ones.', 22, { k: 'aoe', r: 50, dmg: 0, st: [mark(5)] }) });
form({ id: 'barracuda', name: 'Barracuda', tree: 'fish', stage: 3, size: 'medium', role: 'Torpedo', w: [16, 26, 30, 18, 16], cls: 'skirmisher', swim: 'water', landMul: 0.5,
  blurb: 'A torpedo that hits like one.', weak: 'Fragile, helpless on land',
  passive: pas('needle_teeth', 'Needle Teeth', '+8% speed, bites make targets bleed for 2 s.', { speed: 0.08, bleedOnHit: 2 }),
  skill: act('torpedo', 'Torpedo', 'A burst of speed that hits hard on impact.', 12, { k: 'dash', dist: 9, dmg: 2.0, knock: 2 }, 12) });
form({ id: 'eel', name: 'Electric Eel', tree: 'fish', stage: 3, size: 'medium', role: 'Shocker', w: [20, 24, 20, 20, 22], cls: 'ambusher', swim: 'water', landMul: 0.5,
  blurb: 'A shock that stuns everything near it.', weak: 'Helpless on land',
  passive: pas('charge', 'Charge', '10% reflect.', { reflect: 0.1 }),
  skill: act('shock', 'Shock', 'A shock around you: damages and stuns everything within 6 m.', 16, { k: 'aoe', r: 6, dmg: 1.0, st: [stun(1.4)] }) });
form({ id: 'angler', name: 'Anglerfish', tree: 'fish', stage: 3, size: 'medium', role: 'Lurer', w: [22, 22, 18, 20, 26], cls: 'ambusher', swim: 'water', landMul: 0.5,
  blurb: 'A glowing light that draws prey in.', weak: 'Helpless on land',
  passive: pas('glow', 'Deep Glow', '+20% senses range.', { senses: 0.2 }),
  skill: act('lure_light', 'Lure', 'A glowing light: everything within 14 m is marked and slowed.', 18, { k: 'aoe', r: 14, dmg: 0.4, st: [mark(4), slow(3, 0.5)] }) });

export interface TreeDef {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  starter: string;
}
export const TREES: TreeDef[] = [
  { id: 'cats', name: 'Cats', icon: '🐈', blurb: 'Stealth and burst', starter: 'house_cat' },
  { id: 'canines', name: 'Canines and scavengers', icon: '🦊', blurb: 'Pack and tracking', starter: 'fox' },
  { id: 'mustelids', name: 'Mustelids', icon: '🦦', blurb: 'Brawlers and swimmers', starter: 'weasel' },
  { id: 'bears', name: 'Bears', icon: '🐻', blurb: 'Bruisers and foragers', starter: 'raccoon' },
  { id: 'reptiles', name: 'Reptiles', icon: '🦎', blurb: 'Venom and armor', starter: 'gecko' },
  { id: 'bugs', name: 'Bugs and arachnids', icon: '🐜', blurb: 'Traps and bursts', starter: 'ant' },
  { id: 'fish', name: 'Fish', icon: '🐟', blurb: 'Water control and bursts', starter: 'mudskipper' },
];
export const TREE_BY_ID = new Map(TREES.map((t) => [t.id, t]));


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


/** A class as a pseudo-skill so its numbers are summed with the animal's own. */
export const classSkill = (cls: ClassId): Skill => ({ id: `class_${cls}`, name: CLASS_BY_ID.get(cls)!.name, desc: '', mods: CLASS_BY_ID.get(cls)!.mods });

export const ANIMALS: AnimalDef[] = FORMS;
export const ANIMAL_BY_ID = new Map(ANIMALS.map((a) => [a.id, a]));
/** The seven animals you can start as. */
export const STARTERS: AnimalDef[] = TREES.map((t) => ANIMAL_BY_ID.get(t.starter)!);
export const FORMS_OF_TREE = (tree: string) => ANIMALS.filter((a) => a.tree === tree);

/** The forms an animal can evolve into right now: any form of the next stage in its tree, once it is high enough a level. */
export function evolveOptions(def: AnimalDef, level: number): AnimalDef[] {
  if (def.stage >= 3 || level < EVOLVE_LEVELS[def.stage - 1]) return [];
  return ANIMALS.filter((a) => a.tree === def.tree && a.stage === def.stage + 1);
}

export const SKILL_BY_ID = new Map<string, Skill>();
for (const a of ANIMALS) {
  SKILL_BY_ID.set(a.innate.id, a.innate);
  SKILL_BY_ID.set(a.skill.id, a.skill);
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
    speed: (4.2 + 0.16 * (def.stats.spd / Math.pow(STAGE_BUDGET[def.stage - 1] / 100, 0.75) + alloc.spd)) * size.speed * (1 + mods.speed),
    maxSta: 40 + 3 * p('sta'),
    sense: (25 + 1.8 * p('sen')) * (1 + mods.senses),
    radius: size.radius,
    reach: size.reach * (1 + mods.reach),
  };
}

export const emptyStats = (): Stats => ({ hp: 0, atk: 0, spd: 0, sta: 0, sen: 0 });
