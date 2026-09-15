import { beforeEach, describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from './schema.js';
import {
  completeRun,
  countRecentPages,
  countSuppressedPages,
  getCostWindow,
  getLastSweptNightlyAt,
  getRun,
  getRunFindings,
  getRunsRecent,
  insertRun,
  markCrashedOnStartup,
  pruneOldRuns,
} from './runs.js';
import { upsertFinding } from './findings.js';

describe('runs', () => {
  let db: Db;
  beforeEach(() => {
    db = openMemoryDb();
  });

  it('insertRun creates a row with started_at, no completed_at', () => {
    const id = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const run = getRun(db, id);
    expect(run).not.toBeNull();
    expect(run!.type).toBe('nightly');
    expect(run!.trigger).toBe('cron');
    expect(run!.started_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(run!.completed_at).toBeNull();
    expect(run!.status).toBeNull();
  });

  it('completeRun fills status, tokens, cost', () => {
    const id = insertRun(db, { type: 'nightly', trigger: 'cron' });
    completeRun(db, id, {
      status: 'success',
      findingCount: 5,
      turnCount: 14,
      tokensIn: 1000,
      tokensOut: 500,
      tokensCached: 800,
      costEur: 0.11,
      transcriptPath: '/var/lib/watchfire/transcripts/1.jsonl',
    });
    const run = getRun(db, id)!;
    expect(run.status).toBe('success');
    expect(run.finding_count).toBe(5);
    expect(run.turn_count).toBe(14);
    expect(run.tokens_in).toBe(1000);
    expect(run.cost_eur).toBeCloseTo(0.11);
    expect(run.transcript_path).toBe('/var/lib/watchfire/transcripts/1.jsonl');
    expect(run.completed_at).not.toBeNull();
  });

  it('completeRun records watch verdict + page_sent', () => {
    const id = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, id, {
      status: 'success',
      verdict: 'page',
      pageSent: true,
      findingCount: 1,
    });
    const run = getRun(db, id)!;
    expect(run.verdict).toBe('page');
    expect(run.page_sent).toBe(1);
  });

  it('pageSent=false stores 0, not null', () => {
    const id = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, id, { status: 'success', verdict: 'page', pageSent: false, findingCount: 1 });
    const run = getRun(db, id)!;
    expect(run.page_sent).toBe(0);
  });

  it('markCrashedOnStartup marks only unfinished rows', () => {
    const a = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const b = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, b, { status: 'success', findingCount: 0 });
    const c = insertRun(db, { type: 'nightly', trigger: 'catchup' });
    const marked = markCrashedOnStartup(db);
    expect(marked).toBe(2);
    expect(getRun(db, a)!.status).toBe('crashed');
    expect(getRun(db, b)!.status).toBe('success');
    expect(getRun(db, c)!.status).toBe('crashed');
  });

  it('getLastSweptNightlyAt returns latest success-or-truncated nightly', () => {
    expect(getLastSweptNightlyAt(db)).toBeNull();

    const a = insertRun(db, { type: 'nightly', trigger: 'cron' });
    completeRun(db, a, { status: 'error', findingCount: 0, error: 'bad' });
    expect(getLastSweptNightlyAt(db)).toBeNull();

    const b = insertRun(db, { type: 'nightly', trigger: 'cron' });
    completeRun(db, b, { status: 'truncated', findingCount: 3 });
    const after = getLastSweptNightlyAt(db);
    expect(after).not.toBeNull();

    const c = insertRun(db, { type: 'nightly', trigger: 'cron' });
    completeRun(db, c, { status: 'success', findingCount: 1 });
    // MAX over all swept — c >= b
    expect(getLastSweptNightlyAt(db)! >= after!).toBe(true);
  });

  it('ignores watch runs in getLastSweptNightlyAt', () => {
    const w = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, w, { status: 'success', verdict: 'page', pageSent: true, findingCount: 1 });
    expect(getLastSweptNightlyAt(db)).toBeNull();
  });

  it('countRecentPages counts only verdict=page AND page_sent=1', () => {
    // Three pages, two sent, one suppressed.
    const a = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, a, { status: 'success', verdict: 'page', pageSent: true, findingCount: 1 });

    const b = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, b, { status: 'success', verdict: 'page', pageSent: true, findingCount: 1 });

    const c = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, c, { status: 'success', verdict: 'page', pageSent: false, findingCount: 1 });

    // A defer doesn't count.
    const d = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, d, { status: 'success', verdict: 'defer', pageSent: false, findingCount: 0 });

    expect(countRecentPages(db)).toBe(2);
  });

  it('countSuppressedPages picks up verdict=page AND page_sent=0', () => {
    const a = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, a, { status: 'success', verdict: 'page', pageSent: false, findingCount: 1 });
    const b = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, b, { status: 'success', verdict: 'page', pageSent: false, findingCount: 1 });
    const window = countSuppressedPages(db);
    expect(window.count).toBe(2);
    expect(window.windowStart).not.toBeNull();
    expect(window.windowEnd).not.toBeNull();
  });

  it('countSuppressedPages returns zero-count window when none', () => {
    const w = countSuppressedPages(db);
    expect(w.count).toBe(0);
    expect(w.windowStart).toBeNull();
    expect(w.windowEnd).toBeNull();
  });

  it('pruneOldRuns deletes rows older than cutoff', () => {
    const id = insertRun(db, { type: 'nightly', trigger: 'cron' });
    // Force started_at to 400 days ago.
    db.prepare(`UPDATE runs SET started_at = datetime('now', '-400 days') WHERE id = ?`).run(id);
    const deleted = pruneOldRuns(db, 365);
    expect(deleted).toBe(1);
    expect(getRun(db, id)).toBeNull();
  });

  it('pruneOldRuns leaves recent rows alone', () => {
    insertRun(db, { type: 'nightly', trigger: 'cron' });
    expect(pruneOldRuns(db, 365)).toBe(0);
  });
});

