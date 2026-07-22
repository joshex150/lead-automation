import type { ScoreBreakdownEntry, ScoreResult, ScoringWeights } from "../../types.js";
import { DEFAULT_SCORING_WEIGHTS } from "../../types.js";

/**
 * Lead scoring, pure function, weights configurable from Settings.
 *
 * The score answers one question: "how likely is this business to pay
 * YEAN for a website?" High scores = clear need (no/broken/rented web
 * presence) + reachable (email/WhatsApp) + momentum (newly opened,
 * active on Instagram).
 */

export interface ScoringInput {
  websiteType: string;
  hasEmail: boolean;
  whatsappAvailable: boolean;
  openingSoon: boolean;
  instagramActive: boolean;
  strongVisualBrand: boolean;
}

export function scoreLead(
  input: ScoringInput,
  weights: ScoringWeights = DEFAULT_SCORING_WEIGHTS,
  threshold = 50,
): ScoreResult {
  const breakdown: ScoreBreakdownEntry[] = [];
  const add = (rule: string, points: number) => {
    if (points !== 0) breakdown.push({ rule, points });
  };

  switch (input.websiteType) {
    case "NO_WEBSITE":
      add("No website", weights.noWebsite);
      break;
    case "BROKEN_WEBSITE":
      add("Broken website", weights.brokenWebsite);
      break;
    case "SOCIAL_MEDIA_ONLY":
      add("Social media only", weights.socialOrLinkInBioOnly);
      break;
    case "LINK_IN_BIO_ONLY":
      add("Link-in-bio only", weights.socialOrLinkInBioOnly);
      break;
    case "MENU_PLATFORM_ONLY":
      add("Menu platform only", weights.menuPlatformOnly);
      break;
    case "SHOPIFY":
      add("Shopify website", weights.shopifyWebsite);
      break;
    case "POOR_WEBSITE":
      add("Poor-quality website", weights.poorWebsite);
      break;
    case "CUSTOM_WEBSITE":
      add("Existing custom website", weights.customWebsitePenalty);
      break;
    default:
      break;
  }

  if (input.hasEmail) add("Public email available", weights.publicEmail);
  if (input.whatsappAvailable) add("WhatsApp number available", weights.whatsappAvailable);
  if (input.openingSoon) add("Recently opened / opening soon", weights.recentlyOpened);
  if (input.instagramActive) add("Active Instagram account", weights.activeInstagram);
  if (input.strongVisualBrand) add("Strong visual brand", weights.strongVisualBrand);

  const score = Math.max(
    0,
    breakdown.reduce((sum, b) => sum + b.points, 0),
  );

  return { score, breakdown, qualified: score >= threshold, threshold };
}
