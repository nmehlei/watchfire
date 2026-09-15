import { beforeEach, describe, expect, it } from 'vitest';
import { getFindingByFingerprint, insertRun, openMemoryDb, type Db } from '../../memory/index.js';
import { createEmitFindingTool } from './emit-finding.js';

async function callHandler(
  tool: ReturnType<typeof createEmitFindingTool>,
  args: Parameters<(typeof tool)['handler']>[0],
): Promise<ReturnType<(typeof tool)['handler']>> {
  return tool.handler(args, {});
}

describe('createEmitFindingTool', () => {
  let db: Db;
  let runId: number;

  beforeEach(() => {
    db = openMemoryDb();
    runId = insertRun(db, { type: 'nightly', trigger: 'cron' });
  });

  it('upserts a new finding via the handler', async () => {
    const t = createEmitFindingTool(db, runId);
    const result = await callHandler(t, {
      resource_id: 'sql.acme.internal',
      issue_class: 'disk-pressure',
      severity: 'critical',
      title: 'disk at 94%',
      evidence: 'growth 0.3%/h',
    });

    expect(result.isError).toBeFalsy();
    const firstContent = result.content[0];
    if (!firstContent || firstContent.type !== 'text') throw new Error('expected text content');
    expect(firstContent.text).toMatch(/finding recorded:/);

    const rows = db
      .prepare('SELECT fingerprint, resource_id, state, severity FROM findings')
      .all() as Array<{ fingerprint: string; resource_id: string; state: string; severity: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('new');
    expect(rows[0]!.severity).toBe('critical');
    expect(rows[0]!.resource_id).toBe('sql.acme.internal');
  });

  it('includes likely_cause when provided', async () => {
    const t = createEmitFindingTool(db, runId);
    await callHandler(t, {
      resource_id: 'a',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e',
      likely_cause: 'a real reason',
    });
    const row = db.prepare('SELECT likely_cause FROM findings').get() as { likely_cause: string };
    expect(row.likely_cause).toBe('a real reason');
  });

  it('canonicalizes resource_id', async () => {
    const t = createEmitFindingTool(db, runId);
    const first = await callHandler(t, {
      resource_id: '  SQL.ACME.Internal  ',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e',
    });
    const firstContent = first.content[0];
    if (!firstContent || firstContent.type !== 'text') throw new Error('expected text');
    const fpPrefix = firstContent.text.split(' ')[2]!.slice(0, 16);

    const row = db
      .prepare('SELECT fingerprint, resource_id FROM findings WHERE fingerprint LIKE ?')
      .get(`${fpPrefix}%`) as { fingerprint: string; resource_id: string };
    expect(row.resource_id).toBe('sql.acme.internal');
  });

  it('second emission of same (resource, class) transitions new → ongoing', async () => {
    const t = createEmitFindingTool(db, runId);
    await callHandler(t, {
      resource_id: 'sql.acme.internal',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e1',
    });
    const run2 = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const t2 = createEmitFindingTool(db, run2);
    const result = await callHandler(t2, {
      resource_id: 'sql.acme.internal',
      issue_class: 'disk-pressure',
      severity: 'critical',
      title: 't',
      evidence: 'e2',
    });
    const firstContent = result.content[0];
    if (!firstContent || firstContent.type !== 'text') throw new Error('expected text');
    expect(firstContent.text).toContain('ongoing');

    const rows = db.prepare('SELECT * FROM findings').all() as Array<{
      fingerprint: string;
      state: string;
      prev_severity: string | null;
      severity: string;
    }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.state).toBe('ongoing');
    expect(rows[0]!.severity).toBe('critical');
    expect(rows[0]!.prev_severity).toBe('warn');
  });

  it('surfaces an error result on DB failure (fingerprint corruption not possible; simulate via closed db)', async () => {
    const t = createEmitFindingTool(db, runId);
    db.close();
    const result = await callHandler(t, {
      resource_id: 'x',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e',
    });
    expect(result.isError).toBe(true);
    const firstContent = result.content[0];
    if (!firstContent || firstContent.type !== 'text') throw new Error('expected text');
    expect(firstContent.text).toContain('emit-finding failed');
  });

  it('tool name is mcp__iris__emit_finding-compatible (bare name emit_finding)', () => {
    const t = createEmitFindingTool(db, runId);
    expect(t.name).toBe('emit_finding');
  });

  // Verify getFindingByFingerprint for completeness.
  it('emitted fingerprint matches memory state', async () => {
    const t = createEmitFindingTool(db, runId);
    const result = await callHandler(t, {
      resource_id: 'sql.acme.internal',
      issue_class: 'disk-pressure',
      severity: 'warn',
      title: 't',
      evidence: 'e',
    });
    const firstContent = result.content[0];
    if (!firstContent || firstContent.type !== 'text') throw new Error('expected text');
    // Short fp is "finding recorded: <16hex>" — extract.
    const match = firstContent.text.match(/finding recorded: ([a-f0-9]{16})/);
    expect(match).not.toBeNull();
    const short = match![1]!;
    const rows = db
      .prepare('SELECT fingerprint FROM findings WHERE fingerprint LIKE ?')
      .all(`${short}%`) as Array<{ fingerprint: string }>;
    expect(rows).toHaveLength(1);
    // Full lookup should find it too.
    expect(getFindingByFingerprint(db, rows[0]!.fingerprint)).not.toBeNull();
  });
});
