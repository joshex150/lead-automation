import { describe, expect, it } from "vitest";
import { channelIsReachable, contactRoutes, preferredChannel, whatsappReachable } from "../src/services/outreach/channel.js";
import {
  fillPlaceholders,
  hasOwnSpecifics,
  isUsableTemplate,
  pitchGroupKey,
} from "../src/services/pitch/pitchGroups.js";
import type { PitchContext } from "../src/services/pitch/generatePitch.js";

describe("choosing the outreach channel", () => {
  it("prefers email, the only channel that can be sent automatically", () => {
    expect(
      preferredChannel({ email: "hello@crystalscents.com.ng", instagramUsername: "crystalscents", whatsappAvailable: true, phone: "08012345678" }),
    ).toBe("EMAIL");
  });

  it("falls to Instagram when there is no address", () => {
    expect(preferredChannel({ instagramUsername: "glowhaven" })).toBe("INSTAGRAM_MANUAL");
  });

  it("uses WhatsApp when that is the only way in", () => {
    // The old rule skipped this case entirely and returned EMAIL, so a
    // WhatsApp-only business could never be worked.
    expect(preferredChannel({ whatsappAvailable: true, phone: "08012345678" })).toBe("WHATSAPP");
  });

  it("reads WhatsApp off the number, not off a flag nobody set", () => {
    // Discovery normalises the Places phone, which meant enrichment's
    // "normalise it" branch never ran, which meant whatsappAvailable stayed
    // false for every Places lead. Six hundred businesses with perfectly good
    // mobile numbers came out with no contact route because of it.
    expect(preferredChannel({ phone: "0818 629 8888" })).toBe("WHATSAPP");
    expect(preferredChannel({ phoneNormalized: "+2348012345678" })).toBe("WHATSAPP");
  });

  it("says NONE rather than pretending a landline is an email address", () => {
    // A Lagos landline is not a WhatsApp number and never was an email address.
    expect(preferredChannel({ phone: "012345678" })).toBe("NONE");
    expect(preferredChannel({})).toBe("NONE");
  });

  it("does not count WhatsApp without a number to message", () => {
    expect(preferredChannel({ whatsappAvailable: true })).toBe("NONE");
  });

  it("lists every route, not only the one that will be used", () => {
    expect(contactRoutes({ email: "a@b.ng", instagramUsername: "x", phone: "08012345678" })).toEqual([
      "EMAIL",
      "INSTAGRAM",
      "WHATSAPP",
      "PHONE",
    ]);
    expect(contactRoutes({ phone: "012345678" })).toEqual(["PHONE"]);
    expect(contactRoutes({})).toEqual([]);
  });

  it("knows which channels can actually carry a message", () => {
    expect(channelIsReachable({ outreachChannel: "EMAIL", email: "a@b.ng" })).toBe(true);
    expect(channelIsReachable({ outreachChannel: "EMAIL" })).toBe(false);
    expect(channelIsReachable({ outreachChannel: "INSTAGRAM_MANUAL", instagramUsername: "x" })).toBe(true);
    expect(channelIsReachable({ outreachChannel: "WHATSAPP", whatsappAvailable: true, phone: "0801 234 5678" })).toBe(true);
    expect(channelIsReachable({ outreachChannel: "NONE" })).toBe(false);
    /*
     * The fixture above used to be the fragment "0801", which this returned
     * true for: the flag was answered first and a flag plus any non-empty
     * string counted as reachable. Four digits cannot carry a message, and
     * "can actually carry a message" is what this is asking.
     */
    expect(channelIsReachable({ outreachChannel: "WHATSAPP", whatsappAvailable: true, phone: "0801" })).toBe(false);
  });
});

const ctx = (over: Partial<PitchContext> = {}): PitchContext => ({
  businessName: "Crystal Scents",
  category: "Perfume store",
  city: "Lagos",
  websiteType: "NO_WEBSITE",
  websiteProblem: "No meaningful web presence.",
  outreachChannel: "EMAIL",
  openingSoon: false,
  ...over,
});

