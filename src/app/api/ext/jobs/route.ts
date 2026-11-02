import { NextResponse } from "next/server";
import { apiError, extRoute } from "@/lib/api";
import { listSheetJobs, resolveSheetId, testSheetConnection } from "@/lib/sheets";

/**
 * GET /api/ext/jobs            -> list of site tabs in the applier's sheet
 * GET /api/ext/jobs?site=X     -> jobs in that tab (add &all=1 to include applied ones)
 */
export const GET = extRoute(async (request, user) => {
  const params = new URL(request.url).searchParams;
  const sheetId = await resolveSheetId(user.id);
  const site = params.get("site");
  if (!site) {
    const { tabs } = await testSheetConnection(sheetId);
    return NextResponse.json({ tabs });
  }
  if (site.length > 100) return apiError("Invalid site.");
  const { tab, jobs } = await listSheetJobs(sheetId, site, params.get("all") !== "1");
  return NextResponse.json({ tab, jobs });
});
