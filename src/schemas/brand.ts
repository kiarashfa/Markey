/**
 * The `brands` collection — SPEC.md §5.4.
 *
 * Brand pages are real content (own narrative + identity), but the list of
 * models under a brand is always computed from `brandRef`, never hand-
 * maintained. `logo` and `accentColor` are authored once here and inherited by
 * every car page underneath (SPEC.md §11.2), so hundreds of car pages get a
 * cohesive identity with no per-entry authoring.
 */
import { z } from 'zod';

import { imageRef, slug, trustFields, year } from './primitives.ts';

export const brandNarrativeSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
  })
  .strict();
export type BrandNarrative = z.infer<typeof brandNarrativeSchema>;

/** `#rgb` or `#rrggbb`. */
const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'must be a hex colour like #0066B1');

export const brandDataSchema = z
  .object({
    id: slug,
    name: z.string().min(1),
    /** Legal entity name, where it differs from the marque. */
    legalName: z.string().optional(),

    /**
     * The Origin taxonomy axis (SPEC.md §7) resolves through this, at brand
     * level only — BMW is Germany. Per-generation build location is a real
     * fact but is not a formal axis; it lives in `carData.assembly`.
     */
    countryOfOrigin: z.string().min(1),
    founded: year,
    defunct: year.optional(),

    /**
     * Brand id of the corporate owner. Tracked because ownership is a real,
     * sourceable fact and gives platform-sharing and badge-engineering context
     * somewhere to hang (SPEC.md §5.4). Resolution is checked cross-file.
     */
    parentCompany: slug.optional(),
    website: z.url().optional(),

    /**
     * Displayed as a badge on every car under this brand.
     *
     * SPEC.md §11.2 / §10: brand marks sit on trademark nominative fair use,
     * not a copyright licence. The mark is used **unmodified** — no recolour,
     * no monochrome knockout, no re-cut — and contrast is solved by the frame
     * behind it. `licenseType: 'trademark-nominative-use'` is the honest
     * recording of that basis.
     */
    logo: imageRef,
    /** Official monochrome variant, where the brand publishes one. */
    logoMonochrome: imageRef.optional(),

    /** The brand's real identity colour — themes each car's hero band. */
    accentColor: hexColor,
    /** Optional darker/lighter pairing where one colour can't carry both themes. */
    accentColorDark: hexColor.optional(),
    /**
     * How this accent colour was arrived at.
     *
     * Not in SPEC.md §5.4 — added because an accent colour is the one brand
     * field with no reliable public source. Manufacturers publish brand
     * guidelines inconsistently, and a Commons logo file is usually a gradient
     * rendering rather than a flat brand colour. Recording the basis keeps this
     * field to the same standard as every other value on the site, instead of
     * being the one number nobody has to justify.
     */
    accentColorNote: z.string().min(1).optional(),

    ...trustFields,
  })
  .superRefine((brand, ctx) => {
    if (brand.defunct !== undefined && brand.defunct < brand.founded) {
      ctx.addIssue({
        code: 'custom',
        path: ['defunct'],
        message: 'a brand cannot be dissolved before it was founded',
      });
    }
    if (brand.parentCompany === brand.id) {
      ctx.addIssue({
        code: 'custom',
        path: ['parentCompany'],
        message: 'a brand cannot own itself',
      });
    }
    if (brand.logo.credit.licenseType !== 'trademark-nominative-use') {
      ctx.addIssue({
        code: 'custom',
        path: ['logo', 'credit', 'licenseType'],
        message:
          "a brand logo must be recorded as 'trademark-nominative-use' — it is a trademark used to identify that manufacturer's cars, not a copyright-licensed image (SPEC.md §10, §11.2)",
      });
    }
  });

export type BrandData = z.infer<typeof brandDataSchema>;
