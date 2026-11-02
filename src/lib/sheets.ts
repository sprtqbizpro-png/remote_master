import "server-only";
import { db } from "./db";
import { memo } from "./memo";
import { extractGoogleId, getSetting } from "./settings";
import { googleErrorMessage, googleShareHint, sheetsApi } from "./google";
import { sheetTabName } from "./sites";

export const SHEET_HEADERS = [
  "Key",
  "Title",
  "Company",
  "Job Type",
  "Location",
  "Salary",
  "Posted At",
  "Job URL",
  "Apply URL",
  "Source Page",
  "Scraped At",
  "Status",
  "Applied By",
  "Applied At",
  "Resume",
] as const;

type Header = (typeof SHEET_HEADERS)[number];
const COL = Object.fromEntries(SHEET_HEADERS.map((h, i) => [h, i])) as Record<Header, number>;
const LAST_COL = String.fromCharCode(64 + SHEET_HEADERS.length); // "O"

export type ScrapedJob = {
  key?: string;
  title: string;
  company?: string;
  jobType?: string;
  location?: string;
  salary?: string;
  postedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
};

export type SheetJob = Required<ScrapedJob> & {
  row: number;
  sourcePage: string;
  scrapedAt: string;
  status: string;
  appliedBy: string;
  appliedAt: string;
  resume: string;
};

export class SheetNotConfiguredError extends Error {}

/** Serialises writes per tab so concurrent syncs cannot append the same job twice. */
const locks = new Map<string, Promise<unknown>>();
function withLock<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(name) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(fn);
  locks.set(name, next);
  return next.finally(() => {
    if (locks.get(name) === next) locks.delete(name);
  });
}

export function normalizeUrl(url?: string) {
  if (!url) return "";
  try {
    const u = new URL(url.trim());
    u.hash = "";
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|ref$|refid$|source$|gh_src$|lever-source)/i.test(p)) u.searchParams.delete(p);
    }
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    return u.toString().replace(/\/$/, "");
  } catch {
    return url.trim();
  }
}

export function jobKeyOf(job: ScrapedJob) {
  return (
    job.key?.trim() ||
    normalizeUrl(job.jobUrl) ||
    normalizeUrl(job.applyUrl) ||
    `${job.company ?? ""}|${job.title}`.toLowerCase()
  );
}

/**
 * The spreadsheet a user records their work in: their own sheet when one is assigned,
 * otherwise the platform's default sheet (Admin > Settings).
 */
const userSheet = memo(60_000, async (userId: string) => {
  const user = await db.user.findUnique({ where: { id: userId }, select: { sheetId: true } });
  return user?.sheetId?.trim() ?? "";
});

export async function resolveSheetId(userId: string) {
  return (await userSheet(userId)) || (await getSetting("sheetId"));
}

export function sheetUrlFor(spreadsheetId: string) {
  return spreadsheetId ? `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit` : "";
}

function context(spreadsheetId: string) {
  const sheets = sheetsApi();
  if (!sheets) throw new SheetNotConfiguredError("Google credentials are not configured on the server.");
  if (!spreadsheetId) {
    throw new SheetNotConfiguredError("No Google Sheet is assigned. Set your sheet in the extension's Account tab or ask the owner.");
  }
  return { sheets, spreadsheetId };
}

// The tab list is needed by almost every sheet operation but only changes when a tab is added,
// so it is cached instead of costing an extra Google API round trip each time.
const tabsCache = memo(5 * 60_000, async (spreadsheetId: string) => {
  const { sheets } = context(spreadsheetId);
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "properties.title,sheets.properties(sheetId,title)",
  });
  return {
    title: meta.data.properties?.title ?? "",
    tabs: (meta.data.sheets ?? []).map((s) => ({ id: s.properties?.sheetId ?? 0, title: s.properties?.title ?? "" })),
  };
});

async function listTabs(spreadsheetId: string) {
  context(spreadsheetId);
  return tabsCache(spreadsheetId);
}

