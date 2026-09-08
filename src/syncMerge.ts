import type { Habit, State } from './types';

/** Pure full-sync merge. Extracted from sync.ts so the whole conflict
 *  resolution policy is unit-testable without a Supabase client. */

export interface HabitRow {
  id: string; kind: Habit['kind']; weight: number | null; name: string; emoji: string; color: string; notes: string | null;
  recurrence: Habit['recurrence']; target_time: string | null; reminder_enabled: boolean;
  reminder_time: string | null; archived: boolean; deleted: boolean;
  created_at: string; updated_at: string;
}

export interface CompletionRow { habit_id: string; day: string; done: boolean; updated_at: string }

export interface UploadCompletion { habit_id: string; user_id: string; day: string; done: boolean; updated_at: string }

export function habitToRow(h: Habit, userId: string, deleted = false) {
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

export function rowToHabit(r: HabitRow): Habit {
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

export interface FullMergeResult {
  /** Merged local state to replaceAll with. */
  state: State;
  /** Local winners to upsert into public.habits. */
  uploadHabits: ReturnType<typeof habitToRow>[];
  /** Local winners to upsert into public.completions. */
  uploadCompletions: UploadCompletion[];
  /** Habits whose completions must be deleted server-side (tombstoned). */
  dropCompletionIds: string[];
  /** New knownIds for the sync meta. */
  knownIds: string[];
}

/**
 * Full two-way merge: server rows + local state, last-write-wins, then upload local winners.
 *
 * Duplication guard: when this is the first-ever sync for the user and the local
 * state is an untouched demo seed (seedPristine) while the server already holds
 * habits, the local seed is NOT user data - it was generated fresh on this device.
 * The server wins entirely and nothing is uploaded, so signing in on a new
 * browser/device can never duplicate habits.
 */
export function fullMerge(
  serverHabitRows: HabitRow[],
  serverCompletionRows: CompletionRow[],
  state: State,
  knownIds: string[],
  userId: string,
  firstSync: boolean,
): FullMergeResult {
  const server = new Map<string, HabitRow>(serverHabitRows.map((r) => [r.id, r]));
  const known = new Set(knownIds);
  const discardPristineSeed =
    firstSync && state.seedPristine === true && serverHabitRows.some((r) => !r.deleted);
  const localById = discardPristineSeed
    ? new Map<string, Habit>()
    : new Map(state.habits.map((h) => [h.id, h]));
  const localCompletions = discardPristineSeed ? {} : state.completions;
  const localMeta = discardPristineSeed ? {} : state.completionMeta;

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
  for (const r of serverCompletionRows) serverComp.set(`${r.habit_id}|${r.day}`, r);
  const keys = new Set<string>(serverComp.keys());
  for (const [hid, days] of Object.entries(localCompletions)) for (const d of days) keys.add(`${hid}|${d}`);
  for (const [hid, days] of Object.entries(localMeta)) for (const d of Object.keys(days)) keys.add(`${hid}|${d}`);

  const completions: Record<string, string[]> = {};
  const completionMeta: Record<string, Record<string, string>> = {};
  const uploadCompletions: UploadCompletion[] = [];

  for (const key of keys) {
    const splitAt = key.indexOf('|');
    const hid = key.slice(0, splitAt);
    const day = key.slice(splitAt + 1);
    const sRow = serverComp.get(key);
    const localDone = (localCompletions[hid] ?? []).includes(day);
    const localTs = localMeta[hid]?.[day] ?? null;
    if (sRow) {
      if (localTs && localTs > sRow.updated_at && localDone !== sRow.done) {
        uploadCompletions.push({ habit_id: hid, user_id: userId, day, done: localDone, updated_at: localTs });
        if (localDone) (completions[hid] ??= []).push(day);
        (completionMeta[hid] ??= {})[day] = localTs;
      } else {
        if (sRow.done) (completions[hid] ??= []).push(day);
        (completionMeta[hid] ??= {})[day] = sRow.updated_at;
      }
    } else if (localDone || localTs) {
      const ts = localTs ?? new Date().toISOString();
      uploadCompletions.push({ habit_id: hid, user_id: userId, day, done: localDone, updated_at: ts });
      if (localDone) (completions[hid] ??= []).push(day);
      (completionMeta[hid] ??= {})[day] = ts;
    }
  }

  mergedHabits.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const mergedState: State = { ...state, habits: mergedHabits, completions, completionMeta, seedPristine: false };
  const ids = new Set([...server.keys(), ...mergedHabits.map((h) => h.id)]);
  return {
    state: mergedState,
    uploadHabits,
    uploadCompletions,
    dropCompletionIds,
    knownIds: [...ids],
  };
}
