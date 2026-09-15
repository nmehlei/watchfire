import { describe, expect, it } from 'vitest';
import { BoundedSerialQueue } from './queue.js';

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('BoundedSerialQueue', () => {
  it('processes items FIFO', async () => {
    const seen: number[] = [];
    const q = new BoundedSerialQueue<number>(async (n) => {
      seen.push(n);
    });
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    await q.idle();
    expect(seen).toEqual([1, 2, 3]);
  });

  it('returns false when over maxDepth', async () => {
    // Block processor until we release it, so we can queue to cap.
    const gate = deferred();
    const q = new BoundedSerialQueue<number>(async () => {
      await gate.promise;
    }, { maxDepth: 3 });

    expect(q.enqueue(1)).toBe(true);   // enters processor
    expect(q.enqueue(2)).toBe(true);   // enters queue, depth=2
    expect(q.enqueue(3)).toBe(true);   // depth=3 (running counts)
    expect(q.enqueue(4)).toBe(false);  // over — reject

    gate.resolve();
    await q.idle();
  });

  it('resumes accepting after drain', async () => {
    const gate1 = deferred();
    let gateCount = 0;
    const q = new BoundedSerialQueue<number>(async () => {
      gateCount++;
      if (gateCount === 1) await gate1.promise;
    }, { maxDepth: 2 });

    q.enqueue(1);
    q.enqueue(2);
    expect(q.enqueue(3)).toBe(false);

    gate1.resolve();
    await q.idle();

    expect(q.enqueue(4)).toBe(true);
    await q.idle();
    expect(gateCount).toBe(3);
  });

  it('continues draining after a processor throws', async () => {
    const seen: number[] = [];
    const q = new BoundedSerialQueue<number>(async (n) => {
      if (n === 2) throw new Error('boom');
      seen.push(n);
    });
    q.enqueue(1);
    q.enqueue(2);
    q.enqueue(3);
    await q.idle();
    expect(seen).toEqual([1, 3]);
  });

  it('depth counts in-flight + queued', async () => {
    const gate = deferred();
    const q = new BoundedSerialQueue<number>(async () => {
      await gate.promise;
    });
    q.enqueue(1);
    q.enqueue(2);
    expect(q.depth).toBe(2);
    gate.resolve();
    await q.idle();
    expect(q.depth).toBe(0);
  });
});
