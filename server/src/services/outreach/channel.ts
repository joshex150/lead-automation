import { DEFAULT_COUNTRY, countryFromAddress, countryOf, isLikelyMobile, normalizePhone } from "../../utils/phone.js";
import type { LeadDocument } from "../../models/Lead.js";
import type { OutreachChannel } from "../../types.js";

interface ContactRoutes {
  email?: string | null;
  instagramUsername?: string | null;
  whatsappAvailable?: boolean;
  phone?: string | null;
  phoneNormalized?: string | null;
  /** The business's own address, which is what says which country it is in. */
  address?: string | null;
}

/**
 * Whether this business can be reached on WhatsApp.
 *
 * Derived from the number rather than read from the stored flag. That flag was
 * only ever set inside enrichment's "normalise the phone" branch, which is
 * skipped when discovery already normalised it, which discovery always does for
 * a Google Places lead. So the flag stayed false for every Places lead, and
 * hundreds of businesses with a perfectly good mobile number came out with no
 * contact route at all. A Nigerian mobile prefix is the evidence; the flag is
 * only a cache of it.
 */
export function whatsappReachable(lead: ContactRoutes): boolean {
  /*
   * The number decides, in both directions. The flag is only a cache of it.
   *
   * This used to answer from the flag first and return early, so a flag set
   * wrongly could never be unset: `assignChannel` only ever turns it on. A
   * number mis-stamped as a Nigerian mobile got `whatsappAvailable` set, and
   * once the number was corrected to the American one it always was, the lead
   * still advertised a WhatsApp route and a wa.me link into nothing.
   *
   * The business's own address says which country to read a national number as,
   * and the house default only fills the silence, which is the hand-typed
   * import case. A number carrying its own dial code keeps it either way.
   */
  const country = countryFromAddress(lead.address)?.iso ?? DEFAULT_COUNTRY;
  const normalized = lead.phoneNormalized ?? (lead.phone ? normalizePhone(lead.phone, country) : null);
  if (isLikelyMobile(normalized)) return true;

  /*
   * The flag still counts as evidence where the digits cannot answer: a wa.me
   * link found on the business's own site proves the number is on WhatsApp even
   * when it belongs to a country whose mobile ranges this build has no table
   * for. Where the country IS known, the table has already spoken and the flag
   * does not get to overrule it.
   */
  return Boolean(lead.whatsappAvailable && normalized && !countryOf(normalized));
}

/**
 * How a lead will actually be contacted.
 *
 * This used to be decided inline in three places, all of them written as
 * `email ? EMAIL : instagram ? INSTAGRAM_MANUAL : EMAIL`. That final EMAIL was
 * wrong twice over: a business reachable only on WhatsApp was never offered as
 * a WhatsApp lead, and a business with no route at all was marked as an email
 * lead with no address, so it sat in the queue looking actionable and could
 * never be sent. The dashboard then labelled both of them "Instagram DM",
 * because it inferred the channel from "not a working email" rather than
 * reading it.
 *
 * The order is deliberate. Email is the only channel the system can dispatch
 * itself; Instagram and WhatsApp are handed to a human with the message ready;
 * NONE is the honest answer for a lead with nothing but a landline.
 */
export function preferredChannel(lead: ContactRoutes): OutreachChannel {
  if (lead.email) return "EMAIL";
  if (lead.instagramUsername) return "INSTAGRAM_MANUAL";
  if (whatsappReachable(lead)) return "WHATSAPP";
  return "NONE";
}

/** Every way this business could be reached, not only the one that will be used. */
export function contactRoutes(lead: ContactRoutes): Array<"EMAIL" | "INSTAGRAM" | "WHATSAPP" | "PHONE"> {
  const routes: Array<"EMAIL" | "INSTAGRAM" | "WHATSAPP" | "PHONE"> = [];
  if (lead.email) routes.push("EMAIL");
  if (lead.instagramUsername) routes.push("INSTAGRAM");
  if (whatsappReachable(lead)) routes.push("WHATSAPP");
  if (lead.phone || lead.phoneNormalized) routes.push("PHONE");
  return routes;
}

/**
 * Sets the channel and keeps the WhatsApp flag in step with the number.
 *
 * The flag is assigned, not only raised. It used to be set true and never set
 * back, so every correction to a number left the old answer standing on the
 * lead for good.
 */
export function assignChannel(lead: LeadDocument): OutreachChannel {
  lead.whatsappAvailable = whatsappReachable(lead);
  lead.outreachChannel = preferredChannel(lead);
  return lead.outreachChannel;
}

/** True when the channel can actually carry a message today. */
export function channelIsReachable(lead: ContactRoutes & { outreachChannel: OutreachChannel }): boolean {
  switch (lead.outreachChannel) {
    case "EMAIL":
      return Boolean(lead.email);
    case "INSTAGRAM_MANUAL":
      return Boolean(lead.instagramUsername);
    case "WHATSAPP":
      return whatsappReachable(lead);
    default:
      return false;
  }
}

/** Human wording for the channel, used in prompts and in the interface. */
export const CHANNEL_LABELS: Record<OutreachChannel, string> = {
  EMAIL: "email",
  INSTAGRAM_MANUAL: "Instagram DM",
  WHATSAPP: "WhatsApp message",
  NONE: "message",
};
