/**
 * Content Layer API collection definitions.
 *
 * Six collections, three narrative/data pairs. The pairing itself (every
 * `.mdx` having exactly one `.json` sibling and vice versa) is a cross-file
 * property Zod cannot see, so it is enforced by `src/integrations/integrity.ts`
 * at `astro:build:start`.
 */
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import { brandDataSchema, brandNarrativeSchema } from './schemas/brand.ts';
import { carDataSchema, carNarrativeSchema } from './schemas/car.ts';
import { conceptDataSchema, conceptNarrativeSchema } from './schemas/concept.ts';

/**
 * `glob()`, but silent about a collection nobody has authored yet.
 *
 * Astro's glob loader warns on every dev-server start when a pattern matches
 * nothing. For `concepts` that warning is not news — the collection is empty on
 * purpose until Phase 10 authors the first entry — and a warning that fires
 * every single start is how you train yourself to stop reading the log.
 *
 * It only stays quiet for a directory with **no matching files at all**, which
 * is exactly the "not written yet" case. A directory with files in it goes
 * through the real loader and warns about anything wrong with them, and the
 * `.mdx`/`.json` pairing is checked separately by `integrations/integrity.ts`.
 */
function globWhenAuthored(options: { base: string; pattern: string }) {
  const inner = glob(options);
  const extension = path.extname(options.pattern);
  const directory = path.resolve(options.base);

  return {
    ...inner,
    load: async (context: Parameters<typeof inner.load>[0]) => {
      const authored =
        existsSync(directory) && readdirSync(directory).some((file) => file.endsWith(extension));
      if (!authored) {
        context.store.clear();
        return;
      }
      return inner.load(context);
    },
  };
}

const cars = defineCollection({
  loader: glob({ base: './src/content/cars', pattern: '**/*.mdx' }),
  schema: carNarrativeSchema,
});

const carData = defineCollection({
  loader: glob({ base: './src/content/carData', pattern: '**/*.json' }),
  schema: carDataSchema,
});

const concepts = defineCollection({
  loader: globWhenAuthored({ base: './src/content/concepts', pattern: '**/*.mdx' }),
  schema: conceptNarrativeSchema,
});

const conceptData = defineCollection({
  loader: globWhenAuthored({ base: './src/content/conceptData', pattern: '**/*.json' }),
  schema: conceptDataSchema,
});

const brands = defineCollection({
  loader: glob({ base: './src/content/brands', pattern: '**/*.mdx' }),
  schema: brandNarrativeSchema,
});

const brandData = defineCollection({
  loader: glob({ base: './src/content/brandData', pattern: '**/*.json' }),
  schema: brandDataSchema,
});

export const collections = {
  cars,
  carData,
  concepts,
  conceptData,
  brands,
  brandData,
};
