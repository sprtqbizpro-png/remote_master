import "server-only";
import { readFile } from "fs/promises";
import path from "path";
import { driveApi, getGoogleAuth, googleErrorMessage } from "./google";
import { getSetting } from "./settings";

/** Where resumes were kept before Drive became required; only read, for old records. */
const LEGACY_UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");
export const MAX_RESUME_BYTES = 10 * 1024 * 1024;
export const RESUME_EXTENSIONS = [".pdf", ".doc", ".docx", ".txt", ".rtf", ".odt"];

export type StoredResume = { store: "drive"; fileId: string; url: string; name: string };

/** A resume can't be stored (Drive not set up or Drive refused); the message is shown to the user. */
export class ResumeStorageError extends Error {}

const folderCache = new Map<string, string>();

async function applierFolder(rootId: string, name: string) {
  const drive = driveApi()!;
  const cacheKey = `${rootId}/${name}`;
  const hit = folderCache.get(cacheKey);
  if (hit) return hit;
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const found = await drive.files.list({
    q: `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and '${rootId}' in parents and trashed=false`,
    fields: "files(id)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  let id = found.data.files?.[0]?.id;
  if (!id) {
    const created = await drive.files.create({
      requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [rootId] },
      fields: "id",
      supportsAllDrives: true,
    });
    id = created.data.id!;
  }
  folderCache.set(cacheKey, id);
  return id;
}

export function safeFileName(name: string) {
  return (
    name
      .replace(/[<>:"/\\|?*\x00-\x1f]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "resume"
  );
}

export function validateResume(file: File) {
  if (file.size === 0) return "The resume file is empty.";
  if (file.size > MAX_RESUME_BYTES) return "The resume must be 10 MB or smaller.";
  const ext = path.extname(file.name).toLowerCase();
  if (!RESUME_EXTENSIONS.includes(ext)) return `Unsupported resume type. Use ${RESUME_EXTENSIONS.join(", ")}.`;
  return null;
}

/**
 * Uploads a resume to Google Drive (in a sub-folder per applier) and returns its link. The file
 * itself is never kept on the platform: only the link and Drive file id are stored. Fails with a
 * ResumeStorageError when Drive isn't set up or the upload is refused.
 */
export async function storeResume(file: File, opts: { applierName: string; displayName: string }): Promise<StoredResume> {
  const drive = driveApi();
  const rootId = await getSetting("driveFolderId");
  if (!drive) throw new ResumeStorageError("Resumes can't be uploaded: Google Drive isn't connected on the platform. Ask the owner to set up Google.");
  if (!rootId) throw new ResumeStorageError("Resumes can't be uploaded: no Google Drive folder is selected. Ask the owner to set it in Admin > Settings.");

  const ext = path.extname(file.name).toLowerCase() || ".pdf";
  const name = safeFileName(`${opts.displayName}${ext}`);
  const mimeType = file.type || "application/octet-stream";
  // Held in memory (resumes are at most 10 MB) so interrupted pieces can be re-sent; never written to disk.
  const bytes = Buffer.from(await file.arrayBuffer());
  try {
    const parent = await withRetry(() => applierFolder(rootId, safeFileName(opts.applierName)));
    const created = await resumableUpload({ name, parent, mimeType, bytes });
    const fileId = created.id!;
    if (process.env.GOOGLE_DRIVE_SHARE_PUBLIC === "true") {
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
        supportsAllDrives: true,
      });
    }
    return {
      store: "drive",
      fileId,
      url: created.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`,
      name,
    };
  } catch (error) {
    // A cached sub-folder may have been deleted in Drive: forget it so the next upload recreates it.
    folderCache.clear();
    throw new ResumeStorageError(
      `The resume couldn't be uploaded to Google Drive (${describe(error)}). Check your connection and try again.`,
    );
  }
}

/** Network failures worth another try: dropped connections, timeouts, rate limits, Google 5xx. */
function isTransient(error: unknown) {
  const e = error as { code?: string | number; status?: number; response?: { status?: number }; message?: string; cause?: { code?: string; message?: string } };
  const status = e?.response?.status ?? e?.status ?? (typeof e?.code === "number" ? e.code : undefined);
  if (e?.cause && isTransient(e.cause)) return true; // fetch() wraps socket errors in "fetch failed"
  if (/^fetch failed$/i.test(e?.message ?? "")) return true;
  if (status === 429 || (typeof status === "number" && status >= 500)) return true;
  const code = typeof e?.code === "string" ? e.code : "";
  return (
    ["ECONNRESET", "ETIMEDOUT", "EPIPE", "ECONNABORTED", "EAI_AGAIN", "ENETUNREACH", "UND_ERR_SOCKET"].includes(code) ||
    /ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|network|other side closed/i.test(e?.message ?? "")
  );
}

/** Runs a Drive call, retrying transient network failures (up to 3 attempts in total). */
async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= 3 || !isTransient(error)) throw error;
      console.warn(`Drive request failed (${googleErrorMessage(error)}); retrying (attempt ${attempt + 1} of 3)`);
      await new Promise((r) => setTimeout(r, attempt * 700));
    }
  }
}

const CHUNK = 256 * 1024; // Drive requires chunks in multiples of 256 KiB (except the last)
const MAX_STALLED_RETRIES = 6; // interruptions in a row without any progress before giving up
const UPLOAD_DEADLINE_MS = 3 * 60_000; // overall limit for one resume upload

