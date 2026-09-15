import { describe, expect, it } from 'vitest';
import {
  createConcludeWatchTool,
  createWatchVerdictSlot,
} from './conclude-watch.js';

async function callHandler(
  tool: ReturnType<typeof createConcludeWatchTool>,
  args: Parameters<(typeof tool)['handler']>[0],
): Promise<ReturnType<(typeof tool)['handler']>> {
  return tool.handler(args, {});
}

describe('createConcludeWatchTool', () => {
  it('records the verdict + reason on first call', async () => {
    const slot = createWatchVerdictSlot();
    const t = createConcludeWatchTool(slot);
    const result = await callHandler(t, { verdict: 'page', reason: 'critical threshold crossed' });
    expect(result.isError).toBeFalsy();
    expect(slot.verdict).toBe('page');
    expect(slot.reason).toBe('critical threshold crossed');
    expect(slot.calls).toBe(1);
  });

  it('subsequent calls do not overwrite and return isError=true', async () => {
    const slot = createWatchVerdictSlot();
    const t = createConcludeWatchTool(slot);
    await callHandler(t, { verdict: 'page', reason: 'first' });
    const second = await callHandler(t, { verdict: 'defer', reason: 'second' });
    expect(second.isError).toBe(true);
    expect(slot.verdict).toBe('page');
    expect(slot.reason).toBe('first');
    expect(slot.calls).toBe(2);
  });

  it('accepts each of the three verdicts', async () => {
    for (const v of ['page', 'defer', 'drop'] as const) {
      const slot = createWatchVerdictSlot();
      const t = createConcludeWatchTool(slot);
      await callHandler(t, { verdict: v, reason: 'r' });
      expect(slot.verdict).toBe(v);
    }
  });

  it('tool name is conclude_watch', () => {
    const slot = createWatchVerdictSlot();
    const t = createConcludeWatchTool(slot);
    expect(t.name).toBe('conclude_watch');
  });
});
