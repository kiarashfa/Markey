/**
 * Cross-file content integrity — SPEC.md §13.
 *
 * Zod validates one file at a time. Everything that spans files — narrative
 * ↔ data pairing, `id` matching its filename, a `parent` resolving to a real
 * entry of the right `kind`, a citation key resolving into the bibliography —
 * is checked here, and **every** violation is collected before reporting, so a
 * content author sees the whole list at once rather than fixing them one build
 * at a time.
 *
 * This module deliberately imports nothing from `astro:*`. It is plain
 * Node-runnable TypeScript (Node >= 22.18 strips the types natively), which is
 * what lets the same code back three callers:
 *   - `src/integrations/integrity.ts`   → fails `astro build`
 *   - `scripts/integrity/check-content.mjs` → the standalone `check:content` gate
 *   - `scripts/integrity/check-self.mjs`    → proves these checks still bite
 */
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { brandDataSchema, brandNarrativeSchema } from '../schemas/brand.ts';
import { carDataSchema, carNarrativeSchema } from '../schemas/car.ts';
import { conceptDataSchema, conceptNarrativeSchema } from '../schemas/concept.ts';
import { bibliographySchema } from '../schemas/reference.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Violation {
  /** Repo-relative path of the file at fault. */
  file: string;
  /** Stable rule id — what `check:self` asserts on. */
  rule: string;
  message: string;
}

export interface IntegrityOptions {
  /** Directory holding `cars/`, `carData/`, `concepts/`, … */
  contentRoot: string;
  /** Path to the bibliography JSON. */
  bibliographyPath: string;
  /** Prefix used when printing file paths. */
  displayRoot?: string;
}

interface LoadedEntry<T> {
  /** Slug taken from the filename. */
  fileSlug: string;
  file: string;
  data: T;
}

type AnyRecord = Record<string, unknown>;

const PAIRS = [
  { narrative: 'cars', data: 'carData', label: 'car' },
  { narrative: 'concepts', data: 'conceptData', label: 'concept' },
  { narrative: 'brands', data: 'brandData', label: 'brand' },
] as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

async function listFiles(dir: string, ext: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(ext) && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
}

const rel = (root: string, file: string) => path.relative(root, file).split(path.sep).join('/');

/**
 * Parses the narrow slice of YAML our narrative frontmatter is allowed to use:
 * flat `key: value` pairs with scalar values.
 *
 * Deliberately strict rather than lenient — the frontmatter schemas are
 * `.strict()` and carry four identity fields, so anything this parser cannot
 * read is a content error worth reporting, not something to silently skip.
 */
function parseFrontmatter(
  raw: string,
): { ok: true; data: AnyRecord } | { ok: false; error: string } {
  const normalised = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  if (!normalised.startsWith('---\n')) {
    return { ok: false, error: 'file must open with a `---` frontmatter block' };
  }
  const end = normalised.indexOf('\n---', 3);
  if (end === -1) {
    return { ok: false, error: 'frontmatter block is never closed with `---`' };
  }
  const body = normalised.slice(4, end + 1);
  const data: AnyRecord = {};

  for (const [i, line] of body.split('\n').entries()) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    if (/^\s/.test(line)) {
      return {
        ok: false,
        error: `frontmatter line ${i + 1} is indented — only flat scalar keys are allowed here (spec data belongs in the .json file)`,
      };
    }
    const match = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!match) {
      return { ok: false, error: `frontmatter line ${i + 1} is not a \`key: value\` pair: ${line}` };
    }
    const key = match[1]!;
    const rawValue = match[2]!.trim();
    if (rawValue === '') {
      return { ok: false, error: `frontmatter key \`${key}\` has no value` };
    }
    data[key] = parseScalar(rawValue);
  }
  return { ok: true, data };
}

function parseScalar(value: string): unknown {
  if (value === 'null' || value === '~') return null;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    return value.slice(1, -1);
  }
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

/** Every `source` property anywhere in an entry — they are all citation keys. */
function collectCitationKeys(value: unknown, found: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectCitationKeys(item, found);
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as AnyRecord)) {
      if (key === 'source' && typeof child === 'string') found.add(child);
      else collectCitationKeys(child, found);
    }
  }
  return found;
}

/** Every object that looks like an ImageRef, with the path it was found at. */
function collectImages(
  value: unknown,
  trail: string = '',
  found: { at: string; image: AnyRecord }[] = [],
): { at: string; image: AnyRecord }[] {
  if (Array.isArray(value)) {
    value.forEach((item, i) => collectImages(item, `${trail}[${i}]`, found));
    return found;
  }
  if (value && typeof value === 'object') {
    const obj = value as AnyRecord;
    if (typeof obj.src === 'string' && 'alt' in obj) {
      found.push({ at: trail || 'image', image: obj });
    }
    for (const [key, child] of Object.entries(obj)) {
      collectImages(child, trail ? `${trail}.${key}` : key, found);
    }
  }
  return found;
}

