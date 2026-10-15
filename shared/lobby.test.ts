import assert from 'node:assert/strict';
import { Lobby, type Peer, type Session } from './lobby';
import { JUMP_MAX_Y, MAP_RADIUS, MAX_PLAYERS, SWIM_LIMIT, WATER_MIN_Y, type ServerMsg } from './protocol';
import { clampToArena, SHORE_RADIUS, waterDepth } from './map';

function client(lobby: Lobby) {
  const inbox: ServerMsg[] = [];
  let closed = false;
  const peer: Peer = { send: (d) => inbox.push(JSON.parse(d)), close: () => (closed = true) };
  const s: Session = lobby.open(peer);
  const tx = (m: object) => lobby.message(s, JSON.stringify(m));
  return { s, inbox, tx, isClosed: () => closed };
}

const lobby = new Lobby([{ urls: 'stun:example' }]);

// join, de-duplicated names, welcome contents
const a = client(lobby);
a.tx({ t: 'join', name: '  jane   doe ' });
const welcome = a.inbox[0];
assert.equal(welcome.t, 'welcome');
assert.equal(a.s.name, 'jane doe');

const b = client(lobby);
b.tx({ t: 'join', name: 'JANE DOE' });
assert.equal(b.s.name, 'JANE DOE'.slice(0, 13) + '_2');
assert.ok(a.inbox.some((m) => m.t === 'joined'));

// positions are clamped to the circular arena and only sent to others
b.tx({ t: 'pos', x: 9999, z: -9999, ry: 1 });
assert.equal(lobby.flush(), true);
assert.equal(lobby.flush(), false);
const st = a.inbox.find((m) => m.t === 'state');
const sp = st && st.t === 'state' ? st.p[0] : null;
assert.ok(sp && sp[0] === b.s.id && sp[3] === 1 && sp[4] === 0 && sp[5] === 0);
assert.ok(sp && Math.abs(Math.hypot(sp[1], sp[2]) - SWIM_LIMIT) < 1e-9); // the sea is walkable out to SWIM_LIMIT
assert.ok(sp && sp[1] > 0 && sp[2] < 0); // pulled toward the centre along the same direction
assert.ok(!b.inbox.some((m) => m.t === 'state'));

// height and crouch are relayed; bad values are sanitised
b.tx({ t: 'pos', x: 1, z: 1, ry: 0, y: 1.2, crouch: true });
b.tx({ t: 'pos', x: 1, z: 1, ry: 0, y: 99, crouch: 'yes' });
assert.equal(b.s.y, JUMP_MAX_Y);
assert.equal(b.s.crouch, false);
b.tx({ t: 'pos', x: 1, z: 1, ry: 0, y: -5 });
assert.equal(b.s.y, WATER_MIN_Y); // wading is allowed, but not unbounded
b.tx({ t: 'pos', x: 1, z: 1, ry: 0, y: -1 });
assert.equal(b.s.y, -1);

// wading depth: dry up to the shore, eased in, fully in the water four metres later
assert.equal(waterDepth(0, 0), 0);
assert.equal(waterDepth(MAP_RADIUS, 0), 0);
assert.equal(waterDepth(SHORE_RADIUS, 0), 0);
assert.ok(waterDepth(SHORE_RADIUS + 2, 0) > 0.4 && waterDepth(SHORE_RADIUS + 2, 0) < 0.6);
assert.equal(waterDepth(SHORE_RADIUS + 4, 0), 1);
assert.equal(waterDepth(0, SHORE_RADIUS + 50), 1);
lobby.flush();

// arena clamp helper
assert.deepEqual(clampToArena(3, 4), { x: 3, z: 4 });
const edge = clampToArena(300, 400);
// (300, 400) is 500 m out on a 3-4-5 line, so it lands at 60% / 80% of the radius
assert.ok(Math.abs(edge.x - 0.6 * MAP_RADIUS) < 1e-9 && Math.abs(edge.z - 0.8 * MAP_RADIUS) < 1e-9);

// chat rate limit: 5 per 5 s
for (let i = 0; i < 8; i++) a.tx({ t: 'chat', text: `hi ${i}` });
assert.equal(b.inbox.filter((m) => m.t === 'chat').length, 5);

// signaling reaches only the target
a.tx({ t: 'signal', to: b.s.id, data: { x: 1 } });
assert.ok(b.inbox.some((m) => m.t === 'signal'));

