import { defaultTenantsPath } from '../../config/paths.js';
import { loadTenants } from '../../config/tenants.js';
import type { Tenant } from '../../config/types.js';
import {
  classifyProbe,
  httpMeasurements,
  renderProbeDetail,
  renderProbeSummaryLine,
  renderSummaryFooter,
  summarize,
  type ResultClass,
} from './format.js';
import { renderObservationTrailers } from '../trailer.js';
import { probeHttp } from './probe.js';

interface Args {
  tenant?: string;
  endpoint?: string;
  tenantsPath: string;
  timeoutMs: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { tenantsPath: defaultTenantsPath(), timeoutMs: 10_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--tenant':
        args.tenant = argv[++i];
        break;
      case '--endpoint':
        args.endpoint = argv[++i];
        break;
      case '--tenants-path':
        args.tenantsPath = argv[++i] ?? args.tenantsPath;
        break;
      case '--timeout':
        args.timeoutMs = Number(argv[++i] ?? args.timeoutMs);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.tenant) throw new Error('--tenant is required');
  return args;
}

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: check-http --tenant <id> [--endpoint <name>] [--timeout <ms>] [--tenants-path <path>]',
      '  --tenants-path <path>  tenant registry (default: $IRIS_TENANTS_PATH, else config/tenants.yaml)',
      '',
      'Probes every http_health.endpoints entry for the tenant (or just --endpoint if given).',
      'Reports: status code, response time, body size.',
      '',
      'Exit codes:',
      '  0 — all ok',
      '  1 — one or more warnings (4xx)',
      '  2 — one or more criticals (5xx, connection failure)',
    ].join('\n') + '\n',
  );
}

function endpointsForTenant(tenant: Tenant): Array<{ name: string; url: string }> {
  for (const s of tenant.systems) {
    if (s.type === 'http_health') return s.endpoints;
  }
  return [];
}

function exitCode(classes: readonly ResultClass[]): number {
  if (classes.includes('critical') || classes.includes('error')) return 2;
  if (classes.includes('warn')) return 1;
  return 0;
}

export async function mainCheckHttp(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const tenants = loadTenants(args.tenantsPath);
  const tenant = tenants.find((t) => t.id === args.tenant);
  if (!tenant) {
    process.stderr.write(`unknown tenant: ${args.tenant}\n`);
    return 2;
  }

  const all = endpointsForTenant(tenant);
  const endpoints = args.endpoint ? all.filter((e) => e.name === args.endpoint) : all;

  if (args.endpoint && endpoints.length === 0) {
    process.stderr.write(`unknown endpoint: ${args.endpoint}\n`);
    return 2;
  }
  if (endpoints.length === 0) {
    process.stdout.write(`tenant ${tenant.id} has no http_health.endpoints configured.\n`);
    return 0;
  }

  const probes = await Promise.all(
    endpoints.map((e) => probeHttp(e.name, e.url, { timeoutMs: args.timeoutMs })),
  );

  if (args.endpoint && probes.length === 1) {
    process.stdout.write(renderProbeDetail(probes[0]!) + '\n');
  } else {
    for (const p of probes) process.stdout.write(renderProbeSummaryLine(p) + '\n');
    process.stdout.write('\n' + renderSummaryFooter(summarize(probes)) + '\n');
  }

  // Observation trailers last, after the human-readable output (spec 03).
  const trailers = renderObservationTrailers(tenant.id, 'check-http', httpMeasurements(probes));
  if (trailers) process.stdout.write(trailers + '\n');

  return exitCode(probes.map(classifyProbe));
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/cli.ts') ||
  process.argv[1]?.endsWith('/cli.js');

if (isMain) {
  void mainCheckHttp(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: Error) => {
      process.stderr.write(`check-http: ${err.message}\n`);
      process.exit(2);
    },
  );
}
