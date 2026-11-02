import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import type { SessionUser } from "./auth";
import { db } from "./db";
import { memo } from "./memo";
import { googleErrorMessage } from "./google";
import { after } from "next/server";
import { googleAuthMode } from "./google";
import { markJobApplied, normalizeCompany, normalizeUrl, resolveSheetId, SheetNotConfiguredError, updateJobRow, type RowValues } from "./sheets";
import { siteLabel } from "./sites";
import { deleteStoredResume, ResumeStorageError, storeResume, validateResume } from "./storage";

const text = (max: number) => z.string().trim().max(max).optional().default("");

export const applicationInput = z.object({
  title: z.string({ error: "Job title is required" }).trim().min(1, "Job title is required").max(300),
  company: text(200),
  location: text(300),
  jobType: text(100),
  salary: text(200),
  postedAt: text(100),
  jobUrl: text(2000),
  applyUrl: text(2000),
  source: text(100),
  description: text(100_000),
  notes: text(10_000),
  extra: z.record(z.string(), z.unknown()).optional().default({}),
  stageId: z.string().optional(),
  /** Other URLs the job was seen at (the link opened, the page it redirected to). */
  pageUrls: z.array(z.string().trim().max(2000)).max(10).optional().default([]),
  /** Sheet tab the job was loaded from in the extension (helps find the row). */
  sheetTab: text(100),
  jobKey: text(500),
});

export type ApplicationInput = z.input<typeof applicationInput>;

export const applicationEditInput = applicationInput
  .omit({ stageId: true, sheetTab: true, jobKey: true, extra: true, pageUrls: true })
  .partial();

export function visibleWhere(user: SessionUser): Prisma.ApplicationWhereInput {
  return user.role === "OWNER" ? {} : { userId: user.id };
}

export async function getAccessibleApplication(user: SessionUser, id: string) {
  return db.application.findFirst({ where: { id, ...visibleWhere(user) } });
}

/** Board columns: read on nearly every page and API call, edited rarely (Admin > Settings). */
const stagesCache = memo(60_000, (_: "all") => db.stage.findMany({ orderBy: { order: "asc" } }));

export function listStages() {
  return stagesCache("all");
}

export function forgetStages() {
  stagesCache.invalidate();
}

async function stageById(id: string) {
  const hit = (await listStages()).find((s) => s.id === id);
  if (hit) return hit;
  // Unknown id: the cached list may be older than a change made elsewhere, so reload once.
  forgetStages();
  return (await listStages()).find((s) => s.id === id) ?? null;
}

async function defaultStage() {
  const stages = await listStages();
  const stage = stages.find((s) => s.isDefault) ?? stages[0];
  if (!stage) throw new Error("No stages are configured. Add one in Admin > Settings.");
  return stage;
}

/** Position that places a card at the top of a board column. */
async function topPosition(stageId: string) {
  const first = await db.application.findFirst({ where: { stageId }, orderBy: { position: "asc" } });
  return first ? first.position - 1 : 0;
}

/**
 * Creates an application, stores the resume (Drive or local) and marks the job as applied in
 * the applier's Google Sheet. Sheet failures do not fail the save; they are returned as warnings.
 */
