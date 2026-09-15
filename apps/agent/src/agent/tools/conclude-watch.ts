import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import type { WatchVerdict } from '../../memory/index.js';

export const CONCLUDE_WATCH_TOOL_NAME = 'conclude_watch';

/**
 * Mutable slot — the tool handler writes the verdict here; the runner reads
 * it after the agent loop ends. One per run.
 */
export interface WatchVerdictSlot {
  verdict: WatchVerdict | null;
  reason: string | null;
  calls: number;
}

export function createWatchVerdictSlot(): WatchVerdictSlot {
  return { verdict: null, reason: null, calls: 0 };
}

/**
 * Watch-mode tool. The agent calls it exactly once with page/defer/drop.
 * Additional calls are ignored (with an error content) to keep the slot
 * deterministic.
 */
export function createConcludeWatchTool(slot: WatchVerdictSlot) {
  return tool(
    CONCLUDE_WATCH_TOOL_NAME,
    'Issue your watch verdict: page (🚨 operator), defer (next nightly picks it up), or drop (noise). Call exactly once per run.',
    {
      verdict: z.enum(['page', 'defer', 'drop']).describe('Your conclusion.'),
      reason: z.string().min(1).max(200).describe('One-sentence reason (<=200 chars).'),
    },
    async (args) => {
      slot.calls += 1;

      if (slot.verdict !== null) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `conclude-watch already called (verdict=${slot.verdict}); ignoring subsequent call.`,
            },
          ],
          isError: true,
        };
      }

      slot.verdict = args.verdict;
      slot.reason = args.reason;
      return {
        content: [{ type: 'text' as const, text: `verdict recorded: ${args.verdict}` }],
      };
    },
  );
}
