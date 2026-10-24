// Numbers for fighting that the server and the client share (the client uses them to start an
// attack animation the instant you press the button, instead of waiting for the network).
// Parry (after Combat Warriors): tap to raise the guard for a short window. A hit that lands inside it is parried:
// the attacker is stunned and your parry comes back quickly. A parry that catches nothing leaves YOU fumbling.
export const PARRY_WINDOW = 0.5; // s the guard stays up
export const PARRY_STUN = 1.5; // s the attacker is stunned by a parry: cannot move, act or use items
export const PARRY_MISS_STUN = 1.5; // s you fumble after a parry that caught nothing: you can only walk
export const PARRY_MISS_CD = 3; // s until the next parry after a miss
export const PARRY_HIT_CD = 1; // s until the next parry after a success
// --- strikes and combos -------------------------------------------------------------------------
// A basic attack is a chain of strikes. Stage 1 animals share a plain three-swing chain. Every stage 2
// and stage 3 form has its own sequence of three to five strikes, chosen from the move types below and
// shaped by what the animal does in nature. The server resolves them and the client animates them.

export type StrikeKind = 'claw' | 'rake' | 'bite' | 'lunge' | 'jab' | 'sweep' | 'rend' | 'slam' | 'ram' | 'toss';
/** What a strike does to whoever it hits, on top of its damage. */
export type StrikeFx =
  | 'bleed' // damage over time
  | 'slow' // slows the target for a moment
  | 'knock' // shoves the target back
  | 'stagger'; // knocks the target's own attack out of its wind-up

export interface Strike {
  kind: StrikeKind;
  wind: number; // s of telegraph before the blow lands
  rec: number; // s of recovery after it
  dmg: number; // multiplier on the animal's attack
  reach: number; // multiplier on the animal's reach
  arc: number; // degrees of the swing
  cost: number; // stamina
  heavy: boolean; // breaks a guard and slows the target
  fx?: StrikeFx;
}

/** The base numbers of each move type. */
export const STRIKE_BASE: Record<StrikeKind, Omit<Strike, 'kind'>> = {
  claw: { wind: 0.16, rec: 0.24, dmg: 1.0, reach: 1.0, arc: 100, cost: 5, heavy: false }, // a raking swipe
  rake: { wind: 0.11, rec: 0.17, dmg: 0.75, reach: 0.95, arc: 90, cost: 4, heavy: false }, // quick double-paw flurry
  bite: { wind: 0.17, rec: 0.25, dmg: 1.15, reach: 0.95, arc: 70, cost: 5, heavy: false }, // a snap of the jaws
  lunge: { wind: 0.2, rec: 0.32, dmg: 1.2, reach: 1.32, arc: 56, cost: 7, heavy: false }, // a leap that covers ground
  jab: { wind: 0.09, rec: 0.2, dmg: 0.65, reach: 1.28, arc: 44, cost: 4, heavy: false }, // a fast thrust: sting, stab, peck
  sweep: { wind: 0.24, rec: 0.34, dmg: 0.95, reach: 1.05, arc: 210, cost: 7, heavy: false }, // a spin or tail whip
  rend: { wind: 0.24, rec: 0.3, dmg: 1.35, reach: 1.0, arc: 90, cost: 8, heavy: false }, // both forelimbs tearing down
  slam: { wind: 0.36, rec: 0.56, dmg: 1.85, reach: 1.15, arc: 120, cost: 11, heavy: true }, // rear up and crash down
  ram: { wind: 0.3, rec: 0.5, dmg: 1.55, reach: 1.12, arc: 70, cost: 10, heavy: true, fx: 'knock' }, // a head-down charge
  toss: { wind: 0.28, rec: 0.46, dmg: 1.35, reach: 1.05, arc: 80, cost: 9, heavy: true }, // an upward fling
};

/** Stage 1 animals all use this plain chain: quick, quick, then a slow heavy swing that breaks a guard. */
export const COMBO: readonly Strike[] = [
  { kind: 'claw', wind: 0.16, rec: 0.24, dmg: 1.0, reach: 1.0, arc: 100, cost: 5, heavy: false },
  { kind: 'claw', wind: 0.16, rec: 0.26, dmg: 1.05, reach: 1.0, arc: 100, cost: 5, heavy: false },
  { kind: 'slam', wind: 0.34, rec: 0.55, dmg: 1.7, reach: 1.18, arc: 124, cost: 11, heavy: true },
];
export const DEFAULT_COMBO = COMBO;

