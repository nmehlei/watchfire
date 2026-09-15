import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEBOUNCE_MS, EventBus } from './bus.js';

describe('EventBus', () => {
  afterEach(() => vi.useRealTimers());

  it('emits non-finding events immediately', () => {
    const bus = new EventBus();
    const sink = vi.fn();
    bus.on('nightly.completed', sink);
    bus.emit('nightly.completed', { runId: 1, status: 'success' });
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({ runId: 1, status: 'success' });
  });

  it('debounces finding.upserted per fingerprint over the window', () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const sink = vi.fn();
    bus.on('finding.upserted', sink);
    bus.emitFindingUpserted('aaa', 'new');
    bus.emitFindingUpserted('aaa', 'ongoing');
    bus.emitFindingUpserted('aaa', 'ongoing');
    expect(sink).not.toHaveBeenCalled();
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(sink).toHaveBeenCalledTimes(1);
    expect(sink).toHaveBeenCalledWith({ fingerprint: 'aaa', state: 'ongoing' });
  });

  it('different fingerprints debounce independently', () => {
    vi.useFakeTimers();
    const bus = new EventBus();
    const sink = vi.fn();
    bus.on('finding.upserted', sink);
    bus.emitFindingUpserted('aaa', 'new');
    bus.emitFindingUpserted('bbb', 'new');
    vi.advanceTimersByTime(DEBOUNCE_MS);
    expect(sink).toHaveBeenCalledTimes(2);
  });

  it('off() removes listener', () => {
    const bus = new EventBus();
    const sink = vi.fn();
    bus.on('mute.created', sink);
    bus.off('mute.created', sink);
    bus.emit('mute.created', { fingerprint: 'aaa' });
    expect(sink).not.toHaveBeenCalled();
  });
});
