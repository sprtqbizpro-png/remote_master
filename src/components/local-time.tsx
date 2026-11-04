"use client";

import { useEffect, useState } from "react";

const DATE: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const TIME: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

/**
 * A date and time in the viewer's own time zone. Pages are rendered on the server (UTC on most
 * hosts), so the server writes a UTC placeholder and the browser replaces it with local time.
 * `stacked` puts the time on its own line (table cells).
 */
export function LocalTime({ value, stacked, className }: { value: string; stacked?: boolean; className?: string }) {
  const [local, setLocal] = useState<{ date: string; time: string } | null>(null);
  useEffect(() => {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) setLocal({ date: d.toLocaleDateString(undefined, DATE), time: d.toLocaleTimeString(undefined, TIME) });
  }, [value]);
  const d = new Date(value);
  const shown = local ?? {
    date: d.toLocaleDateString("en-US", { ...DATE, timeZone: "UTC" }),
    time: `${d.toLocaleTimeString("en-US", { ...TIME, timeZone: "UTC" })} UTC`,
  };
  return (
    <time dateTime={value} className={className}>
      {stacked ? (
        <>
          <span className="block">{shown.date}</span>
          <span className="block text-xs text-slate-400">{shown.time}</span>
        </>
      ) : (
        `${shown.date}, ${shown.time}`
      )}
    </time>
  );
}
