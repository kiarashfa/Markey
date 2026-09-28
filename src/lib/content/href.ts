/**
 * Base-path-safe URL construction.
 *
 * The site lives at `/Markey/` on github.io today and may live at `/` on a
 * custom domain later. Every internal link goes through here so that migration
 * is a config change and nothing else, and so no link can be written that
 * silently drops the base path and 404s only in production.
 */

const BASE = import.meta.env.BASE_URL;

/**
 * Where images are served from. Empty means "this repository", which is the
 * case today and the case this site should stay in for as long as it fits.
 *
 * The escape hatch, pre-planned rather than retrofitted. Even at the WebP caps
 * in `src/data/image-caps.json`, the full 8,102-nameplate plan projects to
 * ~2.9 GB against GitHub Pages' 1 GB soft limit, so a second assets repository
 * is eventually unavoidable. Setting this constant to that repository's origin
 * moves every image on the site — because `imageSrc()` is the only thing that
 * resolves an `ImageRef.src`, and every template goes through it.
 *
 * Written now, with 41 images, because the alternative is 3,000 JSON edits
 * later.
 */
const ASSET_ORIGIN: string = '';

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

/**
 * An `ImageRef.src` resolved for use in `<img src>`.
 *
 * Images live in `public/` and are stored with a root-relative path, so they
 * need the base prefix — the exact class of link that works in dev and 404s
 * only once deployed under `/Markey/`. A remote URL is passed through
 * untouched, which is the escape hatch for a source we genuinely cannot
 * mirror.
 */
export function imageSrc(src: string): string {
  if (/^(https?:)?\/\//.test(src) || src.startsWith('data:')) return src;
  if (ASSET_ORIGIN) return `${ASSET_ORIGIN.replace(/\/+$/, '')}/${trimSlashes(src)}`;
  return assetHref(src);
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
 * name — these seven paths are fixed.
 */
export const taxonomyHref = (axis: string, term?: string) =>
  term ? href(axis, term) : href(axis);
