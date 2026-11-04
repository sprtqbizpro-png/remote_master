"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { assertCanApply, requireUser } from "@/lib/auth";
import {
  deleteApplication,
  errorMessage,
  moveApplication,
  syncApplicationToSheet,
  updateApplication,
  type ApplicationInput,
} from "@/lib/applications";

export type ActionResult = { ok: true; id?: string; warnings?: string[] } | { ok: false; error: string };

function refresh(id?: string) {
  revalidatePath("/applications");
  revalidatePath("/board");
  if (id) revalidatePath(`/applications/${id}`);
}

export async function moveApplicationAction(id: string, stageId: string, position?: number): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await assertCanApply(user);
    const { application, stageChanged } = await moveApplication(user, id, stageId, position);
    // Update the job's existing sheet row (never adds a row) after responding.
    if (stageChanged) after(() => syncApplicationToSheet(application.id));
    refresh(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function updateApplicationAction(id: string, input: Partial<ApplicationInput>): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await assertCanApply(user);
    await updateApplication(user, id, input);
    after(() => syncApplicationToSheet(id, { details: true }));
    refresh(id);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function deleteApplicationAction(id: string): Promise<ActionResult> {
  const user = await requireUser();
  try {
    await assertCanApply(user);
    await deleteApplication(user, id);
    refresh();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