function range(tab: string, a1: string) {
  return `'${tab.replace(/'/g, "''")}'!${a1}`;
}

function isHeaderRow(row?: string[]) {
  return (row?.[0] ?? "").trim() === SHEET_HEADERS[0] && (row?.[1] ?? "").trim() === SHEET_HEADERS[1];
}

function headerFormat(sheetId: number) {
  return {
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
      cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.93, green: 0.95, blue: 0.98 } } },
      fields: "userEnteredFormat(textFormat,backgroundColor)",
    },
  };
}

/** Tabs whose header row has been checked in this process. */
const headerChecked = new Set<string>();

/**
 * Makes sure the site's tab exists and starts with the header row. A tab created by hand (or
 * before the platform first wrote to it) may have a job in row 1; a header row is inserted
 * above it so every row is read as a job.
 */
async function ensureTab(spreadsheetId: string, tab: string) {
  const { sheets } = context(spreadsheetId);
  const cacheKey = `${spreadsheetId}/${tab}`;
  const existing = (await listTabs(spreadsheetId)).tabs.find((t) => t.title === tab);
  if (!existing) {
    const res = await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tab, gridProperties: { frozenRowCount: 1 } } } }] },
    });
    tabsCache.invalidate(spreadsheetId);
    const sheetId = res.data.replies?.[0]?.addSheet?.properties?.sheetId ?? 0;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range(tab, `A1:${LAST_COL}1`),
      valueInputOption: "RAW",
      requestBody: { values: [[...SHEET_HEADERS]] },
    });
    await sheets.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests: [headerFormat(sheetId)] } });
    headerChecked.add(cacheKey);
    return;
  }
  if (headerChecked.has(cacheKey)) return;
  const first = await sheets.spreadsheets.values.get({ spreadsheetId, range: range(tab, `A1:${LAST_COL}1`) });
  const row1 = (first.data.values?.[0] ?? []) as string[];
  if (!isHeaderRow(row1)) {
    const hasData = row1.some((v) => String(v ?? "").trim());
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          ...(hasData
            ? [{ insertDimension: { range: { sheetId: existing.id, dimension: "ROWS", startIndex: 0, endIndex: 1 }, inheritFromBefore: false } }]
            : []),
          { updateSheetProperties: { properties: { sheetId: existing.id, gridProperties: { frozenRowCount: 1 } }, fields: "gridProperties.frozenRowCount" } },
          headerFormat(existing.id),
        ],
      },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range(tab, `A1:${LAST_COL}1`),
      valueInputOption: "RAW",
      requestBody: { values: [[...SHEET_HEADERS]] },
    });
  }
  headerChecked.add(cacheKey);
}

function rowToJob(row: string[], rowNumber: number): SheetJob {
  const v = (h: Header) => (row[COL[h]] ?? "").toString();
  return {
    row: rowNumber,
    key: v("Key"),
    title: v("Title"),
    company: v("Company"),
    jobType: v("Job Type"),
    location: v("Location"),
    salary: v("Salary"),
    postedAt: v("Posted At"),
    jobUrl: v("Job URL"),
    applyUrl: v("Apply URL"),
    sourcePage: v("Source Page"),
    scrapedAt: v("Scraped At"),
    status: v("Status"),
    appliedBy: v("Applied By"),
    appliedAt: v("Applied At"),
    resume: v("Resume"),
  };
}

/** Rows of a tab read from A1. The header row is skipped when present; row numbers are exact. */
function parseRows(values: string[][]) {
  const start = isHeaderRow(values[0]) ? 1 : 0;
  return values
    .slice(start)
    .map((r, i) => rowToJob(r, start + i + 1))
    .filter((r) => r.key || r.title || r.jobUrl || r.applyUrl);
}

async function readTab(spreadsheetId: string, tab: string) {
  const { sheets } = context(spreadsheetId);
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: range(tab, `A1:${LAST_COL}`) });
  return parseRows((res.data.values ?? []) as string[][]);
}

