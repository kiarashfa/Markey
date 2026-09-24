/**
 * Controlled vocabularies.
 *
 * The vocabulary files under `src/data/taxonomy/` are the single source of
 * truth. Zod enums are built *from* them at load time rather than restated
 * here, so adding a term is a one-file change and an invalid tag fails the
 * build naming the file to fix, instead of silently creating an orphan
 * taxonomy page.
 *
 * Five axes are authored (body style, powertrain, drivetrain, segment,
 * positioning). Two are computed and must never be authored: Origin comes
 * from `brand.countryOfOrigin`, Era from `productionYears`.
 */
import { z } from 'zod';

import bodyStylesVocab from '../data/taxonomy/body-styles.json' with { type: 'json' };
import powertrainsVocab from '../data/taxonomy/powertrains.json' with { type: 'json' };
import drivetrainsVocab from '../data/taxonomy/drivetrains.json' with { type: 'json' };
import segmentsVocab from '../data/taxonomy/segments.json' with { type: 'json' };
import positioningVocab from '../data/taxonomy/positioning.json' with { type: 'json' };
import erasVocab from '../data/taxonomy/eras.json' with { type: 'json' };

export interface VocabTerm {
  id: string;
  label: string;
  description?: string;
  aka?: string[];
  labels?: Record<string, string>;
  rank?: number;
}

export interface Vocabulary {
  axis: string;
  urlPrefix: string;
  authored: boolean;
  note?: string;
  terms: VocabTerm[];
}

/** Era buckets carry their own boundaries, since era is derived not authored. */
export interface EraTerm extends VocabTerm {
  start: number;
  end: number;
}

export interface EraVocabulary extends Omit<Vocabulary, 'terms'> {
  terms: EraTerm[];
}

/** The seven browse axes, in their canonical order. */
export const TAXONOMY_AXES = [
  'body-style',
  'powertrain',
  'drivetrain',
  'origin',
  'segment',
  'positioning',
  'era',
] as const;
export type TaxonomyAxis = (typeof TAXONOMY_AXES)[number];

function ids(vocab: { terms: readonly { id: string }[] }): [string, ...string[]] {
  const list = vocab.terms.map((t) => t.id);
  if (list.length === 0) {
    throw new Error('taxonomy vocabulary is empty — every axis needs at least one term');
  }
  const duplicates = list.filter((id, i) => list.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`duplicate taxonomy term id(s): ${[...new Set(duplicates)].join(', ')}`);
  }
  return list as [string, ...string[]];
}

export const bodyStyles = bodyStylesVocab as Vocabulary;
export const powertrains = powertrainsVocab as Vocabulary;
export const drivetrains = drivetrainsVocab as Vocabulary;
export const segments = segmentsVocab as Vocabulary;
export const positioning = positioningVocab as Vocabulary;
export const eras = erasVocab as unknown as EraVocabulary;

export const bodyStyleTag = z.enum(ids(bodyStyles));
export const powertrainTag = z.enum(ids(powertrains));
export const drivetrainTag = z.enum(ids(drivetrains));
export const segmentTag = z.enum(ids(segments));
export const positioningTag = z.enum(ids(positioning));

export type BodyStyleTag = z.infer<typeof bodyStyleTag>;
export type PowertrainTag = z.infer<typeof powertrainTag>;
export type DrivetrainTag = z.infer<typeof drivetrainTag>;
export type SegmentTag = z.infer<typeof segmentTag>;
export type PositioningTag = z.infer<typeof positioningTag>;

/** Every authored vocabulary, keyed by axis — used to build taxonomy pages. */
export const AUTHORED_VOCABULARIES: Record<string, Vocabulary> = {
  'body-style': bodyStyles,
  powertrain: powertrains,
  drivetrain: drivetrains,
  segment: segments,
  positioning: positioning,
};

export function termsOf(axis: string): VocabTerm[] {
  return AUTHORED_VOCABULARIES[axis]?.terms ?? [];
}

export function labelFor(axis: string, id: string): string | undefined {
  return termsOf(axis).find((t) => t.id === id)?.label;
}

// ---------------------------------------------------------------------------
// Era — computed, never authored
// ---------------------------------------------------------------------------

/**
 * Every era bucket a production range overlaps.
 *
 * A car built 1976–1989 belongs to the 1970s *and* the 1980s; collapsing it to
 * a single "launch decade" would hide it from a browse axis it genuinely
 * belongs on. An open-ended range (`end: null`, still in production) runs to
 * the current year.
 */
export function erasForRange(
  start: number,
  end: number | null,
  now: number = new Date().getUTCFullYear(),
): string[] {
  const last = end ?? now;
  if (last < start) return [];
  return eras.terms
    .filter((era) => era.start <= last && era.end >= start)
    .map((era) => era.id);
}
