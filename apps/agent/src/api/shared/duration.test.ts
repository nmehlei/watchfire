import { describe, expect, it } from 'vitest';
import { expiryForDuration, isDuration } from './duration.js';

describe('isDuration', () => {
  it('accepts the allowed set', () => {
    expect(isDuration('1d')).toBe(true);
    expect(isDuration('7d')).toBe(true);
    expect(isDuration('30d')).toBe(true);
    expect(isDuration('forever')).toBe(true);
  });

  it('rejects everything else', () => {
    expect(isDuration('5d')).toBe(false);
    expect(isDuration('1week')).toBe(false);
    expect(isDuration('')).toBe(false);
    expect(isDuration('FOREVER')).toBe(false);
  });
});

describe('expiryForDuration', () => {
  it('returns null for forever', () => {
    expect(expiryForDuration('forever')).toBeNull();
  });

  it('returns SQLite-format timestamp for finite durations', () => {
    const now = new Date('2026-04-20T12:00:00Z');
    expect(expiryForDuration('1d', now)).toBe('2026-04-21 12:00:00');
    expect(expiryForDuration('7d', now)).toBe('2026-04-27 12:00:00');
    expect(expiryForDuration('30d', now)).toBe('2026-05-20 12:00:00');
  });
});
