export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekly'; days: number[] }; // 0 = Sunday .. 6 = Saturday

export type HabitKind = 'habit' | 'bonus' | 'penalty';

export interface Habit {
  id: string;
  kind: HabitKind;      // habit = recurring routine, bonus = one-off good action, penalty = one-off slip
  weight: number;       // decimal, + or -; daily score = sum of weights checked that day
  name: string;
  emoji: string;
  color: string; // hex accent
  notes: string;
  recurrence: Recurrence;
  targetTime: string | null;    // "HH:MM" deadline-style marker (e.g. stop eating at 20:00)
  reminderEnabled: boolean;
  reminderTime: string | null;  // "HH:MM"
  createdAt: string;            // ISO timestamp
  updatedAt: string;            // ISO timestamp, drives sync conflict resolution (last write wins)
  archived: boolean;
}

export interface State {
  version: 2;
  habits: Habit[];
  completions: Record<string, string[]>;                 // habitId -> ['2026-09-07', ...] local date keys
  completionMeta: Record<string, Record<string, string>>; // habitId -> day -> updatedAt ISO (sync conflict resolution)
  onboarded: boolean;
  /** True only while local state is the untouched auto-generated demo seed.
   *  Set by seed(), cleared by the first user-originated change and by sync.
   *  Lets first sign-in on a fresh device prefer server data over re-uploading
   *  the seed (which would duplicate everything). */
  seedPristine?: boolean;
}
