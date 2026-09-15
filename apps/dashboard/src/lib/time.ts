/**
 * Parse a SQLite `datetime('now')` string ('YYYY-MM-DD HH:MM:SS', UTC) into ms.
 */
export function parseSqliteUtc(s: string): number {
  return Date.parse(s.replace(" ", "T") + "Z");
}

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** Relative time string like "2 hours ago" / "in 5 minutes". */
export function relativeTime(fromSqliteOrIso: string, nowMs: number = Date.now()): string {
  const from = fromSqliteOrIso.includes("T")
    ? Date.parse(fromSqliteOrIso)
    : parseSqliteUtc(fromSqliteOrIso);
  const deltaMs = from - nowMs;
  const deltaMin = Math.round(deltaMs / 60_000);
  if (Math.abs(deltaMin) < 60) return rtf.format(deltaMin, "minute");
  const deltaHour = Math.round(deltaMs / 3_600_000);
  if (Math.abs(deltaHour) < 24) return rtf.format(deltaHour, "hour");
  const deltaDay = Math.round(deltaMs / 86_400_000);
  return rtf.format(deltaDay, "day");
}

/** Days remaining until the end of the current month, including today. */
export function daysIntoMonth(nowMs: number = Date.now()): number {
  const now = new Date(nowMs);
  return now.getUTCDate();
}

/**
 * Format a run duration like "1m 52s". Returns "—" when end is null
 * (run still in-flight).
 */
export function durationSpan(startSqlite: string, endSqlite: string | null): string {
  if (!endSqlite) return "—";
  const ms = parseSqliteUtc(endSqlite) - parseSqliteUtc(startSqlite);
  if (ms <= 0) return "0s";
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/** Format a number with thousands separators (en-US). */
export function fmtInt(n: number): string {
  return n.toLocaleString("en-US");
}
