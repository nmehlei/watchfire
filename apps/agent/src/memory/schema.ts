import Database from 'better-sqlite3';
import { migrations } from './migrations/index.js';

export type Db = Database.Database;

export interface OpenOptions {
  readonly?: boolean;
  fileMustExist?: boolean;
}

/**
 * Open (and migrate) the Watchfire SQLite database. See specs/06-memory.md.
 *
 * PRAGMAs:
 *  - journal_mode=WAL (concurrent readers + single writer; specs/06 §Storage)
 *  - busy_timeout=5000 (tolerate brief contention between nightly and watch)
 *  - synchronous=NORMAL (durable enough; <1s window on hard kill)
 *  - foreign_keys=OFF (FKs are documentation only; runs pruner may leave
 *    dangling references that long-lived ongoing findings still point at)
 */
export function openDb(path: string, options: OpenOptions = {}): Db {
  const db = new Database(path, {
    readonly: options.readonly ?? false,
    fileMustExist: options.fileMustExist ?? false,
  });

  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = OFF');

  runMigrations(db);
  return db;
}

/** Convenience for tests. */
export function openMemoryDb(): Db {
  return openDb(':memory:');
}

function runMigrations(db: Db): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version     INTEGER PRIMARY KEY,
      applied_at  TEXT NOT NULL
    );
  `);

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{
    version: number;
  }>;
  const applied = new Set(appliedRows.map((r) => r.version));

  const insertApplied = db.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now'))",
  );

  for (const m of migrations) {
    if (applied.has(m.version)) continue;
    const apply = db.transaction((): void => {
      db.exec(m.sql);
      insertApplied.run(m.version);
    });
    apply();
  }
}
