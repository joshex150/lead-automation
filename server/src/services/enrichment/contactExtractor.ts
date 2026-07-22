import * as cheerio from "cheerio";
import { extractEmails } from "../../utils/text.js";
import { normalizeNigerianPhone, phoneFromWhatsAppLink } from "../../utils/phone.js";
import { instagramUsernameFromUrl } from "../../utils/url.js";
import type { ExtractedContacts } from "../../types.js";

/**
 * Extracts publicly presented business contact information from a page.
 * Pure function over HTML, unit-testable, no network.
 *
 * Compliance note: we only collect contact details the business itself
 * publishes on its own public pages, and we record the exact source URL
 * for every value (NDPA provenance requirement).
 */
export function extractContactsFromHtml(html: string, sourceUrl: string): ExtractedContacts {
  const $ = cheerio.load(html);
  const out: ExtractedContacts = {
    emails: [],
    phones: [],
    whatsappNumbers: [],
    instagramUsernames: [],
    facebookUrls: [],
  };

  const seen = {
    email: new Set<string>(),
    phone: new Set<string>(),
    wa: new Set<string>(),
    ig: new Set<string>(),
    fb: new Set<string>(),
  };

  // 1) mailto: and tel: links (highest-confidence signals)
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    if (href.startsWith("mailto:")) {
      const email = href.slice(7).split("?")[0].trim().toLowerCase();
      for (const e of extractEmails(email)) {
        if (!seen.email.has(e)) {
          seen.email.add(e);
          out.emails.push({ value: e, sourceUrl });
        }
      }
    } else if (href.startsWith("tel:")) {
      const phone = normalizeNigerianPhone(href.slice(4));
      if (phone && !seen.phone.has(phone)) {
        seen.phone.add(phone);
        out.phones.push({ value: phone, sourceUrl });
      }
    } else if (/wa\.me|api\.whatsapp\.com|whatsapp:\/\//i.test(href)) {
      const phone = phoneFromWhatsAppLink(href);
      if (phone && !seen.wa.has(phone)) {
        seen.wa.add(phone);
        out.whatsappNumbers.push({ value: phone, sourceUrl });
      }
    } else if (/instagram\.com\//i.test(href)) {
      const username = instagramUsernameFromUrl(href);
      if (username && !seen.ig.has(username)) {
        seen.ig.add(username);
        out.instagramUsernames.push({ value: username, sourceUrl });
      }
    } else if (/facebook\.com\//i.test(href) && !/sharer|share\.php|login/i.test(href)) {
      const clean = href.split("?")[0];
      if (!seen.fb.has(clean)) {
        seen.fb.add(clean);
        out.facebookUrls.push({ value: clean, sourceUrl });
      }
    }
  });

  // 2) Emails in visible text / footer (secondary signal)
  const bodyText = $("body").text();
  for (const e of extractEmails(bodyText)) {
    if (!seen.email.has(e)) {
      seen.email.add(e);
      out.emails.push({ value: e, sourceUrl });
    }
  }

  // 3) Nigerian phone patterns in visible text
  const phoneMatches = bodyText.match(/(?:\+?234|0)[\s-]?[789][01][\s-]?\d[\s-]?\d{3}[\s-]?\d{4}/g) ?? [];
  for (const raw of phoneMatches.slice(0, 10)) {
    const phone = normalizeNigerianPhone(raw);
    if (phone && !seen.phone.has(phone)) {
      seen.phone.add(phone);
      out.phones.push({ value: phone, sourceUrl });
    }
  }

  return out;
}

/** Merges contacts from multiple pages, de-duplicated, order preserved. */
export function mergeContacts(base: ExtractedContacts, extra: ExtractedContacts): ExtractedContacts {
  const merge = <T extends { value: string }>(a: T[], b: T[]): T[] => {
    const seen = new Set(a.map((x) => x.value));
    return [...a, ...b.filter((x) => !seen.has(x.value))];
  };
  return {
    emails: merge(base.emails, extra.emails),
    phones: merge(base.phones, extra.phones),
    whatsappNumbers: merge(base.whatsappNumbers, extra.whatsappNumbers),
    instagramUsernames: merge(base.instagramUsernames, extra.instagramUsernames),
    facebookUrls: merge(base.facebookUrls, extra.facebookUrls),
  };
}
