import { describe, expect, it } from 'vitest';
import type { Tenant } from '../../config/types.js';
import { adoConfigForTenant } from './config.js';

function tenant(systems: Tenant['systems']): Tenant {
  return { id: 'acme', display_name: 'ACME', systems };
}

const adoSystem = {
  type: 'azure_devops',
  org_url: 'https://dev.azure.com/org',
  project: 'Proj',
  pat_env: 'ADO_PAT_ACME',
} as const;

describe('adoConfigForTenant', () => {
  it('returns the ado config when the tenant has one', () => {
    expect(adoConfigForTenant(tenant([adoSystem]))).toEqual({
      orgUrl: 'https://dev.azure.com/org',
      project: 'Proj',
      patEnv: 'ADO_PAT_ACME',
    });
  });

  it('finds the ado config among other systems', () => {
    expect(adoConfigForTenant(tenant([{ type: 'ssl', hosts: [] }, adoSystem]))).not.toBeNull();
  });

  it('returns null when the tenant has no azure_devops system', () => {
    expect(adoConfigForTenant(tenant([{ type: 'ssl', hosts: [] }]))).toBeNull();
  });

  it('returns null for a tenant with no systems at all', () => {
    expect(adoConfigForTenant(tenant([]))).toBeNull();
  });
});
