// Read-only Azure DevOps Build REST client (spec 03 §Adapter: Azure DevOps).
//
// Injectable fetch mirrors src/adapters/http/probe.ts so tests never touch the
// network. The PAT is used only to build an Authorization header — it is never
// logged and never included in an error message.

const API_VERSION = '7.1';

// ⚠️ Two assumptions to confirm on the first live run against real ADO
// (untestable here without a PAT):
//   1. `build/latest/{id}` without a `branchName` query returns the latest
//      build on the definition's DEFAULT branch (per ADO docs). If a live run
//      shows feature/PR-branch builds leaking in, pass `&branchName=` built
//      from the definition's `repository.defaultBranch`.
//   2. API version. `build/latest` is preview in some versions; if it 400s,
//      try `7.1-preview.1` for that call.

export type AdoResult = 'succeeded' | 'partiallySucceeded' | 'failed' | 'canceled' | 'none';

export interface AdoLatestBuild {
  buildNumber: string;
  result: AdoResult | null;
  status: string;
  finishTime: string | null;
  sourceBranch: string | null;
  sourceVersion: string | null;
}

export interface AdoPipelineState {
  name: string;
  definitionId: number;
  defaultBranch: string | null;
  latest: AdoLatestBuild | null;
}

export interface AdoClientConfig {
  orgUrl: string;
  project: string;
  pat: string;
}

export interface AdoFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export interface AdoFetch {
  (
    url: string,
    init?: { method?: string; headers?: Record<string, string>; signal?: AbortSignal },
  ): Promise<AdoFetchResponse>;
}

export interface AdoFetchOptions {
  /** Dependency injection for testing. Defaults to globalThis.fetch. */
  fetch?: AdoFetch;
  timeoutMs?: number;
}

function defaultFetch(): AdoFetch {
  return globalThis.fetch as unknown as AdoFetch;
}

/** ADO PAT auth is HTTP Basic with an empty username. */
function authHeader(pat: string): string {
  return 'Basic ' + Buffer.from(`:${pat}`).toString('base64');
}

interface RawDefinition {
  id: number;
  name: string;
  repository?: { defaultBranch?: string | null } | null;
}

interface RawBuild {
  buildNumber?: string;
  result?: AdoResult;
  status?: string;
  finishTime?: string;
  sourceBranch?: string;
  sourceVersion?: string;
}

/**
 * List the project's pipelines, each with its latest completed build.
 *
 * A pipeline that has never run yields `latest: null` (ADO answers 404 on the
 * `latest` endpoint). Any other non-OK status throws.
 */
export async function fetchPipelineStates(
  cfg: AdoClientConfig,
  opts: AdoFetchOptions = {},
): Promise<AdoPipelineState[]> {
  const doFetch = opts.fetch ?? defaultFetch();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const headers = { Authorization: authHeader(cfg.pat), Accept: 'application/json' };
  const base = `${cfg.orgUrl.replace(/\/$/, '')}/${encodeURIComponent(cfg.project)}`;

  /** GET and parse JSON. Returns null for 404 so callers can treat it as absent. */
  const getJson = async (url: string): Promise<unknown | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    timer.unref?.();
    try {
      const resp = await doFetch(url, { method: 'GET', headers, signal: ctrl.signal });
      if (resp.status === 404) return null;
      // Path only, no query string and no credential — safe to surface.
      if (!resp.ok) throw new Error(`ADO ${resp.status} for ${url.split('?')[0] ?? url}`);
      return await resp.json();
    } finally {
      clearTimeout(timer);
    }
  };

  const defsRaw = (await getJson(
    `${base}/_apis/build/definitions?api-version=${API_VERSION}`,
  )) as { value?: RawDefinition[] } | null;

  const states: AdoPipelineState[] = [];
  for (const def of defsRaw?.value ?? []) {
    const raw = (await getJson(
      `${base}/_apis/build/latest/${def.id}?api-version=${API_VERSION}`,
    )) as RawBuild | null;

    states.push({
      name: def.name,
      definitionId: def.id,
      defaultBranch: def.repository?.defaultBranch ?? null,
      latest: raw
        ? {
            buildNumber: raw.buildNumber ?? '?',
            result: raw.result ?? null,
            status: raw.status ?? 'unknown',
            finishTime: raw.finishTime ?? null,
            sourceBranch: raw.sourceBranch ?? null,
            sourceVersion: raw.sourceVersion ?? null,
          }
        : null,
    });
  }
  return states;
}
