/**
 * `/robots.txt`.
 *
 * Dynamic rather than a file in `public/`, for one reason: the sitemap lives
 * under the base path and at the site origin, and both of those are config. A
 * hand-written `public/robots.txt` would hardcode `https://kiarashfa.github.io`
 * and silently point at nothing the day the site moves to a custom domain —
 * and a wrong `Sitemap:` line fails quietly, which is the worst way for an SEO
 * file to fail.
 *
 * **Nothing is disallowed, and that is deliberate.** `/garage/` holds the
 * visitor's own state and must not be indexed, so it carries `noindex` in its
 * head and is filtered out of the sitemap. Blocking it here would do the
 * opposite of what it looks like: a blocked URL is never fetched, so the
 * `noindex` on it is never read, and it can sit in the index as "fetched but
 * not indexed" indefinitely.
 */
import type { APIRoute } from 'astro';
import { absoluteHref } from '../lib/content/href.ts';

export const GET: APIRoute = ({ site }) => {
  const sitemap = absoluteHref(site, `${import.meta.env.BASE_URL}sitemap-index.xml`);

  const body = `# Markey — https://github.com/kiarashfa/Markey
#
# Nothing here is disallowed. Pages that must not be indexed say so in their
# own <head> instead: a blocked page is never fetched, so a noindex on it is
# never seen. See /about/ for what this site is.

User-agent: *
Allow: /

Sitemap: ${sitemap}
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
