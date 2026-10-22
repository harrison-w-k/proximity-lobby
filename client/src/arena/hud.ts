// The match HUD: bars, skills, inventory, minimap, banners, the upgrade panel and the end screen.
import { ANIMAL_BY_ID, STAT_KEYS, STAT_NAMES, UNLOCK_LEVELS, type AnimalDef, type Skill, type StatKey } from '../../../shared/arena/animals';
import { SWARMS } from '../../../shared/arena/mobs';
import type { Global, InvItem, RosterEntry, YouState } from '../../../shared/arena/proto';
import { MAP_RADIUS, Biome, type Terrain } from '../../../shared/arena/terrain';

const CSS = `
#br-root { position: fixed; inset: 0; z-index: 7; pointer-events: none; font-family: var(--font-body); color: #fff; }
#br-root[hidden] { display: none; }
#br-root .chip { pointer-events: none; }
.br-top { position: absolute; top: 12px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 6px; }
.br-phase { display: flex; gap: 10px; align-items: center; font-family: var(--font-pixel); font-size: 11px; text-transform: uppercase; background: var(--blue); padding: 8px 14px;
  border: 4px solid var(--ink); box-shadow: inset 3px 3px 0 var(--blue-light), inset -3px -3px 0 var(--blue-dark), 4px 4px 0 rgba(0,0,0,.45); }
.br-phase b { color: var(--yellow); font-weight: 400; }
.br-ring { font-size: 22px; padding: 2px 12px; background: rgba(11,11,26,.75); border: 3px solid var(--ink); text-shadow: 2px 2px 0 var(--ink); }
.br-ring.warn { background: rgba(156,36,24,.9); animation: brpulse .8s infinite alternate; }
@keyframes brpulse { from { filter: brightness(1); } to { filter: brightness(1.5); } }
.br-banner { position: absolute; top: 22%; left: 50%; transform: translateX(-50%); font-family: var(--font-pixel); font-size: 20px; text-transform: uppercase; text-align: center;
  color: var(--yellow); text-shadow: 3px 3px 0 var(--ink), -2px -2px 0 var(--ink), 2px -2px 0 var(--ink), -2px 2px 0 var(--ink); opacity: 0; transition: opacity .3s; white-space: nowrap; }
.br-banner.on { opacity: 1; }
.br-banner small { display: block; margin-top: 10px; font-size: 11px; color: #fff; }
.br-mapbox { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.br-mapbox canvas { width: 180px; height: 180px; border: 4px solid var(--ink); outline: 3px solid #fff; background: #123; image-rendering: pixelated; border-radius: 50%; }
.br-hunted { font-size: 20px; text-shadow: 2px 2px 0 var(--ink); text-align: right; }
.br-hunted div { padding: 1px 8px; background: rgba(11,11,26,.7); margin-top: 2px; border-left: 4px solid var(--yellow); }
.br-feed { position: absolute; top: 96px; left: 14px; width: 330px; display: flex; flex-direction: column; gap: 3px; font-size: 20px; text-shadow: 2px 2px 0 var(--ink); }
.br-feed div { background: rgba(11,11,26,.62); padding: 1px 8px; border-left: 4px solid var(--red); transition: opacity .6s; }
.br-feed div.old { opacity: 0; }
.br-feed div.me { border-left-color: var(--yellow); }
.br-bottom { position: absolute; bottom: 14px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; gap: 8px; width: min(560px, 94vw); }
.br-row { display: flex; gap: 8px; align-items: flex-end; justify-content: center; }
.br-slot { position: relative; width: 62px; height: 62px; background: rgba(11,11,26,.82); border: 4px solid var(--ink); box-shadow: inset 3px 3px 0 rgba(255,255,255,.15); display: flex; align-items: center; justify-content: center; overflow: hidden; }
.br-slot .k { position: absolute; top: 1px; left: 4px; font-family: var(--font-pixel); font-size: 9px; color: var(--yellow); }
.br-slot .n { font-size: 15px; text-align: center; line-height: 1; padding: 0 2px; text-shadow: 1px 1px 0 var(--ink); }
.br-slot .cd { position: absolute; left: 0; bottom: 0; width: 100%; background: rgba(0,0,0,.72); }
.br-slot .cdt { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-family: var(--font-pixel); font-size: 12px; }
.br-slot.ready { border-color: var(--green); }
.br-slot.locked { opacity: .45; }
.br-slot.passive { border-color: #6b7aa8; }
.br-slot .q { position: absolute; bottom: 1px; right: 4px; font-size: 14px; color: var(--cream); }
.br-slot.sm { width: 52px; height: 52px; }
.br-bar { position: relative; height: 24px; width: 100%; background: var(--ink); border: 4px solid var(--ink); }
.br-bar > i { display: block; height: 100%; }
.br-bar span { position: absolute; inset: 0; text-align: center; font-size: 19px; line-height: 16px; text-shadow: 1px 1px 0 var(--ink); }
.br-bar.hp > i { background: linear-gradient(#ff6b5a, #c8321f); }
.br-bar.sta > i { background: linear-gradient(#ffe27a, #d9a400); }
.br-bar.xp > i { background: linear-gradient(#78b7ff, #2a6fd6); }
.br-bar.sm { height: 16px; } .br-bar.sm span { font-size: 14px; line-height: 8px; }
.br-lvl { font-family: var(--font-pixel); font-size: 12px; background: var(--blue); padding: 6px 10px; border: 4px solid var(--ink); }
.br-buffs { display: flex; gap: 6px; min-height: 24px; font-size: 18px; }
.br-buffs span { background: rgba(11,11,26,.8); border: 2px solid var(--yellow); padding: 0 6px; }
.br-point { animation: brpulse .6s infinite alternate; background: var(--green) !important; color: var(--ink); }
.br-hint { position: absolute; left: 50%; top: 62%; transform: translateX(-50%); font-size: 24px; background: rgba(11,11,26,.85); border: 3px solid #fff; padding: 2px 12px; text-shadow: 2px 2px 0 var(--ink); }
.br-chan { position: absolute; left: 50%; top: 68%; transform: translateX(-50%); width: 220px; height: 16px; background: var(--ink); border: 3px solid #fff; padding: 2px; }
.br-chan i { display: block; height: 100%; background: var(--green); }
.br-vig { position: absolute; inset: 0; background: radial-gradient(ellipse at center, transparent 40%, rgba(255,30,10,.55) 100%); opacity: 0; transition: opacity .25s; }
.br-lavavig { position: absolute; inset: 0; background: radial-gradient(ellipse at center, rgba(255,120,0,.15) 20%, rgba(255,60,0,.65) 100%); opacity: 0; transition: opacity .2s; }
.br-blind { position: absolute; inset: 0; background: #fff; opacity: 0; transition: opacity .3s; }
.br-panel { position: absolute; left: 14px; top: 14px; bottom: 14px; width: 360px; padding: 14px; pointer-events: auto; overflow-y: auto; }
.br-panel h3 { margin: 0 0 8px; font-family: var(--font-pixel); font-size: 12px; text-transform: uppercase; color: var(--yellow); text-shadow: 2px 2px 0 var(--ink); }
.br-stat { display: flex; align-items: center; gap: 8px; margin: 3px 0; font-size: 22px; }
.br-stat .nm { flex: 1; } .br-stat .key { min-width: 26px; height: 26px; font-size: 9px; }
.br-stat button { width: 34px; height: 30px; min-height: 0; padding: 0; font-size: 18px; }
.br-pick { margin: 6px 0; padding: 6px; background: rgba(11,11,26,.5); border: 2px solid var(--ink); }
.br-pick .opts { display: flex; gap: 6px; }
.br-pick .opt { flex: 1; padding: 4px 6px; background: var(--blue-dark); border: 3px solid var(--ink); font-size: 18px; line-height: 1.05; cursor: pointer; text-align: left; }
.br-pick .opt.chosen { background: var(--green-dark); border-color: var(--green); }
.br-pick .opt.off { opacity: .4; cursor: default; }
.br-pick .opt b { display: block; color: var(--yellow); font-weight: 400; }
.br-pick .t { font-size: 18px; color: var(--cream); }
.br-gulag { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: flex-start; padding-top: 14vh; background: linear-gradient(rgba(10,10,18,.55), rgba(10,10,18,0) 55%); pointer-events: none; }
.br-gulag h2 { font-family: var(--font-pixel); font-size: 34px; margin: 0; color: #ff6b5a; text-shadow: 4px 4px 0 var(--ink); }
.br-gulag p { font-size: 26px; margin: 8px 0; text-shadow: 2px 2px 0 var(--ink); text-align: center; max-width: 560px; }
.br-choice { display: flex; gap: 10px; margin-top: 10px; pointer-events: auto; }
.br-choice .btn { font-size: 10px; }
.br-leader { position: absolute; bottom: 150px; left: 50%; transform: translateX(-50%); width: min(520px, 92vw); padding: 8px 12px; background: rgba(11,11,26,.82); border: 4px solid var(--ink); text-align: center; font-size: 22px; }
.br-leader b { color: var(--yellow); font-weight: 400; }
.br-end { position: absolute; inset: 0; background: rgba(8,12,30,.88); display: flex; align-items: center; justify-content: center; pointer-events: auto; }
.br-end .box { width: min(720px, 94vw); max-height: 90vh; overflow: auto; padding: 22px; }
.br-end h2 { font-family: var(--font-pixel); font-size: 22px; margin: 0 0 4px; color: var(--yellow); text-shadow: 3px 3px 0 var(--ink); }
.br-end table { width: 100%; border-collapse: collapse; font-size: 21px; margin: 12px 0; }
.br-end td, .br-end th { padding: 2px 8px; text-align: left; border-bottom: 2px solid rgba(255,255,255,.15); }
.br-end tr.me td { color: var(--yellow); background: rgba(255,210,63,.12); }
.br-pause { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(8,12,30,.55); pointer-events: auto; }
.br-pause .box { padding: 22px; display: flex; flex-direction: column; gap: 12px; min-width: 300px; }
.br-pause h2 { font-family: var(--font-pixel); font-size: 16px; margin: 0; text-align: center; }
.br-help { position: absolute; right: 14px; bottom: 14px; max-width: 320px; text-align: right; font-size: 17px; line-height: 1.1; color: #dfe9ff; text-shadow: 2px 2px 0 var(--ink); opacity: .85; }
`;

