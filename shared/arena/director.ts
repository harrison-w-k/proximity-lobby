// Runs the queue and the current match for a host. The lobby feeds it client messages and calls
// tick() from its timer; it talks back through `send`.
import { ANIMALS } from './animals';
import { DT, Match, type Entrant } from './match';
import type { ClientMatchMsg, QueueInfo, ServerMatchMsg } from './proto';

export const MATCH_SLOTS = 20;
const COUNTDOWN_MS = 25_000;
const AFTER_MATCH_MS = 20_000;
const BOT_NAMES = [
  'Maple', 'Biscuit', 'Juniper', 'Pebble', 'Thistle', 'Marlow', 'Clover', 'Bramble', 'Fennel', 'Sorrel', 'Willow', 'Tansy', 'Rowan', 'Burdock',
  'Nettle', 'Cinder', 'Moss', 'Tumble', 'Sedge', 'Hazel', 'Ember', 'Quill', 'Dapple', 'Sprout',
];

export interface DirectorHost {
  send(id: string, msg: ServerMatchMsg): void;
  /** Everyone in the lobby, with the name to show. */
  players(): { id: string; name: string }[];
}

interface Queued {
  animal: string;
  team: string;
}

export class Director {
  readonly queue = new Map<string, Queued>();
  match: Match | null = null;
  private startAt: number | null = null;
  private endedAt = 0;
  private last = 0;
  private acc = 0;
  private lastInfo = '';
  private inMatch = new Set<string>();
  /** Fill the empty slots with AI so there are always 20 animals. */
  fillWithBots = true;
  /** Seconds a match waits for more players after the first one queues. */
  countdownMs = COUNTDOWN_MS;

  constructor(private host: DirectorHost) {}

  /** Something is waiting or running, so the host must keep calling tick(). */
  busy(): boolean {
    return this.queue.size > 0 || this.match !== null || this.startAt !== null;
  }

  info(id: string): QueueInfo {
    return {
      queued: this.queue.size,
      startsIn: this.startAt === null ? null : Math.max(0, Math.ceil((this.startAt - Date.now()) / 1000)),
      inMatch: !!this.match && !this.match.finished,
      you: this.queue.has(id),
      slots: MATCH_SLOTS,
    };
  }

  private broadcastQueue(force = false) {
    const key = `${this.queue.size}|${this.startAt === null ? '-' : Math.ceil((this.startAt - Date.now()) / 1000)}|${this.match ? 1 : 0}|${[...this.queue.keys()].join(',')}`;
    if (!force && key === this.lastInfo) return;
    this.lastInfo = key;
    for (const p of this.host.players()) {
      if (this.inMatch.has(p.id) && this.match && !this.match.finished) continue;
      this.host.send(p.id, { t: 'mq', q: this.info(p.id) });
    }
  }

  join(id: string, animal: string, team?: string) {
    if (this.inMatch.has(id) && this.match && !this.match.finished) return;
    const a = ANIMALS.find((x) => x.id === animal);
    if (!a) return;
    if (!this.queue.has(id) && this.queue.size >= MATCH_SLOTS) return;
    this.queue.set(id, { animal: a.id, team: (team ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 12) });
    if (this.startAt === null && !(this.match && !this.match.finished)) this.startAt = Date.now() + this.countdownMs;
    this.broadcastQueue(true);
  }

  leave(id: string) {
    const had = this.queue.delete(id);
    if (this.queue.size === 0 && !(this.match && !this.match.finished)) this.startAt = null;
    if (this.inMatch.has(id)) {
      this.match?.release(id);
      this.inMatch.delete(id);
      // nobody is left to play it: drop the match so the next queue can start
      if (this.inMatch.size === 0 && this.match && !this.match.finished) {
        this.match = null;
        if (this.queue.size) this.startAt = Date.now() + this.countdownMs;
      }
    }
    if (had) this.broadcastQueue(true);
  }

  handle(id: string, msg: ClientMatchMsg) {
    switch (msg.t) {
      case 'mq':
        if (typeof msg.animal === 'string') this.join(id, msg.animal, typeof msg.team === 'string' ? msg.team : '');
        break;
      case 'mqx':
        this.leave(id);
        this.host.send(id, { t: 'mq', q: this.info(id) });
        break;
      case 'mleave':
        this.leave(id);
        this.host.send(id, { t: 'mq', q: this.info(id) });
        break;
      default:
        if (this.inMatch.has(id)) this.match?.handle(id, msg);
    }
  }

  private start() {
    const names = new Map(this.host.players().map((p) => [p.id, p.name]));
    const entrants: Entrant[] = [];
    const teamIds = new Map<string, number>();
    const teamSize = new Map<number, number>();
    let nextTeam = 0;
    for (const [id, q] of this.queue) {
      if (!names.has(id)) continue;
      let team = -1;
      if (q.team) {
        const t = teamIds.get(q.team);
        if (t !== undefined && (teamSize.get(t) ?? 0) < 4) team = t;
        else {
          team = nextTeam++;
          teamIds.set(q.team, team);
        }
      } else team = nextTeam++;
      teamSize.set(team, (teamSize.get(team) ?? 0) + 1);
      entrants.push({ id, name: names.get(id)!, animal: q.animal, team, bot: false });
    }
    if (!entrants.length) {
      this.queue.clear();
      this.startAt = null;
      return;
    }
    if (this.fillWithBots) {
      const used = new Set(entrants.map((e) => e.name.toLowerCase()));
      let n = 0;
      while (entrants.length < MATCH_SLOTS) {
        let name = BOT_NAMES[(n + Math.floor(Math.random() * BOT_NAMES.length)) % BOT_NAMES.length];
        while (used.has(name.toLowerCase())) name += '_';
        used.add(name.toLowerCase());
        entrants.push({ id: `bot${n++}`, name, animal: ANIMALS[Math.floor(Math.random() * ANIMALS.length)].id, team: nextTeam++, bot: true });
      }
    }
    const seed = (Math.random() * 0x7fffffff) | 0;
    this.match = new Match(seed, entrants, { send: (id, msg) => this.host.send(id, msg) });
    this.inMatch = new Set(entrants.filter((e) => !e.bot).map((e) => e.id));
    this.queue.clear();
    this.startAt = null;
    this.acc = 0;
    this.last = Date.now();
    const roster = this.match.roster();
    for (const id of this.inMatch) this.host.send(id, { t: 'mstart', seed, you: id, roster, nodes: [] });
    this.broadcastQueue(true);
  }

  /** Call every ~30 ms. */
  tick(now = Date.now()) {
    if (!this.match) {
      if (this.startAt !== null) {
        if (this.queue.size >= MATCH_SLOTS || now >= this.startAt) this.start();
        else this.broadcastQueue();
      }
      return;
    }
    const m = this.match;
    if (!m.finished) {
      this.acc += Math.min(0.25, (now - (this.last || now)) / 1000);
      this.last = now;
      let steps = 0;
      while (this.acc >= DT && steps++ < 4) {
        m.tick();
        this.acc -= DT;
      }
      if (m.finished) this.endedAt = now;
      return;
    }
    if (now - this.endedAt > AFTER_MATCH_MS) {
      this.match = null;
      this.inMatch.clear();
      if (this.queue.size) this.startAt = Date.now() + this.countdownMs;
      this.broadcastQueue(true);
    }
  }
}
