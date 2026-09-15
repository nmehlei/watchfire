import { describe, expect, it } from 'vitest';
import { canonicalizeResourceId, fingerprint } from './fingerprint.js';

describe('canonicalizeResourceId', () => {
  it('lowercases and trims', () => {
    expect(canonicalizeResourceId('  SQL.ACME.Internal  ')).toBe('sql.acme.internal');
  });

  it('elides trailing port numbers', () => {
    expect(canonicalizeResourceId('api.initech.io:443')).toBe('api.initech.io');
    expect(canonicalizeResourceId('sql.acme.internal:1433')).toBe('sql.acme.internal');
  });

  it('elides ports before path separator', () => {
    expect(canonicalizeResourceId('api.initech.io:443/health')).toBe('api.initech.io/health');
  });

  it('does not strip colons in identifier-like contexts', () => {
    expect(canonicalizeResourceId('pod:api-7f9c')).toBe('pod:api-7f9c');
  });

  it('passes through tenant: prefix (lowercased)', () => {
    expect(canonicalizeResourceId('tenant:ACME')).toBe('tenant:acme');
  });

  it('passes through global', () => {
    expect(canonicalizeResourceId('global')).toBe('global');
  });

  it('is idempotent', () => {
    const once = canonicalizeResourceId('API.Initech.IO:443');
    const twice = canonicalizeResourceId(once);
    expect(once).toBe(twice);
  });
});

describe('fingerprint', () => {
  it('is deterministic', () => {
    expect(fingerprint('sql.acme.internal', 'disk-pressure')).toBe(
      fingerprint('sql.acme.internal', 'disk-pressure'),
    );
  });

  it('returns 64 hex chars', () => {
    expect(fingerprint('x', 'disk-pressure')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs by resource_id', () => {
    expect(fingerprint('a', 'disk-pressure')).not.toBe(fingerprint('b', 'disk-pressure'));
  });

  it('differs by issue_class', () => {
    expect(fingerprint('x', 'disk-pressure')).not.toBe(fingerprint('x', 'cert-expiry'));
  });

  it('collapses canonicalization-equivalent inputs', () => {
    expect(fingerprint('SQL.ACME.Internal', 'disk-pressure')).toBe(
      fingerprint('sql.acme.internal', 'disk-pressure'),
    );
    expect(fingerprint('api.initech.io:443', 'cert-expiry')).toBe(
      fingerprint('api.initech.io', 'cert-expiry'),
    );
  });

  it('null separator defends against join ambiguity', () => {
    // Without the \0 separator, ("a", "b") and ("ab", "") would collide.
    expect(fingerprint('a', 'b')).not.toBe(fingerprint('ab', ''));
  });
});
