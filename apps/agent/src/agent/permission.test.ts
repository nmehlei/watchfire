import { describe, expect, it } from 'vitest';
import { safetyDecisionToPermission } from './permission.js';

describe('safetyDecisionToPermission', () => {
  it('allow → allow with updatedInput', () => {
    const input = { command: 'obs-search --tenant acme' };
    const result = safetyDecisionToPermission({ kind: 'allow' }, input);
    expect(result).toEqual({ behavior: 'allow', updatedInput: input });
  });

  it('soft-block → deny with reason + hint, no interrupt', () => {
    const result = safetyDecisionToPermission(
      { kind: 'soft-block', reason: 'kubectl-as: edit not allowed', hint: 'Use describe.' },
      {},
    );
    expect(result.behavior).toBe('deny');
    if (result.behavior === 'deny') {
      expect(result.message).toContain('Command blocked by safety hook');
      expect(result.message).toContain('kubectl-as: edit not allowed');
      expect(result.message).toContain('Use describe.');
      expect(result.interrupt).toBeUndefined();
    }
  });

  it('soft-block without hint → deny with reason only', () => {
    const result = safetyDecisionToPermission({ kind: 'soft-block', reason: 'unknown tool' }, {});
    expect(result.behavior).toBe('deny');
    if (result.behavior === 'deny') {
      expect(result.message).toContain('unknown tool');
    }
  });

  it('hard-block → deny with interrupt=true and SAFETY VIOLATION prefix', () => {
    const result = safetyDecisionToPermission({ kind: 'hard-block', reason: 'rm -rf detected' }, {});
    expect(result.behavior).toBe('deny');
    if (result.behavior === 'deny') {
      expect(result.message.startsWith('SAFETY VIOLATION')).toBe(true);
      expect(result.message).toContain('rm -rf detected');
      expect(result.interrupt).toBe(true);
    }
  });
});
