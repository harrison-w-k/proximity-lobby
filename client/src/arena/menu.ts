// The lobby's door to the match: pick an animal, optionally enter a squad code, and queue.
import { ANIMALS, SIZE, STAT_KEYS, STAT_NAMES, type AnimalDef } from '../../../shared/arena/animals';
import type { QueueInfo } from '../../../shared/arena/proto';
import type { Net } from '../net';

const CSS = `
#br-menu { position: fixed; inset: 0; z-index: 25; display: flex; align-items: center; justify-content: center; padding: 14px; background: rgba(6,12,32,.72); }
#br-menu[hidden] { display: none; }
#br-menu .panel { width: min(1060px, 100%); max-height: 94vh; overflow: auto; padding: 18px 20px; display: flex; flex-direction: column; gap: 12px; }
#br-menu h2 { margin: 0; font-family: var(--font-pixel); font-size: 18px; text-transform: uppercase; color: var(--yellow); text-shadow: 3px 3px 0 var(--ink); }
#br-menu .sub { font-size: 22px; color: var(--cream); }
#br-menu .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
#br-menu .card { padding: 8px 10px; background: var(--blue-dark); border: 4px solid var(--ink); cursor: pointer; text-align: left; color: #fff; font-family: var(--font-body); font-size: 19px; line-height: 1.05; }
#br-menu .card:hover { background: #1c46a8; }
#br-menu .card.sel { background: var(--green-dark); border-color: var(--yellow); box-shadow: 0 0 0 3px var(--yellow); }
#br-menu .card h3 { margin: 0 0 2px; font-size: 25px; font-weight: 400; color: var(--yellow); }
#br-menu .card .tag { color: #bfe0ff; font-size: 17px; }
#br-menu .bars { margin: 5px 0; display: grid; grid-template-columns: 54px 1fr; gap: 1px 6px; font-size: 15px; }
#br-menu .bars i { display: block; height: 7px; margin-top: 5px; background: var(--yellow); }
#br-menu .card ul { margin: 4px 0 0; padding-left: 16px; font-size: 16px; color: #dfeaff; }
#br-menu .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
#br-menu input[type=text] { width: 230px; height: 44px; font-size: 20px; }
#br-menu .status { font-size: 24px; color: #b9f5a6; min-height: 28px; }
#br-open { pointer-events: auto; cursor: pointer; }
@media (max-width: 900px) { #br-menu .grid { grid-template-columns: repeat(2, 1fr); } }
`;

const PICKS: Record<string, string> = {};
void PICKS;

export class BrMenu {
  private root = document.createElement('div');
  private status = document.createElement('div');
  private queueBtn!: HTMLButtonElement;
  private leaveBtn!: HTMLButtonElement;
  private team!: HTMLInputElement;
  private sel = 'wolf';
  private q: QueueInfo | null = null;
  private cards = new Map<string, HTMLElement>();
  isOpen = false;
  onClose: () => void = () => {};
  onOpen: () => void = () => {};
  private tick = 0;
  private qAt = 0;

