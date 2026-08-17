/**
 * Shared schema primitives — SPEC.md §5.5 (data trust & attribution) and §10
 * (imagery licensing).
 *
 * These import `zod` directly rather than `astro:content`'s re-export so the
 * same schemas can be loaded by plain Node scripts (the integrity checks in
 * `scripts/integrity/`) as well as by Astro's content layer. npm dedupes both
 * to the one installed copy, so `defineCollection` gets the instance it
 * expects.
 */
import { z } from 'zod';

/**
 * Flat, globally-unique, lowercase-kebab slug (SPEC.md §5.1). Generation codes
 * alone are not unique across the industry, so a slug always carries the model
 * prefix: `bmw-6-series-e24`, never `e24`.
 */
export const slug = z
  .string()
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    'must be lowercase kebab-case: letters, digits and single hyphens only',
  );

/** ISO calendar date, `YYYY-MM-DD`. */
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'must be an ISO date, YYYY-MM-DD');

/**
 * A key into the bibliography at `src/data/references.json`. Resolution is a
 * cross-file concern, so it is enforced by the integrity checks (SPEC.md §13),
 * not here — Zod only sees one file at a time.
 */
export const citationKey = slug;

/** A four-digit year, bounded to the era this site actually covers. */
export const year = z.number().int().min(1880).max(2100);

export const yearRange = z
  .object({
    start: year,
    /** `null` means "still in production". */
    end: year.nullable(),
  })
  .refine((r) => r.end === null || r.end >= r.start, {
    message: 'productionYears.end must not be earlier than .start',
  });

// ---------------------------------------------------------------------------
// PropertyValue — SPEC.md §5.5
// ---------------------------------------------------------------------------

export const valueStatus = z.enum([
  'verified',
  'estimated',
  'placeholder',
  'conflicting-sources',
]);
export type ValueStatus = z.infer<typeof valueStatus>;

/**
 * The SI units this site stores. SPEC.md §8.1: **SI is what's stored; imperial
 * is always computed on demand, client-side, never stored or indexed.** Making
 * this an enum rather than a free string is what stops a stray `hp` or `mph`
 * from ever reaching the database and quietly corrupting the math engine.
 */
export const siUnit = z.enum([
  'kW', // power
  'Nm', // torque
  'kg', // mass
  'mm', // length dimensions
  'm2', // frontal area
  'cc', // engine displacement
  's', // 0-100 time
  'km/h', // speed
  'L/100km', // liquid-fuel consumption
  'kWh/100km', // electric consumption
  'kWh', // battery capacity
  'km', // range
  'g/km', // CO2
  'L', // volume (boot, tank)
  '', // dimensionless — drag coefficient, tyre grip, efficiency factors
]);
export type SiUnit = z.infer<typeof siUnit>;

/**
 * Every numeric value on the site is wrapped, never a bare number.
 *
 * The refinements below encode SPEC.md §2 principles 3 and 5 as hard schema
 * rules, so "no fabricated data, ever" is enforced by the build rather than by
 * an author remembering it:
 *
 *  - `verified` must cite a source. An uncited number is not verified.
 *  - `placeholder` must have a null value. This is the important one — it makes
 *    it structurally impossible to leave a plausible-looking invented figure
 *    sitting behind a placeholder status.
 *  - `estimated` must explain itself in `sourceNote`, because a reader is owed
 *    the basis of an estimate (e.g. "frontal area from 0.85 x width x height").
 *  - `conflicting-sources` must both cite and explain the conflict.
 *  - a null value is only meaningful for `placeholder` / `conflicting-sources`.
 */
function propertyValueRules<T extends z.ZodType<PropertyValueShape>>(schema: T) {
  return schema.superRefine((v, ctx) => {
    if (v.status === 'verified' && !v.source) {
      ctx.addIssue({
        code: 'custom',
        message: "status 'verified' requires a `source` citation key",
      });
    }
    if (v.status === 'placeholder' && v.value !== null) {
      ctx.addIssue({
        code: 'custom',
        message:
          "status 'placeholder' requires `value: null` — a placeholder must never carry a plausible-looking invented number (SPEC.md §2.3)",
      });
    }
    if (v.status === 'estimated' && !v.sourceNote) {
      ctx.addIssue({
        code: 'custom',
        message:
          "status 'estimated' requires a `sourceNote` stating how it was estimated",
      });
    }
    if (v.status === 'conflicting-sources' && !v.sourceNote) {
      ctx.addIssue({
        code: 'custom',
        message:
          "status 'conflicting-sources' requires a `sourceNote` describing the conflict",
      });
    }
    if (
      v.value === null &&
      v.status !== 'placeholder' &&
      v.status !== 'conflicting-sources'
    ) {
      ctx.addIssue({
        code: 'custom',
        message:
          "a null value must be status 'placeholder' or 'conflicting-sources'",
      });
    }
  });
}

interface PropertyValueShape {
  value: number | null;
  status: ValueStatus;
  source?: string;
  sourceUrl?: string;
  sourceNote?: string;
}