// private messages: both ends get one copy, nobody else does, and they share the chat rate limit
const dmLobby = new Lobby([]);
const p1 = client(dmLobby);
const p2 = client(dmLobby);
const p3 = client(dmLobby);
for (const [c, n] of [[p1, 'ann'], [p2, 'bo'], [p3, 'cy']] as const) c.tx({ t: 'join', name: n });
p1.tx({ t: 'dm', to: p2.s.id, text: '  psst  ' });
const dmTo = p2.inbox.find((m) => m.t === 'dm');
const dmFrom = p1.inbox.find((m) => m.t === 'dm');
assert.deepEqual(dmTo, { t: 'dm', fromId: p1.s.id, from: 'ann', toId: p2.s.id, to: 'bo', text: 'psst' });
assert.deepEqual(dmFrom, dmTo);
assert.ok(!p3.inbox.some((m) => m.t === 'dm')); // the third player sees nothing
p1.tx({ t: 'dm', to: 'nope', text: 'hi' });
assert.ok(p1.inbox.some((m) => m.t === 'notice'));
p1.tx({ t: 'dm', to: p1.s.id, text: 'me' }); // can't message yourself
assert.equal(p1.inbox.filter((m) => m.t === 'notice').length, 2);
for (let i = 0; i < 8; i++) p1.tx({ t: 'dm', to: p2.s.id, text: `n${i}` });
assert.ok(p2.inbox.filter((m) => m.t === 'dm').length <= 5); // rate limited (shared with chat)

// leaving is announced; lobby cap at MAX_PLAYERS
lobby.close(b.s);
assert.ok(a.inbox.some((m) => m.t === 'left'));
const extra = Array.from({ length: MAX_PLAYERS - 1 }, () => client(lobby));
extra.forEach((c) => c.tx({ t: 'join', name: 'p' }));
const over = client(lobby);
over.tx({ t: 'join', name: 'late' });
assert.deepEqual(over.inbox, [{ t: 'full' }]);
assert.ok(over.isClosed());

// restore after hibernation keeps the player in the lobby
const lobby2 = new Lobby([]);
const c = client(lobby2);
c.tx({ t: 'join', name: 'zed' });
const saved = lobby2.save(c.s);
const lobby3 = new Lobby([]);
const peerB: Peer = { send: () => {}, close: () => {} };
const restored = lobby3.restore(peerB, saved);
assert.equal(restored.name, 'zed');
const d = client(lobby3);
d.tx({ t: 'join', name: 'ZED' });
assert.equal(d.s.name, 'ZED_2');

// ---- profile photos ----
{
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const L = new Lobby([]);
  const u1 = client(L);
  const u2 = client(L);
  u1.tx({ t: 'join', name: 'pic' });
  u2.tx({ t: 'join', name: 'watcher' });
  const events: [string, string | null][] = [];
  L.onAvatar = (id, img) => events.push([id, img]);

  // a valid photo is stored, announced to others (not echoed to the sender), and persisted via the hook
  u1.tx({ t: 'avatar', img: png });
  assert.deepEqual(u2.inbox.find((m) => m.t === 'avatar'), { t: 'avatar', id: u1.s.id, img: png });
  assert.ok(!u1.inbox.some((m) => m.t === 'avatar'));
  assert.deepEqual(events, [[u1.s.id, png]]);

  // someone joining later sees it in the player list
  const late = client(L);
  late.tx({ t: 'join', name: 'late' });
  const w = late.inbox.find((m) => m.t === 'welcome');
  assert.ok(w && w.t === 'welcome' && w.players.some((p) => p.id === u1.s.id && p.avatar === png));

  // anything that is not a small image data URL is ignored
  const before = u2.inbox.length;
  for (const bad of ['http://evil.example/x.png', 'data:text/html;base64,PGgxPg==', 'javascript:alert(1)',
    'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,' + 'A'.repeat(7000), 42, {}]) {
    u1.tx({ t: 'avatar', img: bad as never });
  }
  assert.equal(u2.inbox.length, before);
  assert.equal(u1.s.avatar, png); // still the good one

  // clearing removes it for everyone, and leaving cleans up persisted state
  u1.tx({ t: 'avatar', img: null });
  assert.deepEqual(u2.inbox.filter((m) => m.t === 'avatar').at(-1), { t: 'avatar', id: u1.s.id, img: null });
  u1.tx({ t: 'avatar', img: png });
  L.close(u1.s);
  assert.deepEqual(events.at(-1), [u1.s.id, null]);
}

