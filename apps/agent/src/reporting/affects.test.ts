import { describe, expect, it } from 'vitest';
import type { ResourceGraph } from '../config/types.js';
import { expandAffects } from './affects.js';

const graph: ResourceGraph = {
  resources: [
    { id: 'sql.acme.internal', type: 'mssql-server', owner: 'acme', affects: ['acme', 'globex', 'initech'] },
    { id: 'mail.acme.example', type: 'smtp-relay', owner: 'acme', affects: ['acme', 'globex', 'initech', 'umbrella'] },
  ],
};

const KNOWN = ['acme', 'globex', 'initech', 'umbrella'];

describe('expandAffects', () => {
  it('returns affects list from the graph for a known resource', () => {
    expect(expandAffects('sql.acme.internal', graph)).toEqual(['acme', 'globex', 'initech']);
  });

  it('canonicalizes resource_id before lookup', () => {
    expect(expandAffects('  SQL.ACME.Internal  ', graph)).toEqual(['acme', 'globex', 'initech']);
  });

  it('handles tenant:<id> reserved prefix', () => {
    expect(expandAffects('tenant:globex', graph)).toEqual(['globex']);
  });

  it('handles global with known-tenants fallback', () => {
    expect(expandAffects('global', graph, { knownTenants: KNOWN })).toEqual([
      'acme',
      'globex',
      'initech',
      'umbrella',
    ]);
  });

  it('global with no fallback → [?]', () => {
    expect(expandAffects('global', graph)).toEqual(['?']);
  });

  it('derives owner from hostname naming', () => {
    expect(expandAffects('api.globex.app', graph, { knownTenants: KNOWN })).toEqual(['globex']);
  });

  it('does not match partial tenant slug', () => {
    // "acmemo.local" should NOT match "acme" — requires full label boundary.
    expect(expandAffects('acmemo.local', graph, { knownTenants: KNOWN })).toEqual(['?']);
  });

  it('falls back to runContextTenant when nothing derives', () => {
    expect(
      expandAffects('weird-thing-xyz', graph, {
        knownTenants: KNOWN,
        runContextTenant: 'acme',
      }),
    ).toEqual(['acme']);
  });

  it('returns [?] when nothing derives and no fallback', () => {
    expect(expandAffects('weird-thing-xyz', graph)).toEqual(['?']);
  });
});
