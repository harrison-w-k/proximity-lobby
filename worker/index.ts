// Cloudflare Worker entry: static client + one Durable Object that runs the lobby.
import { DurableObject } from 'cloudflare:workers';
import { Lobby, type IceServers, type Peer, type Saved, type Session } from '../shared/lobby';
import { supabaseAuth } from '../shared/auth';

interface Env {
  LOBBY: DurableObjectNamespace<LobbyDO>;
  ASSETS: Fetcher;
  SUPABASE_URL?: string; // public; set in wrangler.jsonc
  SUPABASE_ANON_KEY?: string; // public (publishable) key only
  TURN_URL?: string;
  TURN_USERNAME?: string;
  TURN_CREDENTIAL?: string;
}

const TICK_MS = 66; // ~15 Hz position broadcast
const MAX_PAYLOAD = 16 * 1024;

function iceServersFrom(env: Env): IceServers {
  const servers: IceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (env.TURN_URL) {
    servers.push({ urls: env.TURN_URL.split(','), username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  }
  return servers;
}

const peerOf = (ws: WebSocket): Peer => ({
  send: (data) => {
    try {
      ws.send(data);
    } catch {
      // socket already closing
    }
  },
  close: () => {
    try {
      ws.close();
    } catch {
      // already closed
    }
  },
});

export class LobbyDO extends DurableObject<Env> {
  private lobby: Lobby;
  private sessions = new Map<WebSocket, Session>();
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    const verify =
      env.SUPABASE_URL && env.SUPABASE_ANON_KEY
        ? supabaseAuth({ url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY })
        : undefined;
    this.lobby = new Lobby(iceServersFrom(env), verify);
    // Profile photos are too big for a socket attachment (2 KiB), so they live in storage.
    this.lobby.onAvatar = (id, img) => {
      const op: Promise<unknown> = img ? ctx.storage.put(`av:${id}`, img) : ctx.storage.delete(`av:${id}`);
      op.catch((e) => console.error('avatar storage failed', e));
    };
    // Rebuild players (and their photos) after the object was evicted or hibernated.
    void ctx.blockConcurrencyWhile(async () => {
      const stored = await ctx.storage.list<string>({ prefix: 'av:' });
      const live = new Set<string>();
      for (const ws of ctx.getWebSockets()) {
        const saved = ws.deserializeAttachment() as Saved | null;
        if (!saved) continue;
        live.add(`av:${saved.id}`);
        this.sessions.set(ws, this.lobby.restore(peerOf(ws), saved, stored.get(`av:${saved.id}`)));
      }
      const stale = [...stored.keys()].filter((k) => !live.has(k)).slice(0, 128); // players who are gone
      if (stale.length) await ctx.storage.delete(stale);
    });
  }

  async fetch(req: Request): Promise<Response> {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const session = this.lobby.open(peerOf(server));
    this.sessions.set(server, session);
    server.serializeAttachment(this.lobby.save(session));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const session = this.sessions.get(ws);
    if (!session || typeof message !== 'string') return;
    if (message.length > MAX_PAYLOAD) {
      ws.close(1009, 'message too big');
      return;
    }
    await this.lobby.handle(session, message);
    try {
      ws.serializeAttachment(this.lobby.save(session));
    } catch {
      // closed during handling (e.g. lobby full)
    }
    this.ensureTick();
  }

  webSocketClose(ws: WebSocket) {
    this.drop(ws);
  }

  webSocketError(ws: WebSocket) {
    this.drop(ws);
  }

  private drop(ws: WebSocket) {
    const session = this.sessions.get(ws);
    if (!session) return;
    this.sessions.delete(ws);
    this.lobby.close(session);
    try {
      ws.close();
    } catch {
      // already closed
    }
  }

  // The timer only runs while positions are changing, so an idle lobby can hibernate.
  private ensureTick() {
    if (this.timer !== undefined) return;
    const timer = setInterval(() => {
      try {
        if (this.lobby.flush()) return;
      } catch (e) {
        console.error('flush failed', e);
      }
      clearInterval(timer);
      this.timer = undefined;
    }, TICK_MS);
    this.timer = timer;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(req.url);
    if (pathname === '/ws') return env.LOBBY.get(env.LOBBY.idFromName('main')).fetch(req);
    if (pathname === '/healthz') return new Response('ok');
    return env.ASSETS.fetch(req);
  },
};
