"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

type SseStatus = "connecting" | "open" | "error";

const REFRESH_DEBOUNCE_MS = 750;

/**
 * Open an EventSource against /api/events (BFF proxies to Watchfire), and
 * on every event call router.refresh() so the current RSC re-fetches.
 * Debounced — a burst of finding.upserted events during an agent run
 * collapses into one refresh instead of N.
 *
 * Also renders a small connection indicator. The dot reflects the
 * EventSource readyState; EventSource auto-reconnects on transient
 * failures, so a brief "error" → "connecting" → "open" flicker is
 * expected.
 */
export function LiveRefresh() {
  const router = useRouter();
  const [status, setStatus] = useState<SseStatus>("connecting");
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const es = new EventSource("/api/events");

    const scheduleRefresh = () => {
      setLastEventAt(Date.now());
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    es.onopen = () => setStatus("open");
    es.onerror = () => setStatus("error");

    for (const type of [
      "finding.upserted",
      "mute.created",
      "mute.deleted",
      "nightly.completed",
      "watch.completed",
    ]) {
      es.addEventListener(type, scheduleRefresh);
    }

    return () => {
      es.close();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [router]);

  const dotClass =
    status === "open"
      ? "bg-emerald-500"
      : status === "error"
        ? "bg-red-500"
        : "bg-zinc-500";

  return (
    <div
      className="pointer-events-none fixed bottom-3 right-3 flex items-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900/80 px-2 py-1 text-xs text-zinc-400 backdrop-blur"
      title={
        status === "open"
          ? `live — last event ${lastEventAt ? new Date(lastEventAt).toLocaleTimeString() : "pending"}`
          : status === "error"
            ? "live stream disconnected — auto-reconnecting"
            : "connecting…"
      }
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dotClass}`} />
      <span>live</span>
    </div>
  );
}
