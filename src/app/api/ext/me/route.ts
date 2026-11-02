import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, extRoute } from "@/lib/api";
import { listStages } from "@/lib/applications";
import { db } from "@/lib/db";
import { googleAuthMode, googleShareHint } from "@/lib/google";
import { getSetting } from "@/lib/settings";
import { assignUserSheet, SheetNotConfiguredError, sheetUrlFor } from "@/lib/sheets";

async function profile(userId: string) {
  const [stages, me, defaultSheet, folder] = await Promise.all([
    listStages(),
    db.user.findUniqueOrThrow({ where: { id: userId }, select: { sheetId: true } }),
    getSetting("sheetId"),
    getSetting("driveFolderId"),
  ]);
  const google = googleAuthMode().kind;
  const googleOk = google !== "none" && google !== "invalid";
  const sheetId = me.sheetId || defaultSheet;
  return {
    stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color, isDefault: s.isDefault })),
    /** "own" = the applier's own sheet, "default" = platform default, "" = none. */
    sheetSource: me.sheetId ? "own" : defaultSheet ? "default" : "",
    sheetUrl: sheetUrlFor(sheetId),
    sheetsReady: googleOk && Boolean(sheetId),
    driveReady: googleOk && Boolean(folder),
    shareHint: googleShareHint(),
  };
}

export const GET = extRoute(async (_request, user) => {
  return NextResponse.json({ user, ...(await profile(user.id)) });
});

/** Lets an applier set (or clear, with "") their own Google Sheet. */
export const PUT = extRoute(async (request, user) => {
  const { sheet } = z.object({ sheet: z.string().trim().max(500) }).parse(await request.json());
  try {
    await assignUserSheet(user.id, sheet);
  } catch (error) {
    // A sheet that can't be used is a fixable input problem, not a server outage.
    if (error instanceof SheetNotConfiguredError) return apiError(error.message, 400);
    throw error;
  }
  return NextResponse.json({ user, ...(await profile(user.id)) });
});
