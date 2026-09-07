import type { Habit, State } from './types';

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function isDueOn(h: Habit, d: Date): boolean {
  if (h.recurrence.kind === 'daily') return true;
  return h.recurrence.days.includes(d.getDay());
}

export function dueOn(state: State, d: Date): Habit[] {
  return state.habits.filter((h) => !h.archived && isDueOn(h, d));
}

export function isCompleted(state: State, habitId: string, key: string): boolean {
  return (state.completions[habitId] ?? []).includes(key);
}

export function recurrenceLabel(h: Habit): string {
  if (h.recurrence.kind === 'daily') return 'Every day';
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [...h.recurrence.days].sort((a, b) => a - b);
  if (days.length === 7) return 'Every day';
  if (days.length === 0) return 'No days set';
  return days.map((d) => names[d]).join(' · ');
}

function floorOf(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function currentStreak(h: Habit, done: string[]): number {
  const set = new Set(done);
  const floor = floorOf(new Date(h.createdAt));
  let streak = 0;
  const d = floorOf(new Date());
  // Today due but not done yet: don't break the streak, count through yesterday.
  if (isDueOn(h, d) && !set.has(dateKey(d))) d.setDate(d.getDate() - 1);
  for (let guard = 0; guard < 3700; guard++) {
    if (d < floor) break;
    if (!isDueOn(h, d)) { d.setDate(d.getDate() - 1); continue; }
    if (set.has(dateKey(d))) { streak++; d.setDate(d.getDate() - 1); }
    else break;
  }
  return streak;
}

export function bestStreak(h: Habit, done: string[]): number {
  const set = new Set(done);
  const floor = floorOf(new Date(h.createdAt));
  const today = floorOf(new Date());
  const todayKey = dateKey(today);
  let best = 0;
  let run = 0;
  for (const d = new Date(floor); d <= today; d.setDate(d.getDate() + 1)) {
    if (!isDueOn(h, d)) continue;
    if (set.has(dateKey(d))) { run++; best = Math.max(best, run); }
    else if (dateKey(d) !== todayKey) run = 0; // today unfinished doesn't break best
  }
  return best;
}

/** Completion rate over the last `days` due days, excluding today. */
export function adherence(h: Habit, done: string[], days: number): { due: number; hit: number; ratio: number } {
  const set = new Set(done);
  const floor = floorOf(new Date(h.createdAt));
  const todayKey = dateKey(new Date());
  let due = 0;
  let hit = 0;
  for (let i = 1; i <= days; i++) {
    const d = floorOf(new Date());
    d.setDate(d.getDate() - i);
    if (d < floor) break;
    if (!isDueOn(h, d)) continue;
    if (dateKey(d) === todayKey) continue;
    due++;
    if (set.has(dateKey(d))) hit++;
  }
  return { due, hit, ratio: due === 0 ? 1 : hit / due };
}

export interface DayCell { key: string; due: boolean; done: boolean; future: boolean }

/** 12-week heatmap, rows = Sun..Sat, columns = oldest..current week. */
export function heatmap(h: Habit, done: string[], weeks = 12): DayCell[][] {
  const set = new Set(done);
  const floor = floorOf(new Date(h.createdAt));
  const today = floorOf(new Date());
  const todayDow = today.getDay();
  const cols: DayCell[][] = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const col: DayCell[] = [];
    for (let dow = 0; dow < 7; dow++) {
      const d = new Date(today);
      d.setDate(d.getDate() - w * 7 - (todayDow - dow));
      if (d > today || d < floor) {
        col.push({ key: dateKey(d), due: false, done: false, future: d > today });
        continue;
      }
      const due = isDueOn(h, d);
      col.push({ key: dateKey(d), due, done: due && set.has(dateKey(d)), future: false });
    }
    cols.push(col);
  }
  return cols;
}
