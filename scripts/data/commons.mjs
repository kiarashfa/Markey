#!/usr/bin/env node
/**
 * Image pipeline: Wikipedia article → licensed, measured files on disk.
 *
 *   node scripts/data/commons.mjs find     "Toyota Prius (XW20)"
 *   node scripts/data/commons.mjs licence  "File:2nd Toyota Prius.jpg"
 *   node scripts/data/commons.mjs download "File:2nd Toyota Prius.jpg" toyota-prius-xw20 hero
 *
 * Every rule encoded here is a Phase 10 mistake made once already:
 *
 *  - **`iiurlwidth` returns the nearest standard thumbnail size, not the width
 *    you ask for.** All twelve authored image dimensions were wrong because
 *    they were computed from the request. `download` measures the bytes it
 *    wrote and prints those, so the JSON can never disagree with the file.
 *  - **Category listings do not recurse**, and P373 often resolves to the
 *    nameplate category rather than the generation. `find` looks in the
 *    subcategories too.
 *  - **An image used in an article is not necessarily on Commons.** Local
 *    en.wikipedia uploads are usually non-free. Anything without Commons
 *    licence metadata is reported as unusable rather than quietly skipped.
 *  - **Wikimedia rate-limits.** Downloads go through the throttled client.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { get, getJson, withQuery } from './lib/http.mjs';

const EN = 'https://en.wikipedia.org/w/api.php';
const COMMONS = 'https://commons.wikimedia.org/w/api.php';
const WIKIDATA = 'https://www.wikidata.org/w/api.php';

const stripHtml = (html) =>
  (html ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

/** The Commons licence string mapped onto the schema's `licenseType` enum. */
export function licenseTypeFor(shortName) {
  const name = (shortName ?? '').toLowerCase();
  if (name.includes('cc0') || name.includes('zero')) return 'cc0';
  if (name.includes('public domain') || name.includes('pd-')) return 'public-domain';
  if (name.includes('cc by-sa')) return 'cc-by-sa';
  if (name.includes('cc by-nd')) return 'cc-by-nd';
  if (name.includes('cc by-nc')) return 'cc-by-nc';
  if (name.includes('cc by')) return 'cc-by';
  if (name.includes('gfdl')) return 'gfdl';
  return null;
}

/** Images an article actually uses — curated and generation-correct. */
export async function articleImages(title) {
  const data = await getJson(
    withQuery(EN, { action: 'query', prop: 'images', titles: title, imlimit: '500', format: 'json', formatversion: '2' }),
  );
  const page = data.query?.pages?.[0];
  return (page?.images ?? [])
    .map((i) => i.title)
    .filter((t) => /\.(jpe?g|png)$/i.test(t));
}

export async function wikidataId(title) {
  const data = await getJson(
    withQuery(EN, { action: 'query', prop: 'pageprops', titles: title, format: 'json', formatversion: '2' }),
  );
  return data.query?.pages?.[0]?.pageprops?.wikibase_item ?? null;
}

export async function commonsCategory(qid) {
  if (!qid) return null;
  const data = await getJson(withQuery(WIKIDATA, { action: 'wbgetclaims', entity: qid, property: 'P373', format: 'json' }));
  return data.claims?.P373?.[0]?.mainsnak?.datavalue?.value ?? null;
}

export async function categoryMembers(category, type) {
  const data = await getJson(
    withQuery(COMMONS, {
      action: 'query', list: 'categorymembers', cmtitle: `Category:${category}`,
      cmtype: type, cmlimit: '200', format: 'json', formatversion: '2',
    }),
  );
  return (data.query?.categorymembers ?? []).map((m) => m.title);
}

/** Licence and size metadata for a batch of Commons files. */
/**
 * Commons titles carry the `File:` namespace, and a title without it resolves
 * to nothing — which the API reports identically to a file that genuinely does
 * not exist. The first free-model trial spent thirty-five of its eighty
 * requests retrying `FiatLogo1921.jpg`, `Fiat logo 1899.png` and a dozen other
 * inventions, because "is not on Commons" was the only thing it was told.
 * Normalise instead: the namespace is a syntax detail, not a judgement.
 */
export const asFileTitle = (title) =>
  /^file:/i.test(String(title).trim()) ? String(title).trim() : `File:${String(title).trim()}`;