  constructor(private net: Net) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
    try {
      this.sel = localStorage.getItem('br-animal') || this.sel;
    } catch {
      /* storage unavailable */
    }
    this.root.id = 'br-menu';
    this.root.hidden = true;
    const panel = document.createElement('div');
    panel.className = 'panel box';
    panel.innerHTML = '<h2>Animal Battle Royale</h2><div class="sub">20 animals, one island, and a lava ring that never stops closing. Level up on the hordes, then hunt each other. Dead players fight in the Gulag and come back leading a swarm.</div>';
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const a of ANIMALS) {
      const c = this.card(a);
      this.cards.set(a.id, c);
      grid.append(c);
    }
    panel.append(grid);
    const row = document.createElement('div');
    row.className = 'row';
    this.team = document.createElement('input');
    this.team.type = 'text';
    this.team.maxLength = 12;
    this.team.placeholder = 'Squad code (optional)';
    this.team.autocomplete = 'off';
    try {
      this.team.value = localStorage.getItem('br-team') || '';
    } catch {
      /* storage unavailable */
    }
    this.queueBtn = document.createElement('button');
    this.queueBtn.className = 'btn primary';
    this.queueBtn.textContent = 'Queue for the next match';
    this.leaveBtn = document.createElement('button');
    this.leaveBtn.className = 'btn glass';
    this.leaveBtn.textContent = 'Leave queue';
    const close = document.createElement('button');
    close.className = 'btn danger';
    close.textContent = 'Back to the lobby';
    row.append(this.team, this.queueBtn, this.leaveBtn, close);
    this.status.className = 'status';
    panel.append(row, this.status);
    const help = document.createElement('div');
    help.className = 'sub';
    help.style.fontSize = '18px';
    help.innerHTML = 'Friends who enter the same squad code share a team (up to 4): no friendly fire, a shared win. Empty slots are filled with AI animals. <b>WASD</b> move · <b>Shift</b> sprint · <b>LMB</b> attack · <b>Q E R F</b> skills · <b>Tab</b> upgrades.';
    panel.append(help);
    this.root.append(panel);
    document.body.append(this.root);

    this.queueBtn.addEventListener('click', () => {
      try {
        localStorage.setItem('br-animal', this.sel);
        localStorage.setItem('br-team', this.team.value);
      } catch {
        /* storage unavailable */
      }
      this.net.send({ t: 'mq', animal: this.sel, team: this.team.value });
    });
    this.leaveBtn.addEventListener('click', () => this.net.send({ t: 'mqx' }));
    close.addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.close();
      e.stopPropagation(); // typing a squad code must not move the animal
    });
    this.refreshSel();
  }

  private card(a: AnimalDef): HTMLElement {
    const c = document.createElement('div');
    c.className = 'card';
    c.tabIndex = 0;
    const max = 36;
    const bars = STAT_KEYS.map((k) => `<span>${STAT_NAMES[k].slice(0, 5)}</span><span><i style="width:${(a.stats[k] / max) * 100}%"></i></span>`).join('');
    c.innerHTML =
      `<h3>${a.name}</h3><div class="tag">${a.role} · ${a.size} · ${SIZE[a.size].radius < 0.5 ? 'tiny hitbox' : a.size === 'large' ? 'big hitbox' : 'standard'}</div>` +
      `<div class="bars">${bars}</div><ul><li>${a.sig[0].name}</li><li>${a.sig[1].name}</li><li><i>${a.innate.name}</i></li></ul><div class="tag">Weak: ${a.weakness}</div>`;
    c.addEventListener('click', () => {
      this.sel = a.id;
      this.refreshSel();
    });
    return c;
  }

  private refreshSel() {
    for (const [id, c] of this.cards) c.classList.toggle('sel', id === this.sel);
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.hidden = false;
    document.exitPointerLock();
    this.onOpen();
    this.net.send({ t: 'mqx' }); // asks for fresh numbers without queueing (a no-op if not queued)
    this.tick = window.setInterval(() => this.render(), 250);
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.hidden = true;
    clearInterval(this.tick);
    this.onClose();
  }

  setQueue(q: QueueInfo) {
    this.q = q;
    this.qAt = performance.now();
    if (this.isOpen) this.render();
  }

  get queued() {
    return !!this.q?.you;
  }

  /** The one-line status for the lobby button. */
  summary(): string {
    const q = this.q;
    if (!q) return '🐾 Battle Royale [B]';
    if (q.you) return q.startsIn !== null ? `🐾 Queued · starts in ${Math.max(0, q.startsIn - Math.floor((performance.now() - this.qAt) / 1000))}s` : '🐾 Queued';
    if (q.inMatch) return '🐾 Match running [B]';
    if (q.queued > 0) return `🐾 ${q.queued} queued [B]`;
    return '🐾 Battle Royale [B]';
  }

  private render() {
    const q = this.q;
    this.queueBtn.disabled = !!q?.you || !!q?.inMatch && false;
    this.leaveBtn.disabled = !q?.you;
    this.queueBtn.textContent = q?.you ? 'You are queued' : q?.inMatch ? 'Queue for the next match' : 'Queue for the next match';
    if (!q) {
      this.status.textContent = '';
      return;
    }
    const left = q.startsIn === null ? null : Math.max(0, q.startsIn - Math.floor((performance.now() - this.qAt) / 1000));
    let text = `${q.queued} of ${q.slots} players queued.`;
    if (q.inMatch) text += ' A match is running; you will join the next one.';
    else if (left !== null) text += ` The match starts in ${left}s and AI animals fill the empty slots.`;
    else text += ' Queue up to start a countdown.';
    this.status.textContent = text;
  }
}
