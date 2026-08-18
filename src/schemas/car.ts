/**
 * The `cars` collection — SPEC.md §5.1 and §5.2.
 *
 * One flat, self-referencing hierarchy: model hub → generation → halo trim,
 * all three living in the same collection and discriminated by `kind` +
 * `parent`. That discriminator is the load-bearing piece of the whole content
 * model, so the rules around it are enforced here (shape) and in
 * `src/integrations/integrity-checks.ts` (cross-file resolution).
 *
 * Two files per entry, joined by `id`, never merged:
 *   - `src/content/cars/<slug>.mdx`      → narrative, identity frontmatter only
 *   - `src/content/carData/<slug>.json`  → the full structured spec
 */
import { z } from 'zod';

import {
  dimensions,
  imageRef,
  propertyValue,
  slug,
  trustFields,
  valueStatus,
  year,
  yearRange,
} from './primitives.ts';
import {
  bodyStyleTag,
  drivetrainTag,
  positioningTag,
  powertrainTag,
  segmentTag,
} from './taxonomy.ts';

export const carKind = z.enum(['model', 'generation', 'trim']);
export type CarKind = z.infer<typeof carKind>;

// ---------------------------------------------------------------------------
// Narrative frontmatter — src/content/cars/<slug>.mdx
// ---------------------------------------------------------------------------

/**
 * Identity essentials only (SPEC.md §5.1). `.strict()` is deliberate: it makes
 * the two-file discipline self-enforcing, so spec data can never start
 * drifting into the narrative file where nothing validates it.
 */
export const carNarrativeSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    kind: carKind,
    parent: slug.nullable(),
  })
  .strict();
export type CarNarrative = z.infer<typeof carNarrativeSchema>;

// ---------------------------------------------------------------------------
// Trim shape — SPEC.md §5.2
// ---------------------------------------------------------------------------

export const engineSpec = z.object({
  /** Manufacturer engine code where one exists, e.g. `M88/3`. */
  code: z.string().optional(),
  /** e.g. 'inline-6', 'V8', 'flat-6', 'single motor', 'dual motor'. */
  configuration: z.string().optional(),
  cylinders: z.number().int().positive().optional(),
  displacement: propertyValue('cc').optional(),
  aspiration: z
    .enum([
      'naturally-aspirated',
      'turbocharged',
      'supercharged',
      'twincharged',
      'electric',
    ])
    .optional(),
});
export type EngineSpec = z.infer<typeof engineSpec>;

/**
 * A price as actually published in one market at one time.
 *
 * Not a `PropertyValue`: money is not an SI quantity and carries a currency and
 * a market that a unit enum can't express. It exists because `depreciation.ts`
 * (SPEC.md §8.1) needs an original price to decay from — and because SPEC.md
 * §5.3 defines concepts as the collection *without* an MSRP, which implies
 * production cars have one.
 */
export const priceRecord = z.object({
  amount: z.number().nonnegative().nullable(),
  /** ISO 4217, uppercase. */
  currency: z.string().regex(/^[A-Z]{3}$/),
  /** Market the price applied in, e.g. 'US', 'DE', 'UK'. */
  market: z.string().min(1),
  /** The year this price was current — prices are not comparable across years. */
  year,
  status: valueStatus,
  source: slug.optional(),
  sourceUrl: z.url().optional(),
  sourceNote: z.string().min(1).optional(),
});
export type PriceRecord = z.infer<typeof priceRecord>;

/**
 * Everything about a trim except its market variants.
 *
 * Split out so `marketVariants[].overrides` can be typed as a partial of
 * exactly this shape — the delta-override pattern of SPEC.md §5.2, where a US
 * detune or a JDM compliance variant is authored as *only what changed*.
 */
