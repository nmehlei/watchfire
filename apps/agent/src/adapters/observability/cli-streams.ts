import { defaultTenantsPath } from '../../config/paths.js';
import {
  loadTenantsFromPath,
  openObserveConfigFromEnv,
} from './config.js';
import { renderStreams } from './format.js';
import { listStreams } from './openobserve.js';

interface Args {
  tenant?: string;
  tenantsPath: string;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { tenantsPath: defaultTenantsPath() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    switch (a) {
      case '--tenant':
        args.tenant = argv[++i];
        break;
      case '--tenants-path':
        args.tenantsPath = argv[++i] ?? args.tenantsPath;
        break;
      case '-h':
      case '--help':
        process.stdout.write(
          'Usage: obs-streams --tenant <id>\n\nLists all OpenObserve streams on the configured instance.\n',
        );
        process.exit(0);
        break;
      default:
        throw new Error(`unknown flag: ${a}`);
    }
  }
  if (!args.tenant) throw new Error('--tenant is required');
  return args;
}

export async function mainObsStreams(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv);
  const tenants = loadTenantsFromPath(args.tenantsPath);
  const tenant = tenants.find((t) => t.id === args.tenant);
  if (!tenant) {
    process.stderr.write(`unknown tenant: ${args.tenant}\n`);
    return 2;
  }
  const cfg = openObserveConfigFromEnv();
  const streams = await listStreams(cfg);
  process.stdout.write(renderStreams(tenant.id, streams) + '\n');
  return 0;
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/cli-streams.ts') ||
  process.argv[1]?.endsWith('/cli-streams.js');

if (isMain) {
  void mainObsStreams(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err: Error) => {
      process.stderr.write(`obs-streams: ${err.message}\n`);
      process.exit(2);
    },
  );
}
