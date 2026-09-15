// Mute duration parsing. Spec 10 fixes a small enum: 1d / 7d / 30d / forever.

export type Duration = '1d' | '7d' | '30d' | 'forever';

export const ALLOWED_DURATIONS: readonly Duration[] = ['1d', '7d', '30d', 'forever'];

export function isDuration(s: string): s is Duration {
  return (ALLOWED_DURATIONS as readonly string[]).includes(s);
}

/**
 * Convert a duration token to an absolute SQLite-format expiry timestamp.
 * Returns null for `forever`.
 */
export function expiryForDuration(d: Duration, now = new Date()): string | null {
  if (d === 'forever') return null;
  const days = d === '1d' ? 1 : d === '7d' ? 7 : 30;
  const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  // SQLite datetime() format: 'YYYY-MM-DD HH:MM:SS' UTC.
  return future.toISOString().replace('T', ' ').slice(0, 19);
}
