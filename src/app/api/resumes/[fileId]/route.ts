import path from "path";
import { getRequestUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { visibleWhere } from "@/lib/applications";
import { readLocalResume } from "@/lib/storage";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".txt": "text/plain; charset=utf-8",
  ".rtf": "application/rtf",
  ".odt": "application/vnd.oasis.opendocument.text",
};

/** Serves resumes that older versions stored on the platform (new resumes always go to Google Drive). */
export async function GET(request: Request, ctx: RouteContext<"/api/resumes/[fileId]">) {
  const user = await getRequestUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { fileId } = await ctx.params;
  const app = await db.application.findFirst({
    where: { resumeStore: "local", resumeFileId: fileId, ...visibleWhere(user) },
  });
  if (!app) return new Response("Not found", { status: 404 });
  const data = await readLocalResume(fileId);
  if (!data) return new Response("Not found", { status: 404 });
  const ext = path.extname(fileId);
  return new Response(new Uint8Array(data), {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-disposition": `inline; filename="${encodeURIComponent(app.resumeName || `resume${ext}`)}"`,
      "cache-control": "private, no-store",
    },
  });
}