const el = <T extends HTMLElement = HTMLElement>(tag: string, cls = '', html = ''): T => {
  const e = document.createElement(tag) as T;
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
};

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const ITEM_NAMES: Record<string, string> = {
  meat: 'Meat', berry: 'Berries', herb: 'Herb', water: 'Water', mud: 'Mud', honey: 'Honeycomb', feather: 'Feather', tusk: 'Tusk', musk: 'Musk', reed: 'Reed',
};
const ITEM_HINTS: Record<string, string> = {
  meat: 'Heals over time. Spoils.', berry: 'Small heal and stamina.', herb: 'Cures bleed, short speed boost.', water: 'Restores stamina. Refill at water.',
  mud: 'Less lava damage for a while.', honey: 'Throw to lure hordes.', feather: 'Glide over lava briefly.', tusk: 'Your next hits cause bleed.', musk: 'Hide your trail, pause the hunted mark.', reed: 'Hide underwater.',
};
const ITEM_ICON: Record<string, string> = { meat: '🍖', berry: '🍒', herb: '🌿', water: '💧', mud: '🟤', honey: '🍯', feather: '🪶', tusk: '🦷', musk: '🧪', reed: '🌾' };
export const itemLabel = (k: string) => ITEM_NAMES[k] ?? k;

export interface HudCtx {
  you: YouState;
  g: Global;
  def: AnimalDef;
  roster: Map<string, RosterEntry>;
  myId: string;
  now: number; // client clock
  hint: string;
  panelOpen: boolean;
}

