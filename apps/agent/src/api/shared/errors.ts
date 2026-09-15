import type { ApiErrorCode } from './types.js';

export function httpStatusFor(code: ApiErrorCode): number {
  switch (code) {
    case 'unauthorized':     return 401;
    case 'not_found':        return 404;
    case 'ambiguous':        return 409;
    case 'invalid_argument': return 400;
    case 'internal':         return 500;
  }
}
