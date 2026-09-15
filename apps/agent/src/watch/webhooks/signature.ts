import { createHmac, timingSafeEqual } from 'node:crypto';

export interface SignatureConfig {
  /** HMAC secret. When absent, verification is treated as opt-out. */
  secret?: string | undefined;
  /** Explicit override — set from IRIS_WEBHOOK_VERIFY=false at startup. */
  skip?: boolean | undefined;
}

export type VerificationResult =
  | { verified: true; reason: 'skipped-no-secret' | 'skipped-override' | 'signature-valid' }
  | { verified: false; reason: 'signature-invalid' | 'missing-signature' };

/**
 * Verify an HMAC-SHA256 webhook signature. Expected signature format:
 * hex-encoded digest, optionally prefixed with "sha256=". Exact OpenObserve
 * header shape to be confirmed when OO is configured to sign.
 *
 * Policy (see specs/05-watch.md §Signature verification):
 *  - skip=true → always skipped (emergency bypass)
 *  - secret absent → skipped with warn reason (dev / pre-rollout mode)
 *  - secret present, header absent → missing-signature (reject)
 *  - signature compared in constant time to prevent timing leaks
 */
export function verifyOpenObserveSignature(
  rawBody: string,
  signature: string | undefined,
  config: SignatureConfig,
): VerificationResult {
  if (config.skip) return { verified: true, reason: 'skipped-override' };
  if (!config.secret) return { verified: true, reason: 'skipped-no-secret' };
  if (!signature) return { verified: false, reason: 'missing-signature' };

  const expectedHex = createHmac('sha256', config.secret).update(rawBody).digest('hex');
  const providedHex = signature.replace(/^sha256=/i, '').trim().toLowerCase();

  if (providedHex.length !== expectedHex.length) {
    return { verified: false, reason: 'signature-invalid' };
  }

  let expectedBuf: Buffer;
  let providedBuf: Buffer;
  try {
    expectedBuf = Buffer.from(expectedHex, 'hex');
    providedBuf = Buffer.from(providedHex, 'hex');
  } catch {
    return { verified: false, reason: 'signature-invalid' };
  }

  if (expectedBuf.length !== providedBuf.length) {
    return { verified: false, reason: 'signature-invalid' };
  }
  if (!timingSafeEqual(expectedBuf, providedBuf)) {
    return { verified: false, reason: 'signature-invalid' };
  }
  return { verified: true, reason: 'signature-valid' };
}
