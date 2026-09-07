import type { SupabaseClient } from '@supabase/supabase-js';
import type { Habit, State } from './types';
import { onLocalChange } from './store';
import type { LocalChange } from './store';

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

function habitToRow(h: Habit, userId: string, deleted = false) {
  return {
    id: h.id,
    user_id: userId,
    kind: h.kind,
    weight: h.weight,
    name: h.name,
    emoji: h.emoji,
    color: h.color,
    notes: h.notes,
    recurrence: h.recurrence,
    target_time: h.targetTime,
    reminder_enabled: h.reminderEnabled,
    reminder_time: h.reminderTime,
    archived: h.archived,
    deleted,
    created_at: h.createdAt,
    updated_at: h.updatedAt,
  };
}

interface HabitRow {
  id: string; kind: Habit['kind']; weight: number | null; name: string; emoji: string; color: string; notes: string | null;
  recurrence: Habit['recurrence']; target_time: string | null; reminder_enabled: boolean;
  reminder_time: string | null; archived: boolean; deleted: boolean;
  created_at: string; updated_at: string;
}

interface CompletionRow { habit_id: string; day: string; done: boolean; updated_at: string }

function rowToHabit(r: HabitRow): Habit {
  return {
    id: r.id,
    kind: r.kind ?? 'habit',
    weight: r.weight ?? 1,
    name: r.name,
    emoji: r.emoji,
    color: r.color,
    notes: r.notes ?? '',
    recurrence: r.recurrence,
    targetTime: r.target_time,
    reminderEnabled: r.reminder_enabled,
    reminderTime: r.reminder_time,
    archived: r.archived,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
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
    const server = new Map<string, HabitRow>((hRows ?? []).map((r) => [r.id as string, r as HabitRow]));
    const state = getState();
    const localById = new Map(state.habits.map((h) => [h.id, h]));
    const known = new Set(meta.knownIds);
    const uploadHabits: ReturnType<typeof habitToRow>[] = [];
    const dropCompletionIds: string[] = [];
    const mergedHabits: Habit[] = [];

    for (const [id, row] of server) {
      const local = localById.get(id);
      if (row.deleted) {
        if (local && local.updatedAt > row.updated_at) {
          uploadHabits.push(habitToRow(local, userId, false)); // local edit out-races remote delete: resurrect
          mergedHabits.push(local);
        } else if (local) {
          dropCompletionIds.push(id);
        }
        continue;
      }
      const remote = rowToHabit(row);
      if (!local) {
        mergedHabits.push(remote);
      } else if (local.updatedAt > remote.updatedAt) {
        uploadHabits.push(habitToRow(local, userId));
        mergedHabits.push(local);
      } else {
        mergedHabits.push(remote);
      }
    }
    for (const [id, local] of localById) {
      if (server.has(id)) continue;
      if (known.has(id)) continue; // known before, now absent: hard-deleted elsewhere, drop it
      uploadHabits.push(habitToRow(local, userId)); // never synced (e.g. migrated v1 data)
      mergedHabits.push(local);
    }

    // Completions: union of keys, last-write-wins per (habit, day)
    const serverComp = new Map<string, CompletionRow>();
    for (const r of (cRows ?? []) as CompletionRow[]) serverComp.set(`${r.habit_id}|${r.day}`, r);
    const keys = new Set<string>(serverComp.keys());
    for (const [hid, days] of Object.entries(state.completions)) for (const d of days) keys.add(`${hid}|${d}`);
    for (const [hid, days] of Object.entries(state.completionMeta)) for (const d of Object.keys(days)) keys.add(`${hid}|${d}`);

    const completions: Record<string, string[]> = {};
    const completionMeta: Record<string, Record<string, string>> = {};
    const uploadComp: { habit_id: string; user_id: string; day: string; done: boolean; updated_at: string }[] = [];

    for (const key of keys) {
      const splitAt = key.indexOf('|');
      const hid = key.slice(0, splitAt);
      const day = key.slice(splitAt + 1);
      const sRow = serverComp.get(key);
      const localDone = (state.completions[hid] ?? []).includes(day);
      const localTs = state.completionMeta[hid]?.[day] ?? null;
      if (sRow) {
        if (localTs && localTs > sRow.updated_at && localDone !== sRow.done) {
          uploadComp.push({ habit_id: hid, user_id: userId, day, done: localDone, updated_at: localTs });
          if (localDone) (completions[hid] ??= []).push(day);
          (completionMeta[hid] ??= {})[day] = localTs;
        } else {
          if (sRow.done) (completions[hid] ??= []).push(day);
          (completionMeta[hid] ??= {})[day] = sRow.updated_at;
        }
      } else if (localDone || localTs) {
        const ts = localTs ?? new Date().toISOString();
        uploadComp.push({ habit_id: hid, user_id: userId, day, done: localDone, updated_at: ts });
        if (localDone) (completions[hid] ??= []).push(day);
        (completionMeta[hid] ??= {})[day] = ts;
      }
    }

    if (uploadHabits.length) {
      const { error } = await sb.from('habits').upsert(uploadHabits);
      if (error) { onStatus('error', error.message); return; }
    }
    for (const hid of dropCompletionIds) {
      await sb.from('completions').delete().eq('habit_id', hid);
    }
    if (uploadComp.length) {
      const { error } = await sb.from('completions').upsert(uploadComp);
      if (error) { onStatus('error', error.message); return; }
    }

    mergedHabits.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    replaceAll({ ...state, habits: mergedHabits, completions, completionMeta });
    const ids = new Set([...server.keys(), ...mergedHabits.map((h) => h.id)]);
    meta = { userId, lastPull: new Date().toISOString(), knownIds: [...ids] };
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
      if (r.updated_at > maxTs) maxTs = r.updated_at;
      const local = habits.get(r.id);
      if (r.deleted) {
        if (local && local.updatedAt <= r.updated_at) {
          habits.delete(r.id);
          delete completions[r.id];
          delete completionMeta[r.id];
          dirtyHabits.delete(r.id);
        }
        continue;
      }
      const remote = rowToHabit(r);
      if (!local || (local.updatedAt <= remote.updatedAt && !dirtyHabits.has(r.id))) {
        habits.set(r.id, remote);
      }
      if (!meta.knownIds.includes(r.id)) meta.knownIds.push(r.id);
    }

    for (const r of (cRows ?? []) as CompletionRow[]) {
      if (r.updated_at > maxTs) maxTs = r.updated_at;
      const key = `${r.habit_id}|${r.day}`;
      const localTs = completionMeta[r.habit_id]?.[r.day] ?? null;
      if (localTs && localTs > r.updated_at) continue; // local edit is newer; flush will push it
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