export class Hud {
  readonly root = el('div');
  private top = el('div', 'br-top');
  private phase = el('div', 'br-phase');
  private ring = el('div', 'br-ring');
  private banner = el('div', 'br-banner');
  private mapCanvas = el<HTMLCanvasElement>('canvas');
  private hunted = el('div', 'br-hunted');
  private feed = el('div', 'br-feed');
  private hp = el('div', 'br-bar hp');
  private sta = el('div', 'br-bar sta sm');
  private xp = el('div', 'br-bar xp sm');
  private lvl = el('div', 'br-lvl');
  private buffs = el('div', 'br-buffs');
  private skillRow = el('div', 'br-row');
  private invRow = el('div', 'br-row');
  private hint = el('div', 'br-hint');
  private chan = el('div', 'br-chan');
  private vig = el('div', 'br-vig');
  private lavaVig = el('div', 'br-lavavig');
  private blind = el('div', 'br-blind');
  private panel = el('div', 'br-panel box');
  private gulag = el('div', 'br-gulag');
  private leader = el('div', 'br-leader');
  private help = el('div', 'br-help');
  private end = el('div', 'br-end');
  private pause = el('div', 'br-pause');
  private skillEls: { root: HTMLElement; name: HTMLElement; cd: HTMLElement; cdt: HTMLElement; k: HTMLElement }[] = [];
  private invEls: { root: HTMLElement; n: HTMLElement; q: HTMLElement }[] = [];
  private mapBase: HTMLCanvasElement | null = null;
  private bannerTimer = 0;
  private bannerQueue: { title: string; sub?: string; ms: number }[] = [];
  private bannerBusy = false;
  private vigTimer = 0;
  private lastPanelKey = '';
  private lastGulagKey = '';
  private lastLeaderKey = '';
  onStat: (k: StatKey) => void = () => {};
  onPick: (tier: number, opt: number) => void = () => {};
  onSwarm: (k: string) => void = () => {};
  onResume: () => void = () => {};
  onSettings: () => void = () => {};
  onLeave: () => void = () => {};
  onBack: () => void = () => {};

