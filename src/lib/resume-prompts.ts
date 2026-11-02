// Shared by the server, the seed script and client components (no server-only imports).

/** Placeholders a prompt can use; the extension fills them with the job's details. */
export const PROMPT_PLACEHOLDERS = [
  { key: "jobTitle", label: "Job title" },
  { key: "company", label: "Company" },
  { key: "jobDescription", label: "Job description" },
  { key: "jobType", label: "Job category / type" },
  { key: "salary", label: "Salary" },
  { key: "location", label: "Location" },
  { key: "jobUrl", label: "Job URL" },
  { key: "templateName", label: "Selected template name" },
] as const;

export const STARTER_PROMPT = `You are an expert resume writer and ATS optimisation specialist.

I have attached my resume template ({{templateName}}). Rewrite it so it is tailored to the job below:
- Keep the template's structure, section order, formatting and my real experience; never invent employers, dates, degrees or certifications.
- Rewrite the summary and the bullet points to emphasise the skills, tools and outcomes this job asks for, using its keywords naturally.
- Quantify achievements where the original content allows it.
- Keep it to the same length as the template.
- Return the full resume text section by section, ready to paste back into the .docx template.

Job title: {{jobTitle}}
Company: {{company}}

Job description:
{{jobDescription}}`;

export type PromptJob = Partial<Record<(typeof PROMPT_PLACEHOLDERS)[number]["key"], string>>;

/** Replaces {{placeholder}} tokens; unknown tokens are left untouched. */
export function fillPrompt(body: string, job: PromptJob) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (token, key: string) =>
    key in job ? (job[key as keyof PromptJob] ?? "") : token,
  );
}
