import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { Habit, State } from './types';

const KEY = 'rhythm.v2';
const OLD_KEY = 'rhythm.v1';

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

function seed(): State {
  const now = new Date().toISOString();
  const mk = (p: Partial<Habit> & Pick<Habit, 'name' | 'emoji' | 'color'>): Habit => ({
    id: newId(),
    notes: '',
    recurrence: { kind: 'daily' },
    targetTime: null,
    reminderEnabled: false,
    reminderTime: null,
    createdAt: now,
    updatedAt: now,
    archived: false,
    ...p,
  });
  return {
    version: 2,
    onboarded: true,
    completions: {},
    completionMeta: {},
    habits: [
      mk({ name: 'Meditate', emoji: '🧘', color: '#9d6cff', reminderEnabled: true, reminderTime: '08:00' }),
      mk({ name: 'Duolingo', emoji: '🦉', color: '#3ddc97', reminderEnabled: true, reminderTime: '18:00' }),
      mk({ name: 'Stop eating', emoji: '🍽️', color: '#ffb020', targetTime: '20:00', reminderEnabled: true, reminderTime: '19:45', notes: 'Kitchen closes at 20:00' }),
      mk({ name: 'Workout', emoji: '🏋️', color: '#6c8cff', recurrence: { kind: 'weekly', days: [1, 3, 5] }, reminderEnabled: true, reminderTime: '07:30' }),
    ],
  };
}

/** Accepts v1 and v2 serialized states, upgrades to v2. */
export function normalize(raw: unknown): State | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (r.version === 2 && Array.isArray(r.habits)) {
    const s = r as unknown as State;
    return { ...s, completions: s.completions ?? {}, completionMeta: s.completionMeta ?? {} };
  }
  if (r.version === 1 && Array.isArray(r.habits)) {
    const old = r as unknown as { habits: Habit[]; completions?: Record<string, string[]> };
    return {
      version: 2,
      onboarded: true,
      habits: old.habits.map((h) => ({ ...h, updatedAt: h.updatedAt ?? h.createdAt })),
      completions: old.completions ?? {},
      completionMeta: {},
    };
  }
  return null;
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = normalize(JSON.parse(raw));
      if (s) return s;
    }
    const old = localStorage.getItem(OLD_KEY);
    if (old) {
      const s = normalize(JSON.parse(old));
      if (s) return s; // migrated v1 data; sync uploads it on first sign-in
    }
  } catch {
    // corrupted storage -> reseed
  }
  return seed();
}

export type LocalChange =
  | { kind: 'habit'; id: string }
  | { kind: 'habit-deleted'; id: string }
  | { kind: 'completion'; id: string; day: string }
  | { kind: 'bulk' };

const listeners = new Set<(c: LocalChange) => void>();

/** Sync layer subscribes here; remote-originated changes never emit. */
export function onLocalChange(fn: (c: LocalChange) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function emit(c: LocalChange): void {
  listeners.forEach((fn) => {
    try { fn(c); } catch { /* listener errors must not break the app */ }
  });
}

export type Action =
  | { type: 'add'; habit: Habit }
  | { type: 'update'; habit: Habit }
  | { type: 'remove'; id: string }
  | { type: 'toggle'; id: string; day: string }
  | { type: 'import'; state: State }
  | { type: 'replaceAll'; state: State };

function reducer(s: State, a: Action): State {
  const now = new Date().toISOString();
  switch (a.type) {
    case 'add':
      return { ...s, habits: [...s.habits, { ...a.habit, updatedAt: now }] };
    case 'update':
      return { ...s, habits: s.habits.map((h) => (h.id === a.habit.id ? { ...a.habit, updatedAt: now } : h)) };
    case 'remove': {
      const completions = { ...s.completions };
      const completionMeta = { ...s.completionMeta };
      delete completions[a.id];
      delete completionMeta[a.id];
      return { ...s, habits: s.habits.filter((h) => h.id !== a.id), completions, completionMeta };
    }
    case 'toggle': {
      const list = s.completions[a.id] ?? [];
      const has = list.includes(a.day);
      const metaFor = { ...(s.completionMeta[a.id] ?? {}), [a.day]: now };
      return {
        ...s,
        completions: { ...s.completions, [a.id]: has ? list.filter((d) => d !== a.day) : [...list, a.day] },
        completionMeta: { ...s.completionMeta, [a.id]: metaFor },
      };
    }
    case 'import':
    case 'replaceAll':
      return normalize(a.state) ?? s;
  }
}

const Ctx = createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, baseDispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full */ }
  }, [state]);

  // Wrap dispatch so local (user-originated) changes are flagged for sync.
  const dispatch = useMemo(() => (a: Action) => {
    baseDispatch(a);
    switch (a.type) {
      case 'add':
      case 'update':
        emit({ kind: 'habit', id: a.habit.id });
        break;
      case 'remove':
        emit({ kind: 'habit-deleted', id: a.id });
        break;
      case 'toggle':
        emit({ kind: 'completion', id: a.id, day: a.day });
        break;
      case 'import':
        emit({ kind: 'bulk' });
        break;
      case 'replaceAll':
        break; // remote-originated: do not echo back to the server
    }
  }, []);

  const v = useMemo(() => ({ state, dispatch }), [state, dispatch]);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStore outside provider');
  return c;
}

export function exportState(state: State): void {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `rhythm-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function parseImport(text: string): State | null {
  try {
    return normalize(JSON.parse(text));
  } catch {
    return null;
  }
}
