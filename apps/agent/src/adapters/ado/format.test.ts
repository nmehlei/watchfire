import { describe, expect, it } from 'vitest';
import type { AdoPipelineState } from './client.js';
import {
  adoExitCode,
  classifyPipeline,
  pipelineSlug,
  renderAdoReport,
  resourceId,
} from './format.js';

function state(over: Partial<AdoPipelineState> = {}): AdoPipelineState {
  return {
    name: 'API Service CI',
    definitionId: 1,
    defaultBranch: 'refs/heads/main',
    latest: {
      buildNumber: '482',
      result: 'failed',
      status: 'completed',
      finishTime: '2026-07-03T21:14:00Z',
      sourceBranch: 'refs/heads/main',
      sourceVersion: 'a1b2c3d4e5f6',
    },
    ...over,
  };
}

/** Same pipeline with a different latest-run result. */
function withResult(result: AdoPipelineState['latest'] extends null ? never : string) {
  return state({ latest: { ...state().latest!, result: result as never } });
}

describe('pipelineSlug', () => {
  it('slugifies a pipeline name', () => {
    expect(pipelineSlug('API Service CI')).toBe('api-service-ci');
  });

  it('collapses punctuation and trims separators', () => {
    expect(pipelineSlug('  Web / Frontend (prod)  ')).toBe('web-frontend-prod');
  });
});

describe('resourceId', () => {
  it('builds a stable id from tenant, project and pipeline', () => {
    expect(resourceId('acme', 'Platform Core', 'API Service CI')).toBe(
      'ado.acme.platform-core.api-service-ci',
    );
  });

  it('is stable across renames that differ only in case or spacing', () => {
    expect(resourceId('acme', 'Platform', 'API  Service  CI')).toBe(
      resourceId('acme', 'platform', 'api service ci'),
    );
  });
});

describe('classifyPipeline', () => {
  it('classifies a failed latest run as red', () => {
    expect(classifyPipeline(state())).toBe('red');
  });

  it('classifies a succeeded latest run as ok', () => {
    expect(classifyPipeline(withResult('succeeded'))).toBe('ok');
  });

  it('classifies canceled, partiallySucceeded and none as other — not red', () => {
    for (const r of ['canceled', 'partiallySucceeded', 'none']) {
      expect(classifyPipeline(withResult(r))).toBe('other');
    }
  });

  it('classifies a never-run pipeline as other', () => {
    expect(classifyPipeline(state({ latest: null }))).toBe('other');
  });
});

describe('renderAdoReport', () => {
  it('marks a red pipeline and prints the resource id for the agent to copy', () => {
    const out = renderAdoReport('acme', 'Platform', 'https://dev.azure.com/org', [state()]);

    expect(out).toContain('🔴');
    expect(out).toContain('ado.acme.platform.api-service-ci');
    expect(out).toContain('#482');
    expect(out).toContain('2026-07-03T21:14:00Z');
  });

  it('abbreviates the commit sha', () => {
    const out = renderAdoReport('acme', 'Platform', 'https://dev.azure.com/org', [state()]);

    expect(out).toContain('a1b2c3d');
    expect(out).not.toContain('a1b2c3d4e5f6');
  });

  it('lists a healthy pipeline without a red marker or a resource id', () => {
    const out = renderAdoReport('acme', 'Platform', 'https://dev.azure.com/org', [
      { ...withResult('succeeded'), name: 'web' },
    ]);

    expect(out).not.toContain('🔴');
    expect(out).not.toContain('ado.acme.platform.web');
  });

  it('describes a never-run pipeline as having no runs', () => {
    const out = renderAdoReport('acme', 'Platform', 'https://dev.azure.com/org', [
      state({ latest: null }),
    ]);

    expect(out).toContain('no runs');
    expect(out).not.toContain('🔴');
  });

  it('summarises the pipeline and red counts', () => {
    const out = renderAdoReport('acme', 'Platform', 'https://dev.azure.com/org', [
      state(),
      withResult('succeeded'),
    ]);

    expect(out).toContain('Summary: 2 pipelines, 1 red.');
  });

  it('reports zero pipelines without crashing', () => {
    const out = renderAdoReport('acme', 'Platform', 'https://dev.azure.com/org', []);

    expect(out).toContain('Summary: 0 pipelines, 0 red.');
  });
});

describe('adoExitCode', () => {
  it('returns 1 when any pipeline is red', () => {
    expect(adoExitCode([withResult('succeeded'), state()])).toBe(1);
  });

  it('returns 0 when none are red', () => {
    expect(adoExitCode([withResult('succeeded'), state({ latest: null })])).toBe(0);
  });

  it('returns 0 for no pipelines', () => {
    expect(adoExitCode([])).toBe(0);
  });
});
