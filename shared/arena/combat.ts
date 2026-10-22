// Numbers for fighting that the server and the client share (the client uses them to start an
// attack animation the instant you press the button, instead of waiting for the network).
// Parry (after Combat Warriors): tap to raise the guard for a short window. A hit that lands inside it is parried:
// the attacker is stunned and your parry comes back quickly. A parry that catches nothing leaves YOU fumbling.
export const PARRY_WINDOW = 0.5; // s the guard stays up
export const PARRY_STUN = 1.5; // s the attacker is stunned by a parry: cannot move, act or use items
export const PARRY_MISS_STUN = 1.5; // s you fumble after a parry that caught nothing: you can only walk
export const PARRY_MISS_CD = 3; // s until the next parry after a miss
export const PARRY_HIT_CD = 1; // s until the next parry after a success
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
