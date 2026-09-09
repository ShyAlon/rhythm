// Weight log: pure logic (no I/O) so every rule is unit-testable.
// Entries come from manual in-app logging and the Apple Health Shortcut bridge
// (supabase/functions/ingest-weight). Server rows map 1:1 onto WeightEntry.

export interface WeightEntry {
  id: string;
  kg: number;
  takenAt: string; // ISO timestamp of the measurement
  source: string;  // 'manual' | 'apple-health' | ...
}

export const KG_MIN = 20;
export const KG_MAX = 400;
export const TAKEN_AT_MIN = Date.parse('2020-01-01T00:00:00.000Z');
export const FUTURE_SLACK_MS = 24 * 3600 * 1000; // tolerate clock skew, not real future dates

export function isValidKg(kg: unknown): kg is number {
  return typeof kg === 'number' && Number.isFinite(kg) && kg > KG_MIN && kg < KG_MAX;
}

export function isValidTakenAt(iso: string, now: number = Date.now()): boolean {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t >= TAKEN_AT_MIN && t <= now + FUTURE_SLACK_MS;
}

export function sortByTakenAt(entries: WeightEntry[]): WeightEntry[] {
  return [...entries].sort((a, b) => Date.parse(a.takenAt) - Date.parse(b.takenAt));
}

export function latest(entries: WeightEntry[]): WeightEntry | null {
  const s = sortByTakenAt(entries);
  return s.length ? s[s.length - 1] : null;
}

/** Latest minus earliest entry inside the trailing window; null when fewer than 2 in-window. */
export function deltaOverWindow(entries: WeightEntry[], days: number, now: number = Date.now()): number | null {
  const from = now - days * 24 * 3600 * 1000;
  const inWindow = sortByTakenAt(entries).filter((e) => Date.parse(e.takenAt) >= from);
  if (inWindow.length < 2) return null;
  return inWindow[inWindow.length - 1].kg - inWindow[0].kg;
}

/** Entries inside the trailing `days` window, ascending. */
export function inWindow(entries: WeightEntry[], days: number, now: number = Date.now()): WeightEntry[] {
  const from = now - days * 24 * 3600 * 1000;
  return sortByTakenAt(entries).filter((e) => Date.parse(e.takenAt) >= from);
}

/**
 * SVG polyline points for the trend chart. X spans the window (oldest..now),
 * Y spans the entries' kg range with a small pad. Empty string when no points.
 */
export function chartPoints(
  entries: WeightEntry[],
  days: number,
  now: number = Date.now(),
  w = 300,
  h = 90,
): string {
  const pts = inWindow(entries, days, now);
  if (pts.length === 0) return '';
  const kgs = pts.map((e) => e.kg);
  const lo = Math.min(...kgs);
  const hi = Math.max(...kgs);
  const pad = Math.max((hi - lo) * 0.15, 0.5);
  const y0 = lo - pad;
  const y1 = hi + pad;
  const t0 = now - days * 24 * 3600 * 1000;
  const t1 = now;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * w;
  const y = (kg: number) => h - ((kg - y0) / (y1 - y0)) * h;
  return pts.map((e) => `${x(Date.parse(e.takenAt)).toFixed(1)},${y(e.kg).toFixed(1)}`).join(' ');
}

/** Min/max kg inside the window, for chart axis labels; null when empty. */
export function chartRange(entries: WeightEntry[], days: number, now: number = Date.now()): { lo: number; hi: number } | null {
  const pts = inWindow(entries, days, now);
  if (!pts.length) return null;
  const kgs = pts.map((e) => e.kg);
  return { lo: Math.min(...kgs), hi: Math.max(...kgs) };
}

export function formatKg(kg: number): string {
  return kg.toFixed(1).replace(/\.0$/, '');
}

export const INGEST_TOKEN_RE = /^rhythm_ingest_[0-9a-f]{48}$/;

/** New per-user ingest token. RNG injectable for deterministic tests. */
export function newIngestToken(rand: (n: number) => Uint8Array = defaultRand): string {
  const bytes = rand(24);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return `rhythm_ingest_${hex}`;
}

function defaultRand(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

export function isValidIngestToken(token: unknown): token is string {
  return typeof token === 'string' && INGEST_TOKEN_RE.test(token);
}
