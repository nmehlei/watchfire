// Watchfire container entrypoint. See specs/01-architecture.md.

import { dirname } from 'node:path';
import { schedule as cronSchedule, validate as cronValidate } from 'node-cron';
import { registerWebhook } from './bot/setup.js';
import { loadResources, loadTenants } from './config/tenants.js';
import type { Tenant } from './config/types.js';
import {
  getLastSweptNightlyAt,
  markCrashedOnStartup,
  openDb,
} from './memory/index.js';
import { sendTelegramMessage, type TelegramConfig } from './reporting/telegram.js';
import { runNightly } from './nightly/index.js';
import type { AdapterName } from './nightly/prompt.js';
import { BoundedSerialQueue } from './watch/queue.js';
import {
  createWatchServer,
  type WatchEnqueuePayload,
} from './watch/server.js';
import type { SignatureConfig } from './watch/webhooks/signature.js';
import { createTelegramHandler } from './watch/webhooks/telegram.js';
import { runWatch } from './watch/triage.js';

// Defaults match the original behavior: nightly at 02:30, catch-up after 24h
// of silence. Deployments that want a cheaper cadence (fewer runs/week) can
// override both via env — see IRIS_NIGHTLY_CRON / IRIS_CATCHUP_STALE_HOURS in
// docs/deployment.md. If you widen the cron gap, widen the catch-up threshold
// to at least match it: otherwise a container restart on a between-run day
// fires an unplanned catch-up sweep and quietly erodes the savings.
const DEFAULT_NIGHTLY_CRON = '30 2 * * *';
const DEFAULT_CATCHUP_STALE_HOURS = 24;
const NIGHTLY_TZ = 'Europe/Berlin';
const HTTP_PORT = 8080;
const QUEUE_MAX_DEPTH = 10;
// Runaway guard, not an operating limit (spec 04 §Model & budget). Observed
// runs sit at $0.13–$0.18 and the 40-turn cap puts the worst case near $0.40.
// Reaching this terminates the run with status='truncated'.
const NIGHTLY_MAX_BUDGET_USD = 1.0;

// Adapters actually wired + credentialed in this deployment. Updated as
// new adapters land (az-as / hcloud-as / kubectl-as / ssh-as — all pending
// operator decisions + credentials, see HANDOFF/specs 09).
const V1_AVAILABLE_ADAPTERS: readonly AdapterName[] = [
  'obs-search',
  'obs-streams',
  'check-ssl',
  'check-http',
];

interface EnvConfig {
  anthropicApiKey: string;
  telegramBotToken: string;
  telegramChatId: string;
  /** Operator chat IDs allowed to issue bot commands. */
  telegramAllowedChatIds: ReadonlySet<number>;
  /** secret_token for setWebhook + intake header check. Optional → bot disabled. */
  telegramWebhookSecret: string | undefined;
  /** Public URL where /webhook/telegram is reachable. Optional → bot disabled. */
  telegramWebhookUrl: string | undefined;
  dbPath: string;
  tenantsPath: string;
  resourcesPath: string;
  transcriptDir: string;
  httpPort: number;
  signatureSecret: string | undefined;
  skipVerify: boolean;
  /** Bearer token gating spec 11 surfaces (MCP + REST). Unset → both disabled. */
  apiToken: string | undefined;
  /** node-cron expression for the nightly sweep. Default: daily at 02:30. */
  nightlyCron: string;
  /**
   * Startup catch-up fires if the last successful nightly is older than
   * this. Must be >= the longest gap nightlyCron can produce, or a restart
   * on a between-run day triggers an unplanned extra sweep.
   */
  catchupStaleHours: number;
}

