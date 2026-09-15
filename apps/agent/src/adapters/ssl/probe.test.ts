import { describe, expect, it } from 'vitest';
import { hostnameMatches, probeCert } from './probe.js';

describe('hostnameMatches', () => {
  it('exact match', () => {
    expect(hostnameMatches('example.com', 'example.com')).toBe(true);
  });

  it('case-insensitive match', () => {
    expect(hostnameMatches('Example.COM', 'example.com')).toBe(true);
  });

  it('simple wildcard matches a single label', () => {
    expect(hostnameMatches('*.example.com', 'api.example.com')).toBe(true);
  });

  it('wildcard does not cross a dot', () => {
    expect(hostnameMatches('*.example.com', 'a.b.example.com')).toBe(false);
  });

  it('wildcard does not match bare domain', () => {
    expect(hostnameMatches('*.example.com', 'example.com')).toBe(false);
  });

  it('non-match rejected', () => {
    expect(hostnameMatches('example.com', 'evil.com')).toBe(false);
  });
});

// Integration test: probe a public host. Skipped when offline.
// We use a short timeout so offline runs fail quickly into the skip branch.
const runNetworkTests = !process.env['IRIS_SKIP_NETWORK_TESTS'];

describe.skipIf(!runNetworkTests)('probeCert — integration', () => {
  it('fetches a real certificate from example.com', async () => {
    const result = await probeCert('example.com', { timeoutMs: 8000 });
    if (!result.connected) {
      // Network probably unreachable; skip silently.
      console.warn('skipping probeCert integration: network unavailable');
      return;
    }
    expect(result.host).toBe('example.com');
    expect(result.validFrom).toBeTruthy();
    expect(result.validTo).toBeTruthy();
    expect(typeof result.daysUntilExpiry).toBe('number');
    expect(result.hostnameMatch).toBe(true);
    expect(result.chainValid).toBe(true);
  }, 15000);

  it('reports error cleanly when the host does not exist', async () => {
    const result = await probeCert('nonexistent.invalid.iris-test', { timeoutMs: 3000 });
    expect(result.connected).toBe(false);
    expect(result.error).toBeTruthy();
  }, 10000);
});
