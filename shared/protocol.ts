// Types and constants shared by client and server.
import type { ClientMatchMsg, ServerMatchMsg } from './arena/proto';

export const MAX_PLAYERS = 20;
export const VOICE_REF = 3; // within this distance (m) voices are full volume
export const VOICE_MAX = 30; // beyond this distance (m) voices are silent
export const MAX_NAME = 16;
export const MAX_CHAT = 200;

export interface PlayerState {
  id: string;
  name: string;
  animal?: string; // the animal you play as
}

export type ClientMsg =
  // `token` is the player's Supabase access token. When the host has auth configured, the
  // server ignores `name` and uses the username from the verified profile instead.
  | { t: 'join'; name: string; token?: string }
  | { t: 'chat'; text: string }
  | { t: 'dm'; to: string; text: string } // private message to a player id
  | { t: 'animal'; a: string } // choose the animal you appear as
  | { t: 'signal'; to: string; data: unknown }
  | { t: 'ping'; n: number } // the client's clock; echoed back so it can measure round-trip time
  | ClientMatchMsg;

export type ServerMsg =
  | { t: 'pong'; n: number }
  | {
      t: 'welcome';
      id: string;
      players: PlayerState[];
      iceServers: { urls: string | string[]; username?: string; credential?: string }[];
    }
  | { t: 'full' }
  | { t: 'denied'; reason: string }
  | { t: 'joined'; player: PlayerState }
  | { t: 'left'; id: string }
  | { t: 'chat'; id: string; name: string; text: string }
  // Sent to both the sender and the recipient, so each sees the same line.
  | { t: 'dm'; fromId: string; from: string; toId: string; to: string; text: string }
  | { t: 'notice'; text: string }
  | { t: 'animal'; id: string; a: string }
  | { t: 'signal'; from: string; data: unknown }
  | ServerMatchMsg;
