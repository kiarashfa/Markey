/**
 * The bibliography — `src/data/references.json`.
 *
 * Every citation key must resolve into a references.bib-style bibliography,
 * but no file had been named for it. This is that file, added explicitly rather than silently: without a
 * bibliography to resolve *into*, the "every citation key resolves" integrity
 * check has nothing to check against.
 *
 * It is plain data rather than a content collection because nothing renders a
 * bibliography entry as a page — it is looked up, cited, and listed on
 * `/attributions/`.
 */
import { z } from 'zod';

import { isoDate, slug } from './primitives.ts';

export const referenceType = z.enum([
  'wikipedia',
  'wikidata',
  'commons',
  'web',
  'book',
  'periodical',
  'dataset',
  'press-release',
  'manufacturer-spec',
]);
export type ReferenceType = z.infer<typeof referenceType>;

export const referenceEntry = z
  .object({
    /** The citation key content files point at. */
    key: slug,
    type: referenceType,
    title: z.string().min(1),
    author: z.string().optional(),
    publisher: z.string().optional(),
    url: z.url().optional(),
    /** Publication or edition year. */
    year: z.number().int().min(1800).max(2100).optional(),
    /** When we last read it — a stale citation is a citation worth re-reading. */
    accessed: isoDate.optional(),
    /**
     * Revision identifier. the design is explicit that a Wikipedia
     * citation must name the article *and* the revision, because the article
     * will have changed by the time anyone checks it.
     */
    revision: z.string().optional(),
    /**
     * Language of the source, as a Wikipedia subdomain code.
     *
     * Added in Phase 12a, when the plan grew to include the 4,489 cars that
     * have no English article but do have a German, Russian, French, Italian,
     * Dutch or Japanese one. A citation that does not say which Wikipedia it
     * came from cannot be checked, and `en` cannot be assumed once the
     * catalogue sources from six languages.
     */
    lang: z.string().regex(/^[a-z]{2,3}(-[a-z]+)?$/, 'a language code like en, de, ja').optional(),
    /** e.g. 'CC BY-SA 4.0', 'public domain'. */
    license: z.string().optional(),
    note: z.string().optional(),
  })
  .superRefine((ref, ctx) => {
    if (ref.type === 'wikipedia') {
      if (!ref.lang) {
        ctx.addIssue({
          code: 'custom',
          path: ['lang'],
          message:
            'a Wikipedia citation must say which language edition it came from — the catalogue sources from six of them and `en` cannot be assumed',
        });
      }
      if (!ref.revision) {
        ctx.addIssue({
          code: 'custom',
          path: ['revision'],
          message:
            'a Wikipedia citation must name the revision it was read at — the article will have changed by the time anyone verifies it',
        });
      }
      if (!ref.license) {
        ctx.addIssue({
          code: 'custom',
          path: ['license'],
          message:
            'a Wikipedia citation must record its licence — CC BY-SA requires attribution and share-alike',
        });
      }
    }
    const needsUrl: ReferenceType[] = ['wikipedia', 'wikidata', 'commons', 'web', 'dataset'];
    if (needsUrl.includes(ref.type) && !ref.url) {
      ctx.addIssue({
        code: 'custom',
        path: ['url'],
        message: `a '${ref.type}' citation must carry the URL it refers to`,
      });
    }
  });
export type ReferenceEntry = z.infer<typeof referenceEntry>;

export const bibliographySchema = z
  .object({
    note: z.string().optional(),
    entries: z.array(referenceEntry),
  })
  .superRefine((bib, ctx) => {
    const keys = bib.entries.map((e) => e.key);
    const dupes = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
    if (dupes.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['entries'],
        message: `duplicate citation key(s): ${dupes.join(', ')}`,
      });
    }
  });
export type Bibliography = z.infer<typeof bibliographySchema>;
