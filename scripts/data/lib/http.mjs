/**
 * The one place that talks to the network.
 *
 * Every remote call the authoring pipeline makes goes through here, for three
 * reasons Phase 10 found the hard way:
 *
 *  - **Wikimedia rate-limits.** Sixteen consecutive image downloads returned
 *    HTTP 429 even with a proper User-Agent. A per-host delay and a backoff on
 *    429 are not optional at batch scale.
 *  - **A descriptive User-Agent is a condition of use** of the Wikimedia APIs,
 *    and an anonymous one gets throttled harder.
 *  - A failed fetch must be loud. A silent empty result becomes a missing
 *    figure, and a missing figure that should have been sourced is exactly the
 *    kind of quiet wrongness this project exists to avoid.
 */

/** Contact details are part of the Wikimedia UA policy, not decoration. */
export const USER_AGENT =
  'MarkeyEncyclopedia/0.1 (https://kiarashfa.github.io/Markey/; kiarashfa@gmail.com)';

/** Minimum gap between requests to the same host, milliseconds. */
const HOST_DELAY_MS = {
  'upload.wikimedia.org': 1100,
  'commons.wikimedia.org': 400,
  'en.wikipedia.org': 400,
  'www.wikidata.org': 400,
  'query.wikidata.org': 1000,
  default: 300,
};

const lastCallAt = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForTurn(host) {
  const delay = HOST_DELAY_MS[host] ?? HOST_DELAY_MS.default;
  const previous = lastCallAt.get(host) ?? 0;
  const wait = previous + delay - Date.now();
  if (wait > 0) await sleep(wait);
  lastCallAt.set(host, Date.now());
}

/**
 * Fetch with throttling, a real User-Agent, and backoff on 429/5xx.
 *
 * Returns the `Response`. Throws on a status that is still failing after the
 * retries, because at that point the caller cannot produce honest data and
 * should stop rather than write a gap it did not mean.
 */
export async function get(url, { accept, retries = 3, timeoutMs = 60000 } = {}) {
  const host = new URL(url).host;
  for (let attempt = 0; ; attempt += 1) {
    await waitForTurn(host);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, ...(accept ? { Accept: accept } : {}) },
        signal: controller.signal,
        redirect: 'follow',
      });
    } catch (error) {
      if (attempt >= retries) throw new Error(`GET ${url} failed: ${error.message}`);
      await sleep(2000 * (attempt + 1));
      continue;
    } finally {
      clearTimeout(timer);
    }

    // 429 and 5xx are worth waiting out; everything else is a real answer.
    if ((response.status === 429 || response.status >= 500) && attempt < retries) {
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 3000 * (attempt + 1));
      continue;
    }
    if (!response.ok) throw new Error(`GET ${url} → HTTP ${response.status}`);
    return response;
  }
}

export async function getJson(url, options) {
  const response = await get(url, { accept: 'application/json', ...options });
  return response.json();
}

export async function getText(url, options) {
  const response = await get(url, options);
  return response.text();
}

/** Builds a query string without the double-encoding traps of manual joins. */
export function withQuery(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  }
  return url.toString();
}
