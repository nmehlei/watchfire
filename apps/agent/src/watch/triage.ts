import type { ResourceGraph, Tenant } from '../config/types.js';
import {
  completeRun,
  countRecentPages,
  getActiveMutedFingerprints,
  getDigestFindings,
  insertRun,
  type Db,
  type Finding,
  type WatchVerdict,
} from '../memory/index.js';
import { runAgent, type RunAgentInput, type RunAgentResult } from '../agent/runner.js';
import { getEventBus } from '../api/events/bus.js';
import { expandAffects } from '../reporting/affects.js';
import { composePage } from '../reporting/page.js';
import { splitForTelegram } from '../reporting/length.js';
import {
  sendTelegramMessageParts,
  type TelegramConfig,
} from '../reporting/telegram.js';
import { buildWatchPrompt } from './prompt.js';
import { summarizeAlert, type ParsedAlert } from './webhooks/openobserve.js';

export interface RunWatchInput {
  db: Db;
  alert: ParsedAlert;
  tenant: Tenant;
  knownTenants: readonly Tenant[];
  resourceGraph: ResourceGraph;
  nextNightlyHHMM?: string;
  /** Cap of pages per hour. Default 6 per spec 05. */
  pageRateLimit?: number;

  /** Telegram config. When omitted, pages are recorded as page_sent=0 with a "not configured" error. */
  telegram?: TelegramConfig;
  telegramChatIdOverride?: string;
  /** Write per-run transcripts to <dir>/<runId>.jsonl. Path stored in runs.transcript_path. */
  transcriptDir?: string;

  /** Injection point for tests — default is the real runAgent. */
  agentRun?: (input: RunAgentInput) => Promise<RunAgentResult>;
}

export interface RunWatchResult {
  runId: number;
  status: RunAgentResult['status'];
  verdict: WatchVerdict;
  verdictReason: string;
  pageSent: boolean;
  suppressedReason?: string;
  sendError?: string;
  turnCount: number;
  costUsd: number;
}

const DEFAULT_NEXT_NIGHTLY_HHMM = '02:30';
const DEFAULT_PAGE_RATE_LIMIT = 6;

function filterFindingsForTenant(
  findings: readonly Finding[],
  tenant: Tenant,
  graph: ResourceGraph,
  knownTenants: readonly Tenant[],
): Finding[] {
  const known = knownTenants.map((t) => t.id);
  return findings.filter((f) => {
    const affects = expandAffects(f.resource_id, graph, { knownTenants: known });
    return affects.includes(tenant.id);
  });
}

function tenantFindingsFromRun(db: Db, runId: number): Finding[] {
  return db
    .prepare('SELECT * FROM findings WHERE last_run_id = ? ORDER BY id')
    .all(runId) as Finding[];
}

/**
 * Orchestrate a single watch triage run.
 *
 * Flow:
 *   1. Insert runs row (type='watch', trigger='webhook').
 *   2. Build prompt; run the agent (8 turns, 60s wallclock).
 *   3. Derive verdict (agent's, or default 'defer' on truncation without verdict).
 *   4. If verdict='page': consult rate limit; send Telegram if allowed.
 *      If at/over the cap, record page_sent=0 with a "rate-limited" error.
 *   5. Finalize runs row with verdict, page_sent, counts, tokens, cost.
 *
 * Telegram failures don't flip run status — they go in runs.error as
 * `telegram: <reason>` (per specs/07 §Send path).
 */
