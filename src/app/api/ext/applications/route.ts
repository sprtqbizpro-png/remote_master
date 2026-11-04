import { NextResponse } from "next/server";
import { apiError, extRoute } from "@/lib/api";
import { absoluteUrl, createApplication, SaveConflictError } from "@/lib/applications";

/** Most ids a save can acknowledge (more than any real confirmation dialog shows). */
const MAX_ACKNOWLEDGED = 200;

function acknowledgedIds(value: FormDataEntryValue | null) {
  try {
    const ids: unknown = JSON.parse(String(value ?? "[]"));
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string").slice(0, MAX_ACKNOWLEDGED) : []);
  } catch {
    return new Set<string>();
  }
}

/**
 * Saves an application from the extension.
 * Requires multipart/form-data with a `data` field (JSON job details) and the `resume` file used
 * for the application.
 *
 * Several people may be saving at the same time, so whether this job (or another job at the same
 * company) was already applied to is checked here, at the moment of saving, under a lock: what the
 * extension checked earlier may be out of date. A conflict the applicant hasn't confirmed answers
 * 409 `{ conflict: true, matches, companyMatches }` with the current applications; the extension
 * asks, then sends again with their ids in `acknowledged` (a JSON array).
 */
export const POST = extRoute(async (request, user) => {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) {
    return apiError("Upload the resume used for this application.");
  }
  const form = await request.formData();
  let data: unknown;
  try {
    data = JSON.parse(String(form.get("data") ?? "{}"));
  } catch {
    return apiError("Invalid job data.");
  }
  const resume = form.get("resume");
  if (!(resume instanceof File) || resume.size === 0) return apiError("Upload the resume used for this application.");

  let saved;
  try {
    saved = await createApplication(user, data, resume, { guard: { acknowledged: acknowledgedIds(form.get("acknowledged")) } });
  } catch (error) {
    if (!(error instanceof SaveConflictError)) throw error;
    const { matches, companyMatches } = error.conflicts;
    return NextResponse.json(
      {
        error: error.message,
        conflict: true,
        duplicate: matches.length > 0,
        matches,
        companyMatches,
      },
      { status: 409 },
    );
  }
  const { application, warnings } = saved;
  return NextResponse.json(
    {
      application: {
        id: application.id,
        title: application.title,
        company: application.company,
        resumeUrl: application.resumeUrl ? absoluteUrl(application.resumeUrl) : "",
        sheetTab: application.sheetTab,
        appliedAt: application.appliedAt,
        url: absoluteUrl(`/applications/${application.id}`),
      },
      warnings,
    },
    { status: 201 },
  );
}, { applies: true });
