// Lobby rules shared by the Node server and the Cloudflare Worker.
// It knows nothing about sockets: each host wraps its WebSocket in a Peer.
import { MAX_CHAT, MAX_NAME, MAX_PLAYERS, type ClientMsg, type PlayerState, type ServerMsg } from './protocol';
import { ANIMAL_BY_ID } from './arena/animals';
import { Director } from './arena/director';

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
}

/** token -> username, null if the login is invalid. May throw if the auth service is down. */
export type Verifier = (token: string) => Promise<string | null>;

const publicState = (c: Session): PlayerState => ({ id: c.id, name: c.name, animal: c.animal });

export class Lobby {
  private conns = new Map<string, Session>(); // joined players only
  /** The Animal Battle Royale queue and match. Only hosts with a steady timer (the Node server) turn it on. */
  director?: Director;

  constructor(
    private iceServers: IceServers,
    private verify?: Verifier,
  ) {}

  /** Turn on the Animal Battle Royale queue. The host must then call `tickMatch()` about every 30 ms. */
  enableMatches(opts: { fillWithBots?: boolean; countdownMs?: number; sandbox?: boolean } = {}): Director {
    const d = new Director({
      send: (id, msg) => {
        const c = this.conns.get(id);
        if (c?.joined) this.send(c, msg);
      },
      players: () => [...this.conns.values()].filter((c) => c.joined).map((c) => ({ id: c.id, name: c.name })),
    });
    if (opts.fillWithBots !== undefined) d.fillWithBots = opts.fillWithBots;
    if (opts.countdownMs !== undefined) d.countdownMs = opts.countdownMs;
    if (opts.sandbox) d.sandbox = true;
    this.director = d;
    return d;
  }

  tickMatch(now = Date.now()) {
    this.director?.tick(now);
  }

  /** True while a queue or match needs tickMatch() to keep being called. */
  matchBusy(): boolean {
    return this.director?.busy() ?? false;
  }

  /** A new socket connected; it is not a player until it sends `join`. */
  open(peer: Peer): Session {
    return { peer, id: crypto.randomUUID().slice(0, 8), name: '', joined: false, chatTimes: [] };
  }

  /** Rebuild a session from saved state (Worker woke from hibernation). */
  restore(peer: Peer, saved: Saved): Session {
    const c: Session = { ...saved, peer, chatTimes: [] };
    if (c.joined) this.conns.set(c.id, c);
    return c;
  }

  save(c: Session): Saved {
    return { id: c.id, name: c.name, joined: c.joined, animal: c.animal };
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
      case 'ping':
        if (typeof msg.n === 'number') this.send(c, { t: 'pong', n: msg.n });
        break;
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
        c.joined = true;
        const others = [...this.conns.values()].filter((o) => o.joined).map(publicState);
        this.conns.set(c.id, c);
        this.send(c, { t: 'welcome', id: c.id, players: others, iceServers: this.iceServers });
        this.broadcast({ t: 'joined', player: publicState(c) }, c.id);
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
      case 'animal': {
        if (!c.joined || typeof msg.a !== 'string' || !ANIMAL_BY_ID.has(msg.a) || !this.allowChat(c)) return;
        c.animal = msg.a;
        this.broadcast({ t: 'animal', id: c.id, a: msg.a }, c.id);
        break;
      }
      case 'menter':
      case 'mq':
      case 'mqx':
      case 'min':
      case 'mskill':
      case 'mstat':
      case 'mevolve':
      case 'muse':
      case 'mact':
      case 'mdash':
      case 'mguard':
      case 'mleave': {
        if (!c.joined) return;
        if (!this.director) {
          if (msg.t === 'mq') this.send(c, { t: 'notice', text: 'Matches are not available on this server.' });
          return;
        }
        this.director.handle(c.id, msg);
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
    this.director?.leave(c.id);
    if (c.joined) this.broadcast({ t: 'left', id: c.id });
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
