import "server-only";
import { UserFacingError } from "./applications";
import { getSetting } from "./settings";

export const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";

export type AutofillQuestion = {
  id: string;
  /** The question as the form shows it. */
  label: string;
  /** Helper text near the field (instructions, word limits). */
  hint?: string;
  /** The field's maxlength, if it has one. */
  maxLength?: number;
  /** "long" for a multi-line box, "short" for a one-line input. */
  size: "long" | "short";
};

export type AutofillJob = { title: string; company: string; description: string };
/** What an answer was built from: the resume, the job description, or neither (a general answer). */
export type AnswerSource = "resume" | "job_description";
export type AutofillAnswer = { id: string; answer: string; skipped: boolean; reason: string; sources: AnswerSource[] };

export class AutofillNotConfiguredError extends Error {}

export function openaiKey() {
  return (process.env.OPENAI_API_KEY ?? "").trim();
}

export async function openaiModel() {
  return (await getSetting("openaiModel")) || (process.env.OPENAI_MODEL ?? "").trim() || DEFAULT_OPENAI_MODEL;
}

const SYSTEM = `You answer job application questions for a candidate, writing as the candidate in the first person.

Work through each question in this order, and fill the fields in this order:

1. "analysis": first understand the question. In one or two short sentences, say what it is really asking and what a good answer needs.
2. "sources": decide what the answer needs, and use only that:
   - "resume" when the answer depends on the candidate's own background: experience, skills, projects, achievements, education, career goals rooted in their history.
   - "job_description" when it depends on this role or company: why this company or role, what interests them about it, how they fit what the team needs, how they'd approach this job's challenges.
   - Both when it asks how the candidate's background fits this role.
   - Neither (an empty list) when it can be answered on its own merits: an opinion, values, a work style or preference, a hypothetical or "how would you approach…" question that doesn't depend on the role. Answer these thoughtfully as a professional with this candidate's background would, without forcing resume details or the job description in.
3. "answer": write it, drawing only on the sources you chose.

Rules for answers:
- Never invent facts about the candidate. Employers, titles, dates, degrees, certifications, numbers, tools, projects and achievements must come from the resume. Opinions, approaches and motivations may be phrased freely, as long as they don't claim experience the resume doesn't show.
- When you use the resume, prefer the concrete example that best matches the question (and the job, when the job matters).
- Be concise and clear: usually 2-4 sentences (40-90 words) for a multi-line box, one sentence (under 25 words) for a one-line field. A cover letter or "why this company/role" question may take up to 150 words. Always stay within the character limit given for a question.
- Answer the question directly in the first sentence.
- Plain text only: no markdown, no bullet characters, no headings, no greetings or sign-offs, no placeholders like [Company].

Set "skipped": true, leave "answer" empty and say why in "reason" when a question:
- asks for personal or contact details (name, email, phone, address, location, links, pronouns),
- is a yes/no or pick-one question, or a standard screening item (work authorization, visa sponsorship, salary expectations, start date, notice period, relocation, how you heard about us, referrals, demographic or EEO questions, consent or acknowledgements),
- asks for a specific fact about the candidate that the resume doesn't contain (a portfolio link, a reference's name, an exact figure the resume doesn't support). Do not skip opinion, values or approach questions just because the resume doesn't mention them.
Otherwise "skipped" is false and "reason" is an empty string.

Return one entry for every question id you are given, in the same order.`;

const SCHEMA = {
  name: "application_answers",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["answers"],
    properties: {
      answers: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          // Order matters: the model analyses the question and picks its sources before answering.
          required: ["id", "analysis", "sources", "answer", "skipped", "reason"],
          properties: {
            id: { type: "string" },
            analysis: { type: "string" },
            sources: { type: "array", items: { type: "string", enum: ["resume", "job_description"] } },
            answer: { type: "string" },
            skipped: { type: "boolean" },
            reason: { type: "string" },
          },
        },
      },
    },
  },
};

