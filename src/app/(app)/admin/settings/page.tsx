import { requireOwner } from "@/lib/auth";
import { db } from "@/lib/db";
import { googleAuthMode } from "@/lib/google";
import { getSetting } from "@/lib/settings";
import { DEFAULT_OPENAI_MODEL, openaiKey } from "@/lib/autofill";
import { AutofillSettings } from "./autofill-settings";
import { GoogleSettings } from "./google-settings";
import { StagesManager } from "./stages-manager";

export default async function SettingsPage() {
  await requireOwner();
  const [sheetId, driveFolderId, openaiModel, stages] = await Promise.all([
    getSetting("sheetId"),
    getSetting("driveFolderId"),
    getSetting("openaiModel"),
    db.stage.findMany({ orderBy: { order: "asc" }, include: { _count: { select: { applications: true } } } }),
  ]);
  const mode = googleAuthMode();
  const modeLabel = {
    oauth: "OAuth refresh token",
    "service-account": `Service account (${mode.detail})`,
    invalid: `Invalid: ${mode.detail}`,
    none: "Not configured. Set GOOGLE_* variables in web/.env and restart.",
  }[mode.kind];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-slate-500">Google integration, answer autofill and application statuses.</p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Google Sheets &amp; Drive</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          Scraped jobs are written to one tab per job site in the spreadsheet. Resumes are uploaded to the Drive folder
          (one sub-folder per applier).
        </p>
        <div className="mb-4 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <span className="text-slate-500">Credentials: </span>
          <span className={mode.kind === "oauth" || mode.kind === "service-account" ? "text-emerald-700" : "text-amber-700"}>
            {modeLabel}
          </span>
        </div>
        <GoogleSettings sheetId={sheetId} driveFolderId={driveFolderId} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Answer autofill (OpenAI)</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          The extension&apos;s &ldquo;Autofill answers&rdquo; fills an application form&apos;s open-ended questions with short answers written
          from the attached resume and the job description. The resume and job are sent to OpenAI for this; nothing is stored.
        </p>
        <AutofillSettings model={openaiModel} defaultModel={DEFAULT_OPENAI_MODEL} hasKey={Boolean(openaiKey())} />
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-semibold">Application statuses</h2>
        <p className="mb-4 mt-1 text-sm text-slate-500">
          These are the board columns. New applications from the extension land in the default status.
        </p>
        <StagesManager
          stages={stages.map((s) => ({
            id: s.id,
            name: s.name,
            color: s.color,
            isDefault: s.isDefault,
            count: s._count.applications,
          }))}
        />
      </section>
    </div>
  );
}
