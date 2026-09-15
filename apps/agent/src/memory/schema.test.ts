import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDb, openMemoryDb } from './schema.js';

function tempDbPath(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'watchfire-test-'));
  return {
    path: join(dir, 'test.db'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe('openDb', () => {
  it('creates the expected tables on a fresh memory DB', () => {
    const db = openMemoryDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['runs', 'findings', 'observations', 'schema_migrations']));
  });

  it('records all migrations applied', () => {
    const db = openMemoryDb();
    const rows = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
  });

  it('enforces findings.fingerprint uniqueness', () => {
    const db = openMemoryDb();
    const insert = db.prepare(`
      INSERT INTO findings
        (fingerprint, resource_id, issue_class, state, severity, title,
         first_seen_at, last_seen_at, run_count, first_run_id, last_run_id)
      VALUES (?, ?, ?, 'new', 'warn', 't', '2026-04-20', '2026-04-20', 1, 1, 1)
    `);
    insert.run('fp-a', 'r1', 'disk-pressure');
    expect(() => insert.run('fp-a', 'r2', 'cert-expiry')).toThrow(/UNIQUE/);
  });

  describe('file-backed DB', () => {
    let cleanup: () => void;
    let path: string;

    beforeEach(() => {
      const tmp = tempDbPath();
      path = tmp.path;
      cleanup = tmp.cleanup;
    });

    afterEach(() => cleanup());

    it('sets WAL journal mode', () => {
      const db = openDb(path);
      const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
      expect(row.journal_mode).toBe('wal');
      db.close();
    });

    it('is idempotent across re-opens — each migration runs at most once', () => {
      openDb(path).close();
      openDb(path).close();
      const db = openDb(path);
      const rows = db
        .prepare('SELECT version FROM schema_migrations ORDER BY version')
        .all() as Array<{ version: number }>;
      expect(rows.map((r) => r.version)).toEqual([1, 2]);
      db.close();
    });

    it('foreign_keys is OFF (per spec 06)', () => {
      const db = openDb(path);
      const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
      expect(row.foreign_keys).toBe(0);
      db.close();
    });
  });
});
