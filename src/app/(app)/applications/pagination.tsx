"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES } from "./page-size";

/** Page numbers to show: the first, the last, and two either side of the current one. */
function pageList(page: number, pages: number) {
  const keep = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter((p) => p >= 1 && p <= pages));
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  sorted.forEach((p, i) => {
    if (i && p - sorted[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return out;
}

/** "Showing 21–40 of 132", a jobs-per-page choice, and page links (keeping the current filters). */
export function Pagination({ page, pages, size, total }: { page: number; pages: number; size: number; total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const href = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (!v || (k === "page" && v === "1") || (k === "size" && v === String(DEFAULT_PAGE_SIZE))) next.delete(k);
      else next.set(k, v);
    }
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  };
  const from = total ? (page - 1) * size + 1 : 0;
  const to = Math.min(total, page * size);
  const linkClass = "min-w-8 rounded-md border px-2.5 py-1.5 text-center";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
      <div className="flex items-center gap-3">
        <span>{total ? `Showing ${from}–${to} of ${total}` : "No applications"}</span>
        <label className="flex items-center gap-1.5">
          <span className="text-slate-500">Per page</span>
          <select
            value={size}
            onChange={(e) => router.push(href({ size: e.target.value, page: "1" }))}
            className="h-8 rounded-md border border-slate-300 bg-white px-2 text-sm"
          >
            {PAGE_SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {pages > 1 && (
        <nav className="flex flex-wrap items-center gap-1" aria-label="Pages">
          {page > 1 ? (
            <Link href={href({ page: String(page - 1) })} className={`${linkClass} border-slate-300 bg-white hover:bg-slate-50`}>
              ‹ Prev
            </Link>
          ) : (
            <span className={`${linkClass} border-slate-200 text-slate-300`}>‹ Prev</span>
          )}
          {pageList(page, pages).map((p, i) =>
            p === "gap" ? (
              <span key={`gap${i}`} className="px-1 text-slate-400">
                …
              </span>
            ) : (
              <Link
                key={p}
                href={href({ page: String(p) })}
                aria-current={p === page ? "page" : undefined}
                className={`${linkClass} ${p === page ? "border-indigo-300 bg-indigo-50 font-medium text-indigo-700" : "border-slate-300 bg-white hover:bg-slate-50"}`}
              >
                {p}
              </Link>
            ),
          )}
          {page < pages ? (
            <Link href={href({ page: String(page + 1) })} className={`${linkClass} border-slate-300 bg-white hover:bg-slate-50`}>
              Next ›
            </Link>
          ) : (
            <span className={`${linkClass} border-slate-200 text-slate-300`}>Next ›</span>
          )}
        </nav>
      )}
    </div>
  );
}
