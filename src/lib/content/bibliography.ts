/**
 * The bibliography, parsed once — SPEC.md §5.5.
 *
 * `references.json` is plain data rather than a content collection, so nothing
 * validates it on import the way a collection schema would. Every consumer that
 * imported the raw JSON got `type: string` instead of the reference-type union,
 * which is the visible symptom of the real problem: the file was being trusted
 * rather than checked at the point of use.
 *
 * Parsing here fixes both. The schema's own rules run — a Wikipedia citation
 * without a revision, a web citation without a URL, a duplicate key — and every
 * page that renders a reference gets the checked type.
 */
import bibliography from '../../data/references.json' with { type: 'json' };
import { bibliographySchema, type ReferenceEntry } from '../../schemas/reference.ts';

const parsed = bibliographySchema.parse(bibliography);

export const BIBLIOGRAPHY: readonly ReferenceEntry[] = parsed.entries;
export const BIBLIOGRAPHY_NOTE = parsed.note;

export function referenceByKey(key: string): ReferenceEntry | undefined {
  return BIBLIOGRAPHY.find((entry) => entry.key === key);
}
