import { config } from "../../config/index.js";
import { logger } from "../../utils/logger.js";
import { sleep } from "../../utils/async.js";
import { AdaptiveRateLimiter, parseRetryAfterMs } from "../../utils/rateLimiter.js";
import type { DiscoveredBusiness } from "../../types.js";

/**
 * Google Places API (New), Text Search.
 * https://developers.google.com/maps/documentation/places/web-service/text-search
 *
 * We use searchText with a field mask limited to what we actually store,
 * which keeps billing on the lower "Text Search (Basic/Advanced)" SKUs.
 */

const PLACES_ENDPOINT = "https://places.googleapis.com/v1/places:searchText";
const DEFAULT_REQUESTS_PER_MINUTE = 60;
const MIN_RATE_LIMIT_COOLDOWN_MS = 60_000;
const RETRY_DELAYS_MS = [5_000, 10_000, 20_000, 40_000];

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
  /** App-wide quota pacing. Defaults to an adaptive 60 requests/minute. */
  requestsPerMinute?: number;
  /** Injectable fetch for testing. */
  fetchImpl?: typeof fetch;
  /** Injectable limiter/sleeper/random source for deterministic tests. */
  rateLimiter?: PlacesRequestLimiter;
  sleepImpl?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface PlacesRequestLimiter {
  waitTurn(requestsPerMinute: number): Promise<void>;
  blockFor(ms: number): void;
  recordSuccess?: () => void;
}

/**
 * Serial app-wide request gate. Every Places HTTP request (including
 * pagination and connection tests) passes through this single queue.
 */
export class PlacesRateLimiter extends AdaptiveRateLimiter implements PlacesRequestLimiter {}

export class PlacesRateLimitError extends Error {
  constructor(public readonly retryAfterMs: number) {
    super("Places API rate limited (429)");
    this.name = "PlacesRateLimitError";
  }
}

const globalPlacesLimiter = new PlacesRateLimiter();

async function requestPlacesPage(
  body: Record<string, unknown>,
  apiKey: string,
  opts: Required<
    Pick<PlacesSearchOptions, "fetchImpl" | "rateLimiter" | "sleepImpl" | "random" | "requestsPerMinute">
  >,
): Promise<PlacesTextSearchResponse> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    await opts.rateLimiter.waitTurn(opts.requestsPerMinute);
    try {
      const res = await opts.fetchImpl(PLACES_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": apiKey,
          "X-Goog-FieldMask": FIELD_MASK,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(20_000),
      });

      if (res.status === 429) {
        const serverDelay = parseRetryAfterMs(res.headers) ?? 0;
        const cooldown = Math.max(MIN_RATE_LIMIT_COOLDOWN_MS, serverDelay);
        opts.rateLimiter.blockFor(cooldown);
        throw new PlacesRateLimitError(cooldown);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        const error = new Error(`Places API error ${res.status}: ${text.slice(0, 300)}`);
        // Retry transient server failures, but fail fast on invalid keys,
        // permissions, malformed requests and other permanent 4xx errors.
        if (res.status < 500) throw Object.assign(error, { permanent: true });
        throw error;
      }
      opts.rateLimiter.recordSuccess?.();
      return (await res.json()) as PlacesTextSearchResponse;
    } catch (err) {
      lastError = err;
      if ((err as { permanent?: boolean })?.permanent || attempt === RETRY_DELAYS_MS.length) throw err;
      const base = RETRY_DELAYS_MS[attempt];
      const jitter = Math.floor(base * 0.25 * opts.random());
      await opts.sleepImpl(base + jitter);
    }
  }

  throw lastError;
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
  const rateLimiter = opts.rateLimiter ?? globalPlacesLimiter;
  const sleepImpl = opts.sleepImpl ?? sleep;
  const random = opts.random ?? Math.random;
  const requestsPerMinute = Math.max(1, Math.min(opts.requestsPerMinute ?? DEFAULT_REQUESTS_PER_MINUTE, 120));
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

    const data = await requestPlacesPage(body, apiKey, {
      fetchImpl,
      rateLimiter,
      sleepImpl,
      random,
      requestsPerMinute,
    });

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
        /*
         * The international form first, because it carries its own country.
         *
         * Places returns both. The national one ("024 123 4567") says nothing
         * about where it is, so reading it depended entirely on recognising the
         * country in the formatted address, and when that failed the number was
         * read as the default: a ten-digit American number came out as
         * +234 4155552671, a Nigerian mobile that does not exist. The
         * international one ("+1 415-555-2671") cannot be misread, and every
         * country Places serves is covered by it.
         */
        phone: place.internationalPhoneNumber ?? place.nationalPhoneNumber,
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
    if (pageToken && results.length < maxResults && pages < 3) await sleepImpl(1_200);
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
