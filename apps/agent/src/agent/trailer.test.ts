import { describe, expect, it } from 'vitest';
import { parseObservationTrailers } from './trailer.js';

describe('parseObservationTrailers', () => {
  it('parses a single trailer line', () => {
    const out = parseObservationTrailers(
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=api.acme.de metric=days_until_expiry value=42',
    );

    expect(out).toEqual([
      {
        tenant: 'acme',
        source: 'check-ssl',
        subject: 'api.acme.de',
        metric: 'days_until_expiry',
        value: 42,
      },
    ]);
  });

  it('ignores human-readable output around trailers', () => {
    const stdout = [
      'api.acme.de',
      '  Issuer:    Lets Encrypt',
      '  Valid:     2026-05-01 → 2026-08-30 (42 days remaining)',
      '',
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=api.acme.de metric=days_until_expiry value=42',
    ].join('\n');

    expect(parseObservationTrailers(stdout)).toHaveLength(1);
  });

  it('parses multiple trailers in order', () => {
    const stdout = [
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=a metric=response_ms value=120',
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=b metric=response_ms value=2100',
    ].join('\n');

    expect(parseObservationTrailers(stdout).map((o) => o.value)).toEqual([120, 2100]);
  });

  it('accepts negative and fractional values', () => {
    const out = parseObservationTrailers(
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=expired.acme.de metric=days_until_expiry value=-3.5',
    );

    expect(out[0]!.value).toBe(-3.5);
  });

  it('returns nothing for output with no trailers', () => {
    expect(parseObservationTrailers('all ok\nnothing to report')).toEqual([]);
  });

  it('drops trailers missing a required field', () => {
    // No `metric=` — unusable, must not become a half-populated row.
    expect(
      parseObservationTrailers('___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=a value=1'),
    ).toEqual([]);
  });

  it('drops trailers missing source', () => {
    // The runner cannot infer the adapter from a tool result, so an
    // unattributed measurement has nowhere to go.
    expect(parseObservationTrailers('___WATCHFIRE_OBS: tenant=acme subject=a metric=m value=1')).toEqual(
      [],
    );
  });

  it('drops trailers whose value is not a number', () => {
    expect(
      parseObservationTrailers('___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=a metric=m value=fast'),
    ).toEqual([]);
  });

  it('keeps valid trailers when a sibling line is malformed', () => {
    // Telemetry is best-effort: one bad line must not discard the good ones.
    const stdout = [
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=a metric=response_ms value=oops',
      '___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=b metric=response_ms value=200',
    ].join('\n');

    expect(parseObservationTrailers(stdout)).toEqual([
      { tenant: 'acme', source: 'check-ssl', subject: 'b', metric: 'response_ms', value: 200 },
    ]);
  });

  it('tolerates surrounding whitespace and CRLF line endings', () => {
    const out = parseObservationTrailers(
      '  ___WATCHFIRE_OBS: tenant=acme source=check-ssl subject=a metric=m value=1  \r\n',
    );

    expect(out).toHaveLength(1);
  });
});
