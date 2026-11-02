import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listStages, visibleWhere } from "@/lib/applications";
import { formatDate } from "@/lib/format";
import { DeleteApplicationButton, StageSelect } from "@/components/application-controls";
import { DetailsEditor, NotesEditor, ResumeUploader } from "./editors";

export default async function ApplicationDetailPage(props: PageProps<"/applications/[id]">) {
  const user = await requireUser();
  const { id } = await props.params;
  const app = await db.application.findFirst({
    where: { id, ...visibleWhere(user) },
    include: {
      user: { select: { name: true, email: true } },
      events: { orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } } },
    },
  });
  if (!app) notFound();
  const stages = (await listStages()).map((s) => ({ id: s.id, name: s.name, color: s.color }));
  let extra: Record<string, unknown> = {};
  try {
    extra = JSON.parse(app.extra);
  } catch {}
  const extraEntries = Object.entries(extra).filter(([, v]) => v !== null && v !== "" && typeof v !== "object");

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/applications" className="text-sm text-slate-500 hover:text-slate-800">
        ← Applications
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-slate-200 bg-white p-5">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold">{app.title}</h1>
          <div className="text-slate-600">
            {app.company || "Unknown company"}
            {app.location && <span className="text-slate-400"> · {app.location}</span>}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-xs text-slate-500">
            <span>Applied {formatDate(app.appliedAt, true)}</span>
            {user.role === "OWNER" && <span>by {app.user.name}</span>}
            {app.source && <span>via {app.source}</span>}
            {app.sheetTab && <span>Sheet tab: {app.sheetTab}</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StageSelect key={app.stageId} id={app.id} stageId={app.stageId} stages={stages} className="h-9 text-sm" />
          <DeleteApplicationButton id={app.id} redirectTo="/applications" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-4 font-semibold">Job details</h2>
            <DetailsEditor
              id={app.id}
              initial={{
                title: app.title,
                company: app.company,
                location: app.location,
                jobType: app.jobType,
                salary: app.salary,
                postedAt: app.postedAt,
                jobUrl: app.jobUrl,
                applyUrl: app.applyUrl,
                description: app.description,
              }}
            />
          </section>

          {extraEntries.length > 0 && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <h2 className="mb-3 font-semibold">Additional captured fields</h2>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                {extraEntries.map(([k, v]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-xs text-slate-500">{k}</dt>
                    <dd className="break-words text-slate-800">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>

        <div className="space-y-5">
          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">Links</h2>
            <div className="space-y-2 text-sm">
              {app.jobUrl ? (
                <a href={app.jobUrl} target="_blank" rel="noreferrer" className="block truncate text-indigo-600 hover:underline">
                  Job posting ↗
                </a>
              ) : null}
              {app.applyUrl && app.applyUrl !== app.jobUrl ? (
                <a href={app.applyUrl} target="_blank" rel="noreferrer" className="block truncate text-indigo-600 hover:underline">
                  Apply page ↗
                </a>
              ) : null}
              {!app.jobUrl && !app.applyUrl && <p className="text-slate-400">No links saved.</p>}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">Resume</h2>
            {app.resumeUrl ? (
              <a href={app.resumeUrl} target="_blank" rel="noreferrer" className="mb-3 flex items-center gap-2 rounded-md bg-slate-50 p-2.5 text-sm text-indigo-700 hover:bg-indigo-50">
                <span className="text-lg">📄</span>
                <span className="min-w-0 flex-1 truncate">{app.resumeName || "Resume"}</span>
                <span className="text-xs text-slate-400">{app.resumeStore === "drive" ? "Google Drive ↗" : "Platform (old)"}</span>
              </a>
            ) : (
              <p className="mb-3 text-sm text-slate-400">No resume uploaded.</p>
            )}
            <ResumeUploader id={app.id} hasResume={Boolean(app.resumeUrl)} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">Notes</h2>
            <NotesEditor id={app.id} initial={app.notes} />
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-5">
            <h2 className="mb-3 font-semibold">History</h2>
            <ol className="space-y-3 border-l border-slate-200 pl-4">
              {app.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500" />
                  <div className="text-slate-800">{e.message}</div>
                  <div className="text-xs text-slate-500">
                    {formatDate(e.createdAt, true)}
                    {e.user && ` · ${e.user.name}`}
                  </div>
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
