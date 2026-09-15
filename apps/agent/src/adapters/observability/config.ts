import { loadTenants } from '../../config/tenants.js';
import type { Tenant } from '../../config/types.js';
import type { OpenObserveClientConfig } from './openobserve.js';

/**
 * Read OpenObserve credentials from env. v1 uses one shared basic-auth
 * credential for all tenants — per-tenant tokens are a future spec change.
 * Throws if any required env var is missing.
 */
export function openObserveConfigFromEnv(): OpenObserveClientConfig {
  const url = required('OPENOBSERVE_URL');
  const user = required('OPENOBSERVE_USER');
  const password = required('OPENOBSERVE_PASSWORD');
  const config: OpenObserveClientConfig = { url, user, password };
  const org = process.env['OPENOBSERVE_ORG'];
  if (org) config.org = org;
  return config;
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`missing env var: ${name}`);
  return v;
}

/** Find the configured stream name for a tenant (specs/02-tenants.md). */
export function streamForTenant(tenant: Tenant): string | null {
  for (const s of tenant.systems) {
    if (s.type === 'observability') return s.stream;
  }
  return null;
}

/** Load tenants.yaml from --tenants-path (or default). */
export function loadTenantsFromPath(path: string): Tenant[] {
  return loadTenants(path);
}
