// Migration 0001 — initial schema.
// See specs/06-memory.md. Column comments live on the CREATE TABLE in the spec;
// kept terse here to match the executing SQL.

import type { Migration } from './index.js';

const migration: Migration = {
  version: 1,
  name: 'init',
  sql: `
    CREATE TABLE runs (
      id              INTEGER PRIMARY KEY,
      type            TEXT NOT NULL,
      trigger         TEXT NOT NULL,
      started_at      TEXT NOT NULL,
      completed_at    TEXT,
      status          TEXT,
      verdict         TEXT,
      page_sent       INTEGER,
      finding_count   INTEGER,
      turn_count      INTEGER,
      tokens_in       INTEGER,
      tokens_out      INTEGER,
      tokens_cached   INTEGER,
      cost_eur        REAL,
      error           TEXT,
      transcript_path TEXT
    );
    CREATE INDEX idx_runs_type_started ON runs(type, started_at DESC);
    CREATE INDEX idx_runs_started      ON runs(started_at DESC);

    CREATE TABLE findings (
      id              INTEGER PRIMARY KEY,
      fingerprint     TEXT NOT NULL UNIQUE,
      resource_id     TEXT NOT NULL,
      issue_class     TEXT NOT NULL,
      state           TEXT NOT NULL,
      severity        TEXT NOT NULL,
      prev_severity   TEXT,
      title           TEXT NOT NULL,
      evidence        TEXT,
      likely_cause    TEXT,
      first_seen_at   TEXT NOT NULL,
      last_seen_at    TEXT NOT NULL,
      resolved_at     TEXT,
      run_count       INTEGER NOT NULL DEFAULT 1,
      first_run_id    INTEGER NOT NULL,
      last_run_id     INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX idx_findings_fp          ON findings(fingerprint);
    CREATE        INDEX idx_findings_state_seen  ON findings(state, last_seen_at DESC);
    CREATE        INDEX idx_findings_resource    ON findings(resource_id);
    CREATE        INDEX idx_findings_resolved_at ON findings(resolved_at);

    CREATE TABLE observations (
      id            INTEGER PRIMARY KEY,
      tenant        TEXT NOT NULL,
      source        TEXT NOT NULL,
      subject       TEXT NOT NULL,
      metric        TEXT NOT NULL,
      value         REAL NOT NULL,
      observed_at   TEXT NOT NULL,
      run_id        INTEGER NOT NULL
    );
    CREATE INDEX idx_obs_lookup ON observations(tenant, source, subject, metric, observed_at DESC);
    CREATE INDEX idx_obs_run    ON observations(run_id);
  `,
};

export default migration;
