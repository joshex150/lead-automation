import dns from "node:dns/promises";
import { performance } from "node:perf_hooks";
import { config } from "../../config/index.js";
import { extractDomain } from "../../utils/url.js";

/**
 * Low-level network probe: DNS → HTTP(S) with manual redirect following.
 * Captures everything the classifier needs: status, timing, redirect chain,
 * TLS validity, response headers and (for HTML responses) the body.
 */

export interface ProbeResult {
  inputUrl: string;
  finalUrl: string | null;
  domain: string | null;
  dnsResolved: boolean;
  sslValid: boolean;
  sslError: string | null;
  httpStatus: number | null;
  responseTimeMs: number | null;
  redirectChain: string[];
  redirectLoop: boolean;
  reachable: boolean;
  headers: Record<string, string>;
  html: string | null;
  contentType: string | null;
  error: string | null;
}

const MAX_HTML_BYTES = 2_000_000; // 2MB cap, enough for any homepage head/body signals
const UA =
  "Mozilla/5.0 (compatible; YEANLeadBot/1.0; website health check; +https://yean.tech)";

function isTlsError(err: unknown): string | null {
  const message = err instanceof Error ? `${err.message} ${(err.cause as Error | undefined)?.message ?? ""}` : String(err);
  const code =
    (err as { cause?: { code?: string } })?.cause?.code ?? (err as { code?: string })?.code ?? "";
  const tlsCodes = [
    "CERT_HAS_EXPIRED",
    "DEPTH_ZERO_SELF_SIGNED_CERT",
    "SELF_SIGNED_CERT_IN_CHAIN",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    "ERR_TLS_CERT_ALTNAME_INVALID",
    "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
    "ERR_SSL_WRONG_VERSION_NUMBER",
    "EPROTO",
  ];
  if (tlsCodes.includes(code)) return code;
  if (/certificate|ssl|tls/i.test(message)) return message.slice(0, 200);
  return null;
}

async function readBodyCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  await reader.cancel().catch(() => undefined);
  return Buffer.concat(chunks).toString("utf8");
}

export async function probeUrl(inputUrl: string, opts: { timeoutMs?: number; maxRedirects?: number } = {}): Promise<ProbeResult> {
  const timeoutMs = opts.timeoutMs ?? config.CHECKER_TIMEOUT_MS;
  const maxRedirects = opts.maxRedirects ?? config.CHECKER_MAX_REDIRECTS;

  const result: ProbeResult = {
    inputUrl,
    finalUrl: null,
    domain: extractDomain(inputUrl),
    dnsResolved: false,
    sslValid: false,
    sslError: null,
    httpStatus: null,
    responseTimeMs: null,
    redirectChain: [],
    redirectLoop: false,
    reachable: false,
    headers: {},
    html: null,
    contentType: null,
    error: null,
  };

  // 1) DNS
  const hostname = (() => {
    try {
      return new URL(inputUrl).hostname;
    } catch {
      return null;
    }
  })();
  if (!hostname) {
    result.error = "INVALID_URL";
    return result;
  }
  try {
    await dns.lookup(hostname);
    result.dnsResolved = true;
  } catch {
    result.error = "DNS_FAILURE";
    return result;
  }

  // 2) HTTP with manual redirect following so we can detect loops and
  //    "redirects straight to Instagram/WhatsApp" cases.
  const visited = new Set<string>();
  let currentUrl = inputUrl;
  let triedHttpFallback = false;
  const started = performance.now();

  for (let hop = 0; hop <= maxRedirects; hop++) {
    if (visited.has(currentUrl)) {
      result.redirectLoop = true;
      result.error = "REDIRECT_LOOP";
      result.responseTimeMs = Math.round(performance.now() - started);
      return result;
    }
    visited.add(currentUrl);

    let res: Response;
    try {
      res = await fetch(currentUrl, {
        method: "GET",
        redirect: "manual",
        headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const tls = isTlsError(err);
      if (tls && currentUrl.startsWith("https://") && !triedHttpFallback) {
        // Site has broken TLS but might still serve over plain HTTP.
        result.sslError = tls;
        triedHttpFallback = true;
        currentUrl = currentUrl.replace(/^https:/, "http:");
        continue;
      }
      result.responseTimeMs = Math.round(performance.now() - started);
      if (tls) {
        result.sslError = result.sslError ?? tls;
        result.error = "SSL_FAILURE";
      } else if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError")) {
        result.error = "CONNECTION_TIMEOUT";
      } else {
        result.error = `CONNECTION_ERROR: ${err instanceof Error ? err.message.slice(0, 150) : String(err)}`;
      }
      return result;
    }

    // Redirect?
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      res.body?.cancel().catch(() => undefined);
      if (!loc) {
        result.httpStatus = res.status;
        result.error = "REDIRECT_WITHOUT_LOCATION";
        result.responseTimeMs = Math.round(performance.now() - started);
        return result;
      }
      const nextUrl = new URL(loc, currentUrl).toString();
      result.redirectChain.push(nextUrl);
      currentUrl = nextUrl;
      if (hop === maxRedirects) {
        result.redirectLoop = true;
        result.error = "TOO_MANY_REDIRECTS";
        result.responseTimeMs = Math.round(performance.now() - started);
        return result;
      }
      continue;
    }

    // Terminal response
    result.responseTimeMs = Math.round(performance.now() - started);
    result.httpStatus = res.status;
    result.finalUrl = currentUrl;
    result.domain = extractDomain(currentUrl);
    result.reachable = true;
    result.sslValid = currentUrl.startsWith("https://") && !result.sslError;
    res.headers.forEach((v, k) => {
      result.headers[k.toLowerCase()] = v;
    });
    result.contentType = res.headers.get("content-type");

    if (res.ok && /text\/html|application\/xhtml/i.test(result.contentType ?? "")) {
      try {
        result.html = await readBodyCapped(res);
      } catch {
        result.html = null;
      }
    } else {
      res.body?.cancel().catch(() => undefined);
    }
    return result;
  }

  result.error = "TOO_MANY_REDIRECTS";
  result.redirectLoop = true;
  result.responseTimeMs = Math.round(performance.now() - started);
  return result;
}

/** HEAD-checks a URL, returns HTTP status or null on network failure. */
export async function quickStatus(url: string, timeoutMs = 8000): Promise<number | null> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(timeoutMs),
    });
    res.body?.cancel().catch(() => undefined);
    return res.status;
  } catch {
    return null;
  }
}
