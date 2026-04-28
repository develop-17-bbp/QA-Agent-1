import { useEffect, useRef, useState } from "react";

/**
 * useAutoRefresh — polls a fetcher at a fixed interval, exposes a
 * `lastUpdated` timestamp so pages can render a "Last updated Xs ago"
 * indicator. Pauses while the tab is hidden (visibilitychange) so we
 * don't burn cycles on backgrounded tabs.
 *
 *   const { lastUpdated, secondsAgo, refreshNow, paused } =
 *     useAutoRefresh(load, 30_000, [runId]);
 *
 * The fetcher is invoked once on mount and then every `intervalMs`.
 * When the dependency list changes, the timer resets.
 */
export function useAutoRefresh(
  fetcher: () => void | Promise<void>,
  intervalMs: number,
  deps: React.DependencyList = [],
  options: { enabled?: boolean } = {},
) {
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [paused, setPaused] = useState<boolean>(typeof document !== "undefined" && document.hidden);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const enabled = options.enabled !== false;

  // Track tab visibility — pause polling on background tabs.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVis = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Run on mount + dep change + interval.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const tick = async () => {
      try {
        await fetcherRef.current();
        if (!cancelled) setLastUpdated(Date.now());
      } catch { /* swallow — page surfaces its own error state */ }
    };
    void tick();
    const timer = setInterval(() => { if (!document.hidden) void tick(); }, Math.max(1000, intervalMs));
    return () => { cancelled = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, enabled, ...deps]);

  // Tick the secondsAgo counter once a second — drives the indicator UI.
  useEffect(() => {
    if (!lastUpdated) return;
    const t = setInterval(() => {
      setSecondsAgo(Math.max(0, Math.floor((Date.now() - lastUpdated) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [lastUpdated]);

  const refreshNow = () => { void fetcherRef.current(); };

  return { lastUpdated, secondsAgo, refreshNow, paused };
}

/** Format "12s ago", "1m 5s ago", "3m ago", etc. */
export function formatAgo(seconds: number): string {
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 5) return `${m}m ${s}s ago`;
  return `${m}m ago`;
}
