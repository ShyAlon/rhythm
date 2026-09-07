import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const backendConfigured = Boolean(url && anon);
export const supabase: SupabaseClient | null = backendConfigured ? createClient(url as string, anon as string) : null;

// Web Push VAPID *public* key. Safe to ship in the client by design; the private
// key lives only in the edge function's secrets.
export const VAPID_PUBLIC_KEY = 'BI_H28tV_3Gb0mP24jiTzeO2sMvETiPAO0LmddUH6ErMdMyt53VXC76VVUKhLHvfc7WqsMAhWfF7UL0o84ilFj8';
