import { describe, expect, it } from 'vitest';
import { tenantScopePhrase } from './tenant-scope.js';

describe('tenantScopePhrase', () => {
  it('renders several tenants with a count', () => {
    expect(tenantScopePhrase(['acme', 'globex', 'initech'])).toBe(
      '3 tenants (acme, globex, initech)',
    );
  });

  it('uses the singular for one tenant', () => {
    expect(tenantScopePhrase(['acme'])).toBe('1 tenant (acme)');
  });

  it('handles an empty registry', () => {
    expect(tenantScopePhrase([])).toBe('no configured tenants');
  });
});
