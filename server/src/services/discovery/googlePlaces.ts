import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { sleep, withRetry } from "../../utils/async.js";
import type { DiscoveredBusiness } from "../../types.js";

/**
 * Google Places API (New), Text Search.
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * We use searchText with a field mask limited to what we actually store,
 * which keeps billing on the lower "Text Search (Basic/Advanced)" SKUs.
 */

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.businessStatus",
  "places.websiteUri",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.googleMapsUri",
  "places.types",
  "places.primaryTypeDisplayName",
  "places.rating",
  "places.userRatingCount",
  "nextPageToken",
].join(",");

interface PlacesTextSearchResponse {
  places?: RawPlace[];
  nextPageToken?: string;
  error?: { code: number; message: string; status: string };
}

interface RawPlace {
  id: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  location?: { latitude?: number; longitude?: number };
  businessStatus?: string;
  websiteUri?: string;
  nationalPhoneNumber?: string;
  internationalPhoneNumber?: string;
  googleMapsUri?: string;
  types?: string[];
  primaryTypeDisplayName?: { text?: string };
  rating?: number;
  userRatingCount?: number;
}

/** Statuses Google may report; anything indicating a future opening scores as "opening soon". */
const OPENING_SOON_STATUSES = new Set(["FUTURE_OPENING", "OPENING_SOON"]);
const SKIP_STATUSES = new Set(["CLOSED_PERMANENTLY", "CLOSED_TEMPORARILY"]);

export interface PlacesSearchOptions {
  /** Total results wanted (each page returns up to 20; API caps at 60). */
  maxResults?: number;
  apiKey?: string;
  /** Injectable fetch for testing. */
  fetchImpl?: typeof fetch;
}

export async function searchPlaces(
  query: string,
  city: string,
  category: string,
  opts: PlacesSearchOptions = {},
): Promise<DiscoveredBusiness[]> {
  const apiKey = opts.apiKey ?? config.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_PLACES_API_KEY is not configured, cannot run discovery.");
  }
  const fetchImpl = opts.fetchImpl ?? fetch;
  const maxResults = Math.min(opts.maxResults ?? 60, 60);

  const results: DiscoveredBusiness[] = [];
  let pageToken: string | undefined;
  let pages = 0;

  do {
    const body: Record<string, unknown> = {
      textQuery: query,
      pageSize: 20,
      ...(pageToken ? { pageToken } : {}),
    };

    const data = await withRetry(
      async () => {
        const res = await fetchImpl(PLACES_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": apiKey,
            "X-Goog-FieldMask": FIELD_MASK,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
        if (res.status === 429) throw new Error("Places API rate limited (429)");
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Places API error ${res.status}: ${text.slice(0, 300)}`);
        }
        return (await res.json()) as PlacesTextSearchResponse;
      },
      { retries: 2, baseDelayMs: 2000, label: "places-search" },
    );

    for (const place of data.places ?? []) {
      const name = place.displayName?.text?.trim();
      if (!name || !place.id) continue;
      if (place.businessStatus && SKIP_STATUSES.has(place.businessStatus)) continue;

      results.push({
        googlePlaceId: place.id,
        businessName: name,
        category,
        categoryRaw: place.types ?? [],
        city,
        address: place.formattedAddress,
        location:
          place.location?.latitude != null && place.location?.longitude != null
            ? { lat: place.location.latitude, lng: place.location.longitude }
            : undefined,
        phone: place.nationalPhoneNumber ?? place.internationalPhoneNumber,
        internationalPhone: place.internationalPhoneNumber,
        websiteUrl: place.websiteUri,
        googleMapsUrl: place.googleMapsUri,
        businessStatus: place.businessStatus,
        openingSoon: place.businessStatus ? OPENING_SOON_STATUSES.has(place.businessStatus) : false,
        rating: place.rating,
        userRatingCount: place.userRatingCount,
        searchQuery: query,
      });
      if (results.length >= maxResults) break;
    }

    pageToken = data.nextPageToken;
    pages += 1;
    // Places asks for a short delay before using a page token.
    if (pageToken && results.length < maxResults && pages < 3) await sleep(1200);
  } while (pageToken && results.length < maxResults && pages < 3);

  logger.info({ query, found: results.length }, "Places search complete");
  return results;
}

/** Builds the query list from settings: one query per city x category. */
export function buildQueries(cities: string[], categories: string[]): Array<{ query: string; city: string; category: string }> {
  const out: Array<{ query: string; city: string; category: string }> = [];
  for (const city of cities) {
    for (const category of categories) {
      out.push({ query: `${category} in ${city}`, city, category });
    }
  }
  return out;
}
