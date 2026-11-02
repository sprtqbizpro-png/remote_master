import "server-only";
import path from "path";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { UserFacingError } from "./applications";
export { PROMPT_PLACEHOLDERS, STARTER_PROMPT } from "./resume-prompts";

export const TEMPLATE_MAX_BYTES = 5 * 1024 * 1024;
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Items a user can see: their own plus anything an owner shared. */
function visible(user: SessionUser) {
  return { OR: [{ userId: user.id }, { shared: true }] };
}

const templateMeta = {
  id: true,
  userId: true,
  name: true,
  description: true,
  fileName: true,
  size: true,
  shared: true,
  isDefault: true,
  updatedAt: true,
  user: { select: { name: true } },
} satisfies Prisma.ResumeTemplateSelect;

export async function listTemplates(user: SessionUser) {
  const rows = await db.resumeTemplate.findMany({
    where: visible(user),
    select: templateMeta,
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  return rows.map((t) => ({ ...t, owner: t.user.name, mine: t.userId === user.id, user: undefined }));
}

export async function listPrompts(user: SessionUser) {
  const rows = await db.resumePrompt.findMany({
    where: visible(user),
    include: { user: { select: { name: true } } },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  return rows.map((p) => ({ ...p, owner: p.user.name, mine: p.userId === user.id, user: undefined }));
}

/** Picks what the extension pre-selects: the user's default, then a shared default, then the newest. */
export function pickDefault<T extends { mine: boolean; isDefault: boolean }>(items: T[]) {
  return items.find((i) => i.mine && i.isDefault) ?? items.find((i) => i.isDefault) ?? items[0] ?? null;
}

function validateTemplateFile(file: File) {
  if (path.extname(file.name).toLowerCase() !== ".docx") throw new UserFacingError("Resume templates must be .docx files.");
  if (file.size === 0) throw new UserFacingError("The file is empty.");
  if (file.size > TEMPLATE_MAX_BYTES) throw new UserFacingError("Templates must be 5 MB or smaller.");
}

function isDocx(buffer: Buffer) {
  // A .docx is a zip archive ("PK\x03\x04") containing word/document.xml.
  return buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) && buffer.includes("word/");
}

const name = z.string().trim().min(1, "Name is required").max(120);
const templateFields = z.object({
  name,
  description: z.string().trim().max(1000).optional().default(""),
  shared: z.boolean().optional().default(false),
  isDefault: z.boolean().optional().default(false),
});
const promptFields = z.object({
  name,
  body: z.string().trim().min(1, "The prompt is empty").max(20000),
  shared: z.boolean().optional().default(false),
  isDefault: z.boolean().optional().default(false),
});

/** Only owners may share items with everyone. */
function sharing(user: SessionUser, shared: boolean) {
  return user.role === "OWNER" ? shared : false;
}

async function ownTemplate(user: SessionUser, id: string) {
  const t = await db.resumeTemplate.findUnique({ where: { id }, select: { id: true, userId: true } });
  if (!t || t.userId !== user.id) throw new UserFacingError("Template not found, or it isn't yours to change.");
  return t;
}

async function ownPrompt(user: SessionUser, id: string) {
  const p = await db.resumePrompt.findUnique({ where: { id } });
  if (!p || p.userId !== user.id) throw new UserFacingError("Prompt not found, or it isn't yours to change.");
  return p;
}

/** Makes `id` the user's only default of its kind. */
async function clearOtherDefaults(kind: "template" | "prompt", userId: string, id: string) {
  const where = { userId, isDefault: true, id: { not: id } };
  if (kind === "template") await db.resumeTemplate.updateMany({ where, data: { isDefault: false } });
  else await db.resumePrompt.updateMany({ where, data: { isDefault: false } });
}

/** Creates a template, or replaces the file / details of one when `id` is given. */
export async function saveTemplate(user: SessionUser, raw: unknown, file: File | null, id?: string) {
  const data = templateFields.parse(raw);
  if (id) await ownTemplate(user, id);
  else if (!file) throw new UserFacingError("Choose a .docx file.");

  let fileData: { fileName: string; mimeType: string; size: number; data: Uint8Array<ArrayBuffer> } | undefined;
  if (file) {
    validateTemplateFile(file);
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!isDocx(Buffer.from(bytes.buffer))) throw new UserFacingError("That file isn't a valid .docx document.");
    fileData = { fileName: file.name, mimeType: DOCX_MIME, size: bytes.length, data: bytes };
  }
  const values = { ...data, shared: sharing(user, data.shared) };
  const saved = id
    ? await db.resumeTemplate.update({ where: { id }, data: { ...values, ...fileData }, select: { id: true } })
    : await db.resumeTemplate.create({ data: { ...values, ...fileData!, userId: user.id }, select: { id: true } });
  if (data.isDefault) await clearOtherDefaults("template", user.id, saved.id);
  return saved;
}

export async function savePrompt(user: SessionUser, raw: unknown, id?: string) {
  const data = promptFields.parse(raw);
  if (id) await ownPrompt(user, id);
  const values = { ...data, shared: sharing(user, data.shared) };
  const saved = id
    ? await db.resumePrompt.update({ where: { id }, data: values })
    : await db.resumePrompt.create({ data: { ...values, userId: user.id } });
  if (data.isDefault) await clearOtherDefaults("prompt", user.id, saved.id);
  return saved;
}

/** Copies any visible template (including a shared one) into the user's own collection. */
export async function duplicateTemplate(user: SessionUser, id: string) {
  const t = await db.resumeTemplate.findFirst({ where: { id, ...visible(user) } });
  if (!t) throw new UserFacingError("Template not found.");
  return db.resumeTemplate.create({
    data: {
      userId: user.id,
      name: `${t.name} (copy)`.slice(0, 120),
      description: t.description,
      fileName: t.fileName,
      mimeType: t.mimeType,
      size: t.size,
      data: t.data,
    },
    select: { id: true },
  });
}

export async function duplicatePrompt(user: SessionUser, id: string) {
  const p = await db.resumePrompt.findFirst({ where: { id, ...visible(user) } });
  if (!p) throw new UserFacingError("Prompt not found.");
  return db.resumePrompt.create({ data: { userId: user.id, name: `${p.name} (copy)`.slice(0, 120), body: p.body } });
}

export async function deleteTemplate(user: SessionUser, id: string) {
  await ownTemplate(user, id);
  await db.resumeTemplate.delete({ where: { id } });
}

export async function deletePrompt(user: SessionUser, id: string) {
  await ownPrompt(user, id);
  await db.resumePrompt.delete({ where: { id } });
}

export async function getTemplateFile(user: SessionUser, id: string) {
  return db.resumeTemplate.findFirst({
    where: { id, ...visible(user) },
    select: { fileName: true, mimeType: true, data: true },
  });
}

/** Reads the multipart template form shared by the create and update routes. */
export async function readTemplateForm(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  return {
    data: {
      name: String(form.get("name") ?? ""),
      description: String(form.get("description") ?? ""),
      shared: form.get("shared") === "true",
      isDefault: form.get("isDefault") === "true",
    },
    file: file instanceof File && file.size > 0 ? file : null,
  };
}
