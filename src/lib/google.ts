import "server-only";
// Per-API clients instead of the full `googleapis` bundle (~200 MB): much faster server start,
// dev compiles and cold starts.
import { drive } from "@googleapis/drive";
import { sheets } from "@googleapis/sheets";
import { GoogleAuth, OAuth2Client } from "google-auth-library";

const SCOPES = ["https://www.googleapis.com/auth/spreadsheets", "https://www.googleapis.com/auth/drive"];

type Auth = OAuth2Client | GoogleAuth;

let cached: Auth | null | undefined;

function parseServiceAccount(raw: string) {
  const text = raw.trim().startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  return JSON.parse(text) as { client_email: string; private_key: string };
}

/** OAuth refresh token (preferred) or service account; null when Google is not configured. */
export function getGoogleAuth(): Auth | null {
  if (cached !== undefined) return cached;
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON } = process.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) {
    const client = new OAuth2Client(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET);
    client.setCredentials({ refresh_token: GOOGLE_REFRESH_TOKEN });
    cached = client;
  } else if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    cached = new GoogleAuth({ credentials: parseServiceAccount(GOOGLE_SERVICE_ACCOUNT_JSON), scopes: SCOPES });
  } else {
    cached = null;
  }
  return cached;
}

export function googleAuthMode(): { kind: "oauth" | "service-account" | "invalid" | "none"; detail?: string } {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN, GOOGLE_SERVICE_ACCOUNT_JSON } = process.env;
  if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REFRESH_TOKEN) return { kind: "oauth" };
  if (GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      return { kind: "service-account", detail: parseServiceAccount(GOOGLE_SERVICE_ACCOUNT_JSON).client_email };
    } catch {
      return { kind: "invalid", detail: "GOOGLE_SERVICE_ACCOUNT_JSON could not be parsed" };
    }
  }
  return { kind: "none" };
}

let sheetsClient: ReturnType<typeof sheets> | null | undefined;
let driveClient: ReturnType<typeof drive> | null | undefined;

export function sheetsApi() {
  if (sheetsClient === undefined) {
    const auth = getGoogleAuth();
    sheetsClient = auth ? sheets({ version: "v4", auth }) : null;
  }
  return sheetsClient;
}

export function driveApi() {
  if (driveClient === undefined) {
    const auth = getGoogleAuth();
    driveClient = auth ? drive({ version: "v3", auth }) : null;
  }
  return driveClient;
}

export function googleErrorMessage(error: unknown) {
  const e = error as { response?: { data?: { error?: { message?: string } | string } }; message?: string };
  const data = e?.response?.data?.error;
  return (typeof data === "string" ? data : data?.message) || e?.message || String(error);
}

/** Who a user must share their Google Sheet with so the platform can write to it. */
export function googleShareHint() {
  const mode = googleAuthMode();
  if (mode.kind === "service-account") return `Share the sheet (Editor) with ${mode.detail}.`;
  if (mode.kind === "oauth") return "Share the sheet (Editor) with the Google account connected to the platform.";
  return "Google is not configured on the platform yet.";
}

/**
 * Fetches the Google access token ahead of time and refreshes it before it expires. Getting a
 * token can take several seconds; without this the first Sheets/Drive call after a restart (and
 * one call every hour) would pay that cost inside a user's request.
 */
export function keepGoogleTokenWarm() {
  const auth = getGoogleAuth();
  if (!auth) return;
  const refresh = () =>
    auth.getAccessToken().catch((error: unknown) => console.warn("Google token refresh failed:", googleErrorMessage(error)));
  void refresh();
  setInterval(refresh, 45 * 60_000).unref();
}
