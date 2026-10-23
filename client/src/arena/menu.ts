// The lobby's door to the match: pick an animal on a spotlit stage, optionally enter a squad
// code, and queue. Hovering an animal brings it up into focus; clicking chooses it.
import { PAINT_SWATCHES, hex6, type Paint } from '../../../shared/arena/paint';
import { loadPaint, savePaint } from './paintStore';
import { SPAWN_BY_ID, SPAWN_CHOICES, bestSpawn, isSpawnId, type SpawnId } from '../../../shared/arena/spawn';
import { ANIMAL_BY_ID, CLASS_BY_ID, EVOLVE_LEVELS, FORMS_OF_TREE, STAGE_BUDGET, STARTERS, STAT_KEYS, STAT_NAMES, TREE_BY_ID, type AnimalDef } from '../../../shared/arena/animals';
import { ANIMAL_EMOJI } from './emoji';
import { buildTreeCircle } from './treeView';
import type { QueueInfo } from '../../../shared/arena/proto';
import type { Net } from '../net';
import type { Sfx } from '../sfx';
import { Showcase } from './showcase';
import { Guidebook } from './guidebook';

const CSS = `
#br-menu { position: fixed; inset: 0; z-index: 25; display: flex; align-items: center; justify-content: center; padding: 14px; background: radial-gradient(circle at 50% 28%, rgba(60,92,38,.82), rgba(10,8,4,.94)); animation: brfade .25s ease-out; }
#br-menu[hidden] { display: none; }
@keyframes brfade { from { opacity: 0; } }
#br-menu .panel { width: min(1120px, 100%); max-height: min(96vh, 940px); overflow: hidden; padding: 16px 22px 14px; display: flex; flex-direction: column; gap: 10px; animation: brpanel .35s ease-out; }
@keyframes brpanel { from { opacity: 0; transform: translateY(26px) scale(.98); } }
#br-menu h2, #br-menu .show .name b { font-family: 'Limelight', 'Poiret One', Georgia, serif; font-weight: 400; }
#br-menu h2 { margin: 0; font-size: 34px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: var(--amber); text-shadow: 0 4px 0 var(--ink); }
#br-menu .sub { font-size: 19px; color: #ecdcb2; line-height: 1.2; }
#br-menu .mbody { flex: 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 10px; padding: 0 6px 6px 0; }
#br-menu .mfoot { display: flex; flex-direction: column; gap: 6px; padding-top: 10px; border-top: 3px solid var(--ink); }
#br-menu .stage { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr); gap: 16px; align-items: stretch; }
#br-menu .side { display: flex; flex-direction: column; gap: 8px; min-width: 0; align-items: center; }
#br-menu .side .tree { padding: 6px 0 26px; }
#br-menu .side .detail { width: 100%; }
#br-menu .more { background: rgba(0,0,0,.22); border-radius: 12px; padding: 4px 12px; }
#br-menu .more > summary { cursor: pointer; font-weight: 700; color: var(--amber); font-size: 17px; padding: 3px 0; }
#br-menu .more[open] > summary { margin-bottom: 6px; }
#br-menu .more > div + div { margin-top: 8px; }
#br-menu details.sec { background: rgba(0,0,0,.2); border-radius: 12px; padding: 4px 14px 8px; }
#br-menu details.sec > summary { cursor: pointer; font-weight: 700; font-size: 19px; color: var(--amber); padding: 4px 0; }
#br-menu details.sec > summary span { color: var(--cream); font-weight: 600; margin-left: 8px; }
#br-menu details.sec[open] > summary { margin-bottom: 6px; }
#br-menu .show { position: relative; height: clamp(280px, 42vh, 440px); border-radius: 18px; border: 4px solid var(--ink); overflow: hidden;
  background: radial-gradient(ellipse at 50% 72%, rgba(255,214,120,.5), rgba(255,170,60,.12) 38%, transparent 62%), linear-gradient(#14595c, #092e31);
  box-shadow: inset 0 0 0 3px #5fb8b0, inset 0 -30px 60px rgba(0,0,0,.45), 0 6px 0 rgba(0,0,0,.4); }
#br-menu .show::before { content: ''; position: absolute; left: 50%; top: -10%; width: 70%; height: 120%; transform: translateX(-50%); background: conic-gradient(from 160deg at 50% 0, transparent 0 20%, rgba(255,238,180,.22) 25% 35%, transparent 40% 100%); pointer-events: none; mix-blend-mode: screen; }
#br-menu .show canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
#br-menu .show .name { position: absolute; left: 18px; bottom: 12px; pointer-events: none; text-shadow: 0 4px 0 rgba(0,0,0,.5); }
#br-menu .show .name b { display: block; font-size: 46px; font-weight: 700; letter-spacing: .04em; color: var(--cream); -webkit-text-stroke: 6px var(--ink); paint-order: stroke fill; line-height: 1; }
#br-menu .show .name span { display: inline-block; margin-top: 4px; padding: 1px 12px; border-radius: 999px; border: 3px solid var(--ink); background: linear-gradient(#ffb8a8, #ff6f7d); color: #3a0f1a; font-weight: 700; font-size: 18px; text-shadow: none; }
#br-menu .show .name.in { animation: brname .5s ease-out; }
@keyframes brname { from { opacity: 0; transform: translateX(-40px); } }
#br-menu .show .flash { position: absolute; inset: 0; background: #fff6d0; opacity: 0; pointer-events: none; }
#br-menu .show .flash.go { animation: brflash .45s ease-out; }
@keyframes brflash { 0% { opacity: .75; } 100% { opacity: 0; } }
#br-menu .detail { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
#br-menu .detail .role { font-size: 21px; color: #ecdcb2; }
#br-menu .detail .role b { color: var(--amber); }
#br-menu .detail .blurb { font-size: 19px; line-height: 1.2; color: var(--cream); font-style: italic; }
#br-menu .bars { display: grid; grid-template-columns: 78px 1fr 30px; gap: 3px 8px; align-items: center; font-size: 17px; font-weight: 600; }
#br-menu .bars i { display: block; height: 11px; width: 0; border-radius: 999px; background: linear-gradient(#ffd96a, #e0a020); border: 2px solid var(--ink); transition: width .55s cubic-bezier(.2,.9,.3,1.2); }
#br-menu .bars em { font-style: normal; text-align: right; color: var(--amber); }
#br-menu .skills { display: grid; gap: 4px; font-size: 16px; line-height: 1.1; }
#br-menu .skills div { padding: 3px 10px; background: rgba(0,0,0,.28); border-radius: 10px; border-left: 4px solid var(--leaf); }
#br-menu .skills b { color: var(--amber); }
#br-menu .skills div.inn { border-left-color: #6b9cff; }
#br-menu .perks { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 14px; font-size: 15px; line-height: 1.1; }
#br-menu .perks .p { color: #ff9aa2; } #br-menu .perks .d { color: #ff9a82; }
#br-menu .perks h4 { margin: 0 0 2px; font-size: 14px; letter-spacing: .12em; text-transform: uppercase; color: #d9c99a; }
#br-menu .tree { display: flex; justify-content: center; padding: 10px 2px 22px; }
#br-menu .tree .col { display: flex; flex-direction: column; gap: 6px; }
#br-menu .tree .col.last { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
#br-menu .tree .node { display: flex; align-items: center; gap: 6px; padding: 4px 10px; border: 3px solid #120c07; border-radius: 12px; cursor: pointer; color: #0b3b3f; font-weight: 700; font-size: 16px;
  background: linear-gradient(#f7edd3, #dcc995); box-shadow: inset 0 2px 0 rgba(255,255,255,.55), 0 3px 0 rgba(0,0,0,.4); transition: transform .1s; }
#br-menu .tree .node:hover { transform: translateY(-2px); }
#br-menu .tree .node { animation: nodein .4s calc(var(--i, 0) * 50ms) ease-out both; }
@keyframes nodein { from { opacity: 0; transform: translateY(10px) scale(.95); } to { opacity: 1; transform: none; } }
#br-menu .tile:hover { transform: translateY(-6px) rotate(-1.5deg); }
#br-menu .tree .node.on { background: linear-gradient(#ffd5cc, #ff8f95); box-shadow: 0 0 0 3px #f3b43c, 0 3px 0 rgba(0,0,0,.4); }
#br-menu .tree .node small { display: block; font-size: 12px; font-weight: 500; opacity: .75; }
#br-menu .tree .node .em { font-size: 22px; }
#br-menu .treehead { font-size: 18px; color: #ecdcb2; padding: 2px 2px 0; }
@media (max-width: 960px) { #br-menu .tree { grid-template-columns: 1fr; } #br-menu .tree .col.last { grid-template-columns: 1fr 1fr; } }
#br-menu .chips { display: flex; gap: 8px; flex-wrap: wrap; }
#br-menu .chip { font-family: var(--font); font-weight: 600; font-size: 17px; padding: 2px 13px; border-radius: 999px; border: 3px solid var(--ink); background: linear-gradient(#2f9a98, #217f7e); color: var(--cream); cursor: pointer; box-shadow: inset 0 2px 0 rgba(255,255,255,.2), 0 3px 0 var(--ink); }
#br-menu .chip.on { background: linear-gradient(#ffb8a8, #ff6f7d); color: #3a0f1a; }
#br-menu .paint { display: grid; grid-template-columns: auto 1fr auto; gap: 8px 14px; align-items: center; padding: 4px 2px; }
#br-menu .paint .lab { font-size: 18px; font-weight: 700; color: #f3b43c; }
#br-menu .paint .sws { display: flex; flex-wrap: wrap; gap: 6px; }
#br-menu .paint .sw { width: 30px; height: 30px; border: 3px solid #0b3b3f; border-radius: 50%; cursor: pointer; padding: 0; box-shadow: inset 0 2px 0 rgba(255,255,255,.4), 0 3px 0 rgba(0,0,0,.45); transition: transform .1s; }
#br-menu .paint .sw:hover { transform: translateY(-3px) scale(1.12); }
#br-menu .paint .sw.on { box-shadow: 0 0 0 3px #f3b43c, 0 3px 0 rgba(0,0,0,.45); transform: translateY(-3px) scale(1.15); }
#br-menu .paint .sw.nat { background: linear-gradient(135deg, #f7edd3 0 50%, #2f9a98 50% 100%); }
#br-menu .paint input[type=color] { width: 44px; height: 34px; padding: 0; border: 3px solid #0b3b3f; border-radius: 10px; background: #f7edd3; cursor: pointer; }
#br-menu .paintnote { font-size: 14px; color: #ecdcb2; padding: 0 2px 4px; opacity: .85; }
#br-menu .drop { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; padding: 4px 2px; }
#br-menu .drop button { position: relative; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 8px 6px 7px; border: 3px solid #0b3b3f; border-radius: 14px; cursor: pointer; font-family: inherit; color: #0b3b3f;
  background: linear-gradient(#f7edd3, #dcc995); box-shadow: inset 0 2px 0 rgba(255,255,255,.55), 0 4px 0 rgba(0,0,0,.45); transition: transform .12s; }
#br-menu .drop button:hover { transform: translateY(-3px); }
#br-menu .drop button.on { background: linear-gradient(#ffd5cc, #ff8f95); box-shadow: inset 0 2px 0 rgba(255,255,255,.55), 0 0 0 3px #f3b43c, 0 4px 0 rgba(0,0,0,.45); transform: translateY(-4px); }
#br-menu .drop .ic { font-size: 30px; line-height: 1.1; }
#br-menu .drop b { font-size: 18px; }
#br-menu .drop small { font-size: 13px; line-height: 1.1; text-align: center; opacity: .8; }
#br-menu .drop .star { position: absolute; top: -10px; right: -6px; padding: 0 8px; border: 2px solid #0b3b3f; border-radius: 999px; font-size: 12px; font-weight: 700; color: #0b3b3f; background: linear-gradient(#ffd77a, #e09a1f); }
#br-menu .dropinfo { display: grid; grid-template-columns: 1.2fr 1fr 1fr; gap: 14px; padding: 6px 4px 2px; font-size: 16px; line-height: 1.25; }
#br-menu .dropinfo h4 { margin: 0 0 2px; font-size: 14px; letter-spacing: .06em; text-transform: uppercase; color: #f3b43c; }
#br-menu .dropinfo .g { color: #ffb8a8; }
#br-menu .dropinfo .x { color: #ff9a82; }
#br-menu .dropinfo .fit { color: #ffd77a; }
@media (max-width: 960px) { #br-menu .drop { grid-template-columns: repeat(3, 1fr); } #br-menu .dropinfo { grid-template-columns: 1fr; } }
#br-menu .roster { display: grid; grid-template-columns: repeat(7, 1fr); gap: 8px; padding: 8px 2px 4px; }
#br-menu .roster .tile { padding: 3px 2px 4px; }
#br-menu .roster .tile .em { font-size: 28px; }
#br-menu .roster .tile small { display: none; }
#br-menu .tile { position: relative; padding: 6px 4px 5px; text-align: center; border-radius: 14px; border: 3px solid var(--ink); cursor: pointer; font-family: var(--font); color: #0b3b3f;
  background: linear-gradient(#f7edd3, #dcc995); box-shadow: inset 0 3px 0 rgba(255,255,255,.55), 0 4px 0 rgba(0,0,0,.45); transition: transform .12s, box-shadow .12s, filter .12s; animation: brtile .45s ease-out both; }
#br-menu .tile:hover { transform: translateY(-6px) scale(1.06); filter: brightness(1.06); }
#br-menu .tile .em { font-size: 38px; line-height: 1.1; filter: drop-shadow(0 3px 0 rgba(0,0,0,.25)); }
#br-menu .tile b { display: block; font-size: 15px; line-height: 1; color: #6a3410; }
#br-menu .tile small { font-size: 13px; color: #3b8f8c; }
#br-menu .tile.sel { background: linear-gradient(#ffd5cc, #ff8f95); transform: translateY(-9px) scale(1.1); box-shadow: inset 0 3px 0 rgba(255,255,255,.55), 0 0 0 4px var(--amber), 0 0 22px rgba(255,200,80,.8), 0 5px 0 rgba(0,0,0,.45); z-index: 2; }
#br-menu .tile.focus:not(.sel) { transform: translateY(-6px) scale(1.06); box-shadow: inset 0 3px 0 rgba(255,255,255,.55), 0 0 0 3px #fff6c8, 0 4px 0 rgba(0,0,0,.45); }
@keyframes brtile { from { opacity: 0; transform: translateY(40px) scale(.8); } }
#br-menu .row { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
#br-menu input[type=text] { width: 240px; height: 44px; padding: 0 16px; font-family: var(--font); font-size: 20px; border: 3px solid var(--ink); border-radius: 999px; background: #f7edd3; color: #0b3b3f; outline: none; box-shadow: inset 0 3px 0 rgba(0,0,0,.15); user-select: text; }
#br-menu input[type=text]:focus { box-shadow: inset 0 3px 0 rgba(0,0,0,.15), 0 0 0 3px var(--leaf); }
#br-menu .status { font-size: 22px; font-weight: 600; color: var(--leaf); min-height: 28px; }
#br-open { pointer-events: auto; cursor: pointer; font-family: 'Josefin Sans', 'Trebuchet MS', sans-serif; font-weight: 700; }
@media (max-width: 960px) { #br-menu .stage { grid-template-columns: 1fr; } #br-menu .roster { grid-template-columns: repeat(4, 1fr); } }

#br-menu .show { --acc: #e8a23a; }
#br-menu .show::after { content: ''; position: absolute; inset: 0; border-radius: 14px; pointer-events: none; box-shadow: inset 0 0 60px color-mix(in srgb, var(--acc) 40%, transparent); }
#br-menu .show .name span { background: linear-gradient(color-mix(in srgb, var(--acc) 70%, white), var(--acc)); }
#br-menu .show .pick { position: absolute; right: 14px; top: 12px; padding: 2px 12px; border-radius: 999px; border: 3px solid var(--ink); font-weight: 700; font-size: 16px; letter-spacing: .06em; background: rgba(18,12,7,.8); color: var(--cream); pointer-events: none; transition: transform .15s; }
#br-menu .show .pick.yes { background: linear-gradient(#ffd5cc, #ff8f95); color: #3a0f1a; animation: brpickpop .35s ease-out; }
@keyframes brpickpop { 0% { transform: scale(1.5); } 100% { transform: scale(1); } }
#br-menu .show .hint { position: absolute; right: 14px; bottom: 10px; font-size: 14px; color: rgba(255,255,255,.55); pointer-events: none; }
#br-menu .detail > * { animation: brslideup .4s ease-out both; animation-delay: calc(var(--i, 0) * 70ms); }
@keyframes brslideup { from { opacity: 0; transform: translateY(18px); } }
#br-menu .skills div { transition: transform .12s, background .12s; }
#br-menu .skills div:hover { transform: translateX(5px); background: rgba(255,255,255,.1); }
#br-menu .tile.sel { box-shadow: inset 0 3px 0 rgba(255,255,255,.55), 0 0 0 4px var(--tacc, var(--amber)), 0 0 24px var(--tacc, rgba(255,200,80,.8)), 0 5px 0 rgba(0,0,0,.45); }
#br-menu .tile::after { content: ''; position: absolute; left: 12%; right: 12%; bottom: 3px; height: 4px; border-radius: 999px; background: var(--tacc); opacity: .85; }
#br-menu .tile .tick { position: absolute; right: -6px; top: -8px; width: 24px; height: 24px; border-radius: 50%; background: #ff8f95; border: 3px solid var(--ink); color: #3a0f1a; font-weight: 700; font-size: 14px; line-height: 18px; display: none; }
#br-menu .tile.sel .tick { display: block; animation: brpickpop .35s ease-out; }
#br-menu .dice { font-size: 22px; }
#br-menu .kb { font-size: 14px; color: rgba(236,220,178,.7); }
`;

