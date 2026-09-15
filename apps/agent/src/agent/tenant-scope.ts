/**
 * How the agent describes its own scope in the system prompt. Derived from
 * the loaded registry so the prompt cannot drift from the configuration —
 * a hardcoded list silently lies to the model when tenants change.
 */
export function tenantScopePhrase(ids: readonly string[]): string {
  if (ids.length === 0) return 'no configured tenants';
  const noun = ids.length === 1 ? 'tenant' : 'tenants';
  return `${ids.length} ${noun} (${ids.join(', ')})`;
}
