import "server-only";
import { db } from "./db";

export type SettingKey = "sheetId" | "driveFolderId";

const ENV_FALLBACK: Record<SettingKey, string | undefined> = {
  sheetId: process.env.GOOGLE_SHEET_ID,
  driveFolderId: process.env.GOOGLE_DRIVE_FOLDER_ID,
};

// Settings change rarely but are read on most requests (which sheet, which Drive folder), so all
// of them are loaded in one query and kept for a minute. Saving a setting refreshes this process.
const SETTINGS_TTL_MS = 60_000;
let settingsCache: { at: number; values: Promise<Map<string, string>> } | null = null;

function loadSettings() {
  if (!settingsCache || Date.now() - settingsCache.at > SETTINGS_TTL_MS) {
    const values = db.setting.findMany().then((rows) => new Map(rows.map((r) => [r.key, r.value])));
    settingsCache = { at: Date.now(), values };
    values.catch(() => (settingsCache = null));
  }
  return settingsCache.values;
}

export async function getSetting(key: SettingKey) {
  const value = (await loadSettings()).get(key);
  return (value || ENV_FALLBACK[key] || "").trim();
}

export async function setSetting(key: SettingKey, value: string) {
  await db.setting.upsert({ where: { key }, create: { key, value }, update: { value } });
  settingsCache = null;
}

/** Accepts either a raw ID or a full Google Sheets / Drive URL and returns the ID. */
export function extractGoogleId(input: string) {
  const value = input.trim();
  const match =
    value.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/) ??
    value.match(/\/folders\/([a-zA-Z0-9_-]+)/) ??
    value.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return match ? match[1] : value;
}
