import { tool } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod/v4';
import type { Db } from '../../memory/index.js';
import { ISSUE_CLASSES, upsertFinding, type AgentFinding, type IssueClass } from '../../memory/index.js';
import { getEventBus } from '../../api/events/bus.js';

// Type-level cast — zod needs a tuple for z.enum().
const ISSUE_CLASS_VALUES = [...ISSUE_CLASSES] as [IssueClass, ...IssueClass[]];

export const EMIT_FINDING_TOOL_NAME = 'emit_finding';

/**
 * Build the `emit_finding` SDK tool for a specific run. Each run gets its own
 * closure so the tool's handler can upsert into memory tagged with the run id.
 *
 * Registered via createSdkMcpServer({name:'iris', tools:[...]}) and visible
 * to the model as `mcp__iris__emit_finding`.
 */
export function createEmitFindingTool(db: Db, runId: number) {
  return tool(
    EMIT_FINDING_TOOL_NAME,
    'Record a finding. Call as soon as you identify one. Deduplication is handled by fingerprint — duplicate emits in the same run are tolerated but wasteful.',
    {
      resource_id: z.string().min(1).describe('Canonical resource slug (e.g. sql.acme.internal), tenant:<id>, or global.'),
      issue_class: z.enum(ISSUE_CLASS_VALUES).describe('One of the IssueClass enum values.'),
      severity: z.enum(['info', 'warn', 'critical']).describe('Severity level.'),
      title: z.string().min(1).max(140).describe('One-line title, <=140 chars.'),
      evidence: z.string().min(1).max(2000).describe('Prose or bullets, <=2000 chars.'),
      likely_cause: z.string().max(2000).optional().describe('Optional prose.'),
    },
    async (args) => {
      const finding: AgentFinding = {
        resource_id: args.resource_id,
        issue_class: args.issue_class,
        severity: args.severity,
        title: args.title,
        evidence: args.evidence,
        ...(args.likely_cause ? { likely_cause: args.likely_cause } : {}),
      };

      try {
        const result = upsertFinding(db, runId, finding);
        getEventBus().emitFindingUpserted(result.fingerprint, result.state);
        const shortFp = result.fingerprint.slice(0, 16);
        return {
          content: [
            {
              type: 'text' as const,
              text: `finding recorded: ${shortFp} (${result.state}${result.inserted ? ', new row' : ''})`,
            },
          ],
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: 'text' as const, text: `emit-finding failed: ${message}` }],
          isError: true,
        };
      }
    },
  );
}
