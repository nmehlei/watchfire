// obs-alerts — not implemented in v1. OpenObserve's alert history API shape
// varies across versions; wiring it speculatively would produce stale code.
// The Watch webhook already delivers real-time alerts as they fire (spec 05).

export function mainObsAlerts(_argv: readonly string[]): Promise<number> {
  process.stderr.write(
    [
      'obs-alerts: not implemented in v1.',
      'Real-time alerts arrive via the /webhook/openobserve endpoint instead.',
      'To add: wire OpenObserve /api/{org}/alerts history endpoint here.',
    ].join('\n') + '\n',
  );
  return Promise.resolve(2);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/cli-alerts.ts') ||
  process.argv[1]?.endsWith('/cli-alerts.js');

if (isMain) {
  void mainObsAlerts(process.argv.slice(2)).then((code) => process.exit(code));
}
