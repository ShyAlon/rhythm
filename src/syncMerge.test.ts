import { describe, it, expect } from 'vitest';
import { fullMerge, habitToRow } from './syncMerge';
import type { HabitRow, CompletionRow } from './syncMerge';
import { seed } from './store';
import type { Habit, State } from './types';

const UID = 'user-1';
const T0 = '2026-09-07T15:18:44.000Z'; // originals
const T1 = '2026-09-08T04:45:05.000Z'; // fresh re-seed (newer)

function mkHabit(id: string, name: string, createdAt: string, updatedAt = createdAt): Habit {
  return {
    id, kind: 'habit', weight: 1, name, emoji: '✅', color: '#6c8cff', notes: '',
    recurrence: { kind: 'daily' }, targetTime: null, reminderEnabled: false, reminderTime: null,
    archived: false, createdAt, updatedAt,
  };
}

function mkRow(h: Habit, deleted = false): HabitRow {
  return { ...habitToRow(h, UID, deleted) };
}

function baseState(habits: Habit[], seedPristine = false): State {
  return { version: 2, habits, completions: {}, completionMeta: {}, onboarded: true, seedPristine };
}

describe('duplication guard (the v4 bug)', () => {
  it('first sign-in on a fresh device with an untouched seed does NOT duplicate server habits', () => {
    // Server: his real 4 habits with completion history (from the original session)
    const serverHabits = [
      mkRow(mkHabit('srv1', 'Meditate', T0)),
      mkRow(mkHabit('srv2', 'Duolingo', T0)),
      mkRow(mkHabit('srv3', 'Stop eating', T0)),
      mkRow(mkHabit('srv4', 'Workout', T0)),
    ];
    const serverComps: CompletionRow[] = [
      { habit_id: 'srv1', day: '2026-09-07', done: true, updated_at: T0 },
    ];
    // Local: fresh browser re-seeded the same 4 habits with NEW ids
    const local = seed();
    expect(local.seedPristine).toBe(true);
    expect(local.habits).toHaveLength(4);

    const r = fullMerge(serverHabits, serverComps, local, [], UID, true);

    expect(r.uploadHabits).toHaveLength(0); // nothing uploaded
    expect(r.uploadCompletions).toHaveLength(0);
    expect(r.state.habits).toHaveLength(4); // exactly the server set
    expect(r.state.habits.map((h) => h.id).sort()).toEqual(['srv1', 'srv2', 'srv3', 'srv4']);
    expect(r.state.completions['srv1']).toEqual(['2026-09-07']); // history preserved
    expect(r.state.seedPristine).toBe(false);
  });

  it('a pristine seed still uploads for a genuinely new account (empty server)', () => {
    const local = seed();
    const r = fullMerge([], [], local, [], UID, true);
    expect(r.uploadHabits).toHaveLength(4);
    expect(r.state.habits).toHaveLength(4);
    expect(r.state.seedPristine).toBe(false);
  });

  it('touched seed (user edited before sign-in) is preserved and uploaded', () => {
    const local = seed();
    // simulate a user edit: flag cleared by reducer
    local.seedPristine = false;
    const serverHabits = [mkRow(mkHabit('srv1', 'Meditate', T0))];
    const r = fullMerge(serverHabits, [], local, [], UID, true);
    expect(r.uploadHabits).toHaveLength(4); // all local habits are new ids -> uploaded
    expect(r.state.habits).toHaveLength(5); // 4 local + 1 server
  });
});

describe('sync idempotency', () => {
  it('uploading the merge result and merging again is a perfect no-op', () => {
    const local = baseState([mkHabit('a', 'Meditate', T0), mkHabit('b', 'Workout', T0)]);
    const r1 = fullMerge([], [], local, [], UID, true);
    expect(r1.uploadHabits).toHaveLength(2);

    // Server now holds exactly what we uploaded
    const serverNow = r1.uploadHabits.map((u) => ({ ...u }) as HabitRow);
    const r2 = fullMerge(serverNow, [], r1.state, r1.knownIds, UID, false);
    expect(r2.uploadHabits).toHaveLength(0);
    expect(r2.uploadCompletions).toHaveLength(0);
    expect(r2.dropCompletionIds).toHaveLength(0);
    expect(r2.state.habits).toHaveLength(2);
  });

  it('re-login on the same device re-uploads nothing and adds nothing', () => {
    const habits = [mkHabit('a', 'Meditate', T0), mkHabit('b', 'Workout', T0)];
    const server = habits.map((h) => mkRow(h));
    const local = baseState(habits);
    const r = fullMerge(server, [], local, habits.map((h) => h.id), UID, false);
    expect(r.uploadHabits).toHaveLength(0);
    expect(r.state.habits).toHaveLength(2);
  });
});

