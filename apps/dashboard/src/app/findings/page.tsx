import Link from "next/link";
import type { Route } from "next";
import { watchfireJson } from "@/lib/watchfire";
import {
  FindingsList,
  type FindingListItem,
  type FindingState,
  type Severity,
} from "@/lib/schemas";
import { parseSqliteUtc, relativeTime } from "@/lib/time";

export const dynamic = "force-dynamic";

const ALL_SEVERITY = ["critical", "warn", "info"] as const satisfies readonly Severity[];
const ALL_STATE = ["new", "ongoing", "escalating", "resolved"] as const satisfies readonly FindingState[];

interface FindingsSearchParams {
  severity?: string;
  state?: string;
  tenant?: string;
  muted?: string;
  resolved?: string;
}

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error("findings fetch failed:", err);
    return null;
  }
}

function severityChipClass(s: Severity, active: boolean): string {
  const palette =
    s === "critical"
      ? "border-red-700 text-red-300"
      : s === "warn"
        ? "border-amber-700 text-amber-300"
        : "border-sky-700 text-sky-300";
  return active
    ? `${palette} bg-zinc-800`
    : `${palette} bg-zinc-950 hover:bg-zinc-900`;
}

function stateChipClass(active: boolean): string {
  return active
    ? "border-zinc-500 bg-zinc-800 text-zinc-100"
    : "border-zinc-700 bg-zinc-950 text-zinc-300 hover:bg-zinc-900";
}

function severityDot(s: Severity): string {
  return s === "critical" ? "bg-red-500" : s === "warn" ? "bg-amber-500" : "bg-sky-500";
}

function withParam(
  current: FindingsSearchParams,
  key: keyof FindingsSearchParams,
  value: string | undefined,
): Route {
  const qs = new URLSearchParams();
  const merged = { ...current, [key]: value };
  for (const [k, v] of Object.entries(merged)) {
    if (v) qs.set(k, v);
  }
  const s = qs.toString();
  return (s ? `/findings?${s}` : "/findings") as Route;
}

function toggleParam(
  current: FindingsSearchParams,
  key: keyof FindingsSearchParams,
  value: string,
): Route {
  return withParam(current, key, current[key] === value ? undefined : value);
}

