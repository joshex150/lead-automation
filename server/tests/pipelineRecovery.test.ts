import { describe, expect, it } from "vitest";
import { SearchRun } from "../src/models/SearchRun.js";
import { recoverableQueriesForRun } from "../src/services/pipeline/runPipeline.js";

describe("discovery run recovery", () => {
  it("returns failed and unattempted queries but never repeats successes", () => {
    const run = new SearchRun({
      plannedQueries: [
        { query: "restaurants in Accra", city: "Accra", category: "restaurants" },
        { query: "salons in Accra", city: "Accra", category: "salons" },
        { query: "hotels in Accra", city: "Accra", category: "hotels" },
      ],
      queries: [
        {
          query: "restaurants in Accra",
          city: "Accra",
          category: "restaurants",
          found: 20,
          created: 20,
          duplicates: 0,
          suppressed: 0,
        },
        {
          query: "salons in Accra",
          city: "Accra",
          category: "salons",
          found: 0,
          created: 0,
          duplicates: 0,
          suppressed: 0,
          error: "Places API rate limited (429)",
        },
      ],
    });

    expect(recoverableQueriesForRun(run).map((query) => query.query)).toEqual([
      "salons in Accra",
      "hotels in Accra",
    ]);
  });

  it("supports legacy runs that did not persist a separate query plan", () => {
    const run = new SearchRun({
      plannedQueries: [],
      queries: [
        {
          query: "restaurants in Kigali",
          city: "Kigali",
          category: "restaurants",
          found: 20,
          created: 20,
          duplicates: 0,
          suppressed: 0,
        },
        {
          query: "salons in Kigali",
          city: "Kigali",
          category: "salons",
          found: 0,
          created: 0,
          duplicates: 0,
          suppressed: 0,
          error: "Places API rate limited (429)",
        },
      ],
    });

    expect(recoverableQueriesForRun(run).map((query) => query.query)).toEqual(["salons in Kigali"]);
  });
});

/*
 * The bar is one number for the whole job. It used to be drawn from
 * current/total, which counts queries in one phase and leads in the next, so a
 * full scan ran to 100% on the queries and then dropped to 0% and started
 * again, which reads as the scan restarting itself.
 */
describe("progress is one monotonic number across the phases", () => {
  it("never lets a full scan's bar fall back when the phase changes", () => {
    const weights = { discovery: 0.25, processing: 0.75 };
    let reported = 0;
    const percentOf = (phase: "discovery" | "processing", current: number, total: number): number => {
      const share = total > 0 ? Math.min(1, Math.max(0, current / total)) : 0;
      const base = phase === "processing" ? weights.discovery : 0;
      reported = Math.max(reported, Math.min(99, Math.round((base + share * weights[phase]) * 100)));
      return reported;
    };

    const seen: number[] = [];
    // Discovery runs to the end of its share.
    for (let q = 0; q <= 18; q++) seen.push(percentOf("discovery", q, 18));
    expect(seen[seen.length - 1]).toBe(25);

    // Processing starts where discovery finished, not at zero.
    seen.push(percentOf("processing", 0, 356));
    expect(seen[seen.length - 1]).toBe(25);

    for (let l = 0; l <= 356; l += 89) seen.push(percentOf("processing", l, 356));
    // Drafting enlarges the denominator mid-phase; the bar must hold, not drop.
    seen.push(percentOf("processing", 356, 512));

    for (let i = 1; i < seen.length; i++) expect(seen[i]).toBeGreaterThanOrEqual(seen[i - 1]);
    // And it never claims to be finished while it is still going.
    expect(Math.max(...seen)).toBeLessThanOrEqual(99);
  });

  it("gives a processing-only job the whole bar", () => {
    const weights = { discovery: 0, processing: 1 };
    const share = 178 / 356;
    expect(Math.round((0 + share * weights.processing) * 100)).toBe(50);
  });
});
