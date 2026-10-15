import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import {
  MAP_HALF,
  MAX_CHAT,
  MAX_NAME,
  MAX_PLAYERS,
  SPAWN,
  type ClientMsg,
  type PlayerState,
  type ServerMsg,
} from '../shared/protocol';

const PORT = Number(process.env.PORT ?? 3000);
const STATIC_DIR = resolve(import.meta.dirname, '../dist/client');
const TICK_MS = 66; // ~15 Hz position broadcast

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.ico': 'image/x-icon',
};

// Optional TURN relay for players behind strict NATs (set in your host's env vars).
const iceServers: NonNullable<Extract<ServerMsg, { t: 'welcome' }>['iceServers']> = [
  { urls: 'stun:stun.l.google.com:19302' },
];
if (process.env.TURN_URL) {
  iceServers.push({
    urls: process.env.TURN_URL.split(','),
    username: process.env.TURN_USERNAME,
    credential: process.env.TURN_CREDENTIAL,
  });
}

const http = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname === '/healthz') {
    res.writeHead(200).end('ok');
    return;
  }
  let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
  if (rel === '') rel = 'index.html';
  const file = join(STATIC_DIR, rel);
  if (!file.startsWith(STATIC_DIR)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found (did you run `npm run build`?)');
  }
});

interface Conn extends PlayerState {
  ws: WebSocket;
  joined: boolean;
  alive: boolean;
  chatTimes: number[];
}

const conns = new Map<string, Conn>();
const dirty = new Set<string>();

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg: ServerMsg, exceptId?: string) {
  const data = JSON.stringify(msg);
  for (const c of conns.values()) {
    if (c.joined && c.id !== exceptId && c.ws.readyState === WebSocket.OPEN) c.ws.send(data);
  }
}

const publicState = (c: Conn): PlayerState => ({ id: c.id, name: c.name, x: c.x, z: c.z, ry: c.ry });
const clampMap = (v: number) => Math.max(-MAP_HALF, Math.min(MAP_HALF, v));
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

wss.on('connection', (ws) => {
  const c: Conn = {
    ws,
    id: randomUUID().slice(0, 8),
    name: '',
    x: 0,
    z: 0,
    ry: 0,
    joined: false,
    alive: true,
    chatTimes: [],
  };

  ws.on('pong', () => (c.alive = true));

  ws.on('message', (raw) => {
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    switch (msg.t) {
      case 'join': {
        if (c.joined) return;
        if (conns.size >= MAX_PLAYERS) {
          send(ws, { t: 'full' });
          ws.close();
          return;
        }
        const name = String(msg.name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
        const base = name || `player-${c.id.slice(0, 3)}`;
        const taken = new Set([...conns.values()].map((o) => o.name.toLowerCase()));
        let unique = base;
        for (let i = 2; taken.has(unique.toLowerCase()); i++) unique = `${base.slice(0, MAX_NAME - 3)}_${i}`;
        c.name = unique;
        c.x = SPAWN.xMin + Math.random() * (SPAWN.xMax - SPAWN.xMin);
        c.z = SPAWN.zMin + Math.random() * (SPAWN.zMax - SPAWN.zMin);
        c.joined = true;
        const others = [...conns.values()].filter((o) => o.joined).map(publicState);
        conns.set(c.id, c);
        send(ws, { t: 'welcome', id: c.id, spawn: { x: c.x, z: c.z }, players: others, iceServers });
        broadcast({ t: 'joined', player: publicState(c) }, c.id);
        break;
      }
      case 'pos': {
        if (!c.joined || !finite(msg.x) || !finite(msg.z) || !finite(msg.ry)) return;
        c.x = clampMap(msg.x);
        c.z = clampMap(msg.z);
        c.ry = msg.ry;
        dirty.add(c.id);
        break;
      }
      case 'chat': {
        if (!c.joined || typeof msg.text !== 'string') return;
        const text = msg.text.trim().slice(0, MAX_CHAT);
        if (!text) return;
        const now = Date.now();
        c.chatTimes = c.chatTimes.filter((t) => now - t < 5000);
        if (c.chatTimes.length >= 5) return; // rate limit: 5 msgs / 5 s
        c.chatTimes.push(now);
        broadcast({ t: 'chat', id: c.id, name: c.name, text });
        break;
      }
      case 'signal': {
        if (!c.joined) return;
        const target = conns.get(msg.to);
        if (target?.joined) send(target.ws, { t: 'signal', from: c.id, data: msg.data });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!conns.delete(c.id)) return;
    dirty.delete(c.id);
    if (c.joined) broadcast({ t: 'left', id: c.id });
  });
  ws.on('error', () => ws.terminate());
});

// Broadcast changed positions to everyone except their owner.
setInterval(() => {
  if (dirty.size === 0) return;
  const p: [string, number, number, number][] = [];
  for (const id of dirty) {
    const c = conns.get(id);
    if (c) p.push([c.id, c.x, c.z, c.ry]);
  }
  dirty.clear();
  for (const c of conns.values()) {
    const mine = p.filter((e) => e[0] !== c.id);
    if (mine.length) send(c.ws, { t: 'state', p: mine });
  }
}, TICK_MS);

// Drop dead connections.
setInterval(() => {
  for (const c of conns.values()) {
    if (!c.alive) {
      c.ws.terminate();
      continue;
    }
    c.alive = false;
    c.ws.ping();
  }
}, 30_000);

http.listen(PORT, () => console.log(`proxchat listening on http://localhost:${PORT}`));
