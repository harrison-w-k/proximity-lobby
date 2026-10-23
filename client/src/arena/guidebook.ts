// The guidebook: every item, every animal with its stats and abilities, and what each strike chain does.
// Everything here is read from the same shared tables the game runs on, so it can never drift out of date.
import { ANIMALS, CLASSES, EVOLVE_LEVELS, STAGE_BUDGET, STAT_KEYS, STAT_NAMES, TREES, type AnimalDef } from '../../../shared/arena/animals';
import { STRIKE_BASE, comboOf, type Strike } from '../../../shared/arena/combat';
import { ANIMAL_EMOJI } from './emoji';
import { ITEM_HINTS, ITEM_ICON, ITEM_NAMES } from './hud';

const CSS = `
#br-guide { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center; justify-content: center; padding: 14px; background: rgba(6,10,8,.86); }
#br-guide[hidden] { display: none; }
#br-guide .gb { width: min(1000px, 100%); height: min(92vh, 860px); display: flex; flex-direction: column; gap: 8px; padding: 14px 20px; }
#br-guide h2 { margin: 0; font-family: 'Limelight', Georgia, serif; font-weight: 400; font-size: 30px; color: var(--amber); letter-spacing: .05em; text-transform: uppercase; }
#br-guide .gtabs { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
#br-guide .gtabs .chip { font-family: var(--font); font-weight: 600; font-size: 17px; padding: 2px 14px; border-radius: 999px; border: 3px solid var(--ink); background: linear-gradient(#2f9a98, #217f7e); color: var(--cream); cursor: pointer; }
#br-guide .gtabs .chip.on { background: linear-gradient(#ffb8a8, #ff6f7d); color: #3a0f1a; }
#br-guide .gtabs .x { margin-left: auto; }
#br-guide .body { flex: 1; overflow: auto; padding-right: 6px; font-size: 17px; line-height: 1.25; color: var(--cream); }
#br-guide h3 { margin: 14px 0 6px; font-size: 21px; color: var(--amber); }
#br-guide .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 8px; }
#br-guide .card { background: rgba(0,0,0,.28); border-radius: 12px; padding: 8px 12px; border-left: 4px solid var(--leaf); }
#br-guide .card b { color: var(--amber); }
#br-guide .card .ic { font-size: 26px; margin-right: 6px; }
#br-guide .animal { background: rgba(0,0,0,.28); border-radius: 12px; padding: 8px 12px; border-left: 4px solid var(--leaf); display: grid; gap: 4px; }
#br-guide .animal h4 { margin: 0; font-size: 19px; color: var(--cream); }
#br-guide .animal h4 small { color: #ecdcb2; font-weight: 400; font-size: 14px; }
#br-guide .animal .bl { font-style: italic; color: #ecdcb2; font-size: 15px; }
#br-guide .animal .ab { font-size: 15px; }
#br-guide .animal .ab b { color: var(--amber); }
#br-guide .animal .wk { font-size: 15px; color: #ff9a82; }
#br-guide .st { display: grid; grid-template-columns: 56px 1fr 26px; gap: 1px 8px; align-items: center; font-size: 13px; }
#br-guide .st i { display: block; height: 8px; border-radius: 99px; background: linear-gradient(#ffd96a, #e0a020); border: 1px solid var(--ink); }
#br-guide .st em { font-style: normal; text-align: right; color: var(--amber); }
#br-guide .chain { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 13px; }
#br-guide .chain span { padding: 1px 8px; border-radius: 99px; background: rgba(255,255,255,.12); border: 2px solid var(--ink); }
#br-guide .chain span.h { background: #a8352f; }
#br-guide .chain span u { text-decoration: none; opacity: .75; }
#br-guide table { border-collapse: collapse; width: 100%; font-size: 15px; }
#br-guide td, #br-guide th { padding: 3px 8px; border-bottom: 1px solid rgba(255,255,255,.12); text-align: left; }
#br-guide th { color: var(--amber); }
`;

const FX_TEXT: Record<string, string> = { bleed: 'causes bleeding', slow: 'slows the target', knock: 'knocks the target back', stagger: 'knocks the target out of its own wind-up' };
const STRIKE_TEXT: Record<string, string> = {
  claw: 'A raking swipe. The everyday strike.', rake: 'A quick paw flurry: fast but light.', bite: 'A snap of the jaws.', lunge: 'A leap that covers extra ground.',
  jab: 'A fast thrust (sting, stab or peck) with long reach.', sweep: 'A spin or tail whip: a very wide arc.', rend: 'Both forelimbs tearing down: heavy damage.',
  slam: 'Rear up and crash down. Slow, breaks a guard.', ram: 'A head-down charge that shoves the target back.', toss: 'An upward fling. Slow, breaks a guard.',
};

type Tab = 'basics' | 'items' | 'animals' | 'strikes';
const TABS: [Tab, string][] = [['basics', '📜 How to play'], ['items', '🎒 Items'], ['animals', '🐾 Animals'], ['strikes', '⚔️ Strikes']];

const chain = (seq: readonly Strike[]) =>
  `<div class="chain">${seq.map((s) => `<span class="${s.heavy ? 'h' : ''}" title="${STRIKE_TEXT[s.kind]}">${s.kind}${s.fx ? ` <u>${s.fx}</u>` : ''}${s.heavy ? ' ★' : ''}</span>`).join('→')}</div>`;

