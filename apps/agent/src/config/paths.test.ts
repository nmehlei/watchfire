import { describe, expect, it } from 'vitest';
import { defaultTenantsPath } from './paths.js';

describe('defaultTenantsPath', () => {
  it('prefers WATCHFIRE_TENANTS_PATH when set', () => {
    expect(defaultTenantsPath({ WATCHFIRE_TENANTS_PATH: '/etc/watchfire/config/tenants.yaml' })).toBe(
      '/etc/watchfire/config/tenants.yaml',
    );
  });

  it('falls back to the repo-relative default when unset', () => {
    expect(defaultTenantsPath({})).toBe('config/tenants.yaml');
  });

  it('treats an empty value as unset', () => {
    expect(defaultTenantsPath({ WATCHFIRE_TENANTS_PATH: '' })).toBe('config/tenants.yaml');
  });
});
