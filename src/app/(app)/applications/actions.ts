"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { requireUser } from "@/lib/auth";
import {
  createApplication,
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

export async function createApplicationAction(input: ApplicationInput): Promise<ActionResult> {
  const user = await requireUser();
  try {
    const { application, warnings } = await createApplication(user, input);
    refresh();
    return { ok: true, id: application.id, warnings };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export async function moveApplicationAction(id: string, stageId: string, position?: number): Promise<ActionResult> {
  const user = await requireUser();
  try {
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
    await deleteApplication(user, id);
    refresh();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}