function loadEnv(): EnvConfig {
  // Node 22+: load .env if present; silent if absent.
  try {
    process.loadEnvFile?.();
  } catch {
    // no .env file — fine in production (env set by container orchestrator)
  }

  const anthropicApiKey = requireEnv('ANTHROPIC_API_KEY');
  const telegramBotToken = requireEnv('TELEGRAM_BOT_TOKEN');
  const telegramChatId = requireEnv('TELEGRAM_CHAT_ID');

  // Default the allowlist to the digest chat. Comma-separated overrides allow
  // the operator to allow a different DM than the digest target.
  const allowedChatIdsEnv =
    process.env['TELEGRAM_ALLOWED_CHAT_IDS'] ?? telegramChatId;
  const telegramAllowedChatIds = new Set(
    allowedChatIdsEnv
      .split(',')
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && Number.isInteger(n)),
  );

  const dbPath = process.env['IRIS_DB_PATH'] ?? '/var/lib/iris/iris.db';
  // Default transcripts next to the DB so container volume mounting covers both.
  const transcriptDir =
    process.env['IRIS_TRANSCRIPT_DIR'] ?? dirname(dbPath) + '/transcripts';

  const catchupStaleHoursEnv = Number(process.env['IRIS_CATCHUP_STALE_HOURS']);
  const catchupStaleHours = Number.isFinite(catchupStaleHoursEnv)
    ? catchupStaleHoursEnv
    : DEFAULT_CATCHUP_STALE_HOURS;

  return {
    anthropicApiKey,
    telegramBotToken,
    telegramChatId,
    telegramAllowedChatIds,
    telegramWebhookSecret: process.env['TELEGRAM_WEBHOOK_SECRET'],
    telegramWebhookUrl: process.env['TELEGRAM_WEBHOOK_URL'],
    dbPath,
    tenantsPath: process.env['IRIS_TENANTS_PATH'] ?? '/etc/iris/tenants.yaml',
    resourcesPath: process.env['IRIS_RESOURCES_PATH'] ?? '/etc/iris/resources.yaml',
    transcriptDir,
    httpPort: Number(process.env['IRIS_HTTP_PORT'] ?? HTTP_PORT),
    signatureSecret: process.env['OPENOBSERVE_WEBHOOK_SECRET'],
    skipVerify: process.env['IRIS_WEBHOOK_VERIFY'] === 'false',
    apiToken: process.env['IRIS_API_TOKEN'],
    nightlyCron: process.env['IRIS_NIGHTLY_CRON'] ?? DEFAULT_NIGHTLY_CRON,
    catchupStaleHours,
  };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    throw new Error(`missing required env var: ${name}`);
  }
  return v;
}

function log(msg: string, fields: Record<string, unknown> = {}): void {
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), msg, ...fields }) + '\n',
  );
}

