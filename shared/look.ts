// Character customisation: a clay colour and a hat. Named after Windows colour schemes and themes.

export interface Look {
  c: number; // index into LOOK_COLORS, or -1 for the colour picked from your id
  h: number; // index into HATS
}

export const LOOK_COLORS: { name: string; hex: number }[] = [
  { name: 'Luna Blue', hex: 0x6f9bf0 },
  { name: 'Olive Green', hex: 0xa9b87a },
  { name: 'Silver', hex: 0xd2d6dd },
  { name: 'Bliss Green', hex: 0x8bd35a },
  { name: 'Royal', hex: 0x4a4fb8 },
  { name: 'Energy Orange', hex: 0xf4a14a },
  { name: 'Media Center', hex: 0x3fae7a },
  { name: 'Rose', hex: 0xf08fb4 },
  { name: 'Aero Glass', hex: 0x9fe3f5 },
  { name: 'Classic Beige', hex: 0xece9d8 },
  { name: 'Hotmail Red', hex: 0xe0584a },
  { name: 'Graphite', hex: 0x6a7080 },
];

export const HATS = ['None', 'Baseball cap', 'Top hat', 'Party hat', 'Crown', 'Headphones'];

export const DEFAULT_LOOK: Look = { c: -1, h: 0 };

export function validLook(c: unknown, h: unknown): Look | null {
  if (typeof c !== 'number' || typeof h !== 'number') return null;
  if (!Number.isInteger(c) || !Number.isInteger(h)) return null;
  if (c < -1 || c >= LOOK_COLORS.length || h < 0 || h >= HATS.length) return null;
  return { c, h };
}