export const ACCENT: Record<string, string> = { hunter: '#e8a23a', titan: '#6b9cff', ambusher: '#6fcf5a', brawler: '#ff6a5a', skirmisher: '#c78bff', guardian: '#4fd0d0' };
const EMOJI = ANIMAL_EMOJI;
const starterOf = (id: string) => TREE_BY_ID.get(ANIMAL_BY_ID.get(id)?.tree ?? '')?.starter ?? id;

export class BrMenu {
  private root = document.createElement('div');
  private status = document.createElement('div');
  private queueBtn!: HTMLButtonElement;
  private leaveBtn!: HTMLButtonElement;
  private team!: HTMLInputElement;
  private sel = STARTERS[0].id;
  private spawn: SpawnId = 'any';
  private paintBox = document.createElement('div');
  private treeHead = document.createElement('div');
  private treeBox = document.createElement('div');
  private paintTitle = document.createElement('div');
  private dropBox = document.createElement('div');
  private dropInfo = document.createElement('div');
  private dropSum = document.createElement('span');
  private focus = STARTERS[0].id;
  private q: QueueInfo | null = null;
  private tiles = new Map<string, HTMLElement>();
  private showcase = new Showcase();
  private guide?: Guidebook;
  private nameEl = document.createElement('div');
  private flashEl = document.createElement('div');
  private pickEl = document.createElement('div');
  private hintEl = document.createElement('div');
  private show!: HTMLElement;
  private detail = document.createElement('div');
  private hoverTimer = 0;
  isOpen = false;
  onClose: () => void = () => {};
  onOpen: () => void = () => {};
  /** You picked an animal (so the lobby can show it). */
  onChoose: (id: string, paint: Paint | null) => void = () => {};
  private tick = 0;
  private qAt = 0;