/** Every tab's rows in one API call; `preferredTab` first. */
async function readAllTabs(spreadsheetId: string, preferredTab?: string) {
  const { sheets } = context(spreadsheetId);
  const { tabs } = await listTabs(spreadsheetId);
  const ordered = [...tabs.filter((t) => t.title === preferredTab), ...tabs.filter((t) => t.title !== preferredTab)];
  if (!ordered.length) return [];
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId,
    ranges: ordered.map((t) => range(t.title, `A1:${LAST_COL}`)),
  });
  const valueRanges = res.data.valueRanges ?? [];
  return ordered.map((t, i) => ({ id: t.id, title: t.title, rows: parseRows((valueRanges[i]?.values ?? []) as string[][]) }));
}

function jobRow(
  job: ScrapedJob,
  extra: { sourcePage?: string; status?: string; appliedBy?: string; appliedAt?: string; resume?: string },
) {
  const row = new Array<string>(SHEET_HEADERS.length).fill("");
  row[COL.Key] = jobKeyOf(job);
  row[COL.Title] = job.title ?? "";
  row[COL.Company] = job.company ?? "";
  row[COL["Job Type"]] = job.jobType ?? "";
  row[COL.Location] = job.location ?? "";
  row[COL.Salary] = job.salary ?? "";
  row[COL["Posted At"]] = job.postedAt ?? "";
  row[COL["Job URL"]] = job.jobUrl ?? "";
  row[COL["Apply URL"]] = job.applyUrl ?? "";
  row[COL["Source Page"]] = extra.sourcePage ?? "";
  row[COL["Scraped At"]] = new Date().toISOString();
  row[COL.Status] = extra.status ?? "New";
  row[COL["Applied By"]] = extra.appliedBy ?? "";
  row[COL["Applied At"]] = extra.appliedAt ?? "";
  row[COL.Resume] = extra.resume ?? "";
  return row;
}

function identities(job: ScrapedJob) {
  return [jobKeyOf(job), normalizeUrl(job.jobUrl), normalizeUrl(job.applyUrl)].filter(Boolean);
}

/** True for a real page URL (not a bare domain), so loose matching can't equate two sites. */
function hasPath(url: string) {
  try {
    return new URL(url).pathname.length > 1;
  } catch {
    return false;
  }
}

/** Same job page with or without a trailing "/apply" step (Lever, Ashby, Workable, ...). */
function looseUrl(url: string) {
  return normalizeUrl(url).replace(/\/(apply|application|apply-now|applications?\/new)$/i, "");
}

const normTitle = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export type RowLookup = { key?: string; urls: string[]; title?: string; company?: string };

/**
 * Finds a job's row, most reliable evidence first: its key, then an exact URL (job or apply
 * link), then the same URL without a trailing "/apply" step, and finally company + title when
 * exactly one row in the whole sheet has them.
 */
function findRow(tabs: { title: string; rows: SheetJob[] }[], lookup: RowLookup) {
  const all = tabs.flatMap((t) => t.rows.map((job) => ({ tab: t.title, job })));
  const key = lookup.key?.trim();
  if (key) {
    const hit = all.find(({ job }) => job.key === key);
    if (hit) return hit;
  }
  const strict = new Set(lookup.urls.map(normalizeUrl).filter(Boolean));
  if (strict.size) {
    const hit = all.find(({ job }) => [job.key, normalizeUrl(job.jobUrl), normalizeUrl(job.applyUrl)].some((u) => u && strict.has(u)));
    if (hit) return hit;
    const loose = new Set(lookup.urls.map(looseUrl).filter(hasPath));
    const looseHit = all.find(({ job }) => [job.jobUrl, job.applyUrl].some((u) => u && loose.has(looseUrl(u))));
    if (looseHit) return looseHit;
  }
  const company = normalizeCompany(lookup.company);
  const title = normTitle(lookup.title ?? "");
  if (company && title) {
    const same = all.filter(({ job }) => normalizeCompany(job.company) === company && normTitle(job.title) === title);
    if (same.length === 1) return same[0];
  }
  return null;
}

