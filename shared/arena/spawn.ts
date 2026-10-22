// Where you can choose to drop onto the map, and which drop suits which build.
import type { AnimalDef } from './animals';
import { Biome } from './terrain';

export type SpawnId = 'any' | 'forest' | 'grassland' | 'wetlands' | 'highlands';

export interface SpawnChoice {
  id: SpawnId;
  name: string;
  icon: string;
  biome: Biome | null;
  blurb: string;
  good: string[];
  bad: string[];
}

export const SPAWN_CHOICES: SpawnChoice[] = [
  { id: 'any', name: 'Anywhere', icon: '🎲', biome: null, blurb: 'Land on whichever drop point the dice give you.', good: ['No waiting for a free spot'], bad: ['Might not suit your build'] },
  {
    id: 'forest', name: 'Forest', icon: '🌲', biome: Biome.Forest, blurb: 'Thick trees and bushes. Easy to hide, berries and hives to eat.',
    good: ['Cover for ambushes', 'Berries, fruit and honey', 'Hard to be seen from afar'], bad: ['Trees block big animals', 'Cramped for chases'],
  },
  {
    id: 'grassland', name: 'Grassland', icon: '🌾', biome: Biome.Grassland, blurb: 'Wide open ground with herds roaming over it.',
    good: ['Room to run and kite', 'Plenty of prey to farm', 'Easy to see threats coming'], bad: ['Almost no cover', 'You are easy to see too'],
  },
  {
    id: 'wetlands', name: 'Wetlands', icon: '🌊', biome: Biome.Wetlands, blurb: 'Rivers, ponds and mud. Water is never far away.',
    good: ['Water animals swim fast and hide', 'Drinks and herbs close by', 'Few land animals follow'], bad: ['Mud slows land animals', 'Fewer solid places to fight'],
  },
  {
    id: 'highlands', name: 'Highlands', icon: '⛰️', biome: Biome.Highlands, blurb: 'Rocky high ground with boulders and pines.',
    good: ['Rocks to hop over or guard behind', 'Good lookouts over the map', 'Few rivals wander up'], bad: ['Less prey and food', 'Steep and slow going'],
  },
];

export const SPAWN_BY_ID = new Map(SPAWN_CHOICES.map((c) => [c.id, c] as const));

export function isSpawnId(x: unknown): x is SpawnId {
  return typeof x === 'string' && SPAWN_BY_ID.has(x as SpawnId);
}

/** The environment that suits an animal best, and why. */
export function bestSpawn(a: AnimalDef): { id: SpawnId; why: string } {
  if (a.swim === 'water') return { id: 'wetlands', why: `${a.name} swims fast and hides in the water.` };
  switch (a.cls) {
    case 'hunter':
      return { id: 'grassland', why: 'Open ground and herds let a hunter run prey down.' };
    case 'skirmisher':
      return { id: 'grassland', why: 'Room to dash, kite and circle a slower animal.' };
    case 'titan':
      return { id: 'forest', why: 'Berries, fruit and hives feed a big body early.' };
    case 'ambusher':
      return { id: 'forest', why: 'Bushes and trees hide an ambush until it lands.' };
    case 'brawler':
      return { id: 'forest', why: 'Cover lets a brawler close the gap before the first blow.' };
    case 'guardian':
      return { id: 'highlands', why: 'Rocks give a guardian walls to hold and ground to watch from.' };
  }
}
