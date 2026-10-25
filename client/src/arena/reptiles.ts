// The four lizards of the reptile tree, each built from its own measurements rather than one lizard in four colours:
// a gecko is a small, big-headed, big-eyed animal with sticky toe pads and a fat tail; a monitor is a slim runner on a
// long neck with a whip of a tail; a komodo dragon is a heavy brute with a deep belly, a thick neck and a dewlap; a
// crocodile is a flat armoured log with a huge toothy snout, double rows of bony plates and a crested paddle of a tail.
import * as THREE from 'three';
import { Parts, mix, shade } from './creatures';
import { densify } from './mammals';
import { loft, reptileEyes, scales, tube, vnoise, type Ring } from './realquad';
import type { Built, QuadSpec } from './models';

type V3 = [number, number, number];

interface LizardSpec {
  L: number; // body length (shoulder to hip)
  W: number; // body width
  H: number; // body depth
  hip: number; // belly height off the ground
  neck: [number, number, number]; // length, radius, how far it rises
  head: { l: number; w: number; h: number; snout: number; snoutW?: number };
  leg: { t: number; toe: number; out: number; pad?: boolean; claw: number };
  tail: { l: number; t: number; kind: 'carrot' | 'whip' | 'thick' | 'paddle' };
  eye: number;
  scale: number; // scale cell of the skin
  bands?: boolean;
}

const Z: Record<string, LizardSpec> = {
  gecko: { L: 0.46, W: 0.17, H: 0.1, hip: 0.07, neck: [0.07, 0.05, 0.1], head: { l: 0.22, w: 0.14, h: 0.075, snout: 0.07 }, leg: { t: 0.026, toe: 0.07, out: 1.5, pad: true, claw: 0 }, tail: { l: 0.62, t: 0.07, kind: 'carrot' }, eye: 0.05, scale: 44 },
  monitor: { L: 0.8, W: 0.15, H: 0.14, hip: 0.2, neck: [0.34, 0.058, 0.2], head: { l: 0.28, w: 0.09, h: 0.07, snout: 0.2, snoutW: 0.04 }, leg: { t: 0.032, toe: 0.07, out: 1.1, claw: 1 }, tail: { l: 1.45, t: 0.06, kind: 'whip' }, eye: 0.028, scale: 36, bands: true },
  komodo: { L: 1.0, W: 0.46, H: 0.36, hip: 0.2, neck: [0.14, 0.18, 0.1], head: { l: 0.42, w: 0.2, h: 0.14, snout: 0.2, snoutW: 0.085 }, leg: { t: 0.085, toe: 0.11, out: 1.0, claw: 1.8 }, tail: { l: 1.0, t: 0.15, kind: 'thick' }, eye: 0.04, scale: 30 },
  croc: { L: 1.5, W: 0.64, H: 0.3, hip: 0.1, neck: [0.04, 0.22, 0.0], head: { l: 0.62, w: 0.32, h: 0.11, snout: 0.62, snoutW: 0.18 }, leg: { t: 0.085, toe: 0.13, out: 1.5, claw: 0.6 }, tail: { l: 1.6, t: 0.24, kind: 'paddle' }, eye: 0.04, scale: 22 },
};
export const LIZARD = new Set(Object.keys(Z));

