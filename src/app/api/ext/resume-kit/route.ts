import { NextResponse } from "next/server";
import { extRoute } from "@/lib/api";
import { listPrompts, listTemplates, pickDefault, PROMPT_PLACEHOLDERS } from "@/lib/resume-kit";

/** Resume templates (metadata only; download via /api/resume-kit/templates/:id/file) and prompts. */
export const GET = extRoute(async (_request, user) => {
  const [templates, prompts] = await Promise.all([listTemplates(user), listPrompts(user)]);
  return NextResponse.json({
    templates: templates.map((t) => ({ id: t.id, name: t.name, description: t.description, fileName: t.fileName, size: t.size, owner: t.owner, mine: t.mine })),
    prompts: prompts.map((p) => ({ id: p.id, name: p.name, body: p.body, owner: p.owner, mine: p.mine })),
    defaultTemplateId: pickDefault(templates)?.id ?? null,
    defaultPromptId: pickDefault(prompts)?.id ?? null,
    placeholders: PROMPT_PLACEHOLDERS,
  });
});
