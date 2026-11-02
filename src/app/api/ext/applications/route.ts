import { NextResponse } from "next/server";
import { apiError, extRoute } from "@/lib/api";
import { absoluteUrl, createApplication, findExistingApplications } from "@/lib/applications";

/**
 * Saves an application from the extension.
 * Requires multipart/form-data with a `data` field (JSON job details) and the `resume` file used
 * for the application. Saving a job that is already recorded as applied returns 409 unless
 * `confirmDuplicate=true` is sent.
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

  // A job already recorded as applied needs explicit confirmation before it is saved again.
  if (form.get("confirmDuplicate") !== "true") {
    const job = (data ?? {}) as { jobUrl?: unknown; applyUrl?: unknown };
    const urls = [job.jobUrl, job.applyUrl].filter((u): u is string => typeof u === "string" && Boolean(u));
    const matches = await findExistingApplications(user, urls);
    if (matches.length) {
      return NextResponse.json(
        { error: "This job is already recorded as applied. Confirm to save it again.", duplicate: true, matches },
        { status: 409 },
      );
    }
  }

  const { application, warnings } = await createApplication(user, data, resume);
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
});