const propertyValueBase = {
  value: z.number().nullable(),
  status: valueStatus,
  /** Citation key — resolved against the bibliography by the integrity checks. */
  source: citationKey.optional(),
  sourceUrl: z.url().optional(),
  /** Required when the source is a stand-in rather than the exact spec. */
  sourceNote: z.string().min(1).optional(),
};

/**
 * Builds a `PropertyValue` schema locked to one SI unit.
 *
 * Pinning the unit per field (`propertyValue('kW')` for power) rather than
 * accepting any unit string means a mis-unit is a build failure naming the
 * exact field, not a silently wrong number flowing into `lib/math`.
 */
export function propertyValue<U extends SiUnit>(unit: U) {
  return propertyValueRules(
    z.object({ ...propertyValueBase, unit: z.literal(unit) }),
  );
}

/** A `PropertyValue` in any SI unit — for generic rendering helpers. */
export const anyPropertyValue = propertyValueRules(
  z.object({ ...propertyValueBase, unit: siUnit }),
);
export type PropertyValue = z.infer<typeof anyPropertyValue>;

// ---------------------------------------------------------------------------
// Imagery — SPEC.md §10
// ---------------------------------------------------------------------------

/**
 * The legal basis on which an image is used. SPEC.md §10 is explicit that this
 * is recorded per file so the basis is auditable rather than assumed.
 *
 * `trademark-nominative-use` is deliberately separate from the copyright
 * licences: brand logos (§11.2) sit on trademark law, not a copyright licence,
 * and the rules that follow are different (use unmodified, identification only,
 * never implying endorsement).
 */
export const licenseType = z.enum([
  'cc0',
  'public-domain',
  'cc-by',
  'cc-by-sa',
  'cc-by-nc',
  'cc-by-nd',
  'gfdl',
  'manufacturer-press-grant',
  'fair-use-editorial',
  'trademark-nominative-use',
]);
export type LicenseType = z.infer<typeof licenseType>;

/** Licences that require naming the author (SPEC.md §10). */
export const ATTRIBUTION_REQUIRED: ReadonlySet<string> = new Set([
  'cc-by',
  'cc-by-sa',
  'cc-by-nc',
  'cc-by-nd',
  'gfdl',
  'manufacturer-press-grant',
]);

export const imageCredit = z
  .object({
    /** Photographer / uploader as credited by the source. */
    author: z.string().min(1).optional(),
    /** Page the file came from — a Commons file page, not a raw image URL. */
    sourceUrl: z.url(),
    /** Title of the work as published, where the source gives one. */
    title: z.string().optional(),
    licenseType,
    /** e.g. '4.0' for CC BY-SA 4.0. */
    licenseVersion: z.string().optional(),
    licenseUrl: z.url().optional(),
    /** Why this use is defensible. Mandatory for the contestable bases. */
    licenseNote: z.string().min(1).optional(),
  })
  .superRefine((c, ctx) => {
    if (ATTRIBUTION_REQUIRED.has(c.licenseType) && !c.author) {
      ctx.addIssue({
        code: 'custom',
        path: ['author'],
        message: `licenseType '${c.licenseType}' requires attribution — name the author`,
      });
    }
    if (c.licenseType === 'fair-use-editorial' && !c.licenseNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['licenseNote'],
        message:
          "fair-use-editorial requires a `licenseNote` — fair use is a contestable defence, not a licence, and SPEC.md §10 requires it be justified per file",
      });
    }
    if (c.licenseType === 'manufacturer-press-grant' && !c.licenseNote) {
      ctx.addIssue({
        code: 'custom',
        path: ['licenseNote'],
        message:
          'manufacturer-press-grant requires a `licenseNote` pointing at the press terms that grant editorial use',
      });
    }
  });

export const imageRef = z.object({
  /** Path under `public/`, or an absolute URL to a hosted original. */
  src: z.string().min(1),
  /** Never optional: a spec table is useless to a screen reader without it. */
  alt: z.string().min(1),
  caption: z.string().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  credit: imageCredit,
});
export type ImageRef = z.infer<typeof imageRef>;

// ---------------------------------------------------------------------------
// Entry-level trust fields — SPEC.md §5.5
// ---------------------------------------------------------------------------

export const reviewStatus = z.enum([
  'draft',
  'agent-populated',
  'spot-checked',
  'verified',
]);
export type ReviewStatus = z.infer<typeof reviewStatus>;

/**
 * Carried by every entry in every collection. `lastVerified` exists because —
 * unlike polymer chemistry — car prices, specs and availability genuinely go
 * stale (SPEC.md §2.3).
 */
export const trustFields = {
  lastVerified: isoDate,
  reviewStatus,
  /** Citation keys; resolution enforced by the integrity checks. */
  references: z.array(citationKey).default([]),
};

/** Shared physical dimensions block, SI throughout. */
export const dimensions = z.object({
  length: propertyValue('mm').optional(),
  width: propertyValue('mm').optional(),
  height: propertyValue('mm').optional(),
  wheelbase: propertyValue('mm').optional(),
  kerbWeight: propertyValue('kg').optional(),
});
export type Dimensions = z.infer<typeof dimensions>;