export async function fileMetadata(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 20) {
    const chunk = titles.slice(i, i + 20);
    const data = await getJson(
      withQuery(COMMONS, {
        action: 'query', titles: chunk.join('|'), prop: 'imageinfo',
        iiprop: 'url|size|extmetadata', iiurlwidth: '1600', format: 'json', formatversion: '2',
      }),
    );
    for (const page of data.query?.pages ?? []) {
      const info = page.imageinfo?.[0];
      if (!info) {
        // No imageinfo at all means the file is not on Commons — almost always
        // a local, non-free upload. Report it; never silently drop it.
        out.set(page.title, { onCommons: false });
        continue;
      }
      const meta = info.extmetadata ?? {};
      const shortName = meta.LicenseShortName?.value ?? null;
      out.set(page.title, {
        onCommons: true,
        originalUrl: info.url,
        thumbUrl: info.thumburl,
        originalWidth: info.width,
        originalHeight: info.height,
        licenseShortName: shortName,
        licenseType: licenseTypeFor(shortName),
        licenseUrl: meta.LicenseUrl?.value ?? null,
        author: stripHtml(meta.Artist?.value),
        description: stripHtml(meta.ImageDescription?.value),
        restrictions: meta.Restrictions?.value ?? null,
        // encodeURIComponent would escape the namespace colon into %3A, which
        // works but makes every credit URL in the content files unreadable.
        pageUrl: `https://commons.wikimedia.org/wiki/${page.title.replace(/ /g, '_').replace(/[?&#]/g, encodeURIComponent)}`,
      });
    }
  }
  return out;
}

