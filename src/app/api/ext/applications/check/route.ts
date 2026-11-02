import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, extRoute } from "@/lib/api";
import { findCompanyApplications, findExistingApplications } from "@/lib/applications";

const body = z.object({
  urls: z.array(z.string().max(2000)).max(10),
  company: z.string().trim().max(200).optional(),
});

/**
 * Tells the extension whether a job was already applied to (`matches`: the same job, by URL) and
 * which of the caller's applications are at the same company (`companyMatches`).
 */
export const POST = extRoute(async (request, user) => {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("Expected { urls: string[], company?: string }.");
  // Both lookups run at once: each is a database round trip.
  const [matches, sameCompany] = await Promise.all([
    findExistingApplications(user, parsed.data.urls),
    parsed.data.company ? findCompanyApplications(user, parsed.data.company) : Promise.resolve([]),
  ]);
  const sameJob = new Set(matches.map((m) => m.id));
  return NextResponse.json({ matches, companyMatches: sameCompany.filter((a) => !sameJob.has(a.id)) });
});
