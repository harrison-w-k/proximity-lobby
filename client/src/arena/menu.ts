// The lobby's door to the match: pick an animal, optionally enter a squad code, and queue.
import { ANIMALS, CLASSES, CLASS_BY_ID, STAT_KEYS, STAT_NAMES, type AnimalDef } from '../../../shared/arena/animals';
import type { QueueInfo } from '../../../shared/arena/proto';
import type { Net } from '../net';

const CSS = `
#br-menu { position: fixed; inset: 0; z-index: 25; display: flex; align-items: center; justify-content: center; padding: 14px; background: radial-gradient(circle at 50% 30%, rgba(40,70,30,.75), rgba(10,8,4,.9)); }
#br-menu[hidden] { display: none; }
#br-menu .panel { width: min(1080px, 100%); max-height: 95vh; overflow: auto; padding: 20px 24px; display: flex; flex-direction: column; gap: 12px; }
#br-menu h2 { margin: 0; font-size: 38px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--amber); text-shadow: 0 4px 0 var(--ink); }
#br-menu .sub { font-size: 21px; color: #ecdcb2; line-height: 1.25; }
#br-menu .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
#br-menu .card { position: relative; padding: 10px 12px 10px; background: linear-gradient(#f7edd3, #dcc995); color: #2a1b0c; border: 3px solid var(--ink); border-radius: 16px; cursor: pointer; text-align: left;
  font-family: var(--font); font-size: 17px; line-height: 1.1; box-shadow: inset 0 3px 0 rgba(255,255,255,.55), 0 5px 0 rgba(0,0,0,.45); transition: transform .08s; }
#br-menu .card:hover { transform: translateY(-2px); filter: brightness(1.04); }
#br-menu .card.sel { background: linear-gradient(#cdf08e, #8fc653); box-shadow: inset 0 3px 0 rgba(255,255,255,.55), 0 0 0 4px var(--amber), 0 5px 0 rgba(0,0,0,.45); }
#br-menu .card .em { position: absolute; right: 10px; top: 6px; font-size: 44px; filter: drop-shadow(0 3px 0 rgba(0,0,0,.25)); }
#br-menu .card h3 { margin: 0; font-size: 25px; font-weight: 700; color: #6a3410; }
#br-menu .card .tag { color: #5b4a2c; font-size: 15px; font-weight: 500; }
#br-menu .bars { margin: 6px 0; display: grid; grid-template-columns: 66px 1fr; gap: 2px 6px; font-size: 13px; font-weight: 600; color: #4a3820; }
#br-menu .bars i { display: block; height: 8px; margin-top: 4px; border-radius: 999px; background: linear-gradient(#f0a640, #c3680f); border: 1px solid #5a3410; }
#br-menu .card ul { margin: 4px 0 2px; padding-left: 16px; font-size: 15px; color: #3a2a14; }
#br-menu .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
#br-menu input[type=text] { width: 240px; height: 44px; padding: 0 16px; font-family: var(--font); font-size: 20px; border: 3px solid var(--ink); border-radius: 999px; background: #f7edd3; color: #2a1b0c; outline: none; box-shadow: inset 0 3px 0 rgba(0,0,0,.15); user-select: text; }
#br-menu input[type=text]:focus { box-shadow: inset 0 3px 0 rgba(0,0,0,.15), 0 0 0 3px var(--leaf); }
#br-menu .status { font-size: 24px; font-weight: 600; color: var(--leaf); min-height: 30px; }
#br-open { pointer-events: auto; cursor: pointer; font-family: 'Fredoka', 'Trebuchet MS', sans-serif; font-weight: 700; }
@media (max-width: 900px) { #br-menu .grid { grid-template-columns: repeat(2, 1fr); } }

#br-menu .chips { display: flex; gap: 8px; flex-wrap: wrap; }
#br-menu .chip { font-family: var(--font); font-weight: 600; font-size: 18px; padding: 3px 14px; border-radius: 999px; border: 3px solid var(--ink); background: linear-gradient(#7a5a3a, #52381f); color: var(--cream); cursor: pointer; box-shadow: inset 0 2px 0 rgba(255,255,255,.2), 0 3px 0 var(--ink); }
#br-menu .chip.on { background: linear-gradient(#b7e46f, #6faa3a); color: #17210c; }
#br-menu .card .cls { margin-top: 5px; padding-top: 4px; border-top: 2px dashed rgba(90,52,16,.35); font-size: 14px; line-height: 1.05; }
#br-menu .card .cls b { color: #6a3410; font-size: 16px; }
#br-menu .card .cls .p { color: #2a6a14; }
#br-menu .card .cls .d { color: #a8341e; }
`;

