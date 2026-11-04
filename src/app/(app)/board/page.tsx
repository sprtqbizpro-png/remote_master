import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { listStages, visibleWhere } from "@/lib/applications";
import { first } from "@/lib/format";
import { AutoRefresh } from "@/components/auto-refresh";
import { Board } from "./board";
import { BoardFilters } from "./board-filters";

export default async function BoardPage(props: PageProps<"/board">) {
  const user = await requireUser();
  const isOwner = user.role === "OWNER";
  const sp = await props.searchParams;
  const applier = isOwner ? first(sp.user) : "";

  // The board tracks progress after applying, so the "Applied" status (where every saved
  // application starts) is left out: no column, and its cards aren't loaded.
  const stages = (await listStages()).filter((s) => !/^applied$/i.test(s.name.trim()));
  const [applications, appliers] = await Promise.all([
    db.application.findMany({
      where: { ...visibleWhere(user), ...(applier && { userId: applier }), stageId: { in: stages.map((s) => s.id) } },
      orderBy: [{ position: "asc" }, { appliedAt: "desc" }],
      // Only what a card shows: descriptions can be tens of KB per job.
      select: {
        id: true,
        stageId: true,
        position: true,
        title: true,
        company: true,
        location: true,
        jobType: true,
        source: true,
        appliedAt: true,
        resumeUrl: true,
        user: { select: { name: true } },
      },
    }),
    isOwner ? db.user.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }) : Promise.resolve([]),
  ]);
  const stageOptions = stages.map((s) => ({ id: s.id, name: s.name, color: s.color }));
  // Jobs join the board only through this column, picked from the ones still in "Applied".
  const addStageId = (stages.find((s) => /screening/i.test(s.name)) ?? stages[0])?.id;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Board</h1>
          <p className="text-sm text-slate-500">Add applied jobs to Screening Interview, then drag cards between columns to update their status.</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <BoardFilters appliers={appliers} applier={applier} />
          <AutoRefresh />
        </div>
      </div>
      <Board
        stages={stageOptions}
        showApplier={isOwner}
        addStageId={addStageId}
        applier={applier}
        cards={applications.map((a) => ({
          id: a.id,
          stageId: a.stageId,
          position: a.position,
          title: a.title,
          company: a.company,
          location: a.location,
          jobType: a.jobType,
          source: a.source,
          applier: a.user.name,
          appliedAt: a.appliedAt.toISOString(),
          hasResume: Boolean(a.resumeUrl),
        }))}
      />
    </div>
  );
}
