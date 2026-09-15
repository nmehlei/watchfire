import { describe, expect, it } from 'vitest';
import { ADAPTER_REGISTRY, emitsObservations } from './registry.js';

describe('adapter registry', () => {
  it('marks the probe adapters as emitting observations', () => {
    expect(emitsObservations('check-ssl')).toBe(true);
    expect(emitsObservations('check-http')).toBe(true);
  });

  it('marks the observability adapters as not emitting', () => {
    // They query a telemetry system that keeps its own history; re-recording
    // counts from it would store a measurement of a measurement (spec 03).
    expect(emitsObservations('obs-search')).toBe(false);
    expect(emitsObservations('obs-streams')).toBe(false);
  });

  it('registers check-ado as a non-emitting adapter', () => {
    expect(emitsObservations('check-ado')).toBe(false);
    expect(ADAPTER_REGISTRY.map((a) => a.name)).toContain('check-ado');
  });

  it('treats an unknown adapter as not emitting', () => {
    // Unknown adapters must not render as "stale telemetry" on the dashboard.
    expect(emitsObservations('not-a-real-adapter')).toBe(false);
  });

  it('lists every adapter exactly once', () => {
    const names = ADAPTER_REGISTRY.map((a) => a.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
