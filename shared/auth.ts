// Verifies a Supabase access token and returns the player's profile username.
// Uses plain fetch against Supabase's REST endpoints, so it runs in Node and in Workers.
export interface AuthConfig {
  url: string;
  anonKey: string; // public (publishable) key; never put a service_role key here
}

// Supabase's auth service can take several seconds on a busy day, so wait a good while and try twice.
const TIMEOUT_MS = 15000;
const CACHE_MS = 5 * 60 * 1000;

/**
 * Returns a verifier: token -> username, null if the token is invalid or has no profile.
 * Throws if Supabase can't be reached, so callers can tell "bad login" from "try again".
 */
export function supabaseAuth(cfg: AuthConfig): (token: string) => Promise<string | null> {
  const base = cfg.url.replace(/\/+$/, '');
  const cache = new Map<string, { name: string; until: number }>();

  const lookup = async (token: string): Promise<string | null> => {
    const headers = { apikey: cfg.anonKey, Authorization: `Bearer ${token}` };

    const userRes = await fetch(`${base}/auth/v1/user`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (userRes.status === 401 || userRes.status === 403) return null;
    if (!userRes.ok) throw new Error(`auth service returned ${userRes.status}`);
    const user = (await userRes.json()) as { id?: string };
    if (!user.id) return null;

    const profRes = await fetch(
      `${base}/rest/v1/profiles?select=username&id=eq.${encodeURIComponent(user.id)}`,
      { headers, signal: AbortSignal.timeout(TIMEOUT_MS) },
    );
    if (!profRes.ok) throw new Error(`profile lookup returned ${profRes.status}`);
    const rows = (await profRes.json()) as { username?: string }[];
    return rows[0]?.username ?? null;
  };

  return async (token) => {
    const now = Date.now();
    const hit = cache.get(token);
    if (hit && hit.until > now) return hit.name; // reconnects do not need another slow round trip
    let name: string | null;
    try {
      name = await lookup(token);
    } catch {
      name = await lookup(token); // one more try: a slow or dropped request is common
    }
    if (name) {
      if (cache.size > 200) for (const [k, v] of cache) if (v.until <= now) cache.delete(k);
      cache.set(token, { name, until: now + CACHE_MS });
    }
    return name;
  };
}
