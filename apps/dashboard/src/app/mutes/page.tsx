import Link from "next/link";
import { revalidatePath } from "next/cache";
import { Bell } from "lucide-react";
import { watchfireFetch, watchfireJson } from "@/lib/watchfire";
import { MutesList, type ActiveMute } from "@/lib/schemas";
import { relativeTime } from "@/lib/time";

export const dynamic = "force-dynamic";

async function safe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (err) {
    console.error("mutes fetch failed:", err);
    return null;
  }
}

async function unmuteAction(formData: FormData) {
  "use server";
  const fingerprint = String(formData.get("fingerprint") ?? "");
  if (!fingerprint) return;
  // Watchfire accepts the full fingerprint or any disambiguating prefix
  // (>= 6 hex) — pass the full one we already have to be unambiguous.
  const res = await watchfireFetch(`/api/mutes/${encodeURIComponent(fingerprint)}`, {
    method: "DELETE",
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => "");
    console.error(`unmute failed: ${res.status} ${text.slice(0, 200)}`);
  }
  revalidatePath("/mutes");
}

function expiresClass(m: ActiveMute): string {
  if (m.expires_at === null) return "text-zinc-300";
  // Soonest-to-expire mutes get a muted amber tint so the operator
  // notices "about to flip back to noisy" entries.
  const ms = Date.parse(m.expires_at.replace(" ", "T") + "Z") - Date.now();
  if (ms <= 0) return "text-zinc-500";
  if (ms < 24 * 3_600_000) return "text-amber-300";
  return "text-zinc-400";
}

export default async function MutesPage() {
  const data = await safe(watchfireJson<unknown>("/api/mutes"));
  const parsed = data ? MutesList.safeParse(data) : null;
  const mutes = parsed?.success ? parsed.data.mutes : [];

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Mutes</h1>
        <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-200">
          ← overview
        </Link>
      </header>

      <p className="text-sm text-zinc-500">
        Active mutes suppress pages and the digest line for a finding until the
        expiry passes. Order: forever first, then soonest-to-expire.
      </p>

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
        {mutes.length > 0 ? (
          <ul className="divide-y divide-zinc-800">
            {mutes.map((m) => (
              <MuteRow key={m.id} m={m} />
            ))}
          </ul>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            {parsed?.success ? "no active mutes" : "failed to load mutes"}
          </div>
        )}
        <footer className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
          {mutes.length} active
        </footer>
      </section>
    </main>
  );
}

function MuteRow({ m }: { m: ActiveMute }) {
  const shortId = m.fingerprint.slice(0, 6);
  const expiresLabel = m.expires_at === null ? "forever" : relativeTime(m.expires_at);

  return (
    <li className="px-4 py-3 hover:bg-zinc-900/60">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-sm">
            <Link
              href={`/findings/${shortId}`}
              className="truncate font-medium hover:underline"
            >
              {m.finding_title ?? "(finding no longer exists)"}
            </Link>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-zinc-500">
            <span>{shortId}</span>
            {m.finding_resource_id && <span>{m.finding_resource_id}</span>}
            <span>· source: {m.source}</span>
            <span>· muted {relativeTime(m.created_at)}</span>
            <span>· expires:</span>
            <span className={expiresClass(m)}>{expiresLabel}</span>
          </div>
          {m.reason && (
            <div className="mt-1 text-xs italic text-zinc-400">“{m.reason}”</div>
          )}
        </div>
        <form action={unmuteAction}>
          <input type="hidden" name="fingerprint" value={m.fingerprint} />
          <button
            type="submit"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1 text-xs hover:bg-zinc-700"
          >
            <Bell className="h-3.5 w-3.5" aria-hidden />
            Unmute
          </button>
        </form>
      </div>
    </li>
  );
}