  constructor() {
    if (!document.getElementById('br-css')) {
      const st = document.createElement('style');
      st.id = 'br-css';
      st.textContent = CSS;
      document.head.append(st);
    }
    this.root.id = 'br-root';
    this.root.hidden = true;
    this.phase.innerHTML = '<span id="br-ph"></span><b id="br-clock"></b><span id="br-alive"></span>';
    this.top.append(this.phase, this.ring);
    this.mapCanvas.width = 180;
    this.mapCanvas.height = 180;
    const mapbox = el('div', 'br-mapbox');
    mapbox.append(this.mapCanvas, this.hunted);

    const bottom = el('div', 'br-bottom');
    // skills
    ['Q', 'E', 'R', 'F'].forEach((k) => {
      const s = el('div', 'br-slot');
      const kk = el('span', 'k', k);
      const name = el('div', 'n');
      const cd = el('div', 'cd');
      const cdt = el('div', 'cdt');
      s.append(kk, name, cd, cdt);
      this.skillRow.append(s);
      this.skillEls.push({ root: s, name, cd, cdt, k: kk });
    });
    for (let i = 0; i < 6; i++) {
      const s = el('div', 'br-slot sm');
      s.append(el('span', 'k', String(i + 1)));
      const n = el('div', 'n');
      const q = el('span', 'q');
      s.append(n, q);
      this.invRow.append(s);
      this.invEls.push({ root: s, n, q });
    }
    const bars = el('div', '');
    bars.style.cssText = 'width:100%;display:flex;flex-direction:column;gap:3px';
    const hpRow = el('div', '');
    hpRow.style.cssText = 'display:flex;gap:8px;align-items:center';
    this.hp.innerHTML = '<i></i><span></span>';
    this.sta.innerHTML = '<i></i><span></span>';
    this.xp.innerHTML = '<i></i><span></span>';
    this.hp.style.flex = '1';
    hpRow.append(this.lvl, this.hp);
    bars.append(hpRow, this.sta, this.xp);
    const rows = el('div', 'br-row');
    rows.style.alignItems = 'flex-end';
    rows.append(this.skillRow, el('div', '', '&nbsp;'), this.invRow);
    bottom.append(this.buffs, rows, bars);

    this.help.innerHTML = 'WASD move · Shift sprint · C sneak · LMB bite · Q E R F skills · X harvest · G pick up · V drink · 1-6 use · Tab upgrades';
    this.gulag.hidden = true;
    this.leader.hidden = true;
    this.panel.hidden = true;
    this.end.hidden = true;
    this.pause.hidden = true;
    this.hint.hidden = true;
    this.chan.hidden = true;
    this.chan.innerHTML = '<i></i>';
    this.root.append(this.vig, this.lavaVig, this.blind, this.top, this.banner, mapbox, this.feed, this.hint, this.chan, this.panel, this.gulag, this.leader, bottom, this.help, this.end, this.pause);
    document.body.append(this.root);
    this.buildPause();
  }

  show(on: boolean) {
    this.root.hidden = !on;
  }

  // --- minimap -----------------------------------------------------------------------------------

