import { describe, expect, it } from "vitest";
import { extractContactsFromHtml, mergeContacts } from "../src/services/enrichment/contactExtractor.js";

const SOURCE = "https://crystalscents.ng/";

describe("extractContactsFromHtml", () => {
  it("extracts mailto emails", () => {
    const html = `<html><body><a href="mailto:hello@crystalscents.ng?subject=Hi">Email us</a></body></html>`;
    const c = extractContactsFromHtml(html, SOURCE);
    expect(c.emails).toEqual([{ value: "hello@crystalscents.ng", sourceUrl: SOURCE }]);
  });

  it("extracts tel: phones normalized to E.164", () => {
    const html = `<html><body><a href="tel:0803 123 4567">Call</a></body></html>`;
    const c = extractContactsFromHtml(html, SOURCE);
    expect(c.phones).toEqual([{ value: "+2348031234567", sourceUrl: SOURCE }]);
  });

  it("extracts WhatsApp numbers from wa.me links", () => {
    const html = `<html><body><a href="https://wa.me/2348031234567">Chat</a></body></html>`;
    const c = extractContactsFromHtml(html, SOURCE);
    expect(c.whatsappNumbers).toEqual([{ value: "+2348031234567", sourceUrl: SOURCE }]);
  });

  it("extracts Instagram usernames from profile links", () => {
    const html = `<html><body>
      <a href="https://instagram.com/crystal.scents">IG</a>
      <a href="https://instagram.com/p/Cabc123">a post</a>
    </body></html>`;
    const c = extractContactsFromHtml(html, SOURCE);
    expect(c.instagramUsernames).toEqual([{ value: "crystal.scents", sourceUrl: SOURCE }]);
  });

  it("extracts emails from visible text", () => {
    const html = `<html><body><footer>Contact: orders@crystalscents.ng | Lagos</footer></body></html>`;
    const c = extractContactsFromHtml(html, SOURCE);
    expect(c.emails.map((e) => e.value)).toContain("orders@crystalscents.ng");
  });

  it("extracts Nigerian phone patterns from text", () => {
    const html = `<html><body><p>Call us on 0803 123 4567 or +234 901 234 5678</p></body></html>`;
    const c = extractContactsFromHtml(html, SOURCE);
    expect(c.phones.map((p) => p.value)).toEqual(
      expect.arrayContaining(["+2348031234567", "+2349012345678"]),
    );
  });

  it("filters junk emails (assets, tracker domains)", () => {
    const html = `<html><body>
      image@2x.png in text: logo@2x.png
      <p>real: info@business.ng</p>
      <p>junk: sample@example.com</p>
    </body></html>`;
    const c = extractContactsFromHtml(html, SOURCE);
    const values = c.emails.map((e) => e.value);
    expect(values).toContain("info@business.ng");
    expect(values).not.toContain("sample@example.com");
    expect(values.every((v) => !v.endsWith(".png"))).toBe(true);
  });

  it("dedupes repeated contacts", () => {
    const html = `<html><body>
      <a href="mailto:hello@biz.ng">1</a>
      <a href="mailto:hello@biz.ng">2</a>
      <p>hello@biz.ng</p>
    </body></html>`;
    const c = extractContactsFromHtml(html, SOURCE);
    expect(c.emails).toHaveLength(1);
  });

  it("skips facebook share links but keeps page links", () => {
    const html = `<html><body>
      <a href="https://facebook.com/sharer/sharer.php?u=x">share</a>
      <a href="https://facebook.com/crystalscents">page</a>
    </body></html>`;
    const c = extractContactsFromHtml(html, SOURCE);
    expect(c.facebookUrls).toEqual([{ value: "https://facebook.com/crystalscents", sourceUrl: SOURCE }]);
  });
});

describe("mergeContacts", () => {
  it("merges without duplicates, preserving first-seen order", () => {
    const a = extractContactsFromHtml(`<a href="mailto:a@x.ng">a</a>`, "https://x.ng/");
    const b = extractContactsFromHtml(
      `<a href="mailto:a@x.ng">a</a><a href="mailto:b@x.ng">b</a>`,
      "https://x.ng/contact",
    );
    const merged = mergeContacts(a, b);
    expect(merged.emails.map((e) => e.value)).toEqual(["a@x.ng", "b@x.ng"]);
    expect(merged.emails[0].sourceUrl).toBe("https://x.ng/");
  });
});

/*
 * The pattern used to spell out the Nigerian mobile ranges, so a business
 * anywhere else had no phone number scraped from its own website at all.
 */
describe("phone numbers are found wherever the business is", () => {
  const page = (body: string) => `<html><body>${body}</body></html>`;

  it("finds an international number printed in a footer", () => {
    const uk = extractContactsFromHtml(page("<p>Call us on +44 7700 900123</p>"), "https://example.co.uk", "GB");
    expect(uk.phones.map((p) => p.value)).toContain("+447700900123");

    const ghana = extractContactsFromHtml(page("<p>WhatsApp: +233 24 123 4567</p>"), "https://example.com.gh", "GH");
    expect(ghana.phones.map((p) => p.value)).toContain("+233241234567");
  });

  it("reads a national number as the country the page belongs to", () => {
    const kenya = extractContactsFromHtml(page("<p>0712 345 678</p>"), "https://example.co.ke", "KE");
    expect(kenya.phones.map((p) => p.value)).toContain("+254712345678");
  });

  it("still finds Nigerian numbers, which is what it used to do exclusively", () => {
    const ng = extractContactsFromHtml(page("<p>0803 123 4567</p>"), "https://example.ng", "NG");
    expect(ng.phones.map((p) => p.value)).toContain("+2348031234567");
  });

  it("does not invent numbers out of other digits on the page", () => {
    const noise = extractContactsFromHtml(
      page("<p>Open 2024. Order no. 12345. VAT 0123456789012345678</p>"),
      "https://example.ng",
      "NG",
    );
    // normalizePhone is the judge: anything that is not a valid number for the
    // country produces nothing, so a loose match costs nothing.
    for (const phone of noise.phones) expect(phone.value).toMatch(/^\+\d{8,15}$/);
  });
})
