/** Text normalization helpers. */

/** Lowercase, strip punctuation and legal suffixes, used for duplicate detection. */
export function normalizeBusinessName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(ltd|limited|llc|inc|enterprises?|ventures?|nigeria|nig|intl|international|global|co)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Extracts plausible business email addresses from free text, filtering junk. */
export function extractEmails(text: string): string[] {
  const matches = text.match(EMAIL_RE) ?? [];
  const junkDomains = [
    "example.com",
    "sentry.io",
    "wixpress.com",
    "sentry.wixpress.com",
    "domain.com",
    "email.com",
    "yourdomain.com",
    "godaddy.com",
    "mysite.com",
  ];
  const junkExtensions = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?)$/i;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const m of matches) {
    const email = m.toLowerCase().replace(/^\d+@/, ""); // strip version-string artifacts like 2x@
    if (junkExtensions.test(email)) continue;
    const domain = email.split("@")[1];
    if (!domain || junkDomains.includes(domain)) continue;
    if (email.length > 60) continue;
    if (!seen.has(email)) {
      seen.add(email);
      out.push(email);
    }
  }
  return out;
}
