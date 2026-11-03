import "server-only";
import { createHash } from "crypto";
import { UserFacingError } from "./applications";

/** Longest resume text sent on to the model: a long resume is ~15k characters. */
const MAX_CHARS = 30_000;
const CACHE_TTL_MS = 60 * 60_000;
const CACHE_MAX = 50;

async function extract(ext: string, bytes: Buffer) {
  if (ext === ".pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  }
  if (ext === ".docx") {
    const mammoth = await import("mammoth");
    return (await mammoth.extractRawText({ buffer: bytes })).value;
  }
  if (ext === ".txt") return bytes.toString("utf8");
  throw new UserFacingError("Autofill reads PDF, DOCX or TXT resumes. Save this resume as PDF or DOCX and attach that.");
}

// The same resume is used for many jobs in a row: keep its text for an hour, keyed by its content.
const cache = new Map<string, { text: string; expires: number }>();

/** Plain text of a resume file (PDF, DOCX or TXT), tidied and capped in length. */
export async function resumeText(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = (file.name.match(/\.[^.]+$/)?.[0] ?? "").toLowerCase();
  const key = `${ext}:${createHash("sha256").update(bytes).digest("hex")}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.text;

  let raw: string;
  try {
    raw = await extract(ext, bytes);
  } catch (error) {
    if (error instanceof UserFacingError) throw error;
    throw new UserFacingError("The resume file couldn't be read. Make sure it isn't password-protected or damaged.");
  }
  const text = raw
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_CHARS);
  if (text.length < 100)
    throw new UserFacingError("No text was found in the resume (is it a scanned image?). Attach a PDF or DOCX with selectable text.");

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, { text, expires: Date.now() + CACHE_TTL_MS });
  return text;
}
