import { describe, expect, it } from 'vitest';
import { esc, shortId } from './html.js';

describe('esc', () => {
  it('escapes <, >, &', () => {
    expect(esc('a<b>c&d')).toBe('a&lt;b&gt;c&amp;d');
  });

  it("does not escape ' or \"", () => {
    expect(esc(`it's "fine"`)).toBe(`it's "fine"`);
  });

  it('handles empty string', () => {
    expect(esc('')).toBe('');
  });

  it('order matters — & escapes before any < / > to avoid double-encoding', () => {
    expect(esc('&lt;')).toBe('&amp;lt;');
  });
});

describe('shortId', () => {
  it('first 6 chars', () => {
    expect(shortId('9b9896abcdef0123')).toBe('9b9896');
  });
});
