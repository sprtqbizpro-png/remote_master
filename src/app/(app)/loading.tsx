/** Shown at once on navigation (under the header) while the page's data loads. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-5" aria-busy="true" aria-label="Loading">
      <div className="space-y-2">
        <div className="h-6 w-48 rounded bg-slate-200" />
        <div className="h-4 w-72 rounded bg-slate-100" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="h-14 w-28 rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-8 rounded bg-slate-100" />
        ))}
      </div>
    </div>
  );
}
