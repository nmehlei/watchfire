import { describe, expect, it } from 'vitest';
import { fetchPipelineStates, type AdoClientConfig, type AdoFetch } from './client.js';

const cfg: AdoClientConfig = {
  orgUrl: 'https://dev.azure.com/org',
  project: 'Proj',
  pat: 'secret-pat',
};

/** An AdoFetch returning canned JSON keyed by URL substring. */
function stubFetch(routes: Array<[string, unknown]>): AdoFetch {
  return async (url: string) => {
    const hit = routes.find(([frag]) => url.includes(frag));
    if (!hit) throw new Error(`unexpected url: ${url}`);
    return { ok: true, status: 200, json: async () => hit[1] };
  };
}

const oneDefinition = {
  value: [{ id: 10, name: 'api-ci', repository: { defaultBranch: 'refs/heads/main' } }],
};

describe('fetchPipelineStates', () => {
  it('returns each pipeline with its latest build', async () => {
    const fetch = stubFetch([
      ['/_apis/build/definitions', oneDefinition],
      [
        '/_apis/build/latest/10',
        {
          buildNumber: '482',
          result: 'failed',
          status: 'completed',
          finishTime: '2026-07-03T21:14:00Z',
          sourceBranch: 'refs/heads/main',
          sourceVersion: 'a1b2c3d4e5f6',
        },
      ],
    ]);

    expect(await fetchPipelineStates(cfg, { fetch })).toEqual([
      {
        name: 'api-ci',
        definitionId: 10,
        defaultBranch: 'refs/heads/main',
        latest: {
          buildNumber: '482',
          result: 'failed',
          status: 'completed',
          finishTime: '2026-07-03T21:14:00Z',
          sourceBranch: 'refs/heads/main',
          sourceVersion: 'a1b2c3d4e5f6',
        },
      },
    ]);
  });

  it('reports a pipeline that has never run as latest=null', async () => {
    // ADO answers 404 on the `latest` endpoint when no build exists.
    const fetch: AdoFetch = async (url) =>
      url.includes('/_apis/build/definitions')
        ? { ok: true, status: 200, json: async () => oneDefinition }
        : { ok: false, status: 404, json: async () => ({}) };

    const states = await fetchPipelineStates(cfg, { fetch });

    expect(states[0]!.latest).toBeNull();
  });

  it('returns an empty list when the project has no pipelines', async () => {
    const fetch = stubFetch([['/_apis/build/definitions', { value: [] }]]);

    expect(await fetchPipelineStates(cfg, { fetch })).toEqual([]);
  });

  it('authenticates with Basic auth built from the PAT and an empty username', async () => {
    let seenAuth: string | undefined;
    const fetch: AdoFetch = async (_url, init) => {
      seenAuth = init?.headers?.['Authorization'];
      return { ok: true, status: 200, json: async () => ({ value: [] }) };
    };

    await fetchPipelineStates(cfg, { fetch });

    expect(seenAuth).toBe('Basic ' + Buffer.from(':secret-pat').toString('base64'));
  });

  it('throws on a non-404 error status without leaking the PAT', async () => {
    const fetch: AdoFetch = async () => ({ ok: false, status: 401, json: async () => ({}) });

    // The message must be diagnosable but must never contain the credential.
    await expect(fetchPipelineStates(cfg, { fetch })).rejects.toThrow(/401/);
    await expect(fetchPipelineStates(cfg, { fetch })).rejects.not.toThrow(/secret-pat/);
  });

  it('tolerates a definition with no repository default branch', async () => {
    const fetch = stubFetch([
      ['/_apis/build/definitions', { value: [{ id: 3, name: 'orphan' }] }],
      ['/_apis/build/latest/3', { buildNumber: '1', result: 'succeeded', status: 'completed' }],
    ]);

    const states = await fetchPipelineStates(cfg, { fetch });

    expect(states[0]!.defaultBranch).toBeNull();
    expect(states[0]!.latest?.finishTime).toBeNull();
  });
});
