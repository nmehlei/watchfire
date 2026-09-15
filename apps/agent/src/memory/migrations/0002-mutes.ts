// Migration 0002 — mutes table.
// See specs/06-memory.md §mutes and specs/10-telegram-control.md.

import type { Migration } from './index.js';

const migration: Migration = {
  version: 2,
  name: 'mutes',
  sql: `
    CREATE TABLE mutes (
      id            INTEGER PRIMARY KEY,
      fingerprint   TEXT NOT NULL,
      reason        TEXT,
      created_at    TEXT NOT NULL,
      expires_at    TEXT,
      source        TEXT NOT NULL
    );
    CREATE INDEX idx_mutes_fingerprint ON mutes(fingerprint);
    CREATE INDEX idx_mutes_expires_at  ON mutes(expires_at);
  `,
};

export default migration;