const trimCore = z.object({
  id: slug,
  name: z.string().min(1),
  productionYears: yearRange,

  engine: engineSpec.optional(),
  transmission: z.string().optional(),
  /** Number of forward gears — feeds the §8.2 in-gear acceleration model. */
  gears: z.number().int().positive().optional(),
  drivetrain: drivetrainTag,
  powertrain: powertrainTag,

  power: propertyValue('kW').optional(),
  torque: propertyValue('Nm').optional(),
  mass: propertyValue('kg').optional(),
  zeroToHundredKph: propertyValue('s').optional(),
  topSpeed: propertyValue('km/h').optional(),

  fuelEconomy: propertyValue('L/100km').optional(),
  electricConsumption: propertyValue('kWh/100km').optional(),
  batteryCapacity: propertyValue('kWh').optional(),
  electricRange: propertyValue('km').optional(),
  co2: propertyValue('g/km').optional(),

  /**
   * Vehicle-dynamics inputs — SPEC.md §8.2. `dragCoefficient` is the one
   * genuinely new authoring field; `frontalArea` is published where known and
   * otherwise estimated (~0.85 x width x height) with status 'estimated', which
   * `primitives.ts` already forces to carry an explaining `sourceNote`.
   */
  dragCoefficient: propertyValue('').optional(),
  frontalArea: propertyValue('m2').optional(),
  /** Tyre grip coefficient, where a defensible figure exists for this car. */
  tyreGrip: propertyValue('').optional(),
  /**
   * Fraction of the car's mass carried by the **front** axle at rest, 0–1.
   *
   * `dynamics/constants.ts` says outright that its `DRIVEN_AXLE_WEIGHT_FRACTION`
   * table holds "the conventional layout averages, and any car whose real
   * distribution is known should override them rather than rely on this". This
   * is that override: the traction-limited phase of a standing start depends
   * directly on how much weight sits over the driven wheels, and a 60/40 car
   * launches differently from the 62/38 the model assumes for front-drive.
   *
   * Sourceable: NHTSA's Canadian Vehicle Specifications publishes it as `WD`
   * (e.g. `60/40`, front/rear) for cars back to 1971 — see DATA_SOURCES.md's
   * 2026-08-18 addendum. Store the front figure as a fraction: 60/40 → 0.60.
   */
  weightDistributionFront: propertyValue('').optional(),

  /**
   * Practicality — SPEC.md §8.1's Markey Score and §9.3's Matchmaker both
   * read these, and until Phase 10 nothing in the schema could supply them:
   * `score.ts` takes `bootLitres`, `matchmaker.ts` takes `seats` for the
   * `minSeats` dealbreaker, and both islands were passing a hardcoded `null`.
   *
   * Sourceable at scale, which is why they were added rather than dropped:
   * EPA's public-domain vehicle record publishes luggage volume in cubic feet
   * (`lv4` for a saloon, `hlv` for a hatch) for US-market cars from 1984, and
   * seat count is stated in the body of most generation articles.
   *
   * **Boot figures are not internationally comparable** — EPA measures a
   * hatchback's load space to the roof, the European VDA figure measures to
   * the parcel shelf, and the two differ by a large factor on the same car.
   * The measurement basis therefore belongs in `sourceNote` on every entry,
   * the same discipline `frontalArea` already carries.
   */
  seats: z.number().int().positive().max(12).optional(),
  bootVolume: propertyValue('L').optional(),

  /** Only where it differs from the generation default. */
  dimensions: dimensions.optional(),
  prices: z.array(priceRecord).default([]),
});

export const marketVariant = z.object({
  /** e.g. 'US', 'EU', 'JP'. */
  market: z.string().min(1),
  /** Name used in that market, if different. */
  alsoKnownAs: z.string().optional(),
  /**
   * ONLY the fields that differ — the delta pattern (SPEC.md §5.2).
   *
   * Defaults to empty: plenty of market variants differ by name alone (the
   * same car sold as a GT86, an FR-S and a BRZ), and forcing an author to
   * write `"overrides": {}` to say "nothing differs" is friction with no
   * safety benefit.
   */
  overrides: trimCore.omit({ id: true }).partial().default({}),
});
export type MarketVariant = z.infer<typeof marketVariant>;

export const trimSpec = trimCore.extend({
  marketVariants: z.array(marketVariant).default([]),
});
export type TrimSpec = z.infer<typeof trimSpec>;

// ---------------------------------------------------------------------------
// Structured data — src/content/carData/<slug>.json
// ---------------------------------------------------------------------------

