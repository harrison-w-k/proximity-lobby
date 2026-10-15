import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Not wired into the game yet. Planned uses: verified email login (magic link / OTP),
 * persistent usernames and profiles, and saved game data.
 * Returns null until VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (see .env.example).
 */
export function getSupabase(): SupabaseClient | null {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  return url && key ? createClient(url, key) : null;
}