export async function runWatch(input: RunWatchInput): Promise<RunWatchResult> {
  const agentRun = input.agentRun ?? runAgent;
  const rateLimit = input.pageRateLimit ?? DEFAULT_PAGE_RATE_LIMIT;
  const nextNightlyHHMM = input.nextNightlyHHMM ?? DEFAULT_NEXT_NIGHTLY_HHMM;

  const runId = insertRun(input.db, { type: 'watch', trigger: 'webhook' });

  const tenantScopedFindings = filterFindingsForTenant(
    getDigestFindings(input.db, 7),
    input.tenant,
    input.resourceGraph,
    input.knownTenants,
  );

  const { systemPrompt, userPrompt } = buildWatchPrompt({
    tenant: input.tenant,
    alert: input.alert,
    recentFindings: tenantScopedFindings,
    knownTenants: input.knownTenants,
  });

  const agent = await agentRun({
    db: input.db,
    runId,
    mode: 'watch',
    systemPrompt,
    userPrompt,
    maxTurns: 8,
    wallclockMs: 60_000,
    ...(input.transcriptDir ? { transcriptDir: input.transcriptDir } : {}),
  });

  // Resolve verdict. Default 'defer' when agent didn't conclude (truncation / error).
  const verdict: WatchVerdict = agent.verdict ?? 'defer';
  const verdictReason =
    agent.verdictReason ??
    (agent.verdict == null ? 'default: no conclusion within budget' : '');

  // Findings emitted by THIS run (touched by its runId).
  const runFindings = tenantFindingsFromRun(input.db, runId);
  const findingCount = runFindings.length;

  // Page rate-limit + Telegram send.
  let pageSent = false;
  let sendError: string | undefined;
  let suppressedReason: string | undefined;
  let finalError: string | undefined = agent.error ?? undefined;

  if (verdict === 'page') {
    const muted = getActiveMutedFingerprints(input.db);
    const visibleFindings = runFindings.filter((f) => !muted.has(f.fingerprint));
    const recent = countRecentPages(input.db, 60);
    if (visibleFindings.length === 0 && runFindings.length > 0) {
      suppressedReason = 'all findings muted; page withheld';
      finalError = suppressedReason;
    } else if (recent >= rateLimit) {
      suppressedReason = `rate-limited: already ${recent} pages in the last hour`;
      finalError = suppressedReason;
    } else if (input.telegram) {
      const pageText = composePage({
        run: {
          id: runId,
          type: 'watch',
          trigger: 'webhook',
          started_at: '',
          completed_at: null,
          status: null,
          verdict: 'page',
          page_sent: null,
          finding_count: findingCount,
          turn_count: agent.turnCount,
          tokens_in: agent.tokensIn,
          tokens_out: agent.tokensOut,
          tokens_cached: agent.tokensCached,
          cost_eur: null,
          error: null,
          transcript_path: null,
        },
        findings: visibleFindings,
        alertSummary: summarizeAlert(input.alert.alert),
        graph: input.resourceGraph,
        knownTenants: input.knownTenants.map((t) => t.id),
        runContextTenant: input.tenant.id,
        nextNightlyHHMM,
        verdictReason,
      });

      if (pageText) {
        try {
          const parts = splitForTelegram(pageText);
          await sendTelegramMessageParts(input.telegram, parts);
          pageSent = true;
        } catch (err) {
          sendError = err instanceof Error ? err.message : String(err);
          finalError = `telegram: ${sendError}`;
        }
      }
      // If composePage returned null (no findings), we don't page. Agent
      // voted page but emitted nothing — record page_sent=false with the
      // agent's own verdict_reason already captured.
    } else {
      finalError = 'telegram not configured; page withheld';
    }
  }

  completeRun(input.db, runId, {
    status: agent.status,
    verdict,
    pageSent,
    findingCount,
    turnCount: agent.turnCount,
    tokensIn: agent.tokensIn,
    tokensOut: agent.tokensOut,
    tokensCached: agent.tokensCached,
    // USD ≈ EUR for v1; FX nuance is an ops concern (see 09).
    costEur: agent.costUsd,
    ...(agent.transcriptPath ? { transcriptPath: agent.transcriptPath } : {}),
    ...(finalError ? { error: finalError } : {}),
  });

  getEventBus().emit('watch.completed', { runId, verdict, pageSent });

  const result: RunWatchResult = {
    runId,
    status: agent.status,
    verdict,
    verdictReason,
    pageSent,
    turnCount: agent.turnCount,
    costUsd: agent.costUsd,
  };
  if (suppressedReason) result.suppressedReason = suppressedReason;
  if (sendError) result.sendError = sendError;
  return result;
}
