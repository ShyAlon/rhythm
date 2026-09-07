export type Recurrence =
  | { kind: 'daily' }
  | { kind: 'weekly'; days: number[] }; // 0 = Sunday .. 6 = Saturday

export interface Habit {
  id: string;
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
}