async function accessToken() {
  const auth = getGoogleAuth();
  if (!auth) throw new ResumeStorageError("Google Drive isn't connected on the platform.");
  const token = await auth.getAccessToken();
  const value = typeof token === "string" ? token : token?.token;
  if (!value) throw new ResumeStorageError("Couldn't get a Google access token.");
  return value;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Drive's error message from a failed response. */
async function driveError(res: Response) {
  const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
  return new HttpError(res.status, body?.error?.message || `Google Drive returned HTTP ${res.status}`);
}

/** "fetch failed" hides the socket error; show it (e.g. "ECONNRESET") in logs and messages. */
function describe(error: unknown) {
  const e = error as { message?: string; cause?: { code?: string; message?: string } };
  const cause = e?.cause?.code || e?.cause?.message;
  return cause ? `${e?.message ?? "error"}: ${cause}` : googleErrorMessage(error);
}

/** Next byte Drive still needs, from a 308 response's Range header ("bytes=0-262143"). */
const nextOffset = (res: Response) => {
  const m = /bytes=0-(\d+)/.exec(res.headers.get("range") ?? "");
  return m ? Number(m[1]) + 1 : 0;
};

/**
 * Uploads a file with Drive's resumable protocol, in 256 KiB pieces. When a connection drops,
 * the upload asks Drive how much it received and continues from there instead of starting over,
 * so resumes get through unreliable networks. A session completes exactly once, so retries can't
 * create duplicate files.
 */
async function resumableUpload(opts: { name: string; parent: string; mimeType: string; bytes: Buffer }) {
  const { bytes } = opts;
  const total = bytes.length;
  let offset = 0;
  const deadline = Date.now() + UPLOAD_DEADLINE_MS;
  let stalled = 0; // interruptions since the last progress
  let progressAt = -1; // offset when we last retried
  const retry = async (error: unknown) => {
    // Progress since the last interruption resets the count: a slow, flaky line still gets through.
    if (offset > progressAt) stalled = 0;
    progressAt = offset;
    if (++stalled > MAX_STALLED_RETRIES || Date.now() > deadline || !isTransient(error)) throw error;
    console.warn(
      `Drive upload interrupted at ${offset}/${total} bytes (${describe(error)}); resuming (${stalled} of ${MAX_STALLED_RETRIES})`,
    );
    await new Promise((r) => setTimeout(r, Math.min(4000, 400 * 2 ** (stalled - 1))));
  };

  // 1. Start a session (metadata only).
  let session = "";
  while (!session) {
    try {
      const res = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,webViewLink",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${await accessToken()}`,
            "content-type": "application/json; charset=UTF-8",
            "x-upload-content-type": opts.mimeType,
            "x-upload-content-length": String(total),
          },
          body: JSON.stringify({ name: opts.name, parents: [opts.parent] }),
        },
      );
      if (!res.ok) throw await driveError(res);
      session = res.headers.get("location") ?? "";
      if (!session) throw new Error("Google Drive didn't return an upload session.");
    } catch (error) {
      await retry(error);
    }
  }

  // 2. Send the bytes in pieces; after any interruption, ask Drive where to continue.
  let mustQuery = false;
  for (;;) {
    try {
      let res: Response;
      if (mustQuery) {
        res = await fetch(session, { method: "PUT", headers: { "content-range": `bytes */${total}`, "content-length": "0" } });
      } else {
        const end = Math.min(offset + CHUNK, total);
        res = await fetch(session, {
          method: "PUT",
          headers: { "content-range": total ? `bytes ${offset}-${end - 1}/${total}` : `bytes */0` },
          body: new Uint8Array(bytes.subarray(offset, end)),
        });
      }
      mustQuery = false;
      if (res.status === 200 || res.status === 201) {
        const file = (await res.json()) as { id?: string; webViewLink?: string };
        if (!file.id) throw new Error("Google Drive didn't return the uploaded file.");
        return file;
      }
      if (res.status === 308) {
        offset = nextOffset(res);
        continue;
      }
      if (res.status === 404 || res.status === 410) throw new HttpError(res.status, "The upload session expired; please try again.");
      throw await driveError(res);
    } catch (error) {
      await retry(error);
      mustQuery = true;
    }
  }
}

/** Removes a resume from Drive, e.g. when saving its application failed after the upload. */
export async function deleteStoredResume(stored: StoredResume) {
  await driveApi()
    ?.files.delete({ fileId: stored.fileId, supportsAllDrives: true })
    .catch((error) => console.warn("Couldn't remove orphaned resume from Drive:", googleErrorMessage(error)));
}

/** Serves resumes of old records saved on the platform before Drive was required. */
export async function readLocalResume(fileId: string) {
  if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/.test(fileId)) return null;
  try {
    return await readFile(path.join(LEGACY_UPLOAD_DIR, fileId));
  } catch {
    return null;
  }
}

export async function testDriveFolder() {
  const drive = driveApi();
  const rootId = await getSetting("driveFolderId");
  if (!drive) throw new Error("Google credentials are not configured on the server.");
  if (!rootId) throw new Error("No Drive folder is selected.");
  const res = await drive.files.get({ fileId: rootId, fields: "id,name,mimeType", supportsAllDrives: true });
  if (res.data.mimeType !== "application/vnd.google-apps.folder") throw new Error("The Drive ID is not a folder.");
  return { name: res.data.name ?? "" };
}
