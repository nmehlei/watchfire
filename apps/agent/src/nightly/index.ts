import type { ResourceGraph, Tenant } from '../config/types.js';
import { runAgent, type RunAgentInput, type RunAgentResult } from '../agent/runner.js';
import { getEventBus } from '../api/events/bus.js';
import {
  completeRun,
  countSuppressedPages,
  getActiveMutedFingerprints,
  getAgentContextFindings,
  getDigestFindings,
  getRun,
  insertRun,
  pruneOldData,
  resolveUnseenFindings,
  type Db,
} from '../memory/index.js';
import { composeDigest } from '../reporting/digest.js';
import { splitForTelegram } from '../reporting/length.js';
import {
  sendTelegramMessageParts,
  type TelegramConfig,
} from '../reporting/telegram.js';
import { buildNightlyPrompt, type AdapterName } from './prompt.js';

export type NightlyTrigger = 'cron' | 'catchup' | 'manual';

export interface RunNightlyInput {
  db: Db;
  tenants: readonly Tenant[];
  resourceGraph: ResourceGraph;
  trigger: NightlyTrigger;
  /** Hard turn cap. Default 40 per spec 04. */
  maxTurns?: number;
  /** Optional USD budget guard for the run; SDK stops when reached → status='truncated'. */
  maxBudgetUsd?: number;
  /** Sweep order; default: the order in `tenants`. */
  sweepOrder?: readonly string[];
  /** Adapters actually wired + credentialed on this deployment. */
  availableAdapters?: readonly AdapterName[];
  /** Telegram config. When omitted, digest is composed but not sent. */
  telegram?: TelegramConfig;
  /** Write per-run transcripts to <dir>/<runId>.jsonl. Path stored in runs.transcript_path. */
  transcriptDir?: string;
  /** Override the agent runner for tests. */
  agentRun?: (input: RunAgentInput) => Promise<RunAgentResult>;
  /** Skip the retention sweep (useful in tests). */
  skipRetention?: boolean;
}

export interface RunNightlyResult {
  runId: number;
  status: RunAgentResult['status'];
  resolved: number;
  digestSent: boolean;
  digestText: string;
  sendError?: string;
  turnCount: number;
  costUsd: number;
}

const DEFAULT_MAX_TURNS = 40;

/**
 * Orchestrate a nightly run:
 *  1. Insert runs row (type='nightly', trigger=cron|catchup|manual).
 *  2. Build prompt from tenants + resource graph + agent-context findings.
 *  3. Run the agent (default maxTurns=40).
 *  4. On success or truncated: resolveUnseenFindings sweep.
 *  5. Compose digest (always, even on error — header explains).
 *  6. Send digest via Telegram (if configured). Send failure → runs.error.
 *  7. completeRun.
 *  8. Retention sweep (unless skipped).
 *
 * Does not ping healthchecks.io — that's an ops concern (spec 09).
 */
export async function runNightly(input: RunNightlyInput): Promise<RunNightlyResult> {
  const agentRun = input.agentRun ?? runAgent;
  const maxTurns = input.maxTurns ?? DEFAULT_MAX_TURNS;

  const runId = insertRun(input.db, { type: 'nightly', trigger: input.trigger });
  const runRow = getRun(input.db, runId)!;

  const knownFindings = getAgentContextFindings(input.db, 30);
  const { systemPrompt, userPrompt } = buildNightlyPrompt({
    tenants: input.tenants,
    ...(input.sweepOrder ? { sweepOrder: input.sweepOrder } : {}),
    ...(input.availableAdapters ? { availableAdapters: input.availableAdapters } : {}),
    resourceGraph: input.resourceGraph,
    knownFindings,
  });

  const agent = await agentRun({
    db: input.db,
    runId,
    mode: 'nightly',
    systemPrompt,
    userPrompt,
    maxTurns,
    ...(input.maxBudgetUsd !== undefined ? { maxBudgetUsd: input.maxBudgetUsd } : {}),
    ...(input.transcriptDir ? { transcriptDir: input.transcriptDir } : {}),
  });

  // Resolution sweep: success or truncated only (spec 06).
  let resolved = 0;
  if (agent.status === 'success' || agent.status === 'truncated') {
    resolved = resolveUnseenFindings(input.db, runRow.started_at);
  }

  // Compose + send digest.
  const suppressed = countSuppressedPages(input.db, 24);
  const digestFindings = getDigestFindings(input.db, 7);
  // Fold agent outcome back onto the run-row snapshot for the composer's
  // header rendering (status / error / cost / turns / cache info).
  const runForCompose = {
    ...runRow,
    status: agent.status,
    finding_count: digestFindings.filter((f) => f.last_run_id === runId).length,
    turn_count: agent.turnCount,
    tokens_in: agent.tokensIn,
    tokens_out: agent.tokensOut,
    tokens_cached: agent.tokensCached,
    cost_eur: agent.costUsd, // USD≈EUR for v1
    error: agent.error ?? null,
  };

  const mutedFingerprints = getActiveMutedFingerprints(input.db);
  const digestText = composeDigest({
    run: runForCompose,
    findings: digestFindings,
    suppressedPages: suppressed,
    graph: input.resourceGraph,
    knownTenants: input.tenants.map((t) => t.id),
    mutedFingerprints,
  });

  let digestSent = false;
  let sendError: string | undefined;
  if (input.telegram) {
    try {
      const parts = splitForTelegram(digestText);
      await sendTelegramMessageParts(input.telegram, parts);
      digestSent = true;
    } catch (err) {
      sendError = err instanceof Error ? err.message : String(err);
    }
  }

  const finalError =
    agent.error ?? (sendError ? `telegram: ${sendError}` : undefined);

  completeRun(input.db, runId, {
    status: agent.status,
    findingCount: runForCompose.finding_count,
    turnCount: agent.turnCount,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut,
    tokensCached: agent.tokensCached,
    costEur: agent.costUsd,
    ...(agent.transcriptPath ? { transcriptPath: agent.transcriptPath } : {}),
    ...(finalError ? { error: finalError } : {}),
  });

  getEventBus().emit('nightly.completed', { runId, status: agent.status });

  if (!input.skipRetention) {
    pruneOldData(input.db);
  }

  const result: RunNightlyResult = {
    runId,
    status: agent.status,
    resolved,
    digestSent,
    digestText,
    turnCount: agent.turnCount,
    costUsd: agent.costUsd,
  };
  if (sendError) result.sendError = sendError;
  return result;
}
