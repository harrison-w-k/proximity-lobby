// Lobby rules shared by the Node server and the Cloudflare Worker.
// It knows nothing about sockets: each host wraps its WebSocket in a Peer.
import {
  JUMP_MAX_Y,
  SWIM_LIMIT,
  WATER_MIN_Y,
  MAX_CHAT,
  MAX_NAME,
  MAX_PLAYERS,
  type ClientMsg,
  type PlayerState,
  type ServerMsg,
} from './protocol';
import { clampToArena } from './map';
import { validAvatar } from './avatar';
import { ITEM_SPAWNS, REACH, type ItemState } from './items';

export type IceServers = Extract<ServerMsg, { t: 'welcome' }>['iceServers'];

export interface Peer {
  send(data: string): void;
  close(): void;
}

/** What a host must persist per connection to rebuild a Session after a restart. */
export interface Saved extends PlayerState {
  joined: boolean;
}

export interface Session extends Saved {
  peer: Peer;
  chatTimes: number[];
  verifying?: boolean; // a join is waiting on the auth check
  closed?: boolean;
  avatar?: string; // not part of Saved: too big for a socket attachment, hosts persist it separately
}

/** token -> username, null if the login is invalid. May throw if the auth service is down. */
export type Verifier = (token: string) => Promise<string | null>;

