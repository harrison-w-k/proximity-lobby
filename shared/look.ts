// Character customisation: a shade of grey for the clay and a hat. The figures are colourless
// artist's mannequins, so the "colour scheme" is only how light or dark the finish is.

export interface Look {
  c: number; // index into LOOK_COLORS, or -1 for the shade picked from your id
  h: number; // index into HATS
}

export const LOOK_COLORS: { name: string; hex: number }[] = [
  { name: 'Chalk', hex: 0xf4f4f2 },
  { name: 'Alabaster', hex: 0xe6e6e2 },
  { name: 'Marble', hex: 0xd6d6d6 },
  { name: 'Silver', hex: 0xc4c6ca },
  { name: 'Platinum', hex: 0xb4b6ba },
  { name: 'Steel', hex: 0x9a9da3 },
  { name: 'Pewter', hex: 0x84878d },
  { name: 'Slate', hex: 0x6e7176 },
  { name: 'Graphite', hex: 0x56585d },
  { name: 'Smoke', hex: 0x44464a },
  { name: 'Charcoal', hex: 0x303236 },
  { name: 'Onyx', hex: 0x1e1f22 },
];

export const HATS = ['None', 'Baseball cap', 'Top hat', 'Party hat', 'Crown', 'Headphones'];

export const DEFAULT_LOOK: Look = { c: -1, h: 0 };

export function validLook(c: unknown, h: unknown): Look | null {
  if (typeof c !== 'number' || typeof h !== 'number') return null;
  if (!Number.isInteger(c) || !Number.isInteger(h)) return null;
  if (c < -1 || c >= LOOK_COLORS.length || h < 0 || h >= HATS.length) return null;
  return { c, h };
}
