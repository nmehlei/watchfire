import { describe, expect, it } from 'vitest';
import { loadResources, loadTenants } from './tenants.js';

describe('committed example config', () => {
  it('config/tenants.example.yaml parses and lists the example tenants', () => {
    const tenants = loadTenants('config/tenants.example.yaml');
    const ids = tenants.map((t) => t.id).sort();
    expect(ids).toEqual(['acme', 'globex', 'initech', 'umbrella']);
  });

  it('config/resources.example.yaml parses and lists cross-tenant resources', () => {
    const { resources } = loadResources('config/resources.example.yaml');
    expect(resources.length).toBeGreaterThan(0);
    for (const r of resources) {
      expect(r.affects.length).toBeGreaterThan(0);
    }
  });
});
