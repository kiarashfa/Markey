#!/usr/bin/env node
/**
 * Wikipedia fetcher for the authoring pipeline.
 *
 *   node scripts/data/wiki.mjs infobox "Toyota Prius (XW20)"
 *   node scripts/data/wiki.mjs cite    "Toyota Prius (XW20)"
 *   node scripts/data/wiki.mjs cite    "Toyota Prius (XW20)" --append   # into references.json
 *   node scripts/data/wiki.mjs raw     "Toyota Prius (XW20)" > article.wikitext
 *   node scripts/data/wiki.mjs grep    "Toyota Prius (XW20)" "drag|kerb|top speed"
 *
 * `infobox` prints the parsed infobox with SI conversions and the note text
 * each conversion needs. `cite` prints a ready-made `references.json` entry
 * including the **revision id**, which the design requires and which is
 * the single easiest thing for a hurrying agent to leave out.
 *
 * `grep` exists because of the most expensive Phase 10 finding: the infobox is
 * not enough for any real car. The Prius's drag coefficient and battery, the
 * Golf GTI's entire specification, the Range Rover's power and the 2CV's whole
 * evolution are all in the article *body*.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getJson, withQuery } from './lib/http.mjs';
import { GLOSSARY, infoboxFields, plain, readField, toSi, vehicleInfobox } from './lib/wikitext.mjs';

/** Fetches the wikitext of an article plus the revision it was read at. */
export async function fetchArticle(title, lang = 'en') {
  const api = `https://${lang}.wikipedia.org/w/api.php`;
  const data = await getJson(
    withQuery(api, { action: 'parse', page: title, prop: 'wikitext|revid', format: 'json', formatversion: '2' }),
  );
  if (data.error) throw new Error(`${title}: ${data.error.info}`);
  return { title: data.parse.title, revid: String(data.parse.revid), wikitext: data.parse.wikitext, lang };
}

/** Fields worth pulling for a car, in the order a spec sheet wants them. */
const CAR_FIELDS = [
  'name', 'manufacturer', 'production', 'model_years', 'assembly', 'designer', 'class',
  'body_style', 'layout', 'platform', 'engine', 'motor', 'battery', 'electric_range',
  'transmission', 'drivetrain', 'wheelbase', 'length', 'width', 'height', 'weight',
  'predecessor', 'successor', 'aka', 'model_code', 'related',
];

function describe(entry) {
  if (entry.values === null) return entry.text;
  const si = toSi(entry.values[0], entry.unit ?? '');
  const range = entry.values.length > 1 ? `${entry.values[0]}–${entry.values[1]}` : `${entry.values[0]}`;
  const converted =
    si && si.factor !== 1 ? `  →  ${Number(si.value.toFixed(3))} ${si.unit}` : '';
  const qualifier = entry.qualifier ? `  [${entry.qualifier}]` : '';
  const warn = entry.values.length > 1 ? '  ⚠ RANGE — pick a trim-level figure' : '';
  return `${range} ${entry.unit ?? ''}${converted}${qualifier}${warn}`;
}