const publicState = (c: Session): PlayerState => ({
  id: c.id,
  name: c.name,
  x: c.x,
  z: c.z,
  ry: c.ry,
  y: c.y,
  crouch: c.crouch,
  avatar: c.avatar,
});
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class Lobby {
  private conns = new Map<string, Session>(); // joined players only
  private dirty = new Set<string>();
  private items = new Map<number, ItemState>(ITEM_SPAWNS.map((i) => [i.id, { ...i, holder: null }]));
  /** Hosts that outlive a restart (the Durable Object) persist photos here: null = removed. */
  onAvatar?: (id: string, img: string | null) => void;

  constructor(
    private iceServers: IceServers,
    private verify?: Verifier,
  ) {}

  /** A new socket connected; it is not a player until it sends `join`. */
  open(peer: Peer): Session {
    return {
      peer,
      id: crypto.randomUUID().slice(0, 8),
      name: '',
      x: 0,
      z: 0,
      ry: 0,
      y: 0,
      crouch: false,
      joined: false,
      chatTimes: [],
    };
  }

  /** Rebuild a session from saved state (Worker woke from hibernation). */
  restore(peer: Peer, saved: Saved, avatar?: string): Session {
    // older attachments predate y / crouch, so default them
    const c: Session = {
      ...saved,
      y: saved.y ?? 0,
      crouch: saved.crouch ?? false,
      peer,
      chatTimes: [],
      avatar: validAvatar(avatar) ? avatar : undefined,
    };
    if (c.joined) this.conns.set(c.id, c);
    return c;
  }

  save(c: Session): Saved {
    return { id: c.id, name: c.name, x: c.x, z: c.z, ry: c.ry, y: c.y, crouch: c.crouch, joined: c.joined };
  }

  /**
   * Entry point for hosts. With a verifier configured, `join` must carry a valid token and the
   * name comes from the verified profile; otherwise it is the same as `message`.
   */
  async handle(c: Session, raw: string): Promise<void> {
    try {
      await this.dispatch(c, raw);
    } catch (e) {
      // A bad message must never take the server (or the whole Durable Object) down.
      console.error('lobby: message handler failed', e);
    }
  }

  private async dispatch(c: Session, raw: string): Promise<void> {
    if (this.verify) {
      let msg: ClientMsg | null = null;
      try {
        msg = JSON.parse(raw);
      } catch {
        return;
      }
      if (msg?.t === 'join') {
        if (c.joined || c.verifying) return;
        c.verifying = true;
        let name: string | null = null;
        let reason = 'Please sign in to join.';
        try {
          name = typeof msg.token === 'string' ? await this.verify(msg.token) : null;
        } catch {
          reason = 'Sign-in service is unavailable. Please try again.';
        } finally {
          c.verifying = false;
        }
        if (c.closed) return;
        if (!name) {
          this.send(c, { t: 'denied', reason });
          c.peer.close();
          return;
        }
        this.message(c, JSON.stringify({ t: 'join', name }));
        return;
      }
    }
    this.message(c, raw);
  }

  message(c: Session, raw: string) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return; // e.g. the JSON text "null" or "5"

    switch (msg.t) {
      case 'join': {
        if (c.joined || c.closed) return;
        if (this.conns.size >= MAX_PLAYERS) {
          this.send(c, { t: 'full' });
          c.peer.close();
          return;
        }
        const name = String(msg.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
        const base = name || `player-${c.id.slice(0, 3)}`;
        const taken = new Set([...this.conns.values()].map((o) => o.name.toLowerCase()));
        let unique = base;
        for (let i = 2; taken.has(unique.toLowerCase()); i++) unique = `${base.slice(0, MAX_NAME - 3)}_${i}`;
        c.name = unique;
        c.x = (Math.random() - 0.5) * 10; // +-5 m: clear of every obstacle (see shared/obstacles.ts)
        c.z = (Math.random() - 0.5) * 10;
        c.joined = true;
        const others = [...this.conns.values()].filter((o) => o.joined).map(publicState);
        this.conns.set(c.id, c);
        this.send(c, { t: 'welcome', id: c.id, spawn: { x: c.x, z: c.z }, players: others, items: [...this.items.values()], iceServers: this.iceServers });
        this.broadcast({ t: 'joined', player: publicState(c) }, c.id);
        break;
      }
      case 'pos': {
        if (!c.joined || !finite(msg.x) || !finite(msg.z) || !finite(msg.ry)) return;
        const at = clampToArena(msg.x, msg.z, SWIM_LIMIT);
        c.x = at.x;
        c.z = at.z;
        c.ry = msg.ry;
        c.y = finite(msg.y) ? Math.max(WATER_MIN_Y, Math.min(JUMP_MAX_Y, msg.y)) : 0;
        c.crouch = msg.crouch === true;
        this.dirty.add(c.id);
        break;
      }
      case 'chat': {
        if (!c.joined || typeof msg.text !== 'string') return;
        const text = msg.text.trim().slice(0, MAX_CHAT);
        if (!text || !this.allowChat(c)) return;
        this.broadcast({ t: 'chat', id: c.id, name: c.name, text });
        break;
      }
      case 'dm': {
        if (!c.joined || typeof msg.text !== 'string' || typeof msg.to !== 'string') return;
        const text = msg.text.trim().slice(0, MAX_CHAT);
        if (!text || !this.allowChat(c)) return;
        const target = this.conns.get(msg.to);
        if (!target?.joined || target.id === c.id) {
          this.send(c, { t: 'notice', text: 'That player is not here.' });
          return;
        }
        const out: ServerMsg = { t: 'dm', fromId: c.id, from: c.name, toId: target.id, to: target.name, text };
        this.send(target, out);
        this.send(c, out);
        break;
      }
      case 'avatar': {
        if (!c.joined) return;
        const img = msg.img === null ? null : validAvatar(msg.img) ? msg.img : undefined;
        if (img === undefined || !this.allowChat(c)) return; // junk or too frequent: ignore
        c.avatar = img ?? undefined;
        this.onAvatar?.(c.id, img);
        this.broadcast({ t: 'avatar', id: c.id, img }, c.id);
        break;
      }
      case 'take': {
        const it = this.items.get(msg.id);
        if (!c.joined || !it || it.holder) return;
        for (const o of this.items.values()) if (o.holder === c.id) return; // hands are full
        if (Math.hypot(it.x - c.x, it.z - c.z) > REACH + 3) return; // too far (allows for lag)
        it.holder = c.id;
        this.broadcast({ t: 'item', item: it });
        break;
      }
      case 'drop': {
        const it = this.items.get(msg.id);
        if (!c.joined || !it || it.holder !== c.id) return;
        if (!finite(msg.x) || !finite(msg.y) || !finite(msg.z)) return;
        const at = clampToArena(msg.x, msg.z, SWIM_LIMIT);
        if (Math.hypot(at.x - c.x, at.z - c.z) > 6) return;
        it.x = at.x;
        it.z = at.z;
        it.y = Math.max(WATER_MIN_Y, Math.min(JUMP_MAX_Y, msg.y));
        it.holder = null;
        this.broadcast({ t: 'item', item: it });
        break;
      }
      case 'signal': {
        if (!c.joined) return;
        const target = this.conns.get(msg.to);
        if (target?.joined) this.send(target, { t: 'signal', from: c.id, data: msg.data });
        break;
      }
    }
  }

  /** The socket closed. */
  close(c: Session) {
    c.closed = true;
    if (!this.conns.delete(c.id)) return;
    if (c.avatar) this.onAvatar?.(c.id, null);
    for (const it of this.items.values()) {
      if (it.holder !== c.id) continue; // whatever they carried is left where they stood
      it.holder = null;
      it.x = c.x;
      it.z = c.z;
      it.y = Math.max(0, c.y);
      this.broadcast({ t: 'item', item: it });
    }
    this.dirty.delete(c.id);
    if (c.joined) this.broadcast({ t: 'left', id: c.id });
  }

  /** Send changed positions to everyone except their owner. Returns false if nothing was pending. */
  flush(): boolean {
    if (this.dirty.size === 0) return false;
    const p: [string, number, number, number, number, 0 | 1][] = [];
    for (const id of this.dirty) {
      const c = this.conns.get(id);
      if (c) p.push([c.id, c.x, c.z, c.ry, c.y, c.crouch ? 1 : 0]);
    }
    this.dirty.clear();
    for (const c of this.conns.values()) {
      const mine = p.filter((e) => e[0] !== c.id);
      if (mine.length) this.send(c, { t: 'state', p: mine });
    }
    return true;
  }

  /** Shared rate limit for public and private chat: 5 messages / 5 s. */
  private allowChat(c: Session): boolean {
    const now = Date.now();
    c.chatTimes = c.chatTimes.filter((t) => now - t < 5000);
    if (c.chatTimes.length >= 5) return false;
    c.chatTimes.push(now);
    return true;
  }

  private send(c: Session, msg: ServerMsg) {
    c.peer.send(JSON.stringify(msg));
  }

  private broadcast(msg: ServerMsg, exceptId?: string) {
    const data = JSON.stringify(msg);
    for (const c of this.conns.values()) {
      if (c.joined && c.id !== exceptId) c.peer.send(data);
    }
  }
}
