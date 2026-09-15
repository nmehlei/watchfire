import { describe, expect, it } from 'vitest';
import { httpStatusFor } from './errors.js';

describe('httpStatusFor', () => {
  it.each([
    ['unauthorized', 401],
    ['not_found', 404],
    ['ambiguous', 409],
    ['invalid_argument', 400],
    ['internal', 500],
  ] as const)('%s → %s', (code, status) => {
    expect(httpStatusFor(code)).toBe(status);
  });
});
