import { NextResponse } from "next/server";
import { extRoute } from "@/lib/api";
import { appliedCompanies } from "@/lib/applications";

/**
 * GET /api/ext/applied-companies -> the companies the applier already applied to, from the
 * applications saved on the platform. `key` is the normalised name ("Acme, Inc." -> "acme"); the
 * scraper drops jobs whose company normalises to one of these keys.
 */
export const GET = extRoute(async (_request, user) => {
  const companies = [...(await appliedCompanies(user.id)).entries()].map(([key, c]) => ({ key, name: c.name, count: c.count }));
  return NextResponse.json({ companies });
});
