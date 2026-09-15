import { describe, expect, it } from 'vitest';
import { verifyBearer } from './auth.js';

describe('verifyBearer', () => {
  it('returns true on exact match', () => {
    expect(verifyBearer('Bearer abc123', 'abc123')).toBe(true);
  });
  it('returns false on token mismatch', () => {
    expect(verifyBearer('Bearer xyz', 'abc123')).toBe(false);
  });
  it('returns false on missing header', () => {
    expect(verifyBearer(undefined, 'abc123')).toBe(false);
  });
  it('returns false on malformed header', () => {
    expect(verifyBearer('Token abc123', 'abc123')).toBe(false);
    expect(verifyBearer('Bearer ', 'abc123')).toBe(false);
  });
  it('returns false when expected token is empty', () => {
    expect(verifyBearer('Bearer abc123', '')).toBe(false);
  });
});
