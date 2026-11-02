import { requireUser } from "@/lib/auth";
import { listPrompts, listTemplates } from "@/lib/resume-kit";
import { ResumeKit } from "./resume-kit";

export default async function ResumeKitPage() {
  const user = await requireUser();
  const [templates, prompts] = await Promise.all([listTemplates(user), listPrompts(user)]);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold">Resume kit</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          A job-specific resume is generated from a resume template (.docx), a generation prompt and the job&apos;s
          details. Manage your templates and prompts here. In the extension&apos;s Apply tab, pick them for a job to
          copy the filled-in prompt and download the template.
        </p>
      </div>
      <ResumeKit
        canShare={user.role === "OWNER"}
        templates={templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          fileName: t.fileName,
          size: t.size,
          shared: t.shared,
          isDefault: t.isDefault,
          mine: t.mine,
          owner: t.owner,
          updatedAt: t.updatedAt.toISOString(),
        }))}
        prompts={prompts.map((p) => ({
          id: p.id,
          name: p.name,
          body: p.body,
          shared: p.shared,
          isDefault: p.isDefault,
          mine: p.mine,
          owner: p.owner,
          updatedAt: p.updatedAt.toISOString(),
        }))}
      />
    </div>
  );
}