async function main(): Promise<void> {
  const env = loadEnv();

  log('iris starting', {
    dbPath: env.dbPath,
    tenantsPath: env.tenantsPath,
    resourcesPath: env.resourcesPath,
    transcriptDir: env.transcriptDir,
    httpPort: env.httpPort,
    nightlyCron: env.nightlyCron,
    catchupStaleHours: env.catchupStaleHours,
  });

  const db = openDb(env.dbPath);
  const crashedMarked = markCrashedOnStartup(db);
  if (crashedMarked > 0) log('marked crashed runs', { count: crashedMarked });

  const tenants = loadTenants(env.tenantsPath);
  const resourceGraph = loadResources(env.resourcesPath);
  log('config loaded', { tenants: tenants.length, resources: resourceGraph.resources.length });

  const telegram: TelegramConfig = {
    botToken: env.telegramBotToken,
    chatId: env.telegramChatId,
  };

  // Catch-up: if the last swept nightly is older than the longest gap the
  // schedule below can produce (see env.catchupStaleHours), fire one now
  // before entering the normal loop. Runs in the background so the HTTP
  // server starts without waiting.
  const lastSwept = getLastSweptNightlyAt(db);
  const needsCatchup = lastSwept === null || isOlderThanHours(lastSwept, env.catchupStaleHours);
  if (needsCatchup) {
    log('nightly catch-up needed', { lastSwept });
    void runScheduledNightly(db, tenants, resourceGraph, telegram, env.transcriptDir, 'catchup').catch((err) => {
      log('catchup nightly failed', { error: errorMessage(err) });
    });
  }

  // Cron: default daily at 02:30 Europe/Berlin, overridable via IRIS_NIGHTLY_CRON.
  if (!cronValidate(env.nightlyCron)) {
    throw new Error(`invalid cron expression: ${env.nightlyCron}`);
  }
  const nightlyCronTask = cronSchedule(
    env.nightlyCron,
    () => {
      log('nightly cron fired');
      void runScheduledNightly(db, tenants, resourceGraph, telegram, env.transcriptDir, 'cron').catch((err) => {
        log('scheduled nightly failed', { error: errorMessage(err) });
      });
    },
    { timezone: NIGHTLY_TZ },
  );
  log('nightly cron scheduled', { expression: env.nightlyCron, tz: NIGHTLY_TZ });

  // Watch: bounded queue + Fastify HTTP server.
  const queue = new BoundedSerialQueue<WatchEnqueuePayload>(
    async (payload) => {
      try {
        const result = await runWatch({
          db,
          alert: payload.parsed,
          tenant: payload.tenant,
          knownTenants: tenants,
          resourceGraph,
          telegram,
          transcriptDir: env.transcriptDir,
        });
        log('watch completed', {
          runId: result.runId,
          tenant: payload.tenant.id,
          verdict: result.verdict,
          pageSent: result.pageSent,
          status: result.status,
        });
      } catch (err) {
        log('watch failed', { error: errorMessage(err) });
      }
    },
    { maxDepth: QUEUE_MAX_DEPTH },
  );

  const signature: SignatureConfig = {
    ...(env.signatureSecret ? { secret: env.signatureSecret } : {}),
    ...(env.skipVerify ? { skip: true } : {}),
  };

  const telegramHandler =
    env.telegramWebhookSecret && env.telegramAllowedChatIds.size > 0
      ? createTelegramHandler({
          db,
          auth: {
            secretToken: env.telegramWebhookSecret,
            allowedChatIds: env.telegramAllowedChatIds,
          },
          sendReply: (text) => sendTelegramMessage(telegram, text),
          log: (msg, fields) => log(msg, fields),
        })
      : undefined;

  if (!telegramHandler) {
    log('telegram bot disabled', {
      hasSecret: Boolean(env.telegramWebhookSecret),
      allowedChatIdCount: env.telegramAllowedChatIds.size,
    });
  }

  const app = createWatchServer({
    tenants,
    queue,
    signature,
    ...(telegramHandler ? { telegram: telegramHandler } : {}),
    ...(env.apiToken
      ? {
          api: {
            db,
            apiToken: env.apiToken,
            graph: resourceGraph,
            knownTenants: tenants.map((t) => t.id),
            knownAdapters: V1_AVAILABLE_ADAPTERS,
            log: (msg, fields) => log(msg, fields),
          },
        }
      : {}),
  });
  await app.listen({ host: '0.0.0.0', port: env.httpPort });
  log('http server listening', { port: env.httpPort });

  if (!env.apiToken) {
    log('api surfaces disabled', { reason: 'IRIS_API_TOKEN unset' });
  } else {
    log('api surfaces enabled', { paths: ['/api/findings', '/api/findings/:id', '/mcp'] });
  }

  if (telegramHandler && env.telegramWebhookUrl && env.telegramWebhookSecret) {
    void registerWebhook({
      botToken: env.telegramBotToken,
      webhookUrl: env.telegramWebhookUrl,
      secretToken: env.telegramWebhookSecret,
    })
      .then((result) => {
        if (result.ok) log('telegram webhook registered', { url: env.telegramWebhookUrl });
        else log('telegram webhook registration failed', { status: result.status, body: result.body.slice(0, 200) });
      })
      .catch((err: unknown) => {
        log('telegram webhook registration error', { error: errorMessage(err) });
      });
  }

  // Graceful shutdown.
  const shutdown = async (signal: string): Promise<void> => {
    log('shutdown requested', { signal });
    nightlyCronTask.stop();
    try {
      await app.close();
    } catch (err) {
      log('error closing http server', { error: errorMessage(err) });
    }
    await queue.idle();
    try {
      db.close();
    } catch (err) {
      log('error closing db', { error: errorMessage(err) });
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

async function runScheduledNightly(
  db: ReturnType<typeof openDb>,
  tenants: readonly Tenant[],
  resourceGraph: ReturnType<typeof loadResources>,
  telegram: TelegramConfig,
  transcriptDir: string,
  trigger: 'cron' | 'catchup',
): Promise<void> {
  const result = await runNightly({
    db,
    tenants,
    resourceGraph,
    trigger,
    telegram,
    transcriptDir,
    availableAdapters: V1_AVAILABLE_ADAPTERS,
    maxBudgetUsd: NIGHTLY_MAX_BUDGET_USD,
  });
  log('nightly completed', {
    runId: result.runId,
    status: result.status,
    resolved: result.resolved,
    digestSent: result.digestSent,
    turnCount: result.turnCount,
    costUsd: result.costUsd,
  });
}

function isOlderThanHours(iso: string, hours: number): boolean {
  const then = Date.parse(iso.replace(' ', 'T') + 'Z');
  return !Number.isFinite(then) || Date.now() - then > hours * 60 * 60 * 1000;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

main().catch((err: unknown) => {
  log('fatal', { error: errorMessage(err) });
  process.exit(1);
});
