/**
 * Content Layer API collection definitions — SPEC.md §5.
 *
 * Six collections, three narrative/data pairs. The pairing itself (every
 * `.mdx` having exactly one `.json` sibling and vice versa) is a cross-file
 * property Zod cannot see, so it is enforced by `src/integrations/integrity.ts`
 * at `astro:build:start` (SPEC.md §13).
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

import { brandDataSchema, brandNarrativeSchema } from './schemas/brand.ts';
import { carDataSchema, carNarrativeSchema } from './schemas/car.ts';
import { conceptDataSchema, conceptNarrativeSchema } from './schemas/concept.ts';

const cars = defineCollection({
  loader: glob({ base: './src/content/cars', pattern: '**/*.mdx' }),
  schema: carNarrativeSchema,
});

const carData = defineCollection({
  loader: glob({ base: './src/content/carData', pattern: '**/*.json' }),
  schema: carDataSchema,
});

const concepts = defineCollection({
  loader: glob({ base: './src/content/concepts', pattern: '**/*.mdx' }),
  schema: conceptNarrativeSchema,
});

const conceptData = defineCollection({
  loader: glob({ base: './src/content/conceptData', pattern: '**/*.json' }),
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
