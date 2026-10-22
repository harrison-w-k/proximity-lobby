// Plays one Animal Battle Royale match in the browser: input, prediction, camera, effects, voice.
import * as THREE from 'three';
import { ANIMAL_BY_ID, SIZE, SKILL_BY_ID, type AnimalDef, type StatKey, STAT_KEYS } from '../../../shared/arena/animals';
import { MOB_IDS } from '../../../shared/arena/mobs';
import { GULAG_R, GULAG_X, inGulagZone, medium, stepPos, MAP_BOUND, type Bound } from '../../../shared/arena/move';
import { FL, type Global, type MatchEvent, type QueueInfo, type RosterEntry, type ServerMatchMsg, type YouState } from '../../../shared/arena/proto';
import { WATER_Y } from '../../../shared/arena/terrain';
import { VOICE_MAX, VOICE_REF, type ServerMsg } from '../../../shared/protocol';
import type { Net } from '../net';
import type { Sfx } from '../sfx';
import type { Voice } from '../voice';
import type { World } from '../world';
import { Hud, itemLabel } from './hud';
import { ArenaScene } from './scene';

export interface ArenaDeps {
  world: World;
  net: Net;
  canvas: HTMLCanvasElement;
  sfx: Sfx;
  getVoice: () => Voice | null;
  /** typing in chat or the settings window is open: the game must not react to keys */
  isBlocked: () => boolean;
  openSettings: () => void;
  onExit: () => void;
  /** the match has started (the page hides its own click-to-resume) */
  onStart: () => void;
}

interface Cmd {
  s: number;
  dt: number;
  dx: number;
  dz: number;
  sprint: boolean;
  crouch: boolean;
}

const SKILL_COLORS: Record<string, number> = {
  howl: 0xffe27a, alpha_howl: 0xffe27a, roar: 0xff9a3a, earthshaker: 0xc9a066, tail_whip: 0x9acd32, musk_spray: 0xb067e0, splash: 0x6ec6ff,
  quill_burst: 0xf0e6c8, quill_storm: 0xf0e6c8, sw_rat: 0x8bbd4a, sw_bird: 0xffffff, sw_shoal: 0x5fa3c4, frenzy: 0xff5a3a,
};

const KEYS_SKILL: Record<string, number> = { KeyQ: 0, KeyE: 1, KeyR: 2, KeyF: 3 };

export class Arena {
  active = false;
  onQueue: (q: QueueInfo) => void = () => {};
  private hud = new Hud();
  private scene: ArenaScene | null = null;
  private myId = '';
  private myTeam = -1;
  private def: AnimalDef = ANIMAL_BY_ID.get('wolf')!;
  private roster = new Map<string, RosterEntry>();
  private you: YouState | null = null;
  private g: Global | null = null;
  private pos = { x: 0, z: 0 };
  private haveSnap = false;
  private camYaw = 0;
  private camPitch = 0.45;
  private zoom = 7.5;
  private keys = new Set<string>();
  private mouseDown = false;
  private panelOpen = false;
  private seq = 0;
  private acc = 0;
  private cur = { dx: 0, dz: 0, sprint: false, crouch: false };
  private pending: Cmd[] = [];
  private lastSend = 0;
  private lastYawSent = 0;
  private lastAtSent = 0;
  private clock = 0;
  private visYaw = 0;
  private attackUntil = 0;
  private nextSwing = 0;
  private stepAcc = 0;
  private hint = '';
  private hintAt = 0;
  private drops: [number, string, number, number, number][] = [];
  private pings: { x: number; z: number; until: number }[] = [];
  private lastRole = 0;
  private lastLvl = 1;
  private ended = false;
  private lastVoice = 0;
  private lavaSfx = 0;
  private camPos = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private snapAt = 0;
  private loading: HTMLElement | null = null;
  private prevHp = 0;

