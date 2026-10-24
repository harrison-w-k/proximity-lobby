// The sandbox's animal picker: every animal of every stage, one click to preview and one to play.
// Search and two filters narrow the grid; the right-hand side shows the animal on a stage, its stats and skills, and its colours.
import { ANIMALS, ANIMAL_BY_ID, CLASS_BY_ID, STAT_KEYS, STAT_NAMES, TREES, type AnimalDef } from '../../../shared/arena/animals';
import { PAINT_SWATCHES, hex6, type Paint } from '../../../shared/arena/paint';
import { ANIMAL_EMOJI } from './emoji';
import { loadPaint, savePaint } from './paintStore';
import { Showcase } from './showcase';

const ACCENTS: Record<string, string> = { hunter: '#e8a23a', titan: '#6b9cff', ambusher: '#6fcf5a', brawler: '#ff6a5a', skirmisher: '#c78bff', guardian: '#4fd0d0' };
const STAT_MAX = Math.max(...ANIMALS.flatMap((a) => STAT_KEYS.map((k) => a.stats[k])));

const CSS = `
#picker { position: fixed; inset: 0; z-index: 26; display: flex; align-items: center; justify-content: center; padding: 14px; background: radial-gradient(circle at 50% 20%, rgba(40,110,40,.6), rgba(2,10,6,.96)); animation: pkfade .2s ease-out; }
#picker[hidden] { display: none; }
@keyframes pkfade { from { opacity: 0; } }
#picker .pk { width: min(1180px, 100%); height: min(92vh, 780px); display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
#picker .pk-head { display: flex; align-items: center; gap: 16px; padding: 12px 20px; }
#picker .pk-head h1 { margin: 0; font-size: 30px; line-height: 1; }
#picker .pk-head p { margin: 2px 0 0; font-size: 16px; opacity: .8; }
#picker .pk-head .grow { flex: 1; min-width: 0; }
#picker .pk-body { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(300px, 1fr); gap: 16px; padding: 14px 18px 18px; min-height: 0; }
#picker .pk-left { display: flex; flex-direction: column; gap: 10px; min-height: 0; }
#picker .pk-search { width: 100%; padding: 10px 14px; font-size: 18px; }
#picker .pk-filters { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
#picker .pk-filters .sep { width: 2px; height: 22px; background: rgba(139,255,74,.25); margin: 0 4px; }
#picker .fl { padding: 5px 11px; font-size: 15px; font-weight: 700; cursor: pointer; border: 2px solid var(--ink); border-radius: 999px; background: #123022; color: var(--text); }
#picker .fl:hover { background: #1b4630; }
#picker .fl.on { background: linear-gradient(#c7ff8f, #6fdc2e); color: var(--ink); }
#picker .pk-grid { flex: 1; min-height: 0; overflow: auto; display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; align-content: start; padding: 4px 6px 8px 2px; }
#picker .tile { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 10px 6px 8px; cursor: pointer; border: 3px solid var(--ink); border-radius: 14px 7px 14px 7px; background: linear-gradient(#17402a, #0d2418); color: var(--text); font: inherit; box-shadow: inset 0 0 0 2px rgba(139,255,74,.28), 0 3px 0 rgba(0,0,0,.5); transition: transform .08s; }
#picker .tile:hover { transform: translateY(-2px); box-shadow: inset 0 0 0 2px var(--portal), 0 0 16px rgba(139,255,74,.45), 0 3px 0 rgba(0,0,0,.5); }
#picker .tile .em { font-size: 34px; line-height: 1.1; }
#picker .tile b { font-size: 15px; line-height: 1.1; text-align: center; font-weight: 700; }
#picker .tile .pips { font-size: 10px; letter-spacing: 2px; color: var(--goo); }
#picker .tile .cl { position: absolute; top: 4px; left: 6px; font-size: 13px; opacity: .9; }
#picker .tile.sel { background: linear-gradient(#c7ff8f, #4fbd1a); color: var(--ink); box-shadow: inset 0 2px 0 rgba(255,255,255,.5), 0 0 0 3px var(--goo), 0 0 22px rgba(139,255,74,.7), 0 4px 0 rgba(0,0,0,.5); }
#picker .tile.sel .pips { color: #5a3000; }
#picker .tile.cur::after { content: 'YOU'; position: absolute; top: 4px; right: 6px; font-size: 10px; font-weight: 800; padding: 0 5px; border-radius: 6px; background: var(--goo); color: var(--ink); }
#picker .pk-empty { grid-column: 1 / -1; text-align: center; padding: 40px 10px; opacity: .75; font-size: 18px; }
#picker .pk-right { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; padding-right: 4px; }
#picker .pk-stage { position: relative; flex: 0 0 auto; height: clamp(190px, 30vh, 280px); border-radius: 18px 8px 18px 8px; border: 3px solid var(--ink); overflow: hidden; background: radial-gradient(ellipse at 50% 80%, rgba(139,255,74,.4), transparent 62%), linear-gradient(#0f3a22, #04140b); box-shadow: inset 0 0 0 3px rgba(139,255,74,.55), 0 5px 0 rgba(0,0,0,.5); }
#picker .pk-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#picker .pk-stage .hint { position: absolute; right: 10px; bottom: 6px; font-size: 13px; opacity: .65; pointer-events: none; }
#picker .pk-name { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
#picker .pk-name b { font-family: var(--font-display); font-size: 32px; letter-spacing: .05em; text-transform: uppercase; line-height: 1; }
#picker .pk-name span { padding: 1px 10px; border-radius: 999px; border: 2px solid var(--ink); font-weight: 800; font-size: 14px; color: var(--ink); background: var(--portal); }
#picker .pk-blurb { font-size: 16px; line-height: 1.25; opacity: .9; }
#picker .pk-bars { display: grid; grid-template-columns: 74px 1fr 28px; gap: 3px 8px; align-items: center; font-size: 14px; font-weight: 700; }
#picker .pk-bars i { display: block; height: 10px; border-radius: 999px; border: 2px solid var(--ink); background: linear-gradient(#c7ff8f, #3fb21c); }
#picker .pk-bars em { font-style: normal; text-align: right; color: var(--goo); }
#picker .pk-skills { display: grid; gap: 4px; font-size: 14px; line-height: 1.2; }
#picker .pk-skills div { padding: 4px 10px; background: rgba(0,0,0,.3); border-left: 4px solid var(--portal); border-radius: 8px; }
#picker .pk-skills b { color: var(--goo); }
#picker .pk-colours { background: rgba(0,0,0,.25); border-radius: 12px; padding: 4px 12px 6px; }
#picker .pk-colours summary { cursor: pointer; font-weight: 800; font-size: 15px; color: var(--goo); padding: 3px 0; }
#picker .pk-colours[open] summary { margin-bottom: 6px; }
#picker .pk-paint { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; align-items: center; font-size: 14px; font-weight: 700; }
#picker .pk-paint .sws { display: flex; flex-wrap: wrap; gap: 5px; }
#picker .sw { width: 22px; height: 22px; padding: 0; border-radius: 50%; border: 2px solid var(--ink); cursor: pointer; box-shadow: 0 2px 0 rgba(0,0,0,.5); }
#picker .sw:hover { transform: scale(1.15); }
#picker .sw.on { box-shadow: 0 0 0 3px var(--goo), 0 2px 0 rgba(0,0,0,.5); }
#picker .sw.nat { background: linear-gradient(135deg, #e9ffd8 0 50%, #2f8f6a 50% 100%); }
#picker .pk-go { position: sticky; bottom: 0; margin-top: auto; padding-top: 6px; display: flex; flex-direction: column; gap: 4px; background: linear-gradient(transparent, rgba(5,20,13,.95) 30%); }
#picker .pk-go .btn { width: 100%; font-size: 24px; }
#picker .pk-go small { text-align: center; opacity: .65; font-size: 13px; }
@media (max-width: 820px) { #picker .pk-body { grid-template-columns: 1fr; overflow: auto; } #picker .pk { height: 96vh; } #picker .pk-grid { max-height: 38vh; flex: none; } }
`;

