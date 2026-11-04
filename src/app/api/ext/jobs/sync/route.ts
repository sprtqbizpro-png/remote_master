import { NextResponse } from "next/server";
import { z } from "zod";
import { extRoute } from "@/lib/api";
import { appliedCompanies } from "@/lib/applications";
import { normalizeCompany, resolveSheetId, sheetUrlFor, syncScrapedJobs } from "@/lib/sheets";

const str = (max: number) => z.string().trim().max(max).optional().default("");

const body = z.object({
  site: z.string().trim().min(1).max(100),
  sourceUrl: str(2000),
  jobs: z
    .array(
      z.object({
        key: str(500),
        title: z.string().trim().max(300),
        company: str(200),
        jobType: str(100),
        location: str(300),
        salary: str(200),
        postedAt: str(100),
        jobUrl: str(2000),
        applyUrl: str(2000),
      }),
    )
    .max(2000),
});

/** Appends newly scraped jobs to the site's tab in the applier's Google Sheet (duplicates are skipped). */
export const POST = extRoute(async (request, user) => {
  const { site, sourceUrl, jobs } = body.parse(await request.json());
  // Jobs at companies already applied to (applications saved on the platform) are not saved.
  const applied = await appliedCompanies(user.id);
  const keep = jobs.filter((j) => !applied.has(normalizeCompany(j.company)));
  const sheetId = await resolveSheetId(user.id);
  const result = await syncScrapedJobs(sheetId, site, keep, sourceUrl);
  return NextResponse.json({ ...result, skippedApplied: jobs.length - keep.length, sheetUrl: sheetUrlFor(sheetId) });
}, { applies: true });
