import { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { ReactNode } from 'react';
import type { Habit, State } from './types';

const KEY = 'rhythm.v1';

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
    archived: false,
    ...p,
  });
  return {
    version: 1,
    onboarded: true,
    completions: {},
    habits: [
      mk({ name: 'Meditate', emoji: '🧘', color: '#9d6cff', reminderEnabled: true, reminderTime: '08:00' }),
      mk({ name: 'Duolingo', emoji: '🦉', color: '#3ddc97', reminderEnabled: true, reminderTime: '18:00' }),
      mk({ name: 'Stop eating', emoji: '🍽️', color: '#ffb020', targetTime: '20:00', reminderEnabled: true, reminderTime: '19:45', notes: 'Kitchen closes at 20:00' }),
      mk({ name: 'Workout', emoji: '🏋️', color: '#6c8cff', recurrence: { kind: 'weekly', days: [1, 3, 5] }, reminderEnabled: true, reminderTime: '07:30' }),
    ],
  };
}

function load(): State {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw) as State;
      if (s && s.version === 1 && Array.isArray(s.habits)) return s;
    }
  } catch {
    // corrupted storage -> reseed
  }
  return seed();
}

export type Action =
  | { type: 'add'; habit: Habit }
  | { type: 'update'; habit: Habit }
  | { type: 'remove'; id: string }
  | { type: 'toggle'; id: string; day: string }
  | { type: 'import'; state: State };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case 'add':
      return { ...s, habits: [...s.habits, a.habit] };
    case 'update':
      return { ...s, habits: s.habits.map((h) => (h.id === a.habit.id ? a.habit : h)) };
    case 'remove': {
      const completions = { ...s.completions };
      delete completions[a.id];
      return { ...s, habits: s.habits.filter((h) => h.id !== a.id), completions };
    }
    case 'toggle': {
      const list = s.completions[a.id] ?? [];
      const has = list.includes(a.day);
      return {
        ...s,
        completions: { ...s.completions, [a.id]: has ? list.filter((d) => d !== a.day) : [...list, a.day] },
      };
    }
    case 'import':
      return a.state;
  }
}

const Ctx = createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full */ }
  }, [state]);
  const v = useMemo(() => ({ state, dispatch }), [state]);
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
    const s = JSON.parse(text) as State;
    if (s && s.version === 1 && Array.isArray(s.habits) && typeof s.completions === 'object') return s;
  } catch { /* fall through */ }
  return null;
}
