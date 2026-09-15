import { describe, expect, it } from 'vitest';
import { insertRun } from '../../../memory/runs.js';
import { openMemoryDb } from '../../../memory/schema.js';
import { handleGetRun } from './get-run.js';

describe('handleGetRun', () => {
  it('returns ok for known id', () => {
    const db = openMemoryDb();
    const id = insertRun(db, { type: 'nightly', trigger: 'cron' });
    const out = handleGetRun({ db }, { id });
    expect(out.kind).toBe('ok');
    if (out.kind === 'ok') expect(out.run.id).toBe(id);
  });

  it('not_found for unknown id', () => {
    const out = handleGetRun({ db: openMemoryDb() }, { id: 99 });
    expect(out.kind).toBe('not_found');
  });

  it('invalid_argument for bad id', () => {
    const out = handleGetRun({ db: openMemoryDb() }, { id: 0 });
    expect(out.kind).toBe('invalid_argument');
  });
});