  setTerrain(t: Terrain) {
    const S = 180;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d')!;
    const img = g.createImageData(S, S);
    for (let py = 0; py < S; py++) {
      for (let px = 0; px < S; px++) {
        const x = (px / S - 0.5) * MAP_RADIUS * 2;
        const z = (py / S - 0.5) * MAP_RADIUS * 2;
        const h = t.heightAt(x, z);
        const b = t.biomeAt(x, z);
        let col: number[];
        if (h < -1.2) col = [38, 92, 130];
        else if (h < 0) col = [70, 140, 170];
        else if (b === Biome.Forest) col = [52, 100, 52];
        else if (b === Biome.Wetlands) col = [90, 130, 70];
        else if (b === Biome.Grassland) col = [150, 170, 80];
        else col = h > 20 ? [225, 228, 230] : [138, 134, 118];
        const shade = 1 + Math.max(-0.2, Math.min(0.2, (h - t.heightAt(x - 6, z - 6)) * 0.06));
        const i = (py * S + px) * 4;
        img.data[i] = Math.min(255, col[0] * shade);
        img.data[i + 1] = Math.min(255, col[1] * shade);
        img.data[i + 2] = Math.min(255, col[2] * shade);
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    this.mapBase = c;
  }

  drawMap(me: { x: number; z: number; yaw: number }, g: Global, blips: { x: number; z: number; kind: 'foe' | 'friend' | 'mob' | 'alpha' | 'ping' | 'big'; r?: number }[]) {
    const c = this.mapCanvas.getContext('2d')!;
    const S = 180;
    const k = S / (MAP_RADIUS * 2);
    c.clearRect(0, 0, S, S);
    if (this.mapBase) c.drawImage(this.mapBase, 0, 0);
    // lava outside the ring
    c.save();
    c.beginPath();
    c.rect(0, 0, S, S);
    c.arc(S / 2, S / 2, g.ring * k, 0, Math.PI * 2, true);
    c.fillStyle = 'rgba(255,70,10,.6)';
    c.fill('evenodd');
    c.restore();
    if (g.ringTo > 0 && g.ringTo < g.ring - 1) {
      c.strokeStyle = '#fff';
      c.lineWidth = 2;
      c.setLineDash([4, 3]);
      c.beginPath();
      c.arc(S / 2, S / 2, g.ringTo * k, 0, Math.PI * 2);
      c.stroke();
      c.setLineDash([]);
    }
    for (const b of blips) {
      const px = S / 2 + b.x * k;
      const py = S / 2 + b.z * k;
      switch (b.kind) {
        case 'mob':
          c.fillStyle = 'rgba(255,255,255,.55)';
          c.fillRect(px - 1, py - 1, 2, 2);
          break;
        case 'big':
          c.fillStyle = '#ffb347';
          c.fillRect(px - 2, py - 2, 4, 4);
          break;
        case 'foe':
          c.fillStyle = '#ff4b3a';
          c.beginPath();
          c.arc(px, py, 3, 0, Math.PI * 2);
          c.fill();
          break;
        case 'friend':
          c.fillStyle = '#58e03a';
          c.beginPath();
          c.arc(px, py, 3, 0, Math.PI * 2);
          c.fill();
          break;
        case 'alpha':
          c.fillStyle = '#ff2f2f';
          c.font = '12px sans-serif';
          c.fillText('☠', px - 6, py + 4);
          break;
        case 'ping': {
          const pulse = 6 + ((performance.now() / 120) % 8);
          c.strokeStyle = '#ffd23f';
          c.lineWidth = 2;
          c.beginPath();
          c.arc(px, py, pulse, 0, Math.PI * 2);
          c.stroke();
          break;
        }
      }
    }
    // me
    const px = S / 2 + me.x * k;
    const py = S / 2 + me.z * k;
    c.save();
    c.translate(px, py);
    c.rotate(-me.yaw + Math.PI);
    c.fillStyle = '#fff';
    c.strokeStyle = '#0b0b1a';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -6);
    c.lineTo(4, 5);
    c.lineTo(0, 2);
    c.lineTo(-4, 5);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }

  // --- messages -----------------------------------------------------------------------------------

  announce(title: string, sub = '', ms = 3200) {
    this.bannerQueue.push({ title, sub, ms });
    if (!this.bannerBusy) this.nextBanner();
  }
  private nextBanner() {
    const b = this.bannerQueue.shift();
    if (!b) {
      this.bannerBusy = false;
      this.banner.classList.remove('on');
      return;
    }
    this.bannerBusy = true;
    this.banner.innerHTML = '';
    this.banner.append(document.createTextNode(b.title));
    if (b.sub) this.banner.append(el('small', '', b.sub));
    this.banner.classList.add('on');
    clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => {
      this.banner.classList.remove('on');
      this.bannerTimer = window.setTimeout(() => this.nextBanner(), 350);
    }, b.ms);
  }

  feedLine(text: string, mine = false) {
    const d = el('div', mine ? 'me' : '');
    d.textContent = text;
    this.feed.append(d);
    while (this.feed.children.length > 6) this.feed.firstElementChild!.remove();
    setTimeout(() => d.classList.add('old'), 7000);
    setTimeout(() => d.remove(), 7800);
  }

  flashHurt() {
    this.vig.style.opacity = '1';
    clearTimeout(this.vigTimer);
    this.vigTimer = window.setTimeout(() => (this.vig.style.opacity = '0'), 160);
  }

  // --- the frame ----------------------------------------------------------------------------------

  private skillFor(def: AnimalDef, you: YouState, slot: number): { skill: Skill | null; locked: string } {
    if (slot < 2) return { skill: def.sig[slot], locked: '' };
    const tier = slot === 2 ? 0 : 2;
    const p = you.picks[tier];
    if (p >= 0) return { skill: def.unlock[tier][p], locked: '' };
    return { skill: null, locked: you.lvl >= UNLOCK_LEVELS[tier] ? 'Pick (Tab)' : `Lv ${UNLOCK_LEVELS[tier]}` };
  }

