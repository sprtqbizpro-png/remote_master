import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assertCanApply, getRequestUser } from "@/lib/auth";
import { errorMessage } from "@/lib/applications";
import { readTemplateForm, saveTemplate } from "@/lib/resume-kit";

/** Updates a template's details; a new `file` replaces the stored .docx. */
export async function POST(request: Request, ctx: RouteContext<"/api/resume-kit/templates/[id]">) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  try {
    await assertCanApply(user);
    const { data, file } = await readTemplateForm(request);
    const saved = await saveTemplate(user, data, file, id);
    revalidatePath("/resume-kit");
    return NextResponse.json(saved);
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
