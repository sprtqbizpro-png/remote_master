import { NextResponse } from "next/server";
import { z } from "zod";
import { extRoute } from "@/lib/api";
import { findSheetJob, resolveSheetId } from "@/lib/sheets";

const body = z.object({
  key: z.string().trim().max(500).optional(),
  urls: z.array(z.string().trim().max(2000)).max(10),
  sheetTab: z.string().trim().max(100).optional(),
});

/** Finds a job in the applier's sheet so the extension can use the sheet's details for it. */
export const POST = extRoute(async (request, user) => {
  const { key, urls, sheetTab } = body.parse(await request.json());
  const sheetId = await resolveSheetId(user.id);
  const match = await findSheetJob(sheetId, { key, urls, preferredTab: sheetTab });
  return NextResponse.json({ match });
});
