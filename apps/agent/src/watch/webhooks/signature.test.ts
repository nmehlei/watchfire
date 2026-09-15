import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyOpenObserveSignature } from './signature.js';

function sign(body: string, secret: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifyOpenObserveSignature', () => {
  it('skips with skipped-override when skip=true', () => {
    const r = verifyOpenObserveSignature('body', undefined, { skip: true });
    expect(r).toEqual({ verified: true, reason: 'skipped-override' });
  });

  it('skips with skipped-no-secret when secret is absent', () => {
    const r = verifyOpenObserveSignature('body', 'sig', {});
    expect(r).toEqual({ verified: true, reason: 'skipped-no-secret' });
  });

  it('rejects when secret set but header absent', () => {
    const r = verifyOpenObserveSignature('body', undefined, { secret: 'k' });
    expect(r).toEqual({ verified: false, reason: 'missing-signature' });
  });

  it('accepts a correct hex signature', () => {
    const body = '{"alert":"x"}';
    const sig = sign(body, 'k');
    expect(verifyOpenObserveSignature(body, sig, { secret: 'k' })).toEqual({
      verified: true,
      reason: 'signature-valid',
    });
  });

  it('accepts "sha256=..." prefixed form', () => {
    const body = '{}';
    const sig = sign(body, 'k');
    expect(
      verifyOpenObserveSignature(body, `sha256=${sig.toUpperCase()}`, { secret: 'k' }),
    ).toEqual({ verified: true, reason: 'signature-valid' });
  });

  it('rejects a bad signature', () => {
    const body = '{}';
    const tampered = sign('different', 'k');
    expect(verifyOpenObserveSignature(body, tampered, { secret: 'k' })).toEqual({
      verified: false,
      reason: 'signature-invalid',
    });
  });

  it('rejects when body tampered with', () => {
    const sig = sign('original', 'k');
    expect(verifyOpenObserveSignature('tampered', sig, { secret: 'k' })).toEqual({
      verified: false,
      reason: 'signature-invalid',
    });
  });

  it('rejects malformed hex', () => {
    const body = '{}';
    const sig = sign(body, 'k');
    expect(
      verifyOpenObserveSignature(body, 'zzz' + sig.slice(3), { secret: 'k' }),
    ).toEqual({ verified: false, reason: 'signature-invalid' });
  });

  it('rejects signature of wrong length', () => {
    expect(
      verifyOpenObserveSignature('body', 'abc', { secret: 'k' }),
    ).toEqual({ verified: false, reason: 'signature-invalid' });
  });
});
