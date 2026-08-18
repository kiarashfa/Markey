#!/usr/bin/env node
/**
 * Do the authored image dimensions match the files actually on disk?
 *
 *   node scripts/data/audit-images.mjs          # report
 *   node scripts/data/audit-images.mjs --fix    # rewrite the JSON from the files
 *
 * This exists because of the worst thing that happened in Phase 10: **all
 * twelve authored images had the wrong width and height**, because the numbers
 * were computed from the thumbnail width *requested* from Commons rather than
 * measured from the bytes received. Commons serves the nearest standard size —
 * ask for 1600 and you get 1920 — so every figure was wrong, nothing failed,
 * the build passed, and the only symptom would have been layout shift on every
 * car page.
 *
 * It is exactly the class of error the integrity checks cannot catch: the data
 * is well-formed, it is simply untrue. So it gets its own check.
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const CAR_DIR = 'src/content/carData';
const fix = process.argv.includes('--fix');

/** Real pixel dimensions from the file header — JPEG SOF markers or PNG IHDR. */
function measure(file) {
  const data = readFileSync(file);
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

let checked = 0;
let wrong = 0;
let missing = 0;

for (const file of readdirSync(CAR_DIR).filter((f) => f.endsWith('.json'))) {
  const carPath = path.join(CAR_DIR, file);
  const car = JSON.parse(readFileSync(carPath, 'utf8'));
  const images = [...(car.hero ? [car.hero] : []), ...(car.gallery ?? [])];
  let dirty = false;

  for (const image of images) {
    // An absolute URL is a hosted original we do not ship; nothing to measure.
    if (/^https?:\/\//.test(image.src)) continue;
    const onDisk = path.join('public', image.src.replace(/^\//, ''));
    checked += 1;

    if (!existsSync(onDisk)) {
      console.log(`MISSING FILE  ${image.src}  (referenced by ${file})`);
      missing += 1;
      continue;
    }
    const real = measure(onDisk);
    if (!real) {
      console.log(`UNREADABLE    ${image.src}`);
      continue;
    }
    if (image.width !== real.width || image.height !== real.height) {
      wrong += 1;
      console.log(
        `MISMATCH      ${image.src}\n` +
          `              authored ${image.width}x${image.height}   real ${real.width}x${real.height}`,
      );
      if (fix) {
        image.width = real.width;
        image.height = real.height;
        dirty = true;
      }
    }
  }
  if (dirty) writeFileSync(carPath, `${JSON.stringify(car, null, 2)}\n`, 'utf8');
}

console.log(`\n${checked} image(s) checked · ${wrong} mismatched · ${missing} missing.`);
if (wrong > 0 && !fix) {
  console.log('Re-run with --fix to rewrite the JSON from the files on disk.');
  process.exitCode = 1;
}
if (missing > 0) process.exitCode = 1;
