import { defaultTenantsPath } from '../../config/paths.js';
import { loadTenants } from '../../config/tenants.js';
import { fetchPipelineStates } from './client.js';
import { adoConfigForTenant } from './config.js';
import { adoExitCode, renderAdoReport } from './format.js';

interface Args {
  tenant?: string;
  project?: string;
  tenantsPath: string;
  timeoutMs: number;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { tenantsPath: defaultTenantsPath(), timeoutMs: 15_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--tenant':
        args.tenant = argv[++i];
        break;
      case '--project':
        args.project = argv[++i];
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
      'Usage: check-ado --tenant <id> [--project <name>] [--timeout <ms>] [--tenants-path <path>]',
      '  --tenants-path <path>  tenant registry (default: $WATCHFIRE_TENANTS_PATH, else config/tenants.yaml)',
      '',
      'Reports Azure DevOps pipelines whose latest default-branch run failed.',
      'Read-only. The PAT is read from the env var named by the tenant config.',
      '',
      'Exit codes:',
      '  0 — no red pipelines',
      '  1 — one or more red pipelines',
      '  2 — configuration or connection error',
    ].join('\n') + '\n',
  );
}

export async function mainCheckAdo(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const tenants = loadTenants(args.tenantsPath);
  const tenant = tenants.find((t) => t.id === args.tenant);
  if (!tenant) {
    process.stderr.write(`unknown tenant: ${args.tenant}\n`);
    return 2;
  }

  const cfg = adoConfigForTenant(tenant);
  if (!cfg) {
    process.stdout.write(`tenant ${tenant.id} has no azure_devops system configured.\n`);
    return 0;
  }

  const pat = process.env[cfg.patEnv];
  if (!pat) {
    process.stderr.write(`missing env var: ${cfg.patEnv}\n`);
    return 2;
  }

  const project = args.project ?? cfg.project;

  let states;
  try {
    states = await fetchPipelineStates(
      { orgUrl: cfg.orgUrl, project, pat },
      { timeoutMs: args.timeoutMs },
    );
  } catch (err) {
    process.stderr.write(`check-ado: ${err instanceof Error ? err.message : String(err)}\n`);
    return 2;
  }

  process.stdout.write(renderAdoReport(tenant.id, project, cfg.orgUrl, states) + '\n');
  return adoExitCode(states);
}

// Direct invocation support (node src/adapters/ado/cli.ts ...).
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/cli.ts') ||
  process.argv[1]?.endsWith('/cli.js');

if (isMain) {
  void mainCheckAdo(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: Error) => {
      process.stderr.write(`check-ado: ${err.message}\n`);
      process.exit(2);
    },
  );
}
