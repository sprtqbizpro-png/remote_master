import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listStages, visibleWhere } from "@/lib/applications";
import { first, formatDate } from "@/lib/format";
import { DeleteApplicationButton, NewApplicationButton, StageSelect } from "@/components/application-controls";

const PAGE_SIZE = 50;

const SORTS: Record<string, Prisma.ApplicationOrderByWithRelationInput> = {
  newest: { appliedAt: "desc" },
  oldest: { appliedAt: "asc" },
  company: { company: "asc" },
  title: { title: "asc" },
  updated: { updatedAt: "desc" },
};

export default async function ApplicationsPage(props: PageProps<"/applications">) {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";
  const sp = await props.searchParams;
  const q = first(sp.q).trim();
  const stage = first(sp.stage);
  const applier = isOwner ? first(sp.user) : "";
  const source = first(sp.source);
  const sort = SORTS[first(sp.sort)] ? first(sp.sort) : "newest";
  const page = Math.max(1, Number(first(sp.page)) || 1);

  const base = visibleWhere(user);
  const where: Prisma.ApplicationWhereInput = {
    AND: [
      base,
      q
        ? {
            OR: [
              { title: { contains: q, mode: "insensitive" } },
              { company: { contains: q, mode: "insensitive" } },
              { location: { contains: q, mode: "insensitive" } },
            ],
          }
        : {},
      stage ? { stageId: stage } : {},
      applier ? { userId: applier } : {},
      source ? { source } : {},
    ],
  };

  const [stages, total, applications, sources, appliers, stageCounts] = await Promise.all([
    listStages(),
    db.application.count({ where }),
    db.application.findMany({
      where,
      orderBy: SORTS[sort],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { user: { select: { name: true } } },
      omit: { description: true, extra: true }, // not shown in the table; can be large
    }),
    db.application.findMany({ where: base, distinct: ["source"], select: { source: true } }),
    isOwner ? db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
    db.application.groupBy({ by: ["stageId"], where: base, _count: true }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stageOptions = stages.map((s) => ({ id: s.id, name: s.name, color: s.color }));
  const countFor = (id: string) => stageCounts.find((c) => c.stageId === id)?._count ?? 0;
  const query = (patch: Record<string, string>) => {
    const params = new URLSearchParams({ q, stage, user: applier, source, sort, page: String(page), ...patch });
    for (const [k, v] of [...params]) if (!v || (k === "page" && v === "1") || (k === "sort" && v === "newest")) params.delete(k);
    const s = params.toString();
    return s ? `/applications?${s}` : "/applications";
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Applications</h1>
          <p className="text-sm text-slate-500">
            {isOwner ? "All applications submitted by job appliers." : "Jobs you have applied to."}
          </p>
        </div>
        <NewApplicationButton stages={stageOptions} />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        <Link
          href={query({ stage: "", page: "1" })}
          className={`rounded-lg border px-3 py-2 text-left ${!stage ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
        >
          <div className="text-lg font-semibold leading-none">{stageCounts.reduce((n, c) => n + c._count, 0)}</div>
          <div className="mt-1 whitespace-nowrap text-xs text-slate-500">All</div>
        </Link>
        {stages.map((s) => (
          <Link
            key={s.id}
            href={query({ stage: s.id, page: "1" })}
            className={`rounded-lg border px-3 py-2 text-left ${stage === s.id ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
          >
            <div className="text-lg font-semibold leading-none" style={{ color: s.color }}>
              {countFor(s.id)}
            </div>
            <div className="mt-1 whitespace-nowrap text-xs text-slate-500">{s.name}</div>
          </Link>
        ))}
      </div>

      <form className="flex flex-wrap items-end gap-2 rounded-lg border border-slate-200 bg-white p-3" action="/applications">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search title, company, location…"
          className="h-9 min-w-56 flex-1 rounded-md border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
        />
        <select name="stage" defaultValue={stage} className="h-9 rounded-md border border-slate-300 px-2 text-sm">
          <option value="">All statuses</option>
          {stages.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <select name="source" defaultValue={source} className="h-9 rounded-md border border-slate-300 px-2 text-sm">
          <option value="">All sources</option>
          {sources
            .map((s) => s.source)
            .filter(Boolean)
            .sort()
            .map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
        </select>
        {isOwner && (
          <select name="user" defaultValue={applier} className="h-9 rounded-md border border-slate-300 px-2 text-sm">
            <option value="">All appliers</option>
            {appliers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        )}
        <select name="sort" defaultValue={sort} className="h-9 rounded-md border border-slate-300 px-2 text-sm">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
          <option value="updated">Recently updated</option>
          <option value="company">Company A–Z</option>
          <option value="title">Title A–Z</option>
        </select>
        <button className="h-9 rounded-md bg-slate-800 px-4 text-sm font-medium text-white hover:bg-slate-700">Filter</button>
        {(q || stage || source || applier) && (
          <Link href="/applications" className="h-9 px-2 text-sm leading-9 text-slate-500 hover:text-slate-800">
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full min-w-[960px] text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Job</th>
              <th className="px-3 py-2.5">Source</th>
              <th className="px-3 py-2.5">Type / Location</th>
              {isOwner && <th className="px-3 py-2.5">Applier</th>}
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Applied</th>
              <th className="px-3 py-2.5">Resume</th>
              <th className="px-3 py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {applications.map((a) => (
              <tr key={a.id} className="hover:bg-slate-50/60">
                <td className="max-w-80 px-4 py-2.5">
                  <Link href={`/applications/${a.id}`} className="block truncate font-medium text-slate-900 hover:text-indigo-600">
                    {a.title}
                  </Link>
                  <div className="truncate text-xs text-slate-500">{a.company || "—"}</div>
                </td>
                <td className="px-3 py-2.5 text-slate-600">{a.source || "—"}</td>
                <td className="max-w-56 px-3 py-2.5">
                  <div className="truncate text-slate-700">{a.jobType || "—"}</div>
                  <div className="truncate text-xs text-slate-500">{a.location}</div>
                </td>
                {isOwner && <td className="px-3 py-2.5 text-slate-700">{a.user.name}</td>}
                <td className="px-3 py-2.5">
                  <StageSelect key={`${a.id}-${a.stageId}`} id={a.id} stageId={a.stageId} stages={stageOptions} />
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-slate-600">{formatDate(a.appliedAt)}</td>
                <td className="px-3 py-2.5">
                  {a.resumeUrl ? (
                    <a href={a.resumeUrl} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
                      View
                    </a>
                  ) : (
                    <span className="text-slate-400">—</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right">
                  <Link href={`/applications/${a.id}`} className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100">
                    Details
                  </Link>
                  {(a.jobUrl || a.applyUrl) && (
                    <a
                      href={a.jobUrl || a.applyUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                    >
                      Posting ↗
                    </a>
                  )}
                  <DeleteApplicationButton id={a.id} />
                </td>
              </tr>
            ))}
            {applications.length === 0 && (
              <tr>
                <td colSpan={isOwner ? 8 : 7} className="px-4 py-12 text-center text-slate-500">
                  No applications found. Save jobs from the browser extension or add one manually.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-600">
          <span>
            {total} applications · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={query({ page: String(page - 1) })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
                Previous
              </Link>
            )}
            {page < pages && (
              <Link href={query({ page: String(page + 1) })} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