/** Reads real pixel dimensions out of a JPEG or PNG already on disk. */
export async function measure(file) {
  const data = await readFile(file);
  if (data[0] === 0x89 && data[1] === 0x50) {
    return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  let i = 2;
  while (i < data.length - 9) {
    if (data[i] !== 0xff) { i += 1; continue; }
    const marker = data[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    i += 2 + data.readUInt16BE(i + 2);
  }
  return null;
}

async function cmdFind(title) {
  const qid = await wikidataId(title);
  const category = await commonsCategory(qid);
  console.log(`article  : ${title}`);
  console.log(`wikidata : ${qid ?? '(none)'}`);
  console.log(`P373     : ${category ?? '(none)'}\n`);

  const fromArticle = await articleImages(title);
  console.log(`— images used in the article (${fromArticle.length}) — curated, prefer these`);
  const meta = await fileMetadata(fromArticle);
  for (const file of fromArticle) {
    const m = meta.get(file);
    if (!m?.onCommons) {
      console.log(`  ✗ NOT ON COMMONS (likely non-free, do not use): ${file}`);
      continue;
    }
    const type = m.licenseType ?? `UNMAPPED (${m.licenseShortName})`;
    console.log(`  ${type.padEnd(15)} ${m.originalWidth}x${m.originalHeight}  ${file}`);
    console.log(`      author: ${m.author || '(none recorded)'}`);
  }

  if (category) {
    const direct = await categoryMembers(category, 'file');
    console.log(`\n— Commons category "${category}": ${direct.length} direct file(s)`);
    if (direct.length < 30) {
      const subs = await categoryMembers(category, 'subcat');
      console.log(`  few direct files — ${subs.length} subcategor(ies), the photographs are usually here:`);
      for (const sub of subs.slice(0, 25)) console.log(`    ${sub}`);
      console.log('  (list one with: commons.mjs cat "Category name without prefix")');
    }
  }
}

async function cmdCat(category) {
  const files = await categoryMembers(category, 'file');
  console.log(`${files.length} file(s) in Category:${category}`);
  for (const f of files.slice(0, 60)) console.log('  ', f);
}

async function cmdLicence(rawFile) {
  const file = asFileTitle(rawFile);
  const meta = await fileMetadata([file]);
  console.log(JSON.stringify(meta.get(file) ?? { onCommons: false }, null, 2));
}

async function cmdDownload(rawFile, carSlug, basename) {
  const file = asFileTitle(rawFile);
  const meta = (await fileMetadata([file])).get(file);
  if (!meta?.onCommons) {
    throw new Error(
      `${file} is not on Commons — do not use it. If you guessed this filename, ` +
        'stop guessing: run `commons.mjs find "<Article title>"` and download only a file it listed.',
    );
  }
  if (!meta.licenseType) throw new Error(`${file}: licence "${meta.licenseShortName}" is not in the schema enum — resolve by hand.`);

  const extension = path.extname(file).toLowerCase().replace('.jpeg', '.jpg') || '.jpg';
  /*
   * A vector original must be fetched as the original.
   *
   * Commons' `imageinfo` returns a *rasterised PNG* as `thumburl` for an SVG
   * file, so always preferring the thumbnail wrote PNG bytes into a `.svg`
   * filename — the bytes were right, the extension lied, and nothing checked.
   * The first Phase 12 agent found this on the Ford roundel. Take the original
   * for vectors, the thumbnail for photographs, and derive the extension from
   * the URL actually fetched rather than from the Commons file title.
   */
  const isVector = extension === '.svg';
  const source = isVector ? meta.originalUrl : (meta.thumbUrl ?? meta.originalUrl);
  const actualExtension = path.extname(new URL(source).pathname).toLowerCase().replace('.jpeg', '.jpg');

  /*
   * Brand logos do not live beside car photographs — they are
   * `public/images/brands/<brand>.<ext>`, one flat file per marque. Without a
   * form for that, every agent downloads the logo into the car folder and
   * either leaves it there or has to move it by hand; the first free-model
   * trial left a Fiat roundel at `public/images/cars/fiat/brand.png`.
   */
  const brand = /^brand:(.+)$/.exec(carSlug);
  const destination = brand
    ? path.join('public', 'images', 'brands', `${brand[1]}${actualExtension || extension}`)
    : path.join('public', 'images', 'cars', carSlug, `${basename}${actualExtension || extension}`);
  await mkdir(path.dirname(destination), { recursive: true });

  /*
   * The basename is a filename, and a second download under the same one used
   * to overwrite the first in silence. The first free-model trial run did
   * exactly that — three `gallery` downloads, one surviving file, two authored
   * `imageRef`s pointing at a picture of something else. Refuse instead.
   */
  const existing = await stat(destination).catch(() => null);
  if (existing) {
    throw new Error(
      `${destination} already exists (${Math.round(existing.size / 1024)} kB). ` +
        'The last argument is a filename, not a folder — use hero, gallery-1, gallery-2… ' +
        'Delete the file first if you really meant to replace it.',
    );
  }

  const response = await get(source, { timeoutMs: 120000 });
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination));

  // The whole point: measure what was written, never trust the requested width.
  const size = await measure(destination);
  const bytes = (await stat(destination)).size;

  const imageRef = {
    src: `/${destination.replace(/\\/g, '/').replace(/^public\//, '')}`,
    alt: 'TODO — describe what is visible, for a reader who cannot see it',
    // Omitted rather than nulled when unmeasurable: `measure` reads JPEG and
    // PNG headers only, so an SVG has no pixel size, and the schema takes an
    // absent width over a null one. Printing `null` handed an author a field
    // that fails validation.
    ...(size ? { width: size.width, height: size.height } : {}),
    caption: 'TODO',
    credit: {
      author: meta.author || undefined,
      title: file,
      sourceUrl: meta.pageUrl,
      licenseType: meta.licenseType,
      ...(meta.licenseShortName?.match(/(\d\.\d)/) ? { licenseVersion: meta.licenseShortName.match(/(\d\.\d)/)[1] } : {}),
      ...(meta.licenseUrl ? { licenseUrl: meta.licenseUrl } : {}),
    },
  };
  const measured = size ? `${size.width}x${size.height}` : 'vector (no pixel size)';
  console.error(`wrote ${destination}  ${measured}  ${Math.round(bytes / 1024)} kB  ${meta.licenseShortName}`);
  if (brand) {
    // The Commons licence describes the file's copyright. A marque badge is
    // used here on trademark nominative fair use, which is a different basis
    // with different obligations, and the schema requires the honest one.
    console.error(
      `NOTE: this is a brand mark. Set licenseType 'trademark-nominative-use' with a licenseNote, ` +
        `not '${meta.licenseType}' — see PLAYBOOK §1.4 rule 9.`,
    );
  }
  console.log(JSON.stringify(imageRef, null, 2));
}

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'find') await cmdFind(args[0]);
  else if (command === 'cat') await cmdCat(args[0]);
  else if (command === 'licence' || command === 'license') await cmdLicence(args[0]);
  else if (command === 'download') await cmdDownload(args[0], args[1], args[2] ?? 'hero');
  else {
    console.error('usage: commons.mjs find "Article" | cat "Category" | licence "File:X.jpg" | download "File:X.jpg" <car-slug> <basename>  (basename is a filename: hero, gallery-1, gallery-2; for a marque logo pass brand:<brand-id> as the slug)');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
