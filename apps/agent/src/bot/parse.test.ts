import { describe, expect, it } from 'vitest';
import { parseCommand } from './parse.js';

describe('parseCommand', () => {
  it('rejects non-command text', () => {
    expect(parseCommand('hello there')).toEqual({ kind: 'not-a-command' });
  });

  it('strips @bot suffix from the command word', () => {
    expect(parseCommand('/help@watchfire_bot')).toEqual({ kind: 'help' });
  });

  it('treats /start as help', () => {
    expect(parseCommand('/start')).toEqual({ kind: 'help' });
  });

  it('routes /mutes', () => {
    expect(parseCommand('/mutes')).toEqual({ kind: 'mutes' });
  });

  it('flags unknown commands', () => {
    expect(parseCommand('/wat')).toEqual({ kind: 'unknown', raw: '/wat' });
  });

  describe('/mute', () => {
    it('errors on missing id', () => {
      const r = parseCommand('/mute');
      expect(r.kind).toBe('usage-error');
    });

    it('defaults duration to 7d', () => {
      expect(parseCommand('/mute 9b9896')).toEqual({
        kind: 'mute',
        id: '9b9896',
        duration: '7d',
        reason: null,
      });
    });

    it('parses explicit duration', () => {
      expect(parseCommand('/mute 9b9896 30d')).toEqual({
        kind: 'mute',
        id: '9b9896',
        duration: '30d',
        reason: null,
      });
    });

    it('parses reason after --', () => {
      expect(parseCommand('/mute 9b9896 forever -- public IP, brute force')).toEqual({
        kind: 'mute',
        id: '9b9896',
        duration: 'forever',
        reason: 'public IP, brute force',
      });
    });

    it('parses reason without explicit duration', () => {
      expect(parseCommand('/mute 9b9896 -- noisy')).toEqual({
        kind: 'mute',
        id: '9b9896',
        duration: '7d',
        reason: 'noisy',
      });
    });

    it('rejects bad duration with usage error', () => {
      const r = parseCommand('/mute 9b9896 5d');
      expect(r.kind).toBe('usage-error');
      if (r.kind === 'usage-error') expect(r.message).toContain('Duration must be');
    });

    it('rejects extra positional args', () => {
      const r = parseCommand('/mute 9b9896 7d extra');
      expect(r.kind).toBe('usage-error');
    });

    it('escapes HTML in error reply', () => {
      const r = parseCommand('/mute 9b9896 <bad>');
      expect(r.kind).toBe('usage-error');
      if (r.kind === 'usage-error') expect(r.message).toContain('&lt;bad&gt;');
    });
  });

  describe('/unmute', () => {
    it('parses id', () => {
      expect(parseCommand('/unmute 9b9896')).toEqual({ kind: 'unmute', id: '9b9896' });
    });

    it('errors on missing id', () => {
      expect(parseCommand('/unmute').kind).toBe('usage-error');
    });

    it('errors on extra args', () => {
      expect(parseCommand('/unmute 9b9896 extra').kind).toBe('usage-error');
    });
  });
});