function userPrompt(resume: string, job: AutofillJob, questions: AutofillQuestion[]) {
  const list = questions
    .map((q) =>
      [
        `id: ${q.id}`,
        `question: ${q.label}`,
        q.hint && `helper text: ${q.hint}`,
        `field: ${q.size === "long" ? "multi-line text box" : "one-line text field"}`,
        q.maxLength && `character limit: ${q.maxLength}`,
      ]
        .filter(Boolean)
        .join("\n"),
    )
    .join("\n\n");
  return `JOB
Title: ${job.title || "(unknown)"}
Company: ${job.company || "(unknown)"}
Description:
${job.description || "(not available: rely on the title and company)"}

CANDIDATE RESUME
${resume}

QUESTIONS
${list}`;
}

/** Trims an answer to `max` characters at a sentence (or word) boundary. */
function fit(answer: string, max?: number) {
  const text = answer.replace(/\s+\n/g, "\n").trim();
  if (!max || text.length <= max) return text;
  const cut = text.slice(0, max);
  const sentence = cut.lastIndexOf(". ");
  if (sentence > max * 0.5) return cut.slice(0, sentence + 1);
  const word = cut.lastIndexOf(" ");
  return (word > 0 ? cut.slice(0, word) : cut).replace(/[,;:]$/, "");
}

/** Asks OpenAI for answers to the questions, grounded in the resume and the job description. */
export async function generateAnswers(resume: string, job: AutofillJob, questions: AutofillQuestion[]): Promise<{ answers: AutofillAnswer[]; model: string }> {
  const key = openaiKey();
  if (!key) throw new AutofillNotConfiguredError("Autofill isn't set up: add OPENAI_API_KEY to the platform's environment and redeploy.");
  const model = await openaiModel();

  let res: Response;
  try {
    const base = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: userPrompt(resume, job, questions) },
        ],
        response_format: { type: "json_schema", json_schema: SCHEMA },
      }),
      signal: AbortSignal.timeout(90_000),
    });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new UserFacingError(timedOut ? "OpenAI took too long to answer. Try again." : "The platform couldn't reach OpenAI. Try again.");
  }

  const body = (await res.json().catch(() => ({}))) as {
    error?: { message?: string; code?: string };
    choices?: { message?: { content?: string; refusal?: string } }[];
  };
  if (!res.ok) {
    const detail = body.error?.message ?? `HTTP ${res.status}`;
    if (res.status === 401) throw new AutofillNotConfiguredError("OpenAI rejected the API key (OPENAI_API_KEY). Check it on the platform.");
    if (res.status === 429)
      throw new UserFacingError(
        body.error?.code === "insufficient_quota" ? "The OpenAI account is out of credit." : "OpenAI is rate-limiting requests. Wait a moment and try again.",
      );
    if (res.status === 404 || body.error?.code === "model_not_found")
      throw new AutofillNotConfiguredError(`The OpenAI model "${model}" isn't available to this API key. Choose another under Settings.`);
    throw new UserFacingError(`OpenAI couldn't generate answers: ${detail}`);
  }

  const message = body.choices?.[0]?.message;
  if (message?.refusal) throw new UserFacingError(`OpenAI declined to answer: ${message.refusal}`);
  let parsed: { answers?: (Omit<AutofillAnswer, "sources"> & { sources?: string[] })[] };
  try {
    parsed = JSON.parse(message?.content ?? "");
  } catch {
    throw new UserFacingError("OpenAI returned an unreadable reply. Try again.");
  }

  const byId = new Map((parsed.answers ?? []).map((a) => [a.id, a]));
  const answers = questions.map((q) => {
    const a = byId.get(q.id);
    const answer = a && !a.skipped ? fit(a.answer, q.maxLength) : "";
    const sources = (a?.sources ?? []).filter((x): x is AnswerSource => x === "resume" || x === "job_description");
    return {
      id: q.id,
      answer,
      skipped: !answer,
      reason: answer ? "" : a?.reason || "No answer was generated.",
      sources: answer ? [...new Set(sources)] : [],
    };
  });
  return { answers, model };
}
