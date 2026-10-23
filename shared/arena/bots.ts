// AI fighters. They fill empty slots (so a match is always 20 animals) and take over for anyone
// who leaves. They play by the same rules and through the same Input a human uses.
import { EVOLVE_LEVELS, STAT_KEYS, evolveOptions, type Stats } from './animals';
import { WATER_Y } from './terrain';
import type { Fighter, Match, Mob } from './match';
import { ringAt, RINGS } from './match';

interface Mem {
  style: number; // 0 aggressive .. 1 cautious
  focus: Fighter | Mob | null;
  retarget: number;
  wanderX: number;
  wanderZ: number;
  wanderUntil: number;
  lastX: number;
  lastZ: number;
  stuckAt: number;
  detourUntil: number;
  detourSign: number;
  statPlan: (keyof Stats)[];
  nextAct: number;
  nextOrder: number;
  guardUntil: number;
  react: number; // how late in the wind-up this bot reacts
  dazeUntil: number; // attention lapses: it just stands there
  nextDaze: number;
  wobble: number;
}

const mem = new WeakMap<Fighter, Mem>();

const PLANS: Record<string, (keyof Stats)[]> = {
  wolf: ['atk', 'spd', 'hp', 'atk', 'sta', 'spd', 'hp'],
  bear: ['hp', 'atk', 'hp', 'atk', 'sta', 'hp'],
  cheetah: ['atk', 'hp', 'spd', 'atk', 'sta', 'hp'],
  badger: ['atk', 'hp', 'atk', 'hp', 'spd'],
  croc: ['atk', 'hp', 'atk', 'hp', 'spd'],
  boar: ['atk', 'hp', 'spd', 'atk', 'hp'],
  otter: ['hp', 'atk', 'spd', 'hp', 'sta'],
  porcupine: ['hp', 'atk', 'hp', 'sta', 'atk'],
};

const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

function memOf(m: Match, f: Fighter): Mem {
  let s = mem.get(f);
  if (!s) {
    s = {
      style: m.rnd(), focus: null, retarget: 0, wanderX: f.x, wanderZ: f.z, wanderUntil: 0, lastX: f.x, lastZ: f.z, stuckAt: 0, detourUntil: 0, detourSign: 1,
      statPlan: PLANS[f.def.id] ?? [...STAT_KEYS], nextAct: 0, nextOrder: 0, guardUntil: 0, react: 0.01 + m.rnd() * 0.04, dazeUntil: 0, nextDaze: m.time + 3 + m.rnd() * 6, wobble: m.rnd() * 6,
    };
    mem.set(f, s);
  }
  return s;
}

/** Walk toward a point, steering around trouble. Returns the distance left. */
function goTo(m: Match, f: Fighter, s: Mem, x: number, z: number, sprint = false): number {
  const dx = x - f.x;
  const dz = z - f.z;
  const d = Math.hypot(dx, dz);
  let ux = d > 0.001 ? dx / d : 0;
  let uz = d > 0.001 ? dz / d : 0;
  // stuck detection: wanted to move but barely did
  if (m.time - s.stuckAt > 1.2) {
    const moved = Math.hypot(f.x - s.lastX, f.z - s.lastZ);
    if (moved < 0.9 && d > 2 && f.input.s >= 0 && (f.input.dx !== 0 || f.input.dz !== 0)) {
      s.detourUntil = m.time + 1 + m.rnd();
      s.detourSign = m.rnd() < 0.5 ? -1 : 1;
    }
    s.stuckAt = m.time;
    s.lastX = f.x;
    s.lastZ = f.z;
  }
  if (m.time < s.detourUntil) {
    const px = -uz * s.detourSign;
    const pz = ux * s.detourSign;
    ux = ux * 0.35 + px * 0.9;
    uz = uz * 0.35 + pz * 0.9;
  } else if (m.terrain.isDeep(f.x + ux * 3, f.z + uz * 3) && f.def.swim === 'land' && !m.terrain.isDeep(f.x, f.z)) {
    // do not wade into deep water: slide along the shore
    const px = -uz;
    const pz = ux;
    ux = px * s.detourSign;
    uz = pz * s.detourSign;
  }
  const i = f.input;
  i.dx = d < 0.4 ? 0 : ux;
  i.dz = d < 0.4 ? 0 : uz;
  // they do not walk straight: a lazy weave in the heading
  const wob = Math.sin(m.time * 1.4 + s.wobble) * 0.4;
  const wx = ux * Math.cos(wob) - uz * Math.sin(wob);
  const wz = ux * Math.sin(wob) + uz * Math.cos(wob);
  if (d > 3) {
    i.dx = d < 0.4 ? 0 : wx;
    i.dz = d < 0.4 ? 0 : wz;
  }
  i.yaw = Math.atan2(ux, uz);
  i.sprint = sprint && f.sta > 20;
  i.crouch = false;
  i.s++;
  return d;
}

