import type { Lead } from "./types";

/**
 * Which routes exist into a business, worked out from the lead itself.
 *
 * Deliberately derived here rather than read from `outreachChannel`. That field
 * records the one route outreach will use; it is a single value, it is written
 * at scoring time, and a lead scored under an older rule can be holding an
 * answer nobody would give today. The chips in the queue have to tell the truth
 * about what is on the record right now, so they are computed from the contact
 * fields every render.
 */

export type ContactRoute = "EMAIL" | "INSTAGRAM" | "WHATSAPP" | "PHONE";

/** The countries the server knows how to read a national phone number for. */
export const COUNTRIES = [
  { iso: "NG", name: "Nigeria", dial: "234" },
  { iso: "GH", name: "Ghana", dial: "233" },
  { iso: "KE", name: "Kenya", dial: "254" },
  { iso: "ZA", name: "South Africa", dial: "27" },
  { iso: "EG", name: "Egypt", dial: "20" },
  { iso: "GB", name: "United Kingdom", dial: "44" },
  { iso: "US", name: "United States", dial: "1" },
  { iso: "CA", name: "Canada", dial: "1" },
  { iso: "IN", name: "India", dial: "91" },
  { iso: "AE", name: "United Arab Emirates", dial: "971" },
  { iso: "FR", name: "France", dial: "33" },
  { iso: "DE", name: "Germany", dial: "49" },
] as const;

/**
 * Mobile prefixes per dial code, longest dial code first so +234 is matched
 * before +23 would be. Mirrors the server's table; the two agree on which
 * numbers can be offered as WhatsApp contacts.
 *
 * North America is deliberately absent: the same ranges carry landlines and
 * mobiles there, so a +1 number cannot be classified and is shown as a phone
 * contact rather than claimed as a WhatsApp one.
 */
const MOBILE_BY_DIAL: Array<[string, RegExp]> = [
  ["971", /^5/],
  ["234", /^(70|80|81|90|91)/],
  ["233", /^(2|5)/],
  ["254", /^(7|1)/],
  ["91", /^[6-9]/],
  ["49", /^1[5-7]/],
  ["44", /^7/],
  ["33", /^[67]/],
  ["27", /^(6|7|8)/],
  ["20", /^1/],
];

/**
 * The number as stored, or as close as we can get without knowing the country.
 * The pipeline writes E.164, so anything that already starts with a plus is
 * taken as authoritative and left alone.
 */
function normalise(phone: string | undefined | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  return null;
}

/**
 * The number to open WhatsApp with, when the number looks like a mobile.
 *
 * The digits decide, and `whatsappAvailable` only speaks where they cannot.
 * This used to return early on the flag, which is a cache of a decision taken
 * when the number was first read: a number stamped with the wrong country got
 * the flag set, and after the number was corrected the flag still drew a
 * WhatsApp chip and a wa.me link into a number nobody owns. Where the dial code
 * is one of the ones below, the table has already answered.
 */
export function whatsappNumber(lead: Pick<Lead, "phone" | "phoneNormalized" | "whatsappAvailable">): string | null {
  const number = lead.phoneNormalized ?? normalise(lead.phone);
  if (!number || !number.startsWith("+")) return null;

  const digits = number.slice(1);
  for (const [dial, mobile] of MOBILE_BY_DIAL) {
    if (digits.startsWith(dial)) return mobile.test(digits.slice(dial.length)) ? number : null;
  }

  /*
   * North America and any country absent from the table reach here. A +1
   * number cannot be classified from its digits, so the server's flag is the
   * only evidence there is: it is set from a wa.me link found on the business's
   * own site, which proves the number is on WhatsApp.
   */
  return lead.whatsappAvailable ? number : null;
}

export function contactRoutes(lead: Lead): ContactRoute[] {
  const routes: ContactRoute[] = [];
  if (lead.email) routes.push("EMAIL");
  if (lead.instagramUsername) routes.push("INSTAGRAM");
  if (whatsappNumber(lead)) routes.push("WHATSAPP");
  if (lead.phone || lead.phoneNormalized) routes.push("PHONE");
  return routes;
}

export const CHANNEL_LABELS: Record<Lead["outreachChannel"], string> = {
  EMAIL: "Email",
  INSTAGRAM_MANUAL: "Instagram DM",
  WHATSAPP: "WhatsApp",
  NONE: "No contact route",
};

/** What to call the message being edited, given the channel it will go out on. */
export const MESSAGE_LABELS: Record<Lead["outreachChannel"], string> = {
  EMAIL: "Email message",
  INSTAGRAM_MANUAL: "Instagram DM",
  WHATSAPP: "WhatsApp message",
  NONE: "Message, once a contact route is found",
};

/** A wa.me link that opens the chat with the message already typed. */
export function whatsappLink(lead: Lead, message: string): string | null {
  const number = whatsappNumber(lead);
  if (!number) return null;
  return `https://wa.me/${number.replace("+", "")}?text=${encodeURIComponent(message)}`;
}
