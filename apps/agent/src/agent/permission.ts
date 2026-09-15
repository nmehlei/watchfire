import type { SafetyDecision } from './safety.js';

/**
 * The subset of the SDK's PermissionResult we produce. Defined locally so the
 * adapter is unit-testable without importing the SDK's runtime.
 */
export type PermissionResult =
  | { behavior: 'allow'; updatedInput?: Record<string, unknown> }
  | { behavior: 'deny'; message: string; interrupt?: boolean };

/**
 * Adapt our SafetyDecision to the SDK's PermissionResult.
 *
 * - allow → allow
 * - soft-block → deny with `hint` appended, no interrupt (agent can retry)
 * - hard-block → deny with `interrupt: true` (terminates the agent loop)
 */
export function safetyDecisionToPermission(
  decision: SafetyDecision,
  toolInput: Record<string, unknown>,
): PermissionResult {
  if (decision.kind === 'allow') {
    return { behavior: 'allow', updatedInput: toolInput };
  }
  if (decision.kind === 'soft-block') {
    const hint = decision.hint ? ` ${decision.hint}` : '';
    return {
      behavior: 'deny',
      message: `Command blocked by safety hook: ${decision.reason}.${hint}`,
    };
  }
  return {
    behavior: 'deny',
    message: `SAFETY VIOLATION: ${decision.reason}`,
    interrupt: true,
  };
}
