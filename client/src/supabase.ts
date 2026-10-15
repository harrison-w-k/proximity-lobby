import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null | undefined;

/**
 * Supabase client for verified email login (magic link) and profiles.
 * Returns null until VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set (see .env.example);
 * the game then falls back to the unverified email-to-username join.
 */
export function getSupabase(): SupabaseClient | null {
  if (client === undefined) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
    client = url && key ? createClient(url, key) : null;
  }
  return client;
}
