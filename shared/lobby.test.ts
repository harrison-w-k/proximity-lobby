import assert from 'node:assert/strict';
import { Lobby, type Peer, type Session } from './lobby';
import { MAP_HALF, MAX_PLAYERS, type ServerMsg } from './protocol';

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

// positions are clamped to the map and only sent to others
b.tx({ t: 'pos', x: 9999, z: -9999, ry: 1 });
assert.equal(lobby.flush(), true);
assert.equal(lobby.flush(), false);
const st = a.inbox.find((m) => m.t === 'state');
assert.deepEqual(st && st.t === 'state' ? st.p : null, [[b.s.id, MAP_HALF, -MAP_HALF, 1]]);
assert.ok(!b.inbox.some((m) => m.t === 'state'));

// chat rate limit: 5 per 5 s
for (let i = 0; i < 8; i++) a.tx({ t: 'chat', text: `hi ${i}` });
assert.equal(b.inbox.filter((m) => m.t === 'chat').length, 5);

// signaling reaches only the target
a.tx({ t: 'signal', to: b.s.id, data: { x: 1 } });
assert.ok(b.inbox.some((m) => m.t === 'signal'));

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

console.log('lobby tests passed');
