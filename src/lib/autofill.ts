import "server-only";
import { createHash } from "crypto";
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
  /** "long" for a multi-line box, "short" for a one-line input, "choice" for a drop-down list. */
  size: "long" | "short" | "choice";
  /** A drop-down's options, as the form shows them. The answer must be one of these. */
  options?: string[];
};

export type AutofillJob = { title: string; company: string; description: string };
/** What an answer was built from: the resume, the job description, or neither (a general answer). */
export type AnswerSource = "resume" | "job_description";
export type AutofillAnswer = { id: string; answer: string; skipped: boolean; reason: string; sources: AnswerSource[] };

/** Work history and education read from the resume, for forms that ask for them entry by entry. */
export type ResumeProfile = {
  experience: {
    company: string;
    title: string;
    location: string;
    /** 1-12, or 0 when the resume gives only a year (or nothing). */
    startMonth: number;
    /** 0 when unknown. */
    startYear: number;
    endMonth: number;
    endYear: number;
    /** Still in this job (the resume says "Present" / "Current"). */
    current: boolean;
    description: string;
  }[];
  education: {
    school: string;
    /** The degree as the resume writes it ("B.S.", "MBA"). */
    degree: string;
    /** The kind of degree, for picking it from a form's list. */
    degreeLevel: "high_school" | "associate" | "bachelor" | "master" | "mba" | "doctorate" | "certificate" | "other" | "";
    field: string;
    startYear: number;
    endYear: number;
    gpa: string;
  }[];
};

export class AutofillNotConfiguredError extends Error {}

export function openaiKey() {
  return (process.env.OPENAI_API_KEY ?? "").trim();
}

export async function openaiModel() {
  return (await getSetting("openaiModel")) || (process.env.OPENAI_MODEL ?? "").trim() || DEFAULT_OPENAI_MODEL;
}

/* ---------------- calling OpenAI ---------------- */

/** One chat completion whose reply must match `schema` (strict JSON schema). */
async function chatJson<T>(system: string, user: string, schema: { name: string; schema: object }): Promise<{ data: T; model: string }> {
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
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        response_format: { type: "json_schema", json_schema: { ...schema, strict: true } },
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
  try {
    return { data: JSON.parse(message?.content ?? "") as T, model };
  } catch {
    throw new UserFacingError("OpenAI returned an unreadable reply. Try again.");
  }
}

/* ---------------- open-ended questions ---------------- */

const SYSTEM = `You answer job application questions for a candidate, writing as the candidate in the first person.

Work through each question in this order, and fill the fields in this order:

1. "analysis": first understand the question. In one or two short sentences, say what it is really asking and what a good answer needs.
2. "sources": decide what the answer needs, and use only that:
   - "resume" when the answer depends on the candidate's own background: experience, skills, projects, achievements, education, career goals rooted in their history.
   - "job_description" when it depends on this role or company: why this company or role, what interests them about it, how they fit what the team needs, how they'd approach this job's challenges.
   - Both when it asks how the candidate's background fits this role.
   - Neither (an empty list) when it can be answered on its own merits: an opinion, values, a work style or preference, a hypothetical or "how would you approach…" question that doesn't depend on the role. Answer these thoughtfully as a professional with this candidate's background would, without forcing resume details or the job description in.
3. "answer": write it, drawing only on the sources you chose.

Drop-down questions (the field is a "drop-down list" with "options"): the answer must be exactly one of the listed options, copied character for character. Pick the option that best and most honestly fits, using the same sources (for example the experience level the resume supports). Never write your own text for a drop-down. If no option fits honestly, skip it.

Rules for written answers:
- Never invent facts about the candidate. Employers, titles, dates, degrees, certifications, numbers, tools, projects and achievements must come from the resume. Opinions, approaches and motivations may be phrased freely, as long as they don't claim experience the resume doesn't show.
- When you use the resume, prefer the concrete example that best matches the question (and the job, when the job matters).
- Be concise and clear: usually 2-4 sentences (40-90 words) for a multi-line box, one sentence (under 25 words) for a one-line field. A cover letter or "why this company/role" question may take up to 150 words. Always stay within the character limit given for a question.
- Answer the question directly in the first sentence.
- Plain text only: no markdown, no bullet characters, no headings, no greetings or sign-offs, no placeholders like [Company].

Set "skipped": true, leave "answer" empty and say why in "reason" when a question:
- asks for personal or contact details (name, email, phone, address, location, links, pronouns),
- is a yes/no question, or a standard screening item (work authorization, visa sponsorship, salary expectations, start date, notice period, relocation, how you heard about us, referrals, demographic or EEO questions, consent or acknowledgements),
- asks for a specific fact about the candidate that the resume doesn't contain (a portfolio link, a reference's name, an exact figure the resume doesn't support). Do not skip opinion, values or approach questions just because the resume doesn't mention them.
Otherwise "skipped" is false and "reason" is an empty string.

Return one entry for every question id you are given, in the same order.`;

