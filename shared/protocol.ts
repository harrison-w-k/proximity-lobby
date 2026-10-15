// Types and constants shared by client and server.

export const MAX_PLAYERS = 20;
export const MAP_HALF = 50; // map spans [-50, 50] on x and z
export const VOICE_REF = 3; // within this distance (m) voices are full volume
export const VOICE_MAX = 30; // beyond this distance (m) voices are silent
// New players appear on the waterfront plaza in front of the aquarium entrance.
export const SPAWN = { xMin: -8, xMax: 8, zMin: 14, zMax: 26 };
export const MAX_NAME = 16;
export const MAX_CHAT = 200;

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  z: number;
  ry: number; // yaw, radians
}

export type ClientMsg =
  | { t: 'join'; name: string }
  | { t: 'pos'; x: number; z: number; ry: number }
  | { t: 'chat'; text: string }
  | { t: 'signal'; to: string; data: unknown };

export type ServerMsg =
  | {
      t: 'welcome';
      id: string;
      spawn: { x: number; z: number };
      players: PlayerState[];
      iceServers: { urls: string | string[]; username?: string; credential?: string }[];
    }
  | { t: 'full' }
  | { t: 'joined'; player: PlayerState }
  | { t: 'left'; id: string }
  | { t: 'state'; p: [id: string, x: number, z: number, ry: number][] }
  | { t: 'chat'; id: string; name: string; text: string }
  | { t: 'signal'; from: string; data: unknown };