  render(c: HudCtx) {
    const { you, g, def } = c;
    const role = you.role; // 0 alive, 1 gulag, 2 leader, 3 out
    const t = g.time;
    (this.root.querySelector('#br-ph') as HTMLElement).textContent = ['Scatter', 'Farm', 'Clash', 'Cull', 'Final'][g.phase];
    (this.root.querySelector('#br-clock') as HTMLElement).textContent = fmt(t);
    (this.root.querySelector('#br-alive') as HTMLElement).textContent = `${g.alive} alive${g.leaders ? ` · ${g.leaders} leaders` : ''}`;
    // lava status
    if (g.ringAt > t) {
      const left = g.ringAt - t;
      const warn = left <= 30;
      this.ring.textContent = warn ? `LAVA CLOSES IN ${Math.ceil(left)}s (ring ${g.ringN})` : `Next lava ring in ${fmt(left)}`;
      this.ring.classList.toggle('warn', warn);
    } else if (g.ringTo > 0 && g.ringTo < g.ring - 1) {
      this.ring.textContent = 'The lava is closing in!';
      this.ring.classList.add('warn');
    } else {
      this.ring.textContent = g.ringN >= 5 ? 'Final stand: the lava is rising!' : 'The lava has settled — for now';
      this.ring.classList.remove('warn');
    }

    const body = role === 0 || role === 1 || role === 2;
    this.skillRow.parentElement!.parentElement!.style.display = role === 3 ? 'none' : '';
    // bars
    const hpPct = Math.max(0, Math.min(100, (you.hp / you.maxHp) * 100));
    (this.hp.firstElementChild as HTMLElement).style.width = `${hpPct}%`;
    (this.hp.lastElementChild as HTMLElement).textContent = `${Math.ceil(you.hp)} / ${you.maxHp}`;
    (this.sta.firstElementChild as HTMLElement).style.width = `${Math.max(0, Math.min(100, (you.sta / you.maxSta) * 100))}%`;
    (this.sta.lastElementChild as HTMLElement).textContent = 'Stamina';
    (this.xp.firstElementChild as HTMLElement).style.width = role === 0 ? `${Math.min(100, (you.xp / you.need) * 100)}%` : '0%';
    (this.xp.lastElementChild as HTMLElement).textContent = role === 0 ? (you.lvl >= 20 ? 'MAX' : `${you.xp} / ${you.need} XP`) : '';
    this.xp.style.display = role === 0 ? '' : 'none';
    this.lvl.textContent = role === 2 ? `T${you.swarm?.tier ?? 1}` : role === 1 ? 'GULAG' : `LV ${you.lvl}`;
    this.lvl.classList.toggle('br-point', role === 0 && (you.pts > 0 || this.canPick(you)));

    // buffs
    const buffs = you.buffs.map((b) => `<span>${b.replace(/_/g, ' ')}</span>`).join('') + (you.ability ? `<span>${you.ability}</span>` : '');
    if (this.buffs.innerHTML !== buffs) this.buffs.innerHTML = buffs;

    // skill slots
    for (let i = 0; i < 4; i++) {
      const e = this.skillEls[i];
      let name = '';
      let ready = false;
      let locked = false;
      if (role === 2) {
        const sw = SWARMS.find((s) => s.id === you.swarm?.kind);
        name = i === 0 ? (sw?.skill.name ?? 'Skill') : i === 1 ? (you.swarm && you.swarm.tier >= 3 ? 'Frenzy' : 'Tier III') : '';
        locked = i > 1 || (i === 1 && !!you.swarm && you.swarm.tier < 3);
      } else {
        const s = this.skillFor(def, you, i);
        name = s.skill?.name ?? s.locked;
        locked = !s.skill;
      }
      const cd = you.cds[i];
      const max = Math.max(0.1, you.cdMax[i] || 1);
      ready = !locked && cd <= 0.05;
      e.name.textContent = name;
      e.root.classList.toggle('locked', locked);
      e.root.classList.toggle('ready', ready);
      e.cd.style.height = locked ? '0' : `${Math.min(100, (cd / max) * 100)}%`;
      e.cdt.textContent = !locked && cd > 0.05 ? (cd >= 10 ? String(Math.ceil(cd)) : cd.toFixed(1)) : '';
    }
    // inventory
    this.invRow.style.display = role === 0 ? '' : 'none';
    for (let i = 0; i < 6; i++) {
      const it: InvItem | null = you.inv[i];
      const e = this.invEls[i];
      if (!it) {
        e.n.textContent = '';
        e.q.textContent = '';
        e.root.title = '';
        e.root.style.opacity = '.5';
        continue;
      }
      e.root.style.opacity = it.k === 'water' && it.n === 0 ? '.55' : '1';
      e.n.innerHTML = `${ITEM_ICON[it.k] ?? ''}<br>${ITEM_NAMES[it.k]}`;
      e.q.textContent = it.k === 'water' ? `${it.n}/2` : it.n > 1 ? String(it.n) : '';
      e.root.title = ITEM_HINTS[it.k] ?? '';
    }
    // hint + channel
    const hint = body && role === 0 ? c.hint : '';
    this.hint.hidden = !hint;
    if (hint && this.hint.textContent !== hint) this.hint.textContent = hint;
    this.chan.hidden = !you.channel;
    if (you.channel) (this.chan.firstElementChild as HTMLElement).style.width = `${100 - (you.channel.left / you.channel.total) * 100}%`;

    // hunted list
    const hl = g.top
      .map(([id, lvl], i) => `<div>${i === 0 ? '🎯 ' : ''}${c.roster.get(id)?.name ?? '?'} · Lv ${lvl}${id === c.myId ? ' (you)' : ''}</div>`)
      .join('');
    const hh = hl ? `<div style="color:var(--yellow);font-size:16px;font-family:var(--font-pixel)">HUNTED</div>${hl}` : '';
    if (this.hunted.innerHTML !== hh) this.hunted.innerHTML = hh;

    this.renderPanel(c);
    this.renderGulag(c);
    this.renderLeader(c);
    this.blind.style.opacity = you.buffs.includes('blind') ? '0.8' : '0';
  }