/** Appends the jobs that are not already present in the site's tab. */
export async function syncScrapedJobs(spreadsheetId: string, site: string, jobs: ScrapedJob[], sourcePage: string) {
  const tab = sheetTabName(site);
  const { sheets } = context(spreadsheetId);
  return withLock(`${spreadsheetId}/${tab}`, async () => {
    await ensureTab(spreadsheetId, tab);
    const existing = await readTab(spreadsheetId, tab);
    const seen = new Set<string>();
    for (const r of existing) {
      for (const v of [r.key, normalizeUrl(r.jobUrl), normalizeUrl(r.applyUrl)]) if (v) seen.add(v);
    }
    const fresh: string[][] = [];
    for (const job of jobs) {
      if (!job.title?.trim()) continue;
      const ids = identities(job);
      if (ids.some((id) => seen.has(id))) continue;
      ids.forEach((id) => seen.add(id));
      fresh.push(jobRow(job, { sourcePage }));
    }
    if (fresh.length) {
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: range(tab, `A:${LAST_COL}`),
        valueInputOption: "RAW",
        insertDataOption: "INSERT_ROWS",
        requestBody: { values: fresh },
      });
    }
    return { tab, added: fresh.length, skipped: jobs.length - fresh.length, total: existing.length + fresh.length };
  });
}

/** Lists jobs from a site's tab, optionally only the ones nobody has applied to yet. */
export async function listSheetJobs(spreadsheetId: string, site: string, onlyOpen: boolean) {
  const tab = sheetTabName(site);
  const { tabs } = await listTabs(spreadsheetId);
  if (!tabs.some((t) => t.title === tab)) return { tab, jobs: [] as SheetJob[] };
  const jobs = await readTab(spreadsheetId, tab);
  return { tab, jobs: onlyOpen ? jobs.filter((j) => !isAppliedRow(j)) : jobs };
}

/** Column values to write into an existing row (only the given ones change). */
export type RowValues = Partial<Record<Header, string>>;

async function writeRow(spreadsheetId: string, tab: string, lookup: RowLookup, values: RowValues) {
  const { sheets } = context(spreadsheetId);
  // Re-read the tab under its lock so the row number is still right when we write.
  return withLock(`${spreadsheetId}/${tab}`, async () => {
    const hit = findRow([{ title: tab, rows: await readTab(spreadsheetId, tab) }], lookup);
    if (!hit) return null;
    const row = SHEET_HEADERS.map((h) => {
      const current = hit.job[headerField(h)];
      return values[h] !== undefined ? values[h]! : current;
    });
    if (!row[COL.Key]) row[COL.Key] = lookup.key || jobKeyOf({ title: hit.job.title, jobUrl: hit.job.jobUrl, applyUrl: hit.job.applyUrl });
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: range(tab, `A${hit.job.row}:${LAST_COL}${hit.job.row}`),
      valueInputOption: "RAW",
      requestBody: { values: [row] },
    });
    return { tab, key: row[COL.Key], row: hit.job.row };
  });
}

const FIELD_OF: Record<Header, keyof SheetJob> = {
  Key: "key",
  Title: "title",
  Company: "company",
  "Job Type": "jobType",
  Location: "location",
  Salary: "salary",
  "Posted At": "postedAt",
  "Job URL": "jobUrl",
  "Apply URL": "applyUrl",
  "Source Page": "sourcePage",
  "Scraped At": "scrapedAt",
  Status: "status",
  "Applied By": "appliedBy",
  "Applied At": "appliedAt",
  Resume: "resume",
};
const headerField = (h: Header) => FIELD_OF[h] as Exclude<keyof SheetJob, "row">;

