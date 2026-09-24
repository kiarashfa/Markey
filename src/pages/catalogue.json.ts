/**
 * `/catalogue.json` — the machine-readable export.
 *
 * A build artifact generated from the same content the pages render, by the
 * same builder the interactive tools use. That shared origin is the point: an
 * export that drifted from the pages would be worse than no export.
 *
 * It carries a `generated` timestamp and a schema version so a consumer can
 * tell whether what they cached is still current, and so the shape can change
 * later without silently breaking anyone.
 */
import type { APIRoute } from 'astro';

import { buildCatalogue } from '../lib/content/catalogue.ts';

export const prerender = true;

export const GET: APIRoute = async () => {
  const cars = await buildCatalogue();

  const body = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    license:
      'Specification data is derived from sources credited on each entry page, predominantly Wikipedia under CC BY-SA 4.0. Attribution and share-alike apply.',
    count: cars.length,
    cars,
  };

  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
