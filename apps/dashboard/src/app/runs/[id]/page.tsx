import Link from "next/link";
import { notFound } from "next/navigation";
import { watchfireFetch } from "@/lib/watchfire";
import { FindingsList, Run, type FindingListItem } from "@/lib/schemas";
import { durationSpan, fmtInt, relativeTime } from "@/lib/time";

export const dynamic = "force-dynamic";

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error("run detail fetch failed:", err);
    return null;
  }
}

function statusClass(s: Run["status"]): string {
  switch (s) {
    case "success":
      return "border-emerald-700 bg-emerald-950/30 text-emerald-300";
    case "truncated":
      return "border-amber-700 bg-amber-950/30 text-amber-300";
    case "error":
      return "border-red-700 bg-red-950/40 text-red-300";
    default:
      return "border-zinc-700 text-zinc-400";
  }
}

function severityDot(s: FindingListItem["severity"]): string {
  return s === "critical" ? "bg-red-500" : s === "warn" ? "bg-amber-500" : "bg-sky-500";
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric < 1) notFound();

  const runRes = await watchfireFetch(`/api/runs/${numeric}`);
  if (runRes.status === 404) notFound();

  let runBody: unknown;
  try {
    runBody = await runRes.json();
  } catch {
    runBody = null;
  }

  if (!runRes.ok) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight">Error</h1>
        <p className="text-sm text-zinc-400">
          Watchfire returned{" "}
          <code className="rounded bg-zinc-900 px-1.5 py-0.5">{runRes.status}</code> for run{" "}
          <span className="font-mono">{numeric}</span>.
        </p>
        <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
          {JSON.stringify(runBody, null, 2)}
        </pre>
      </main>
    );
  }

  const parsed = Run.safeParse(runBody);
  if (!parsed.success) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight">Malformed response</h1>
        <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
          {JSON.stringify(runBody, null, 2)}
        </pre>
      </main>
    );
  }

  const run = parsed.data;

  // Findings touched in this run. Fetched in parallel-friendly way (after
  // the run itself, since this only matters if the run loaded).
  const findingsBody = await safe(
    (async () => {
      const res = await watchfireFetch(`/api/runs/${numeric}/findings`);
      if (!res.ok) throw new Error(`Watchfire ${res.status}`);
      return res.json();
    })(),
  );
  const findings = findingsBody ? FindingsList.safeParse(findingsBody) : null;
  const touched = findings?.success ? findings.data.findings : [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <BackLink />

      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
            {run.type}
          </span>
          <span className="font-mono text-zinc-400">#{run.id}</span>
          <span className="text-xs text-zinc-500">{run.trigger}</span>
          {run.verdict && (
            <span className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
              verdict: {run.verdict}
            </span>
          )}
          <span
            className={`rounded-md border px-2 py-0.5 text-xs ${statusClass(run.status)}`}
          >
            {run.status ?? "in-flight"}
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Run {run.id} — {run.type}
        </h1>
        <div className="text-xs text-zinc-500">
          started {relativeTime(run.started_at)} ({run.started_at})
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="duration" value={durationSpan(run.started_at, run.completed_at)} />
        <Metric label="findings" value={fmtInt(run.finding_count)} />
        <Metric label="turns" value={fmtInt(run.turn_count)} />
        <Metric
          label="cost"
          value={run.cost_eur != null ? `€${run.cost_eur.toFixed(4)}` : "—"}
        />
        <Metric label="tokens in" value={fmtInt(run.tokens_in)} />
        <Metric label="tokens out" value={fmtInt(run.tokens_out)} />
        <Metric
          label="tokens cached"
          value={fmtInt(run.tokens_cached)}
          hint={
            run.tokens_in + run.tokens_out > 0
              ? `${Math.round(
                  (run.tokens_cached /
                    (run.tokens_cached + run.tokens_in + run.tokens_out)) *
                    100,
                )}% cache hit`
              : undefined
          }
        />
        <Metric
          label="page sent"
          value={run.page_sent == null ? "—" : run.page_sent ? "yes" : "no"}
        />
      </section>

      {run.error && (
        <section className="rounded-lg border border-red-900/60 bg-red-950/20 p-4 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wide text-red-300">error</div>
          <pre className="whitespace-pre-wrap break-words text-red-200">{run.error}</pre>
        </section>
      )}

      {run.transcript_path && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 text-sm">
          <div className="mb-1 text-xs uppercase tracking-wide text-zinc-500">
            transcript
          </div>
          <code className="break-all font-mono text-xs text-zinc-400">
            {run.transcript_path}
          </code>
          <p className="mt-1 text-xs text-zinc-600">
            on-disk on the Watchfire host; not streamed to the dashboard in v1.
          </p>
        </section>
      )}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
        <header className="border-b border-zinc-800 px-4 py-3 text-xs uppercase tracking-wide text-zinc-500">
          findings touched ({touched.length})
        </header>
        {touched.length > 0 ? (
          <ul className="divide-y divide-zinc-800">
            {touched.map((f) => (
              <li key={f.fingerprint} className="hover:bg-zinc-900/60">
                <Link
                  href={`/findings/${f.short_id}`}
                  className="block px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`h-2 w-2 rounded-full ${severityDot(f.severity)}`} />
                        <span className="truncate font-medium">{f.title}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-zinc-500">
                        <span>{f.short_id}</span>
                        <span>{f.resource_id}</span>
                        {f.affects.length > 0 && <span>[{f.affects.join(", ")}]</span>}
                      </div>
                    </div>
                    <span className="shrink-0 rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
                      {f.state}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            no findings recorded in this run
          </div>
        )}
      </section>
    </main>
  );
}

function BackLink() {
  return (
    <Link href="/runs" className="text-xs text-zinc-400 hover:text-zinc-200">
      ← runs
    </Link>
  );
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-zinc-600">{hint}</div>}
    </div>
  );
}
