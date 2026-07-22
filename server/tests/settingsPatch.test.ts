import { describe, expect, it } from "vitest";
import { applyIntegrationsPatch } from "../src/routes/settings.js";

/**
 * The dashboard reads secrets back masked ("••••1234"). When it saves, those
 * masked placeholders must be ignored so the real stored secret survives,
 * while genuinely edited fields are written through. This is the guard
 * against a "save settings" click wiping every credential.
 */
describe("applyIntegrationsPatch", () => {
  it("keeps stored secrets when the patch sends a masked placeholder", () => {
    const current = {
      googlePlacesApiKey: "real-places-key",
      ai: { provider: "OPENAI", apiKey: "real-openai-key", model: "gpt-4o-mini", baseUrl: "" },
    };
    applyIntegrationsPatch(current, {
      googlePlacesApiKey: "••••-key",
      ai: { provider: "OPENAI", apiKey: "••••key", model: "gpt-4o" },
    });
    expect(current.googlePlacesApiKey).toBe("real-places-key");
    expect(current.ai.apiKey).toBe("real-openai-key");
    expect(current.ai.model).toBe("gpt-4o"); // non-secret edit applied
  });

  it("writes through a genuinely new secret", () => {
    const current = { ai: { apiKey: "old" } };
    applyIntegrationsPatch(current, { ai: { apiKey: "sk-brand-new" } });
    expect(current.ai.apiKey).toBe("sk-brand-new");
  });

  it("merges deeply nested provider objects", () => {
    const current = {
      email: {
        provider: "AUTO",
        gmail: { clientId: "id", clientSecret: "sec", refreshToken: "tok" },
        zoho: { user: "u", password: "pw" },
      },
    };
    applyIntegrationsPatch(current, {
      email: { provider: "ZOHO", zoho: { password: "••••", user: "new@z.com" } },
    });
    expect(current.email.provider).toBe("ZOHO");
    expect(current.email.zoho.user).toBe("new@z.com");
    expect(current.email.zoho.password).toBe("pw"); // masked, preserved
    expect(current.email.gmail.clientSecret).toBe("sec"); // untouched branch
  });

  it("handles booleans and numbers without masking them", () => {
    const current = { email: { zoho: { secure: true, port: 465 } } };
    applyIntegrationsPatch(current, { email: { zoho: { secure: false, port: 587 } } });
    expect(current.email.zoho.secure).toBe(false);
    expect(current.email.zoho.port).toBe(587);
  });
});
