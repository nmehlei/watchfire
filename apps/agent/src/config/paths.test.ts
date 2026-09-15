import { describe, expect, it } from 'vitest';
import { defaultTenantsPath } from './paths.js';

describe('defaultTenantsPath', () => {
  it('prefers IRIS_TENANTS_PATH when set', () => {
    expect(defaultTenantsPath({ IRIS_TENANTS_PATH: '/etc/iris/config/tenants.yaml' })).toBe(
      '/etc/iris/config/tenants.yaml',
    );
  });

  it('falls back to the repo-relative default when unset', () => {
    expect(defaultTenantsPath({})).toBe('config/tenants.yaml');
  });

  it('treats an empty value as unset', () => {
    expect(defaultTenantsPath({ IRIS_TENANTS_PATH: '' })).toBe('config/tenants.yaml');
  });
});
