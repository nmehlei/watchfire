import { describe, expect, it } from 'vitest';
import { renderObservationTrailers } from './trailer.js';

describe('renderObservationTrailers', () => {
  it('renders one line per measurement', () => {
    const out = renderObservationTrailers('acme', 'check-ssl', [
      { subject: 'api.acme.de', metric: 'days_until_expiry', value: 42 },
      { subject: 'api.acme.de', metric: 'chain_valid', value: 1 },
    ]);

    expect(out.split('\n')).toEqual([
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=api.acme.de metric=days_until_expiry value=42',
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=api.acme.de metric=chain_valid value=1',
    ]);
  });

  it('renders empty string for no measurements', () => {
    // Callers concatenate this onto stdout; an empty list must not add a blank line.
    expect(renderObservationTrailers('acme', 'check-ssl', [])).toBe('');
  });

  it('round-trips through the parser', async () => {
    const { parseObservationTrailers } = await import('../agent/trailer.js');
    const rendered = renderObservationTrailers('globex', 'check-http', [
      { subject: 'app', metric: 'response_ms', value: 120.5 },
    ]);

    expect(parseObservationTrailers(rendered)).toEqual([
      {
        tenant: 'globex',
        source: 'check-http',
        subject: 'app',
        metric: 'response_ms',
        value: 120.5,
      },
    ]);
  });

  it('omits measurements whose value is not finite', () => {
    // A probe that failed has no measurement; emitting NaN would poison baselines.
    const out = renderObservationTrailers('acme', 'check-http', [
      { subject: 'a', metric: 'response_ms', value: Number.NaN },
      { subject: 'b', metric: 'response_ms', value: 200 },
    ]);

    expect(out).toBe('___WATCHFIRE_OBS: tenant=acme source=check-http subject=b metric=response_ms value=200');
  });
});
