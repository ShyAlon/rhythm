// Weight data access: Supabase when signed in (server is source of truth, and
// the Shortcut writes there too), localStorage as offline cache and as the
// whole store in local-only mode.
import type { SupabaseClient } from '@supabase/supabase-js';
import type { WeightEntry } from './weight';
import { isValidKg, isValidTakenAt, newIngestToken, sortByTakenAt } from './weight';

const cacheKey = (uid: string) => `rhythm.weights.${uid}`;

export function readCache(uid: string): WeightEntry[] {
  try {
    const raw = localStorage.getItem(cacheKey(uid));
    if (!raw) return [];
    const arr = JSON.parse(raw) as WeightEntry[];
    return Array.isArray(arr) ? sortByTakenAt(arr.filter((e) => e && isValidKg(e.kg) && typeof e.takenAt === 'string')) : [];
  } catch {
    return [];
  }
}

function writeCache(uid: string, entries: WeightEntry[]): void {
  try { localStorage.setItem(cacheKey(uid), JSON.stringify(entries)); } catch { /* storage full */ }
}

interface WeightRow { id: string; kg: number; taken_at: string; source: string }

const rowToEntry = (r: WeightRow): WeightEntry => ({ id: r.id, kg: Number(r.kg), takenAt: r.taken_at, source: r.source });

export async function loadWeights(sb: SupabaseClient | null, uid: string | null): Promise<WeightEntry[]> {
  if (sb && uid) {
    const { data, error } = await sb
      .from('weight_entries')
      .select('id,kg,taken_at,source')
      .order('taken_at', { ascending: true });
    if (!error && data) {
      const entries = (data as WeightRow[]).map(rowToEntry);
      writeCache(uid, entries);
      return entries;
    }
  }
  return readCache(uid ?? 'local');
}

export async function addWeight(
  sb: SupabaseClient | null,
  uid: string | null,
  kg: number,
  takenAt: string,
): Promise<{ entry?: WeightEntry; error?: string }> {
  if (!isValidKg(kg)) return { error: `Weight must be between ${20} and ${400} kg.` };
  if (!isValidTakenAt(takenAt)) return { error: 'That date does not look right.' };
  const iso = new Date(takenAt).toISOString();
  if (sb && uid) {
    const { data, error } = await sb
      .from('weight_entries')
      .insert({ user_id: uid, kg, taken_at: iso, source: 'manual' })
      .select('id,kg,taken_at,source')
      .single();
    if (error) {
      if (error.code === '23505') return { error: 'An entry already exists at that exact time.' };
      return { error: error.message };
    }
    const entry = rowToEntry(data as WeightRow);
    writeCache(uid, sortByTakenAt([...readCache(uid).filter((e) => e.id !== entry.id), entry]));
    return { entry };
  }
  const entry: WeightEntry = {
    id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kg, takenAt: iso, source: 'manual',
  };
  writeCache('local', sortByTakenAt([...readCache('local'), entry]));
  return { entry };
}

export async function deleteWeight(sb: SupabaseClient | null, uid: string | null, id: string): Promise<string | null> {
  if (sb && uid) {
    const { error } = await sb.from('weight_entries').delete().eq('id', id);
    if (error) return error.message;
    writeCache(uid, readCache(uid).filter((e) => e.id !== id));
    return null;
  }
  writeCache('local', readCache('local').filter((e) => e.id !== id));
  return null;
}

/** The user's Apple Health ingest token, or null when never generated. */
export async function loadIngestToken(sb: SupabaseClient): Promise<string | null> {
  const { data, error } = await sb.from('ingest_tokens').select('token').maybeSingle();
  if (error || !data) return null;
  return (data as { token: string }).token;
}

/** Generate (or regenerate) the ingest token. Regenerating invalidates the old one. */
export async function resetIngestToken(sb: SupabaseClient, uid: string): Promise<{ token?: string; error?: string }> {
  const token = newIngestToken();
  const { error } = await sb
    .from('ingest_tokens')
    .upsert({ user_id: uid, token, updated_at: new Date().toISOString() });
  if (error) return { error: error.message };
  return { token };
}
