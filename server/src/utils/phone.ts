/**
 * Nigerian phone number handling.
 *
 * Accepts the common formats businesses publish:
 *   0803 123 4567, +234 803 123 4567, 234-803-123-4567, 08031234567,
 *   tel:+2348031234567, wa.me/2348031234567
 * and normalizes to E.164 (+2348031234567).
 */

const NG_MOBILE_PREFIXES = /^(70|80|81|90|91)\d{8}$/;

export function normalizeNigerianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;

  if (digits.startsWith("+")) digits = digits.slice(1);
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (digits.startsWith("234")) {
    digits = digits.slice(3);
    // Some listings write +2340803..., drop the redundant trunk zero.
    if (digits.startsWith("0")) digits = digits.slice(1);
  } else if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  // A valid NG national significant number is 10 digits (mobile), landlines
  // vary but mobile is what matters for WhatsApp.
  if (digits.length !== 10) return null;
  if (!/^\d{10}$/.test(digits)) return null;

  return `+234${digits}`;
}

/** True when the number looks like a Nigerian mobile (and therefore possibly WhatsApp-capable). */
export function isLikelyMobile(e164: string | null | undefined): boolean {
  if (!e164 || !e164.startsWith("+234")) return false;
  return NG_MOBILE_PREFIXES.test(e164.slice(4));
}

/** Extracts the phone number from a wa.me / api.whatsapp.com link, normalized to E.164. */
export function phoneFromWhatsAppLink(url: string): string | null {
  const m = url.match(/(?:wa\.me\/|api\.whatsapp\.com\/send\/?\?phone=|whatsapp:\/\/send\?phone=)\+?(\d{7,15})/i);
  if (!m) return null;
  return normalizeNigerianPhone(m[1]);
}
