import { describe, expect, it } from 'vitest';
import {
  chartPoints, chartRange, deltaOverWindow, formatKg, inWindow, isValidIngestToken, isValidKg,
  isValidTakenAt, latest, newIngestToken, sortByTakenAt,
} from './weight';
import type { WeightEntry } from './weight';

const NOW = Date.parse('2026-09-09T12:00:00.000Z');
const e = (kg: number, daysAgo: number, id = `${kg}-${daysAgo}`): WeightEntry => ({
  id, kg, takenAt: new Date(NOW - daysAgo * 24 * 3600 * 1000).toISOString(), source: 'manual',
});

describe('isValidKg', () => {
  it('accepts realistic weights', () => {
    expect(isValidKg(83.4)).toBe(true);
    expect(isValidKg(20.1)).toBe(true);
    expect(isValidKg(399.9)).toBe(true);
  });
  it('rejects out-of-range and non-numbers', () => {
    expect(isValidKg(20)).toBe(false);
    expect(isValidKg(400)).toBe(false);
    expect(isValidKg(-5)).toBe(false);
    expect(isValidKg(NaN)).toBe(false);
    expect(isValidKg(Infinity)).toBe(false);
    expect(isValidKg('83')).toBe(false);
    expect(isValidKg(null)).toBe(false);
  });
});

describe('isValidTakenAt', () => {
  it('accepts now and the recent past', () => {
    expect(isValidTakenAt(new Date(NOW).toISOString(), NOW)).toBe(true);
    expect(isValidTakenAt('2026-01-01T00:00:00.000Z', NOW)).toBe(true);
  });
  it('tolerates small clock skew but rejects real future dates', () => {
    expect(isValidTakenAt(new Date(NOW + 3600 * 1000).toISOString(), NOW)).toBe(true);
    expect(isValidTakenAt(new Date(NOW + 48 * 3600 * 1000).toISOString(), NOW)).toBe(false);
  });
  it('rejects pre-2020 and garbage', () => {
    expect(isValidTakenAt('2019-12-31T23:59:59.000Z', NOW)).toBe(false);
    expect(isValidTakenAt('not a date', NOW)).toBe(false);
    expect(isValidTakenAt('', NOW)).toBe(false);
  });
});

describe('sorting, latest, windows', () => {
  const entries = [e(84, 10), e(82.5, 2), e(83.1, 6)];
  it('sorts ascending and finds the latest', () => {
    const s = sortByTakenAt(entries);
    expect(s.map((x) => x.kg)).toEqual([84, 83.1, 82.5]);
    expect(latest(entries)?.kg).toBe(82.5);
  });
  it('filters to the trailing window', () => {
    expect(inWindow(entries, 7, NOW).map((x) => x.kg)).toEqual([83.1, 82.5]);
    expect(inWindow(entries, 1, NOW)).toEqual([]);
  });
});

describe('deltaOverWindow', () => {
  it('is latest minus earliest inside the window', () => {
    expect(deltaOverWindow([e(84, 20), e(82, 3)], 30, NOW)).toBe(-2);
  });
  it('ignores entries outside the window', () => {
    expect(deltaOverWindow([e(90, 60), e(82, 3)], 30, NOW)).toBeNull();
  });
  it('is null with fewer than two in-window entries', () => {
    expect(deltaOverWindow([e(82, 3)], 30, NOW)).toBeNull();
    expect(deltaOverWindow([], 30, NOW)).toBeNull();
  });
});

describe('chartPoints', () => {
  it('spans the full width and inverts y for heavier weights', () => {
    const pts = chartPoints([e(84, 10), e(82, 0)], 30, NOW, 300, 90).split(' ');
    expect(pts).toHaveLength(2);
    const [x1, y1] = pts[0].split(',').map(Number);
    const [x2, y2] = pts[1].split(',').map(Number);
    expect(x1).toBeCloseTo(200, 0); // 10 days ago = 20 days into a 30-day window
    expect(x2).toBeCloseTo(300, 0); // now
    expect(y1).toBeLessThan(y2);    // 84 kg sits higher on the chart than 82 kg
  });
  it('is empty with no in-window entries', () => {
    expect(chartPoints([], 30, NOW)).toBe('');
    expect(chartPoints([e(82, 100)], 30, NOW)).toBe('');
  });
  it('chartRange reports min/max in window', () => {
    expect(chartRange([e(84, 10), e(82, 2), e(90, 100)], 30, NOW)).toEqual({ lo: 82, hi: 84 });
    expect(chartRange([], 30, NOW)).toBeNull();
  });
});

describe('formatKg', () => {
  it('drops a trailing .0 and keeps one decimal otherwise', () => {
    expect(formatKg(83)).toBe('83');
    expect(formatKg(83.4)).toBe('83.4');
  });
});

describe('ingest tokens', () => {
  it('generates the expected shape', () => {
    const t = newIngestToken(() => new Uint8Array(24).fill(0xab));
    expect(t).toBe(`rhythm_ingest_${'ab'.repeat(24)}`);
    expect(isValidIngestToken(t)).toBe(true);
  });
  it('generated tokens are unique', () => {
    expect(newIngestToken()).not.toBe(newIngestToken());
  });
  it('rejects malformed tokens', () => {
    expect(isValidIngestToken('rhythm_ingest_xyz')).toBe(false);
    expect(isValidIngestToken('rhythm_ingest_' + 'ab'.repeat(23))).toBe(false);
    expect(isValidIngestToken('rhythm_ingest_' + 'AB'.repeat(24))).toBe(false);
    expect(isValidIngestToken('')).toBe(false);
    expect(isValidIngestToken(null)).toBe(false);
  });
});
