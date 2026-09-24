/**
 * The `concepts` collection.
 *
 * Structurally separate from `cars` because concept cars and prototypes
 * genuinely need different fields: no trims, no market variants, no MSRP. A
 * lighter content type, at its own flat URL (`/concepts/<slug>/`), never nested
 * under `/cars/`.
 */
import { z } from 'zod';

import {
  dimensions,
  imageRef,
  propertyValue,
  slug,
  trustFields,
  year,
} from './primitives.ts';
import {
  bodyStyleTag,
  drivetrainTag,
  positioningTag,
  powertrainTag,
  segmentTag,
} from './taxonomy.ts';

export const conceptNarrativeSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
  })
  .strict();
export type ConceptNarrative = z.infer<typeof conceptNarrativeSchema>;

export const conceptFate = z.enum([
  'production',
  'one-off-surviving',
  'destroyed',
  'unknown',
]);
export type ConceptFate = z.infer<typeof conceptFate>;

export const conceptDataSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    brandRef: slug,

    /** Event or show it was first shown at. */
    unveiledAt: z.string().min(1),
    unveiledYear: year,
    designer: z.string().optional(),
    fate: conceptFate,
    /** Car entry id, if it led to a production model. Checked cross-file. */
    relatedProductionCar: slug.optional(),

    bodyStyles: z.array(bodyStyleTag).default([]),
    powertrains: z.array(powertrainTag).default([]),
    drivetrains: z.array(drivetrainTag).default([]),
    segment: segmentTag.optional(),
    positioning: positioningTag.optional(),

    /**
     * Concept figures are frequently manufacturer claims that were never
     * independently tested. They are optional, and `PropertyValue.status` plus
     * `sourceNote` is where that distinction gets recorded.
     */
    power: propertyValue('kW').optional(),
    torque: propertyValue('Nm').optional(),
    mass: propertyValue('kg').optional(),
    topSpeed: propertyValue('km/h').optional(),
    zeroToHundredKph: propertyValue('s').optional(),
    dragCoefficient: propertyValue('').optional(),
    frontalArea: propertyValue('m2').optional(),
    dimensions: dimensions.optional(),

    hero: imageRef.optional(),
    gallery: z.array(imageRef).default([]),
    spotlight: z.boolean().default(false),

    ...trustFields,
  })
  .superRefine((concept, ctx) => {
    if (concept.fate === 'production' && !concept.relatedProductionCar) {
      ctx.addIssue({
        code: 'custom',
        path: ['relatedProductionCar'],
        message:
          "fate 'production' means it led to a production car — name it in `relatedProductionCar` so the link is real rather than asserted",
      });
    }
    if (concept.fate !== 'production' && concept.relatedProductionCar) {
      ctx.addIssue({
        code: 'custom',
        path: ['fate'],
        message:
          "`relatedProductionCar` is set, so `fate` should be 'production' — otherwise the two fields contradict each other",
      });
    }
  });

export type ConceptData = z.infer<typeof conceptDataSchema>;
