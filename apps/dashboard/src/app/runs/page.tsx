import Link from "next/link";
import type { Route } from "next";
import { irisJson } from "@/lib/watchfire";
import { RunsList, type Run, type RunType } from "@/lib/schemas";
import { durationSpan, parseSqliteUtc, relativeTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const ALL_TYPES = ["nightly", "watch", "manual"] as const satisfies readonly RunType[];

interface RunsSearchParams {
  type?: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error("runs fetch failed:", err);
    return null;
  }
}

function chipClass(active: boolean): string {
  return active
    ? "border-zinc-500 bg-zinc-800 text-zinc-100"
    : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900";
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

function toggleType(current: RunsSearchParams, value: RunType): Route {
  const next = current.type === value ? undefined : value;
  return (next ? `/runs?type=${next}` : "/runs") as Route;
}

export default async function RunsListPage({
  searchParams,
}: {
  searchParams: Promise<RunsSearchParams>;
}) {
  const params = await searchParams;
  const typeFilter =
    params.type && (ALL_TYPES as readonly string[]).includes(params.type)
      ? (params.type as RunType)
      : undefined;

  const query = new URLSearchParams({ limit: "50" });
  if (typeFilter) query.set("type", typeFilter);

  const data = await safe(irisJson<unknown>(`/api/runs?${query.toString()}`));
  const parsed = data ? RunsList.safeParse(data) : null;
  const rows = parsed?.success
    ? [...parsed.data.runs].sort(
        (a, b) => parseSqliteUtc(b.started_at) - parseSqliteUtc(a.started_at),
      )
    : [];
  const total = parsed?.success ? parsed.data.total : 0;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
        <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-200">
          ← overview
        </Link>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <span className="w-16 shrink-0 text-xs uppercase tracking-wide text-zinc-500">type</span>
        <div className="flex flex-wrap gap-2">
          {ALL_TYPES.map((t) => (
            <Link
              key={t}
              href={toggleType(params, t)}
              className={`inline-flex items-center rounded-md border px-2 py-1 text-xs ${chipClass(
                params.type === t,
              )}`}
            >
              {t}
            </Link>
          ))}
        </div>
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
        {rows.length > 0 ? (
          <ul className="divide-y divide-zinc-800">
            {rows.map((r) => (
              <RunRow key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            {parsed?.success ? "no runs match" : "failed to load runs"}
          </div>
        )}
        <footer className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          showing {rows.length} of {total}
          {total >= 50 && " (limit reached — Watchfire caps at 50)"}
        </footer>
      </section>
    </main>
  );
}

function RunRow({ r }: { r: Run }) {
  return (
    <li className="hover:bg-zinc-900/60">
      <Link href={`/runs/${r.id}`} className="block px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">
                {r.type}
              </span>
              <span className="font-mono text-zinc-400">#{r.id}</span>
              <span className="text-zinc-500">{r.trigger}</span>
              {r.verdict && (
                <span className="rounded-md border border-zinc-700 px-1.5 py-0.5 text-xs text-zinc-300">
                  {r.verdict}
                </span>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-zinc-500">
              <span>{relativeTime(r.started_at)}</span>
              <span>· {durationSpan(r.started_at, r.completed_at)}</span>
              <span>· {r.finding_count} findings</span>
              <span>· {r.turn_count} turns</span>
              {r.cost_eur != null && <span>· €{r.cost_eur.toFixed(4)}</span>}
              {r.error && <span className="text-red-400">err</span>}
            </div>
          </div>
          <span
            className={`shrink-0 rounded-md border px-2 py-0.5 text-xs ${statusClass(r.status)}`}
          >
            {r.status ?? "in-flight"}
          </span>
        </div>
      </Link>
    </li>
  );
}
