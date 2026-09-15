import Link from "next/link";
import { notFound } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Bell, BellOff } from "lucide-react";
import { watchfireFetch } from "@/lib/watchfire";
import { FindingDetail, MuteDuration } from "@/lib/schemas";
import { relativeTime } from "@/lib/time";

export const dynamic = "force-dynamic";

async function muteFinding(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const duration = String(formData.get("duration") ?? "");
  const parsed = MuteDuration.safeParse(duration);
  if (!id || !parsed.success) return;
  const res = await watchfireFetch("/api/mutes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, duration: parsed.data }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`mute failed: ${res.status} ${text.slice(0, 200)}`);
  }
  revalidatePath(`/findings/${id}`);
}

async function unmuteFinding(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const res = await watchfireFetch(`/api/mutes/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    console.error(`unmute failed: ${res.status} ${text.slice(0, 200)}`);
  }
  revalidatePath(`/findings/${id}`);
}

export default async function FindingDetailPage({
  params,
}: {
  params: Promise<{ short_id: string }>;
}) {
  const { short_id } = await params;

  const res = await watchfireFetch(`/api/findings/${encodeURIComponent(short_id)}`);
  if (res.status === 404) notFound();

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = null;
  }

  if (!res.ok) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight">Error</h1>
        <p className="text-sm text-zinc-400">
          Watchfire returned <code className="rounded bg-zinc-900 px-1.5 py-0.5">{res.status}</code>{" "}
          for <span className="font-mono">{short_id}</span>.
        </p>
        <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
          {JSON.stringify(body, null, 2)}
        </pre>
      </main>
    );
  }

  const parsed = FindingDetail.safeParse(body);
  if (!parsed.success) {
    return (
      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
        <BackLink />
        <h1 className="text-2xl font-semibold tracking-tight">Malformed response</h1>
        <pre className="overflow-x-auto rounded-md border border-zinc-800 bg-zinc-950 p-3 text-xs text-zinc-300">
          {JSON.stringify(body, null, 2)}
        </pre>
      </main>
    );
  }

  const f = parsed.data;

  const severityClass =
    f.severity === "critical"
      ? "border-red-700 bg-red-950/40 text-red-300"
      : f.severity === "warn"
        ? "border-amber-700 bg-amber-950/30 text-amber-300"
        : "border-sky-700 bg-sky-950/30 text-sky-300";

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <BackLink />

      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className={`rounded-md border px-2 py-0.5 text-xs ${severityClass}`}>
            {f.severity}
          </span>
          <span className="rounded-md border border-zinc-700 px-2 py-0.5 text-xs text-zinc-300">
            {f.state}
          </span>
          {f.escalating && (
            <span className="rounded-md border border-amber-700 bg-amber-950/30 px-2 py-0.5 text-xs text-amber-300">
              ↑ escalating from {f.prev_severity}
            </span>
          )}
          {f.muted && (
            <span className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-0.5 text-xs text-zinc-400">
              muted
            </span>
          )}
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{f.title}</h1>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-zinc-500">
          <span>{f.short_id}</span>
          <span>{f.resource_id}</span>
          <span>{f.issue_class}</span>
          {f.affects.length > 0 && <span>[{f.affects.join(", ")}]</span>}
        </div>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="first seen" value={relativeTime(f.first_seen_at)} hint={f.first_seen_at} />
        <Metric label="last seen" value={relativeTime(f.last_seen_at)} hint={f.last_seen_at} />
        <Metric label="age" value={`${f.age_days.toFixed(1)} d`} />
        <Metric label="run count" value={String(f.run_count)} hint={`runs ${f.first_run_id}–${f.last_run_id}`} />
      </section>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">evidence</h2>
        <pre className="whitespace-pre-wrap break-words text-sm text-zinc-200">
          {f.evidence || "(none)"}
        </pre>
      </section>

      {f.likely_cause && (
        <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
          <h2 className="mb-2 text-xs uppercase tracking-wide text-zinc-500">likely cause</h2>
          <p className="whitespace-pre-wrap break-words text-sm italic text-zinc-300">
            {f.likely_cause}
          </p>
        </section>
      )}

      {f.resolved_at && (
        <section className="rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-4 text-sm text-emerald-200">
          Cleared {relativeTime(f.resolved_at)} ({f.resolved_at}).
        </section>
      )}

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
        <h2 className="mb-3 text-xs uppercase tracking-wide text-zinc-500">mute control</h2>
        {f.muted ? (
          <form action={unmuteFinding} className="flex items-center gap-3">
            <input type="hidden" name="id" value={f.short_id} />
            <span className="text-sm text-zinc-400">
              this finding is currently muted — pages and digest are suppressed
            </span>
            <button
              type="submit"
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700"
            >
              <Bell className="h-4 w-4" aria-hidden />
              Unmute
            </button>
          </form>
        ) : (
          <form action={muteFinding} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="id" value={f.short_id} />
            <label htmlFor="duration" className="text-sm text-zinc-400">
              mute for
            </label>
            <select
              id="duration"
              name="duration"
              defaultValue="1d"
              className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1 text-sm"
            >
              <option value="1d">1 day</option>
              <option value="7d">7 days</option>
              <option value="30d">30 days</option>
              <option value="forever">forever</option>
            </select>
            <button
              type="submit"
              className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-amber-700 bg-amber-950/40 px-3 py-1.5 text-sm text-amber-200 hover:bg-amber-950/60"
            >
              <BellOff className="h-4 w-4" aria-hidden />
              Mute
            </button>
          </form>
        )}
      </section>
    </main>
  );
}

function BackLink() {
  return (
    <Link href="/findings" className="text-xs text-zinc-400 hover:text-zinc-200">
      ← findings
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
      {hint && <div className="mt-0.5 font-mono text-xs text-zinc-600">{hint}</div>}
    </div>
  );
}