  private canPick(you: YouState) {
    return UNLOCK_LEVELS.some((l, i) => you.lvl >= l && you.picks[i] === -1);
  }

  private renderPanel(c: HudCtx) {
    const { you, def } = c;
    const open = c.panelOpen && you.role === 0;
    this.panel.hidden = !open;
    if (!open) return;
    const key = JSON.stringify([you.lvl, you.pts, you.alloc, you.picks, def.id]);
    if (key === this.lastPanelKey) return;
    this.lastPanelKey = key;
    this.panel.innerHTML = '';
    this.panel.append(el('h3', '', `${def.name} · Level ${you.lvl}`));
    this.panel.append(el('div', '', `<span style="color:var(--yellow)">${you.pts}</span> stat point${you.pts === 1 ? '' : 's'} to spend`));
    STAT_KEYS.forEach((k, i) => {
      const row = el('div', 'br-stat');
      row.append(el('span', 'key', String(i + 1)), el('span', 'nm', STAT_NAMES[k]), el('span', '', String(def.stats[k] + you.alloc[k])));
      const b = el<HTMLButtonElement>('button', 'btn primary', '+');
      b.disabled = you.pts <= 0;
      b.addEventListener('click', () => this.onStat(k));
      row.append(b);
      this.panel.append(row);
    });
    const tiers = [0, 1, 2, 3];
    this.panel.append(el('h3', '', 'Skills'));
    const inn = def.innate;
    this.panel.append(el('div', 'br-pick', `<div class="t"><b style="color:var(--yellow)">${inn.name}</b> (innate): ${inn.desc}</div>`));
    for (const t of tiers) {
      const box = el('div', 'br-pick');
      const need = UNLOCK_LEVELS[t];
      const chosen = you.picks[t];
      box.append(el('div', 't', `Level ${need} · ${t % 2 === 0 ? 'active' : 'passive'}${you.lvl < need ? ' (locked)' : chosen < 0 ? ` — press Z or X` : ''}`));
      const opts = el('div', 'opts');
      def.unlock[t].forEach((s, o) => {
        const d = el('div', `opt${chosen === o ? ' chosen' : ''}${you.lvl < need || (chosen >= 0 && chosen !== o) ? ' off' : ''}`, `<b>${s.name}</b>${s.desc}`);
        d.addEventListener('click', () => this.onPick(t, o));
        opts.append(d);
      });
      box.append(opts);
      this.panel.append(box);
    }
    this.panel.append(el('div', 'br-pick', '<div class="t">Keys: 1-5 spend a point · Z / X pick the first open skill · Tab closes</div>'));
  }

