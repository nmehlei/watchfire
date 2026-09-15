import { z } from 'zod';

/**
 * Expected OpenObserve webhook payload subset. See specs/05-watch.md §Intake.
 * OO payloads carry more fields; we parse only what triage needs and pass
 * the rest through in `raw`.
 */
export const OpenObserveAlertSchema = z.object({
  alert_name: z.string().min(1),
  stream: z.string().min(1),
  severity: z.string().min(1),
  fired_at: z.string().min(1),
  description: z.string().optional().default(''),
  labels: z.record(z.string(), z.string()).optional().default({}),
  evaluation: z
    .object({
      query: z.string().optional(),
      value: z.number().optional(),
      threshold: z.number().optional(),
    })
    .partial()
    .optional(),
});

export type OpenObserveAlert = z.infer<typeof OpenObserveAlertSchema>;

export interface ParsedAlert {
  alert: OpenObserveAlert;
  /** Raw JSON body as received — retained for transcript archival. */
  rawBody: string;
}

export type ParseResult =
  | { ok: true; parsed: ParsedAlert }
  | { ok: false; reason: string };

/**
 * Parse + validate a raw OpenObserve webhook body.
 */
export function parseOpenObservePayload(rawBody: string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch (err) {
    return { ok: false, reason: `invalid JSON: ${(err as Error).message}` };
  }

  const parsed = OpenObserveAlertSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, reason: `schema mismatch: ${parsed.error.issues[0]?.message ?? 'unknown'}` };
  }
  return { ok: true, parsed: { alert: parsed.data, rawBody } };
}

/**
 * Concise free-text summary for Telegram pages and agent prompts.
 * Stable shape: "<alert_name>: <description> (value/threshold if present)".
 */
export function summarizeAlert(alert: OpenObserveAlert): string {
  const bits: string[] = [alert.alert_name];
  if (alert.description) bits.push(alert.description);
  if (alert.evaluation?.value !== undefined && alert.evaluation.threshold !== undefined) {
    bits.push(`(value=${alert.evaluation.value} threshold=${alert.evaluation.threshold})`);
  }
  return bits.join(' — ');
}
