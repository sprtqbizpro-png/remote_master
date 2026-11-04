"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

const CHOICES = [
  { ms: 60_000, label: "every minute" },
  { ms: 2 * 60_000, label: "every 2 min" },
  { ms: 5 * 60_000, label: "every 5 min" },
  { ms: 10 * 60_000, label: "every 10 min" },
  { ms: 0, label: "off" },
];
const STORAGE_KEY = "rb:autoRefreshMs";
const DEFAULT_MS = 2 * 60_000;

function savedInterval() {
  try {
    const v = Number(localStorage.getItem(STORAGE_KEY));
    return CHOICES.some((c) => c.ms === v) && localStorage.getItem(STORAGE_KEY) !== null ? v : DEFAULT_MS;
  } catch {
    return DEFAULT_MS;
  }
}

/**
 * Reloads the page's data on an interval the viewer picks (1-10 minutes, or off), so applications
 * saved by others show up without reloading. Waits while the tab is hidden and catches up when it
 * comes back. The choice is remembered in this browser.
 */
export function AutoRefresh() {
  const router = useRouter();
  const [ms, setMs] = useState(DEFAULT_MS);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [pending, start] = useTransition();
  const last = useRef(0);

  useEffect(() => {
    setMs(savedInterval());
    setUpdated(new Date());
    last.current = Date.now();
  }, []);

  useEffect(() => {
    if (!ms) return;
    const refresh = () => {
      last.current = Date.now();
      start(() => router.refresh());
      setUpdated(new Date());
    };
    const tick = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= ms - 1000) refresh();
    };
    const timer = setInterval(tick, Math.min(ms, 30_000));
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [ms, router]);

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      <span aria-live="polite">
        {pending ? "Updating…" : updated ? `Updated ${updated.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : ""}
      </span>
      <label className="flex items-center gap-1">
        <span className="sr-only sm:not-sr-only">Auto-update</span>
        <select
          value={ms}
          onChange={(e) => {
            const v = Number(e.target.value);
            setMs(v);
            try {
              localStorage.setItem(STORAGE_KEY, String(v));
            } catch {
              /* private mode: not remembered */
            }
          }}
          className="h-7 rounded-md border border-slate-300 bg-white px-1.5 text-xs"
        >
          {CHOICES.map((c) => (
            <option key={c.ms} value={c.ms}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          last.current = Date.now();
          start(() => router.refresh());
          setUpdated(new Date());
        }}
        className="rounded-md px-1.5 py-1 hover:bg-slate-100 disabled:opacity-50"
        title="Update now"
      >
        ↻
      </button>
    </div>
  );
}