  constructor(private d: ArenaDeps) {
    this.hud.onStat = (k) => this.spend(k);
    this.hud.onPick = (t, o) => this.d.net.send({ t: 'mpick', i: t, o });
    this.hud.onSwarm = (k) => this.d.net.send({ t: 'mswarm', k: k as 'rat' | 'bird' | 'shoal' });
    this.hud.onResume = () => {
      this.hud.showPause(false);
      this.d.world.lock();
    };
    this.hud.onSettings = () => {
      this.hud.showPause(false);
      this.d.openSettings();
    };
    this.hud.onLeave = () => this.leave();
    this.hud.onBack = () => this.stop();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
    });
    document.addEventListener('mousedown', (e) => {
      if (this.active && e.button === 0 && this.hasControl()) this.mouseDown = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || !this.hasControl()) return;
      const k = 0.0022 * this.d.world.lookSensitivity;
      this.camYaw -= e.movementX * k;
      this.camPitch = Math.max(-0.25, Math.min(1.35, this.camPitch + e.movementY * k));
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || !this.hasControl()) return;
        e.preventDefault();
        this.zoom = Math.max(3.5, Math.min(16, this.zoom + Math.sign(e.deltaY) * 0.8));
      },
      { passive: false },
    );
  }

  private hasControl() {
    return document.pointerLockElement === this.d.canvas && !this.d.isBlocked() && !this.hud.pauseVisible && !this.hud.isEndVisible();
  }

  /** Called by the page when the mouse is released (Esc). */
  onPointerLockLost() {
    if (!this.active || this.ended || this.d.isBlocked()) return;
    this.mouseDown = false;
    this.keys.clear();
    this.hud.showPause(true);
  }

  // --- network ------------------------------------------------------------------------------------

  handle(m: ServerMsg): boolean {
    switch (m.t) {
      case 'mq':
        this.onQueue(m.q);
        return true;
      case 'mstart':
        this.start(m);
        return true;
      case 'mros':
        this.setRoster(m.r);
        return true;
      case 'snap':
        this.onSnap(m);
        return true;
      case 'mend':
        this.onEnd(m);
        return true;
    }
    return false;
  }

  private start(m: Extract<ServerMatchMsg, { t: 'mstart' }>) {
    if (this.active) this.teardown();
    this.myId = m.you;
    this.ended = false;
    const me = m.roster.find((r) => r.id === m.you);
    this.def = ANIMAL_BY_ID.get(me?.animal ?? 'wolf') ?? this.def;
    this.myTeam = me?.team ?? -1;
    this.roster = new Map(m.roster.map((r) => [r.id, r]));
    // the map takes a moment to build: say so first
    this.loading = document.createElement('div');
    this.loading.style.cssText = 'position:fixed;inset:0;z-index:30;display:flex;align-items:center;justify-content:center;background:#0b1630;color:#fff;font-family:var(--font-pixel);font-size:16px;text-transform:uppercase';
    this.loading.textContent = 'Generating the wilds…';
    document.body.append(this.loading);
    setTimeout(() => {
      try {
        this.scene = new ArenaScene(m.seed, MOB_IDS);
      } catch (err) {
        console.error('[arena] could not build the map', err);
        this.loading?.remove();
        this.d.net.send({ t: 'mleave' });
        return;
      }
      this.scene.setRoster(m.roster, this.myId);
      this.hud.setTerrain(this.scene.terrain);
      this.hud.show(true);
      this.hud.hideEnd();
      this.hud.showPause(true); // click to play: the mouse can only be captured from a click
      this.haveSnap = false;
      this.pending = [];
      this.seq = 0;
      this.acc = 0;
      this.lastLvl = 1;
      this.lastRole = 0;
      this.camYaw = 0;
      this.panelOpen = false;
      this.active = true;
      const w = this.d.world;
      w.inputEnabled = false;
      w.clearKeys();
      w.setRenderHeight(720);
      w.external = { update: (dt) => this.update(dt), render: (r) => this.render(r) };
      document.getElementById('crosshair')?.setAttribute('hidden', '');
      const v = this.d.getVoice();
      v?.setRange(10, 40);
      this.loading?.remove();
      this.loading = null;
      this.d.onStart();
      this.hud.announce(this.def.name.toUpperCase(), 'Scatter, farm the hordes and level up. The lava is coming.', 4200);
    }, 60);
  }

  private setRoster(r: RosterEntry[]) {
    this.roster = new Map(r.map((x) => [x.id, x]));
    this.scene?.setRoster(r, this.myId);
    const me = this.roster.get(this.myId);
    if (me) this.myTeam = me.team;
  }

  private onSnap(m: Extract<ServerMatchMsg, { t: 'snap' }>) {
    if (!this.scene) return;
    const you = m.you;
    this.you = you;
    this.g = m.g;
    this.snapAt = this.clock;
    this.drops = m.d;
    const sc = this.scene;
    sc.applyFighters(m.f, this.clock);
    sc.applyMobs(m.m, this.clock);
    sc.applyDrops(m.d, this.clock);
    const inLava = Math.hypot(this.pos.x, this.pos.z) > m.g.ring;
    sc.setRing(m.g.ring, m.g.ringTo, m.g.ringAt > 0 ? m.g.ringAt - m.g.time <= 30 : m.g.ringTo < m.g.ring - 1);
    void inLava;

    // reconcile our predicted position with the server's
    if (you.role === 3) {
      this.pos.x = you.x;
      this.pos.z = you.z;
    } else {
      this.pending = this.pending.filter((c) => c.s > m.ack);
      const r = { x: you.x, z: you.z };
      if (!you.noMove) {
        const bound = this.boundFor(r.x, r.z);
        const rad = this.radius();
        for (const c of this.pending) stepPos(sc.terrain, r, c.dx, c.dz, this.stepDist(you, c.dx, c.dz, c.sprint, c.crouch) * c.dt, rad, bound);
        if (this.acc > 0) stepPos(sc.terrain, r, this.cur.dx, this.cur.dz, this.stepDist(you, this.cur.dx, this.cur.dz, this.cur.sprint, this.cur.crouch) * this.acc, rad, bound);
      }
      const err = Math.hypot(r.x - this.pos.x, r.z - this.pos.z);
      if (!this.haveSnap || err > 3 || you.noMove) {
        this.pos.x = r.x;
        this.pos.z = r.z;
      } else if (err > 0.03) {
        this.pos.x += (r.x - this.pos.x) * 0.4;
        this.pos.z += (r.z - this.pos.z) * 0.4;
      }
      if (!this.haveSnap) {
        this.visYaw = this.camYaw = Math.atan2(-r.x, -r.z) + 0; // look toward the middle of the map
      }
    }
    this.haveSnap = true;

    // role and level changes
    if (you.role !== this.lastRole) {
      this.onRoleChange(this.lastRole, you.role);
      this.lastRole = you.role;
    }
    if (you.lvl > this.lastLvl && you.role === 0) {
      this.hud.announce(`LEVEL ${you.lvl}`, you.pts > 0 ? 'Press Tab to spend your stat point' : '', 1800);
      this.d.sfx.levelUp();
      this.scene.burst(this.pos.x, this.scene.groundY(this.pos.x, this.pos.z) + 1, this.pos.z, 0xffe27a, 18, 5, 0.9);
    }
    this.lastLvl = you.lvl;
    if (you.hp < this.prevHp - 0.5 && you.role !== 3) this.hud.flashHurt();
    this.prevHp = you.hp;
    for (const e of m.ev) this.onEvent(e);
  }

  private onRoleChange(from: number, to: number) {
    this.panelOpen = false;
    if (to === 1) {
      this.hud.announce('ELIMINATED', 'You are in the Gulag. Win the duel to lead a bigger swarm.', 4500);
      this.d.sfx.death();
    } else if (to === 2) {
      const sw = this.roster.get(this.myId)?.swarm;
      this.hud.announce('HORDE LEADER', `You command the ${sw === 'rat' ? 'Rat King' : sw === 'bird' ? 'Bird Swarm' : 'Shoal'}. Hunt the survivors — you cannot win, but you can change who does.`, 5000);
    } else if (to === 3) {
      this.hud.announce('THE FINAL FIGHT', 'Swarms disband. Watch the survivors.', 3500);
    }
    void from;
  }

  private who(id: string) {
    return this.roster.get(id)?.name ?? 'Something';
  }

  private onEvent(e: MatchEvent) {
    const sc = this.scene!;
    const g = this.g!;
    switch (e.k) {
      case 'hit': {
        const me = e.id === this.myId;
        sc.floater(e.x, sc.groundY(e.x, e.z) + 2.2, e.z, String(e.n), me ? '#ff6b5a' : '#ffffff', me ? 1.2 : 1);
        sc.burst(e.x, sc.groundY(e.x, e.z) + 1, e.z, 0xff4b3a, 5, 2.5, 0.35);
        const v = sc.fighter(e.id);
        if (v) v.hurt = 1;
        if (me) this.d.sfx.bite(true);
        else this.nearSfx(e.x, e.z, () => this.d.sfx.bite());
        break;
      }
      case 'mobhit':
        sc.floater(e.x, sc.groundY(e.x, e.z) + 1.4, e.z, String(e.n), '#ffe27a', 0.8);
        sc.burst(e.x, sc.groundY(e.x, e.z) + 0.6, e.z, 0xcc3322, 4, 2, 0.3);
        this.nearSfx(e.x, e.z, () => this.d.sfx.bite());
        break;
      case 'skill': {
        const sk = SKILL_BY_ID.get(e.s);
        const col = SKILL_COLORS[e.s] ?? 0xffffff;
        const fx = sk?.fx;
        const self = e.id === this.myId;
        if (fx?.k === 'aoe') sc.ringFx(e.x, e.z, fx.r, col, 0.7);
        else if (fx?.k === 'cone') sc.slash(e.x, e.z, e.yaw, fx.range, col);
        else if (fx?.k === 'dash') sc.burst(e.x, sc.groundY(e.x, e.z) + 0.6, e.z, 0xd8c8a0, 12, 3, 0.5);
        else if (fx?.k === 'buff') sc.burst(e.x, sc.groundY(e.x, e.z) + 1, e.z, 0xffd23f, 10, 3, 0.7);
        else if (fx?.k === 'heal') sc.burst(e.x, sc.groundY(e.x, e.z) + 1, e.z, 0x6af06a, 12, 3, 0.8);
        else if (fx?.k === 'submerge') sc.burst(e.x, WATER_Y, e.z, 0x6ec6ff, 14, 3, 0.7);
        else if (e.s.startsWith('sw_')) sc.ringFx(e.x, e.z, e.r ?? 10, col, 0.9);
        else if (e.s === 'frenzy') sc.ringFx(e.x, e.z, 6, col, 0.7);
        if (e.s === 'howl' || e.s === 'alpha_howl') this.nearSfx(e.x, e.z, () => this.d.sfx.howl(), 60);
        else if (e.s === 'roar' || e.s === 'earthshaker') this.nearSfx(e.x, e.z, () => this.d.sfx.roar(), 40);
        else if (fx?.k === 'dash') this.nearSfx(e.x, e.z, () => this.d.sfx.whoosh());
        else if (self) this.d.sfx.swing();
        break;
      }
      case 'kill': {
        const killer = e.killer ? this.who(e.killer) : e.how === 'lava' ? 'The lava' : 'The wild';
        this.hud.feedLine(`${killer} ▸ ${this.who(e.victim)}`, e.killer === this.myId || e.victim === this.myId);
        break;
      }
      case 'level':
        break;
      case 'phase':
        if (e.n > 0) this.hud.announce(e.name.toUpperCase(), ['', 'Mid-tier hordes arrive. First contact.', 'The Alpha is coming. Top levels are hunted.', 'Most players are down. The lava speeds up.', 'The final island.'][e.n] ?? '', 3200);
        break;
      case 'ringwarn':
        this.hud.announce(`LAVA RING ${e.n}`, `The lava closes in ${Math.round(e.in)} seconds. Move inside the white line!`, 4200);
        this.d.sfx.siren();
        break;
      case 'ring':
        this.hud.announce('THE LAVA IS CLOSING', '', 2400);
        break;
      case 'roar':
        this.pings.push({ x: e.x, z: e.z, until: this.clock + 6 });
        this.hud.feedLine(`🎯 ${this.who(e.id)} roars — position revealed!`, e.id === this.myId);
        this.d.sfx.roar();
        break;
      case 'migration':
        this.hud.announce('STAMPEDE!', 'The herds charge the centre. Get out of their way.', 4000);
        break;
      case 'alpha':
        this.pings.push({ x: e.x, z: e.z, until: this.clock + 12 });
        this.hud.announce('THE ALPHA APPEARS', 'Jackpot XP waits at the centre.', 3600);
        this.d.sfx.roar();
        break;
      case 'node':
        sc.setNode(e.id, e.until, g.time);
        break;
      case 'toast':
        if (!e.to || e.to === this.myId) {
          if (e.to) this.hud.feedLine(e.text, true);
          else this.hud.announce(e.text, '', 2400);
        }
        break;
      case 'disband':
        this.hud.announce('SWARMS DISBAND', 'A clean fight to the finish.', 3000);
        break;
      case 'proj':
        sc.projectile(e.id, e.x, e.z, e.tx, e.tz, e.kind.includes('quill') ? 0xf0e6c8 : 0xbbbbbb);
        break;
      case 'lure':
        sc.lureAt(e.x, e.z);
        break;
      case 'gulag':
        if (e.id === this.myId) this.hud.announce(e.winner ? 'DUEL WON' : 'DUEL LOST', e.winner ? 'You lead a Tier II swarm.' : 'You lead a Tier I swarm.', 3000);
        break;
    }
  }

  /** Play a sound only if it happened close enough to hear. */
  private nearSfx(x: number, z: number, f: () => void, range = 35) {
    if (Math.hypot(x - this.pos.x, z - this.pos.z) < range) f();
  }

  private onEnd(m: Extract<ServerMatchMsg, { t: 'mend' }>) {
    this.ended = true;
    this.mouseDown = false;
    document.exitPointerLock();
    this.hud.showPause(false);
    this.hud.showEnd(m, this.myId, this.myTeam);
    if (m.team === this.myTeam) this.d.sfx.win();
  }

  // --- leaving ---------------------------------------------------------------------------------------

  private leave() {
    this.d.net.send({ t: 'mleave' });
    this.stop();
  }

  private teardown() {
    const w = this.d.world;
    w.external = undefined;
    w.inputEnabled = true;
    w.setRenderHeight(480);
    this.hud.show(false);
    this.hud.hideEnd();
    this.hud.showPause(false);
    this.scene?.dispose();
    this.scene = null;
    this.active = false;
    const v = this.d.getVoice();
    v?.setRange(VOICE_REF, VOICE_MAX);
    for (const id of this.roster.keys()) {
      v?.setPeerRange(id, VOICE_REF, VOICE_MAX);
      v?.setPeerGate(id, true);
      v?.setPeerMuffle(id, 0);
    }
  }

  stop() {
    if (!this.active && !this.scene) return;
    this.teardown();
    document.getElementById('crosshair')?.removeAttribute('hidden');
    this.d.onExit();
  }

  // --- input ---------------------------------------------------------------------------------------

  private onKeyDown = (e: KeyboardEvent) => {
    if (!this.active || e.repeat) {
      if (this.active && e.code === 'Tab') e.preventDefault();
      if (this.active && this.hasControl() && e.repeat) return;
      if (!this.active) return;
    }
    if (this.d.isBlocked()) return;
    if (e.code === 'Tab') {
      e.preventDefault();
      this.panelOpen = !this.panelOpen;
      return;
    }
    if (!this.hasControl()) return;
    this.keys.add(e.code);
    const you = this.you;
    if (!you || e.ctrlKey || e.metaKey) return;
    const role = you.role;
    if (role === 0 && this.panelOpen) {
      const n = Number(e.code.replace('Digit', ''));
      if (n >= 1 && n <= 5) {
        this.spend(STAT_KEYS[n - 1]);
        return;
      }
      if (e.code === 'KeyZ' || e.code === 'KeyX') {
        const opt = e.code === 'KeyZ' ? 0 : 1;
        const tier = [0, 1, 2, 3].find((t) => you.picks[t] === -1 && you.lvl >= [3, 7, 12, 18][t]);
        if (tier !== undefined) this.d.net.send({ t: 'mpick', i: tier, o: opt });
        return;
      }
    }
    if (e.code in KEYS_SKILL) {
      if (role === 2) {
        if (KEYS_SKILL[e.code] === 0) this.d.net.send({ t: 'mcmd', c: 'skill', yaw: this.aimYaw(30) });
        else if (KEYS_SKILL[e.code] === 1) this.d.net.send({ t: 'mcmd', c: 'frenzy' });
        else if (e.code === 'KeyF') this.d.net.send({ t: 'mact', a: 'loot' });
      } else if (role === 0 || role === 1) {
        this.d.net.send({ t: 'mskill', i: KEYS_SKILL[e.code], yaw: this.aimYaw(role === 0 ? 14 : 14) });
      }
      return;
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (role === 0 && n >= 1 && n <= 6) this.d.net.send({ t: 'muse', i: n - 1 });
      else if (role === 2 && n >= 1 && n <= 3) this.d.net.send({ t: 'mcmd', c: (['attack', 'scatter', 'guard'] as const)[n - 1], yaw: this.camYaw });
      else if (role === 1 && n >= 1 && n <= 2) {
        const k = you.gulag?.choose[n - 1];
        if (k) this.d.net.send({ t: 'mswarm', k });
      }
      return;
    }
    if (e.code === 'KeyX' && role === 0) this.d.net.send({ t: 'mact', a: 'harvest' });
    else if (e.code === 'KeyG' && (role === 0 || role === 2)) this.d.net.send({ t: 'mact', a: 'loot' });
    else if (e.code === 'KeyV' && role === 0) this.d.net.send({ t: 'mact', a: 'drink' });
    else if (e.code === 'KeyH' && role === 0) this.d.net.send({ t: 'mact', a: 'drop', i: 0 });
  };

  private spend(k: StatKey) {
    this.d.net.send({ t: 'mstat', k });
  }

  /** Aim toward the animal nearest the crosshair so third-person fighting is forgiving. */
  private aimYaw(maxDist: number): number {
    const sc = this.scene;
    if (!sc) return this.camYaw;
    let best = this.camYaw;
    let bs = Infinity;
    for (const t of sc.aimTargets(this.myTeam)) {
      const dx = t.x - this.pos.x;
      const dz = t.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > maxDist || d < 0.1) continue;
      let a = Math.atan2(dx, dz) - this.camYaw;
      while (a > Math.PI) a -= Math.PI * 2;
      while (a < -Math.PI) a += Math.PI * 2;
      if (Math.abs(a) > 0.5) continue;
      const score = Math.abs(a) * 4 + d * 0.05 - (t.foe ? 0.3 : 0);
      if (score < bs) {
        bs = score;
        best = Math.atan2(dx, dz);
      }
    }
    return best;
  }

  private boundFor(x: number, z: number): Bound {
    if (!inGulagZone(x)) return MAP_BOUND;
    if (x < GULAG_X - 40) return { cx: GULAG_X - 70, cz: 0, r: 19 };
    const slot = Math.max(0, Math.min(3, Math.round((z + 120) / 80)));
    return { cx: GULAG_X, cz: -120 + slot * 80, r: GULAG_R };
  }

  private radius() {
    if (this.you?.role === 2) return 0.4;
    return SIZE[this.def.size].radius;
  }

  private stepDist(you: YouState, dx: number, dz: number, sprint: boolean, crouch: boolean) {
    const moving = Math.hypot(dx, dz) > 0.05;
    let s = you.speed;
    const med = medium(this.scene!.terrain, this.pos.x, this.pos.z, false, 0);
    if (sprint && moving && !med.noSprint && you.sta > 1 && you.role !== 2) s *= 1.45;
    if (crouch) s *= 0.6;
    return s;
  }

  private readInput() {
    if (!this.hasControl() || this.you?.role === 3) return { dx: 0, dz: 0, sprint: false, crouch: false, at: false };
    const k = this.keys;
    const f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const sy = Math.sin(this.camYaw);
    const cy = Math.cos(this.camYaw);
    let dx = sy * f - cy * r;
    let dz = cy * f + sy * r;
    const l = Math.hypot(dx, dz);
    if (l > 1) {
      dx /= l;
      dz /= l;
    }
    return { dx, dz, sprint: k.has('ShiftLeft') || k.has('ShiftRight'), crouch: k.has('KeyC') || k.has('ControlLeft'), at: this.mouseDown };
  }

  // --- the frame -------------------------------------------------------------------------------------

  private update(dt: number) {
    const sc = this.scene;
    if (!sc) return;
    this.clock += dt;
    const you = this.you;
    const g = this.g;
    const inp = this.readInput();

    if (you && g && this.haveSnap) {
      if (you.role !== 3) this.moveAndSend(dt, inp, you);
      else {
        // spectating: follow the animal the server shows us
        const v = you.view ? sc.fighter(you.view) : undefined;
        if (v) {
          this.pos.x = v.x;
          this.pos.z = v.z;
        }
      }
      // our own animal
      const self = sc.fighter(this.myId);
      const moving = Math.hypot(inp.dx, inp.dz) > 0.05;
      if (self && you.role !== 3) {
        if (inp.at && this.clock > this.nextSwing) {
          this.nextSwing = this.clock + 0.62;
          this.attackUntil = this.clock + 0.3;
          this.d.sfx.swing();
        }
        let flags = 0;
        if (this.clock < this.attackUntil) flags |= FL.atk;
        if (g.top.some(([id]) => id === this.myId)) flags |= FL.hunted;
        if (you.buffs.includes('stunned')) flags |= FL.stun;
        if (inp.at) this.visYaw = this.aimYaw(you.role === 0 ? 8 : 6);
        else if (moving) this.visYaw = Math.atan2(inp.dx, inp.dz);
        sc.setSelf(this.pos.x, this.pos.z, this.visYaw, (you.hp / you.maxHp) * 100, you.lvl, flags, moving ? you.speed : 0);
        // sneaking in a bush or underwater: show it
        self.group.visible = true;
      }
      // sounds underfoot
      if (moving && you.role !== 3) this.footsteps(dt, inp.sprint);
      // lava
      const burning = Math.hypot(this.pos.x, this.pos.z) > g.ring && you.role !== 1 && you.role !== 3;
      this.hud.setLava(burning);
      if (burning && this.clock > this.lavaSfx) {
        this.lavaSfx = this.clock + 0.5;
        this.d.sfx.lava();
      }
      sc.gulagLook = inGulagZone(this.pos.x);
    }

    this.updateCamera(dt);
    sc.update(dt, this.myTeam, g?.time ?? 0);

    if (you && g) {
      if (this.clock - this.hintAt > 0.15) {
        this.hintAt = this.clock;
        this.hint = this.computeHint(you);
      }
      this.hud.render({ you, g, def: this.def, roster: this.roster, myId: this.myId, now: this.clock, hint: this.hint, panelOpen: this.panelOpen });
      this.pings = this.pings.filter((p) => p.until > this.clock);
      this.hud.drawMap({ x: this.pos.x, z: this.pos.z, yaw: this.camYaw }, g, this.blips(you));
      if (this.clock - this.lastVoice > 0.1) {
        this.lastVoice = this.clock;
        this.updateVoice(you);
      }
    }
  }

  private moveAndSend(dt: number, inp: { dx: number; dz: number; sprint: boolean; crouch: boolean; at: boolean }, you: YouState) {
    const sc = this.scene!;
    // predicted movement this frame
    if (!you.noMove) {
      const bound = this.boundFor(this.pos.x, this.pos.z);
      stepPos(sc.terrain, this.pos, inp.dx, inp.dz, this.stepDist(you, inp.dx, inp.dz, inp.sprint, inp.crouch) * dt, this.radius(), bound);
    }
    // timed steps for the server: a change of input closes the current one
    const same = inp.dx === this.cur.dx && inp.dz === this.cur.dz && inp.sprint === this.cur.sprint && inp.crouch === this.cur.crouch;
    if (!same && this.acc > 0) this.flush();
    this.cur = { dx: inp.dx, dz: inp.dz, sprint: inp.sprint, crouch: inp.crouch };
    this.acc += dt;
    const now = performance.now();
    if (this.acc >= 0.033) this.flush(inp.at);
    else if (now - this.lastSend > 100 || inp.at !== !!this.lastAtSent || Math.abs(this.camYaw - this.lastYawSent) > 0.04) {
      // nothing to step, but the server still wants the camera direction and attack button
      if (now - this.lastSend > 40) this.flush(inp.at);
    }
  }

  private flush(at = this.mouseDown) {
    const you = this.you;
    const dtMs = Math.min(100, this.acc * 1000);
    this.seq++;
    const aim = at ? this.aimYaw(this.you?.role === 0 ? 8 : 6) : this.camYaw;
    const c = this.cur;
    if (dtMs > 0.5 && !(you?.noMove)) this.pending.push({ s: this.seq, dt: dtMs / 1000, dx: c.dx, dz: c.dz, sprint: c.sprint, crouch: c.crouch });
    else if (dtMs > 0.5) this.pending.push({ s: this.seq, dt: 0, dx: 0, dz: 0, sprint: false, crouch: false });
    if (this.pending.length > 40) this.pending.shift();
    this.d.net.send({ t: 'min', s: this.seq, dt: Math.round(dtMs * 10) / 10, x: Math.round(c.dx * 100) / 100, z: Math.round(c.dz * 100) / 100, yaw: Math.round(aim * 1000) / 1000, sp: c.sprint ? 1 : 0, cr: c.crouch ? 1 : 0, at: at ? 1 : 0 });
    this.acc = 0;
    this.lastSend = performance.now();
    this.lastYawSent = this.camYaw;
    this.lastAtSent = at ? 1 : 0;
  }

  private footsteps(dt: number, sprint: boolean) {
    const sc = this.scene!;
    this.stepAcc += (this.you?.speed ?? 6) * (sprint ? 1.45 : 1) * dt;
    if (this.stepAcc < 2.1) return;
    this.stepAcc = 0;
    const h = sc.terrain.heightAt(this.pos.x, this.pos.z);
    const surface = inGulagZone(this.pos.x) ? 'block' : h < WATER_Y - 0.1 ? 'water' : h < WATER_Y + 0.6 ? 'sand' : sc.terrain.biomeAt(this.pos.x, this.pos.z) === 3 ? 'block' : 'grass';
    this.d.sfx.step(surface, (this.def.size === 'large' ? 1.2 : this.def.size === 'small' ? 0.6 : 0.9) * (this.hasCrouch() ? 0.4 : 1));
  }
  private hasCrouch() {
    return this.keys.has('KeyC') || this.keys.has('ControlLeft');
  }

  private updateCamera(dt: number) {
    const sc = this.scene!;
    const cam = sc.camera;
    const rend = this.d.world.renderer;
    const size = rend.getSize(new THREE.Vector2());
    cam.aspect = size.x / Math.max(1, size.y);
    cam.updateProjectionMatrix();
    const gy = sc.groundY(this.pos.x, this.pos.z);
    const self = sc.fighter(this.myId);
    const height = Math.min(2.4, (self?.rig.height ?? 1.6) * 0.62) + 0.35;
    const tx = this.pos.x;
    const tz = this.pos.z;
    const ty = gy + height - (this.you && sc.terrain.depthAt(tx, tz) > 0.4 ? 0.3 : 0);
    const sizeK = this.you?.role === 2 ? 0.7 : this.def.size === 'large' ? 1.35 : this.def.size === 'small' ? 0.8 : 1;
    const dist = this.zoom * sizeK;
    const cp = Math.cos(this.camPitch);
    const sp = Math.sin(this.camPitch);
    const sy = Math.sin(this.camYaw);
    const cy = Math.cos(this.camYaw);
    // over the shoulder: shift toward the right
    const shoulder = 0.9 * sizeK;
    const rx = -cy;
    const rz = sy;
    let px = tx - sy * cp * dist + rx * shoulder;
    let pz = tz - cy * cp * dist + rz * shoulder;
    let py = ty + sp * dist + 0.4;
    // never go through the ground
    const floor = sc.groundY(px, pz) + 0.55;
    if (py < floor) py = floor;
    void px;
    void pz;
    this.camPos.set(px, py, pz);
    const k = 1 - Math.exp(-dt * 22);
    cam.position.lerp(this.camPos, cam.position.distanceTo(this.camPos) > 8 ? 1 : k);
    this.lookAt.set(tx + rx * shoulder * 0.9 + sy * 6, ty + 0.1 - sp * 0.5, tz + rz * shoulder * 0.9 + cy * 6);
    cam.lookAt(this.lookAt);
    px = 0;
    pz = 0;
  }

  private render(r: THREE.WebGLRenderer) {
    if (this.scene) r.render(this.scene.scene, this.scene.camera);
  }

  // --- hints, map, voice -----------------------------------------------------------------------------

  private computeHint(you: YouState): string {
    const sc = this.scene!;
    if (you.role === 2 || you.role === 3 || you.role === 1) {
      if (you.role === 2) {
        const d = this.drops.find((x) => Math.hypot(x[2] - this.pos.x, x[3] - this.pos.z) < 3.2);
        return d ? '[G] Eat' : '';
      }
      return '';
    }
    const drop = this.drops.find((x) => Math.hypot(x[2] - this.pos.x, x[3] - this.pos.z) < 3.2);
    if (drop) return `[G] Pick up ${drop[1] === 'pile' ? 'loot pile' : itemLabel(drop[1])}`;
    let best = '';
    let bd = 3.4;
    const NAMES: Record<string, string> = { berry: 'berries', fruit: 'fruit', herb: 'herbs', mud: 'mud', hive: 'honeycomb', reed: 'a reed' };
    for (const r of sc.terrain.near(this.pos.x, this.pos.z, 3.6)) {
      if (!(r.kind in NAMES)) continue;
      if ((sc.nodeTimes.get(r.id) ?? 0) > (this.g?.time ?? 0)) continue;
      const d = Math.hypot(r.x - this.pos.x, r.z - this.pos.z);
      if (d < bd) {
        bd = d;
        best = `[X] Harvest ${NAMES[r.kind]}`;
      }
    }
    if (best) return best;
    const water = sc.terrain.depthAt(this.pos.x, this.pos.z) > 0.12;
    const pouch = you.inv.find((i) => i?.k === 'water');
    if (water && (!pouch || pouch.n < 2)) return '[V] Fill your water pouch';
    return '';
  }

  private blips(you: YouState) {
    const sc = this.scene!;
    const out: { x: number; z: number; kind: 'foe' | 'friend' | 'mob' | 'alpha' | 'ping' | 'big' }[] = [];
    const sense = you.sense;
    for (const v of sc.allFighters()) {
      if (v.self || !v.group.visible) continue;
      const d = Math.hypot(v.x - this.pos.x, v.z - this.pos.z);
      if (v.team === this.myTeam) out.push({ x: v.x, z: v.z, kind: 'friend' });
      else if (d < sense) out.push({ x: v.x, z: v.z, kind: 'foe' });
    }
    for (const [x, z, big] of sc.mobBlips()) {
      const d = Math.hypot(x - this.pos.x, z - this.pos.z);
      if (big === 2) out.push({ x, z, kind: 'alpha' });
      else if (d < sense * 0.75) out.push({ x, z, kind: big ? 'big' : 'mob' });
    }
    for (const p of this.pings) out.push({ x: p.x, z: p.z, kind: 'ping' });
    return out;
  }

  private updateVoice(you: YouState) {
    const v = this.d.getVoice();
    const sc = this.scene;
    if (!v || !sc) return;
    const cam = sc.camera;
    const f = new THREE.Vector3();
    cam.getWorldDirection(f);
    const gy = sc.groundY(this.pos.x, this.pos.z);
    v.updateListener(this.pos.x, gy + 1.2, this.pos.z, f.x, f.y, f.z);
    const myDead = you.role === 1 || you.role === 3;
    const inWater = sc.terrain.depthAt(this.pos.x, this.pos.z) > 0.6;
    for (const [id, r] of this.roster) {
      if (id === this.myId || r.bot) continue;
      const fv = sc.fighter(id);
      const visible = !!fv && fv.group.visible;
      const theirDead = (fv?.role ?? r.role) === 1 || (fv?.role ?? r.role) === 3;
      if (!fv || !visible) {
        v.setPeerPosition(id, 1e5, 0, 1e5);
        sc.setSpeaking(id, false);
        continue;
      }
      v.setPeerPosition(id, fv.x, sc.groundY(fv.x, fv.z) + 1.2, fv.z);
      // Gulag chat is its own channel, and the living cannot be overheard by the dead
      v.setPeerGate(id, myDead === theirDead);
      const crouch = (fv.flags & FL.crouch) !== 0;
      if (fv.role === 2) v.setPeerRange(id, 4, 15);
      else if (crouch) v.setPeerRange(id, 5, 20);
      else v.setPeerRange(id, 10, 40);
      const wet = inWater || sc.terrain.depthAt(fv.x, fv.z) > 0.6;
      const blocked = !inGulagZone(this.pos.x) && sc.terrain.blocked(this.pos.x, this.pos.z, fv.x, fv.z);
      v.setPeerMuffle(id, wet ? 0.85 : blocked ? 0.6 : 0);
      sc.setSpeaking(id, v.speaking.has(id));
    }
  }
}

