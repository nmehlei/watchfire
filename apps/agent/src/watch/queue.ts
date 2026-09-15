export interface QueueConfig {
  /** Max number of items queued (not yet processed). Default 10 per spec 05. */
  maxDepth?: number;
}

type Processor<T> = (payload: T) => Promise<void>;

/**
 * Bounded in-process serial queue. Items are processed one at a time, FIFO.
 * enqueue() returns false when the queue is full; the HTTP handler answers
 * 429 + Retry-After when that happens.
 *
 * Processor errors are swallowed so a single bad payload doesn't freeze the
 * queue. Processors are expected to record their own failures (runs.error).
 */
export class BoundedSerialQueue<T> {
  private items: T[] = [];
  private running = false;
  private readonly maxDepth: number;

  constructor(
    private readonly processor: Processor<T>,
    config: QueueConfig = {},
  ) {
    this.maxDepth = config.maxDepth ?? 10;
  }

  get depth(): number {
    return this.items.length + (this.running ? 1 : 0);
  }

  get busy(): boolean {
    return this.running;
  }

  /** Returns false if the queue is at capacity. */
  enqueue(payload: T): boolean {
    if (this.depth >= this.maxDepth) return false;
    this.items.push(payload);
    void this.drain();
    return true;
  }

  /** For tests: resolves once the queue is empty and no processor is in flight. */
  async idle(): Promise<void> {
    while (this.running || this.items.length > 0) {
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }

  private async drain(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      while (this.items.length > 0) {
        const item = this.items.shift() as T;
        try {
          await this.processor(item);
        } catch {
          // Swallow: processor owns its error reporting.
        }
      }
    } finally {
      this.running = false;
    }
  }
}
