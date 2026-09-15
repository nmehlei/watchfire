// obs-metrics — not implemented in v1. Stubbed so the adapter wrapper is
// present and the agent gets a clear "not configured" signal rather than a
// missing-binary error. Implement against OpenObserve's Prometheus-compatible
// /api/{org}/prometheus/api/v1/query when a concrete use case emerges.

export function mainObsMetrics(_argv: readonly string[]): Promise<number> {
  process.stderr.write(
    [
      'obs-metrics: not implemented in v1.',
      'For log-based signals use `obs-search`.',
      'To add: wire OpenObserve /api/{org}/prometheus/api/v1/query here.',
    ].join('\n') + '\n',
  );
  return Promise.resolve(2);
}

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/cli-metrics.ts') ||
  process.argv[1]?.endsWith('/cli-metrics.js');

if (isMain) {
  void mainObsMetrics(process.argv.slice(2)).then((code) => process.exit(code));
}