export async function createApplication(user: SessionUser, raw: unknown, resume?: File | null) {
  const input = applicationInput.parse(raw);
  const warnings: string[] = [];

  const stage = input.stageId ? await stageById(input.stageId) : null;
  const targetStage = stage ?? (await defaultStage());

  if (resume) {
    const problem = validateResume(resume);
    if (problem) throw new UserFacingError(problem);
  }
  const stored = resume
    ? await storeResume(resume, {
        applierName: user.name,
        displayName: [input.company, input.title, user.name].filter(Boolean).join(" - "),
      })
    : null;

  const source = input.source || (input.jobUrl || input.applyUrl ? siteLabel(input.jobUrl || input.applyUrl) : "Manual");
  const application = await db.application.create({
    data: {
      userId: user.id,
      stageId: targetStage.id,
      position: await topPosition(targetStage.id),
      title: input.title,
      company: input.company,
      location: input.location,
      jobType: input.jobType,
      salary: input.salary,
      postedAt: input.postedAt,
      jobUrl: input.jobUrl,
      applyUrl: input.applyUrl,
      jobUrlKey: normalizeUrl(input.jobUrl),
      applyUrlKey: normalizeUrl(input.applyUrl),
      source,
      description: input.description,
      notes: input.notes,
      extra: JSON.stringify(input.extra),
      resumeName: stored?.name ?? "",
      resumeUrl: stored?.url ?? "",
      resumeStore: stored?.store ?? "",
      resumeFileId: stored?.fileId ?? "",
      events: {
        create: {
          userId: user.id,
          type: "created",
          message: `Applied${stored ? ` with resume "${stored.name}"` : ""} (stage: ${targetStage.name})`,
        },
      },
    },
  }).catch(async (error) => {
    if (stored) await deleteStoredResume(stored);
    throw error;
  });

  // Google Sheets calls take a few hundred ms each (seconds when a token must be fetched), so the
  // sheet is updated after the response is sent. Failures are recorded in the job's history.
  const sheetProblem = await sheetConfigProblem(user.id);
  if (sheetProblem) warnings.push(`Sheet not updated: ${sheetProblem}`);
  else {
    const pageUrls = input.pageUrls;
    after(() =>
      recordApplicationInSheet(application.id, { jobKey: input.jobKey, sheetTab: input.sheetTab, pageUrls }).catch((error) =>
        console.warn("Sheet update failed:", googleErrorMessage(error)),
      ),
    );
  }

  return { application, warnings };
}

export async function moveApplication(user: SessionUser, id: string, stageId: string, position?: number) {
  const app = await getAccessibleApplication(user, id);
  if (!app) throw new UserFacingError("Application not found.");
  const stage = await stageById(stageId);
  if (!stage) throw new UserFacingError("Stage not found.");
  const changed = app.stageId !== stageId;
  const previous = changed ? await stageById(app.stageId) : null;

  const updated = await db.application.update({
    where: { id },
    data: {
      stageId,
      position: position ?? (changed ? await topPosition(stageId) : app.position),
      ...(changed && {
        events: {
          create: { userId: user.id, type: "stage", message: `Moved from ${previous?.name ?? "?"} to ${stage.name}` },
        },
      }),
    },
  });
  return { application: updated, stageChanged: changed, stageName: stage.name };
}

/** Why the sheet can't be written right now (cheap checks only), or "" when it can. */
async function sheetConfigProblem(userId: string) {
  const mode = googleAuthMode().kind;
  if (mode === "none" || mode === "invalid") return "Google credentials are not configured on the server.";
  if (!(await resolveSheetId(userId))) return "No Google Sheet is assigned. Set your sheet in the extension's Account tab or ask the owner.";
  return "";
}

async function sheetEvent(applicationId: string, message: string) {
  await db.applicationEvent.create({ data: { applicationId, type: "sheet", message } }).catch(() => undefined);
}

/**
 * Marks a newly saved application in the applier's sheet: the job's existing row is updated
 * (found by key, URL, or company + title); a row is added only if the job isn't in the sheet.
 */
export async function recordApplicationInSheet(
  applicationId: string,
  hints: { jobKey?: string; sheetTab?: string; pageUrls?: string[] },
) {
  const app = await db.application.findUnique({ where: { id: applicationId }, include: { user: { select: { name: true } } } });
  if (!app) return;
  try {
    const sheetId = await resolveSheetId(app.userId);
    // Use the stage as it is now, in case it changed while this was queued.
    const stage = await stageById(app.stageId);
    const result = await markJobApplied(
      sheetId,
      {
        key: hints.jobKey,
        title: app.title,
        company: app.company,
        jobType: app.jobType,
        location: app.location,
        salary: app.salary,
        postedAt: app.postedAt,
        jobUrl: app.jobUrl,
        applyUrl: app.applyUrl,
        urls: hints.pageUrls,
        site: app.source,
        preferredTab: hints.sheetTab,
      },
      { status: stage?.name ?? "Applied", appliedBy: app.user.name, appliedAt: app.appliedAt, resume: app.resumeUrl ? absoluteUrl(app.resumeUrl) : "" },
    );
    await db.application.update({ where: { id: app.id }, data: { sheetId, sheetTab: result.tab, jobKey: result.key } });
    if (result.appended) await sheetEvent(app.id, `Added to the sheet (${result.tab} tab): the job wasn't in it yet`);
  } catch (error) {
    await sheetEvent(app.id, `Sheet not updated: ${errorMessage(error)}`);
    throw error;
  }
}