describe("sharing one message across similar leads", () => {
  it("groups on the things the message actually talks about", () => {
    expect(pitchGroupKey(ctx())).toBe(pitchGroupKey(ctx({ businessName: "Aroma House", city: "Abuja" })));
  });

  it("separates different situations", () => {
    const base = pitchGroupKey(ctx());
    expect(pitchGroupKey(ctx({ websiteType: "BROKEN_WEBSITE" }))).not.toBe(base);
    expect(pitchGroupKey(ctx({ category: "Restaurant" }))).not.toBe(base);
    expect(pitchGroupKey(ctx({ outreachChannel: "INSTAGRAM_MANUAL" }))).not.toBe(base);
    expect(pitchGroupKey(ctx({ openingSoon: true }))).not.toBe(base);
  });

  it("keeps a lead with its own specifics out of any group", () => {
    expect(hasOwnSpecifics(ctx())).toBe(false);
    expect(hasOwnSpecifics(ctx({ instagramBio: "Perfume oils, Lekki" }))).toBe(true);
    expect(hasOwnSpecifics(ctx({ recentPostSummary: "New oud collection" }))).toBe(true);
  });

  it("puts each business's own name and city into the shared message", () => {
    const filled = fillPlaceholders("Hello {{business}}, we work with shops in {{city}}.", ctx());
    expect(filled).toBe("Hello Crystal Scents, we work with shops in Lagos.");
    expect(filled).not.toContain("{{");
  });

  it("rejects a message that would greet nobody", () => {
    // Without the business name the same text goes to everyone, which is the
    // failure this whole mechanism has to avoid.
    expect(isUsableTemplate({ subject: "A website for you", message: "Hello there, we build sites." })).toBe(false);
  });

  it("rejects a message carrying a placeholder we cannot fill", () => {
    expect(
      isUsableTemplate({ subject: "A website for {{business}}", message: "Hello {{business}} in {{state}}," }),
    ).toBe(false);
  });

  it("accepts a message addressed to the business", () => {
    expect(
      isUsableTemplate({ subject: "A website for {{business}}", message: "Hello {{business}}, we work in {{city}}." }),
    ).toBe(true);
  });
});

/*
 * A scan covers several countries at once, so the country belongs to the
 * business, not to the account. Every number used to be read as Nigerian.
 */
describe("reach options on a multi-country scan", () => {
  it("does not claim a foreign mobile is Nigerian", () => {
    // A ten-digit American number: exactly the length a Nigerian national
    // number has, which is how it used to come out as +234 4155552671.
    const american = { phone: "(415) 555-2671", address: "500 Market St, San Francisco, CA, United States" };
    expect(whatsappReachable(american)).toBe(false);
    expect(preferredChannel(american)).toBe("NONE");
    expect(contactRoutes(american)).toEqual(["PHONE"]);
  });

  it("reads a national number as the country the business is actually in", () => {
    const ghanaian = { phone: "024 123 4567", address: "12 Oxford St, Osu, Accra, Ghana" };
    expect(whatsappReachable(ghanaian)).toBe(true);
    expect(preferredChannel(ghanaian)).toBe("WHATSAPP");

    const british = { phone: "07700 900123", address: "221B Baker Street, London, United Kingdom" };
    expect(whatsappReachable(british)).toBe(true);
  });

  it("keeps a number that states its own country, whatever the address says", () => {
    const visiting = { phone: "+233 24 123 4567", address: "1 Adeola Odeku St, Lagos, Nigeria" };
    expect(whatsappReachable(visiting)).toBe(true);
  });

  it("still reads an address-less number as the house default, so imports keep their route", () => {
    // No address is the hand-typed import case. Dropping the default here
    // would have quietly cost every imported lead its WhatsApp route.
    expect(whatsappReachable({ phone: "0818 629 8888" })).toBe(true);
  });
})
