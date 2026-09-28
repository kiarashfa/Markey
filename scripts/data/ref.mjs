#!/usr/bin/env node
/**
 * The bibliography, without opening it.
 *
 *   node scripts/data/ref.mjs has <key>              exit 0 if the key exists
 *   node scripts/data/ref.mjs add '<json entry>'     append one entry
 *
 * `src/data/references.json` grows with every car, and reading it whole to add
 * one line spends an author's context on hundreds of entries it will never
 * cite. Wikipedia citations come from `wiki.mjs cite "Article" --append`; this
 * is for everything else (a dataset, a Commons file, a manufacturer page), with
 * the entry written out as JSON in the same shape as its neighbours.
 *
 * Read and written in one step, immediately, so two parallel authors cannot
 * lose each other's entry except inside a window of milliseconds; a duplicate
 * key is refused rather than overwritten.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = new URL('../../src/data/references.json', import.meta.url);
const REQUIRED = ['key', 'type', 'title', 'accessed'];

const [command, arg] = process.argv.slice(2);
const bibliography = JSON.parse(readFileSync(FILE, 'utf8'));

if (command === 'has' && arg) {
  const found = bibliography.entries.some((entry) => entry.key === arg);
  console.log(found ? `${arg} is in the bibliography.` : `${arg} is not in the bibliography.`);
  process.exit(found ? 0 : 1);
}

if (command === 'add' && arg) {
  let entry;
  try {
    entry = JSON.parse(arg);
  } catch (error) {
    console.error(`not valid JSON: ${error.message}`);
    process.exit(2);
  }
  const missing = REQUIRED.filter((field) => typeof entry[field] !== 'string' || entry[field] === '');
  if (missing.length) {
    console.error(`the entry is missing ${missing.join(', ')}; every reference needs ${REQUIRED.join(', ')}.`);
    process.exit(2);
  }
  if (!/^[a-z0-9-]+$/.test(entry.key)) {
    console.error(`key "${entry.key}" must be lowercase letters, digits and hyphens.`);
    process.exit(2);
  }
  if (bibliography.entries.some((existing) => existing.key === entry.key)) {
    console.error(`${entry.key} is already in the bibliography; cite it, or choose a new key for a different source.`);
    process.exit(1);
  }
  bibliography.entries.push(entry);
  writeFileSync(FILE, `${JSON.stringify(bibliography, null, 2)}\n`);
  console.log(`added ${entry.key} to src/data/references.json`);
  process.exit(0);
}

console.error('usage: ref.mjs has <key> | ref.mjs add \'<json entry>\'');
process.exit(2);
