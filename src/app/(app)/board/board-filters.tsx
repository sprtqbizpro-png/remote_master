"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function BoardFilters({ appliers, applier }: { appliers: { id: string; name: string }[]; applier: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(next.size ? `${pathname}?${next}` : pathname);
  };
  return (
    <>
      <input
        type="search"
        placeholder="Filter cards…"
        defaultValue={params.get("q") ?? ""}
        onChange={(e) => set("q", e.target.value)}
        className="h-9 w-full basis-full rounded-md sm:w-48 sm:basis-auto border border-slate-300 bg-white px-3 text-sm outline-none focus:border-indigo-500"
      />
      {appliers.length > 0 && (
        <select
          value={applier}
          onChange={(e) => set("user", e.target.value)}
          className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm"
        >
          <option value="">All appliers</option>
          {appliers.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      )}
    </>
  );
}
