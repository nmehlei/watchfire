"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { FindingsList, type FindingListItem } from "@/lib/schemas";

const DEBOUNCE_MS = 200;
const MIN_QUERY_LEN = 2;

type SearchState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; results: FindingListItem[]; total: number }
  | { kind: "error"; message: string };

function severityDot(s: FindingListItem["severity"]): string {
  return s === "critical" ? "bg-red-500" : s === "warn" ? "bg-amber-500" : "bg-sky-500";
}

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [state, setState] = useState<SearchState>({ kind: "idle" });
  const ctrlRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Stable trimmed query for the effect dependency
  const trimmed = useMemo(() => q.trim(), [q]);
  const queryTooShort = trimmed.length < MIN_QUERY_LEN;

  useEffect(() => {
    if (queryTooShort) {
      ctrlRef.current?.abort();
      return;
    }

    const handle = setTimeout(async () => {
      ctrlRef.current?.abort();
      const ctrl = new AbortController();
      ctrlRef.current = ctrl;
      setState({ kind: "loading" });
      try {
        const res = await fetch(
          `/api/watchfire/findings/search?q=${encodeURIComponent(trimmed)}&limit=20`,
          { signal: ctrl.signal },
        );
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          setState({
            kind: "error",
            message: `Watchfire ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
          });
          return;
        }
        const body: unknown = await res.json();
        const parsed = FindingsList.safeParse(body);
        if (!parsed.success) {
          setState({ kind: "error", message: "malformed search response" });
          return;
        }
        setState({
          kind: "ok",
          results: parsed.data.findings,
          total: parsed.data.total,
        });
      } catch (err) {
        if ((err as { name?: string }).name === "AbortError") return;
        setState({
          kind: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [trimmed, queryTooShort]);

  // Derive idle vs. computed state — never call setState in the effect
  // just to reset to idle (React 19's set-state-in-effect rule).
  const effective: SearchState = queryTooShort ? { kind: "idle" } : state;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-200">
          ← overview
        </Link>
      </header>

      <p className="text-sm text-zinc-500">
        Searches finding title + resource id, case-insensitive. Min{" "}
        {MIN_QUERY_LEN} characters.
      </p>

      <input
        ref={inputRef}
        type="search"
        autoComplete="off"
        spellCheck={false}
        placeholder="search…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-base outline-none focus:border-zinc-500"
      />

      <section className="rounded-lg border border-zinc-800 bg-zinc-900/40">
        {effective.kind === "idle" && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">
            type to search
          </div>
        )}
        {effective.kind === "loading" && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">searching…</div>
        )}
        {effective.kind === "error" && (
          <div className="px-4 py-6 text-center text-sm text-red-400">{effective.message}</div>
        )}
        {effective.kind === "ok" && effective.results.length === 0 && (
          <div className="px-4 py-6 text-center text-sm text-zinc-500">no matches</div>
        )}
        {effective.kind === "ok" && effective.results.length > 0 && (
          <>
            <ul className="divide-y divide-zinc-800">
              {effective.results.map((f) => (
                <li key={f.fingerprint} className="hover:bg-zinc-900/60">
                  <Link
                    href={`/findings/${f.short_id}`}
                    className="block px-4 py-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm">
                          <span
                            className={`h-2 w-2 rounded-full ${severityDot(f.severity)}`}
                          />
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
            <footer className="border-t border-zinc-800 px-4 py-2 text-xs text-zinc-500">
              {effective.results.length} of {effective.total}
            </footer>
          </>
        )}
      </section>
    </main>
  );
}
