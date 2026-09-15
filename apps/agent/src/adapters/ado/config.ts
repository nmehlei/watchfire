import type { Tenant } from '../../config/types.js';

export interface AdoTenantConfig {
  orgUrl: string;
  project: string;
  /** Name of the env var holding the PAT — never the PAT itself. */
  patEnv: string;
}

/** The tenant's azure_devops system config, or null if it has none. */
export function adoConfigForTenant(tenant: Tenant): AdoTenantConfig | null {
  for (const s of tenant.systems) {
    if (s.type === 'azure_devops') {
      return { orgUrl: s.org_url, project: s.project, patEnv: s.pat_env };
    }
  }
  return null;
}
