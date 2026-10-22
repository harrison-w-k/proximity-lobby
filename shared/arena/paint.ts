// Fur colours: each player can pick a main colour and an accent colour for every animal.

/** [main, accent] as 0xRRGGBB. -1 leaves that one to the animal's natural colour (or, with nothing picked, a shade of its own). */
export type Paint = [number, number];

export const NO_PAINT: Paint = [-1, -1];

/** Swatches offered in the picker. */
export const PAINT_SWATCHES: number[] = [
  0xf4efe4, 0x2b2622, 0x8c8f94, 0x7a4a2a, 0xd88a3c, 0xe8c15a, 0x6fae3c, 0x2f8f6a, 0x3fa5cf, 0x4668c7, 0x8a5ac8, 0xd0508a, 0xd9503a, 0xf0a0b0,
];

/** Anything that is not a valid paint becomes `undefined`. */
export function cleanPaint(x: unknown): Paint | undefined {
  if (!Array.isArray(x) || x.length !== 2) return undefined;
  const ok = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= -1 && v <= 0xffffff;
  if (!ok(x[0]) || !ok(x[1])) return undefined;
  if (x[0] === -1 && x[1] === -1) return undefined;
  return [x[0] as number, x[1] as number];
}

export const hex6 = (n: number) => '#' + n.toString(16).padStart(6, '0');
