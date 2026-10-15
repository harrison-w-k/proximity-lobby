// Types and constants shared by client and server.

export const MAX_PLAYERS = 20;
export const MAP_HALF = 50; // map spans [-50, 50] on x and z
export const VOICE_REF = 3; // within this distance (m) voices are full volume
export const VOICE_MAX = 30; // beyond this distance (m) voices are silent
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
  // `token` is the player's Supabase access token. When the host has auth configured, the
  // server ignores `name` and uses the username from the verified profile instead.
  | { t: 'join'; name: string; token?: string }
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
  | { t: 'denied'; reason: string }
  | { t: 'joined'; player: PlayerState }
  | { t: 'left'; id: string }
  | { t: 'state'; p: [id: string, x: number, z: number, ry: number][] }
  | { t: 'chat'; id: string; name: string; text: string }
  | { t: 'signal'; from: string; data: unknown };