async function cmdInfobox(title, lang) {
  const article = await fetchArticle(title, lang);
  const box = vehicleInfobox(article.wikitext);
  if (!box) {
    console.error(`No vehicle infobox found in "${article.title}".`);
    process.exitCode = 1;
    return;
  }
  const fields = infoboxFields(box);
  console.log(`# ${article.title}  (revision ${article.revid})\n`);
  const isEv = /\{\{\s*infobox\s+electric vehicle/i.test(box);
  if (isEv) console.log('NOTE: {{Infobox electric vehicle}} — uses motor/battery/electric_range, not engine.\n');

  for (const field of CAR_FIELDS) {
    const entries = readField(fields, field);
    if (entries.length === 0) continue;
    if (entries.length === 1) {
      console.log(`${field.padEnd(16)} ${describe(entries[0])}`);
    } else {
      console.log(`${field.padEnd(16)} (${entries.length} values)`);
      for (const entry of entries) console.log(`${' '.repeat(18)}${describe(entry)}`);
    }
  }
  const unknown = Object.keys(fields).filter((f) => !CAR_FIELDS.includes(f) && fields[f]);
  // Not a footnote: the six non-English editions this project now sources
  // from use entirely different field names — German writes `länge`,
  // `gewicht` and `radstand` — so an English-only field list prints nothing
  // at all for them. Known names come first because they are the common
  // case; the rest are shown because guessing sixty field names across six
  // languages would be worse than showing the author what is actually there.
  if (unknown.length) {
    console.log(`
--- other fields in this infobox (${lang}) ---`);
    for (const field of unknown) {
      const entries = readField(fields, field);
      if (entries.length === 0) continue;
      if (entries.length === 1) console.log(`${field.padEnd(16)} ${describe(entries[0])}`);
      else {
        console.log(`${field.padEnd(16)} (${entries.length} values)`);
        for (const entry of entries) console.log(`${' '.repeat(18)}${describe(entry)}`);
      }
    }
  }
  if (lang !== 'en') {
    const hints = GLOSSARY[lang];
    if (hints) {
      console.log(`\n--- ${lang} terms that are easy to misread ---`);
      for (const [term, meaning] of Object.entries(hints)) {
        console.log(`  ${term.padEnd(26)} ${meaning}`);
      }
    }
    console.log(
      '\nNUMBERS: this edition may write 1.234,5 for one thousand two hundred thirty-four point five.' +
        '\nUse parseLocalisedNumber() from lib/wikitext.mjs — a bare "1.200" is ambiguous and it says so.',
    );
  }
  console.log(
    '\nReminder: the infobox is never the whole story. Run `grep` over the body for ' +
      'drag coefficient, battery, performance and per-trim figures.',
  );
}

async function cmdCite(title, lang, append) {
  const article = await fetchArticle(title, lang);
  // The language belongs in the key. Without it the German and English
  // articles for the same car generate the same citation key and the second
  // one silently overwrites the first in the bibliography.
  const prefix = article.lang === 'en' ? 'wikipedia' : `wikipedia-${article.lang}`;
  const key =
    `${prefix}-${article.title}`
      .toLowerCase()
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const entry = {
    key,
    type: 'wikipedia',
    title: article.title,
    publisher: 'Wikipedia',
    url: `https://${article.lang}.wikipedia.org/wiki/${encodeURIComponent(article.title.replace(/ /g, '_'))}`,
    lang: article.lang,
    revision: article.revid,
    accessed: new Date().toISOString().slice(0, 10),
    license: 'CC BY-SA 4.0',
  };
  if (!append) {
    console.log(JSON.stringify(entry, null, 2));
    return;
  }
  // --append writes the entry into the bibliography itself, so an author never
  // has to open a file that grows with every car to add one line to it. Read
  // and written in one step, immediately, which keeps the window for two
  // parallel authors racing each other to milliseconds.
  const file = new URL('../../src/data/references.json', import.meta.url);
  const bibliography = JSON.parse(readFileSync(file, 'utf8'));
  const existing = bibliography.entries.find((e) => e.key === key);
  if (existing) {
    if (existing.revision === entry.revision) {
      console.log(`${key} is already in the bibliography at revision ${entry.revision}; nothing to add.`);
    } else {
      console.log(
        `${key} is already in the bibliography at revision ${existing.revision} (the article is now at ${entry.revision}). ` +
          'Cite the existing key; a figure read from the newer revision needs its own reference, added by hand.',
      );
    }
    return;
  }
  bibliography.entries.push(entry);
  writeFileSync(file, `${JSON.stringify(bibliography, null, 2)}\n`);
  console.log(`added ${key} (revision ${entry.revision}) to src/data/references.json`);
}

async function cmdRaw(title, lang) {
  const article = await fetchArticle(title, lang);
  process.stdout.write(article.wikitext);
}

async function cmdGrep(title, pattern, lang) {
  const article = await fetchArticle(title, lang);
  const re = new RegExp(pattern, 'i');
  const lines = article.wikitext.split('\n');
  let hits = 0;
  for (const [i, line] of lines.entries()) {
    if (!re.test(line)) continue;
    hits += 1;
    const text = plain(line).slice(0, 500);
    if (text) console.log(`${String(i + 1).padStart(5)}  ${text}\n`);
  }
  console.error(`${hits} matching line(s) in ${article.title} (revision ${article.revid}).`);
}

const [command, ...rest] = process.argv.slice(2);
const langFlag = rest.findIndex((a) => a === '--lang');
const lang = langFlag === -1 ? 'en' : rest[langFlag + 1];
const args = langFlag === -1 ? rest : rest.filter((_, i) => i !== langFlag && i !== langFlag + 1);

try {
  if (command === 'infobox') await cmdInfobox(args[0], lang);
  else if (command === 'cite') await cmdCite(args.filter((a) => a !== '--append')[0], lang, args.includes('--append'));
  else if (command === 'raw') await cmdRaw(args[0], lang);
  else if (command === 'grep') await cmdGrep(args[0], args[1], lang);
  else {
    console.error('usage: wiki.mjs <infobox|cite|raw|grep> "Article title" [pattern] [--lang de] [--append, with cite]');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
