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

console.log('lobby tests passed');
