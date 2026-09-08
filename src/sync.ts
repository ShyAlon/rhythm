import type { SupabaseClient } from '@supabase/supabase-js';
import type { State } from './types';
import { onLocalChange } from './store';
import type { LocalChange } from './store';
import { fullMerge, habitToRow, rowToHabit, ts } from './syncMerge';
import type { HabitRow, CompletionRow } from './syncMerge';

export type SyncStatus = 'off' | 'syncing' | 'synced' | 'error' | 'offline';

interface SyncMeta {
  userId: string;
  lastPull: string;      // high-water mark of server updated_at we have applied
  knownIds: string[];    // habit ids confirmed to exist on the server (incl. tombstones)
}

const META_KEY = 'rhythm.sync';
const EPOCH = '1970-01-01T00:00:00.000Z';

function loadMeta(userId: string): SyncMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const m = JSON.parse(raw) as SyncMeta;
      if (m.userId === userId && Array.isArray(m.knownIds)) return m;
    }
  } catch { /* fall through */ }
  return { userId, lastPull: EPOCH, knownIds: [] };
}

function saveMeta(m: SyncMeta): void {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* storage full */ }
}

export interface SyncHandle {
  stop: () => void;
  syncNow: () => void;
}

export function startSync(
  sb: SupabaseClient,
  userId: string,
  getState: () => State,
  replaceAll: (s: State) => void,
  onStatus: (s: SyncStatus, detail?: string) => void,
): SyncHandle {
  let meta = loadMeta(userId);
  let stopped = false;
  let running = false;
  let rerunRequested = false;
  const dirtyHabits = new Map<string, boolean>(); // id -> tombstone?
  const dirtyCompletions = new Set<string>();     // `${habitId}|${day}`
  let bulkPending = false;
  let flushTimer: number | undefined;
  let pullDebounce: number | undefined;

  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  async function guarded(fn: () => Promise<void>): Promise<void> {
    if (stopped) return;
    if (running) { rerunRequested = true; return; }
    running = true;
    try {
      await fn();
    } catch {
      onStatus('error', 'Sync failed - will retry');
    } finally {
      running = false;
      if (rerunRequested && !stopped) {
        rerunRequested = false;
        void guarded(fn);
      }
    }
  }

  async function ensureProfile(): Promise<void> {
    await sb.from('profiles').upsert({ user_id: userId, tz, updated_at: new Date().toISOString() });
  }

  /** Full two-way merge: server rows + local state, last-write-wins, then upload local winners. */
  async function fullSync(): Promise<void> {
    onStatus('syncing');
    const [{ data: hRows, error: hErr }, { data: cRows, error: cErr }] = await Promise.all([
      sb.from('habits').select('*'),
      sb.from('completions').select('*'),
    ]);
    if (hErr || cErr) {
      onStatus('error', (hErr ?? cErr)?.message);
      return;
    }
    const result = fullMerge(
      (hRows ?? []) as HabitRow[],
      (cRows ?? []) as CompletionRow[],
      getState(),
      meta.knownIds,
      userId,
      meta.lastPull === EPOCH,
    );

    if (result.uploadHabits.length) {
      const { error } = await sb.from('habits').upsert(result.uploadHabits);
      if (error) { onStatus('error', error.message); return; }
    }
    for (const hid of result.dropCompletionIds) {
      await sb.from('completions').delete().eq('habit_id', hid);
    }
    if (result.uploadCompletions.length) {
      const { error } = await sb.from('completions').upsert(result.uploadCompletions);
      if (error) { onStatus('error', error.message); return; }
    }

    replaceAll(result.state);
    meta = { userId, lastPull: new Date().toISOString(), knownIds: result.knownIds };
    saveMeta(meta);
    dirtyHabits.clear();
    dirtyCompletions.clear();
    onStatus('synced');
  }

  /** Incremental pull of rows changed since the last high-water mark. */
  async function pullIncremental(): Promise<void> {
    const since = meta.lastPull;
    const [{ data: hRows, error: hErr }, { data: cRows, error: cErr }] = await Promise.all([
      sb.from('habits').select('*').gt('updated_at', since),
      sb.from('completions').select('*').gt('updated_at', since),
    ]);
    if (hErr || cErr) { onStatus('error', (hErr ?? cErr)?.message); return; }
    if (!hRows?.length && !cRows?.length) { onStatus('synced'); return; }

    const state = getState();
    const habits = new Map(state.habits.map((h) => [h.id, h]));
    const completions = { ...state.completions };
    const completionMeta = { ...state.completionMeta };
    let maxTs = since;

    for (const r of (hRows ?? []) as HabitRow[]) {
      if (ts(r.updated_at) > ts(maxTs)) maxTs = r.updated_at;
      const local = habits.get(r.id);
      if (r.deleted) {
        if (local && ts(local.updatedAt) <= ts(r.updated_at)) {
          habits.delete(r.id);
          delete completions[r.id];
          delete completionMeta[r.id];
          dirtyHabits.delete(r.id);
        }
        continue;
      }
      const remote = rowToHabit(r);
      if (!local || (ts(local.updatedAt) <= ts(remote.updatedAt) && !dirtyHabits.has(r.id))) {
        habits.set(r.id, remote);
      }
      if (!meta.knownIds.includes(r.id)) meta.knownIds.push(r.id);
    }

    for (const r of (cRows ?? []) as CompletionRow[]) {
      if (ts(r.updated_at) > ts(maxTs)) maxTs = r.updated_at;
      const key = `${r.habit_id}|${r.day}`;
      const localTs = completionMeta[r.habit_id]?.[r.day] ?? null;
      if (localTs && ts(localTs) > ts(r.updated_at)) continue; // local edit is newer; flush will push it
      const list = new Set(completions[r.habit_id] ?? []);
      if (r.done) list.add(r.day);
      else list.delete(r.day);
      completions[r.habit_id] = [...list];
      (completionMeta[r.habit_id] ??= {})[r.day] = r.updated_at;
      dirtyCompletions.delete(key);
    }

    const merged = [...habits.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    replaceAll({ ...state, habits: merged, completions, completionMeta });
    meta.lastPull = maxTs;
    saveMeta(meta);
    onStatus('synced');
  }

  /** Push locally changed rows. */
  async function flushDirty(): Promise<void> {
    if (!dirtyHabits.size && !dirtyCompletions.size) return;
    if (!navigator.onLine) { onStatus('offline'); return; }
    const state = getState();
    const now = new Date().toISOString();
    const habitRows: ReturnType<typeof habitToRow>[] = [];
    for (const [id, deleted] of dirtyHabits) {
      const h = state.habits.find((x) => x.id === id);
      if (deleted) {
        habitRows.push(
          h
            ? habitToRow(h, userId, true)
            : {
                id, user_id: userId, kind: 'habit' as const, weight: 1, name: '', emoji: '✅', color: '#6c8cff', notes: '',
                recurrence: { kind: 'daily' }, target_time: null, reminder_enabled: false,
                reminder_time: null, archived: false, deleted: true, created_at: now, updated_at: now,
              },
        );
      } else if (h) {
        habitRows.push(habitToRow(h, userId));
      }
    }
    const compRows: { habit_id: string; user_id: string; day: string; done: boolean; updated_at: string }[] = [];
    for (const key of dirtyCompletions) {
      const splitAt = key.indexOf('|');
      const hid = key.slice(0, splitAt);
      const day = key.slice(splitAt + 1);
      if (dirtyHabits.get(hid)) continue; // habit deleted: completions removed server-side anyway
      compRows.push({
        habit_id: hid,
        user_id: userId,
        day,
        done: (state.completions[hid] ?? []).includes(day),
        updated_at: state.completionMeta[hid]?.[day] ?? now,
      });
    }

    onStatus('syncing');
    if (habitRows.length) {
      const { error } = await sb.from('habits').upsert(habitRows);
      if (error) { onStatus('error', error.message); return; }
    }
    for (const [id, deleted] of dirtyHabits) {
      if (deleted) await sb.from('completions').delete().eq('habit_id', id);
    }
    if (compRows.length) {
      const { error } = await sb.from('completions').upsert(compRows);
      if (error) { onStatus('error', error.message); return; }
    }
    for (const [id, deleted] of dirtyHabits) {
      if (deleted) meta.knownIds = meta.knownIds.filter((x) => x !== id);
      else if (!meta.knownIds.includes(id)) meta.knownIds.push(id);
    }
    dirtyHabits.clear();
    dirtyCompletions.clear();
    saveMeta(meta);
    onStatus('synced');
  }

  function scheduleFlush(): void {
    window.clearTimeout(flushTimer);
    flushTimer = window.setTimeout(() => {
      if (bulkPending) {
        bulkPending = false;
        void guarded(fullSync);
      } else {
        void guarded(flushDirty);
      }
    }, 1200);
  }

  function schedulePull(): void {
    window.clearTimeout(pullDebounce);
    pullDebounce = window.setTimeout(() => void guarded(pullIncremental), 600);
  }

  const unsubLocal = onLocalChange((c: LocalChange) => {
    if (c.kind === 'habit') dirtyHabits.set(c.id, false);
    else if (c.kind === 'habit-deleted') dirtyHabits.set(c.id, true);
    else if (c.kind === 'completion') dirtyCompletions.add(`${c.id}|${c.day}`);
    else bulkPending = true;
    scheduleFlush();
  });

  const pullTimer = window.setInterval(() => void guarded(pullIncremental), 60000);
  const onVis = () => { if (document.visibilityState === 'visible') schedulePull(); };
  const onOnline = () => void guarded(async () => { await flushDirty(); await pullIncremental(); });
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('online', onOnline);

  const channel = sb
    .channel(`rhythm-${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'habits', filter: `user_id=eq.${userId}` }, schedulePull)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'completions', filter: `user_id=eq.${userId}` }, schedulePull)
    .subscribe();

  void guarded(async () => {
    await ensureProfile();
    await fullSync();
  });

  return {
    stop: () => {
      stopped = true;
      unsubLocal();
      window.clearInterval(pullTimer);
      window.clearTimeout(flushTimer);
      window.clearTimeout(pullDebounce);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('online', onOnline);
      void sb.removeChannel(channel);
    },
    syncNow: () => void guarded(async () => { await flushDirty(); await pullIncremental(); }),
  };
}
