import { describe, expect, it } from 'vitest';
import { ISSUE_CLASSES, isIssueClass } from './types.js';

describe('issue classes', () => {
  it('recognizes build-red', () => {
    expect(isIssueClass('build-red')).toBe(true);
    expect(ISSUE_CLASSES).toContain('build-red');
  });

  it('rejects an unlisted class', () => {
    expect(isIssueClass('not-a-real-class')).toBe(false);
  });
});