function stop(f: Fighter) {
  f.input.dx = 0;
  f.input.dz = 0;
  f.input.at = false;
  f.input.sprint = false;
}

/** Which ring radius should survivors be heading for right now? */
function safeRadius(m: Match): number {
  const now = ringAt(m.time);
  let r = now.r;
  for (const s of RINGS) {
    if (m.time >= s.start - 8 && m.time < s.start + s.dur + 10) r = Math.min(r, 350 * s.frac); // they only start moving once it is nearly on them
  }
  return r;
}

export function botThink(m: Match, f: Fighter, dt: number) {
  void dt;
  const s = memOf(m, f);
  const i = f.input;
  if (f.role === 'out') return;
  // every so often a bot simply stops paying attention
  if (m.time > s.nextDaze) {
    s.dazeUntil = m.time + 0.8 + m.rnd() * 1.8;
    s.nextDaze = s.dazeUntil + 2 + m.rnd() * 5;
  }
  if (m.time < s.dazeUntil && f.hp > 0) {
    stop(f);
    i.s++;
    return;
  }
  if (f.hp <= 0) return;
  botGuard(m, f, s);

  // progression
  if (f.pts > 0) {
    const k = s.statPlan[(f.level - 2) % s.statPlan.length] ?? 'hp';
    m.spendStat(f, k);
  }
  // evolve as soon as it is possible and nobody is close
  if (!f.chan && f.level >= EVOLVE_LEVELS[0] && f.swing === null) {
    const opts = evolveOptions(f.def, f.level);
    if (opts.length && !m.fighters.some((o) => o !== f && o.team !== f.team && o.role === 'alive' && dist(o, f) < 28)) m.evolve(f, opts[Math.floor(m.rnd() * opts.length)].id);
  }

  // channelled actions in progress: stand still
  if (f.chan) {
    stop(f);
    i.s++;
    return;
  }

  const safe = safeRadius(m);
  const rr = Math.hypot(f.x, f.z);
  const enemies = nearbyEnemies(m, f, 60);
  const closest = enemies[0] ?? null;

  // 1. get out of the lava, and stay ahead of the next ring
  if (rr > safe - 3) {
    const inward = Math.max(20, safe * 0.55);
    const gx = (f.x / Math.max(1, rr)) * inward;
    const gz = (f.z / Math.max(1, rr)) * inward;
    goTo(m, f, s, m.time > 600 ? 0 : gx, m.time > 600 ? 0 : gz, true);
    i.at = false;
    if (closest && dist(closest, f) < 4) fight(m, f, s, closest, true);
    return;
  }

  // 2. heal when hurt and nobody is close
  if (f.hp < f.maxHp * 0.5 && (!closest || dist(closest, f) > 16)) {
    const idx = f.inv.findIndex((it) => it && (it.k === 'meat' || it.k === 'berry') && !(it.k === 'meat' && m.time - it.born > 70));
    if (idx >= 0) {
      stop(f);
      m.useItem(f, idx);
      i.s++;
      return;
    }
  }
  if (f.sta < 12 && f.inv.some((it) => it?.k === 'water' && it.n > 0) && !closest) {
    const idx = f.inv.findIndex((it) => it?.k === 'water');
    stop(f);
    m.useItem(f, idx);
    i.s++;
    return;
  }

  // wildlife on our tail: fight it if we can win, otherwise outrun it
  const chasers = m.mobs.filter((o) => o.hp > 0 && o.state === 'attack' && o.target === f && dist(o, f) < 16);
  if (chasers.length) {
    const totalHp = chasers.reduce((a, o) => a + o.hp, 0);
    const theirDps = chasers.reduce((a, o) => a + o.def.dmg / 1.1, 0);
    const myDps = (f.dv.dmg / 0.62) * 0.75;
    const taken = theirDps * (totalHp / myDps) * 0.6;
    if (taken < f.hp * 0.55) {
      chasers.sort((a, b) => dist(a, f) - dist(b, f));
      s.focus = chasers[0];
      return fight(m, f, s, chasers[0], false);
    }
    let cx = 0;
    let cz = 0;
    for (const o of chasers) {
      cx += o.x;
      cz += o.z;
    }
    cx /= chasers.length;
    cz /= chasers.length;
    const dx = f.x - cx;
    const dz = f.z - cz;
    const d = Math.hypot(dx, dz) || 1;
    goTo(m, f, s, f.x + (dx / d) * 30, f.z + (dz / d) * 30, true);
    if (f.sta > 40 && m.time >= f.dashAt && m.rnd() < 0.015) m.dash(f, dx, dz);
    i.at = false;
    s.focus = null;
    s.retarget = m.time + 3;
    return;
  }

  // 3. fight a player?
  const endgame = m.time > 480; // when the ring is small everyone has to fight
  const wantsFight = endgame || ((m.time > 360 || f.level >= 13) && s.style < 0.55);
  if (closest && wantsFight) {
    const ratio = (f.level + 1) / (closest.level + 1);
    const hpOk = f.hp > f.maxHp * 0.35;
    const stronger = ratio > 1.1 + s.style * 0.5;
    if (hpOk && (stronger || dist(closest, f) < 4)) {
      s.focus = closest;
      return fight(m, f, s, closest, false);
    }
    if (!endgame && (!hpOk || ratio < 0.5)) {
      // run away
      const dx = f.x - closest.x;
      const dz = f.z - closest.z;
      const d = Math.hypot(dx, dz) || 1;
      goTo(m, f, s, f.x + (dx / d) * 30 - f.x * 0.05, f.z + (dz / d) * 30 - f.z * 0.05, true);
      i.at = false;
      return;
    }
  }
  // someone is biting us: defend
  if (closest && dist(closest, f) < 6 && m.time - f.lastHurt < 3 && f.lastAttacker === closest.id) return fight(m, f, s, closest, false);
  // keep clear of other players until it is time to fight
  if (closest && !wantsFight && dist(closest, f) < 24) {
    const dx = f.x - closest.x;
    const dz = f.z - closest.z;
    const d = Math.hypot(dx, dz) || 1;
    goTo(m, f, s, f.x + (dx / d) * 20, f.z + (dz / d) * 20, false);
    i.at = false;
    return;
  }

  // 4. pick something up
  const drop = m.drops.find((d) => dist(d, f) < 16 && (f.hp < f.maxHp * 0.9 || d.pile) && f.inv.some((it) => !it));
  if (drop && !closest) {
    const d = goTo(m, f, s, drop.x, drop.z);
    i.at = false;
    if (d < 2.4) {
      stop(f);
      botLoot(m, f);
    }
    return;
  }

  // 5. farm
  if (m.time >= s.retarget || !s.focus || s.focus.hp <= 0 || (s.focus.kind === 'f' && (s.focus as Fighter).role !== 'alive')) {
    s.retarget = m.time + 1.2 + m.rnd();
    s.focus = pickFarmTarget(m, f);
  }
  const t = s.focus;
  if (t && t.hp > 0) return fight(m, f, s, t, false);

  // 6. nothing around: wander, drifting toward the middle as the match goes on
  if (m.time > s.wanderUntil || dist(f, { x: s.wanderX, z: s.wanderZ }) < 3) {
    const pull = Math.min(0.8, m.time / 400);
    const a = m.rnd() * Math.PI * 2;
    const r = 25 + m.rnd() * 55;
    s.wanderX = f.x * (1 - pull * 0.25) + Math.cos(a) * r;
    s.wanderZ = f.z * (1 - pull * 0.25) + Math.sin(a) * r;
    const wr = Math.hypot(s.wanderX, s.wanderZ);
    if (wr > safe - 25) {
      s.wanderX *= (safe - 25) / wr;
      s.wanderZ *= (safe - 25) / wr;
    }
    s.wanderUntil = m.time + 10 + m.rnd() * 8;
  }
  i.at = false;
  goTo(m, f, s, s.wanderX, s.wanderZ, false);
}