  private renderGulag(c: HudCtx) {
    const y = c.you;
    const on = y.role === 1 && !!y.gulag;
    this.gulag.hidden = !on;
    if (!on || !y.gulag) return;
    const gu = y.gulag;
    const key = `${gu.phase}|${gu.foe}|${Math.ceil(gu.left)}|${gu.choose.join()}`;
    if (key === this.lastGulagKey) return;
    this.lastGulagKey = key;
    const picked = c.roster.get(c.myId)?.swarm;
    this.gulag.innerHTML = '';
    this.gulag.append(el('h2', '', 'THE GULAG'));
    this.gulag.append(
      el(
        'p',
        '',
        gu.phase === 'duel'
          ? `Duel vs <b style="color:var(--yellow)">${gu.foe}</b> · ${Math.ceil(gu.left)}s<br>Equal stats. Win to lead a bigger swarm.`
          : 'Waiting for an opponent. If nobody comes, you fight the Warden.<br>Gulag voice chat is separate from the match.',
      ),
    );
    const row = el('div', 'br-choice');
    for (const k of gu.choose) {
      const sw = SWARMS.find((s) => s.id === k)!;
      const b = el<HTMLButtonElement>('button', `btn ${picked === k ? 'primary' : 'glass'}`, `${sw.name} — ${sw.skill.name}`);
      b.addEventListener('click', () => this.onSwarm(k));
      row.append(b);
    }
    this.gulag.append(el('p', '', 'Choose your swarm:'), row);
  }

  private renderLeader(c: HudCtx) {
    const y = c.you;
    const on = y.role === 2 && !!y.swarm;
    this.leader.hidden = !on;
    if (!on || !y.swarm) return;
    const s = y.swarm;
    const sw = SWARMS.find((x) => x.id === s.kind)!;
    const key = JSON.stringify(s);
    if (key === this.lastLeaderKey) return;
    this.lastLeaderKey = key;
    const prog = s.next ? `${s.eaten}/${s.next} eaten to grow` : 'Max tier';
    this.leader.innerHTML =
      `<b>${sw.name}</b> · Tier ${s.tier} · swarm ${s.units}/${s.want} · order: <b>${s.order}</b><br>` +
      (s.respawn > 0 ? `Your leader fell. Back in <b>${Math.ceil(s.respawn)}s</b>` : `1 attack · 2 scatter · 3 guard · Q ${sw.skill.name} · G eat food · ${prog}`);
  }

  // --- end / pause -----------------------------------------------------------------------------------

  showEnd(res: { winner: string; team: number; results: { id: string; name: string; animal: string; lvl: number; kills: number; place: number; dmg: number }[] }, myId: string, myTeam: number) {
    this.end.hidden = false;
    this.end.innerHTML = '';
    const box = el('div', 'box');
    const won = res.team === myTeam;
    box.append(el('h2', '', won ? 'VICTORY!' : 'Match over'));
    box.append(el('div', '', `Last one standing: <b style="color:var(--yellow)">${res.winner}</b>`));
    const rows = res.results
      .slice(0, 20)
      .map((r) => `<tr class="${r.id === myId ? 'me' : ''}"><td>${r.place}</td><td>${r.name}</td><td>${ANIMAL_BY_ID.get(r.animal)?.name ?? r.animal}</td><td>Lv ${r.lvl}</td><td>${r.kills}</td><td>${r.dmg}</td></tr>`)
      .join('');
    box.append(el('table', '', `<tr><th>#</th><th>Player</th><th>Animal</th><th>Level</th><th>Kills</th><th>Damage</th></tr>${rows}`));
    const b = el<HTMLButtonElement>('button', 'btn primary', 'Back to the lobby');
    b.addEventListener('click', () => this.onBack());
    box.append(b);
    this.end.append(box);
  }
  hideEnd() {
    this.end.hidden = true;
  }

  private buildPause() {
    const box = el('div', 'box');
    box.append(el('h2', '', 'Paused'));
    const resume = el<HTMLButtonElement>('button', 'btn primary', 'Resume');
    resume.addEventListener('click', () => this.onResume());
    const settings = el<HTMLButtonElement>('button', 'btn glass', 'Settings');
    settings.addEventListener('click', () => this.onSettings());
    const leave = el<HTMLButtonElement>('button', 'btn danger', 'Leave the match');
    leave.addEventListener('click', () => this.onLeave());
    box.append(resume, settings, leave, el('div', '', '<small style="font-size:18px;color:#cfe3ff">The match keeps running. If you leave, an AI takes your animal.</small>'));
    this.pause.append(box);
  }
  showPause(on: boolean) {
    this.pause.hidden = !on;
  }
  get pauseVisible() {
    return !this.pause.hidden;
  }
  setLava(on: boolean) {
    this.lavaVig.style.opacity = on ? '1' : '0';
  }
  isEndVisible() {
    return !this.end.hidden;
  }
}