const SCHEMA = {
  name: "application_answers",
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

const FIELD_KIND = { long: "multi-line text box", short: "one-line text field", choice: "drop-down list" };

function userPrompt(resume: string, job: AutofillJob, questions: AutofillQuestion[]) {
  const list = questions
    .map((q) =>
      [
        `id: ${q.id}`,
        `question: ${q.label}`,
        q.hint && `helper text: ${q.hint}`,
        `field: ${FIELD_KIND[q.size]}`,
        q.size === "choice" && `options:\n${(q.options ?? []).map((o) => `  - ${o}`).join("\n")}`,
        q.size !== "choice" && q.maxLength && `character limit: ${q.maxLength}`,
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

const looseText = (t: string) => t.toLowerCase().replace(/[^a-z0-9+#]+/g, " ").trim();

/** The listed option an answer names: exactly, then ignoring case and punctuation. "" when none. */
export function matchOption(answer: string, options: string[]) {
  const exact = options.find((o) => o === answer) ?? options.find((o) => o.trim() === answer.trim());
  if (exact !== undefined) return exact;
  const want = looseText(answer);
  if (!want) return "";
  return options.find((o) => looseText(o) === want) ?? "";
}

/** Asks OpenAI for answers to the questions, grounded in the resume and the job description. */
export async function generateAnswers(resume: string, job: AutofillJob, questions: AutofillQuestion[]): Promise<{ answers: AutofillAnswer[]; model: string }> {
  if (!questions.length) return { answers: [], model: await openaiModel() };
  const { data, model } = await chatJson<{ answers?: (Omit<AutofillAnswer, "sources"> & { sources?: string[] })[] }>(
    SYSTEM,
    userPrompt(resume, job, questions),
    SCHEMA,
  );

  const byId = new Map((data.answers ?? []).map((a) => [a.id, a]));
  const answers = questions.map((q) => {
    const a = byId.get(q.id);
    let answer = "";
    let reason = a?.reason || "No answer was generated.";
    if (a && !a.skipped) {
      if (q.size === "choice") {
        answer = matchOption(a.answer, q.options ?? []);
        if (!answer) reason = `The answer ("${a.answer.slice(0, 80)}") isn't one of the drop-down's options.`;
      } else answer = fit(a.answer, q.maxLength);
    }
    const sources = (a?.sources ?? []).filter((x): x is AnswerSource => x === "resume" || x === "job_description");
    return {
      id: q.id,
      answer,
      skipped: !answer,
      reason: answer ? "" : reason,
      sources: answer ? [...new Set(sources)] : [],
    };
  });
  return { answers, model };
}

/* ---------------- work history and education ---------------- */

const PROFILE_SYSTEM = `You read a resume and list the candidate's employment history and education exactly as the resume states them, for filling in an online job application.

Rules:
- Use only what the resume says. Never guess or invent employers, titles, schools, degrees, dates or locations. Leave a text field "" and a number 0 when the resume doesn't give it.
- List jobs most recent first, then education most recent first. Include internships and part-time jobs that the resume lists under experience. Do not list projects, volunteering or certifications as jobs unless the resume presents them as employment.
- Dates: months as numbers 1-12 (0 when the resume gives only a year), years as 4-digit numbers. A job still held ("Present", "Current", "Now") has "current": true and end month and year 0.
- "description": one to three sentences summarising that job's responsibilities and achievements in the resume's own terms, under 500 characters, plain text with no bullet characters.
- "location": as the resume writes it ("Austin, TX", "Remote"), or "".
- Education: "degree" as written ("B.S.", "Bachelor of Science", "MBA"); "degreeLevel" one of high_school, associate, bachelor, master, mba, doctorate, certificate, other ("" if there is no degree); "field" the major or field of study; "gpa" as written, or "".`;

const PROFILE_SCHEMA = {
  name: "resume_profile",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["experience", "education"],
    properties: {
      experience: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["company", "title", "location", "startMonth", "startYear", "endMonth", "endYear", "current", "description"],
          properties: {
            company: { type: "string" },
            title: { type: "string" },
            location: { type: "string" },
            startMonth: { type: "integer" },
            startYear: { type: "integer" },
            endMonth: { type: "integer" },
            endYear: { type: "integer" },
            current: { type: "boolean" },
            description: { type: "string" },
          },
        },
      },
      education: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["school", "degree", "degreeLevel", "field", "startYear", "endYear", "gpa"],
          properties: {
            school: { type: "string" },
            degree: { type: "string" },
            degreeLevel: { type: "string", enum: ["high_school", "associate", "bachelor", "master", "mba", "doctorate", "certificate", "other", ""] },
            field: { type: "string" },
            startYear: { type: "integer" },
            endYear: { type: "integer" },
            gpa: { type: "string" },
          },
        },
      },
    },
  },
};

const DEGREE_LEVELS = ["high_school", "associate", "bachelor", "master", "mba", "doctorate", "certificate", "other"] as const;
const month = (n: unknown) => (Number.isInteger(n) && (n as number) >= 1 && (n as number) <= 12 ? (n as number) : 0);
const year = (n: unknown) => (Number.isInteger(n) && (n as number) >= 1950 && (n as number) <= 2100 ? (n as number) : 0);
const str = (s: unknown, max: number) => (typeof s === "string" ? s.trim().slice(0, max) : "");

/** Keeps the model's reply to sane values (dates in range, bounded lengths, at most 10 entries each). */
function tidyProfile(raw: Partial<ResumeProfile>): ResumeProfile {
  return {
    experience: (raw.experience ?? [])
      .slice(0, 10)
      .map((e) => ({
        company: str(e.company, 200),
        title: str(e.title, 200),
        location: str(e.location, 200),
        startMonth: month(e.startMonth),
        startYear: year(e.startYear),
        endMonth: e.current ? 0 : month(e.endMonth),
        endYear: e.current ? 0 : year(e.endYear),
        current: Boolean(e.current),
        description: str(e.description, 1000),
      }))
      .filter((e) => e.company || e.title),
    education: (raw.education ?? [])
      .slice(0, 10)
      .map((e) => ({
        school: str(e.school, 200),
        degree: str(e.degree, 200),
        degreeLevel: DEGREE_LEVELS.find((l) => l === e.degreeLevel) ?? ("" as const),
        field: str(e.field, 200),
        startYear: year(e.startYear),
        endYear: year(e.endYear),
        gpa: str(e.gpa, 20),
      }))
      .filter((e) => e.school || e.degree),
  };
}

// A resume is used for many applications in a row: keep its profile for a day (per resume and model).
const PROFILE_TTL_MS = 24 * 60 * 60_000;
const profiles = new Map<string, { profile: ResumeProfile; expires: number }>();

/** The candidate's work history and education, read from the resume text. */
export async function extractProfile(resume: string): Promise<ResumeProfile> {
  const model = await openaiModel();
  const key = `${model}:${createHash("sha256").update(resume).digest("hex")}`;
  const hit = profiles.get(key);
  if (hit && hit.expires > Date.now()) return hit.profile;
  const { data } = await chatJson<Partial<ResumeProfile>>(PROFILE_SYSTEM, `RESUME\n${resume}`, PROFILE_SCHEMA);
  const profile = tidyProfile(data);
  if (profiles.size >= 50) profiles.delete(profiles.keys().next().value!);
  profiles.set(key, { profile, expires: Date.now() + PROFILE_TTL_MS });
  return profile;
}
