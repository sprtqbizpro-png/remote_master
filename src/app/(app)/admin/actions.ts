"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { forgetUser, hashPassword, requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { errorMessage, forgetStages, UserFacingError } from "@/lib/applications";
import { googleErrorMessage } from "@/lib/google";
import { extractGoogleId, getSetting, setSetting } from "@/lib/settings";
import { assignUserSheet, testSheetConnection } from "@/lib/sheets";
import { testDriveFolder } from "@/lib/storage";

export type AdminResult = { ok: true; message?: string } | { ok: false; error: string };

async function run(fn: () => Promise<string | void>, paths: string[]): Promise<AdminResult> {
  try {
    const message = await fn();
    forgetStages();
    paths.forEach((p) => revalidatePath(p));
    return { ok: true, message: message || undefined };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

/* ---------------- Users ---------------- */

const role = z.enum(["OWNER", "APPLIER"]);
const userFields = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  email: z.email("Enter a valid email").trim().toLowerCase(),
  role,
});
const password = z.string().min(8, "Password must be at least 8 characters").max(200);

async function assertAnotherOwner(excludingId: string) {
  const owners = await db.user.count({ where: { role: "OWNER", active: true, id: { not: excludingId } } });
  if (owners === 0) throw new UserFacingError("The platform needs at least one active owner.");
}

const sheetInput = z.string().trim().max(500).optional().default("");

export async function createUserAction(input: { name: string; email: string; role: string; password: string; sheet?: string }) {
  await requireOwner();
  return run(async () => {
    const data = userFields.extend({ password, sheet: sheetInput }).parse(input);
    if (await db.user.findUnique({ where: { email: data.email } })) throw new UserFacingError("A user with this email already exists.");
    const user = await db.user.create({
      data: { name: data.name, email: data.email, role: data.role, passwordHash: await hashPassword(data.password) },
    });
    if (data.sheet) {
      try {
        await assignUserSheet(user.id, data.sheet);
      } catch (error) {
        return `User created, but the sheet was not assigned: ${errorMessage(error)}`;
      }
    }
  }, ["/admin/users"]);
}

export async function updateUserAction(
  id: string,
  input: { name: string; email: string; role: string; active: boolean; sheet?: string },
) {
  const me = await requireOwner();
  return run(async () => {
    const { sheet, ...data } = userFields.extend({ active: z.boolean(), sheet: sheetInput }).parse(input);
    const user = await db.user.findUnique({ where: { id } });
    if (!user) throw new UserFacingError("User not found.");
    if (user.role === "OWNER" && (data.role !== "OWNER" || !data.active)) await assertAnotherOwner(id);
    if (id === me.id && !data.active) throw new UserFacingError("You cannot deactivate your own account.");
    const clash = await db.user.findFirst({ where: { email: data.email, id: { not: id } } });
    if (clash) throw new UserFacingError("A user with this email already exists.");
    // Validate the sheet first so a bad sheet doesn't leave a half-saved user.
    if (extractGoogleId(sheet) !== user.sheetId) await assignUserSheet(id, sheet);
    await db.user.update({
      where: { id },
      data: {
        ...data,
        // Deactivation signs the user out everywhere, including the extension.
        ...(user.active && !data.active && { tokenVersion: { increment: 1 } }),
      },
    });
    forgetUser(id);
  }, ["/admin/users"]);
}

export async function resetPasswordAction(id: string, newPassword: string) {
  await requireOwner();
  return run(async () => {
    const pw = password.parse(newPassword);
    await db.user.update({
      where: { id },
      data: { passwordHash: await hashPassword(pw), tokenVersion: { increment: 1 } },
    });
    forgetUser(id);
    return "Password updated. The user has been signed out of the web app and extension.";
  }, ["/admin/users"]);
}

/**
 * Suspends an applier: they can still sign in and see their applications, but every attempt to
 * apply (extension or platform) is refused with a message to contact the owner, until lifted.
 */
export async function suspendUserAction(id: string, reason: string) {
  const me = await requireOwner();
  return run(async () => {
    const why = z.string().trim().max(300).parse(reason ?? "");
    if (id === me.id) throw new UserFacingError("You cannot suspend your own account.");
    const user = await db.user.findUnique({ where: { id } });
    if (!user) throw new UserFacingError("User not found.");
    if (user.role === "OWNER") throw new UserFacingError("Owners can't be suspended. Change their role to job applier first.");
    await db.user.update({ where: { id }, data: { suspendedAt: new Date(), suspendedReason: why } });
    forgetUser(id);
    return `${user.name} is suspended. They can't apply until you lift the suspension.`;
  }, ["/admin/users"]);
}