describe('conflict resolution', () => {
  it('local edit newer than server wins and uploads', () => {
    const old = mkHabit('a', 'Meditate', T0);
    const edited = { ...old, name: 'Meditate 10min', updatedAt: T1 };
    const r = fullMerge([mkRow(old)], [], baseState([edited]), ['a'], UID, false);
    expect(r.uploadHabits).toHaveLength(1);
    expect(r.uploadHabits[0].name).toBe('Meditate 10min');
    expect(r.state.habits[0].name).toBe('Meditate 10min');
  });

  it('server version newer than local wins locally and does not upload', () => {
    const old = mkHabit('a', 'Meditate', T0);
    const serverNew = mkRow({ ...old, name: 'Meditate 20min', updatedAt: T1 });
    const r = fullMerge([serverNew], [], baseState([old]), ['a'], UID, false);
    expect(r.uploadHabits).toHaveLength(0);
    expect(r.state.habits[0].name).toBe('Meditate 20min');
  });

  it('remote tombstone removes the habit locally and drops its completions', () => {
    const h = mkHabit('a', 'Meditate', T0);
    const tomb = mkRow({ ...h, updatedAt: T1 }, true);
    const state = baseState([h]);
    state.completions = { a: ['2026-09-07'] };
    state.completionMeta = { a: { '2026-09-07': T0 } };
    const r = fullMerge([tomb], [{ habit_id: 'a', day: '2026-09-07', done: true, updated_at: T0 }], state, ['a'], UID, false);
    expect(r.state.habits).toHaveLength(0);
    expect(r.dropCompletionIds).toEqual(['a']);
    expect(r.uploadHabits).toHaveLength(0);
  });

  it('local edit newer than a remote tombstone resurrects the habit', () => {
    const h = mkHabit('a', 'Meditate', T0);
    const edited = { ...h, updatedAt: T1 };
    const tomb = mkRow({ ...h, updatedAt: '2026-09-07T20:00:00.000Z' }, true);
    const r = fullMerge([tomb], [], baseState([edited]), ['a'], UID, false);
    expect(r.uploadHabits).toHaveLength(1);
    expect(r.uploadHabits[0].deleted).toBe(false);
    expect(r.state.habits).toHaveLength(1);
  });

  it('known id absent from server (hard-deleted elsewhere) is dropped, not re-uploaded', () => {
    const h = mkHabit('a', 'Meditate', T0);
    const r = fullMerge([], [], baseState([h]), ['a'], UID, false);
    expect(r.uploadHabits).toHaveLength(0);
    expect(r.state.habits).toHaveLength(0);
  });
});

describe('completions merge', () => {
  it('unions server and local completions and uploads local-only ones', () => {
    const h = mkHabit('a', 'Meditate', T0);
    const state = baseState([h]);
    state.completions = { a: ['2026-09-08'] };
    state.completionMeta = { a: { '2026-09-08': T1 } };
    const r = fullMerge(
      [mkRow(h)],
      [{ habit_id: 'a', day: '2026-09-07', done: true, updated_at: T0 }],
      state, ['a'], UID, false,
    );
    expect(r.state.completions['a'].sort()).toEqual(['2026-09-07', '2026-09-08']);
    expect(r.uploadCompletions).toHaveLength(1);
    expect(r.uploadCompletions[0]).toMatchObject({ habit_id: 'a', day: '2026-09-08', done: true });
  });

  it('newer local un-check wins over older server check', () => {
    const h = mkHabit('a', 'Meditate', T0);
    const state = baseState([h]);
    state.completions = { a: [] };
    state.completionMeta = { a: { '2026-09-07': T1 } }; // unchecked at T1
    const r = fullMerge(
      [mkRow(h)],
      [{ habit_id: 'a', day: '2026-09-07', done: true, updated_at: T0 }],
      state, ['a'], UID, false,
    );
    expect(r.state.completions['a'] ?? []).toEqual([]);
    expect(r.uploadCompletions).toHaveLength(1);
    expect(r.uploadCompletions[0].done).toBe(false);
  });
});

/** PostgREST returns timestamptz with an offset and microseconds, not 'Z'. */
function pgRow(h: Habit, deleted = false, updatedAt?: string): HabitRow {
  const r = mkRow(h, deleted);
  r.created_at = r.created_at.replace('Z', '000+00:00');
  r.updated_at = (updatedAt ?? h.updatedAt).replace('Z', '000+00:00');
  return r;
}