/**
 * Mirrors an application's current state into its existing sheet row: always the status, plus
 * the job details and resume when `details` is set. Never adds a row; when the job isn't in the
 * sheet nothing is written.
 */
export async function syncApplicationToSheet(applicationId: string, { details = false } = {}) {
  try {
    const app = await db.application.findUnique({ where: { id: applicationId } });
    if (!app) return;
    if (await sheetConfigProblem(app.userId)) return;
    const sheetId = app.sheetId || (await resolveSheetId(app.userId));
    const stage = await stageById(app.stageId);
    const values: RowValues = { Status: stage?.name ?? "" };
    if (details) {
      Object.assign(values, {
        Title: app.title,
        Company: app.company,
        "Job Type": app.jobType,
        Location: app.location,
        Salary: app.salary,
        ...(app.jobUrl && { "Job URL": app.jobUrl }),
        ...(app.applyUrl && { "Apply URL": app.applyUrl }),
        ...(app.resumeUrl && { Resume: absoluteUrl(app.resumeUrl) }),
      });
    }
    const result = await updateJobRow(
      sheetId,
      { key: app.jobKey, urls: [app.jobUrl, app.applyUrl].filter(Boolean), title: app.title, company: app.company, preferredTab: app.sheetTab },
      values,
    );
    if (result && (result.tab !== app.sheetTab || result.key !== app.jobKey || sheetId !== app.sheetId)) {
      await db.application.update({ where: { id: app.id }, data: { sheetId, sheetTab: result.tab, jobKey: result.key } });
    }
  } catch (error) {
    console.warn("Sheet sync failed:", googleErrorMessage(error));
  }
}

export async function updateApplication(user: SessionUser, id: string, raw: unknown) {
  const app = await getAccessibleApplication(user, id);
  if (!app) throw new UserFacingError("Application not found.");
  const input = applicationEditInput.parse(raw);
  const keys = {
    ...(input.jobUrl !== undefined && { jobUrlKey: normalizeUrl(input.jobUrl) }),
    ...(input.applyUrl !== undefined && { applyUrlKey: normalizeUrl(input.applyUrl) }),
  };
  const noteChanged = input.notes !== undefined && input.notes !== app.notes;
  const otherChanged = Object.entries(input).some(
    ([k, v]) => k !== "notes" && v !== undefined && v !== app[k as keyof typeof app],
  );
  return db.application.update({
    where: { id },
    data: {
      ...input,
      ...keys,
      events: {
        create: [
          ...(noteChanged ? [{ userId: user.id, type: "note", message: "Notes updated" }] : []),
          ...(otherChanged ? [{ userId: user.id, type: "edit", message: "Job details edited" }] : []),
        ],
      },
    },
  });
}

export async function replaceResume(user: SessionUser, id: string, file: File) {
  const app = await getAccessibleApplication(user, id);
  if (!app) throw new UserFacingError("Application not found.");
  const problem = validateResume(file);
  if (problem) throw new UserFacingError(problem);
  const owner = await db.user.findUniqueOrThrow({ where: { id: app.userId } });
  const stored = await storeResume(file, {
    applierName: owner.name,
    displayName: [app.company, app.title, owner.name].filter(Boolean).join(" - "),
  });
  return db.application
    .update({
      where: { id },
      data: {
        resumeName: stored.name,
        resumeUrl: stored.url,
        resumeStore: stored.store,
        resumeFileId: stored.fileId,
        events: { create: { userId: user.id, type: "resume", message: `Resume replaced with "${stored.name}"` } },
      },
    })
    .catch(async (error) => {
      await deleteStoredResume(stored);
      throw error;
    });
}