export function buildLizardR(spec: QuadSpec, id: string): Built {
  const s = Z[id];
  const { L, W, H, hip } = s;
  const Wh = W / 2;
  const Hh = H / 2;
  const fur = spec.fur;
  const belly = spec.belly ?? shade(fur, 1.3);
  const pawC = spec.paw ?? shade(fur, 0.7);
  const croc = id === 'croc';
  const gecko = id === 'gecko';
  const komodo = id === 'komodo';
  const root = new THREE.Group();
  const torso = new THREE.Group();
  torso.position.y = hip + Hh;
  root.add(torso);
  const u2z = (u: number) => (u - 0.5) * L;
  const skin = (z: number, a: number, y: number, x: number): number => {
    let c = scales(fur, belly, a, x, y, z, s.scale, croc ? 0.78 : 0.92);
    const cd = Math.cos(a);
    if (s.bands && cd > 0.2 && Math.sin(z * 24) > 0.55) c = mix(c, shade(fur, 0.6), 0.6);
    if (gecko && cd > 0.1 && vnoise(z * 30 + 5, a * 4, 2) > 0.62) c = mix(c, 0xf0d24a, 0.85);
    if (croc && cd > 0.25 && vnoise(z * 8, x * 8, 3) > 0.62) c = mix(c, shade(fur, 0.55), 0.55); // dark blotches
    if (komodo && cd > 0.1 && vnoise(z * 40, x * 40, 5) > 0.7) c = mix(c, shade(fur, 1.35), 0.5); // pale flecks
    return c;
  };

  // --- body ---
  const bellyDrop = komodo ? 1.5 : croc ? 0.7 : 0.8;
  const rings: Ring[] = [
    { z: u2z(0), w: 0.5 * Wh, top: 0.6 * Hh, bot: 0.5 * Hh },
    { z: u2z(0.12), w: 0.95 * Wh, top: 0.95 * Hh, bot: 0.75 * Hh * bellyDrop },
    { z: u2z(0.4), w: 1.0 * Wh, top: 1.0 * Hh, bot: 0.85 * Hh * bellyDrop },
    { z: u2z(0.7), w: 1.0 * Wh, top: 1.0 * Hh, bot: 0.85 * Hh * bellyDrop },
    { z: u2z(0.95), w: 0.78 * Wh, top: 0.88 * Hh, bot: 0.72 * Hh },
    { z: u2z(1.0) + 0.04 * L, w: 0.6 * Wh, top: 0.7 * Hh, bot: 0.6 * Hh },
  ];
  const tp = new Parts();
  tp.addGeo(loft(densify(rings, 34), skin, 18));
  // keeled scutes down the back
  if (croc || komodo) {
    const rows = croc ? [0, -0.32, 0.32] : [0];
    for (let i = 0; i < (croc ? 16 : 10); i++) {
      const z = u2z(0.04 + i * (croc ? 0.06 : 0.09));
      for (const rx of rows) tp.ball(0.05 * Wh + 0.015, 0.05 * Hh + 0.02, (croc ? 0.05 : 0.03) * L, shade(fur, 0.58), rx * Wh, Hh * (rx ? 0.92 : 1) + 0.005, z, 0, 6, 5);
    }
  }
  // --- neck ---
  const [nl, nr, nu] = s.neck;
  const nBase: V3 = [0, 0, L / 2 - 0.04 * L];
  const nTip: V3 = [0, nl * nu * 2, L / 2 + nl];
  const npath: V3[] = [];
  const nrad: number[] = [];
  for (let i = 0; i < 5; i++) {
    const u = i / 4;
    npath.push([0, nTip[1] * u + Math.sin(u * Math.PI) * nl * 0.06, nBase[2] + (nTip[2] - nBase[2]) * u]);
    nrad.push(nr * (1.1 - 0.35 * u));
  }
  tp.addGeo(tube(npath, nrad, (u, a) => skin(u, a, 0, 0), 12));
  if (komodo) tp.ball(0.09, 0.1, 0.22, mix(belly, fur, 0.3), 0, -0.1, L / 2 + 0.06, 0, 8, 6); // the loose dewlap under the throat
  torso.add(new THREE.Mesh(tp.merged(), new THREE.MeshBasicMaterial()));

  // --- head ---
  const head = new THREE.Group();
  const { l: hl, w: hw, h: hh, snout: sl } = s.head;
  const sw = s.head.snoutW ?? hw * 0.6;
  head.position.set(0, nTip[1] + hh * 0.1, nTip[2] + hl * 0.28);
  const hp = new Parts();
  const hrings: Ring[] = [
    { z: -0.5 * hl, w: 0.8 * hw, top: 0.9 * hh, bot: 0.7 * hh },
    { z: -0.1 * hl, w: hw, top: hh, bot: 0.75 * hh },
    { z: 0.25 * hl, w: Math.max(sw * 1.4, 0.6 * hw), top: 0.85 * hh, bot: 0.65 * hh, cy: -0.05 * hh },
    { z: 0.5 * hl + sl * 0.4, w: sw * (croc ? 1.1 : 1), top: 0.62 * hh, bot: 0.5 * hh, cy: -0.1 * hh },
    { z: 0.5 * hl + sl * 0.85, w: sw * 0.88, top: 0.55 * hh, bot: 0.44 * hh, cy: -0.1 * hh },
    { z: 0.5 * hl + sl, w: sw * (croc ? 0.95 : 0.6), top: 0.45 * hh, bot: 0.36 * hh, cy: -0.1 * hh },
  ];
  hp.addGeo(loft(densify(hrings, 16), (z, a, y, x) => scales(shade(fur, 1.02), belly, a, x, y, z, s.scale * 1.2, 0.9), 14));
  const jaw: Ring[] = [
    { z: -0.1 * hl, w: 0.85 * hw, top: 0.1 * hh, bot: 0.3 * hh, cy: -0.55 * hh },
    { z: 0.5 * hl + sl * 0.5, w: sw * 0.95, top: 0.08 * hh, bot: 0.22 * hh, cy: -0.5 * hh },
    { z: 0.5 * hl + sl * 0.97, w: sw * 0.8, top: 0.06 * hh, bot: 0.16 * hh, cy: -0.46 * hh },
  ];
  hp.addGeo(loft(jaw, (z, a) => (Math.cos(a) > 0.6 ? 0x3a1c1c : belly), 12));
  if (croc || komodo || id === 'monitor') {
    const nT = croc ? 12 : komodo ? 8 : 6;
    for (let i = 0; i < nT; i++) {
      for (const sx of [-1, 1]) {
        const z = 0.1 * hl + (0.4 * hl + sl * 0.95) * (i / (nT - 1));
        const w = sw * (1.05 - 0.2 * (i / nT)) + (i < nT / 3 ? 0.12 * hw : 0);
        const big = croc && (i === 3 || i === 8);
        hp.spike([sx * w, -0.3 * hh, z], [sx * w, (i % 2 ? 0.2 : -0.7) * hh - (big ? 0.2 * hh : 0), z], (croc ? 0.014 : 0.009) + (big ? 0.008 : 0), 0xf2ecd8);
      }
    }
  }
  if (croc) hp.ball(0.4 * sw, 0.28 * hh, 0.5 * sw, shade(fur, 0.7), 0, 0.4 * hh, 0.5 * hl + sl * 0.97, 0, 8, 6); // the bulb of the nostrils on the tip of the snout
  else for (const sx of [-1, 1]) hp.ball(0.03 * hl, 0.02 * hl, 0.03 * hl, 0x1a1a14, sx * 0.4 * sw, 0.35 * hh, 0.5 * hl + sl * 0.95, 0, 6, 5);
  if (id === 'monitor') hp.seg([0, -0.2 * hh, 0.5 * hl + sl], [0, -0.2 * hh, 0.5 * hl + sl + 0.1], 0.004, 0.003, 0xc8283a, 4); // the long forked tongue
  head.add(new THREE.Mesh(hp.merged(), new THREE.MeshBasicMaterial()));
  const eyes = reptileEyes(head, 1, spec.eye ?? 0xd8a82a, s.eye, 0.6 * hh, 0.1 * hl, croc ? 0.62 * hw : 0.62 * hw);
  if (croc) for (const e of eyes) e.position.y = 0.95 * hh; // a crocodile's eyes ride on top of the skull
  torso.add(head);

  // --- legs sprawl outward and drop to the ground ---
  const legs: THREE.Group[] = [];
  const lx = Wh * 0.82;
  const lz = L / 2 - L * 0.1;
  const t = s.leg.t;
  for (const [sx, sz] of [[1, 1], [-1, -1], [-1, 1], [1, -1]] as const) {
    const g = new THREE.Group();
    const top = hip + Hh * 0.5;
    g.position.set(sx * lx, top, sz * lz);
    const front = sz > 0;
    const bottom = -top;
    const lp = new Parts();
    const out = s.leg.out;
    lp.ball(t * 1.7, t * 1.6, t * 2.0, fur, sx * t * 0.3, 0, 0, 0, 10, 8);
    const kn: V3 = [sx * t * 2.4 * out, bottom * 0.45, front ? -t * 0.5 : t * 0.5];
    const ft: V3 = [sx * t * 2.8 * out, bottom + t * 0.5, front ? t * 0.6 : -t * 0.2];
    lp.seg([sx * t * 0.3, 0, 0], kn, t * 1.25, t * 0.88, fur, 8);
    lp.ball(t * 0.95, t * 0.95, t * 0.95, fur, kn[0], kn[1], kn[2], 0, 7, 6);
    lp.seg(kn, ft, t * 0.88, t * 0.68, shade(fur, 0.92), 8);
    const toe = s.leg.toe;
    lp.ball(t * 1.1, t * 0.4, t * 1.5, pawC, ft[0], bottom + t * 0.25, ft[2] + t * 0.6, 0, 8, 6);
    for (let k = -2; k <= 2; k++) {
      const tx = ft[0] + k * t * 0.45;
      const tip: V3 = [tx + k * t * 0.1, bottom + t * 0.12, ft[2] + toe * (1 - Math.abs(k) * 0.1)];
      lp.seg([tx, bottom + t * 0.25, ft[2] + t * 1.0], tip, t * 0.2, t * (s.leg.pad ? 0.3 : 0.12), pawC, 5);
      if (s.leg.pad) lp.ball(t * 0.42, t * 0.08, t * 0.55, shade(pawC, 1.25), tip[0], tip[1], tip[2], 0, 6, 4); // the sticky round toe pad
      if (s.leg.claw > 0) lp.spike(tip, [tip[0] + k * t * 0.05, bottom + t * 0.04, tip[2] + t * 0.5 * s.leg.claw], t * 0.08 * Math.max(1, s.leg.claw), 0x2a2218);
    }
    g.add(new THREE.Mesh(lp.merged(), new THREE.MeshBasicMaterial()));
    root.add(g);
    legs.push(g);
  }

  // --- tail ---
  const tail = new THREE.Group();
  tail.position.set(0, 0, -L / 2 + 0.02 * L);
  const tl = s.tail.l;
  const tt = s.tail.t;
  const n = 11;
  const path: V3[] = [];
  const radii: number[] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    path.push([Math.sin(u * 5) * tl * (s.tail.kind === 'whip' ? 0.07 : 0.035), -u * u * Hh * 0.45, -tl * u]);
    let r: number;
    switch (s.tail.kind) {
      case 'carrot': r = tt * (1.0 - u * 0.15) * Math.pow(1 - u, 0.55); break; // a fat, tapering carrot
      case 'whip': r = tt * Math.pow(1 - u, 1.1) + 0.006; break;
      case 'thick': r = tt * (1 - u * 0.85); break;
      default: r = tt * (1 - u * 0.9);
    }
    radii.push(Math.max(0.005, r));
  }
  const tpp = new Parts();
  tpp.addGeo(tube(path, radii, (u, a) => skin(u * 2, a, u, a), 12));
  if (croc) {
    // a crest of tall plates along the top that makes the tail a rowing paddle
    for (let i = 1; i < n - 1; i++) tpp.ball(radii[i] * 0.25, radii[i] * 0.85, (tl / n) * 0.55, shade(fur, 0.58), path[i][0], path[i][1] + radii[i] * 1.0, path[i][2], 0, 5, 4);
  }
  tail.add(new THREE.Mesh(tpp.merged(), new THREE.MeshBasicMaterial()));
  torso.add(tail);

  return { root, legs, head, tail, torso, eyes, ears: [], hip, spec: { ...spec, id, len: L, w: W, h: H, legLen: hip, legT: t, scale: 1, crawl: true, head: { ...spec.head, s: hl } } };
}
