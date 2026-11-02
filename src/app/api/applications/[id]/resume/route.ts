import { after, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getRequestUser } from "@/lib/auth";
import { errorMessage, replaceResume, syncApplicationToSheet } from "@/lib/applications";

/** Replaces the resume of an application (used by the web detail page). */
export async function POST(request: Request, ctx: RouteContext<"/api/applications/[id]/resume">) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const file = (await request.formData()).get("resume");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
  try {
    const app = await replaceResume(user, id, file);
    after(() => syncApplicationToSheet(id, { details: true }));
    revalidatePath(`/applications/${id}`);
    return NextResponse.json({ resumeUrl: app.resumeUrl, resumeName: app.resumeName });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
