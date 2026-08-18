// @ts-check
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

import integrity from './src/integrations/integrity.ts';
import rehypeCrosslink from './src/integrations/rehype-crosslink.ts';

/**
 * SPEC.md §6 — while the site lives on the github.io subdomain, `site` is the
 * user domain and `base` is the repo name. Moving to a custom domain later is
 * a two-line change here and nothing else, because every internal link is
 * built through a shared href() helper rather than hardcoded.
 */
export const SITE = 'https://kiarashfa.github.io';
export const BASE = '/Markey';

/**
 * Paths kept out of the sitemap — SPEC.md §12.
 *
 * These are the pages that carry the visitor's own state. They are `noindex`
 * in the document head and they are **not** disallowed in `robots.txt`, which
 * is the whole point: a blocked page is never fetched, so the `noindex` on it
 * is never read, and it can sit in the index as "fetched but not indexed"
 * forever. Excluding them here removes the invitation without removing the
 * instruction.
 *
 * Exported so `check-site.mjs` asserts against this list rather than a second
 * copy of it that could drift.
 */
export const NOINDEX_PATHS = ['/garage/'];

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  // SPEC.md §6/§12 — canonical URLs always end in a slash.
  trailingSlash: 'always',
  // GitHub Pages cannot run a server; static is the only valid output.
  output: 'static',
  // `integrity` first: SPEC.md §13 wants the build to stop on bad content
  // before anything else has spent time on it.
  integrations: [
    integrity(),
    mdx(),
    svelte(),
    sitemap({
      filter: (page) => !NOINDEX_PATHS.some((path) => new URL(page).pathname === `${BASE}${path}`),
    }),
  ],
  markdown: {
    /**
     * SPEC.md §12 — internal link density without manual upkeep. Every prose
     * mention of another entry becomes a link to it, derived from the content
     * files rather than typed, so it survives a rename. `@astrojs/mdx` extends
     * this config by default, which is why it is set once here and not twice.
     */
    rehypePlugins: [
      [
        rehypeCrosslink,
        { contentRoot: fileURLToPath(new URL('./src/content', import.meta.url)), base: BASE },
      ],
    ],
  },
  vite: {
    // Tailwind v4 is a Vite plugin, not an Astro integration (SPEC.md §3).
    plugins: [tailwindcss()],
  },
});
