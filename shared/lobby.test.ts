import assert from 'node:assert/strict';
import { Lobby, type Peer, type Session } from './lobby';
import { MAX_PLAYERS, type ServerMsg } from './protocol';

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

// the animal you choose is announced to the others
b.tx({ t: 'animal', a: 'fox' });
assert.ok(a.inbox.some((m) => m.t === 'animal' && m.a === 'fox'));
b.tx({ t: 'animal', a: 'not_an_animal' });
assert.equal(b.s.animal, 'fox');

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

console.log('lobby tests passed');