  constructor(
    private net: Net,
    private sfx?: Sfx,
  ) {
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
    try {
      this.sel = localStorage.getItem('br-animal') || this.sel;
    } catch {
      /* storage unavailable */
    }
    if (!ANIMAL_BY_ID.has(this.sel)) this.sel = STARTERS[0].id;
    this.focus = this.sel;
    this.root.id = 'br-menu';
    this.root.hidden = true;
    const panel = document.createElement('div');
    panel.className = 'panel wood';
    panel.innerHTML = '<h2>The Grand Tournament</h2><div class="sub">20 animals, one campus, a lava line that keeps closing in. Level up on the hordes, evolve twice, outlast everyone.</div>';

    // everything scrolls in the body; the queue buttons stay put in the footer
    const mbody = document.createElement('div');
    mbody.className = 'mbody';
    const mfoot = document.createElement('div');
    mfoot.className = 'mfoot';
    const section = (title: string, summary: HTMLElement | null, ...kids: HTMLElement[]) => {
      const d = document.createElement('details');
      d.className = 'sec';
      const sm = document.createElement('summary');
      sm.append(title);
      if (summary) sm.append(summary);
      d.append(sm, ...kids);
      return d;
    };
    // the stage: a spotlit model on the left, its details on the right
    const stage = document.createElement('div');
    stage.className = 'stage';
    const show = document.createElement('div');
    show.className = 'show';
    this.nameEl.className = 'name';
    this.flashEl.className = 'flash';
    this.pickEl.className = 'pick';
    this.hintEl.className = 'hint';
    this.hintEl.textContent = 'Drag to turn it · click to make it move';
    this.show = show;
    show.append(this.showcase.canvas, this.flashEl, this.nameEl, this.pickEl, this.hintEl);
    this.detail.className = 'detail';
    // the evolution tree sits beside the model, with just a short summary under it
    this.treeHead.className = 'treehead';
    this.treeBox.className = 'tree';
    const side = document.createElement('div');
    side.className = 'side';
    side.append(this.treeHead, this.treeBox, this.detail);
    stage.append(show, side);
    const roster = document.createElement('div');
    roster.className = 'roster';
    STARTERS.forEach((a, i) => {
      const t = this.tile(a, i);
      this.tiles.set(a.id, t);
      roster.append(t);
    });
    mbody.append(roster, stage);

    // fur colours for the animal in the spotlight
    this.paintTitle.className = 'sub';
    this.paintBox.className = 'paint';
    const paintNote = document.createElement('div');
    paintNote.className = 'paintnote';
    paintNote.textContent = 'Unpainted animals get a shade of their own, so no two players look the same. Colours are saved for each animal.';
    mbody.append(section('🎨 Colours', null, this.paintTitle, this.paintBox, paintNote));
    this.refreshPaint();

    // where to drop onto the map
    try {
      const saved = localStorage.getItem('br-spawn');
      if (isSpawnId(saved)) this.spawn = saved;
    } catch {
      /* storage unavailable */
    }
    const dropTitle = document.createElement('div');
    dropTitle.className = 'sub';
    dropTitle.innerHTML = '<b>Where do you drop?</b> Pick the ground that suits your build.';
    this.dropBox.className = 'drop';
    this.dropInfo.className = 'dropinfo';
    mbody.append(section('📍 Where you drop:', this.dropSum, dropTitle, this.dropBox, this.dropInfo));
    this.refreshSpawn();

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
    const dice = document.createElement('button');
    dice.className = 'br-btn amber dice';
    dice.textContent = '🎲 Surprise me';
    dice.addEventListener('click', () => {
      const ids = STARTERS.map((x) => x.id);
      this.choose(ids[Math.floor(Math.random() * ids.length)]);
    });
    const book = document.createElement('button');
    book.className = 'br-btn wood';
    book.textContent = '📖 Guidebook';
    book.addEventListener('click', () => (this.guide ??= new Guidebook()).open());
    row.append(this.team, dice, book, this.queueBtn, this.leaveBtn, close);
    this.status.className = 'status';
    mfoot.append(row, this.status);
    const help = document.createElement('div');
    help.className = 'sub';
    help.style.fontSize = '16px';
    help.innerHTML = '<span class="kb">Arrow keys move the spotlight · Enter picks</span><br>Friends who enter the same squad code share a team (up to 4): no friendly fire, a shared win. Empty slots are filled with AI animals.<br><b>WASD</b> move · <b>Space</b> jump · tap <b>Shift</b> dash · <b>LMB</b> attack · tap <b>RMB</b> to parry (a hit inside the half-second window stuns the attacker for 1.5 s; a miss leaves you fumbling for 1.5 s and the parry takes 3 s to return) · <b>Q</b> skill · <b>Tab</b> upgrades and evolving · <b>Left Alt</b> cursor.';
    mbody.append(section('🎮 Controls and squads', null, help));
    panel.append(mbody, mfoot);
    this.root.append(panel);
    document.body.append(this.root);

    this.queueBtn.addEventListener('click', () => {
      this.net.send({ t: 'animal', a: this.sel, paint: loadPaint(this.sel) });
      try {
        localStorage.setItem('br-animal', this.sel);
        localStorage.setItem('br-team', this.team.value);
        localStorage.setItem('br-spawn', this.spawn);
      } catch {
        /* storage unavailable */
      }
      this.net.send({ t: 'mq', animal: this.sel, team: this.team.value, spawn: this.spawn, paint: loadPaint(this.sel) });
    });
    this.leaveBtn.addEventListener('click', () => this.net.send({ t: 'mqx' }));
    close.addEventListener('click', () => this.close());
    this.root.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.guide?.isOpen) this.close();
      const typing = (e.target as HTMLElement | null)?.tagName === 'INPUT';
      if (!typing) {
        if (e.code === 'ArrowRight') this.step(1, 0);
        else if (e.code === 'ArrowLeft') this.step(-1, 0);
        else if (e.code === 'ArrowDown') this.step(0, 1);
        else if (e.code === 'ArrowUp') this.step(0, -1);
        else if (e.code === 'Enter' || e.code === 'Space') {
          this.choose(this.focus);
          e.preventDefault();
        }
      }
      e.stopPropagation(); // typing a squad code must not move the animal
    });
    window.addEventListener('resize', () => this.isOpen && this.showcase.resize());
    this.refreshSel();
  }

  private tile(a: AnimalDef, i: number): HTMLElement {
    const t = document.createElement('div');
    t.className = 'tile';
    t.tabIndex = 0;
    t.style.animationDelay = `${0.04 * i + 0.15}s`;
    const cls = CLASS_BY_ID.get(a.cls)!;
    t.style.setProperty('--tacc', ACCENT[a.cls] ?? '#e8a23a');
    t.innerHTML = `<div class="em">${EMOJI[a.id] ?? '🐾'}</div><b>${a.name}</b><small>${cls.icon} ${cls.name}</small><span class="tick">✓</span>`;
    // hovering brings an animal up into focus; leaving returns to your choice
    t.addEventListener('mouseenter', () => {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => this.bringUp(a.id), 70);
    });
    t.addEventListener('focus', () => this.bringUp(a.id));
    t.addEventListener('mouseleave', () => {
      clearTimeout(this.hoverTimer);
      this.hoverTimer = window.setTimeout(() => this.bringUp(this.sel), 450);
    });
    t.addEventListener('click', () => this.choose(a.id));
    return t;
  }

  private choose(pick: string) {
    const id = starterOf(pick);
    const changed = this.sel !== id;
    this.sel = id;
    this.bringUp(pick === id ? id : pick);
    this.refreshSel();
    if (changed) {
      this.sfx?.choose();
      this.net.send({ t: 'animal', a: id, paint: loadPaint(id) }); // the lobby shows you as this animal right away
      this.onChoose(id, loadPaint(id) ?? null);
    }
  }

  /** Arrow keys move the spotlight; Enter picks. */
  private step(dx: number, dy: number) {
    const vis = [...this.tiles.entries()].filter(([, t]) => !t.hidden).map(([id]) => id);
    if (!vis.length) return;
    const i = Math.max(0, vis.indexOf(starterOf(this.focus)));
    const cols = window.innerWidth <= 960 ? 4 : 7;
    const n = Math.max(0, Math.min(vis.length - 1, i + dx + dy * cols));
    this.bringUp(vis[n]);
  }

  private refreshSel() {
    const f = ANIMAL_BY_ID.get(this.focus);
    const k = starterOf(this.focus) === this.sel;
    this.pickEl.textContent = k ? (f && f.stage > 1 ? `✓ YOUR TREE · STAGE ${f.stage}` : '✓ YOUR PICK') : 'CLICK TO CHOOSE';
    this.pickEl.classList.toggle('yes', k);
    const cls = ANIMAL_BY_ID.get(this.focus)?.cls;
    if (cls) this.show.style.setProperty('--acc', ACCENT[cls] ?? '#e8a23a');
    for (const [id, t] of this.tiles) {
      t.classList.toggle('sel', id === this.sel);
      t.classList.toggle('focus', id === starterOf(this.focus));
    }
    this.refreshSpawn();
    this.refreshPaint();
  }

  /** Change one of the two colours (or both) for the animal in the spotlight. */
  private setPaint(next: Paint | undefined) {
    const starter = starterOf(this.focus);
    savePaint(starter, next);
    if (this.sel !== starter) {
      this.sel = starter;
      this.sfx?.choose();
    }
    this.net.send({ t: 'animal', a: starter, paint: next });
    this.onChoose(starter, next ?? null);
    this.showcase.setPaint(next);
    this.sfx?.hoverTick();
    this.refreshSel();
  }

  /** The colour pickers: a main colour and an accent colour, each with swatches and a free colour box. */
  private refreshPaint() {
    const a = ANIMAL_BY_ID.get(this.focus);
    if (!a) return;
    const cur: Paint = loadPaint(a.id) ?? [-1, -1];
    this.paintTitle.innerHTML = `<b>Colours for ${a.name}</b> Pick a main colour and an accent for its belly, ears, tail and paws.`;
    const rows: HTMLElement[] = [];
    const mk = (label: string, idx: 0 | 1) => {
      const lab = document.createElement('div');
      lab.className = 'lab';
      lab.textContent = label;
      const sws = document.createElement('div');
      sws.className = 'sws';
      const nat = document.createElement('button');
      nat.type = 'button';
      nat.className = 'sw nat' + (cur[idx] < 0 ? ' on' : '');
      nat.title = 'Natural';
      nat.addEventListener('click', () => this.setPaint(idx === 0 ? mix([-1, cur[1]]) : mix([cur[0], -1])));
      sws.append(nat);
      for (const c of PAINT_SWATCHES) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sw' + (cur[idx] === c ? ' on' : '');
        b.style.background = hex6(c);
        b.title = hex6(c);
        b.addEventListener('click', () => this.setPaint(idx === 0 ? mix([c, cur[1]]) : mix([cur[0], c])));
        sws.append(b);
      }
      const pick = document.createElement('input');
      pick.type = 'color';
      pick.value = hex6(cur[idx] >= 0 ? cur[idx] : 0x888888);
      pick.title = 'Any colour';
      pick.addEventListener('change', () => {
        const c = parseInt(pick.value.slice(1), 16);
        this.setPaint(idx === 0 ? mix([c, cur[1]]) : mix([cur[0], c]));
      });
      rows.push(lab, sws, pick);
    };
    const mix = (p: Paint): Paint | undefined => (p[0] < 0 && p[1] < 0 ? undefined : p);
    mk('Main', 0);
    mk('Accent', 1);
    this.paintBox.replaceChildren(...rows);
    const row = document.createElement('div');
    row.style.cssText = 'grid-column:1/-1;display:flex;gap:10px';
    const nat = document.createElement('button');
    nat.className = 'br-btn wood';
    nat.textContent = 'Natural colours';
    nat.addEventListener('click', () => this.setPaint(undefined));
    const rnd = document.createElement('button');
    rnd.className = 'br-btn amber';
    rnd.textContent = '🎲 Surprise colours';
    rnd.addEventListener('click', () => {
      const pick = () => PAINT_SWATCHES[Math.floor(Math.random() * PAINT_SWATCHES.length)];
      const m = pick();
      let c = pick();
      while (c === m) c = pick();
      this.setPaint([m, c]);
    });
    row.append(nat, rnd);
    this.paintBox.append(row);
  }

  /** The drop-zone cards, with a star on the one that suits the animal in the spotlight. */
  private refreshSpawn() {
    const a = ANIMAL_BY_ID.get(this.sel);
    const best = a ? bestSpawn(a) : null;
    this.dropBox.replaceChildren(
      ...SPAWN_CHOICES.map((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = c.id === this.spawn ? 'on' : '';
        b.innerHTML = `<span class="ic">${c.icon}</span><b>${c.name}</b><small>${c.blurb}</small>${best && best.id === c.id ? '<span class="star">★ Best fit</span>' : ''}`;
        b.addEventListener('click', () => {
          if (this.spawn !== c.id) this.sfx?.choose();
          this.spawn = c.id;
          this.refreshSpawn();
        });
        return b;
      }),
    );
    const c = SPAWN_BY_ID.get(this.spawn)!;
    this.dropSum.textContent = `${c.icon} ${c.name}`;
    const fit = best && a ? (best.id === this.spawn ? `<div class="fit">★ A great pick for ${a.name}: ${best.why}</div>` : `<div class="fit">★ ${a.name} does best in the ${SPAWN_BY_ID.get(best.id)!.name}: ${best.why}</div>`) : '';
    this.dropInfo.innerHTML =
      `<div><h4>${c.icon} ${c.name}</h4>${c.blurb}${fit}</div>` +
      `<div><h4>Good</h4>${c.good.map((x) => `<div class="g">+ ${x}</div>`).join('')}</div>` +
      `<div><h4>Bad</h4>${c.bad.map((x) => `<div class="x">− ${x}</div>`).join('')}</div>`;
  }

  /** Put an animal in the spotlight: it rises onto the stage and its details slide in. */
  private bringUp(id: string) {
    if (id === this.focus && this.detail.childElementCount) return;
    this.focus = id;
    const a = ANIMAL_BY_ID.get(id);
    if (!a) return;
    this.showcase.setAnimal(id, loadPaint(id));
    this.showcase.setAccent(parseInt((ACCENT[a.cls] ?? '#e8a23a').slice(1), 16));
    this.sfx?.hoverTick();
    const cls = CLASS_BY_ID.get(a.cls)!;
    this.nameEl.innerHTML = `<b>${a.name}</b><span>${cls.icon} ${cls.name}</span>`;
    this.nameEl.classList.remove('in');
    void this.nameEl.offsetWidth;
    this.nameEl.classList.add('in');
    this.flashEl.classList.remove('go');
    void this.flashEl.offsetWidth;
    this.flashEl.classList.add('go');
    const rows = STAT_KEYS.map((k) => `<span>${STAT_NAMES[k]}</span><i data-w="${Math.min(100, (a.stats[k] / (0.36 * STAGE_BUDGET[a.stage - 1])) * 100)}"></i><em>${a.stats[k]}</em>`).join('');
    this.detail.innerHTML =
      `<div class="role"><b>${a.role}</b> · stage ${a.stage} · ${a.size} · ${a.swim === 'water' ? 'fish: spawns in water, slow on land' : a.swim === 'semi' ? 'strong swimmer' : 'land animal'}${a.stage > 1 ? ` · evolve at level ${EVOLVE_LEVELS[a.stage - 2]}` : ''}</div>` +
      `<div class="blurb">${a.blurb}</div>` +
      `<details class="more"><summary>Stats and abilities</summary><div class="bars">${rows}</div>` +
      `<div class="skills"><div><b>${a.skill.name}</b> (Q): ${a.skill.desc}</div><div class="inn"><b>${a.innate.name}</b> (passive): ${a.innate.desc}</div></div>` +
      `<div class="perks"><div><h4>${cls.icon} ${cls.name} gives</h4>${cls.perks.map((p) => `<div class="p">+ ${p.replace(/^\+\s?/, '')}</div>`).join('')}</div><div><h4>and costs</h4>${cls.drawbacks.map((p) => `<div class="d">− ${p.replace(/^-\s?/, '')}</div>`).join('')}<div class="d">− ${a.weakness}</div></div></div></details>`;
    this.detail.querySelectorAll<HTMLElement>(':scope > *').forEach((el, i) => el.style.setProperty('--i', String(i)));
    // let the stat bars grow into place
    requestAnimationFrame(() =>
      requestAnimationFrame(() =>
        this.detail.querySelectorAll<HTMLElement>('.bars i').forEach((b) => {
          b.style.width = `${b.dataset.w}%`;
        }),
      ),
    );
    this.refreshTree();
    this.refreshSel();
  }

  /** The evolution tree of the animal in the spotlight: click a form to see it on the stage. */
  private refreshTree() {
    const a = ANIMAL_BY_ID.get(this.focus);
    if (!a) return;
    const tree = TREE_BY_ID.get(a.tree)!;
    this.treeHead.innerHTML = `<b>${tree.icon} ${tree.name}</b> · evolves at level ${EVOLVE_LEVELS[0]} and ${EVOLVE_LEVELS[1]}. Click a form to see it.`;
    this.treeBox.replaceChildren(buildTreeCircle({ tree: tree.id, focus: this.focus, onPick: (id) => this.bringUp(id), size: 290 }));
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.root.hidden = false;
    // the lobby may have changed your animal since this menu last opened
    try {
      const saved = localStorage.getItem('br-animal');
      if (saved && saved !== this.sel && ANIMAL_BY_ID.has(saved)) {
        this.sel = saved;
        this.bringUp(saved);
        this.refreshSel();
      }
    } catch {
      /* storage unavailable */
    }
    document.exitPointerLock();
    this.onOpen();
    this.net.send({ t: 'mqx' }); // asks for fresh numbers without queueing (a no-op if not queued)
    this.tick = window.setInterval(() => this.render(), 250);
    this.render();
    this.showcase.resize();
    this.focus = '';
    this.bringUp(this.sel);
    this.showcase.start();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.hidden = true;
    clearInterval(this.tick);
    this.showcase.stop();
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
    if (!q) return '🎓 Tournament [B]';
    if (q.you) return q.startsIn !== null ? `🐾 Queued · starts in ${Math.max(0, q.startsIn - Math.floor((performance.now() - this.qAt) / 1000))}s` : '🐾 Queued';
    if (q.inMatch) return '🐾 Match running [B]';
    if (q.queued > 0) return `🐾 ${q.queued} queued [B]`;
    return '🎓 Tournament [B]';
  }

  private render() {
    const q = this.q;
    this.queueBtn.disabled = !!q?.you;
    this.leaveBtn.disabled = !q?.you;
    this.queueBtn.textContent = q?.you ? 'You are queued' : 'Queue for the next match';
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
