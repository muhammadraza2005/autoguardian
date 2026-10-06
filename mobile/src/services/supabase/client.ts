import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { runtime } from '@/config/runtime';
import { sessionStorage } from '@/services/storage/sessionStorage';

let client: SupabaseClient | null = null;

// No client is created on startup; design preview needs no account or credentials.
export function getSupabaseClient() {
  if (runtime.isDemo) throw new Error('Supabase is disabled in design preview.');
  if (!runtime.supabaseUrl || !runtime.supabasePublishableKey) {
    throw new Error('Supabase public configuration is missing.');
  }
  if (new URL(runtime.supabaseUrl).protocol !== 'https:') throw new Error('Supabase must use HTTPS.');
  client ??= createClient(runtime.supabaseUrl, runtime.supabasePublishableKey, {
    auth: { storage: sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });
  return client;
}
// Phone OTP integration remains pending. SessionProvider manages AppState refresh
// and loads profiles/roles through the backend.
// Domain operations go through the backend API; never expose private tables or service keys.
