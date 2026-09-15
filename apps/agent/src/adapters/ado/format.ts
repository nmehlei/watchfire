// Pure classification + rendering for check-ado (spec 03 §Adapter: Azure DevOps).

import type { AdoPipelineState } from './client.js';

export type AdoClass = 'red' | 'ok' | 'other';

export function pipelineSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Stable finding identity for a pipeline: `ado.<tenant>.<project>.<pipeline>`.
 *
 * Fingerprints are `(resource_id, issue_class)` (spec 06), so this value must
 * be identical night over night for a red build to age as one finding rather
 * than reappearing as a new one.
 */
export function resourceId(tenant: string, project: string, pipelineName: string): string {
  return `ado.${tenant}.${pipelineSlug(project)}.${pipelineSlug(pipelineName)}`;
}

/**
 * Red iff the latest default-branch run failed. `canceled`,
 * `partiallySucceeded`, `none` and never-run are deliberately not findings
 * (spec 03) — they are reported as info lines only.
 */
export function classifyPipeline(state: AdoPipelineState): AdoClass {
  const result = state.latest?.result;
  if (result === 'failed') return 'red';
  if (result === 'succeeded') return 'ok';
  return 'other';
}

function shortSha(sha: string | null): string {
  return sha ? sha.slice(0, 7) : '?';
}

export function renderAdoReport(
  tenant: string,
  project: string,
  orgUrl: string,
  states: readonly AdoPipelineState[],
): string {
  const org = orgUrl.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const lines: string[] = [`Azure DevOps — ${tenant} / ${project} (${org})`, ''];

  let red = 0;
  for (const s of states) {
    const b = s.latest;
    const when = b?.finishTime ?? 'never';

    if (classifyPipeline(s) === 'red') {
      red++;
      lines.push(
        `🔴 ${s.name}  build #${b?.buildNumber ?? '?'} failed  ${when}  ` +
          `commit ${shortSha(b?.sourceVersion ?? null)}`,
      );
      // Printed verbatim so the agent copies it rather than inventing a slug.
      lines.push(`   ${resourceId(tenant, project, s.name)}  (emit build-red, warn)`);
    } else {
      lines.push(`   ${s.name}  ${b ? (b.result ?? b.status) : 'no runs'}  ${when}`);
    }
  }

  lines.push('', `Summary: ${states.length} pipelines, ${red} red.`);
  return lines.join('\n');
}

export function adoExitCode(states: readonly AdoPipelineState[]): number {
  return states.some((s) => classifyPipeline(s) === 'red') ? 1 : 0;
}
