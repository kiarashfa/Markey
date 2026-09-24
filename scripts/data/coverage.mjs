#!/usr/bin/env node
/**
 * Which taxonomy terms have no cars behind them.
 *
 *   node scripts/data/coverage.mjs
 *
 * The seed size is a judgement — "keep adding diverse nameplates
 * until every taxonomy axis has real examples". That judgement needs a fact to
 * rest on, and a hand-maintained list of gaps in a document goes stale the
 * moment a batch lands. This reads the live content instead, so the answer to
 * "what should the next batch cover?" is always current.
 *
 * Reads the same JSON the content collections load, deliberately without going
 * through Astro: it has to run in a plain shell, quickly, before any authoring
 * starts.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const CAR_DIR = 'src/content/carData';
const BRAND_DIR = 'src/content/brandData';
const TAXONOMY_DIR = 'src/data/taxonomy';

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'));
const readAll = (dir) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => readJson(path.join(dir, f)));

const cars = readAll(CAR_DIR);
const brands = readAll(BRAND_DIR);
const generations = cars.filter((c) => c.kind !== 'model');

/** Era buckets are computed from production years, never authored. */
function erasOf(car) {
  const { start, end } = car.productionYears;
  const last = end ?? new Date().getFullYear();
  const out = [];
  for (let decade = Math.floor(start / 10) * 10; decade <= last; decade += 10) {
    out.push(`${decade}s`);
  }
  return out;
}

const axes = [
  { file: 'body-styles.json', label: 'body style', of: (c) => c.bodyStyles ?? [] },
  { file: 'powertrains.json', label: 'powertrain', of: (c) => c.powertrains ?? [] },
  { file: 'drivetrains.json', label: 'drivetrain', of: (c) => c.drivetrains ?? [] },
  { file: 'segments.json', label: 'segment', of: (c) => (c.segment ? [c.segment] : []) },
  { file: 'positioning.json', label: 'positioning', of: (c) => (c.positioning ? [c.positioning] : []) },
  { file: 'eras.json', label: 'era', of: erasOf },
];

let gapCount = 0;
console.log(`Content: ${cars.length} car entries (${generations.length} with specs), ${brands.length} brands.\n`);

for (const axis of axes) {
  const vocab = readJson(path.join(TAXONOMY_DIR, axis.file));
  const terms = (vocab.terms ?? vocab.buckets ?? []).map((t) => t.id);
  const counts = new Map(terms.map((t) => [t, 0]));
  for (const car of generations) {
    for (const term of axis.of(car)) {
      if (counts.has(term)) counts.set(term, counts.get(term) + 1);
    }
  }
  const covered = terms.filter((t) => counts.get(t) > 0);
  const empty = terms.filter((t) => counts.get(t) === 0);
  gapCount += empty.length;
  console.log(`${axis.label.padEnd(12)} ${covered.length}/${terms.length} covered`);
  if (covered.length) {
    console.log(`  have : ${covered.map((t) => `${t}(${counts.get(t)})`).join('  ')}`);
  }
  if (empty.length) console.log(`  GAPS : ${empty.join('  ')}`);
  console.log('');
}

// Origin is not a vocabulary file — it resolves through the brand's country.
const countries = new Map();
for (const car of generations) {
  const brand = brands.find((b) => b.id === car.brandRef);
  if (!brand) continue;
  countries.set(brand.countryOfOrigin, (countries.get(brand.countryOfOrigin) ?? 0) + 1);
}
console.log('origin       (computed from brand country, no fixed vocabulary)');
console.log(`  have : ${[...countries].map(([c, n]) => `${c}(${n})`).join('  ')}\n`);

const conceptCount = readdirSync('src/content/conceptData').filter((f) => f.endsWith('.json')).length;
if (conceptCount === 0) {
  console.log('concepts     0 entries — the collection has never been exercised.');
  gapCount += 1;
}

console.log(`\n${gapCount} gap(s). Pick the next batch to close the widest ones (PLAYBOOK.md §1).`);
