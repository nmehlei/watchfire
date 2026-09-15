import { timingSafeEqual } from 'node:crypto';

const PREFIX = 'Bearer ';

/**
 * Returns true iff the Authorization header carries a bearer token that exactly
 * matches `expected`. Constant-time compare. Empty `expected` always returns
 * false so accidentally unset config can't degrade into "any token works".
 */
export function verifyBearer(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue || !expected) return false;
  if (!headerValue.startsWith(PREFIX)) return false;
  const provided = headerValue.slice(PREFIX.length);
  if (provided.length === 0) return false;

  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
