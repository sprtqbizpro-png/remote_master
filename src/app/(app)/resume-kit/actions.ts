"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth";
import { errorMessage } from "@/lib/applications";
import { deletePrompt, deleteTemplate, duplicatePrompt, duplicateTemplate, savePrompt } from "@/lib/resume-kit";

export type KitResult = { ok: true } | { ok: false; error: string };

async function run(fn: () => Promise<unknown>): Promise<KitResult> {
  try {
    await fn();
    revalidatePath("/resume-kit");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function savePromptAction(
  input: { name: string; body: string; shared: boolean; isDefault: boolean },
  id?: string,
) {
  const user = await requireUser();
  return run(() => savePrompt(user, input, id));
}

export async function duplicatePromptAction(id: string) {
  const user = await requireUser();
  return run(() => duplicatePrompt(user, id));
}

export async function deletePromptAction(id: string) {
  const user = await requireUser();
  return run(() => deletePrompt(user, id));
}

export async function duplicateTemplateAction(id: string) {
  const user = await requireUser();
  return run(() => duplicateTemplate(user, id));
}

export async function deleteTemplateAction(id: string) {
  const user = await requireUser();
  return run(() => deleteTemplate(user, id));
}
