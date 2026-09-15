export interface HttpProbe {
  name: string;
  url: string;
  ok: boolean;
  status?: number | undefined;
  responseMs?: number | undefined;
  bodySize?: number | undefined;
  error?: string | undefined;
}

export interface HttpProbeFetch {
  (
    url: string,
    init: { method: string; signal?: AbortSignal; redirect?: 'follow' | 'error' | 'manual' },
  ): Promise<HttpProbeResponse>;
}

export interface HttpProbeResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

export interface HttpProbeOptions {
  timeoutMs?: number;
  /** Dependency injection for testing. Defaults to globalThis.fetch. */
  fetch?: HttpProbeFetch;
}

function defaultFetch(): HttpProbeFetch {
  return globalThis.fetch as unknown as HttpProbeFetch;
}

/**
 * GET a URL, return status / body size / response time / error.
 * Does NOT raise on HTTP errors — those land in `ok=false` with a status.
 * Connection-level failures (DNS, refused, TLS error, timeout) land in
 * `ok=false` with `error=…` and no status.
 */
export async function probeHttp(
  name: string,
  url: string,
  options: HttpProbeOptions = {},
): Promise<HttpProbe> {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const fetchImpl = options.fetch ?? defaultFetch();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  timer.unref?.();

  const start = Date.now();
  try {
    const resp = await fetchImpl(url, {
      method: 'GET',
      signal: ctrl.signal,
      redirect: 'follow',
    });
    const body = await resp.text();
    const probe: HttpProbe = {
      name,
      url,
      ok: resp.ok,
      status: resp.status,
      responseMs: Date.now() - start,
      bodySize: body.length,
    };
    return probe;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      name,
      url,
      ok: false,
      error: message,
      responseMs: Date.now() - start,
    };
  } finally {
    clearTimeout(timer);
  }
}