const EMOJI: Record<string, string> = { wolf: '🐺', bear: '🐻', cheetah: '🐆', badger: '🦡', croc: '🐊', boar: '🐗', otter: '🦦', porcupine: '🦔', lion: '🦁', hippo: '🦛', redfox: '🦊', leopard: '🐈', gorilla: '🦍', turtle: '🐢', kangaroo: '🦘', skunk: '🦨' };

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
    panel.className = 'panel wood';
    panel.innerHTML = '<h2>Animal Battle Royale</h2><div class="sub">20 animals, one island, and a lava ring that never stops closing. Level up on the hordes, then hunt each other. Dead players fight in the Gulag and come back leading a swarm.</div>';
    const chips = document.createElement('div');
    chips.className = 'chips';
    const mkChip = (label: string, cls: string | null) => {
      const c = document.createElement('button');
      c.className = `chip${cls === null ? ' on' : ''}`;
      c.textContent = label;
      c.addEventListener('click', () => {
        chips.querySelectorAll('.chip').forEach((x) => x.classList.toggle('on', x === c));
        for (const [id, card] of this.cards) card.hidden = cls !== null && ANIMALS.find((x) => x.id === id)?.cls !== cls;
      });
      return c;
    };
    chips.append(mkChip('All animals', null), ...CLASSES.map((c) => mkChip(`${c.icon} ${c.name}`, c.id)));
    panel.append(chips);
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
    this.queueBtn.className = 'br-btn';
    this.queueBtn.textContent = 'Queue for the next match';
    this.leaveBtn = document.createElement('button');
    this.leaveBtn.className = 'br-btn wood';
    this.leaveBtn.textContent = 'Leave queue';
    const close = document.createElement('button');
    close.className = 'br-btn red';
    close.textContent = 'Back to the lobby';
    row.append(this.team, this.queueBtn, this.leaveBtn, close);
    this.status.className = 'status';
    panel.append(row, this.status);
    const help = document.createElement('div');
    help.className = 'sub';
    help.style.fontSize = '17px';
    help.innerHTML = 'Friends who enter the same squad code share a team (up to 4): no friendly fire, a shared win. Empty slots are filled with AI animals.<br><b>WASD</b> move · <b>Space</b> dash · <b>Shift</b> sprint · <b>LMB</b> attack · <b>Q E R F</b> skills · <b>Tab</b> upgrades · <b>Left Alt</b> cursor.';
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
    const bars = STAT_KEYS.map((k) => `<span>${STAT_NAMES[k]}</span><span><i style="width:${(a.stats[k] / max) * 100}%"></i></span>`).join('');
    c.innerHTML =
      `<div class="em">${EMOJI[a.id] ?? '🐾'}</div><h3>${a.name}</h3><div class="tag">${a.role} · ${a.size}</div>` +
      `<div class="bars">${bars}</div><ul><li>${a.sig[0].name}</li><li>${a.sig[1].name}</li><li><i>${a.innate.name}</i></li></ul><div class="tag">Weak: ${a.weakness}</div>` +
      (() => {
        const k = CLASS_BY_ID.get(a.cls)!;
        return `<div class="cls"><b>${k.icon} ${k.name}</b><br>${k.perks.map((p) => `<span class="p">+ ${p}</span>`).join('<br>')}<br>${k.drawbacks.map((p) => `<span class="d">- ${p.replace(/^-\s?/, '')}</span>`).join('<br>')}</div>`;
      })();
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
