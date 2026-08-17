// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';

/**
 * SPEC.md §6 — while the site lives on the github.io subdomain, `site` is the
 * user domain and `base` is the repo name. Moving to a custom domain later is
 * a two-line change here and nothing else, because every internal link is
 * built through a shared href() helper rather than hardcoded.
 */
export const SITE = 'https://kiarashfa.github.io';
export const BASE = '/Markey';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  // SPEC.md §6/§12 — canonical URLs always end in a slash.
  trailingSlash: 'always',
  // GitHub Pages cannot run a server; static is the only valid output.
  output: 'static',
  integrations: [mdx(), svelte(), sitemap()],
  vite: {
    // Tailwind v4 is a Vite plugin, not an Astro integration (SPEC.md §3).
    plugins: [tailwindcss()],
  },
});
