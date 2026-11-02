"use server";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorMessage, listStages, visibleWhere } from "@/lib/applications";

export type AppliedMatch = { id: string; title: string; company: string; applier: string; appliedAt: string };

/**
 * Applications still in the "Applied" status whose company or job title contains `q` (newest
 * first). An empty query lists the most recent ones. Owners can narrow it to one applier.
 */
export async function searchAppliedAction(
  q: string,
  applier?: string,
): Promise<{ ok: true; matches: AppliedMatch[] } | { ok: false; error: string }> {
  const user = await requireUser();
  try {
    const applied = (await listStages()).find((s) => /^applied$/i.test(s.name.trim()));
    if (!applied) return { ok: true, matches: [] };
    const term = q.trim().slice(0, 100);
    const rows = await db.application.findMany({
      where: {
        ...visibleWhere(user),
        ...(user.role === "OWNER" && applier && { userId: applier }),
        stageId: applied.id,
        ...(term && {
          OR: [
            { company: { contains: term, mode: "insensitive" } },
            { title: { contains: term, mode: "insensitive" } },
          ],
        }),
      },
      orderBy: { appliedAt: "desc" },
      take: 20,
      select: { id: true, title: true, company: true, appliedAt: true, user: { select: { name: true } } },
    });
    return {
      ok: true,
      matches: rows.map((r) => ({ id: r.id, title: r.title, company: r.company, applier: r.user.name, appliedAt: r.appliedAt.toISOString() })),
    };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