export async function liftSuspensionAction(id: string) {
  await requireOwner();
  return run(async () => {
    const user = await db.user.findUnique({ where: { id } });
    if (!user) throw new UserFacingError("User not found.");
    await db.user.update({ where: { id }, data: { suspendedAt: null, suspendedReason: "" } });
    forgetUser(id);
    return `${user.name} can apply again.`;
  }, ["/admin/users"]);
}

export async function deleteUserAction(id: string) {
  const me = await requireOwner();
  return run(async () => {
    if (id === me.id) throw new UserFacingError("You cannot delete your own account.");
    const user = await db.user.findUnique({ where: { id } });
    if (!user) throw new UserFacingError("User not found.");
    if (user.role === "OWNER") await assertAnotherOwner(id);
    await db.user.delete({ where: { id } });
    forgetUser(id);
  }, ["/admin/users", "/applications", "/board"]);
}

/* ---------------- Autofill (OpenAI) ---------------- */

export async function saveAutofillSettingsAction(input: { model: string }) {
  await requireOwner();
  return run(async () => {
    const model = input.model.trim();
    if (model && !/^[\w.:-]{2,80}$/.test(model)) throw new UserFacingError("Enter a model name such as gpt-4.1-mini.");
    await setSetting("openaiModel", model);
    return "Saved.";
  }, ["/admin/settings"]);
}

/* ---------------- Google settings ---------------- */

export async function saveGoogleSettingsAction(input: { sheetId: string; driveFolderId: string }) {
  await requireOwner();
  return run(async () => {
    await setSetting("sheetId", extractGoogleId(input.sheetId));
    await setSetting("driveFolderId", extractGoogleId(input.driveFolderId));
    return "Settings saved.";
  }, ["/admin/settings"]);
}

export async function testGoogleAction(): Promise<{ sheet: string; drive: string }> {
  await requireOwner();
  const [sheet, drive] = await Promise.allSettled([testSheetConnection(await getSetting("sheetId")), testDriveFolder()]);
  return {
    sheet:
      sheet.status === "fulfilled"
        ? `✅ Connected to "${sheet.value.title}" (tabs: ${sheet.value.tabs.join(", ") || "none"})`
        : `❌ ${googleErrorMessage(sheet.reason)}`,
    drive: drive.status === "fulfilled" ? `✅ Folder "${drive.value.name}" is reachable` : `❌ ${googleErrorMessage(drive.reason)}`,
  };
}

/* ---------------- Stages ---------------- */

const stageFields = z.object({
  name: z.string().trim().min(1, "Stage name is required").max(60),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a valid color"),
});

const STAGE_PATHS = ["/admin/settings", "/board", "/applications"];

export async function createStageAction(input: { name: string; color: string }) {
  await requireOwner();
  return run(async () => {
    const data = stageFields.parse(input);
    if (await db.stage.findUnique({ where: { name: data.name } })) throw new UserFacingError("A stage with this name exists.");
    const last = await db.stage.findFirst({ orderBy: { order: "desc" } });
    await db.stage.create({ data: { ...data, order: (last?.order ?? -1) + 1 } });
  }, STAGE_PATHS);
}

export async function updateStageAction(id: string, input: { name: string; color: string }) {
  await requireOwner();
  return run(async () => {
    const data = stageFields.parse(input);
    const clash = await db.stage.findFirst({ where: { name: data.name, id: { not: id } } });
    if (clash) throw new UserFacingError("A stage with this name exists.");
    await db.stage.update({ where: { id }, data });
  }, STAGE_PATHS);
}

export async function reorderStagesAction(ids: string[]) {
  await requireOwner();
  return run(async () => {
    await db.$transaction(ids.map((id, order) => db.stage.update({ where: { id }, data: { order } })));
  }, STAGE_PATHS);
}

export async function setDefaultStageAction(id: string) {
  await requireOwner();
  return run(async () => {
    await db.$transaction([
      db.stage.updateMany({ data: { isDefault: false } }),
      db.stage.update({ where: { id }, data: { isDefault: true } }),
    ]);
  }, STAGE_PATHS);
}

export async function deleteStageAction(id: string, moveToId: string) {
  await requireOwner();
  return run(async () => {
    if (id === moveToId) throw new UserFacingError("Pick a different stage to move applications to.");
    const stage = await db.stage.findUnique({ where: { id } });
    if (!stage) throw new UserFacingError("Stage not found.");
    if ((await db.stage.count()) <= 1) throw new UserFacingError("At least one stage is required.");
    const target = await db.stage.findUnique({ where: { id: moveToId } });
    if (!target) throw new UserFacingError("Target stage not found.");
    await db.$transaction([
      db.application.updateMany({ where: { stageId: id }, data: { stageId: moveToId } }),
      db.stage.delete({ where: { id } }),
      ...(stage.isDefault ? [db.stage.update({ where: { id: moveToId }, data: { isDefault: true } })] : []),
    ]);
  }, STAGE_PATHS);
}
