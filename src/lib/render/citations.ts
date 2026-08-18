/**
 * A page's own reference list — SPEC.md §5.5, §10.
 *
 * Two things cite sources on a car page and both belong in one numbered list:
 *
 *  1. **The prose**, where an author wrote `[@key]`. `rehype-citations.ts`
 *     numbered those at compile time, in order of appearance.
 *  2. **The specifications**, where every `verified` figure names the source
 *     that verified it. Those were previously an anonymous "Source" link per
 *     row — the same URL repeated a dozen times down the table, with no way to
 *     see at a glance that the whole page rests on two documents.
 *
 * Prose numbers come first because prose comes first on the page, and the data
 * sources continue from where they stop. A reader following `[3]` in a sentence
 * and a reader following `[7]` in a spec row land in the same list.
 *
 * ## What this is not
 *
 * It is not a place to list a source nobody cited. The list is built from
 * citations that actually occur on the page, so it can never grow a row that
 * flatters the research — if a reference appears here, something on this page
 * points at it.
 */
import type { ReferenceEntry } from '../../schemas/reference.ts';

export interface PageReference {
  number: number;
  entry: ReferenceEntry;
  /** True when only the spec tables cite it, not the prose. */
  fromDataOnly: boolean;
}

export interface PageReferences {
  list: PageReference[];
  /** Citation key → its number on this page. */
  numbers: Map<string, number>;
}

/** A citation the prose made, as `rehype-citations.ts` recorded it. */
export interface ProseCitation {
  key: string;
  number: number;
}

/**
 * Reads what a rendered entry's prose cited.
 *
 * `render()` hands back `remarkPluginFrontmatter`, which carries whatever the
 * Markdown plugins wrote. Typed loosely on purpose: it is by definition
 * whatever the pipeline put there, and asserting a shape we cannot check would
 * be worse than narrowing one we can.
 */
export function proseCitationsOf(frontmatter: unknown): ProseCitation[] {
  const raw = (frontmatter as { citations?: unknown } | undefined)?.citations;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (item): item is ProseCitation =>
      !!item &&
      typeof (item as ProseCitation).key === 'string' &&
      Number.isInteger((item as ProseCitation).number),
  );
}

/**
 * Every citation key a value tree names, in the order they are first met.
 *
 * Walks anything — a `CarData`, a `BrandData`, a single trim — and collects the
 * `source` of every `PropertyValue` inside it. Written as a generic walk rather
 * than a list of known field paths because the alternative is a list that
 * silently stops being complete the first time a field is added to the schema.
 */
export function dataCitationsOf(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) dataCitationsOf(item, found);
    return found;
  }
  if (!value || typeof value !== 'object') return found;

  const record = value as Record<string, unknown>;
  // A PropertyValue is the only shape carrying `source`, and its source is a
  // citation key by schema.
  if (typeof record.source === 'string' && record.source && !found.includes(record.source)) {
    found.push(record.source);
  }
  for (const [key, nested] of Object.entries(record)) {
    if (key === 'source') continue;
    dataCitationsOf(nested, found);
  }
  return found;
}

/**
 * Numbers a page's references.
 *
 * A key cited by both the prose and the data keeps its prose number — one
 * source is one entry in the list, however many times the page points at it.
 * An unresolvable key is dropped rather than rendered as a gap: the build
 * already fails on a dangling citation in prose (`rehype-citations.ts`) and on
 * a dangling `source` in data (`check:content`), so reaching this branch means
 * something upstream is already broken and inventing a row would hide it.
 */
export function buildPageReferences(
  prose: ProseCitation[],
  dataKeys: string[],
  bibliography: readonly ReferenceEntry[],
): PageReferences {
  const byKey = new Map(bibliography.map((entry) => [entry.key, entry]));
  const numbers = new Map<string, number>();
  const list: PageReference[] = [];

  const add = (key: string, fromDataOnly: boolean) => {
    if (numbers.has(key)) return;
    const entry = byKey.get(key);
    if (!entry) return;
    const number = list.length + 1;
    numbers.set(key, number);
    list.push({ number, entry, fromDataOnly });
  };

  for (const citation of [...prose].sort((a, b) => a.number - b.number)) {
    add(citation.key, false);
  }
  for (const key of dataKeys) add(key, true);

  return { list, numbers };
}

/**
 * Everything about a reference *except* its title.
 *
 * The title is rendered separately as the link, so repeating it here produced
 * "Toyota 86 — Toyota 86 · Wikipedia · …". What is left is the part that makes
 * the citation checkable rather than merely identifiable.
 *
 * Wikipedia entries always carry their revision, because DATA_SOURCES.md is
 * explicit that the article will have changed by the time anyone verifies the
 * claim. That is the whole reason the field exists, so it is never dropped for
 * tidiness.
 */
export function referenceDetails(entry: ReferenceEntry): string {
  const parts: string[] = [];
  if (entry.author) parts.push(entry.author);
  if (entry.publisher) parts.push(entry.publisher);
  if (entry.year) parts.push(String(entry.year));
  if (entry.revision) parts.push(`revision ${entry.revision}`);
  if (entry.accessed) parts.push(`read ${entry.accessed}`);
  return parts.join(' · ');
}
