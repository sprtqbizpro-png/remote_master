import { NextResponse } from "next/server";
import { z } from "zod";
import { extRoute } from "@/lib/api";
import { appliedCompanies } from "@/lib/applications";
import { cleanupAppliedCompanies, resolveSheetId } from "@/lib/sheets";

const body = z.object({ dryRun: z.boolean().default(true) });

/**
 * Removes jobs from the applier's sheet at companies they already applied to (per the
 * applications saved on the platform).
 * `{ dryRun: true }` (the default) only previews what would be removed.
 */
export const POST = extRoute(async (request, user) => {
  const { dryRun } = body.parse(await request.json().catch(() => ({})));
  const sheetId = await resolveSheetId(user.id);
  const companies = [...(await appliedCompanies(user.id)).values()].map((c) => c.name);
  const result = await cleanupAppliedCompanies(sheetId, companies, { dryRun });
  return NextResponse.json(result);
});
