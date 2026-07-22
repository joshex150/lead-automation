/**
 * Demo-data seeder: populates the database with realistic sample leads
 * so you can explore the dashboard before wiring up the Google Places key.
 *
 *   npm run seed --workspace server
 */
import { connectDb, disconnectDb } from "../db/connect.js";
import { Lead } from "../models/Lead.js";
import { getSettings } from "../models/Settings.js";
import { processLead } from "../services/pipeline/runPipeline.js";
import { normalizeBusinessName } from "../utils/text.js";
import { logger } from "../utils/logger.js";

const SAMPLES = [
  {
    businessName: "Crystal Scents",
    category: "perfume stores",
    city: "Port Harcourt",
    address: "12 Trans Amadi Rd, Port Harcourt",
    phone: "0803 555 0101",
    instagramUsername: "crystal.scents",
    instagramBio: "Luxury fragrances | PH | Nationwide delivery 🚚",
    instagramActive: true,
    strongVisualBrand: true,
    recentPostSummary: "New oud collection launch with gift sets",
    email: "hello@crystalscents.example",
  },
  {
    businessName: "Amara Kitchen & Grill",
    category: "restaurants",
    city: "Lagos",
    address: "4 Admiralty Way, Lekki Phase 1, Lagos",
    phone: "0901 555 0102",
    instagramUsername: "amarakitchen.lagos",
    instagramActive: true,
    recentPostSummary: "Sunday jollof special",
  },
  {
    businessName: "The Pearl Suites",
    category: "hotels",
    city: "Abuja",
    address: "Plot 22, Gwarinpa, Abuja",
    phone: "0805 555 0103",
    businessStatus: "FUTURE_OPENING",
    openingSoon: true,
    email: "reservations@pearlsuites.example",
  },
  {
    businessName: "Glow Haven Beauty",
    category: "salons",
    city: "Lagos",
    address: "18 Opebi Rd, Ikeja, Lagos",
    phone: "0812 555 0104",
    instagramUsername: "glowhaven.ng",
    instagramActive: true,
    strongVisualBrand: true,
    websiteUrl: "https://linktr.ee/glowhaven",
  },
  {
    businessName: "Zaria Threads",
    category: "fashion stores",
    city: "Abuja",
    address: "Wuse 2, Abuja",
    phone: "0703 555 0105",
    instagramUsername: "zariathreads",
    websiteUrl: "https://instagram.com/zariathreads",
  },
  {
    businessName: "Bayview Shortlets",
    category: "shortlet apartments",
    city: "Port Harcourt",
    address: "GRA Phase 2, Port Harcourt",
    phone: "0916 555 0106",
    email: "stay@bayview.example",
  },
];

async function main() {
  await connectDb();
  await getSettings();

  let created = 0;
  for (const s of SAMPLES) {
    const businessNameNormalized = normalizeBusinessName(s.businessName);
    const exists = await Lead.findOne({ businessNameNormalized, city: s.city });
    if (exists) continue;
    const lead = await Lead.create({
      ...s,
      businessNameNormalized,
      discoverySource: "seed",
      searchQuery: `${s.category} in ${s.city}`,
      googlePlaceId: `seed-${businessNameNormalized.replace(/\s+/g, "-")}`,
    });
    await processLead(lead);
    created++;
    logger.info({ business: lead.businessName, stage: lead.pipelineStage, score: lead.leadScore }, "seeded");
  }

  logger.info({ created }, "seed complete, open the dashboard and check the approval queue");
  await disconnectDb();
}

main().catch((err) => {
  logger.error(String(err));
  process.exit(1);
});
