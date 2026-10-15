// Verifies a Supabase access token and returns the player's profile username.
// Uses plain fetch against Supabase's REST endpoints, so it runs in Node and in Workers.
export interface AuthConfig {
  url: string;
  anonKey: string; // public (publishable) key; never put a service_role key here
}

const TIMEOUT_MS = 5000;

/**
 * Returns a verifier: token -> username, null if the token is invalid or has no profile.
 * Throws if Supabase can't be reached, so callers can tell "bad login" from "try again".
 */
export function supabaseAuth(cfg: AuthConfig): (token: string) => Promise<string | null> {
  const base = cfg.url.replace(/\/+$/, '');
  return async (token) => {
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
}