export async function deleteApplication(user: SessionUser, id: string) {
  const app = await getAccessibleApplication(user, id);
  if (!app) throw new UserFacingError("Application not found.");
  await db.application.delete({ where: { id } });
}

/** Finds existing applications for any of the given URLs (the caller's own and, for context, anyone's). */
export async function findExistingApplications(user: SessionUser, urls: string[]) {
  const keys = [...new Set(urls.map(normalizeUrl).filter(Boolean))];
  if (!keys.length) return [];
  const candidates = await db.application.findMany({
    where: { OR: [{ jobUrlKey: { in: keys } }, { applyUrlKey: { in: keys } }] },
    select: { id: true, userId: true, appliedAt: true, user: { select: { name: true } }, stage: { select: { name: true } } },
    orderBy: { appliedAt: "desc" },
    take: 20,
  });
  return candidates.map((a) => {
    const visible = user.role === "OWNER" || a.userId === user.id;
    return {
      id: a.id,
      mine: a.userId === user.id,
      appliedBy: visible ? a.user.name : "another applier",
      appliedAt: a.appliedAt,
      stage: a.stage.name,
      url: visible ? absoluteUrl(`/applications/${a.id}`) : "",
    };
  });
}

/** Stage names that mean the application is over (anything else is still in progress). */
const CLOSED_STAGE = /reject|withdr|declin|closed|lost|not selected|no response|ghost|archiv/i;

export function isClosedStage(name: string) {
  return CLOSED_STAGE.test(name);
}

/**
 * The caller's own applications at the same company (names compared loosely: "Acme, Inc." =
 * "ACME"), newest first.
 */
export async function findCompanyApplications(user: SessionUser, company: string) {
  const target = normalizeCompany(company);
  if (!target) return [];
  // Narrow in the database by the company's longest word, then compare normalised names here.
  const word = target.split(" ").sort((a, b) => b.length - a.length)[0];
  const candidates = await db.application.findMany({
    where: {
      userId: user.id,
      ...(word.length >= 2 && company.toLowerCase().includes(word) && { company: { contains: word, mode: "insensitive" } }),
    },
    select: { id: true, title: true, company: true, stageId: true, appliedAt: true },
    orderBy: { appliedAt: "desc" },
    take: 200,
  });
  let stages = await listStages();
  if (candidates.some((a) => !stages.some((st) => st.id === a.stageId))) {
    forgetStages();
    stages = await listStages();
  }
  return candidates
    .filter((a) => normalizeCompany(a.company) === target)
    .slice(0, 20)
    .map((a) => {
      const stage = stages.find((st) => st.id === a.stageId)?.name ?? "";
      return {
        id: a.id,
        title: a.title,
        company: a.company,
        stage,
        active: !isClosedStage(stage),
        appliedAt: a.appliedAt,
        url: absoluteUrl(`/applications/${a.id}`),
      };
    });
}

/**
 * Companies the user has applied to, from the applications saved on the platform (never the
 * Google Sheet): normalised name -> display name and number of applications.
 */
export async function appliedCompanies(userId: string) {
  const rows = await db.application.groupBy({ by: ["company"], where: { userId, company: { not: "" } }, _count: true });
  const map = new Map<string, { name: string; count: number }>();
  for (const r of rows) {
    const key = normalizeCompany(r.company);
    if (!key) continue;
    const hit = map.get(key);
    if (hit) hit.count += r._count;
    else map.set(key, { name: r.company.trim(), count: r._count });
  }
  return map;
}

export function absoluteUrl(url: string) {
  if (/^https?:\/\//i.test(url)) return url;
  const base = (process.env.APP_URL || "http://localhost:3000").replace(/\/$/, "");
  return `${base}${url.startsWith("/") ? "" : "/"}${url}`;
}

/** An error whose message is safe to show to the user. */
export class UserFacingError extends Error {}

export function errorMessage(error: unknown) {
  if (error instanceof z.ZodError) return error.issues.map((i) => i.message).join("; ");
  if (error instanceof UserFacingError || error instanceof SheetNotConfiguredError || error instanceof ResumeStorageError) {
    return error.message;
  }
  console.error(error);
  return googleErrorMessage(error) || "Something went wrong.";
}
