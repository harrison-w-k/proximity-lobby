import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import type { ServerMsg } from '../shared/protocol';
import { Lobby } from '../shared/lobby';
import { supabaseAuth } from '../shared/auth';

const PORT = Number(process.env.PORT ?? 3000);
const STATIC_DIR = resolve(import.meta.dirname, '../dist/client');
const TICK_MS = 33; // ~30 Hz position broadcast

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

async function onRequest(req: IncomingMessage, res: ServerResponse) {
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
}

const http = createServer((req, res) => {
  // `new URL('//')` and `decodeURIComponent('%')` throw; scanners send exactly that kind of path.
  onRequest(req, res).catch(() => {
    if (!res.headersSent) res.writeHead(400);
    res.end();
  });
});

// With Supabase configured, joining requires a verified login. Without it (plain local dev),
// the server accepts the name the client sends. The VITE_ names let one client/.env.local do both.
const supabaseUrl = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
const verify = supabaseUrl && supabaseKey ? supabaseAuth({ url: supabaseUrl, anonKey: supabaseKey }) : undefined;
console.log(verify ? 'auth: Supabase login required to join' : 'auth: off (names are not verified)');

const lobby = new Lobby(iceServers, verify);
const alive = new WeakMap<WebSocket, boolean>();

const wss = new WebSocketServer({ server: http, path: '/ws', maxPayload: 16 * 1024 });

wss.on('connection', (ws) => {
  alive.set(ws, true);
  const session = lobby.open({
    send: (data) => ws.readyState === WebSocket.OPEN && ws.send(data),
    close: () => ws.close(),
  });

  ws.on('pong', () => alive.set(ws, true));
  ws.on('message', (raw) => void lobby.handle(session, raw.toString()));
  ws.on('close', () => lobby.close(session));
  ws.on('error', () => ws.terminate());
});

// Broadcast changed positions to everyone except their owner.
setInterval(() => lobby.flush(), TICK_MS);

// Drop dead connections.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 30_000);

http.listen(PORT, () => console.log(`proxchat listening on http://localhost:${PORT}`));

// Last line of defence: log and keep serving rather than dropping every player.
process.on('uncaughtException', (e) => console.error('uncaught exception', e));
process.on('unhandledRejection', (e) => console.error('unhandled rejection', e));