export const carDataSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    /** Disambiguated title where `name` alone is ambiguous in a list. */
    fullName: z.string().optional(),
    kind: carKind,
    /** id of the parent entry; null only for kind 'model'. */
    parent: slug.nullable(),
    /** Brand id — the Origin taxonomy axis resolves through this. */
    brandRef: slug,

    /** Manufacturer generation code where one exists, e.g. 'E24'. */
    generationCode: z.string().optional(),
    /**
     * Self-reference marking this entry as a facelift of another generation
     * under the same model hub (SPEC.md §5.1) — no separate modelling concept
     * for facelifts, just another `generation` with the same parent.
     */
    revisionOf: slug.optional(),
    predecessor: slug.optional(),
    successor: slug.optional(),

    productionYears: yearRange,

    /**
     * Authored taxonomy tags. Required on generations and halo trims; on a
     * model hub they are optional and computed by aggregating its generations,
     * so a nameplate's 40-year span is never hand-maintained in two places.
     */
    bodyStyles: z.array(bodyStyleTag).default([]),
    powertrains: z.array(powertrainTag).default([]),
    drivetrains: z.array(drivetrainTag).default([]),
    segment: segmentTag.optional(),
    positioning: positioningTag.optional(),

    dimensions: dimensions.optional(),
    designer: z.string().optional(),
    assembly: z.array(z.string()).default([]),

    trims: z.array(trimSpec).default([]),

    hero: imageRef.optional(),
    gallery: z.array(imageRef).default([]),

    /** Eligible for the homepage spotlight carousel (SPEC.md §11.1). */
    spotlight: z.boolean().default(false),

    ...trustFields,
  })
  .superRefine((car, ctx) => {
    // --- the kind/parent discriminator (SPEC.md §5.1) ------------------------
    if (car.kind === 'model' && car.parent !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['parent'],
        message: "kind 'model' is a nameplate hub and must have `parent: null`",
      });
    }
    if (car.kind !== 'model' && car.parent === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['parent'],
        message: `kind '${car.kind}' must name a parent — only a model hub may be parentless`,
      });
    }
    if (car.parent === car.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['parent'],
        message: 'an entry cannot be its own parent',
      });
    }

    // A facelift is a generation. Nothing else may claim to revise one.
    if (car.revisionOf && car.kind !== 'generation') {
      ctx.addIssue({
        code: 'custom',
        path: ['revisionOf'],
        message: "`revisionOf` marks a facelift and is only valid on kind 'generation'",
      });
    }
    if (car.revisionOf === car.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['revisionOf'],
        message: 'an entry cannot be a revision of itself',
      });
    }

    // Trims are rows on a generation (SPEC.md §5.2). A hub that carried its own
    // trim list would duplicate — and eventually contradict — its generations.
    if (car.kind === 'model' && car.trims.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['trims'],
        message:
          "kind 'model' is a hub and must not carry trims — they belong to its generation entries (SPEC.md §5.2)",
      });
    }

    // --- taxonomy completeness ---------------------------------------------
    if (car.kind !== 'model') {
      if (car.bodyStyles.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['bodyStyles'],
          message: `kind '${car.kind}' needs at least one body style — a model hub aggregates from its children, but a generation must be tagged`,
        });
      }
      if (car.powertrains.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['powertrains'],
          message: `kind '${car.kind}' needs at least one powertrain tag`,
        });
      }
      if (car.drivetrains.length === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['drivetrains'],
          message: `kind '${car.kind}' needs at least one drivetrain tag`,
        });
      }
    }

    // --- trim ids unique within the entry ----------------------------------
    const trimIds = car.trims.map((t) => t.id);
    const dupes = [...new Set(trimIds.filter((id, i) => trimIds.indexOf(id) !== i))];
    if (dupes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['trims'],
        message: `duplicate trim id(s): ${dupes.join(', ')} — trim ids must be unique within an entry, they are comparison and garage targets`,
      });
    }

    // --- a trim must fit inside its parent entry's production window --------
    for (const [i, trim] of car.trims.entries()) {
      if (trim.productionYears.start < car.productionYears.start) {
        ctx.addIssue({
          code: 'custom',
          path: ['trims', i, 'productionYears', 'start'],
          message: `trim '${trim.id}' starts before the entry it belongs to (${trim.productionYears.start} < ${car.productionYears.start})`,
        });
      }
      const entryEnd = car.productionYears.end;
      const trimEnd = trim.productionYears.end;
      if (entryEnd !== null && trimEnd !== null && trimEnd > entryEnd) {
        ctx.addIssue({
          code: 'custom',
          path: ['trims', i, 'productionYears', 'end'],
          message: `trim '${trim.id}' ends after the entry it belongs to (${trimEnd} > ${entryEnd})`,
        });
      }
    }
  });

export type CarData = z.infer<typeof carDataSchema>;
