// Horde creatures: the PvE leveling engine.
import { Biome } from './terrain';

export type Behavior = 'flee' | 'pack' | 'elite' | 'alpha' | 'skittish';

export interface MobDef {
  id: string;
  name: string;
  tier: 1 | 2 | 3 | 4;
  biomes: Biome[];
  hp: number;
  dmg: number;
  speed: number;
  r: number; // body radius
  behavior: Behavior;
  aquatic?: boolean; // lives in the water and never leaves it
  amphibious?: boolean; // happy on land and in the water
  flies?: boolean; // hops and flutters just above the ground
  group: [number, number];
  meat: number; // healing meat dropped (units, 0 = none)
  color: number;
}

const F = Biome.Forest;
const W = Biome.Wetlands;
const G = Biome.Grassland;
const H = Biome.Highlands;

export const MOBS: MobDef[] = [
  // tier 1: fodder
  { id: 'mouse', name: 'Mouse', tier: 1, biomes: [F, G], hp: 8, dmg: 2, speed: 5.5, r: 0.25, behavior: 'flee', group: [2, 5], meat: 1, color: 0x9a8a7a },
  { id: 'rat', name: 'Rat', tier: 1, biomes: [F, W], hp: 10, dmg: 3, speed: 5.8, r: 0.3, behavior: 'skittish', group: [2, 4], meat: 1, color: 0x55504a },
  { id: 'sparrow', name: 'Sparrow', tier: 1, biomes: [G, F, H], hp: 6, dmg: 1, speed: 6.5, r: 0.22, behavior: 'flee', flies: true, group: [3, 6], meat: 1, color: 0x9b7653 },
  { id: 'minnow', name: 'Minnow', tier: 1, biomes: [W], hp: 5, dmg: 1, speed: 5, r: 0.2, behavior: 'flee', aquatic: true, group: [4, 8], meat: 1, color: 0xb9c7d6 },
  { id: 'beetle', name: 'Beetle', tier: 1, biomes: [F, H, W], hp: 12, dmg: 2, speed: 3.2, r: 0.28, behavior: 'skittish', group: [2, 4], meat: 1, color: 0x2d4a3a },
  // tier 2: packs
  { id: 'rabbit', name: 'Rabbit', tier: 2, biomes: [G], hp: 28, dmg: 5, speed: 8, r: 0.35, behavior: 'flee', group: [3, 5], meat: 2, color: 0xc2b4a0 },
  { id: 'duck', name: 'Duck', tier: 2, biomes: [W], hp: 32, dmg: 5, speed: 5.5, r: 0.4, behavior: 'skittish', amphibious: true, group: [3, 5], meat: 2, color: 0x6a8f5a },
  { id: 'fox', name: 'Fox', tier: 2, biomes: [F, G], hp: 32, dmg: 4, speed: 7.5, r: 0.45, behavior: 'pack', group: [3, 4], meat: 2, color: 0xd1782f },
  { id: 'perch', name: 'Perch', tier: 2, biomes: [W], hp: 26, dmg: 5, speed: 6, r: 0.35, behavior: 'skittish', aquatic: true, group: [3, 6], meat: 2, color: 0x7aa24c },
  { id: 'goat', name: 'Mountain Goat', tier: 2, biomes: [H], hp: 38, dmg: 5, speed: 7, r: 0.55, behavior: 'pack', group: [3, 4], meat: 2, color: 0xddd6c8 },
  // tier 3: elites that drop healing meat
  { id: 'wildpig', name: 'Boar', tier: 3, biomes: [H, F], hp: 120, dmg: 15, speed: 6.5, r: 0.7, behavior: 'elite', group: [1, 1], meat: 4, color: 0x5b4636 },
  { id: 'heron', name: 'Heron', tier: 3, biomes: [W], hp: 90, dmg: 14, speed: 6, r: 0.5, behavior: 'elite', amphibious: true, group: [1, 1], meat: 4, color: 0x8da1b3 },
  { id: 'pike', name: 'Large Pike', tier: 3, biomes: [W], hp: 110, dmg: 16, speed: 7, r: 0.6, behavior: 'elite', aquatic: true, group: [1, 1], meat: 4, color: 0x4f7a5a },
  // tier 4: the alpha, one per match, in the centre
  { id: 'alpha_bear', name: 'Alpha Bear', tier: 4, biomes: [G], hp: 1100, dmg: 38, speed: 6.5, r: 1.5, behavior: 'alpha', group: [1, 1], meat: 8, color: 0x3b2a20 },
  { id: 'alpha_gator', name: 'Giant Gator', tier: 4, biomes: [W], hp: 1300, dmg: 42, speed: 5.5, r: 1.7, behavior: 'alpha', amphibious: true, group: [1, 1], meat: 8, color: 0x35502d },
];
export const MOB_BY_ID = new Map(MOBS.map((m) => [m.id, m]));

export function mobDef(id: string): MobDef {
  return MOB_BY_ID.get(id)!;
}

export const TIER_SHARE = [0, 1, 1.5, 2];

// Position of each creature in snapshots (the wire sends a number, not the name).
export const MOB_IDS: string[] = MOBS.map((m) => m.id);
const MOB_INDEX = new Map(MOB_IDS.map((id, i) => [id, i]));
export const mobIndex = (id: string) => MOB_INDEX.get(id) ?? 0;
