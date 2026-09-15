/**
 * Parse a SQLite `datetime('now')` string (UTC, "YYYY-MM-DD HH:MM:SS") into ms.
 */
export function parseSqliteUtc(s: string): number {
  // SQLite returns 'YYYY-MM-DD HH:MM:SS' in UTC. Replace space with 'T', append 'Z'.
  return Date.parse(s.replace(' ', 'T') + 'Z');
}

/**
 * Format an age span as `Xd` for ≥1 day, `Xh` otherwise. Sub-hour rounds to `<1h`.
 */
export function formatAge(fromSqlite: string, toSqliteOrMs: string | number): string {
  const from = parseSqliteUtc(fromSqlite);
  const to = typeof toSqliteOrMs === 'number' ? toSqliteOrMs : parseSqliteUtc(toSqliteOrMs);
  const ms = Math.max(0, to - from);
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours < 1) return '<1h';
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