export default async function FindingsListPage({
  searchParams,
}: {
  searchParams: Promise<FindingsSearchParams>;
}) {
  const params = await searchParams;
  const showResolved = params.resolved === "show";

  // Always fetch the full picture (resolved + muted included) and filter
  // client-side. This lets the page report how many resolved findings
  // exist even when the active view is empty — so an all-resolved moment
  // (e.g. right after a nightly clears everything) doesn't look broken.
  const data = await safe(
    watchfireJson<unknown>("/api/findings?limit=50&include_resolved=true&include_muted=true"),
  );
  const parsed = data ? FindingsList.safeParse(data) : null;
  const all = parsed?.success ? parsed.data.findings : [];
  const total = parsed?.success ? parsed.data.total : 0;
  const resolvedCount = all.filter((f) => f.state === "resolved").length;

  // Client-side filters (Watchfire doesn't accept these server-side yet —
  // see CLAUDE.md/spec 11 for the constraint).
  let rows = all;
  if (!showResolved) {
    rows = rows.filter((f) => f.state !== "resolved");
  }
  if (params.severity && (ALL_SEVERITY as readonly string[]).includes(params.severity)) {
    rows = rows.filter((f) => f.severity === params.severity);
  }
  if (params.state && (ALL_STATE as readonly string[]).includes(params.state)) {
    rows = rows.filter((f) => f.state === params.state);
  }
  if (params.tenant) {
    rows = rows.filter((f) => f.affects.includes(params.tenant!));
  }
  if (params.muted === "hide") {
    rows = rows.filter((f) => !f.muted);
  }

  // Tenants visible in the current dataset — drives the tenant chip set.
  const tenants = Array.from(new Set(all.flatMap((f) => f.affects))).sort();

  rows = [...rows].sort(
    (a, b) => parseSqliteUtc(b.last_seen_at) - parseSqliteUtc(a.last_seen_at),
  );

  // When the active view is empty but resolved findings exist, offer a
  // one-click path to them rather than a dead-end "nothing here".
  const showResolvedHref = withParam(params, "resolved", "show");

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Findings</h1>
        <Link
          href="/"
          className="text-xs text-zinc-400 hover:text-zinc-200"
        >
          ← overview
        </Link>
      </header>

      <div className="flex flex-col gap-3">
        <FilterRow label="severity">
          {ALL_SEVERITY.map((s) => (
            <Link
              key={s}
              href={toggleParam(params, "severity", s)}
              className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs ${severityChipClass(
                s,
                params.severity === s,
              )}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${severityDot(s)}`} />
              {s}
            </Link>
          ))}
        </FilterRow>

        <FilterRow label="state">
          {ALL_STATE.map((st) => (
            <Link
              key={st}
              href={toggleParam(params, "state", st)}
              className={`inline-flex items-center rounded-md border px-2 py-1 text-xs ${stateChipClass(
                params.state === st,
              )}`}
            >
              {st}
            </Link>
          ))}
        </FilterRow>

        {tenants.length > 0 && (
          <FilterRow label="tenant">
            {tenants.map((t) => (
              <Link
                key={t}
                href={toggleParam(params, "tenant", t)}
                className={`inline-flex items-center rounded-md border px-2 py-1 text-xs ${stateChipClass(
                  params.tenant === t,
                )}`}
              >
                {t}
              </Link>
            ))}
          </FilterRow>
        )}

        <FilterRow label="view">
          <Link
            href={toggleParam(params, "muted", "hide")}
            className={`inline-flex items-center rounded-md border px-2 py-1 text-xs ${stateChipClass(
              params.muted === "hide",
            )}`}
          >
            hide muted
          </Link>
          <Link
            href={toggleParam(params, "resolved", "show")}
            className={`inline-flex items-center rounded-md border px-2 py-1 text-xs ${stateChipClass(
              params.resolved === "show",
            )}`}
          >
            include resolved
          </Link>
        </FilterRow>
      </div>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
        {rows.length > 0 ? (
          <ul className="divide-y divide-zinc-800">
            {rows.map((f) => (
              <FindingRow key={f.fingerprint} f={f} />
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-zinc-500">
            {!parsed?.success ? (
              <span>failed to load findings</span>
            ) : !showResolved && resolvedCount > 0 ? (
              <>
                <span>no active findings 🎉</span>
                <Link
                  href={showResolvedHref}
                  className="rounded-md border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
                >
                  show {resolvedCount} resolved →
                </Link>
              </>
            ) : (
              <span>no findings match the current filters</span>
            )}
          </div>
        )}
        <footer className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          showing {rows.length} of {total}
          {resolvedCount > 0 && !showResolved && ` · ${resolvedCount} resolved hidden`}
          {total >= 50 && " · limit reached (Watchfire caps at 50; filter to narrow)"}
        </footer>
      </section>
    </main>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-16 shrink-0 text-xs uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

function FindingRow({ f }: { f: FindingListItem }) {
  return (
    <li className="hover:bg-zinc-900/60">
      <Link href={`/findings/${f.short_id}`} className="block px-4 py-3">
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
              <span>{f.issue_class}</span>
              <span>· {f.run_count}× · {relativeTime(f.last_seen_at)}</span>
              {f.muted && <span className="text-zinc-400">muted</span>}
              {f.escalating && <span className="text-amber-400">↑ escalating</span>}
            </div>
          </div>
          <span
            className={`shrink-0 rounded-md border px-2 py-0.5 text-xs ${
              f.state === "resolved"
                ? "border-emerald-700 bg-emerald-950/30 text-emerald-300"
                : f.severity === "critical"
                  ? "border-red-700 bg-red-950/40 text-red-300"
                  : f.severity === "warn"
                    ? "border-amber-700 bg-amber-950/30 text-amber-300"
                    : "border-sky-700 bg-sky-950/30 text-sky-300"
            }`}
          >
            {f.state}
          </span>
        </div>
      </Link>
    </li>
  );
}
