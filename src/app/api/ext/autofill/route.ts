import { NextResponse } from "next/server";
import { z } from "zod";
import { apiError, extRoute } from "@/lib/api";
import { AutofillNotConfiguredError, generateAnswers } from "@/lib/autofill";
import { resumeText } from "@/lib/resume-text";

const RESUME_MAX_BYTES = 10 * 1024 * 1024;
// Generating a full form's answers can take 20-60 s.
export const maxDuration = 120;

const data = z.object({
  job: z.object({
    title: z.string().trim().max(300).default(""),
    company: z.string().trim().max(300).default(""),
    description: z.string().trim().max(20_000).default(""),
  }),
  questions: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(100),
        label: z.string().trim().min(1).max(1000),
        hint: z.string().trim().max(1000).optional(),
        maxLength: z.number().int().positive().max(100_000).optional(),
        size: z.enum(["long", "short"]),
      }),
    )
    .min(1)
    .max(40),
});

/**
 * Generates answers to an application form's open-ended questions from the candidate's resume and
 * the job description. multipart/form-data: `data` (JSON: job + questions) and the `resume` file.
 * Nothing is stored: the resume and the answers only pass through.
 */
export const POST = extRoute(async (request) => {
  if (!(request.headers.get("content-type") ?? "").includes("multipart/form-data")) return apiError("Attach the resume to autofill from.");
  const form = await request.formData();
  const resume = form.get("resume");
  if (!(resume instanceof File) || resume.size === 0) return apiError("Attach the resume to autofill from.");
  if (resume.size > RESUME_MAX_BYTES) return apiError("The resume must be 10 MB or smaller.");
  let input: z.infer<typeof data>;
  try {
    input = data.parse(JSON.parse(String(form.get("data") ?? "{}")));
  } catch {
    return apiError("Invalid questions.");
  }
  try {
    const text = await resumeText(resume);
    return NextResponse.json(await generateAnswers(text, input.job, input.questions));
  } catch (error) {
    if (error instanceof AutofillNotConfiguredError) return apiError(error.message, 503);
    throw error;
  }
});
