import { existsSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { openTranscript } from './transcript.js';

describe('openTranscript', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'watchfire-transcript-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  function fakeMsg(n: number): SDKMessage {
    // Minimum viable shape; we're testing serialization, not SDK semantics.
    return { type: 'status', message: `m${n}` } as unknown as SDKMessage;
  }

  it('creates the directory and writes JSONL lines', async () => {
    const subdir = join(dir, 'nested', 'transcripts');
    const tw = openTranscript(subdir, 42);
    expect(tw.path).toBe(join(subdir, '42.jsonl'));
    tw.append(fakeMsg(1));
    tw.append(fakeMsg(2));
    await tw.close();

    expect(existsSync(tw.path)).toBe(true);
    const contents = readFileSync(tw.path, 'utf8');
    const lines = contents.trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ type: 'status', message: 'm1' });
    expect(JSON.parse(lines[1]!)).toMatchObject({ type: 'status', message: 'm2' });
  });

  it('handles non-serializable messages without throwing', async () => {
    const circular: Record<string, unknown> = { type: 'weird' };
    circular['self'] = circular;
    const tw = openTranscript(dir, 1);
    tw.append(circular as unknown as SDKMessage);
    await tw.close();
    const contents = readFileSync(tw.path, 'utf8');
    expect(contents).toContain('_transcript');
    expect(contents).toContain('unserializable');
  });

  it('close() is idempotent', async () => {
    const tw = openTranscript(dir, 2);
    tw.append(fakeMsg(1));
    await tw.close();
    await tw.close();
    await tw.close(); // should not throw
    const lines = readFileSync(tw.path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });

  it('append after close is a no-op', async () => {
    const tw = openTranscript(dir, 3);
    tw.append(fakeMsg(1));
    await tw.close();
    tw.append(fakeMsg(2));
    const lines = readFileSync(tw.path, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
  });
});
