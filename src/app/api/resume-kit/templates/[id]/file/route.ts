import { getRequestUser } from "@/lib/auth";
import { getTemplateFile } from "@/lib/resume-kit";

/** Downloads a resume template (.docx). Works with the web session or the extension token. */
export async function GET(request: Request, ctx: RouteContext<"/api/resume-kit/templates/[id]/file">) {
  const user = await getRequestUser(request);
  if (!user) return new Response("Unauthorized", { status: 401 });
  const { id } = await ctx.params;
  const file = await getTemplateFile(user, id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.mimeType,
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
      "cache-control": "private, no-store",
    },
  });
}