/**
 * Records an application in the sheet. The job's existing row (anywhere in the sheet) is updated
 * in place; a new row is added only when the job is not in the sheet at all.
 */
export async function markJobApplied(
  spreadsheetId: string,
  job: ScrapedJob & { site: string; preferredTab?: string; urls?: string[] },
  info: { status: string; appliedBy: string; appliedAt: Date; resume: string },
) {
  const { sheets } = context(spreadsheetId);
  const lookup: RowLookup = {
    key: job.key,
    urls: [job.jobUrl, job.applyUrl, ...(job.urls ?? [])].filter((u): u is string => Boolean(u)),
    title: job.title,
    company: job.company,
  };
  const values: RowValues = {
    Status: info.status,
    "Applied By": info.appliedBy,
    "Applied At": info.appliedAt.toISOString(),
    Resume: info.resume,
  };
  const found = findRow(await readAllTabs(spreadsheetId, job.preferredTab), lookup);
  if (found) {
    const written = await writeRow(spreadsheetId, found.tab, lookup, values);
    if (written) return { ...written, appended: false };
  }

  const tab = sheetTabName(job.site);
  return withLock(`${spreadsheetId}/${tab}`, async () => {
    await ensureTab(spreadsheetId, tab);
    // Another save may have added it meanwhile: update that row instead of adding a second one.
    const rows = await readTab(spreadsheetId, tab);
    const again = findRow([{ title: tab, rows }], lookup);
    const fields = jobRow(job, { status: info.status, appliedBy: info.appliedBy, appliedAt: values["Applied At"], resume: info.resume });
    if (again) {
      const row = SHEET_HEADERS.map((h, i) => (values[h] !== undefined ? values[h]! : again.job[headerField(h)] || fields[i]));
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: range(tab, `A${again.job.row}:${LAST_COL}${again.job.row}`),
        valueInputOption: "RAW",
        requestBody: { values: [row] },
      });
      return { tab, key: row[COL.Key], row: again.job.row, appended: false };
    }
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: range(tab, `A:${LAST_COL}`),
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [fields] },
    });
    return { tab, key: fields[COL.Key], row: 0, appended: true };
  });
}

/**
 * Updates an application's existing row (status, edited details, resume). Never adds a row:
 * returns null when the job isn't in the sheet.
 */
export async function updateJobRow(
  spreadsheetId: string,
  lookup: RowLookup & { preferredTab?: string },
  values: RowValues,
) {
  if (!spreadsheetId) return null;
  const found = findRow(await readAllTabs(spreadsheetId, lookup.preferredTab), lookup);
  if (!found) return null;
  return writeRow(spreadsheetId, found.tab, lookup, values);
}

export async function testSheetConnection(spreadsheetId: string) {
  const { title, tabs } = await listTabs(spreadsheetId);
  return { title, tabs: tabs.map((t) => t.title) };
}

/**
 * Finds a job's row in any tab of the sheet, by its key, URLs or (uniquely) company + title.
 * `preferredTab` is searched first.
 */
export async function findSheetJob(spreadsheetId: string, lookup: RowLookup & { preferredTab?: string }) {
  return findRow(await readAllTabs(spreadsheetId, lookup.preferredTab), lookup);
}

const COMPANY_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corp", "corporation", "co", "company",
  "plc", "gmbh", "ag", "sa", "sas", "srl", "bv", "nv", "pty", "pte", "oy", "ab", "as", "kk", "group", "holdings",
]);

/** "Acme, Inc." / "ACME Inc" / "The Acme Company" all become "acme". */
export function normalizeCompany(name?: string) {
  const words = (name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words[0] === "the" && words.length > 1) words.shift();
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) words.pop();
  return words.join(" ");
}

/** A row counts as applied once it has an applied date or any status other than the scrape default. */
function isAppliedRow(row: SheetJob) {
  return Boolean(row.appliedAt.trim()) || !["", "new"].includes(row.status.trim().toLowerCase());
}