interface ZodLikeIssue {
  path: (string | number | symbol)[];
  message: string;
}
interface ZodLikeResult {
  success: boolean;
  error?: { issues: ZodLikeIssue[] };
}
interface ZodLike {
  safeParse(value: unknown): ZodLikeResult;
}

function validate(
  schema: ZodLike,
  value: unknown,
  file: string,
  violations: Violation[],
): void {
  const result = schema.safeParse(value);
  if (result.success) return;
  for (const issue of result.error?.issues ?? []) {
    const at = issue.path.length > 0 ? issue.path.map(String).join('.') : '(root)';
    violations.push({ file, rule: 'schema/invalid', message: `${at}: ${issue.message}` });
  }
}

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

export async function runIntegrityChecks(options: IntegrityOptions): Promise<Violation[]> {
  const { contentRoot, bibliographyPath } = options;
  const displayRoot = options.displayRoot ?? process.cwd();
  const violations: Violation[] = [];

  // --- bibliography -------------------------------------------------------
  const citationKeys = new Set<string>();
  const bibFile = rel(displayRoot, bibliographyPath);
  if (!existsSync(bibliographyPath)) {
    violations.push({
      file: bibFile,
      rule: 'bibliography/missing',
      message: 'bibliography file not found — citation keys have nothing to resolve into',
    });
  } else {
    const parsed = await readJson(bibliographyPath, bibFile, violations);
    if (parsed !== undefined) {
      validate(bibliographySchema as unknown as ZodLike, parsed, bibFile, violations);
      const entries = (parsed as AnyRecord).entries;
      if (Array.isArray(entries)) {
        for (const entry of entries) {
          const key = (entry as AnyRecord)?.key;
          if (typeof key === 'string') citationKeys.add(key);
        }
      }
    }
  }

  // --- load every collection ---------------------------------------------
  const narratives: Record<string, LoadedEntry<AnyRecord>[]> = {};
  const datas: Record<string, LoadedEntry<AnyRecord>[]> = {};

  for (const pair of PAIRS) {
    narratives[pair.label] = [];
    datas[pair.label] = [];

    const narrativeDir = path.join(contentRoot, pair.narrative);
    const dataDir = path.join(contentRoot, pair.data);

    const narrativeFiles = await listFiles(narrativeDir, '.mdx');
    const dataFiles = await listFiles(dataDir, '.json');

    const narrativeSlugs = new Set(narrativeFiles.map((f) => f.replace(/\.mdx$/, '')));
    const dataSlugs = new Set(dataFiles.map((f) => f.replace(/\.json$/, '')));

    // Pairing, both directions.
    for (const slug of narrativeSlugs) {
      if (!dataSlugs.has(slug)) {
        violations.push({
          file: rel(displayRoot, path.join(narrativeDir, `${slug}.mdx`)),
          rule: 'pairing/missing-data',
          message: `no matching \`${pair.data}/${slug}.json\` — every narrative file needs its structured data sibling (SPEC.md §5.1)`,
        });
      }
    }
    for (const slug of dataSlugs) {
      if (!narrativeSlugs.has(slug)) {
        violations.push({
          file: rel(displayRoot, path.join(dataDir, `${slug}.json`)),
          rule: 'pairing/missing-narrative',
          message: `no matching \`${pair.narrative}/${slug}.mdx\` — every data file needs its narrative sibling (SPEC.md §5.1)`,
        });
      }
    }

    // Narrative frontmatter.
    for (const name of narrativeFiles) {
      const full = path.join(narrativeDir, name);
      const display = rel(displayRoot, full);
      const fileSlug = name.replace(/\.mdx$/, '');
      const raw = await readFile(full, 'utf8');
      const fm = parseFrontmatter(raw);
      if (!fm.ok) {
        violations.push({ file: display, rule: 'frontmatter/parse-error', message: fm.error });
        continue;
      }
      const schema =
        pair.label === 'car'
          ? carNarrativeSchema
          : pair.label === 'concept'
            ? conceptNarrativeSchema
            : brandNarrativeSchema;
      validate(schema as unknown as ZodLike, fm.data, display, violations);

      if (fm.data.id !== fileSlug) {
        violations.push({
          file: display,
          rule: 'id/filename-mismatch',
          message: `frontmatter id '${String(fm.data.id)}' does not match filename '${fileSlug}'`,
        });
      }
      narratives[pair.label]!.push({ fileSlug, file: display, data: fm.data });
    }

    // Structured data.
    for (const name of dataFiles) {
      const full = path.join(dataDir, name);
      const display = rel(displayRoot, full);
      const fileSlug = name.replace(/\.json$/, '');
      const parsed = await readJson(full, display, violations);
      if (parsed === undefined) continue;

      const schema =
        pair.label === 'car'
          ? carDataSchema
          : pair.label === 'concept'
            ? conceptDataSchema
            : brandDataSchema;
      validate(schema as unknown as ZodLike, parsed, display, violations);

      const data = parsed as AnyRecord;
      if (data.id !== fileSlug) {
        violations.push({
          file: display,
          rule: 'id/filename-mismatch',
          message: `id '${String(data.id)}' does not match filename '${fileSlug}'`,
        });
      }
      datas[pair.label]!.push({ fileSlug, file: display, data });
    }
  }

  // --- narrative ↔ data agreement ----------------------------------------
  for (const pair of PAIRS) {
    const dataBySlug = new Map(datas[pair.label]!.map((d) => [d.fileSlug, d]));
    for (const narrative of narratives[pair.label]!) {
      const data = dataBySlug.get(narrative.fileSlug);
      if (!data) continue;
      for (const field of ['id', 'name', 'kind', 'parent'] as const) {
        if (!(field in narrative.data)) continue;
        if (narrative.data[field] !== data.data[field]) {
          violations.push({
            file: narrative.file,
            rule: 'id/narrative-data-mismatch',
            message: `\`${field}\` is '${String(narrative.data[field])}' here but '${String(data.data[field])}' in the data file — the two files must agree on identity`,
          });
        }
      }
    }
  }

  // --- indexes for cross-references --------------------------------------
  const carsById = new Map(datas.car!.map((c) => [String(c.data.id ?? c.fileSlug), c]));
  const brandIds = new Set(datas.brand!.map((b) => String(b.data.id ?? b.fileSlug)));

  for (const pair of PAIRS) {
    const seen = new Map<string, string>();
    for (const entry of datas[pair.label]!) {
      const id = String(entry.data.id ?? entry.fileSlug);
      const previous = seen.get(id);
      if (previous) {
        violations.push({
          file: entry.file,
          rule: 'id/duplicate',
          message: `id '${id}' is already used by ${previous} — ids are globally unique (SPEC.md §5.1)`,
        });
      } else {
        seen.set(id, entry.file);
      }
    }
  }

  // --- car hierarchy ------------------------------------------------------
  const EXPECTED_PARENT_KIND: Record<string, string> = {
    generation: 'model',
    trim: 'generation',
  };

  for (const car of datas.car!) {
    const { file, data } = car;
    const id = String(data.id ?? car.fileSlug);
    const kind = String(data.kind);
    const parent = data.parent;

    if (typeof parent === 'string') {
      const target = carsById.get(parent);
      if (!target) {
        violations.push({
          file,
          rule: 'parent/unresolved',
          message: `parent '${parent}' does not resolve to any car entry`,
        });
      } else {
        const expected = EXPECTED_PARENT_KIND[kind];
        const actual = String(target.data.kind);
        if (expected && actual !== expected) {
          violations.push({
            file,
            rule: 'parent/wrong-kind',
            message: `a '${kind}' must hang off a '${expected}', but parent '${parent}' is a '${actual}' (SPEC.md §5.1)`,
          });
        }
      }
    }

    if (typeof data.revisionOf === 'string') {
      const target = carsById.get(data.revisionOf);
      if (!target) {
        violations.push({
          file,
          rule: 'revision-of/unresolved',
          message: `revisionOf '${data.revisionOf}' does not resolve to any car entry`,
        });
      } else if (target.data.parent !== parent) {
        violations.push({
          file,
          rule: 'revision-of/different-parent',
          message: `a facelift must sit under the same model hub as the generation it revises — '${data.revisionOf}' hangs off '${String(target.data.parent)}', this hangs off '${String(parent)}' (SPEC.md §5.1)`,
        });
      }
    }

    for (const field of ['predecessor', 'successor'] as const) {
      const value = data[field];
      if (typeof value === 'string' && !carsById.has(value)) {
        violations.push({
          file,
          rule: 'neighbour/unresolved',
          message: `${field} '${value}' does not resolve to any car entry`,
        });
      }
    }

    if (typeof data.brandRef === 'string' && !brandIds.has(data.brandRef)) {
      violations.push({
        file,
        rule: 'brand-ref/unresolved',
        message: `brandRef '${data.brandRef}' does not resolve to any brand entry`,
      });
    }

    // Walk up to the root, catching cycles.
    const chain = new Set<string>([id]);
    let cursor = typeof parent === 'string' ? parent : null;
    while (cursor) {
      if (chain.has(cursor)) {
        violations.push({
          file,
          rule: 'parent/cycle',
          message: `parent chain loops back on itself via '${cursor}'`,
        });
        break;
      }
      chain.add(cursor);
      const next = carsById.get(cursor)?.data.parent;
      cursor = typeof next === 'string' ? next : null;
    }
  }

  // Every model hub has at least one generation — SPEC.md §5.1 requires this
  // even for a nameplate that only ever had one version, so templates never
  // have to special-case a childless hub.
  const generationParents = new Set(
    datas.car!
      .filter((c) => c.data.kind === 'generation' && typeof c.data.parent === 'string')
      .map((c) => String(c.data.parent)),
  );
  for (const car of datas.car!) {
    if (car.data.kind === 'model') {
      const id = String(car.data.id ?? car.fileSlug);
      if (!generationParents.has(id)) {
        violations.push({
          file: car.file,
          rule: 'hub/no-generation',
          message:
            'a model hub must have at least one generation entry, even for a nameplate that only ever had one version (SPEC.md §5.1)',
        });
      }
    }
  }

  // --- brands -------------------------------------------------------------
  for (const brand of datas.brand!) {
    const owner = brand.data.parentCompany;
    if (typeof owner === 'string' && !brandIds.has(owner)) {
      violations.push({
        file: brand.file,
        rule: 'parent-company/unresolved',
        message: `parentCompany '${owner}' does not resolve to any brand entry`,
      });
    }
  }

  // --- concepts -----------------------------------------------------------
  for (const concept of datas.concept!) {
    const related = concept.data.relatedProductionCar;
    if (typeof related === 'string' && !carsById.has(related)) {
      violations.push({
        file: concept.file,
        rule: 'related-car/unresolved',
        message: `relatedProductionCar '${related}' does not resolve to any car entry`,
      });
    }
    if (typeof concept.data.brandRef === 'string' && !brandIds.has(concept.data.brandRef)) {
      violations.push({
        file: concept.file,
        rule: 'brand-ref/unresolved',
        message: `brandRef '${concept.data.brandRef}' does not resolve to any brand entry`,
      });
    }
  }

  // --- citations and images, across every collection ----------------------
  for (const pair of PAIRS) {
    for (const entry of datas[pair.label]!) {
      const keys = collectCitationKeys(entry.data);
      const declared = entry.data.references;
      if (Array.isArray(declared)) {
        for (const key of declared) if (typeof key === 'string') keys.add(key);
      }
      for (const key of keys) {
        if (!citationKeys.has(key)) {
          violations.push({
            file: entry.file,
            rule: 'citation/unresolved',
            message: `citation key '${key}' is not in the bibliography (src/data/references.json)`,
          });
        }
      }

      for (const { at, image } of collectImages(entry.data)) {
        const credit = image.credit as AnyRecord | undefined;
        if (!credit || typeof credit.licenseType !== 'string' || credit.licenseType === '') {
          violations.push({
            file: entry.file,
            rule: 'image/missing-license',
            message: `image at \`${at}\` has no \`credit.licenseType\` — every image's legal basis must be auditable (SPEC.md §10)`,
          });
        }
      }
    }
  }

  return violations.sort(
    (a, b) => a.file.localeCompare(b.file) || a.rule.localeCompare(b.rule),
  );
}

async function readJson(
  full: string,
  display: string,
  violations: Violation[],
): Promise<unknown> {
  try {
    return JSON.parse(await readFile(full, 'utf8'));
  } catch (error) {
    violations.push({
      file: display,
      rule: 'json/parse-error',
      message: `not valid JSON: ${(error as Error).message}`,
    });
    return undefined;
  }
}

/** Human-readable report — the complete list, grouped by file (SPEC.md §13). */
export function formatViolations(violations: Violation[]): string {
  if (violations.length === 0) return 'No content-integrity violations.';
  const byFile = new Map<string, Violation[]>();
  for (const v of violations) {
    const list = byFile.get(v.file) ?? [];
    list.push(v);
    byFile.set(v.file, list);
  }
  const lines: string[] = [
    `${violations.length} content-integrity violation${violations.length === 1 ? '' : 's'} in ${byFile.size} file${byFile.size === 1 ? '' : 's'}:`,
    '',
  ];
  for (const [file, list] of byFile) {
    lines.push(`  ${file}`);
    for (const v of list) lines.push(`    [${v.rule}] ${v.message}`);
    lines.push('');
  }
  return lines.join('\n');
}