// ---- verified-login mode ----
async function authTests() {
  const verify = async (token: string) => {
    if (token === 'down') throw new Error('unreachable');
    return token === 'good' ? 'verified_jane' : null;
  };
  const L = new Lobby([], verify);
  const mk = () => {
    const c = client(L);
    const send = (m: object) => L.handle(c.s, JSON.stringify(m));
    return { ...c, send };
  };

  // valid token: server uses the profile name, not the one the client claims
  const ok = mk();
  await ok.send({ t: 'join', name: 'admin', token: 'good' });
  assert.equal(ok.s.name, 'verified_jane');
  assert.equal(ok.inbox[0].t, 'welcome');

  // missing / invalid token: denied and closed, never joins
  const none = mk();
  await none.send({ t: 'join', name: 'admin' });
  assert.deepEqual(none.inbox, [{ t: 'denied', reason: 'Please sign in to join.' }]);
  assert.ok(none.isClosed());
  const bad = mk();
  await bad.send({ t: 'join', name: 'admin', token: 'forged' });
  assert.equal(bad.inbox[0].t, 'denied');
  assert.equal(bad.s.joined, false);

  // auth service down: distinct message
  const down = mk();
  await down.send({ t: 'join', name: 'x', token: 'down' });
  const dm = down.inbox[0];
  assert.ok(dm.t === 'denied' && /unavailable/.test(dm.reason));

  // same account twice: second gets a numbered name rather than a clash
  const again = mk();
  await again.send({ t: 'join', name: 'x', token: 'good' });
  assert.equal(again.s.name, 'verified_jane_2');

  // socket closes while the token is being checked: no ghost player is left behind
  const slowLobby = new Lobby([], () => new Promise((r) => setTimeout(() => r('ghost'), 20)));
  const g = client(slowLobby);
  const pending = slowLobby.handle(g.s, JSON.stringify({ t: 'join', name: 'x', token: 't' }));
  slowLobby.close(g.s);
  await pending;
  assert.equal(g.s.joined, false);
  const watcher = client(slowLobby);
  await slowLobby.handle(watcher.s, JSON.stringify({ t: 'join', name: 'x', token: 't' }));
  assert.equal(watcher.s.name, 'ghost'); // not ghost_2

  // double join while verifying is ignored
  const dbl = mk();
  await Promise.all([
    dbl.send({ t: 'join', name: 'x', token: 'good' }),
    dbl.send({ t: 'join', name: 'x', token: 'good' }),
  ]);
  assert.equal(dbl.inbox.filter((m) => m.t === 'welcome').length, 1);
}
await authTests();

// ---- malformed input never throws (this used to crash the server / reset the Durable Object) ----
async function malformedTests() {
  const junk = ['null', '5', '"str"', '[1,2]', 'true', '{', '', '{"t":null}', '{"t":"pos"}', '{"t":"signal"}',
    '{"t":"join","name":{"a":1}}', '{"t":"chat","text":5}'];
  for (const withAuth of [false, true]) {
    const L = new Lobby([], withAuth ? async () => 'someone' : undefined);
    const c = client(L);
    for (const raw of junk) {
      L.message(c.s, raw); // sync path must not throw
      await L.handle(c.s, raw); // async path must not reject
    }
  }
}
await malformedTests();

// items: one at a time, only when close, and dropped where the carrier says
{
  const L = new Lobby([]);
  const p = client(L);
  const q = client(L);
  p.tx({ t: 'join', name: 'p' });
  q.tx({ t: 'join', name: 'q' });
  p.tx({ t: 'pos', x: 4, z: 3, ry: 0 });
  q.tx({ t: 'pos', x: 4, z: 3, ry: 0 });
  p.tx({ t: 'take', id: 0 }); // ball at (4, 3)
  q.tx({ t: 'take', id: 0 }); // already held
  assert.equal(q.inbox.filter((m) => m.t === 'item').length, 1);
  p.tx({ t: 'take', id: 1 }); // hands full
  p.tx({ t: 'drop', id: 0, x: 5, y: 0, z: 3 });
  const dropped = q.inbox.filter((m) => m.t === 'item').pop();
  assert.ok(dropped && dropped.t === 'item' && dropped.item.holder === null && dropped.item.x === 5);
  q.tx({ t: 'pos', x: -40, z: 40, ry: 0 });
  q.tx({ t: 'take', id: 0 }); // too far
  assert.equal(q.inbox.filter((m) => m.t === 'item').length, 2);
}

console.log('lobby tests passed');
