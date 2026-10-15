// Types and constants shared by client and server.
import type { Flight, ItemState } from './items';
import type { Look } from './look';

export const MAX_PLAYERS = 20;
export const MAP_RADIUS = 24; // the arena is a circle of this radius (m) centred on the origin
export const JUMP_MAX_Y = 14; // server sanity limit on a reported feet height (m): the tallest obstacle plus a jump
export const SWIM_LIMIT = 56; // you can wade out this far from the centre (m); past it you are sent back
export const WATER_MIN_Y = -1.5; // lowest feet height the server accepts (wading in the sea)
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
  y: number; // feet height above the floor (m); > 0 while jumping
  crouch: boolean;
  avatar?: string; // profile photo as a small data URL, drawn on the face
  look?: Look; // chosen clay colour and hat
}

export type ClientMsg =
  // `token` is the player's Supabase access token. When the host has auth configured, the
  // server ignores `name` and uses the username from the verified profile instead.
  | { t: 'join'; name: string; token?: string }
  | { t: 'pos'; x: number; z: number; ry: number; y?: number; crouch?: boolean }
  | { t: 'chat'; text: string }
  | { t: 'dm'; to: string; text: string } // private message to a player id
  | { t: 'avatar'; img: string | null } // set (or clear) your profile photo
  | { t: 'look'; c: number; h: number } // set your colour and hat
  | { t: 'hit'; vx: number; vz: number } // a thrown item hit you: tell everyone to ragdoll you
  | { t: 'take'; id: number } // pick an item up
  | { t: 'drop'; id: number; x: number; y: number; z: number } // put the item you carry down here
  | { t: 'throw'; id: number; f: Flight } // throw the item you carry
  | { t: 'shove'; id: number; vx: number; vz: number } // walk into a loose item and push it
  | { t: 'signal'; to: string; data: unknown };

export type ServerMsg =
  | {
      t: 'welcome';
      id: string;
      spawn: { x: number; z: number };
      players: PlayerState[];
      items: ItemState[];
      iceServers: { urls: string | string[]; username?: string; credential?: string }[];
    }
  | { t: 'full' }
  | { t: 'denied'; reason: string }
  | { t: 'joined'; player: PlayerState }
  | { t: 'left'; id: string }
  | { t: 'state'; p: [id: string, x: number, z: number, ry: number, y: number, crouch: 0 | 1][] }
  | { t: 'chat'; id: string; name: string; text: string }
  // Sent to both the sender and the recipient, so each sees the same line.
  | { t: 'dm'; fromId: string; from: string; toId: string; to: string; text: string }
  | { t: 'notice'; text: string }
  | { t: 'avatar'; id: string; img: string | null }
  | { t: 'look'; id: string; c: number; h: number }
  | { t: 'ragdoll'; id: string; vx: number; vz: number }
  | { t: 'item'; item: ItemState; fly?: Flight; by?: string } // an item was picked up, put down or thrown (fly = its launch)
  | { t: 'signal'; from: string; data: unknown };