/** Full-chain damage per second of the plain chain. Every sequence is scaled to match, so they trade rhythm, not power. */
const COMBO_DPS = COMBO.reduce((a, c) => a + c.dmg, 0) / COMBO.reduce((a, c) => a + c.wind + c.rec, 0);

type Spec = StrikeKind | `${StrikeKind}:${StrikeFx}` | `${StrikeKind}!`; // "!" makes the strike heavy
function build(spec: Spec[]): readonly Strike[] {
  const raw = spec.map((t): Strike => {
    const heavyMark = t.endsWith('!');
    const [kind, fx] = (heavyMark ? t.slice(0, -1) : t).split(':') as [StrikeKind, StrikeFx | undefined];
    const b = STRIKE_BASE[kind];
    return { kind, ...b, heavy: b.heavy || heavyMark, fx: fx ?? b.fx };
  });
  raw[raw.length - 1].heavy = true; // every chain ends on a finisher that breaks a guard
  const time = raw.reduce((a, c) => a + c.wind + c.rec, 0);
  const k = (COMBO_DPS * time) / raw.reduce((a, c) => a + c.dmg, 0);
  return raw.map((c) => ({ ...c, dmg: Math.round(c.dmg * k * 1000) / 1000 }));
}

/** Each stage 2 and stage 3 form's own chain of strikes (three or four at stage 2, four or five at stage 3). */
const SEQUENCES: Record<string, Spec[]> = {
  // cats: claws, flurries and pounces
  bobcat: ['claw', 'rake', 'lunge!'],
  lynx: ['jab', 'jab', 'claw', 'slam'],
  cheetah: ['rake', 'rake', 'lunge', 'rake', 'toss'],
  panther: ['claw:bleed', 'jab', 'claw:bleed', 'rend', 'slam'],
  tiger: ['claw', 'rend', 'claw', 'rend:bleed', 'slam'],
  lion: ['sweep', 'claw', 'claw', 'slam'],
  // canines: bites, harrying and pack finishers
  coyote: ['bite', 'bite', 'rake', 'lunge!'],
  jackal: ['bite', 'jab', 'bite:bleed'],
  gray_wolf: ['bite', 'lunge', 'bite', 'bite:bleed', 'slam'],
  dhole: ['bite:bleed', 'bite:bleed', 'rake', 'lunge!'],
  hyena: ['bite', 'bite', 'rend', 'slam'],
  wild_dog: ['rake', 'bite', 'rake', 'bite:bleed', 'lunge!'],
  // mustelids: tireless, twisting, vicious
  river_otter: ['rake', 'sweep', 'bite'],
  badger: ['rake', 'rake', 'rend', 'slam'],
  giant_otter: ['bite', 'sweep', 'bite', 'sweep', 'ram'],
  sea_otter: ['claw', 'toss', 'claw', 'toss', 'slam'],
  honey_badger: ['rake', 'rake', 'rake', 'bite:bleed', 'rend!'],
  wolverine: ['claw:bleed', 'claw:bleed', 'rend', 'slam'],
  // bears: heavy paws
  black_bear: ['claw', 'sweep', 'slam'],
  sloth_bear: ['rake', 'rend', 'rake', 'toss'],
  grizzly: ['claw', 'claw', 'rend', 'sweep', 'slam'],
  polar_bear: ['claw', 'rend', 'ram', 'claw', 'slam'],
  kodiak: ['sweep', 'claw', 'rend', 'slam'],
  panda: ['claw', 'sweep', 'toss', 'ram'],
  // reptiles: venom, snaps and armour
  monitor: ['bite:bleed', 'claw', 'bite:bleed', 'sweep'],
  snapping_turtle: ['jab', 'bite', 'slam:slow'],
  komodo: ['bite:bleed', 'claw', 'bite:bleed', 'sweep', 'slam'],
  cobra: ['jab:bleed', 'jab:bleed', 'jab:bleed', 'lunge!'],
  croc: ['bite', 'sweep', 'bite:bleed', 'slam'],
  tortoise: ['ram', 'claw', 'ram:stagger', 'slam'],
  // bugs: stings, pincers and plates
  beetle: ['jab', 'claw', 'ram'],
  spider: ['jab:bleed', 'jab', 'bite:bleed', 'lunge!'],
  hercules: ['ram', 'claw', 'toss', 'ram', 'slam'],
  bombardier: ['jab', 'sweep:slow', 'jab', 'toss'],
  tarantula: ['lunge', 'bite:bleed', 'claw', 'bite:bleed', 'slam'],
  black_widow: ['jab:slow', 'jab:slow', 'bite:bleed', 'rend'],
  // fish: darts, bites and tail slaps
  piranha: ['bite', 'bite', 'bite:bleed'],
  pufferfish: ['sweep', 'jab', 'ram'],
  bull_shark: ['bite', 'ram', 'bite:bleed', 'sweep', 'slam'],
  barracuda: ['jab', 'jab', 'lunge', 'jab', 'lunge!'],
  eel: ['jab:stagger', 'jab:stagger', 'sweep', 'toss'],
  angler: ['jab:slow', 'lunge', 'bite:bleed', 'sweep:slow', 'slam'],
  // the later additions: every tree grew a third branch, and there is a tree of birds
  ocelot: ['rake', 'claw', 'lunge!'],
  leopard: ['claw', 'claw:bleed', 'jab', 'rend', 'toss'],
  snow_leopard: ['jab', 'claw', 'lunge', 'claw', 'rend'],
  dingo: ['bite', 'rake', 'bite', 'toss'],
  arctic_wolf: ['bite', 'bite:slow', 'lunge', 'bite', 'slam'],
  maned_wolf: ['jab', 'lunge', 'bite:bleed', 'jab', 'rend'],
  fisher: ['claw', 'bite', 'claw', 'rend'],
  skunk: ['jab', 'sweep', 'jab:slow', 'sweep', 'toss'],
  tayra: ['rake', 'bite', 'rake', 'bite', 'lunge!'],
  sun_bear: ['claw', 'rake', 'toss'],
  moon_bear: ['sweep', 'claw', 'jab', 'rend', 'slam'],
  cave_bear: ['ram', 'claw', 'sweep', 'rend', 'slam'],
  viper: ['jab', 'jab:bleed', 'lunge!'],
  python: ['bite', 'sweep', 'ram', 'rend', 'slam'],
  sea_turtle: ['bite', 'ram', 'sweep', 'slam'],
  scorpion: ['claw', 'claw', 'jab:bleed'],
  emperor_scorpion: ['claw', 'claw', 'rend', 'ram', 'slam'],
  deathstalker: ['jab', 'jab:stagger', 'jab', 'lunge', 'jab:bleed'],
  catfish: ['bite', 'sweep', 'ram'],
  swordfish: ['jab', 'lunge', 'jab', 'lunge', 'ram'],
  sturgeon: ['ram', 'sweep', 'ram:stagger', 'toss', 'slam'],
  hawk: ['claw', 'lunge', 'claw', 'rake'],
  owl: ['jab', 'claw', 'rend'],
  crow: ['bite', 'jab', 'claw', 'toss'],
  eagle: ['claw', 'lunge', 'claw', 'rend', 'slam'],
  falcon: ['jab', 'rake', 'lunge', 'rake', 'lunge!'],
  great_horned_owl: ['claw', 'rend', 'claw:bleed', 'toss', 'slam'],
  snowy_owl: ['claw', 'sweep:slow', 'claw', 'jab', 'lunge'],
  raven: ['jab', 'bite', 'jab:bleed', 'claw', 'toss'],
  vulture: ['bite', 'rend', 'bite', 'sweep', 'slam'],
};

const BUILT = new Map<string, readonly Strike[]>();
for (const [id, spec] of Object.entries(SEQUENCES)) BUILT.set(id, build(spec));

/** The chain of strikes an animal uses for its basic attack. */
export function comboOf(animalId: string): readonly Strike[] {
  return BUILT.get(animalId) ?? COMBO;
}
/** Which strikes of a chain are heavy, as a bit mask (bit i = strike i). */
export const heavyMask = (seq: readonly Strike[]) => seq.reduce((m, c, i) => (c.heavy ? m | (1 << i) : m), 0);
export const CUSTOM_COMBO_IDS: readonly string[] = [...BUILT.keys()];
export const COMBO_RESET = 1.25; // s without swinging before the combo starts over

// Every animal can dash: a short burst of speed, for timing a dodge or a chase.
export const DASH_COOLDOWN = 2.4; // s
export const DASH_TIME = 0.26; // s
export const DASH_SPEED = 3.4; // x walking speed
