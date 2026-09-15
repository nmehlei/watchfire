import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { join } from 'node:path';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface TranscriptWriter {
  /** Absolute path to the transcript file. Persist in runs.transcript_path. */
  readonly path: string;
  /** Append one SDK message as JSONL. Non-throwing on serialization/IO failure. */
  append(msg: SDKMessage): void;
  /** Flush and close. Safe to call multiple times. */
  close(): Promise<void>;
}

/**
 * Open a per-run transcript at `<dir>/<runId>.jsonl`. Creates `dir` if missing.
 * JSONL: one `SDKMessage` per line. Non-serializable payloads are lossy-dropped
 * rather than crashing the run.
 *
 * See specs/04-nightly.md §Post-run pipeline (transcript archival) and
 * docs/operations.md §Retention (operator-managed, keep-forever default).
 */
export function openTranscript(dir: string, runId: number): TranscriptWriter {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${runId}.jsonl`);
  const stream: WriteStream = createWriteStream(path, { flags: 'a', encoding: 'utf8' });

  let closed = false;

  const append = (msg: SDKMessage): void => {
    if (closed) return;
    let line: string;
    try {
      line = JSON.stringify(msg);
    } catch {
      // Circular refs / non-serializable fields — record a stub so the
      // transcript reflects that a message existed.
      line = JSON.stringify({ _transcript: 'unserializable', type: (msg as { type?: string }).type ?? 'unknown' });
    }
    try {
      stream.write(line + '\n');
    } catch {
      // Disk full / EIO — swallow; losing transcript lines shouldn't bring
      // down a run.
    }
  };

  const close = (): Promise<void> => {
    if (closed) return Promise.resolve();
    closed = true;
    return new Promise((resolve) => {
      stream.end(() => resolve());
    });
  };

  return { path, append, close };
}
