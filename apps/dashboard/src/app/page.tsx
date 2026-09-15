import Link from "next/link";
import { LogOut } from "lucide-react";
import { auth, signOut } from "@/auth";
import { Sparkline } from "@/components/Sparkline";
import { watchfireJson } from "@/lib/watchfire";
import {
  AdapterHealth,
  CostWindow,
  FindingListItem,
  FindingsList,
  RunsList,
  type Run,
  type Severity,
} from "@/lib/schemas";
import { parseSqliteUtc, relativeTime } from "@/lib/time";

export const dynamic = "force-dynamic";

// Severity ranking for "top N" ordering. Higher = more important.
const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 3, warn: 2, info: 1 };

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error("overview fetch failed:", err);
    return null;
  }
}

function startOfMonthMs(now: Date = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
}

function severityCounts(findings: FindingListItem[]) {
  const active = findings.filter((f) => f.state !== "resolved");
  return {
    critical: active.filter((f) => f.severity === "critical").length,
    warn: active.filter((f) => f.severity === "warn").length,
    info: active.filter((f) => f.severity === "info").length,
    total: active.length,
  };
}

function topFindings(findings: FindingListItem[], n: number): FindingListItem[] {
  return [...findings]
    .filter((f) => f.state !== "resolved")
    .sort((a, b) => {
      const w = SEVERITY_WEIGHT[b.severity] - SEVERITY_WEIGHT[a.severity];
      if (w !== 0) return w;
      return parseSqliteUtc(b.last_seen_at) - parseSqliteUtc(a.last_seen_at);
    })
    .slice(0, n);
}

function severityColors(s: Severity): string {
  switch (s) {
    case "critical":
      return "border-red-700 bg-red-950/40 text-red-300";
    case "warn":
      return "border-amber-700 bg-amber-950/30 text-amber-300";
    case "info":
      return "border-sky-700 bg-sky-950/30 text-sky-300";
  }
}

function severityDot(s: Severity): string {
  return s === "critical" ? "bg-red-500" : s === "warn" ? "bg-amber-500" : "bg-sky-500";
}

function runStatusPill(run: Run | undefined) {
  if (!run) return { label: "no nightly yet", className: "border-zinc-700 text-zinc-400" };
  const className =
    run.status === "success"
      ? "border-emerald-700 bg-emerald-950/30 text-emerald-300"
      : run.status === "truncated"
        ? "border-amber-700 bg-amber-950/30 text-amber-300"
        : run.status === "error"
          ? "border-red-700 bg-red-950/40 text-red-300"
          : "border-zinc-700 text-zinc-400";
  return { label: run.status ?? "in-flight", className };
}

