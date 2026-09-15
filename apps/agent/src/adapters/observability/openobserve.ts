// OpenObserve HTTP client. Basic-auth only for v1; token support can layer on
// later without breaking the call sites.

export interface OpenObserveClientConfig {
  url: string; // e.g. https://openobserve.example.com
  user: string;
  password: string;
  org?: string; // default 'default'
  /** Injection for tests. */
  fetch?: HttpFetch;
  timeoutMs?: number;
}

export interface HttpFetch {
  (
    url: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      signal?: AbortSignal;
    },
  ): Promise<HttpResponse>;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

function defaultFetch(): HttpFetch {
  return globalThis.fetch as unknown as HttpFetch;
}

function authHeader(user: string, password: string): string {
  return 'Basic ' + Buffer.from(`${user}:${password}`, 'utf8').toString('base64');
}

function baseUrl(cfg: OpenObserveClientConfig): string {
  return cfg.url.replace(/\/$/, '');
}

function org(cfg: OpenObserveClientConfig): string {
  return cfg.org ?? 'default';
}

/** Parse a relative duration like "1h", "30m", "24h", "7d" into milliseconds. */
export function parseDuration(s: string): number {
  const m = /^(\d+)([smhd])$/.exec(s.trim());
  if (!m) throw new Error(`invalid duration: ${s} (expected e.g. 1h, 30m, 7d)`);
  const n = Number(m[1]);
  const unit = m[2];
  const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
  return n * factor;
}

export interface SearchLogsInput {
  stream: string;
  /** Freeform match; implemented via SQL LIKE on the full record. */
  match?: string;
  /** Raw SQL — if given, overrides `match`. The caller is responsible for safety. */
  sql?: string;
  sinceMs: number; // window end is "now"
  limit: number;
}

export interface SearchHit {
  timestamp: string; // ISO 8601
  level: string | undefined;
  service: string | undefined;
  message: string;
  /** The full record, for callers that want to inspect extras. */
  raw: Record<string, unknown>;
}

export interface SearchLogsResult {
  hits: SearchHit[];
  total: number;
  tookMs: number;
}

/**
 * POST /api/{org}/_search. SQL-based query; window is [now-since, now].
 * The stream is named in the SQL FROM clause; the endpoint is org-scoped.
 * For the common case use {match}; drop down to {sql} for anything complex.
 */
export async function searchLogs(
  cfg: OpenObserveClientConfig,
  input: SearchLogsInput,
): Promise<SearchLogsResult> {
  const stream = input.stream;
  const endUs = Date.now() * 1000;
  const startUs = endUs - input.sinceMs * 1000;
  const sql = input.sql ?? buildMatchSql(stream, input.match, input.limit);

  const body = JSON.stringify({
    query: {
      sql,
      start_time: startUs,
      end_time: endUs,
      size: input.limit,
    },
  });

  const path = `${baseUrl(cfg)}/api/${org(cfg)}/_search`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs ?? 15_000);
  timer.unref?.();

  const fetchImpl = cfg.fetch ?? defaultFetch();
  let resp: HttpResponse;
  try {
    resp = await fetchImpl(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: authHeader(cfg.user, cfg.password),
      },
      body,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`obs-search: ${resp.status} ${text.slice(0, 300)}`);
  }

  // Parse defensively — OO response shape varies slightly across versions.
  const parsed = safeParseJson(text);
  const rawHits = extractHits(parsed);
  const hits: SearchHit[] = rawHits.map((h) => {
    const tsValue = h['_timestamp'];
    const timestamp =
      typeof tsValue === 'number'
        ? new Date(Math.floor(tsValue / 1000)).toISOString()
        : typeof tsValue === 'string'
          ? tsValue
          : '';
    return {
      timestamp,
      level: stringOrUndef(h['level'] ?? h['severity'] ?? h['log_level']),
      service: stringOrUndef(h['service'] ?? h['app'] ?? h['service_name']),
      message: stringOrUndef(h['message'] ?? h['log'] ?? h['msg'] ?? h['body']) ?? '',
      raw: h,
    };
  });

  const total =
    typeof (parsed as Record<string, unknown>)['total'] === 'number'
      ? ((parsed as Record<string, unknown>)['total'] as number)
      : hits.length;
  const tookMs =
    typeof (parsed as Record<string, unknown>)['took'] === 'number'
      ? ((parsed as Record<string, unknown>)['took'] as number)
      : 0;

  return { hits, total, tookMs };
}

export interface StreamInfo {
  name: string;
  type: string | undefined;
  storageType: string | undefined;
}

/** GET /api/{org}/streams — list stream names + a bit of metadata. */
export async function listStreams(cfg: OpenObserveClientConfig): Promise<StreamInfo[]> {
  const path = `${baseUrl(cfg)}/api/${org(cfg)}/streams`;
  const fetchImpl = cfg.fetch ?? defaultFetch();
  const resp = await fetchImpl(path, {
    method: 'GET',
    headers: {
      Authorization: authHeader(cfg.user, cfg.password),
    },
  });
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`obs-streams: ${resp.status} ${text.slice(0, 300)}`);
  }
  const parsed = safeParseJson(text);
  const list =
    (parsed as Record<string, unknown>)['list'] ??
    (parsed as Record<string, unknown>)['streams'] ??
    parsed;
  if (!Array.isArray(list)) return [];
  return list.map((entry) => {
    const r = entry as Record<string, unknown>;
    return {
      name: String(r['name'] ?? '?'),
      type: stringOrUndef(r['stream_type'] ?? r['type']),
      storageType: stringOrUndef(r['storage_type']),
    };
  });
}

function buildMatchSql(stream: string, match: string | undefined, limit: number): string {
  const table = quoteIdent(stream);
  if (match && match.trim().length > 0) {
    const escaped = match.replace(/'/g, "''");
    // OpenObserve full-text function: searches across all indexed text
    // fields of the stream. Agents that need exact-field control should
    // drop to --sql with `body LIKE '%…%'` or similar.
    return `SELECT * FROM ${table} WHERE match_all('${escaped}') ORDER BY _timestamp DESC LIMIT ${limit}`;
  }
  return `SELECT * FROM ${table} ORDER BY _timestamp DESC LIMIT ${limit}`;
}

function quoteIdent(id: string): string {
  return '"' + id.replace(/"/g, '""') + '"';
}

function safeParseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
}

function extractHits(parsed: unknown): Array<Record<string, unknown>> {
  const p = parsed as Record<string, unknown>;
  if (Array.isArray(p['hits'])) return p['hits'] as Array<Record<string, unknown>>;
  // OpenSearch-style nesting fallback.
  const hitsField = p['hits'];
  if (hitsField && typeof hitsField === 'object' && Array.isArray((hitsField as Record<string, unknown>)['hits'])) {
    return (hitsField as Record<string, unknown>)['hits'] as Array<Record<string, unknown>>;
  }
  return [];
}

function stringOrUndef(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