function botLoot(m: Match, f: Fighter) {
  m.startLoot(f);
}

function nearbyEnemies(m: Match, f: Fighter, r: number): Fighter[] {
  const out: Fighter[] = [];
  for (const o of m.fighters) {
    if (o === f || o.role !== 'alive' || o.hp <= 0 || o.team === f.team) continue;
    const d = dist(o, f);
    if (d > r) continue;
    // hidden players are only seen up close
    if ((o.subUntil > m.time || o.reedUntil > m.time) && d > 8) continue;
    out.push(o);
  }
  out.sort((a, b) => dist(a, f) - dist(b, f));
  return out;
}

function pickFarmTarget(m: Match, f: Fighter): Mob | null {
  const lim = safeRadius(m) - 28;
  const maxTier = f.level < 5 ? 1 : f.level < 10 ? 2 : f.level < 15 ? 3 : 4;
  const minTier = f.level < 12 ? 1 : 2;
  let best: Mob | null = null;
  let bs = -Infinity;
  for (const o of m.mobs) {
    if (o.hp <= 0) continue;
    if (o.def.tier > maxTier || (o.def.tier < minTier && f.level >= 12 && o.def.tier === 1)) continue;
    if (o.def.behavior === 'alpha' && (f.hp < f.maxHp * 0.7 || f.level < 14)) continue;
    const d = dist(o, f);
    if (d > 90 || Math.hypot(o.x, o.z) > lim) continue;
    // fish and ducks in deep water are awkward for land animals
    if (o.def.aquatic && f.def.swim === 'land' && m.terrain.depthAt(o.x, o.z) > 0.9) continue;
    const value = o.def.tier * 18 + (o.def.behavior === 'flee' ? -6 : 0);
    const score = value - d * 0.8;
    if (score > bs) {
      bs = score;
      best = o;
    }
  }
  return best;
}