export type CleanupMatch = { tab: string; row: number; title: string; company: string };

/**
 * Removes not-yet-applied jobs whose company was already applied to, according to
 * `appliedCompanies` (the user's applications saved on the platform; the sheet's own Status column
 * is not used to decide this). Rows marked applied are kept. With `dryRun` nothing is deleted.
 */
export async function cleanupAppliedCompanies(
  spreadsheetId: string,
  appliedCompanies: string[],
  { dryRun }: { dryRun: boolean },
) {
  const { sheets } = context(spreadsheetId);
  const all = await readAllTabs(spreadsheetId);
  const tabs = all.map(({ id, title }) => ({ id, title }));
  const applied = new Map<string, string>(); // normalised -> display name
  for (const c of appliedCompanies) if (normalizeCompany(c)) applied.set(normalizeCompany(c), c.trim());

  const matchesIn = (rows: SheetJob[], tab: string): CleanupMatch[] =>
    rows
      .filter((r) => !isAppliedRow(r) && applied.has(normalizeCompany(r.company)))
      .map((r) => ({ tab, row: r.row, title: r.title, company: r.company }));

  const removed: CleanupMatch[] = [];
  for (const tab of tabs) {
    // Re-read each tab under its lock so rows appended meanwhile don't shift the deletions.
    const found = await withLock(`${spreadsheetId}/${tab.title}`, async () => {
      const matches = matchesIn(await readTab(spreadsheetId, tab.title), tab.title);
      if (dryRun || !matches.length) return matches;
      // Delete bottom-up, merging adjacent rows, so earlier deletions don't shift later ones.
      const rows = matches.map((m) => m.row).sort((a, b) => b - a);
      const spans: { start: number; end: number }[] = [];
      for (const r of rows) {
        const last = spans[spans.length - 1];
        if (last && last.start === r) last.start = r - 1;
        else spans.push({ start: r - 1, end: r });
      }
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        requestBody: {
          requests: spans.map((s) => ({
            deleteDimension: { range: { sheetId: tab.id, dimension: "ROWS", startIndex: s.start, endIndex: s.end } },
          })),
        },
      });
      return matches;
    });
    removed.push(...found);
  }

  const companies = [...new Set(removed.map((m) => applied.get(normalizeCompany(m.company)) ?? m.company))].sort();
  return { dryRun, count: removed.length, companies, appliedCompanies: applied.size, matches: removed };
}

/** Link to the sheet, opened at the site's tab when it exists. */
export async function sheetLink(spreadsheetId: string, site?: string) {
  const url = sheetUrlFor(spreadsheetId);
  if (!url || !site) return { url, tab: "" };
  const tab = sheetTabName(site);
  const hit = (await listTabs(spreadsheetId)).tabs.find((t) => t.title === tab);
  return hit ? { url: `${url}#gid=${hit.id}`, tab } : { url, tab: "" };
}

/**
 * Validates and stores a user's own sheet. Empty input clears it (falls back to the default
 * sheet). Access is checked up front so a sheet that isn't shared fails here, not mid-scrape.
 */
export async function assignUserSheet(userId: string, input: string) {
  const sheetId = extractGoogleId(input);
  if (sheetId && !/^[a-zA-Z0-9_-]{20,}$/.test(sheetId)) {
    throw new SheetNotConfiguredError("That doesn't look like a Google Sheet URL or ID.");
  }
  let title = "";
  if (sheetId) {
    try {
      title = (await testSheetConnection(sheetId)).title;
    } catch (error) {
      if (error instanceof SheetNotConfiguredError) throw error;
      throw new SheetNotConfiguredError(`Can't open that sheet: ${googleErrorMessage(error)} ${googleShareHint()}`);
    }
  }
  await db.user.update({ where: { id: userId }, data: { sheetId } });
  userSheet.invalidate(userId);
  return { sheetId, title };
}
