import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { assertCanApply, getRequestUser } from "@/lib/auth";
import { errorMessage } from "@/lib/applications";
import { readTemplateForm, saveTemplate } from "@/lib/resume-kit";

/** Uploads a new .docx resume template (multipart: name, description, shared, isDefault, file). */
export async function POST(request: Request) {
  const user = await getRequestUser(request);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await assertCanApply(user);
    const { data, file } = await readTemplateForm(request);
    const saved = await saveTemplate(user, data, file);
    revalidatePath("/resume-kit");
    return NextResponse.json(saved, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: errorMessage(error) }, { status: 400 });
  }
}
