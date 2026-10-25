// Runs the queue and the current match for a host. The lobby feeds it client messages and calls
// tick() from its timer; it talks back through `send`.
import { ANIMALS, STARTERS } from './animals';
import { DT, Match, type Entrant } from './match';
import { isSpawnId, type SpawnId } from './spawn';
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
  spawn: SpawnId;
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
  /** The campus: the lobby as a permanent match nobody can die in. */
  campus: Match | null = null;
  /** The sandbox room: any animal of any stage can be chosen, you can be hurt, and there is no queue for matches. */
  sandbox = false;
  private inCampus = new Set<string>();
  private campusAcc = 0;
  private campusLast = 0;
  /** What each player last asked to be, so walking back into the campus is automatic. */
  private profiles = new Map<string, { animal: string }>();
  /** Fill the empty slots with AI so there are always 20 animals. */
  fillWithBots = true;
  /** Seconds a match waits for more players after the first one queues. */
  countdownMs = COUNTDOWN_MS;

  constructor(private host: DirectorHost) {}

  /** Something is waiting or running, so the host must keep calling tick(). */
  busy(): boolean {
    return this.queue.size > 0 || this.match !== null || this.startAt !== null || this.inCampus.size > 0;
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

  /** Walk a player into the campus (starting a campus if there is none). */
  enterCampus(id: string, animal?: string) {
    if (this.inMatch.has(id) && this.match && !this.match.finished) return;
    const prev = this.profiles.get(id);
    const a = ANIMALS.find((x) => x.id === animal) ?? ANIMALS.find((x) => x.id === prev?.animal) ?? STARTERS[0]; // the lobby lets you roam as any animal
    this.profiles.set(id, { animal: a.id });
    const name = this.host.players().find((x) => x.id === id)?.name;
    if (!name) return;
    if (!this.campus) {
      // the lobby is real players only; the sandbox has a few sparring partners that fight back (all on one team)
      const bots: Entrant[] = [];
      const used = new Set<string>();
      for (let n = 0; this.sandbox && n < 3; n++) {
        let nm = BOT_NAMES[(n * 3) % BOT_NAMES.length];
        while (used.has(nm)) nm += '_';
        used.add(nm);
        bots.push({ id: `cbot${n}`, name: nm, animal: ANIMALS[(n * 23 + 11) % ANIMALS.length].id, team: 0, bot: true });
      }
      this.campus = new Match(424242, bots, { send: (pid, msg) => this.host.send(pid, msg) }, { campus: true, island: true, pvp: this.sandbox });
      this.campusAcc = 0;
      this.campusLast = Date.now();
    }
    this.campus.addPlayer({ id, name, animal: a.id, team: 0, bot: false });
    this.inCampus.add(id);
    this.host.send(id, this.campus.startMsg(id));
    this.host.send(id, { t: 'mq', q: this.info(id) });
  }

  private leaveCampus(id: string) {
    if (!this.inCampus.delete(id)) return;
    this.campus?.removePlayer(id);
    if (this.inCampus.size === 0) this.campus = null; // nobody left: let it go
  }

  join(id: string, animal: string, team?: string, spawn?: string) {
    if (this.sandbox) return; // the sandbox has no matches
    if (this.inMatch.has(id) && this.match && !this.match.finished) return;
    const a = STARTERS.find((x) => x.id === animal); // everyone starts as a stage 1 animal
    if (!a) return;
    if (!this.queue.has(id) && this.queue.size >= MATCH_SLOTS) return;
    this.profiles.set(id, { animal: a.id });
    this.queue.set(id, { animal: a.id, team: (team ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 12), spawn: isSpawnId(spawn) ? spawn : 'any' });
    if (this.startAt === null && !(this.match && !this.match.finished)) this.startAt = Date.now() + this.countdownMs;
    this.broadcastQueue(true);
  }

  leave(id: string) {
    this.leaveCampus(id);
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
      case 'menter':
        if (typeof msg.animal === 'string') this.enterCampus(id, msg.animal);
        break;
      case 'mq':
        if (typeof msg.animal === 'string') this.join(id, msg.animal, typeof msg.team === 'string' ? msg.team : '', msg.spawn);
        break;
      case 'mqx':
        this.leave(id);
        this.host.send(id, { t: 'mq', q: this.info(id) });
        break;
      case 'mleave': {
        // leaving a match (or its end screen) puts you back in the campus
        this.leave(id);
        this.enterCampus(id);
        break;
      }
      default:
        if (this.inMatch.has(id)) this.match?.handle(id, msg);
        else if (this.inCampus.has(id)) this.campus?.handle(id, msg);
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
      entrants.push({ id, name: names.get(id)!, animal: q.animal, team, bot: false, spawn: q.spawn });
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
        entrants.push({ id: `bot${n++}`, name, animal: STARTERS[Math.floor(Math.random() * STARTERS.length)].id, team: nextTeam++, bot: true });
      }
    }
    const seed = (Math.random() * 0x7fffffff) | 0;
    for (const e of entrants) if (!e.bot) this.leaveCampus(e.id);
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
    if (this.campus) {
      this.campusAcc += Math.min(0.25, (now - (this.campusLast || now)) / 1000);
      this.campusLast = now;
      let steps = 0;
      while (this.campusAcc >= DT && steps++ < 4) {
        this.campus.tick();
        this.campusAcc -= DT;
      }
    }
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
