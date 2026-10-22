// An evolution tree drawn as a circle: the starter in the middle, the two stage 2 forms on a ring around it and
// the four final forms on the outer ring, joined by lines (after diep.io's upgrade circle).
import { EVOLVE_LEVELS, FORMS_OF_TREE } from '../../../shared/arena/animals';
import { ANIMAL_EMOJI } from './emoji';

export interface TreeOpts {
  tree: string;
  /** The form you are now (drawn with a gold ring). */
  current?: string;
  /** The form being looked at (highlighted). */
  focus?: string;
  /** Forms you can evolve into right now: they pulse and invite a click. */
  open?: string[];
  onPick: (id: string) => void;
  size?: number;
}

const CSS = `
.tc { position: relative; margin: 0 auto; }
.tc svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.tc .tn { position: absolute; transform: translate(-50%, -50%); display: flex; flex-direction: column; align-items: center; cursor: pointer; z-index: 1; }
.tc .tn .b { width: var(--nd); height: var(--nd); display: flex; align-items: center; justify-content: center; font-size: calc(var(--nd) * 0.5); border: 3px solid #0b3b3f; border-radius: 50%;
  background: linear-gradient(#fbf1dc, #dcc995); box-shadow: inset 0 2px 0 rgba(255,255,255,.55), 0 3px 0 rgba(0,0,0,.4); transition: transform .12s; }
.tc .tn:hover .b { transform: scale(1.12); }
.tc .tn small { position: absolute; top: calc(var(--nd) + 1px); white-space: nowrap; font: 700 13px 'Josefin Sans', sans-serif; color: #fbf1dc; text-shadow: 0 2px 0 #0b3b3f, 0 0 4px #0b3b3f; pointer-events: none; }
.tc .tn.s1 .b { border-color: #f0c35a; }
.tc .tn.cur .b { box-shadow: 0 0 0 3px #f0c35a, 0 0 14px rgba(240,195,90,.85), 0 3px 0 rgba(0,0,0,.4); }
.tc .tn.on .b { background: linear-gradient(#ffd5cc, #ff8f95); transform: scale(1.1); }
.tc .tn.open .b { animation: tcpulse .8s ease-in-out infinite alternate; background: linear-gradient(#cdfbe8, #7fe3c4); }
.tc .tn.dim .b { filter: saturate(.45) brightness(.85); }
.tc .tn .lv { position: absolute; top: -8px; right: -10px; padding: 0 5px; border: 2px solid #0b3b3f; border-radius: 999px; font: 700 10px 'Josefin Sans', sans-serif; color: #0b3b3f; background: #f0c35a; }
@keyframes tcpulse { from { transform: scale(1); box-shadow: 0 0 0 0 rgba(127,227,196,.9), 0 3px 0 rgba(0,0,0,.4); } to { transform: scale(1.12); box-shadow: 0 0 0 7px rgba(127,227,196,0), 0 3px 0 rgba(0,0,0,.4); } }
`;

let injected = false;

export function buildTreeCircle(o: TreeOpts): HTMLElement {
  if (!injected) {
    injected = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.append(st);
  }
  const S = o.size ?? 320;
  const c = S / 2;
  const nd = Math.round(S * 0.14);
  const r2 = S * 0.26;
  const r3 = S * 0.405;
  const forms = FORMS_OF_TREE(o.tree);
  const s1 = forms.filter((f) => f.stage === 1);
  const s2 = forms.filter((f) => f.stage === 2);
  const s3 = forms.filter((f) => f.stage === 3);
  const at = (r: number, deg: number) => ({ x: c + r * Math.cos((deg * Math.PI) / 180), y: c - r * Math.sin((deg * Math.PI) / 180) });

  const place = new Map<string, { x: number; y: number }>();
  place.set(s1[0].id, { x: c, y: c });
  const angles2 = [180, 0];
  const angles3 = [[142, 218], [38, 322]];
  s2.forEach((f, i) => place.set(f.id, at(r2, angles2[i % 2])));
  s3.forEach((f, i) => place.set(f.id, at(r3, angles3[Math.floor(i / 2) % 2][i % 2])));

  const root = document.createElement('div');
  root.className = 'tc';
  root.style.width = `${S}px`;
  root.style.height = `${S}px`;
  root.style.setProperty('--nd', `${nd}px`);

  // rings and lines
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${S} ${S}`);
  for (const r of [r2, r3]) {
    const ring = document.createElementNS(NS, 'circle');
    ring.setAttribute('cx', String(c));
    ring.setAttribute('cy', String(c));
    ring.setAttribute('r', String(r));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', 'rgba(240,195,90,.35)');
    ring.setAttribute('stroke-width', '2');
    ring.setAttribute('stroke-dasharray', '4 6');
    svg.append(ring);
  }
  const line = (a: { x: number; y: number }, b: { x: number; y: number }, strong: boolean) => {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', String(a.x));
    l.setAttribute('y1', String(a.y));
    l.setAttribute('x2', String(b.x));
    l.setAttribute('y2', String(b.y));
    l.setAttribute('stroke', strong ? '#f0c35a' : 'rgba(240,195,90,.28)');
    l.setAttribute('stroke-width', strong ? '3' : '2');
    svg.append(l);
  };
  const p1 = place.get(s1[0].id)!;
  s2.forEach((f) => line(p1, place.get(f.id)!, true));
  s3.forEach((f, i) => {
    const parent = s2[Math.floor(i / 2)];
    for (const o2 of s2) line(place.get(o2.id)!, place.get(f.id)!, o2 === parent); // any final form is open, the lineage is the bold line
  });
  root.append(svg);

  const open = new Set(o.open ?? []);
  for (const f of forms) {
    const p = place.get(f.id)!;
    const n = document.createElement('div');
    n.className = `tn s${f.stage}${f.id === o.focus ? ' on' : ''}${f.id === o.current ? ' cur' : ''}${open.has(f.id) ? ' open' : ''}${o.open && !open.has(f.id) && f.id !== o.current ? ' dim' : ''}`;
    n.style.left = `${p.x}px`;
    n.style.top = `${p.y}px`;
    n.title = `${f.name} · stage ${f.stage} · ${f.skill.name}: ${f.skill.desc}`;
    n.innerHTML = `<div class="b">${ANIMAL_EMOJI[f.id] ?? '🐾'}</div><small>${f.name}</small>${f.stage > 1 ? `<span class="lv">Lv ${EVOLVE_LEVELS[f.stage - 2]}</span>` : ''}`;
    n.addEventListener('click', () => o.onPick(f.id));
    root.append(n);
  }
  return root;
}
