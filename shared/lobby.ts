// Lobby rules shared by the Node server and the Cloudflare Worker.
// It knows nothing about sockets: each host wraps its WebSocket in a Peer.
import {
  MAP_HALF,
  MAX_CHAT,
  MAX_NAME,
  MAX_PLAYERS,
  type ClientMsg,
  type PlayerState,
  type ServerMsg,
} from './protocol';

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
}

const publicState = (c: Session): PlayerState => ({ id: c.id, name: c.name, x: c.x, z: c.z, ry: c.ry });
const clampMap = (v: number) => Math.max(-MAP_HALF, Math.min(MAP_HALF, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class Lobby {
  private conns = new Map<string, Session>(); // joined players only
  private dirty = new Set<string>();

  constructor(private iceServers: IceServers) {}

  /** A new socket connected; it is not a player until it sends `join`. */
  open(peer: Peer): Session {
    return { peer, id: crypto.randomUUID().slice(0, 8), name: '', x: 0, z: 0, ry: 0, joined: false, chatTimes: [] };
  }

  /** Rebuild a session from saved state (Worker woke from hibernation). */
  restore(peer: Peer, saved: Saved): Session {
    const c: Session = { ...saved, peer, chatTimes: [] };
    if (c.joined) this.conns.set(c.id, c);
    return c;
  }

  save(c: Session): Saved {
    return { id: c.id, name: c.name, x: c.x, z: c.z, ry: c.ry, joined: c.joined };
  }

  message(c: Session, raw: string) {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    switch (msg.t) {
      case 'join': {
        if (c.joined) return;
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
        c.x = (Math.random() - 0.5) * 16;
        c.z = (Math.random() - 0.5) * 16;
        c.joined = true;
        const others = [...this.conns.values()].filter((o) => o.joined).map(publicState);
        this.conns.set(c.id, c);
        this.send(c, { t: 'welcome', id: c.id, spawn: { x: c.x, z: c.z }, players: others, iceServers: this.iceServers });
        this.broadcast({ t: 'joined', player: publicState(c) }, c.id);
        break;
      }
      case 'pos': {
        if (!c.joined || !finite(msg.x) || !finite(msg.z) || !finite(msg.ry)) return;
        c.x = clampMap(msg.x);
        c.z = clampMap(msg.z);
        c.ry = msg.ry;
        this.dirty.add(c.id);
        break;
      }
      case 'chat': {
        if (!c.joined || typeof msg.text !== 'string') return;
        const text = msg.text.trim().slice(0, MAX_CHAT);
        if (!text) return;
        const now = Date.now();
        c.chatTimes = c.chatTimes.filter((t) => now - t < 5000);
        if (c.chatTimes.length >= 5) return; // rate limit: 5 msgs / 5 s
        c.chatTimes.push(now);
        this.broadcast({ t: 'chat', id: c.id, name: c.name, text });
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
    if (!this.conns.delete(c.id)) return;
    this.dirty.delete(c.id);
    if (c.joined) this.broadcast({ t: 'left', id: c.id });
  }

  /** Send changed positions to everyone except their owner. Returns false if nothing was pending. */
  flush(): boolean {
    if (this.dirty.size === 0) return false;
    const p: [string, number, number, number][] = [];
    for (const id of this.dirty) {
      const c = this.conns.get(id);
      if (c) p.push([c.id, c.x, c.z, c.ry]);
    }
    this.dirty.clear();
    for (const c of this.conns.values()) {
      const mine = p.filter((e) => e[0] !== c.id);
      if (mine.length) this.send(c, { t: 'state', p: mine });
    }
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
