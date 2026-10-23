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
import { validLook, type Look } from './look';
import { ANIMAL_BY_ID } from './arena/animals';
import { cleanPaint } from './arena/paint';
import { Director } from './arena/director';
import { ITEM_SPAWNS, REACH, THROW_MAX_SPEED, bounceFor, throwPath, type ItemState } from './items';

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
  hitAt?: number;
  fxTimes?: number[]; // recent lobby moves, to keep sparring from flooding everyone
  score?: number;
  ptsTimes?: number[];
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
  look: c.look,
  animal: c.animal,
  paint: c.paint,
});
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export class Lobby {
  private conns = new Map<string, Session>(); // joined players only
  private dirty = new Set<string>();
  private shoved = new Map<number, number>(); // item id -> last time it was shoved (ms)
  private items = new Map<number, ItemState>(ITEM_SPAWNS.map((i) => [i.id, { ...i, holder: null }]));
  /** The Animal Battle Royale queue and match. Only hosts with a steady timer (the Node server) turn it on. */
  director?: Director;
  /** Hosts that outlive a restart (the Durable Object) persist photos here: null = removed. */
  onAvatar?: (id: string, img: string | null) => void;
  /** Hosts that can be evicted from memory (the Durable Object) persist the items here. */
  onItems?: (items: ItemState[]) => void;

  constructor(
    private iceServers: IceServers,
    private verify?: Verifier,
  ) {}

  /** Turn on the Animal Battle Royale queue. The host must then call `tickMatch()` about every 30 ms. */
  enableMatches(opts: { fillWithBots?: boolean; countdownMs?: number } = {}): Director {
    const d = new Director({
      send: (id, msg) => {
        const c = this.conns.get(id);
        if (c?.joined) this.send(c, msg);
      },
      players: () => [...this.conns.values()].filter((c) => c.joined).map((c) => ({ id: c.id, name: c.name })),
    });
    if (opts.fillWithBots !== undefined) d.fillWithBots = opts.fillWithBots;
    if (opts.countdownMs !== undefined) d.countdownMs = opts.countdownMs;
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

  /** Put the items back after a restart. Anything held by a player who is no longer here is set down. */
  restoreItems(list: ItemState[]) {
    for (const it of list) {
      if (!this.items.has(it.id)) continue;
      const held = it.holder !== null && this.conns.has(it.holder);
      this.items.set(it.id, { ...it, holder: held ? it.holder : null });
    }
  }

  private broadcastScores() {
    const s: [string, string, number][] = [...this.conns.values()]
      .filter((o) => o.joined)
      .map((o): [string, string, number] => [o.id, o.name, o.score ?? 0])
      .sort((a, b) => b[2] - a[2])
      .slice(0, 10);
    this.broadcast({ t: 'scores', s });
  }

  private itemsChanged() {
    this.onItems?.([...this.items.values()]);
  }

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
    return { id: c.id, name: c.name, x: c.x, z: c.z, ry: c.ry, y: c.y, crouch: c.crouch, joined: c.joined, look: c.look, animal: c.animal, paint: c.paint };
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
        c.x = (Math.random() - 0.5) * 10; // +-5 m: clear of every obstacle (see shared/obstacles.ts)
        c.z = (Math.random() - 0.5) * 10;
        c.joined = true;
        const others = [...this.conns.values()].filter((o) => o.joined).map(publicState);
        this.conns.set(c.id, c);
        this.send(c, { t: 'welcome', id: c.id, spawn: { x: c.x, z: c.z }, players: others, items: [...this.items.values()], iceServers: this.iceServers });
        this.broadcast({ t: 'joined', player: publicState(c) }, c.id);
        this.broadcastScores();
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
      case 'emote': {
        if (!c.joined || typeof msg.e !== 'number' || !Number.isInteger(msg.e) || msg.e < 0 || msg.e > 4) return;
        if (!this.allowChat(c)) return;
        this.broadcast({ t: 'emote', id: c.id, e: msg.e }, c.id);
        break;
      }
      case 'pts': {
        if (!c.joined || typeof msg.n !== 'number' || !Number.isInteger(msg.n) || msg.n < 1 || msg.n > 10) return;
        const now = Date.now();
        c.ptsTimes = (c.ptsTimes ?? []).filter((t) => now - t < 5000);
        if (c.ptsTimes.length >= 12) return; // no more than a dozen scoring events per 5 s
        c.ptsTimes.push(now);
        c.score = (c.score ?? 0) + msg.n;
        this.broadcastScores();
        break;
      }
      case 'lfx': {
        if (!c.joined || !this.allowFx(c) || !['a', 'q', 'x'].includes(msg.s)) return;
        const combo = finite(msg.c) ? Math.max(0, Math.min(9, Math.floor(msg.c))) : 0;
        this.broadcast({ t: 'lfx', id: c.id, s: msg.s, c: combo }, c.id);
        break;
      }
      case 'lhit': {
        if (!c.joined || !this.allowFx(c) || typeof msg.to !== 'string' || !finite(msg.n) || !finite(msg.kx) || !finite(msg.kz)) return;
        const target = this.conns.get(msg.to);
        if (!target?.joined || target.id === c.id) return;
        const len = Math.max(1e-3, Math.hypot(msg.kx, msg.kz));
        const n = Math.max(1, Math.min(99, Math.round(msg.n)));
        // nobody loses anything: this is only the number and the shove, shown to everyone
        this.broadcast({ t: 'lhit', by: c.id, to: target.id, n, kx: msg.kx / len, kz: msg.kz / len }, c.id);
        break;
      }
      case 'animal': {
        if (!c.joined || typeof msg.a !== 'string' || !ANIMAL_BY_ID.has(msg.a) || !this.allowChat(c)) return;
        c.animal = msg.a;
        c.paint = cleanPaint(msg.paint);
        this.broadcast({ t: 'animal', id: c.id, a: msg.a, paint: c.paint }, c.id);
        break;
      }
      case 'look': {
        if (!c.joined) return;
        const look: Look | null = validLook(msg.c, msg.h);
        if (!look || !this.allowChat(c)) return;
        c.look = look;
        this.broadcast({ t: 'look', id: c.id, c: look.c, h: look.h }, c.id);
        break;
      }
      case 'hit': {
        if (!c.joined || !finite(msg.vx) || !finite(msg.vz)) return;
        const now = Date.now();
        if (now - (c.hitAt ?? 0) < 1200) return; // one knock-down at a time
        c.hitAt = now;
        const sp = Math.hypot(msg.vx, msg.vz);
        const k = sp > 16 ? 16 / sp : 1;
        const sev = finite(msg.sev) ? Math.max(0, Math.min(1, msg.sev)) : 0.5;
        this.broadcast({ t: 'ragdoll', id: c.id, vx: msg.vx * k, vz: msg.vz * k, sev }, c.id);
        break;
      }
      case 'take': {
        const it = this.items.get(msg.id);
        if (!c.joined || !it) return;
        // when a request is refused, tell the sender the truth so its picture can't drift
        const refuse = () => this.send(c, { t: 'item', item: it });
        if (it.holder) return refuse();
        for (const o of this.items.values()) if (o.holder === c.id) return; // hands are full
        if (Math.hypot(it.x - c.x, it.z - c.z) > REACH + 3) return refuse(); // too far (allows for lag)
        it.holder = c.id;
        this.itemsChanged();
        this.broadcast({ t: 'item', item: it });
        break;
      }
      case 'drop': {
        const it = this.items.get(msg.id);
        if (!c.joined || !it) return;
        if (it.holder !== c.id) return void this.send(c, { t: 'item', item: it });
        if (!finite(msg.x) || !finite(msg.y) || !finite(msg.z)) return;
        const at = clampToArena(msg.x, msg.z, SWIM_LIMIT);
        if (Math.hypot(at.x - c.x, at.z - c.z) > 6) return void this.send(c, { t: 'item', item: it });
        it.x = at.x;
        it.z = at.z;
        it.y = Math.max(WATER_MIN_Y, Math.min(JUMP_MAX_Y, msg.y));
        it.holder = null;
        this.itemsChanged();
        this.broadcast({ t: 'item', item: it });
        break;
      }
      case 'throw': {
        const it = this.items.get(msg.id);
        const f = msg.f;
        if (!c.joined || !it) return;
        if (it.holder !== c.id) return void this.send(c, { t: 'item', item: it });
        if (!Array.isArray(f) || f.length !== 6 || !f.every(finite)) return;
        if (Math.hypot(f[0] - c.x, f[2] - c.z) > 3 || f[1] < c.y - 1 || f[1] > c.y + 3) {
          return void this.send(c, { t: 'item', item: it }); // refused: tell the sender where things really are
        }
        const v = Math.hypot(f[3], f[4], f[5]);
        const k = v > THROW_MAX_SPEED ? THROW_MAX_SPEED / v : 1;
        const launch: [number, number, number, number, number, number] = [f[0], f[1], f[2], f[3] * k, f[4] * k, f[5] * k];
        const path = throwPath(launch, bounceFor(it.kind));
        const end = path[path.length - 1];
        const at = clampToArena(end[0], end[2], SWIM_LIMIT);
        it.x = at.x;
        it.y = Math.max(WATER_MIN_Y, Math.min(JUMP_MAX_Y, end[1]));
        it.z = at.z;
        it.holder = null;
        this.itemsChanged();
        this.broadcast({ t: 'item', item: it, fly: launch, by: c.id });
        break;
      }
      case 'shove': {
        const it = this.items.get(msg.id);
        if (!c.joined || !it || it.holder || !finite(msg.vx) || !finite(msg.vz)) return;
        if (Math.hypot(it.x - c.x, it.z - c.z) > 3 || Math.abs(it.y - c.y) > 2.5) return;
        const now = Date.now();
        if (now - (this.shoved.get(it.id) ?? 0) < 250) return; // one push at a time
        this.shoved.set(it.id, now);
        const sp = Math.hypot(msg.vx, msg.vz);
        const k = sp > 8 ? 8 / sp : 1;
        const launch: [number, number, number, number, number, number] = [it.x, it.y + 0.02, it.z, msg.vx * k, 1.2, msg.vz * k];
        const end = throwPath(launch, bounceFor(it.kind)).at(-1)!;
        const at = clampToArena(end[0], end[2], SWIM_LIMIT);
        it.x = at.x;
        it.y = Math.max(WATER_MIN_Y, Math.min(JUMP_MAX_Y, end[1]));
        it.z = at.z;
        this.itemsChanged();
        this.broadcast({ t: 'item', item: it, fly: launch });
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
    if (c.avatar) this.onAvatar?.(c.id, null);
    for (const it of this.items.values()) {
      if (it.holder !== c.id) continue; // whatever they carried is left where they stood
      it.holder = null;
      it.x = c.x;
      it.z = c.z;
      it.y = Math.max(0, c.y);
      this.itemsChanged();
      this.broadcast({ t: 'item', item: it });
    }
    this.dirty.delete(c.id);
    if (c.joined) {
      this.broadcast({ t: 'left', id: c.id });
      this.broadcastScores();
    }
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
  private allowFx(c: Session): boolean {
    const now = Date.now();
    const list = (c.fxTimes = (c.fxTimes ?? []).filter((t) => now - t < 1000));
    if (list.length >= 30) return false;
    list.push(now);
    return true;
  }

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
