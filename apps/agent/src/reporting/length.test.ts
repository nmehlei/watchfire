import { describe, expect, it } from 'vitest';
import { splitForTelegram } from './length.js';

describe('splitForTelegram', () => {
  it('returns the message unchanged if under the limit', () => {
    expect(splitForTelegram('short', 100)).toEqual(['short']);
  });

  it('splits at section boundaries', () => {
    const section = (name: string, body: string) => `━ ${name} ━ (1)\n${body}`;
    const msg = [
      '🌙 Nightly digest',
      '',
      section('New', 'x'.repeat(500)),
      '',
      section('Ongoing', 'y'.repeat(500)),
      '',
      section('Cleared', 'z'.repeat(500)),
    ].join('\n');
    const parts = splitForTelegram(msg, 900);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(900);
    }
  });

  it('splits oversized sections at paragraph boundaries', () => {
    const big = `━ Big ━ (100)\n` + Array(30).fill('x'.repeat(100)).join('\n\n');
    const parts = splitForTelegram(big, 500);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(500);
    }
  });

  it('truncates a paragraph bigger than the limit', () => {
    const oneLine = 'x'.repeat(5000);
    const parts = splitForTelegram(oneLine, 500);
    expect(parts.length).toBe(1);
    expect(parts[0]!.length).toBeLessThanOrEqual(500);
    expect(parts[0]!).toContain('[truncated');
  });
});