export class AnimalPicker {
  readonly el = document.createElement('div');
  onChoose: (id: string, paint: Paint | null) => void = () => {};
  onOpen: () => void = () => {};
  onClose: () => void = () => {};
  /** The animal you are currently playing (marked in the grid). */
  current = 'house_cat';
  private show = new Showcase();
  private sel = 'house_cat';
  private query = '';
  private tree = 'all';
  private stage = 0;
  private grid!: HTMLElement;
  private search!: HTMLInputElement;
  private right!: HTMLElement;
  private stageBox!: HTMLElement;
  private shown = false;

  get isOpen() {
    return this.shown;
  }

  constructor() {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.append(style);
    this.el.id = 'picker';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="pk box" role="dialog" aria-label="Choose an animal">
        <header class="pk-head panel-head">
          <div class="grow"><div class="eyebrow">Sandbox</div><h1>Pick any animal</h1></div>
          <div class="esc-hint"><span class="key">Esc</span> close</div>
          <button class="btn glass small" type="button" data-close>✕</button>
        </header>
        <div class="pk-body">
          <div class="pk-left">
            <input class="pk-search" type="text" placeholder="Search animals, roles or classes…  ( / )" autocomplete="off" spellcheck="false" />
            <div class="pk-filters"></div>
            <div class="pk-grid" role="listbox" aria-label="Animals"></div>
          </div>
          <div class="pk-right">
            <div class="pk-stage"><div class="hint">Drag to turn · click to make it move</div></div>
            <div class="pk-info"></div>
          </div>
        </div>
      </div>`;
    document.body.append(this.el);
    this.grid = this.el.querySelector('.pk-grid')!;
    this.search = this.el.querySelector('.pk-search')!;
    this.right = this.el.querySelector('.pk-info')!;
    this.stageBox = this.el.querySelector('.pk-stage')!;
    this.stageBox.prepend(this.show.canvas);
    this.show.zoom = 0.62;
    this.buildFilters();
    this.search.addEventListener('input', () => {
      this.query = this.search.value.trim().toLowerCase();
      this.renderGrid();
    });
    this.el.querySelector('[data-close]')!.addEventListener('click', () => this.close());
    this.el.addEventListener('mousedown', (e) => {
      if (e.target === this.el) this.close();
    });
    window.addEventListener('keydown', (e) => {
      if (!this.shown) return;
      e.stopPropagation(); // a modal: the game's own keys (mute, chat...) stay quiet while it is open
      const typing = document.activeElement === this.search;
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Enter' && (typing || document.activeElement?.tagName !== 'BUTTON')) {
        e.preventDefault();
        this.play();
      } else if (!typing && e.key === '/') {
        e.preventDefault();
        this.search.focus();
      } else if (!typing && e.key.startsWith('Arrow')) {
        e.preventDefault();
        this.step(e.key);
      }
    }, true);
    window.addEventListener('resize', () => this.shown && this.show.resize());
    this.renderGrid();
  }

  open() {
    if (this.shown) return;
    this.shown = true;
    this.sel = this.current;
    this.el.hidden = false;
    this.renderGrid();
    this.renderInfo();
    this.show.start();
    this.show.setAnimal(this.sel, loadPaint(this.sel));
    // the stage only has a size once the panel is on screen
    requestAnimationFrame(() => this.shown && this.show.resize());
    this.onOpen();
    this.scrollToSel();
  }

  close() {
    if (!this.shown) return;
    this.shown = false;
    this.el.hidden = true;
    this.show.stop();
    this.onClose();
  }

  private buildFilters() {
    const box = this.el.querySelector('.pk-filters')!;
    const mk = (label: string, on: () => boolean, set: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'fl';
      b.textContent = label;
      b.addEventListener('click', () => {
        set();
        this.renderGrid();
        refresh();
      });
      b.dataset.on = '';
      (b as unknown as { isOn: () => boolean }).isOn = on;
      return b;
    };
    const btns: HTMLButtonElement[] = [];
    const add = (b: HTMLButtonElement) => (btns.push(b), box.append(b));
    add(mk('All', () => this.tree === 'all', () => (this.tree = 'all')));
    for (const t of TREES) add(mk(`${t.icon} ${t.name.split(' and ')[0]}`, () => this.tree === t.id, () => (this.tree = t.id)));
    const sep = document.createElement('span');
    sep.className = 'sep';
    box.append(sep);
    for (const s of [0, 1, 2, 3]) add(mk(s ? `Stage ${s}` : 'Any stage', () => this.stage === s, () => (this.stage = s)));
    const refresh = () => btns.forEach((b) => b.classList.toggle('on', (b as unknown as { isOn: () => boolean }).isOn()));
    refresh();
  }

  private visible(): AnimalDef[] {
    const q = this.query;
    return ANIMALS.filter((a) => {
      if (this.tree !== 'all' && a.tree !== this.tree) return false;
      if (this.stage && a.stage !== this.stage) return false;
      if (!q) return true;
      const cls = CLASS_BY_ID.get(a.cls)?.name ?? '';
      return `${a.name} ${a.role} ${cls} ${a.id.replace(/_/g, ' ')}`.toLowerCase().includes(q);
    });
  }

  private renderGrid() {
    const list = this.visible();
    this.grid.replaceChildren();
    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'pk-empty';
      e.textContent = 'No animal matches that. Try a shorter search.';
      this.grid.append(e);
      return;
    }
    for (const a of list) {
      const t = document.createElement('button');
      t.type = 'button';
      t.className = 'tile' + (a.id === this.sel ? ' sel' : '') + (a.id === this.current ? ' cur' : '');
      t.dataset.id = a.id;
      t.setAttribute('role', 'option');
      t.title = `${a.name} · ${a.role}`;
      t.innerHTML = `<span class="cl">${CLASS_BY_ID.get(a.cls)?.icon ?? ''}</span><span class="em">${ANIMAL_EMOJI[a.id] ?? '🐾'}</span><b>${a.name}</b><span class="pips">${'●'.repeat(a.stage)}</span>`;
      t.addEventListener('click', () => this.select(a.id));
      t.addEventListener('dblclick', () => {
        this.select(a.id);
        this.play();
      });
      this.grid.append(t);
    }
  }

  private scrollToSel() {
    this.grid.querySelector<HTMLElement>(`.tile[data-id="${this.sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  private step(key: string) {
    const ids = this.visible().map((a) => a.id);
    if (!ids.length) return;
    const cols = Math.max(1, Math.floor(this.grid.clientWidth / 120));
    const d = key === 'ArrowLeft' ? -1 : key === 'ArrowRight' ? 1 : key === 'ArrowUp' ? -cols : cols;
    const i = Math.max(0, Math.min(ids.length - 1, ids.indexOf(this.sel) + d));
    this.select(ids[i]);
    this.scrollToSel();
  }

  private select(id: string) {
    if (!ANIMAL_BY_ID.has(id)) return;
    this.sel = id;
    this.grid.querySelectorAll<HTMLElement>('.tile').forEach((t) => t.classList.toggle('sel', t.dataset.id === id));
    this.show.setAnimal(id, loadPaint(id));
    const a = ANIMAL_BY_ID.get(id)!;
    this.show.setAccent(parseInt((ACCENTS[a.cls] ?? '#8bff4a').slice(1), 16));
    this.renderInfo();
  }

  private play() {
    const a = ANIMAL_BY_ID.get(this.sel);
    if (!a) return;
    this.current = a.id;
    this.onChoose(a.id, loadPaint(a.id) ?? null);
    this.close();
  }

  private renderInfo() {
    const a = ANIMAL_BY_ID.get(this.sel);
    if (!a) return;
    const cls = CLASS_BY_ID.get(a.cls);
    const bars = STAT_KEYS.map((k) => `<span>${STAT_NAMES[k]}</span><i style="width:${Math.round((a.stats[k] / STAT_MAX) * 100)}%"></i><em>${a.stats[k]}</em>`).join('');
    const skill = (tag: string, s: { name: string; desc: string } | null) => (s ? `<div><b>${tag} · ${s.name}</b> ${s.desc}</div>` : '');
    const swim = a.swim === 'water' ? 'Fish: starts in water, slow on land' : a.swim === 'semi' ? 'Strong swimmer' : 'Land animal';
    this.right.innerHTML = `
      <div class="pk-name"><b>${a.name}</b><span>${cls?.icon ?? ''} ${cls?.name ?? ''}</span></div>
      <div class="pk-blurb"><b>${a.role}</b> · stage ${a.stage} · ${a.size} · ${swim}<br>${a.blurb}</div>
      <div class="pk-bars">${bars}</div>
      <div class="pk-skills">${skill('Passive', a.innate)}${skill('Q', a.skill)}${skill('E', a.skill2)}</div>
      <details class="pk-colours"><summary>🎨 Colours</summary><div class="pk-paint"></div></details>
      <div class="pk-go"><button class="btn primary" type="button">Play as ${a.name}</button><small>Enter to play · double-click works too</small></div>`;
    this.right.querySelector('.pk-go .btn')!.addEventListener('click', () => this.play());
    this.renderPaint(a);
  }

  private renderPaint(a: AnimalDef) {
    const box = this.right.querySelector<HTMLElement>('.pk-paint')!;
    const cur: Paint = loadPaint(a.id) ?? [-1, -1];
    const row = (label: string, idx: 0 | 1) => {
      const lab = document.createElement('span');
      lab.textContent = label;
      const sws = document.createElement('div');
      sws.className = 'sws';
      const mk = (val: number) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sw' + (val === -1 ? ' nat' : '') + (cur[idx] === val ? ' on' : '');
        if (val !== -1) b.style.background = hex6(val);
        b.title = val === -1 ? 'Natural colour' : hex6(val);
        b.addEventListener('click', () => {
          const next: Paint = [cur[0], cur[1]];
          next[idx] = val;
          savePaint(a.id, next[0] === -1 && next[1] === -1 ? undefined : next);
          this.show.setPaint(loadPaint(a.id));
          this.renderPaint(a);
        });
        return b;
      };
      sws.append(mk(-1), ...PAINT_SWATCHES.map(mk));
      box.append(lab, sws);
    };
    box.replaceChildren();
    row('Fur', 0);
    row('Accent', 1);
  }
}
