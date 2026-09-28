import type { APIRoute } from 'astro';

import { buildCatalogue, toIndexRow } from '../lib/content/catalogue.ts';

/**
 * The light catalogue the `/cars/` page filters: one small row per entry, no
 * trims. The full, public export stays at `/catalogue.json`.
 */
export const prerender = true;

export const GET: APIRoute = async () => {
  const cars = await buildCatalogue();
  return new Response(JSON.stringify(cars.map(toIndexRow)), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
