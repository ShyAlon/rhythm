import { describe, it, expect } from 'vitest';
import { normalize, seed, reducer, newId } from './store';
import type { Habit } from './types';

describe('v1 -> v2 migration', () => {
  it('keeps habit ids stable and defaults kind/weight', () => {
    const v1 = {
      version: 1,
      habits: [
        { id: 'keepme', name: 'Meditate', emoji: '🧘', color: '#9d6cff', notes: '', recurrence: { kind: 'daily' }, targetTime: null, reminderEnabled: true, reminderTime: '08:00', createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', archived: false },
      ],
      completions: { keepme: ['2026-09-01'] },
    };
    const s = normalize(v1);
    expect(s).not.toBeNull();
    expect(s!.habits[0].id).toBe('keepme');
    expect(s!.habits[0].kind).toBe('habit');
    expect(s!.habits[0].weight).toBe(1);
    expect(s!.completions['keepme']).toEqual(['2026-09-01']);
    // migrated data is real user data: never treated as a pristine seed
    expect(s!.seedPristine).toBeFalsy();
  });

  it('v2 rows from before scoring get kind/weight defaults', () => {
    const old = {
      version: 2,
      onboarded: true,
      habits: [
        { id: 'x', name: 'Duolingo', emoji: '🦉', color: '#3ddc97', notes: '', recurrence: { kind: 'daily' }, targetTime: null, reminderEnabled: false, reminderTime: null, createdAt: '2026-09-01T10:00:00.000Z', updatedAt: '2026-09-01T10:00:00.000Z', archived: false },
      ],
    };
    const s = normalize(old);
    expect(s!.habits[0].kind).toBe('habit');
    expect(s!.habits[0].weight).toBe(1);
  });

  it('rejects garbage', () => {
    expect(normalize(null)).toBeNull();
    expect(normalize({ version: 99 })).toBeNull();
    expect(normalize('nope')).toBeNull();
  });
});

describe('seed pristine flag', () => {
  it('seed starts pristine with unique ids', () => {
    const s = seed();
    expect(s.seedPristine).toBe(true);
    const ids = s.habits.map((h: Habit) => h.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('any user-originated change clears the pristine flag', () => {
    const s = seed();
    const afterToggle = reducer(s, { type: 'toggle', id: s.habits[0].id, day: '2026-09-08' });
    expect(afterToggle.seedPristine).toBe(false);
    const afterAdd = reducer(s, { type: 'add', habit: { ...s.habits[0], id: newId() } });
    expect(afterAdd.seedPristine).toBe(false);
    const afterRemove = reducer(s, { type: 'remove', id: s.habits[0].id });
    expect(afterRemove.seedPristine).toBe(false);
  });
});