/** Close in on a target and use skills. */
function fight(m: Match, f: Fighter, s: Mem, t: Fighter | Mob, retreating: boolean) {
  const i = f.input;
  const d = dist(f, t);
  const reach = f.dv.reach + t.r;
  const sprint = d > reach + 4;
  if (!retreating && d > reach + 5 && d < reach + 14 && f.sta > 45 && m.time >= f.dashAt && m.rnd() < 0.01) m.dash(f, t.x - f.x, t.z - f.z);
  if (!retreating) {
    if (d > reach * 0.8) goTo(m, f, s, t.x, t.z, sprint);
    else {
      i.dx = 0;
      i.dz = 0;
      i.s++;
    }
  }
  const yaw = Math.atan2(t.x - f.x, t.z - f.z);
  i.yaw = yaw + (m.rnd() - 0.5) * 1.4; // poor aim
  i.at = d < reach + 0.5 && m.rnd() < 0.5;
  // skills
  if (m.time < s.nextAct - 1.3) return;
  const sk = m.slotSkills(f);
  for (let slot = 0; slot < 4; slot++) {
    const skill = sk[slot];
    const fx = skill?.fx;
    if (!skill || !fx || m.time < f.cdAt[slot]) continue;
    const hurt = f.hp < f.maxHp * 0.5;
    let use = false;
    switch (fx.k) {
      case 'cone':
        use = d < fx.range;
        break;
      case 'dash':
        use = d > 3 && d < fx.dist + 1 && (t.kind === 'f' || fx.dmg > 0);
        if (fx.dmg === 0) use = hurt && d < 4;
        break;
      case 'aoe':
        use = fx.dmg > 0 ? d < fx.r : t.kind === 'f' && d < Math.min(fx.r, 30) && (fx.scare ? d < 10 : true);
        break;
      case 'proj':
        use = d > 4 && d < fx.range;
        break;
      case 'buff':
        use = d < 12 && (t.kind === 'f' || t.maxHp > 80);
        break;
      case 'heal':
        use = hurt;
        break;
      case 'grab':
        use = d < fx.range;
        break;
      case 'submerge':
        use = false;
        break;
    }
    if (use && m.rnd() < 0.04) m.castSkill(f, slot, yaw);
  }
}
export const _internal = { WATER_Y };

/** See an attack winding up in front of us and raise the guard just before it lands: a parry. */
function botGuard(m: Match, f: Fighter, s: Mem) {
  if (f.guarding || f.swing || m.time < f.guardCd || f.stunUntil > m.time || f.whiffUntil > m.time) return;
  let threat = false;
  for (const o of m.fighters) {
    if (o === f || o.team === f.team || !o.swing || o.role === 'out') continue;
    const left = o.swing.at - m.time;
    if (left > s.react || left < 0.02) continue;
    if (dist(o, f) > o.dv.reach * 1.4 + f.r + 0.4) continue;
    threat = true;
    break;
  }
  if (!threat) {
    for (const o of m.mobs) {
      if (!o.strikeAt || o.hp <= 0) continue;
      const left = o.strikeAt - m.time;
      if (left > s.react + 0.1 || left < 0.02 || dist(o, f) > o.r + 3.4) continue;
      threat = true;
      break;
    }
  }
  // sharper players parry more often; cautious ones guard more
  if (threat && m.rnd() < 0.05 + (1 - s.style) * 0.05) {
    m.setGuard(f, true);
    s.guardUntil = m.time + 0.5;
  }
}
