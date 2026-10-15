// Little objects you can pick up with a click and carry. The server owns who holds what; every
// client draws the same set, so everyone sees the same things sitting about and being carried.

export type ItemKind = 'ball' | 'crate' | 'cone' | 'duck' | 'fish';

export interface ItemState {
  id: number;
  kind: ItemKind;
  x: number;
  y: number; // height of the item's base
  z: number;
  holder: string | null; // player id carrying it, or null when it is lying around
}

export const REACH = 5; // how close (m) you must be to pick something up

/** Where the items start. Kept clear of the obstacle course. */
export const ITEM_SPAWNS: Omit<ItemState, 'holder'>[] = [
  { id: 0, kind: 'ball', x: 4, y: 0, z: 3 },
  { id: 1, kind: 'duck', x: -4, y: 0, z: 3.5 },
  { id: 2, kind: 'crate', x: 3, y: 0, z: -4 },
  { id: 3, kind: 'cone', x: -3, y: 0, z: -5 },
  { id: 4, kind: 'fish', x: 0, y: 0, z: 7 },
  { id: 5, kind: 'ball', x: 9, y: 0, z: 3 },
  { id: 6, kind: 'duck', x: -9, y: 0, z: -3 },
  { id: 7, kind: 'cone', x: 6, y: 0, z: 10 },
  { id: 8, kind: 'fish', x: -6, y: 0, z: -10 },
  { id: 9, kind: 'ball', x: -2, y: 0, z: -12 },
  { id: 10, kind: 'crate', x: 8, y: 0, z: 16 },
  { id: 11, kind: 'duck', x: 1, y: 0, z: -15 },
  { id: 12, kind: 'fish', x: 13, y: 0, z: 9 },
  { id: 13, kind: 'cone', x: -1, y: 0, z: 14 },
];
