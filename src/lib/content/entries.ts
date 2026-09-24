/**
 * Collection loading and joining — the layer every page and island reads
 * content through.
 *
 * Two jobs, both of which would otherwise be re-implemented in every template:
 *
 *  1. **Joining.** Narrative and structured data are two files joined by `id`
 *     and never merged. Templates want them together.
 *  2. **Walking the hierarchy.** trim → generation → model, in both directions.
 *     Breadcrumbs, hub pages, and canonical URLs all need this constantly.
 *
 * Integrity is already guaranteed by the time this runs — `astro:build:start`
 * has failed the build if any pairing or parent were broken — so
 * the joins here can be direct rather than defensive.
 */
import { getCollection, type CollectionEntry } from 'astro:content';

import type { CarData, CarKind } from '../../schemas/car.ts';
import type { BrandData } from '../../schemas/brand.ts';
import type { ConceptData } from '../../schemas/concept.ts';
import { erasForRange } from '../../schemas/taxonomy.ts';

export interface JoinedCar {
  id: string;
  data: CarData;
  /** The narrative entry — call Astro's `render()` on this for the prose. */
  narrative: CollectionEntry<'cars'>;
}

export interface JoinedConcept {
  id: string;
  data: ConceptData;
  narrative: CollectionEntry<'concepts'>;
}

export interface JoinedBrand {
  id: string;
  data: BrandData;
  narrative: CollectionEntry<'brands'>;
}

function join<N extends { id: string }, D extends { id: string }>(
  narratives: N[],
  datas: D[],
  collection: string,
): { id: string; data: D; narrative: N }[] {
  const dataById = new Map(datas.map((d) => [d.id, d]));
  return narratives.map((narrative) => {
    const data = dataById.get(narrative.id);
    if (!data) {
      // Unreachable in a build that passed integrity, but a clear message beats
      // a downstream `undefined` if this is ever called outside that guarantee.
      throw new Error(
        `${collection}: '${narrative.id}' has no paired data entry. Run \`npm run check:content\`.`,
      );
    }
    return { id: narrative.id, data, narrative };
  });
}

export async function getCars(): Promise<JoinedCar[]> {
  const [narratives, datas] = await Promise.all([
    getCollection('cars'),
    getCollection('carData'),
  ]);
  return join(
    narratives,
    datas.map((d) => d.data),
    'cars',
  ) as JoinedCar[];
}

export async function getConcepts(): Promise<JoinedConcept[]> {
  const [narratives, datas] = await Promise.all([
    getCollection('concepts'),
    getCollection('conceptData'),
  ]);
  return join(
    narratives,
    datas.map((d) => d.data),
    'concepts',
  ) as JoinedConcept[];
}

export async function getBrands(): Promise<JoinedBrand[]> {
  const [narratives, datas] = await Promise.all([
    getCollection('brands'),
    getCollection('brandData'),
  ]);
  return join(
    narratives,
    datas.map((d) => d.data),
    'brands',
  ) as JoinedBrand[];
}

// ---------------------------------------------------------------------------
// Hierarchy walking
// ---------------------------------------------------------------------------

export function indexById<T extends { id: string }>(entries: T[]): Map<string, T> {
  return new Map(entries.map((e) => [e.id, e]));
}

/**
 * The chain from the model hub down to this entry, root first.
 *
 * A trim returns `[model, generation, trim]`; a model returns `[model]`. This
 * is breadcrumb order, which is the order it is nearly always wanted in.
 */
export function parentChain(car: JoinedCar, all: Map<string, JoinedCar>): JoinedCar[] {
  const chain: JoinedCar[] = [car];
  const seen = new Set<string>([car.id]);
  let cursor = car.data.parent;
  while (cursor) {
    if (seen.has(cursor)) break; // integrity forbids this; don't hang if it happens
    const parent = all.get(cursor);
    if (!parent) break;
    chain.unshift(parent);
    seen.add(cursor);
    cursor = parent.data.parent;
  }
  return chain;
}

/** The model hub an entry ultimately belongs to (itself, if it is one). */
export function rootModel(car: JoinedCar, all: Map<string, JoinedCar>): JoinedCar {
  const chain = parentChain(car, all);
  return chain[0]!;
}

export function childrenOf(
  id: string,
  all: JoinedCar[],
  kind?: CarKind,
): JoinedCar[] {
  return all.filter(
    (c) => c.data.parent === id && (kind === undefined || c.data.kind === kind),
  );
}

/** A hub's generations, oldest first — the list a model page renders. */
export function generationsOf(modelId: string, all: JoinedCar[]): JoinedCar[] {
  return childrenOf(modelId, all, 'generation').sort(
    (a, b) => a.data.productionYears.start - b.data.productionYears.start,
  );
}

/** The halo trims that earned their own page under a generation. */
export function haloTrimsOf(generationId: string, all: JoinedCar[]): JoinedCar[] {
  return childrenOf(generationId, all, 'trim');
}

// ---------------------------------------------------------------------------
// Computed taxonomy
// ---------------------------------------------------------------------------

/**
 * A model hub's tags, aggregated from its generations.
 *
 * The hub itself is not tagged (see `car.ts`): a nameplate spanning forty years
 * would otherwise have to be re-tagged by hand every time a generation changed
 * body style or gained a hybrid. Computing it means the hub can never disagree
 * with its own children.
 */
export function aggregateTags(
  car: JoinedCar,
  all: JoinedCar[],
): { bodyStyles: string[]; powertrains: string[]; drivetrains: string[] } {
  if (car.data.kind !== 'model') {
    return {
      bodyStyles: car.data.bodyStyles,
      powertrains: car.data.powertrains,
      drivetrains: car.data.drivetrains,
    };
  }
  const descendants = all.filter((c) => c.data.parent === car.id);
  const union = (pick: (c: JoinedCar) => string[]) => [
    ...new Set(descendants.flatMap(pick)),
  ];
  return {
    bodyStyles: union((c) => c.data.bodyStyles),
    powertrains: union((c) => c.data.powertrains),
    drivetrains: union((c) => c.data.drivetrains),
  };
}

/**
 * The era buckets an entry belongs to.
 *
 * A hub aggregates its generations' eras rather than using its own production
 * range, because a nameplate that ran 1976–1989 and again 2003–2023 did not
 * exist in the 1990s — and an outer envelope would claim it did.
 */
export function erasFor(car: JoinedCar, all: JoinedCar[]): string[] {
  if (car.data.kind === 'model') {
    const children = all.filter((c) => c.data.parent === car.id);
    if (children.length > 0) {
      return [
        ...new Set(
          children.flatMap((c) =>
            erasForRange(c.data.productionYears.start, c.data.productionYears.end),
          ),
        ),
      ].sort();
    }
  }
  return erasForRange(car.data.productionYears.start, car.data.productionYears.end);
}
