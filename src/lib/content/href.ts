/**
 * Base-path-safe URL construction — SPEC.md §6.
 *
 * The site lives at `/Markey/` on github.io today and may live at `/` on a
 * custom domain later. Every internal link goes through here so that migration
 * is a config change and nothing else, and so no link can be written that
 * silently drops the base path and 404s only in production.
 */

const BASE = import.meta.env.BASE_URL;

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, '').replace(/\/+$/, '');
}

/**
 * A page URL, always ending in a slash (`trailingSlash: 'always'`).
 *
 *   href()                        → '/Markey/'
 *   href('cars', 'bmw-6-series')  → '/Markey/cars/bmw-6-series/'
 */
export function href(...segments: (string | number)[]): string {
  const base = trimSlashes(BASE);
  const parts = segments
    .map((s) => trimSlashes(String(s)))
    .filter((s) => s.length > 0);
  const all = [base, ...parts].filter((s) => s.length > 0);
  return `/${all.join('/')}/`.replace(/\/{2,}/g, '/');
}

/**
 * A non-page URL — an asset, a JSON export, `robots.txt`. Same base handling,
 * but no trailing slash, because a file is not a directory.
 */
export function assetHref(...segments: (string | number)[]): string {
  const base = trimSlashes(BASE);
  const parts = segments
    .map((s) => trimSlashes(String(s)))
    .filter((s) => s.length > 0);
  const all = [base, ...parts].filter((s) => s.length > 0);
  return `/${all.join('/')}`.replace(/\/{2,}/g, '/');
}

/** Absolute URL, for canonicals, JSON-LD and the sitemap. */
export function absoluteHref(site: URL | undefined, path: string): string {
  if (!site) return path;
  return new URL(path, site).toString();
}

export const carHref = (id: string) => href('cars', id);
export const testDriveHref = (id: string) => href('cars', id, 'test-drive');
export const conceptHref = (id: string) => href('concepts', id);
export const brandHref = (id: string) => href('brands', id);

/**
 * A taxonomy page. `axis` is the vocabulary's `urlPrefix`, not its display
 * name — SPEC.md §6 fixes these seven paths.
 */
export const taxonomyHref = (axis: string, term?: string) =>
  term ? href(axis, term) : href(axis);
