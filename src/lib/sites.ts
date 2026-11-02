/** Maps a job URL to the site label used for the Google Sheet tab and the "source" column. */
const KNOWN_SITES: { label: string; hosts: string[] }[] = [
  { label: "Jobright", hosts: ["jobright.ai"] },
  { label: "HiringCafe", hosts: ["hiring.cafe"] },
  { label: "LinkedIn", hosts: ["linkedin.com"] },
  { label: "Indeed", hosts: ["indeed.com"] },
  { label: "Wellfound", hosts: ["wellfound.com", "angel.co"] },
  { label: "RemoteOK", hosts: ["remoteok.com", "remoteok.io"] },
  { label: "WeWorkRemotely", hosts: ["weworkremotely.com"] },
];

export function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function siteLabel(url: string) {
  const host = hostOf(url);
  if (!host) return "Other";
  const known = KNOWN_SITES.find((s) => s.hosts.some((h) => host === h || host.endsWith(`.${h}`)));
  return known ? known.label : host;
}

/** Google Sheet tab names cannot contain some characters and are limited to 100 chars. */
export function sheetTabName(label: string) {
  return label.replace(/[\[\]\*\?\/\:]/g, "-").slice(0, 100) || "Other";
}
