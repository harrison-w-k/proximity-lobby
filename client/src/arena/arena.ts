// Plays one Animal Battle Royale match in the browser: input, prediction, camera, effects, voice.
import * as THREE from 'three';
import { ANIMAL_BY_ID, SIZE, SKILL_BY_ID, type AnimalDef, type StatKey, STAT_KEYS } from '../../../shared/arena/animals';
import { MOB_IDS } from '../../../shared/arena/mobs';
import { COMBO, COMBO_RESET, PARRY_WINDOW } from '../../../shared/arena/combat';
import { JUMP_COST, JUMP_V, medium, stepPos, stepVertical, MAP_BOUND, type Bound } from '../../../shared/arena/move';
import { FL, type Global, type MatchEvent, type QueueInfo, type RosterEntry, type ServerMatchMsg, type YouState } from '../../../shared/arena/proto';
import { WATER_Y } from '../../../shared/arena/terrain';
import { VOICE_MAX, VOICE_REF, type ServerMsg } from '../../../shared/protocol';
import type { Net } from '../net';
import type { Sfx } from '../sfx';
import type { Voice } from '../voice';
import type { World } from '../world';
import { Doll } from './doll';
import { Hud, itemLabel } from './hud';
import { ArenaScene } from './scene';
import { ANIMAL_EMOJI } from './emoji';
import { SPAWN_CHOICES } from '../../../shared/arena/spawn';

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
  onStart: (campus: boolean) => void;
}

