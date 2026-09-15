import { defaultTenantsPath } from '../../config/paths.js';
import {
  loadTenantsFromPath,
  openObserveConfigFromEnv,
  streamForTenant,
} from './config.js';
import { renderSearchResult } from './format.js';
import { parseDuration, searchLogs } from './openobserve.js';

interface Args {
  tenant?: string;
  match?: string;
  sql?: string;
  since: string;
  limit: number;
  tenantsPath: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { since: '1h', limit: 100, tenantsPath: defaultTenantsPath() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--tenant':
        args.tenant = argv[++i];
        break;
      case '--match':
      case '--query':
        args.match = argv[++i];
        break;
      case '--sql':
        args.sql = argv[++i];
        break;
      case '--since':
        args.since = argv[++i] ?? args.since;
        break;
      case '--limit':
        args.limit = Number(argv[++i] ?? args.limit);
        break;
      case '--tenants-path':
        args.tenantsPath = argv[++i] ?? args.tenantsPath;
        break;
      case '-h':
      case '--help':
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
      'Usage: obs-search --tenant <id> [--match "<term>" | --sql "<sql>"] [--since 1h] [--limit 100]',
      '',
      'Search observability logs for a tenant.',
      '  --match: substring matched via OpenObserve str_match against full record.',
      '  --sql:   raw SQL query (overrides --match).',
      '  --since: time window (e.g. 30m, 1h, 24h). Default 1h.',
      '  --limit: max hits returned. Default 100.',
      '',
      'Env: OPENOBSERVE_URL, OPENOBSERVE_USER, OPENOBSERVE_PASSWORD [, OPENOBSERVE_ORG=default]',
      'Exit: 0 on success, 2 on error.',
    ].join('\n') + '\n',
  );
}

export async function mainObsSearch(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const tenants = loadTenantsFromPath(args.tenantsPath);
  const tenant = tenants.find((t) => t.id === args.tenant);
  if (!tenant) {
    process.stderr.write(`unknown tenant: ${args.tenant}\n`);
    return 2;
  }
  const stream = streamForTenant(tenant);
  if (!stream) {
    process.stderr.write(`tenant ${tenant.id} has no observability.stream configured\n`);
    return 2;
  }

  const cfg = openObserveConfigFromEnv();
  const result = await searchLogs(cfg, {
    stream,
    ...(args.match ? { match: args.match } : {}),
    ...(args.sql ? { sql: args.sql } : {}),
    sinceMs: parseDuration(args.since),
    limit: args.limit,
  });

  process.stdout.write(renderSearchResult(result, tenant.id, stream) + '\n');
  return 0;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/cli-search.ts') ||
  process.argv[1]?.endsWith('/cli-search.js');

if (isMain) {
  void mainObsSearch(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: Error) => {
      process.stderr.write(`obs-search: ${err.message}\n`);
      process.exit(2);
    },
  );
}
