/**
 * Where the adapter CLIs look for the tenant registry when `--tenants-path`
 * is not given. Production mounts the registry outside the image and points
 * WATCHFIRE_TENANTS_PATH at it; the repo-relative default is the dev fallback.
 */
export function defaultTenantsPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env['WATCHFIRE_TENANTS_PATH'];
  return fromEnv && fromEnv.length > 0 ? fromEnv : 'config/tenants.yaml';
}