export default async function OverviewPage() {
  const session = await auth();

  // Fetch in parallel — none of these blocks the others; a single
  // failing endpoint degrades just its section.
  const [findingsRes, runsRes, costRes, adaptersRes] = await Promise.all([
    // Watchfire caps limit at 50 (spec 11 safety). Severity counts are
    // accurate up to that ceiling; if total active findings ever
    // exceeds 50, add a dedicated counts endpoint upstream.
    safe(watchfireJson<unknown>("/api/findings?limit=50")),
    safe(watchfireJson<unknown>("/api/runs?type=nightly&limit=1")),
    safe(watchfireJson<unknown>("/api/cost-window?days=30")),
    safe(watchfireJson<unknown>("/api/adapters/health")),
  ]);

  const findings = findingsRes ? FindingsList.safeParse(findingsRes) : null;
  const runs = runsRes ? RunsList.safeParse(runsRes) : null;
  const cost = costRes ? CostWindow.safeParse(costRes) : null;
  const adapters = adaptersRes ? AdapterHealth.safeParse(adaptersRes) : null;

  const sev = findings?.success
    ? severityCounts(findings.data.findings)
    : { critical: 0, warn: 0, info: 0, total: 0 };
  const lastNightly = runs?.success ? runs.data.runs[0] : undefined;
  const top5 = findings?.success ? topFindings(findings.data.findings, 5) : [];

  const monthStart = startOfMonthMs();
  const mtdCost = cost?.success
    ? cost.data.daily_buckets
        .filter((b) => Date.parse(`${b.date}T00:00:00Z`) >= monthStart)
        .reduce((s, b) => s + b.eur, 0)
    : 0;
  const sparklineData = cost?.success ? cost.data.daily_buckets : [];

  const status = runStatusPill(lastNightly);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Watchfire</h1>
        {session?.user?.name && (
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 rounded-md border border-zinc-700 px-3 py-1.5 text-sm hover:bg-zinc-800"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Sign out · {session.user.name}
            </button>
          </form>
        )}
      </header>

      {/* Top stripe: severity counts + nightly pill + MTD cost */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <SeverityStat label="critical" count={sev.critical} severity="critical" />
        <SeverityStat label="warn" count={sev.warn} severity="warn" />
        <SeverityStat label="info" count={sev.info} severity="info" />
        <div className="col-span-2 flex flex-col justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 sm:col-span-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">last nightly</span>
          <span
            className={`mt-1 inline-flex w-fit items-center rounded-md border px-2 py-0.5 text-xs font-medium ${status.className}`}
          >
            {status.label}
          </span>
          {lastNightly?.completed_at && (
            <span className="mt-1 text-xs text-zinc-500">
              {relativeTime(lastNightly.completed_at)}
            </span>
          )}
        </div>
        <div className="col-span-2 flex flex-col justify-between rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 sm:col-span-1">
          <span className="text-xs uppercase tracking-wide text-zinc-500">MTD cost</span>
          <span className="mt-1 text-lg font-semibold">€{mtdCost.toFixed(2)}</span>
          {cost?.success && (
            <span className="text-xs text-zinc-500">
              30d €{cost.data.total_eur.toFixed(2)}
            </span>
          )}
        </div>
      </section>

      {/* Mid section: cost trend + adapter health */}
      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs uppercase tracking-wide text-zinc-500">cost · last 30 days</span>
            {cost?.success && (
              <span className="text-xs text-zinc-500">
                {cost.data.daily_buckets.length} buckets
              </span>
            )}
          </div>
          {sparklineData.length > 0 ? (
            <Sparkline data={sparklineData} />
          ) : (
            <div className="flex h-16 items-center justify-center text-xs text-zinc-600">
              no cost data
            </div>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="mb-2 text-xs uppercase tracking-wide text-zinc-500">
            adapter health
          </div>
          {adapters?.success && adapters.data.adapters.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {adapters.data.adapters.map((a) => (
                <li
                  key={a.source}
                  className="inline-flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-950 px-2 py-1 text-xs"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      a.observation_count_24h > 0 ? "bg-emerald-500" : "bg-zinc-600"
                    }`}
                  />
                  <span className="font-mono">{a.source}</span>
                  <span className="text-zinc-500">
                    {a.last_observed_at ? relativeTime(a.last_observed_at) : "never"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-zinc-600">no adapter data</div>
          )}
        </div>
      </section>

      {/* Bottom: top 5 active findings */}
      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
        <header className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            top active findings
          </span>
          <Link
            href="/findings"
            className="text-xs text-zinc-400 hover:text-zinc-200"
          >
            view all →
          </Link>
        </header>
        {top5.length > 0 ? (
          <ul className="divide-y divide-zinc-800">
            {top5.map((f) => (
              <li key={f.fingerprint} className="px-4 py-3 hover:bg-zinc-900/60">
                <Link
                  href={`/findings/${f.short_id}`}
                  className="block"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={`h-2 w-2 rounded-full ${severityDot(f.severity)}`} />
                        <span className="truncate font-medium">{f.title}</span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-zinc-500">
                        <span>{f.short_id}</span>
                        <span>{f.resource_id}</span>
                        {f.affects.length > 0 && <span>[{f.affects.join(", ")}]</span>}
                        {f.muted && <span className="text-zinc-400">muted</span>}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-md border px-2 py-0.5 text-xs ${severityColors(
                        f.severity,
                      )}`}
                    >
                      {f.state}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            no active findings
          </div>
        )}
      </section>
    </main>
  );
}

function SeverityStat({
  label,
  count,
  severity,
}: {
  label: string;
  count: number;
  severity: Severity;
}) {
  return (
    <div
      className={`flex flex-col justify-between rounded-lg border bg-zinc-900/40 p-3 ${severityColors(
        severity,
      )}`}
    >
      <span className="text-xs uppercase tracking-wide opacity-75">{label}</span>
      <span className="text-2xl font-semibold">{count}</span>
    </div>
  );
}