interface Cmd {
  s: number;
  dt: number;
  dx: number;
  dz: number;
  sprint: boolean;
  crouch: boolean;
  jump: boolean;
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
  private doll = new Doll();
  private scene: ArenaScene | null = null;
  private myId = '';
  private myTeam = -1;
  private def: AnimalDef = ANIMAL_BY_ID.get('wolf')!;
  private roster = new Map<string, RosterEntry>();
  private you: YouState | null = null;
  private g: Global | null = null;
  private pos = { x: 0, z: 0, jy: 0, jv: 0 }; // jy / jv: the jump, predicted like the walk
  private haveSnap = false;
  private camYaw = 0;
  private camPitch = 0.42;
  private zoom = 5.8;
  private keys = new Set<string>();
  private mouseDown = false;
  private panelOpen = false;
  private freeCursor = false; // Left Alt: the mouse is released so you can click the panels
  private panelBeforeAlt = false;
  private jumpQueued = false;
  private shiftAt = 0; // a quick tap of Shift is a dash; holding it is a sprint
  private guardHeld = false; // a parry is up (it runs its course; releasing the button does nothing)
  private guardEnds = 0;
  private shake = 0;
  private hitstop = 0;
  private slowmo = 0;
  private fovNow = 62;
  private localCombo = 0;
  private localComboAt = -9;
  private localSwingAt = -9;
  private lastXp = 0;
  private wasAir = false;
  private seq = 0;
  private acc = 0;
  private cur = { dx: 0, dz: 0, sprint: false, crouch: false, jump: false };
  private pending: Cmd[] = [];
  private lastSend = 0;
  private lastYawSent = 0;
  private lastAtSent = 0;
  private clock = 0;
  private visYaw = 0;
  private corr = { x: 0, z: 0 }; // a server correction, eased out over a few frames instead of snapping
  private ty = NaN; // smoothed camera height target
  private spdSm = 0;
  private lookSm = new THREE.Vector3();
  private attackUntil = 0;
  private nextSwing = 0;
  private stepAcc = 0;
  private hint = '';
  private hintAt = 0;
  private drops: [number, string, number, number, number][] = [];
  private pings: { x: number; z: number; until: number }[] = [];
  private lastRole = 0;
  /** The lobby is a campus: a match nobody can die in. */
  campus = false;
  private seedNow = -1;
  private queueInfo: QueueInfo | null = null;
  private lastLvl = 1;
  private lastEvolve = 0;
  private droppedIn = false;
  private camFrac = 1;
  private lastZone = '';
  private shownZone = '';
  private zoneSince = 0;
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
    this.hud.onEvolve = (to) => this.d.net.send({ t: 'mevolve', to });
    this.hud.onResume = () => {
      if (!this.droppedIn && this.scene) {
        this.droppedIn = true;
        this.scene.dropIn();
      }
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
    document.addEventListener('pointerlockchange', () => {
      // clicking back into the game (or Alt again) captures the mouse: leave cursor mode
      if (this.active && document.pointerLockElement === this.d.canvas && this.freeCursor) this.setFreeCursor(false);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && this.active && performance.now() - this.shiftAt < 200 && this.hasControl() && this.you && this.you.role !== 3) this.dash();
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.mouseDown = false;
      this.setGuard(false);
    });
    document.addEventListener('mousedown', (e) => {
      if (!this.active || !this.hasMouse()) return;
      if (e.button === 0) this.mouseDown = true;
      else if (e.button === 2) this.setGuard(true);
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      else if (e.button === 2) this.setGuard(false);
    });
    document.addEventListener('contextmenu', (e) => {
      if (this.active) e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.active || !this.hasMouse()) return;
      const k = 0.0022 * this.d.world.lookSensitivity;
      this.camYaw -= e.movementX * k;
      this.camPitch = Math.max(-0.25, Math.min(1.35, this.camPitch + e.movementY * k));
    });
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.active || !this.hasMouse()) return;
        e.preventDefault();
        this.zoom = Math.max(3.5, Math.min(16, this.zoom + Math.sign(e.deltaY) * 0.8));
      },
      { passive: false },
    );
  }

  /** Keys work while the mouse is captured, or while Left Alt has released it. */
  private hasControl() {
    return (document.pointerLockElement === this.d.canvas || this.freeCursor) && !this.d.isBlocked() && !this.hud.pauseVisible && !this.hud.isEndVisible();
  }

  /** Mouse look, attacking and zoom only work while the mouse is captured. */
  private hasMouse() {
    return document.pointerLockElement === this.d.canvas && this.hasControl();
  }

  /** Tap right mouse to parry: the guard stays up about half a second. A hit inside it is parried; a miss leaves you fumbling. */
  private setGuard(on: boolean) {
    if (!on || this.guardHeld) return; // letting go changes nothing
    const you = this.you;
    if (!you || you.role === 3 || you.parryCd > 0 || you.buffs.includes('fumbled') || you.buffs.includes('stunned')) return;
    this.guardHeld = true;
    this.guardEnds = this.clock + you.parryWin + 0.2;
    this.d.net.send({ t: 'mguard', on: 1 });
  }

  private dash() {
    if (this.you?.buffs.includes('fumbled')) return; // fumbling: walking only
    const inp = this.readInput();
    this.d.net.send({ t: 'mdash', x: Math.round(inp.dx * 100) / 100, z: Math.round(inp.dz * 100) / 100 });
  }

  private setFreeCursor(on: boolean) {
    if (on === this.freeCursor) return;
    this.freeCursor = on;
    this.mouseDown = false;
    this.setGuard(false);
    this.hud.setCursorMode(on);
    if (on) {
      // show the upgrade panel so there is something to click
      this.panelBeforeAlt = this.panelOpen;
      if (this.you?.role === 0) this.panelOpen = true;
      document.exitPointerLock();
    } else {
      this.panelOpen = this.panelBeforeAlt;
      if (document.pointerLockElement !== this.d.canvas) this.d.world.lock();
    }
  }

  /** Called by the page when the mouse is released (Esc). */
  onPointerLockLost() {
    if (!this.active || this.ended || this.d.isBlocked() || this.freeCursor) return;
    this.mouseDown = false;
    this.setGuard(false);
    this.keys.clear();
    this.hud.showPause(true);
  }

  // --- network ------------------------------------------------------------------------------------

  handle(m: ServerMsg): boolean {
    switch (m.t) {
      case 'mq':
        this.queueInfo = m.q;
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
    if (this.active && this.campus && m.campus && this.scene && this.seedNow === m.seed && !this.loading) {
      // still the same campus: only who you are changed (a new animal), so keep the map and drop in again
      this.myId = m.you;
      this.ended = false;
      const me = m.roster.find((r) => r.id === m.you);
      this.def = ANIMAL_BY_ID.get(me?.animal ?? 'house_cat') ?? this.def;
      this.myTeam = me?.team ?? -1;
      this.roster = new Map(m.roster.map((r) => [r.id, r]));
      this.scene.setRoster(m.roster, this.myId);
      this.haveSnap = false;
      this.pending = [];
      this.seq = 0;
      this.acc = 0;
      this.lastLvl = 1;
      this.lastEvolve = 0;
      this.lastRole = 0;
      this.scene.dropIn();
      this.d.onStart(true);
      return;
    }
    if (this.active) this.teardown();
    this.campus = !!m.campus;
    this.seedNow = m.seed;
    this.myId = m.you;
    this.ended = false;
    const me = m.roster.find((r) => r.id === m.you);
    this.def = ANIMAL_BY_ID.get(me?.animal ?? 'house_cat') ?? this.def;
    this.myTeam = me?.team ?? -1;
    this.roster = new Map(m.roster.map((r) => [r.id, r]));
    // the map takes a moment to build: say so first
    this.loading = document.createElement('div');
    this.loading.style.cssText = 'position:fixed;inset:0;z-index:30;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:radial-gradient(ellipse at 50% 60%,#2fa9a3,#0a3236 70%);color:#f7edd3;font-family:Josefin Sans,"Trebuchet MS",sans-serif;font-weight:700;font-size:28px;text-shadow:0 3px 0 #0b3b3f';
    this.loading.innerHTML = `<div style="font-size:72px;animation:brbob 1s ease-in-out infinite alternate">${ANIMAL_EMOJI[this.def.id] ?? '🐾'}</div><div>Generating the wilds…</div><div style="font-size:17px;font-weight:500;color:#f3b43c">${this.def.name} · ${this.def.role}</div><style>@keyframes brbob{from{transform:translateY(0) rotate(-6deg)}to{transform:translateY(-14px) rotate(6deg)}}</style>`;
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
      this.droppedIn = false;
      this.scene.onLand = () => {
        this.addShake(0.55);
        this.d.sfx.land(1.4);
      };
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
      this.lastZone = '';
      this.shownZone = '';
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
      const fade = this.loading;
      this.loading = null;
      if (fade) {
        fade.style.transition = 'opacity .55s ease-out';
        fade.style.opacity = '0';
        setTimeout(() => fade.remove(), 600);
      }
      this.hud.setCampus(this.campus);
      this.d.onStart(this.campus);
      if (this.campus) this.hud.announce('WELCOME TO CAMPUS', 'Farm the herds, evolve at level 7 and 14, and spar freely: nobody can be hurt here. Press B to queue for the Tournament.', 6500);
      else this.hud.announce(this.def.name.toUpperCase(), 'Recess has begun: scatter, farm the hordes and level up. The lava is coming.', 4200);
    }, 60);
  }

  private setRoster(r: RosterEntry[]) {
    this.roster = new Map(r.map((x) => [x.id, x]));
    this.scene?.setRoster(r, this.myId);
    const me = this.roster.get(this.myId);
    if (me) {
      this.myTeam = me.team;
      const d = ANIMAL_BY_ID.get(me.animal);
      if (d) this.def = d; // evolving changes who you are
    }
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
      const r = { x: you.x, z: you.z, jy: you.jy ?? 0, jv: you.jv ?? 0 };
      if (!you.noMove) {
        for (const c of this.pending) this.simStep(r, c, c.dt, you);
        if (this.acc > 0) this.simStep(r, this.cur, this.acc, you);
      }
      const err = Math.hypot(r.x - this.pos.x, r.z - this.pos.z);
      if (!this.haveSnap || err > 3 || you.noMove) {
        this.pos.x = r.x;
        this.pos.z = r.z;
        this.pos.jy = r.jy;
        this.pos.jv = r.jv;
        this.corr.x = this.corr.z = 0;
        this.ty = NaN;
      } else {
        if (err > 0.03) {
          this.corr.x += this.pos.x - r.x;
          this.corr.z += this.pos.z - r.z;
          this.pos.x = r.x;
          this.pos.z = r.z;
        }
        if (Math.abs(r.jy - this.pos.jy) > 0.35) {
          this.pos.jy = r.jy;
          this.pos.jv = r.jv;
        }
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
      this.hud.levelUp();
      this.hud.announce(`LEVEL ${you.lvl}`, you.pts > 0 ? 'Press Tab to spend your stat point' : '', 1800);
      this.d.sfx.levelUp();
      this.scene.burst(this.pos.x, this.scene.groundY(this.pos.x, this.pos.z) + 1, this.pos.z, 0xffe27a, 18, 5, 0.9);
    }
    if (you.role === 0 && you.lvl === this.lastLvl && you.xp > this.lastXp + 0.5) {
      sc.floater(this.pos.x, sc.groundY(this.pos.x, this.pos.z) + 3.0, this.pos.z, `+${Math.round(you.xp - this.lastXp)} XP`, '#9fe8ff', 0.9);
    }
    if (you.role === 0 && you.evolve.length > 0 && this.lastEvolve === 0) {
      this.hud.announce('YOU CAN EVOLVE', 'Press Tab and pick your next form', 3200);
      this.d.sfx.levelUp();
    }
    this.lastEvolve = you.evolve.length;
    this.lastXp = you.xp;
    this.lastLvl = you.lvl;
    if (you.hp < this.prevHp - 0.5 && you.role !== 3) this.hud.flashHurt();
    this.prevHp = you.hp;
    for (const e of m.ev) this.onEvent(e);
  }

  private onRoleChange(from: number, to: number) {
    this.panelOpen = false;
    if (to === 3) {
      this.hud.announce('ELIMINATED', 'You are out. Watch the survivors, or press Esc to head back to the campus.', 5500);
      this.d.sfx.death();
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
        if (me) {
          this.d.sfx.bite(true);
          this.addShake(Math.min(0.9, 0.25 + e.n / 60));
        } else {
          this.nearSfx(e.x, e.z, () => this.d.sfx.bite());
          if (Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < 3.5 && this.clock - this.localSwingAt < 0.45) {
            this.hitstop = Math.max(this.hitstop, e.n > 20 ? 0.07 : 0.035);
            this.addShake(0.18);
            this.hud.hitMarker(e.n > 20);
          }
        }
        break;
      }
      case 'mobhit':
        sc.floater(e.x, sc.groundY(e.x, e.z) + 1.4, e.z, String(e.n), '#ffe27a', 0.8);
        if (Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < 4 && this.clock - this.localSwingAt < 0.5) this.hud.hitMarker(e.n > 20);
        sc.burst(e.x, sc.groundY(e.x, e.z) + 0.6, e.z, 0xcc3322, 4, 2, 0.3);
        this.nearSfx(e.x, e.z, () => this.d.sfx.bite());
        break;
      case 'swing': {
        const hostile = this.isHostile(e.id);
        const own = e.id === this.myId;
        // our own swing already started when we pressed the button
        if (!(own && this.clock - this.localSwingAt < 0.35)) sc.cue(e.id, { kind: 'swing', combo: e.c, heavy: e.h, skill: '', fx: '', wind: e.w, rec: e.c === 2 ? 0.55 : 0.26 });
        sc.telegraph(e.x, e.z, e.yaw, { shape: 'arc', r: e.r, arc: e.a, width: 0 }, e.w, hostile, e.h);
        if (hostile) this.nearSfx(e.x, e.z, () => this.d.sfx.windup(e.h), 22);
        break;
      }
      case 'mswing':
        sc.cueMob(e.id, e.w, e.big);
        sc.telegraph(e.x, e.z, e.yaw, e.big ? { shape: 'circle', r: e.r, arc: 360, width: 0 } : { shape: 'arc', r: e.r, arc: 110, width: 0 }, e.w, true, e.big);
        this.nearSfx(e.x, e.z, () => this.d.sfx.windup(true), 40);
        break;
      case 'skill': {
        const sk = SKILL_BY_ID.get(e.s);
        const fx = sk?.fx;
        const hostile = this.isHostile(e.id);
        if (e.s === 'dash') break;
        if (fx) {
          const wind = e.w ?? 0;
          const instant = fx.k === 'buff' || fx.k === 'heal' || fx.k === 'submerge';
          sc.cue(e.id, { kind: instant ? 'flex' : 'skill', combo: -1, heavy: fx.k === 'grab' || (fx.k === 'aoe' && fx.dmg > 0), skill: e.s, fx: fx.k, wind, rec: 0.4 });
          if (wind > 0) {
            sc.telegraphSkill(e.x, e.z, e.yaw, e.s, wind, hostile, fx.k === 'grab' || fx.k === 'aoe');
            if (hostile) this.nearSfx(e.x, e.z, () => this.d.sfx.windup(true), 30);
            if (e.s === 'howl' || e.s === 'alpha_howl') this.nearSfx(e.x, e.z, () => this.d.sfx.howl(), 60);
            else if (e.s === 'roar') this.nearSfx(e.x, e.z, () => this.d.sfx.roar(), 40);
          }
        }
        break;
      }
      case 'strike': {
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
        else if (e.s === 'frenzy') sc.ringFx(e.x, e.z, 6, col, 0.7);
        if (e.s === 'earthshaker' || e.s === 'roar') this.addShake(Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < 20 ? 0.45 : 0);
        if (e.s === 'howl' || e.s === 'alpha_howl') this.nearSfx(e.x, e.z, () => this.d.sfx.howl(), 60);
        else if (e.s === 'roar' || e.s === 'earthshaker') this.nearSfx(e.x, e.z, () => this.d.sfx.roar(), 40);
        else if (fx?.k === 'dash') this.nearSfx(e.x, e.z, () => this.d.sfx.whoosh());
        else if (self) this.d.sfx.swing();
        break;
      }
      case 'parry': {
        const gy = sc.groundY(e.x, e.z);
        sc.cue(e.id, { kind: 'parry', combo: 0, heavy: false, skill: '', fx: '', wind: 0, rec: 0.3 });
        sc.ringFx(e.x, e.z, e.heavy ? 4.2 : 3, 0xffe27a, 0.45);
        sc.burst(e.x, gy + 1.1, e.z, 0xfff2b0, 22, 6, 0.5);
        sc.floater(e.x, gy + 2.6, e.z, 'PARRY!', '#ffe27a', 1.5);
        // the attacker reels: if that is you, the whole screen goes dizzy
        if (e.by === this.myId) {
          this.hud.dizzy(e.stun ?? 1);
          this.hud.callout('PARRIED!', '#ff9a82');
        }
        const mine = e.id === this.myId || e.by === this.myId;
        if (mine) {
          this.hitstop = 0.11;
          this.slowmo = 0.35;
          this.addShake(0.8);
          if (e.id === this.myId) this.hud.callout('PARRY!', '#ffe27a');
        } else this.addShake(Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < 14 ? 0.3 : 0);
        this.nearSfx(e.x, e.z, () => this.d.sfx.parry(), 40);
        break;
      }
      case 'block': {
        const gy = sc.groundY(e.x, e.z);
        sc.burst(e.x, gy + 1.0, e.z, e.broke ? 0xff6a3a : 0x9fdcff, e.broke ? 18 : 8, e.broke ? 5 : 3, 0.35);
        sc.floater(e.x, gy + 2.4, e.z, e.broke ? 'GUARD BREAK!' : 'BLOCK', e.broke ? '#ff6b5a' : '#bfe8ff', e.broke ? 1.3 : 0.9);
        if (e.id === this.myId) {
          this.addShake(e.broke ? 0.7 : 0.3);
          if (e.broke) {
            this.hitstop = 0.08;
            this.hud.callout('GUARD BROKEN', '#ff6b5a');
          }
        }
        this.nearSfx(e.x, e.z, () => this.d.sfx.block(e.broke), 35);
        break;
      }
      case 'whiff': {
        // a parry that caught nothing: the fumble is its own lesson
        const gy = sc.groundY(e.x, e.z);
        sc.floater(e.x, gy + 2.4, e.z, 'MISSED', '#ff9a82', 1.1);
        sc.burst(e.x, gy + 0.9, e.z, 0xbfc8d8, 8, 2, 0.4);
        if (e.id === this.myId) {
          this.hud.callout('FUMBLED', '#ff9a82');
          this.d.sfx.block();
        }
        break;
      }
      case 'dodge': {
        const gy = sc.groundY(e.x, e.z);
        sc.floater(e.x, gy + 2.4, e.z, 'DODGE', '#d8f0ff', 1.1);
        if (e.id === this.myId) this.hud.callout('DODGED', '#d8f0ff');
        break;
      }
      case 'streak': {
        const names = ['', '', 'DOUBLE KILL', 'TRIPLE KILL', 'RAMPAGE', 'UNSTOPPABLE'];
        const label = names[Math.min(e.n, 5)] + (e.n > 5 ? ` x${e.n}` : '');
        if (e.id === this.myId) {
          this.hud.streak(label, e.n);
          this.d.sfx.levelUp();
          this.addShake(0.35);
          sc.burst(this.pos.x, sc.groundY(this.pos.x, this.pos.z) + 1.2, this.pos.z, 0xff9a3a, 24, 6, 0.9);
        } else this.hud.feedLine(`🔥 ${this.who(e.id)}: ${label}`);
        break;
      }
      case 'pickup': {
        if (e.id !== this.myId) break;
        if (e.item === 'morsel') {
          this.d.sfx.step('grass', 0.4); // a tiny nibble; the XP floater shows the gain
          break;
        }
        sc.floater(this.pos.x, sc.groundY(this.pos.x, this.pos.z) + 2.3, this.pos.z, `+${e.n} ${itemLabel(e.item)}`, '#ffb38a', 1.1);
        this.d.sfx.pickup();
        break;
      }
      case 'kill': {
        const killer = e.killer ? this.who(e.killer) : e.how === 'lava' ? 'The lava' : 'The wild';
        this.hud.feedLine(`${killer} ▸ ${this.who(e.victim)}`, e.killer === this.myId || e.victim === this.myId);
        this.scene?.faint(e.victim);
        break;
      }
      case 'evolving': {
        const gy = sc.groundY(e.x, e.z);
        sc.floater(e.x, gy + 2.6, e.z, 'EVOLVING…', '#bff0ff', 1.2);
        sc.evolveGlow(e.id, 3);
        sc.ringFx(e.x, e.z, 3.2, 0xbff0ff, 2.6);
        sc.burst(e.x, gy + 1, e.z, 0xbff0ff, 14, 2, 1.2);
        break;
      }
      case 'evolve': {
        const gy = sc.groundY(e.x, e.z);
        const to = ANIMAL_BY_ID.get(e.to);
        sc.burst(e.x, gy + 1.2, e.z, 0xffe9a0, 36, 7, 1.0);
        sc.ringFx(e.x, e.z, 6, 0xffe9a0, 0.7);
        sc.floater(e.x, gy + 3, e.z, to ? to.name.toUpperCase() : 'EVOLVED', '#ffe27a', 1.5);
        if (e.id === this.myId) {
          this.hud.announce(`YOU EVOLVED: ${to?.name.toUpperCase() ?? ''}`, to ? `${to.skill.name} (Q): ${to.skill.desc}` : '', 4200);
          this.hud.levelUp();
          this.addShake(0.4);
          this.d.sfx.levelUp();
        } else this.nearSfx(e.x, e.z, () => this.d.sfx.levelUp(), 40);
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
      case 'proj':
        sc.projectile(e.id, e.x, e.z, e.tx, e.tz, e.kind.includes('quill') ? 0xf0e6c8 : 0xbbbbbb);
        break;
      case 'lure':
        sc.lureAt(e.x, e.z);
        break;
    }
  }

  private isHostile(id: string) {
    const v = this.scene?.fighter(id);
    return !!v && v.id !== this.myId && v.team !== this.myTeam;
  }
  private addShake(a: number) {
    this.shake = Math.min(1, Math.max(this.shake, a));
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
    this.freeCursor = false;
    this.guardHeld = false;
    this.hud.setCursorMode(false);
    this.hud.show(false);
    this.hud.hideEnd();
    this.hud.showPause(false);
    this.scene?.dispose();
    this.scene = null;
    this.active = false;
    this.campus = false;
    this.seedNow = -1;
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
    if (this.active && e.code === 'AltLeft') {
      e.preventDefault(); // the browser would otherwise focus its menu bar
      if (!e.repeat && !this.d.isBlocked() && !this.hud.isEndVisible()) this.setFreeCursor(!this.freeCursor);
      return;
    }
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
    if ((e.code === 'ShiftLeft' || e.code === 'ShiftRight') && !e.repeat) this.shiftAt = performance.now();
    const you = this.you;
    if (!you || e.ctrlKey || e.metaKey) return;
    const role = you.role;
    if (role === 0 && this.panelOpen) {
      const n = Number(e.code.replace('Digit', ''));
      if (n >= 1 && n <= 5) {
        this.spend(STAT_KEYS[n - 1]);
        return;
      }
    }
    if (e.code === 'Space') {
      e.preventDefault();
      if (role !== 3 && !this.you?.buffs.includes('fumbled')) this.jumpQueued = true; // hop over low rocks, or just for fun
      return;
    }
    if (e.code in KEYS_SKILL) {
      if (role === 0) this.d.net.send({ t: 'mskill', i: KEYS_SKILL[e.code], yaw: this.aimYaw(14) });
      return;
    }
    if (e.code.startsWith('Digit')) {
      const n = Number(e.code.slice(5));
      if (role === 0 && n >= 1 && n <= 6) this.d.net.send({ t: 'muse', i: n - 1 });
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

  private boundFor(_x: number, _z: number): Bound {
    return MAP_BOUND;
  }

  private radius() {
    if (this.you?.role === 2) return 0.4;
    return SIZE[this.def.size].radius;
  }

  private stepDist(you: YouState, dx: number, dz: number, sprint: boolean, crouch: boolean) {
    const moving = Math.hypot(dx, dz) > 0.05;
    let s = you.speed;
    const med = medium(this.scene!.terrain, this.pos.x, this.pos.z, false, 0);
    if (sprint && moving && !med.noSprint && you.sta > 1 && you.role !== 2 && !you.guard && !you.wind) s *= 1.45;
    if (crouch) s *= 0.6;
    return s;
  }

  /** One step of our own movement, exactly as the server will run it (so the two agree). */
  private simStep(st: { x: number; z: number; jy: number; jv: number }, c: { dx: number; dz: number; sprint: boolean; crouch: boolean; jump: boolean }, dt: number, you: YouState) {
    const sc = this.scene!;
    if (c.jump && st.jy <= sc.terrain.floorAt(st.x, st.z, st.jy) + 0.001 && st.jv <= 0.001 && !you.noMove && you.sta >= JUMP_COST && !sc.terrain.isDeep(st.x, st.z)) st.jv = JUMP_V;
    if (!you.noMove) stepPos(sc.terrain, st, c.dx, c.dz, this.stepDist(you, c.dx, c.dz, c.sprint, c.crouch) * dt, this.radius(), this.boundFor(st.x, st.z), st.jy);
    stepVertical(st, dt, sc.terrain.floorAt(st.x, st.z, st.jy));
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
    // holding Shift for more than a moment sprints; a quick tap is a dash (see the key-up handler)
    // (only forward: strafing and backpedalling stay at walking pace)
    const sprint = (k.has('ShiftLeft') || k.has('ShiftRight')) && performance.now() - this.shiftAt > 200 && f > 0;
    return { dx, dz, sprint, crouch: k.has('KeyC'), at: this.mouseDown };
  }

  // --- the frame -------------------------------------------------------------------------------------

  private update(dtReal: number) {
    const sc = this.scene;
    if (!sc) return;
    // a parry or a heavy hit briefly freezes the moment; movement and the network keep real time
    this.hitstop = Math.max(0, this.hitstop - dtReal);
    this.slowmo = Math.max(0, this.slowmo - dtReal);
    this.shake = Math.max(0, this.shake - dtReal * 2.4);
    const dt = dtReal;
    const dtWorld = dtReal * (this.hitstop > 0 ? 0.04 : this.slowmo > 0 ? 0.45 : 1);
    this.clock += dt;
    const you = this.you;
    const g = this.g;
    const jump = this.jumpQueued;
    this.jumpQueued = false;
    const inp = { ...this.readInput(), jump };

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
        // start our own swing animation the instant the button goes down (the server confirms it a moment later)
        if (this.guardHeld && this.clock > this.guardEnds && !you.guard) this.guardHeld = false;
        if (inp.at && !this.guardHeld && !you.wind && this.clock > this.nextSwing && !you.buffs.includes('stunned') && !you.buffs.includes('fumbled') && (you.sta >= 5 || you.role === 2)) {
          const combo = this.clock - this.localComboAt < COMBO_RESET ? (this.localCombo + 1) % 3 : 0;
          const c = COMBO[combo];
          this.localCombo = combo;
          this.localComboAt = this.clock;
          this.localSwingAt = this.clock;
          this.nextSwing = this.clock + c.wind + c.rec;
          if (you.role !== 2) sc.cue(this.myId, { kind: 'swing', combo, heavy: combo === 2, skill: '', fx: '', wind: c.wind, rec: c.rec });
          this.d.sfx.swing();
        }
        let flags = 0;
        if (g.top.some(([id]) => id === this.myId)) flags |= FL.hunted;
        if (you.buffs.includes('stunned')) flags |= FL.stun;
        if (you.dash > you.dashMax - 0.3) flags |= FL.dash;
        if (this.guardHeld || you.guard) flags |= FL.guard;
        if (you.wind) flags |= FL.wind;
        if (you.counter > 0) flags |= FL.counter;
        if (inp.at || this.guardHeld) this.visYaw = this.aimYaw(you.role === 0 ? 8 : 6);
        else { let d = this.camYaw - this.visYaw; d = Math.atan2(Math.sin(d), Math.cos(d)); const m = 18 * dtWorld; this.visYaw += Math.max(-m, Math.min(m, d)); } // faces where the camera looks, eased so a quick flick does not snap the body
        const cd = Math.exp(-dtWorld * 9);
        this.corr.x *= cd;
        this.corr.z *= cd;
        this.spdSm += ((moving ? you.speed : 0) - this.spdSm) * (1 - Math.exp(-dtWorld * 12));
        sc.setSelf(this.pos.x + this.corr.x, this.pos.z + this.corr.z, this.visYaw, (you.hp / you.maxHp) * 100, you.lvl, flags, this.spdSm < 0.05 ? 0 : this.spdSm, this.pos.jy);
        // landing
        const air = this.pos.jy - sc.terrain.floorAt(this.pos.x, this.pos.z, this.pos.jy) > 0.05;
        if (this.wasAir && !air) this.d.sfx.step('grass', 0.45);
        this.wasAir = air;
        // sneaking in a bush or underwater: show it
        self.group.visible = true;
      }
      // sounds underfoot
      if (moving && you.role !== 3 && this.pos.jy - sc.terrain.floorAt(this.pos.x, this.pos.z, this.pos.jy) < 0.05) this.footsteps(dt, inp.sprint);
      // lava
      const burning = Math.hypot(this.pos.x, this.pos.z) > g.ring && you.role !== 1 && you.role !== 3;
      this.hud.setLava(burning);
      if (burning && this.clock > this.lavaSfx) {
        this.lavaSfx = this.clock + 0.5;
        this.d.sfx.lava();
      }
    }

    this.updateCamera(dt, you);
    sc.update(dtWorld, this.myTeam, g?.time ?? 0);
    // the paper doll copies our animal's animation
    if (you && you.role !== 3) {
      const rs = this.roster.get(this.myId);
      const sv = sc.fighter(this.myId);
      this.doll.set(this.def.id, rs?.paint, this.myId);
      this.doll.update(dtWorld, sv?.lastState, this.visYaw, this.camYaw);
    }

    if (you && g) {
      if (this.clock - this.hintAt > 0.15) {
        this.hintAt = this.clock;
        this.hint = this.computeHint(you);
      }
      this.hud.render({ you, g, def: this.def, roster: this.roster, myId: this.myId, now: this.clock, hint: this.hint, panelOpen: this.panelOpen, campus: this.campus, queue: this.queueInfo });
      this.hud.setReticle(you, this.guardHeld || you.guard, you.role === 0 || you.role === 1 || you.role === 2);
      this.hud.setLowHp(you.role === 0 && you.hp / you.maxHp < 0.3);
      this.pings = this.pings.filter((p) => p.until > this.clock);
      this.hud.drawMap({ x: this.pos.x, z: this.pos.z, yaw: this.camYaw }, g, this.blips(you));
      if (this.clock - this.lastVoice > 0.1) {
        this.lastVoice = this.clock;
        this.updateVoice(you);
      }
    }
  }

  private moveAndSend(dt: number, inp: { dx: number; dz: number; sprint: boolean; crouch: boolean; at: boolean; jump: boolean }, you: YouState) {
    // predicted movement this frame
    this.simStep(this.pos, inp, dt, you);
    // timed steps for the server: a change of input closes the current one
    const same = inp.dx === this.cur.dx && inp.dz === this.cur.dz && inp.sprint === this.cur.sprint && inp.crouch === this.cur.crouch && inp.jump === this.cur.jump;
    if (!same && this.acc > 0) this.flush();
    this.cur = { dx: inp.dx, dz: inp.dz, sprint: inp.sprint, crouch: inp.crouch, jump: inp.jump };
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
    if (dtMs > 0.5 && !(you?.noMove)) this.pending.push({ s: this.seq, dt: dtMs / 1000, dx: c.dx, dz: c.dz, sprint: c.sprint, crouch: c.crouch, jump: c.jump });
    else if (dtMs > 0.5) this.pending.push({ s: this.seq, dt: 0, dx: 0, dz: 0, sprint: false, crouch: false, jump: false });
    if (this.pending.length > 40) this.pending.shift();
    this.d.net.send({ t: 'min', s: this.seq, dt: Math.round(dtMs * 10) / 10, x: Math.round(c.dx * 100) / 100, z: Math.round(c.dz * 100) / 100, yaw: Math.round(aim * 1000) / 1000, sp: c.sprint ? 1 : 0, cr: c.crouch ? 1 : 0, at: at ? 1 : 0, j: c.jump ? 1 : 0 });
    this.acc = 0;
    this.lastSend = performance.now();
    this.lastYawSent = this.camYaw;
    this.lastAtSent = at ? 1 : 0;
  }

  private footsteps(dt: number, sprint: boolean) {
    const sc = this.scene!;
    this.stepAcc += (this.you?.speed ?? 6) * (sprint ? 1.45 : 1) * dt;
    if (this.stepAcc < 2.7) return;
    this.stepAcc = 0;
    const h = sc.terrain.heightAt(this.pos.x, this.pos.z);
    const surface = h < WATER_Y - 0.1 ? 'water' : h < WATER_Y + 0.6 ? 'sand' : sc.terrain.biomeAt(this.pos.x, this.pos.z) === 3 ? 'block' : 'grass';
    this.d.sfx.step(surface, (this.def.size === 'large' ? 0.42 : this.def.size === 'small' ? 0.16 : 0.27) * (this.hasCrouch() ? 0.35 : sprint ? 1.25 : 1));
  }
  private hasCrouch() {
    return this.keys.has('KeyC');
  }

  private updateCamera(dt: number, you: YouState | null) {
    const sc = this.scene!;
    const cam = sc.camera;
    const rend = this.d.world.renderer;
    const size = rend.getSize(new THREE.Vector2());
    cam.aspect = size.x / Math.max(1, size.y);
    // the view widens when you dash or sprint, a little rush of speed
    const dashing = !!you && you.dash > you.dashMax - 0.3;
    const sprinting = this.keys.has('ShiftLeft') && performance.now() - this.shiftAt > 200 && (this.you?.speed ?? 0) > 0;
    const targetFov = 62 + (dashing ? 14 : 0) + (sprinting ? 4 : 0);
    this.fovNow += (targetFov - this.fovNow) * (1 - Math.exp(-dt * 12));
    cam.fov = this.fovNow;
    cam.updateProjectionMatrix();
    // a plank announces the ground you are standing on, once it has stayed the same a moment
    {
      const wet = sc.terrain.depthAt(this.pos.x, this.pos.z) > 0.4;
      const zone = wet ? 'water' : String(sc.terrain.biomeAt(this.pos.x, this.pos.z));
      const nowMs = performance.now();
      if (zone !== this.lastZone) {
        this.lastZone = zone;
        this.zoneSince = nowMs;
      } else if (nowMs - this.zoneSince > 700 && zone !== this.shownZone) {
        this.shownZone = zone;
        const c = wet ? null : SPAWN_CHOICES.find((x) => x.biome === sc.terrain.biomeAt(this.pos.x, this.pos.z));
        if (wet) this.hud.zone('💧', 'Deep water', 'Water animals swim fast and hide here');
        else if (c) this.hud.zone(c.icon, c.name, c.good[0]);
      }
    }
    const vx = this.pos.x + this.corr.x;
    const vz = this.pos.z + this.corr.z;
    const gy = sc.groundY(vx, vz);
    const self = sc.fighter(this.myId);
    const height = Math.min(2.4, (self?.rig.height ?? 1.6) * 0.62) + 0.35;
    const tx = vx;
    const tz = vz;
    const tyWant = gy + this.pos.jy * 0.6 + height - (this.you && sc.terrain.depthAt(tx, tz) > 0.4 ? 0.3 : 0);
    this.ty = Number.isNaN(this.ty) || Math.abs(tyWant - this.ty) > 6 ? tyWant : this.ty + (tyWant - this.ty) * (1 - Math.exp(-dt * 14));
    const ty = this.ty;
    const sizeK = this.you?.role === 2 ? 0.7 : this.def.size === 'large' ? 1.35 : this.def.size === 'small' ? 0.8 : 1;
    const dist = this.zoom * sizeK;
    const cp = Math.cos(this.camPitch);
    const sp = Math.sin(this.camPitch);
    const sy = Math.sin(this.camYaw);
    const cy = Math.cos(this.camYaw);
    // over the shoulder: the camera sits behind and to the right, so the animal is left of the crosshair and you see where you are going
    const shoulder = 1.0 * sizeK;
    const rx = -cy;
    const rz = sy;
    let px = tx - sy * cp * dist + rx * shoulder;
    let pz = tz - cy * cp * dist + rz * shoulder;
    let py = ty + sp * dist + 0.4;
    const fullD = Math.hypot(px - tx, py - ty, pz - tz);
    const clear = sc.cameraClear(tx, ty, tz, px, py, pz);
    const want = Math.max(clear, Math.min(1, 1.5 / Math.max(1.5, fullD)));
    this.camFrac += (want - this.camFrac) * (1 - Math.exp(-(want < this.camFrac ? 30 : 4) * dt));
    px = tx + (px - tx) * this.camFrac;
    py = ty + (py - ty) * this.camFrac;
    pz = tz + (pz - tz) * this.camFrac;
    // never go through the ground
    const floor = sc.groundY(px, pz) + 0.55;
    if (py < floor) py = floor;
    void px;
    void pz;
    this.camPos.set(px, py, pz);
    const k = 1 - Math.exp(-dt * 20);
    const snap = cam.position.distanceTo(this.camPos) > 8;
    cam.position.lerp(this.camPos, snap ? 1 : k);
    if (this.shake > 0.01) {
      const a = this.shake * this.shake * 0.5;
      cam.position.x += (Math.random() - 0.5) * a;
      cam.position.y += (Math.random() - 0.5) * a;
      cam.position.z += (Math.random() - 0.5) * a;
    }
    this.lookAt.set(tx + rx * shoulder * 0.9 + sy * 2.4, ty - 1.0 - sp * 0.3, tz + rz * shoulder * 0.9 + cy * 2.4);
    // the aim point follows the same easing as the camera, so position and rotation lag together instead of wobbling
    if (snap || this.lookSm.lengthSq() === 0) this.lookSm.copy(this.lookAt);
    else this.lookSm.lerp(this.lookAt, 1 - Math.exp(-dt * 26));
    cam.lookAt(this.lookSm);
    px = 0;
    pz = 0;
  }

  private render(r: THREE.WebGLRenderer) {
    if (!this.scene) return;
    r.render(this.scene.scene, this.scene.camera);
    if (this.you && this.you.role !== 3 && this.hud.visible) this.doll.render(r, this.hud.dollRect());
  }

  // --- hints, map, voice -----------------------------------------------------------------------------

  private computeHint(you: YouState): string {
    const sc = this.scene!;
    if (you.role === 2 || you.role === 3 || you.role === 1) {
      if (you.role === 2) {
        const d = this.drops.find((x) => x[1] !== 'morsel' && Math.hypot(x[2] - this.pos.x, x[3] - this.pos.z) < 3.2);
        return d ? '[G] Eat' : '';
      }
      return '';
    }
    const drop = this.drops.find((x) => x[1] !== 'morsel' && Math.hypot(x[2] - this.pos.x, x[3] - this.pos.z) < 3.2);
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
      // the eliminated hear each other, and the living cannot be overheard by them
      v.setPeerGate(id, myDead === theirDead);
      const crouch = (fv.flags & FL.crouch) !== 0;
      if (crouch) v.setPeerRange(id, 5, 20);
      else v.setPeerRange(id, 10, 40);
      const wet = inWater || sc.terrain.depthAt(fv.x, fv.z) > 0.6;
      const blocked = sc.terrain.blocked(this.pos.x, this.pos.z, fv.x, fv.z);
      v.setPeerMuffle(id, wet ? 0.85 : blocked ? 0.6 : 0);
      sc.setSpeaking(id, v.speaking.has(id));
    }
  }
}