describe('mixed timestamp formats (resurrection regression)', () => {
  it('a tombstone newer by less than 1ms still wins over a local copy (no resurrection)', () => {
    // Local copy: seeded dupe at 04:45:05.302Z. Server tombstone written by SQL now()
    // at 04:45:05.302999+00:00 - under 1ms later. String compare says 'Z' > '9' and
    // would wrongly resurrect; numeric compare drops the local copy.
    const dupe = mkHabit('dupe1', 'Meditate', '2026-09-08T04:45:05.302Z');
    const tomb = pgRow(dupe, true, '2026-09-08T04:45:05.302Z');
    tomb.updated_at = '2026-09-08T04:45:05.302999+00:00';
    const r = fullMerge([tomb], [], baseState([dupe]), ['dupe1'], UID, false);
    expect(r.uploadHabits).toHaveLength(0);
    expect(r.state.habits).toHaveLength(0);
    expect(r.dropCompletionIds).toEqual(['dupe1']);
  });

  it('a genuinely newer local edit (1ms) still resurrects a tombstone', () => {
    const dupe = mkHabit('dupe1', 'Meditate', '2026-09-08T04:45:05.302Z');
    const edited = { ...dupe, updatedAt: '2026-09-08T04:45:05.303Z' };
    const tomb = pgRow(dupe, true);
    const r = fullMerge([tomb], [], baseState([edited]), ['dupe1'], UID, false);
    expect(r.uploadHabits).toHaveLength(1);
    expect(r.uploadHabits[0].deleted).toBe(false);
    expect(r.state.habits).toHaveLength(1);
  });

  it('exact production scenario: client holding originals + dupes drops server-tombstoned dupes and never re-uploads them', () => {
    // Server: 4 originals alive (Sep 7) + 4 dupes tombstoned with a bumped updated_at
    // in PostgREST format (what the SQL tombstone fix writes).
    const originals = ['o1', 'o2', 'o3', 'o4'].map((id, i) =>
      mkHabit(id, ['Meditate', 'Duolingo', 'Stop eating', 'Workout'][i], T0));
    const dupes = ['d1', 'd2', 'd3', 'd4'].map((id, i) =>
      mkHabit(id, ['Meditate', 'Duolingo', 'Stop eating', 'Workout'][i], '2026-09-08T04:21:32.206Z'));
    const T2 = '2026-09-08T05:38:16.123456+00:00'; // tombstone write time (PostgREST format)
    const serverRows = [
      ...originals.map((h) => pgRow(h)),
      ...dupes.map((h) => { const r = pgRow(h, true); r.updated_at = T2; return r; }),
    ];
    // Client: holds all 8 locally (pulled before the tombstone), 'Z' timestamps.
    const state = baseState([...originals, ...dupes]);
    state.completions = { o1: ['2026-09-07'] };
    state.completionMeta = { o1: { '2026-09-07': T0 } };
    const knownIds = [...originals, ...dupes].map((h) => h.id);

    const r1 = fullMerge(serverRows, [{ habit_id: 'o1', day: '2026-09-07', done: true, updated_at: T0 }], state, knownIds, UID, false);
    expect(r1.state.habits.map((h) => h.id).sort()).toEqual(['o1', 'o2', 'o3', 'o4']);
    expect(r1.uploadHabits).toHaveLength(0); // no resurrection of d1-d4
    expect(r1.dropCompletionIds.sort()).toEqual(['d1', 'd2', 'd3', 'd4']);
    expect(r1.state.completions['o1']).toEqual(['2026-09-07']); // history intact

    // Merging again (next app start) is a perfect no-op.
    const r2 = fullMerge(serverRows, [{ habit_id: 'o1', day: '2026-09-07', done: true, updated_at: T0 }], r1.state, r1.knownIds, UID, false);
    expect(r2.uploadHabits).toHaveLength(0);
    expect(r2.uploadCompletions).toHaveLength(0);
    expect(r2.state.habits).toHaveLength(4);
  });

  it('completion conflicts compare numerically across formats too', () => {
    const h = mkHabit('a', 'Meditate', T0);
    const state = baseState([h]);
    state.completions = { a: ['2026-09-08'] };
    state.completionMeta = { a: { '2026-09-08': '2026-09-08T05:00:00.500Z' } };
    // Server row for the same day, 250ms newer, in PostgREST format.
    const sRow: CompletionRow = { habit_id: 'a', day: '2026-09-08', done: false, updated_at: '2026-09-08T05:00:00.750000+00:00' };
    const r = fullMerge([pgRow(h)], [sRow], state, ['a'], UID, false);
    expect(r.uploadCompletions).toHaveLength(0); // server un-check wins
    expect(r.state.completions['a'] ?? []).toEqual([]);
  });
});