describe('getRunsRecent', () => {
  it('returns runs ordered by started_at DESC, default limit 20', () => {
    const db = openMemoryDb();
    for (let i = 0; i < 25; i++) {
      insertRun(db, { type: 'nightly', trigger: 'cron' });
    }
    const out = getRunsRecent(db, {});
    expect(out.length).toBe(20);
    expect(out[0]!.id).toBe(25);
  });

  it('filters by type', () => {
    const db = openMemoryDb();
    insertRun(db, { type: 'nightly', trigger: 'cron' });
    insertRun(db, { type: 'watch', trigger: 'webhook' });
    insertRun(db, { type: 'nightly', trigger: 'cron' });
    const nightlies = getRunsRecent(db, { type: 'nightly' });
    expect(nightlies.length).toBe(2);
    expect(nightlies.every((r) => r.type === 'nightly')).toBe(true);
  });

  it('respects limit', () => {
    const db = openMemoryDb();
    for (let i = 0; i < 5; i++) insertRun(db, { type: 'nightly', trigger: 'cron' });
    expect(getRunsRecent(db, { limit: 2 }).length).toBe(2);
  });

  it('caps limit at 50', () => {
    const db = openMemoryDb();
    for (let i = 0; i < 60; i++) insertRun(db, { type: 'nightly', trigger: 'cron' });
    expect(getRunsRecent(db, { limit: 999 }).length).toBe(50);
  });
});

describe('getRunFindings', () => {
  it('returns findings touched (created or refreshed) by a run', () => {
    const db = openMemoryDb();
    const run1 = insertRun(db, { type: 'nightly', trigger: 'cron' });
    upsertFinding(db, run1, {
      resource_id: 'r1',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e',
    });
    const run2 = insertRun(db, { type: 'nightly', trigger: 'cron' });
    upsertFinding(db, run2, {
      resource_id: 'r2',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e',
    });
    upsertFinding(db, run2, {
      resource_id: 'r1',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e',
    });

    const run2Findings = getRunFindings(db, run2);
    expect(run2Findings.map((f) => f.resource_id).sort()).toEqual(['r1', 'r2']);
  });
});

describe('getCostWindow', () => {
  it('aggregates total + by_type + daily_buckets within window', () => {
    const db = openMemoryDb();
    const r1 = insertRun(db, { type: 'nightly', trigger: 'cron' });
    completeRun(db, r1, {
      status: 'success',
      findingCount: 0,
      turnCount: 10,
      tokensIn: 1000,
      tokensOut: 500,
      tokensCached: 0,
      costEur: 0.10,
    });
    const r2 = insertRun(db, { type: 'watch', trigger: 'webhook' });
    completeRun(db, r2, {
      status: 'success',
      findingCount: 1,
      turnCount: 5,
      tokensIn: 200,
      tokensOut: 100,
      tokensCached: 0,
      costEur: 0.02,
      verdict: 'page',
      pageSent: true,
    });

    const out = getCostWindow(db, { days: 30 });
    expect(out.total_eur).toBeCloseTo(0.12, 6);
    expect(out.by_type.nightly).toBeCloseTo(0.10, 6);
    expect(out.by_type.watch).toBeCloseTo(0.02, 6);
    expect(out.daily_buckets.length).toBeGreaterThan(0);
  });

  it('treats null cost_eur as zero', () => {
    const db = openMemoryDb();
    insertRun(db, { type: 'nightly', trigger: 'cron' });
    const out = getCostWindow(db, { days: 30 });
    expect(out.total_eur).toBe(0);
  });
});
