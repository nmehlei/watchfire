import { EventEmitter } from 'node:events';
import type { FindingState } from '../../memory/types.js';

export const DEBOUNCE_MS = 5_000;

export interface WatchfireEventPayload {
  'nightly.completed': { runId: number; status: string };
  'watch.completed': { runId: number; verdict: string | null; pageSent: boolean };
  'mute.created': { fingerprint: string };
  'mute.deleted': { fingerprint: string };
  'finding.upserted': { fingerprint: string; state: FindingState };
}

export type WatchfireEventName = keyof WatchfireEventPayload;

/**
 * Singleton-friendly event emitter for spec 11 v2 SSE. Process-local;
 * each listener (one per active SSE client) receives every event.
 *
 * `finding.upserted` is debounced per fingerprint over a 5-second window —
 * agent runs do many upserts in fast succession, and dashboard clients
 * just need "this fingerprint changed; refetch" once per window.
 */
export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly pending = new Map<string, { state: FindingState; timer: NodeJS.Timeout }>();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  on<E extends WatchfireEventName>(event: E, listener: (payload: WatchfireEventPayload[E]) => void): void {
    this.emitter.on(event, listener);
  }

  off<E extends WatchfireEventName>(event: E, listener: (payload: WatchfireEventPayload[E]) => void): void {
    this.emitter.off(event, listener);
  }

  emit<E extends Exclude<WatchfireEventName, 'finding.upserted'>>(
    event: E,
    payload: WatchfireEventPayload[E],
  ): void {
    this.emitter.emit(event, payload);
  }

  emitFindingUpserted(fingerprint: string, state: FindingState): void {
    const existing = this.pending.get(fingerprint);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      const entry = this.pending.get(fingerprint);
      if (!entry) return;
      this.pending.delete(fingerprint);
      this.emitter.emit('finding.upserted', { fingerprint, state: entry.state });
    }, DEBOUNCE_MS);
    this.pending.set(fingerprint, { state, timer });
  }

  /** Test/teardown helper. */
  reset(): void {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
    }
    this.pending.clear();
    this.emitter.removeAllListeners();
  }
}

let singleton: EventBus | null = null;

export function getEventBus(): EventBus {
  if (!singleton) singleton = new EventBus();
  return singleton;
}

/** Test helper: replace the singleton (and reset the previous). */
export function _setEventBusForTests(bus: EventBus | null): void {
  if (singleton) singleton.reset();
  singleton = bus;
}
