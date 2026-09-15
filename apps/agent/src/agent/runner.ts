import {
  createSdkMcpServer,
  query,
  type CanUseTool,
  type Options,
  type SdkMcpToolDefinition,
  type SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';
import { appendObservation, type Db } from '../memory/index.js';
import type { WatchVerdict } from '../memory/index.js';
import { OBS_TRAILER_PREFIX, parseObservationTrailers } from './trailer.js';
import { safetyDecisionToPermission } from './permission.js';
import { checkBashCommand } from './safety.js';
import { createConcludeWatchTool, createWatchVerdictSlot } from './tools/conclude-watch.js';
import { createEmitFindingTool } from './tools/emit-finding.js';
import { openTranscript } from './transcript.js';

export type AgentMode = 'nightly' | 'watch';

export interface RunAgentInput {
  db: Db;
  runId: number;
  mode: AgentMode;
  systemPrompt: string;
  userPrompt: string;
  /** Hard turn cap. 40 for nightly, 8 for watch per specs. */
  maxTurns: number;
  /** Optional wallclock cap; watch uses 60s per spec 05. */
  wallclockMs?: number;
  /** Optional USD budget as a secondary cost guard. */
  maxBudgetUsd?: number;
  /** Anthropic model identifier. Defaults to claude-haiku-4-5. */
  model?: string;
  /** Callback invoked on every SDK message; useful for transcript archival. */
  onMessage?: (msg: SDKMessage) => void;
  /** Optional external abort signal (e.g. from the watch wallclock). */
  abort?: AbortController;
  /** If set, write every SDK message as JSONL to <dir>/<runId>.jsonl. */
  transcriptDir?: string;
}

export interface RunAgentResult {
  status: 'success' | 'truncated' | 'error';
  /** Populated for watch runs. */
  verdict?: WatchVerdict;
  verdictReason?: string;
  turnCount: number;
  tokensIn: number;
  tokensOut: number;
  tokensCached: number;
  costUsd: number;
  /** Human-readable error summary when status='error'. */
  error?: string;
  /** Populated when a hard-block fired. Safe to stringify into runs.error. */
  safetyHardBlockReason?: string;
  /** Path to the JSONL transcript if transcriptDir was provided. */
  transcriptPath?: string;
}

type MutableSafetyState = { hardBlockReason: string | null };

/** Concatenated text of every tool_result block in a user message. */
function toolResultText(msg: SDKMessage): string {
  if (msg.type !== 'user') return '';
  const content = msg.message?.content;
  if (!Array.isArray(content)) return '';

  const chunks: string[] = [];
  for (const block of content) {
    if (block?.type !== 'tool_result') continue;
    const body = block.content;
    if (typeof body === 'string') {
      chunks.push(body);
    } else if (Array.isArray(body)) {
      for (const part of body) {
        if (part?.type === 'text' && typeof part.text === 'string') chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n');
}

/**
 * Extract `___WATCHFIRE_OBS:` trailers from adapter output and persist them against
 * the current run (spec 03 §Observation emission).
 *
 * Best-effort: telemetry must never fail a run, so a bad trailer or a write
 * error is swallowed rather than propagated.
 */
function persistObservationTrailers(db: Db, runId: number, msg: SDKMessage): void {
  const text = toolResultText(msg);
  if (!text.includes(OBS_TRAILER_PREFIX)) return;

  for (const obs of parseObservationTrailers(text)) {
    try {
      appendObservation(db, { ...obs, runId });
    } catch {
      // Observations are advisory; a failed insert must not abort the sweep.
    }
  }
}

function buildCanUseTool(state: MutableSafetyState): CanUseTool {
  return async (toolName, toolInput) => {
    // MCP tools (emit-finding, conclude-watch) always allowed — they're ours.
    if (toolName.startsWith('mcp__watchfire__')) {
      return { behavior: 'allow', updatedInput: toolInput };
    }

    if (toolName === 'Bash') {
      const command =
        typeof (toolInput as { command?: unknown }).command === 'string'
          ? ((toolInput as { command: string }).command)
          : '';
      const decision = checkBashCommand(command);
      const result = safetyDecisionToPermission(decision, toolInput);
      if (result.behavior === 'deny' && result.interrupt) {
        state.hardBlockReason = decision.kind === 'hard-block' ? decision.reason : 'unknown';
      }
      return result;
    }

    // Any other built-in tool (Read/Edit/etc.) — deny. Caller should have
    // restricted the tool set via Options.tools = ['Bash'] so this is a
    // belt-and-suspenders guard.
    return {
      behavior: 'deny',
      message: `tool not permitted: ${toolName}. Use Bash with Watchfire adapters or the emit-finding / conclude-watch MCP tools.`,
    };
  };
}

/**
 * Drive a single agent run. Wraps the Claude Agent SDK `query()`, wires our
 * safety hook as `canUseTool`, registers the Watchfire MCP tools (emit_finding for
 * every run, conclude_watch for watch runs), and collects the terminal result
 * message.
 *
 * Findings are upserted into memory side-effectfully by the emit_finding
 * handler. The returned RunAgentResult summarises the run (turns, tokens,
 * cost, verdict for watch, error/truncation markers).
 *
 * This function does NOT call completeRun() on the runs row — the caller
 * decides how to fold the result into storage (nightly post-run pipeline,
 * watch triage, etc.).
 */
export async function runAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const verdictSlot = createWatchVerdictSlot();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK tool array is heterogeneous by schema; typed as any per SdkMcpServer's own declaration.
  const mcpTools: Array<SdkMcpToolDefinition<any>> = [createEmitFindingTool(input.db, input.runId)];
  if (input.mode === 'watch') {
    mcpTools.push(createConcludeWatchTool(verdictSlot));
  }

  const mcpServer = createSdkMcpServer({
    name: 'watchfire',
    version: '0.0.1',
    tools: mcpTools,
  });

  const safetyState: MutableSafetyState = { hardBlockReason: null };
  const canUseTool = buildCanUseTool(safetyState);

  const abort = input.abort ?? new AbortController();
  let wallclockTimer: ReturnType<typeof setTimeout> | null = null;
  if (input.wallclockMs) {
    wallclockTimer = setTimeout(() => abort.abort(), input.wallclockMs);
    wallclockTimer.unref?.();
  }

  // The SDK's runtime libc detection mis-identifies our Debian-slim image as
  // musl in some setups, then fails to exec the wrong native binary. The
  // Docker image sets WATCHFIRE_CLAUDE_CODE_PATH to the correct (glibc) variant;
  // when present, pass it through to bypass the SDK's auto-detection.
  const claudeExecOverride = process.env['WATCHFIRE_CLAUDE_CODE_PATH'];

  const options: Options = {
    model: input.model ?? 'claude-haiku-4-5',
    systemPrompt: input.systemPrompt,
    maxTurns: input.maxTurns,
    ...(input.maxBudgetUsd !== undefined ? { maxBudgetUsd: input.maxBudgetUsd } : {}),
    ...(claudeExecOverride ? { pathToClaudeCodeExecutable: claudeExecOverride } : {}),
    mcpServers: { watchfire: mcpServer },
    tools: ['Bash'],
    canUseTool,
    abortController: abort,
  };

  let terminalStatus: RunAgentResult['status'] = 'success';
  let errorMessage: string | null = null;
  let turnCount = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let tokensCached = 0;
  let costUsd = 0;

  const transcriptWriter = input.transcriptDir
    ? openTranscript(input.transcriptDir, input.runId)
    : null;

  try {
    for await (const msg of query({ prompt: input.userPrompt, options })) {
      input.onMessage?.(msg);
      transcriptWriter?.append(msg);
      if (msg.type === 'user') {
        persistObservationTrailers(input.db, input.runId, msg);
      }
      if (msg.type === 'result') {
        turnCount = 'num_turns' in msg ? (msg.num_turns ?? 0) : 0;
        costUsd = 'total_cost_usd' in msg ? (msg.total_cost_usd ?? 0) : 0;
        const usage = 'usage' in msg ? msg.usage : undefined;
        tokensIn = usage?.input_tokens ?? 0;
        tokensOut = usage?.output_tokens ?? 0;
        tokensCached = usage?.cache_read_input_tokens ?? 0;

        if (msg.subtype === 'success') {
          // A successful result is a success even if it used every available
          // turn — `num_turns` counts all conversation turns, so comparing it
          // to `maxTurns` mislabels completed sweeps. A real cap hit arrives as
          // subtype='error_max_turns' (handled below), never as 'success'.
          if (msg.stop_reason === 'max_turns') {
            terminalStatus = 'truncated';
          }
        } else if (msg.subtype === 'error_max_turns' || msg.subtype === 'error_max_budget_usd') {
          // Budget limits reached. Agent did work up to the cap; sweep is
          // still safe to run, so classify as truncated, not error.
          terminalStatus = 'truncated';
        } else {
          terminalStatus = 'error';
          errorMessage =
            'is_error' in msg && msg.is_error
              ? `subtype=${msg.subtype}`
              : `result subtype=${msg.subtype}`;
        }
      }
    }
  } catch (err) {
    terminalStatus = 'error';
    errorMessage = err instanceof Error ? err.message : String(err);
  } finally {
    if (wallclockTimer) clearTimeout(wallclockTimer);
    if (transcriptWriter) await transcriptWriter.close();
  }

  // Hard-block wins over any other status.
  if (safetyState.hardBlockReason) {
    terminalStatus = 'error';
    errorMessage = `safety: ${safetyState.hardBlockReason}`;
  }

  // Wallclock-triggered abort for watch → treat as truncated (not error):
  // the agent did sweep, it just ran out of clock. Default verdict will be
  // 'defer' handled by the caller if verdictSlot.verdict is null.
  if (terminalStatus === 'error' && abort.signal.aborted && !safetyState.hardBlockReason) {
    terminalStatus = 'truncated';
    errorMessage = null;
  }

  const result: RunAgentResult = {
    status: terminalStatus,
    turnCount,
    tokensIn,
    tokensOut,
    tokensCached,
    costUsd,
  };
  if (verdictSlot.verdict) {
    result.verdict = verdictSlot.verdict;
    result.verdictReason = verdictSlot.reason ?? '';
  }
  if (errorMessage) result.error = errorMessage;
  if (safetyState.hardBlockReason) result.safetyHardBlockReason = safetyState.hardBlockReason;
  if (transcriptWriter) result.transcriptPath = transcriptWriter.path;

  return result;
}
