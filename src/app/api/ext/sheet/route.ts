import { NextResponse } from "next/server";
import { extRoute } from "@/lib/api";
import { resolveSheetId, sheetLink } from "@/lib/sheets";

/** GET /api/ext/sheet?site=Jobright -> link to the applier's sheet, opened at that site's tab. */
export const GET = extRoute(async (request, user) => {
  const site = new URL(request.url).searchParams.get("site")?.slice(0, 100) || undefined;
  const sheetId = await resolveSheetId(user.id);
  return NextResponse.json(await sheetLink(sheetId, site));
});
