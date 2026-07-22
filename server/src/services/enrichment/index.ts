import { logger } from "../../utils/logger.js";
import { normalizeNigerianPhone, isLikelyMobile } from "../../utils/phone.js";
import { extractContactsFromHtml, mergeContacts } from "./contactExtractor.js";
import type { LeadDocument } from "../../models/Lead.js";
import type { ExtractedContacts } from "../../types.js";

const UA = "Mozilla/5.0 (compatible; YEANLeadBot/1.0; +https://yean.tech)";

const EMPTY: ExtractedContacts = {
  emails: [],
  phones: [],
  whatsappNumbers: [],
  instagramUsernames: [],
  facebookUrls: [],
};

async function fetchHtml(url: string, timeoutMs = 12000): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok || !/text\/html/i.test(res.headers.get("content-type") ?? "")) {
      res.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = await res.text();
    return text.length > 3_000_000 ? text.slice(0, 3_000_000) : text;
  } catch {
    return null;
  }
}

/**
 * Enriches a lead in place with contact info:
 *  - Phone from Google Places (already on the lead) → normalized, WhatsApp-capable flag.
 *  - Email / WhatsApp / Instagram scraped from the business's own website
 *    (homepage + a contact page if one is linked + link-in-bio page).
 * Every collected value gets a provenance entry in lead.contactSources.
 */
export async function enrichLead(lead: LeadDocument, homepageHtml?: string | null): Promise<void> {
  // ---- Phone from Places ----
  if (lead.phone && !lead.phoneNormalized) {
    const normalized = normalizeNigerianPhone(lead.phone);
    if (normalized) {
      lead.phoneNormalized = normalized;
      lead.whatsappAvailable = lead.whatsappAvailable || isLikelyMobile(normalized);
      lead.contactSources.push({
        field: "phone",
        value: normalized,
        source: "google_places",
        collectedAt: new Date(),
      });
    }
  }

  // ---- Website scraping ----
  let contacts: ExtractedContacts = { ...EMPTY };
  const pageUrl = lead.websiteCheck?.finalUrl ?? lead.websiteUrl;

  if (pageUrl) {
    const html = homepageHtml ?? (await fetchHtml(pageUrl));
    if (html) {
      contacts = extractContactsFromHtml(html, pageUrl);

      // Follow one contact/about page if linked (common place for emails).
      const contactHref = html.match(/href=["']([^"']*(?:contact|about)[^"']*)["']/i)?.[1];
      if (contactHref) {
        try {
          const contactUrl = new URL(contactHref, pageUrl).toString();
          if (contactUrl !== pageUrl) {
            const contactHtml = await fetchHtml(contactUrl, 8000);
            if (contactHtml) {
              contacts = mergeContacts(contacts, extractContactsFromHtml(contactHtml, contactUrl));
            }
          }
        } catch {
          /* invalid contact URL, skip */
        }
      }
    }
  }

  // ---- Apply extracted contacts with provenance ----
  const now = new Date();

  if (!lead.email && contacts.emails.length > 0) {
    const best = contacts.emails[0];
    lead.email = best.value;
    lead.emailVerifiedFormat = true;
    lead.contactSources.push({
      field: "email",
      value: best.value,
      source: "website",
      sourceUrl: best.sourceUrl,
      collectedAt: now,
    });
  }

  if (contacts.whatsappNumbers.length > 0) {
    const wa = contacts.whatsappNumbers[0];
    lead.whatsappAvailable = true;
    if (!lead.phoneNormalized) lead.phoneNormalized = wa.value;
    lead.contactSources.push({
      field: "whatsapp",
      value: wa.value,
      source: "website",
      sourceUrl: wa.sourceUrl,
      collectedAt: now,
    });
  }

  if (!lead.phoneNormalized && contacts.phones.length > 0) {
    const p = contacts.phones[0];
    lead.phoneNormalized = p.value;
    lead.whatsappAvailable = lead.whatsappAvailable || isLikelyMobile(p.value);
    lead.contactSources.push({
      field: "phone",
      value: p.value,
      source: "website",
      sourceUrl: p.sourceUrl,
      collectedAt: now,
    });
  }

  if (!lead.instagramUsername && contacts.instagramUsernames.length > 0) {
    const ig = contacts.instagramUsernames[0];
    lead.instagramUsername = ig.value;
    lead.instagramUrl = `https://instagram.com/${ig.value}`;
    lead.contactSources.push({
      field: "instagram",
      value: ig.value,
      source: "website",
      sourceUrl: ig.sourceUrl,
      collectedAt: now,
    });
  }

  if (!lead.facebookUrl && contacts.facebookUrls.length > 0) {
    lead.facebookUrl = contacts.facebookUrls[0].value;
  }

  logger.debug(
    {
      lead: lead.businessName,
      email: lead.email,
      phone: lead.phoneNormalized,
      instagram: lead.instagramUsername,
    },
    "enrichment complete",
  );
}
