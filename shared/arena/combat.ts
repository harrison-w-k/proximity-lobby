// Numbers for fighting that the server and the client share (the client uses them to start an
// attack animation the instant you press the button, instead of waiting for the network).
export const PARRY_WINDOW = 0.24; // s after raising the guard in which a hit is parried
export const GUARD_COOLDOWN = 0.4;
export const GUARD_DRAIN = 3.5; // stamina per second while guarding
/** The three swings of a basic combo: quick, quick, then a slow heavy one that breaks a guard. */
export const COMBO = [
  { wind: 0.16, rec: 0.24, dmg: 1.0, reach: 1.0, arc: 100, cost: 5 },
  { wind: 0.16, rec: 0.26, dmg: 1.05, reach: 1.0, arc: 100, cost: 5 },
  { wind: 0.34, rec: 0.55, dmg: 1.7, reach: 1.18, arc: 124, cost: 11 },
] as const;
export const COMBO_RESET = 1.25; // s without swinging before the combo starts over

// Every animal can dash: a short burst of speed, for timing a dodge or a chase.
export const DASH_COOLDOWN = 2.4; // s
export const DASH_TIME = 0.26; // s
export const DASH_SPEED = 3.4; // x walking speed