function animalCard(a: AnimalDef): string {
  const cap = 0.36 * STAGE_BUDGET[a.stage - 1];
  const bars = STAT_KEYS.map((k) => `<span>${STAT_NAMES[k]}</span><i style="width:${Math.min(100, (a.stats[k] / cap) * 100)}%"></i><em>${a.stats[k]}</em>`).join('');
  const sk2 = a.skill2 ? `<div class="ab"><b>${a.skill2.name}</b> (E): ${a.skill2.desc}</div>` : '';
  return (
    `<div class="animal"><h4>${ANIMAL_EMOJI[a.id] ?? '🐾'} ${a.name} <small>${a.role} · stage ${a.stage} · ${a.size}${a.swim === 'water' ? ' · fish' : a.swim === 'semi' ? ' · swimmer' : ''}</small></h4>` +
    `<div class="bl">${a.blurb}</div><div class="st">${bars}</div>` +
    `<div class="ab"><b>${a.skill.name}</b> (Q): ${a.skill.desc}</div>${sk2}<div class="ab"><b>${a.innate.name}</b> (passive): ${a.innate.desc}</div>` +
    `<div class="wk">− ${a.weakness}</div>${chain(comboOf(a.id))}</div>`
  );
}

function render(tab: Tab): string {
  if (tab === 'basics') {
    return (
      `<h3>The match</h3><p>20 animals drop onto one campus while a lava line closes in. Kill hordes and each other for XP, level up, spend points on stats, and evolve at level ${EVOLVE_LEVELS[0]} and ${EVOLVE_LEVELS[1]}. Fall and you spectate. The last one standing wins.</p>` +
      `<h3>Controls</h3><p><b>WASD</b> move · <b>Space</b> jump · tap <b>Shift</b> dash · <b>LMB</b> attack (hold to chain) · tap <b>RMB</b> parry · <b>Q</b> and <b>E</b> skills · <b>F</b> pick up or set down · <b>R</b> aim a throw · <b>Tab</b> upgrades and evolving · <b>Left Alt</b> cursor · <b>F3</b> network readout.</p>` +
      `<h3>Parrying</h3><p>Raise your guard for half a second. A hit that lands inside it stuns the attacker for 1.5 s. A parry that catches nothing leaves you fumbling for 1.5 s, and the next parry takes 3 s to come back. Heavy strikes (★) break a guard.</p>` +
      `<h3>Classes</h3><div class="grid">${CLASSES.map((c) => `<div class="card"><b>${c.icon} ${c.name}</b><br>${c.blurb}<br>${c.perks.map((p) => `+ ${p.replace(/^\+\s?/, '')}`).join('<br>')}<br>${c.drawbacks.map((p) => `− ${p.replace(/^-\s?/, '')}`).join('<br>')}</div>`).join('')}</div>`
    );
  }
  if (tab === 'items') {
    return `<p>Walk over fresh meat to eat it. Everything else is picked up with <b>F</b> and used from your inventory slots.</p><div class="grid">${Object.keys(ITEM_NAMES).map((k) => `<div class="card"><span class="ic">${ITEM_ICON[k] ?? ''}</span><b>${ITEM_NAMES[k]}</b><br>${ITEM_HINTS[k] ?? ''}</div>`).join('')}</div>`;
  }
  if (tab === 'strikes') {
    const rows = Object.entries(STRIKE_BASE).map(([k, s]) => `<tr><td><b>${k}</b></td><td>${STRIKE_TEXT[k]}</td><td>${s.dmg}×</td><td>${s.reach}×</td><td>${s.arc}°</td><td>${s.cost}</td></tr>`);
    return (
      `<p>A basic attack is a chain of strikes. Stage 1 animals share claw → claw → slam. Every evolved form has its own chain of 3 to 5, ending in a heavy ★ finisher. All chains deal the same damage per second, so they trade rhythm and effects for power.</p>` +
      `<table><tr><th>Strike</th><th>What it is</th><th>Damage</th><th>Reach</th><th>Arc</th><th>Stamina</th></tr>${rows.join('')}</table>` +
      `<h3>Effects</h3><p>${Object.entries(FX_TEXT).map(([k, v]) => `<b>${k}</b>: ${v}`).join(' · ')}.</p>`
    );
  }
  return TREES.map((t) => `<h3>${t.icon} ${t.name}</h3><div class="grid">${ANIMALS.filter((a) => a.tree === t.id).map(animalCard).join('')}</div>`).join('');
}

export class Guidebook {
  private root = document.createElement('div');
  private body = document.createElement('div');
  private tab: Tab = 'animals';
  isOpen = false;

  constructor() {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
    this.root.id = 'br-guide';
    this.root.hidden = true;
    const gb = document.createElement('div');
    gb.className = 'gb wood';
    const tabs = document.createElement('div');
    tabs.className = 'gtabs';
    for (const [id, label] of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.tab = id;
      b.textContent = label;
      b.addEventListener('click', () => this.show(id));
      tabs.append(b);
    }
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'br-btn red x';
    x.textContent = 'Close';
    x.addEventListener('click', () => this.close());
    tabs.append(x);
    this.body.className = 'body';
    const h = document.createElement('h2');
    h.textContent = 'Guidebook';
    gb.append(h, tabs, this.body);
    this.root.append(gb);
    document.body.append(this.root);
    this.root.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.close();
      e.stopPropagation();
    });
    this.root.addEventListener('mousedown', (e) => e.target === this.root && this.close());
  }

  private show(tab: Tab) {
    this.tab = tab;
    this.body.innerHTML = render(tab);
    this.body.scrollTop = 0;
    this.root.querySelectorAll<HTMLElement>('.chip').forEach((c) => c.classList.toggle('on', c.dataset.tab === tab));
  }

  open(tab?: Tab) {
    this.isOpen = true;
    this.root.hidden = false;
    this.show(tab ?? this.tab);
    this.root.tabIndex = -1;
    this.root.focus();
  }

  close() {
    this.isOpen = false;
    this.root.hidden = true;
  }
}
