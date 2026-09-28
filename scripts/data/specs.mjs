#!/usr/bin/env node
/**
 * The non-Wikipedia sources, in one place.
 *
 *   node scripts/data/specs.mjs epa     2004 Toyota Prius
 *   node scripts/data/specs.mjs cvs     1995 "land rover"
 *   node scripts/data/specs.mjs ncap    2019 tesla "model 3"
 *   node scripts/data/specs.mjs recalls 2005 toyota prius
 *   node scripts/data/specs.mjs nrcan   bev Tesla "Model 3"
 *   node scripts/data/specs.mjs rdw     CITROEN "2CV"
 *
 * All six are public domain or openly licensed, and all six carry figures
 * Wikipedia does not. Every printed value states the unit it is in and, where
 * a conversion was applied, the factor — because the schema requires the
 * `sourceNote` to say so.
 *
 * See the design's 2026-08-18 addendum for what each source covers and
 * where it stops.
 */
import { getJson, getText, withQuery } from './lib/http.mjs';

const MPH_KM = 1.609344;
const MPG_L100 = 235.214583;
const CUFT_L = 28.316846592;

const round = (n, dp = 2) => Number(n.toFixed(dp));

// ---------------------------------------------------------------------------
// EPA fueleconomy.gov — US, model year 1984+, public domain
// ---------------------------------------------------------------------------

const EPA = 'https://www.fueleconomy.gov/ws/rest/vehicle';
const tag = (xml, name) => {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return m ? m[1] : null;
};
const tags = (xml, name) => [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'g'))].map((m) => m[1]);

async function cmdEpa(year, make, ...modelParts) {
  const model = modelParts.join(' ');
  const menu = await getText(withQuery(`${EPA}/menu/options`, { year, make, model }));
  const ids = tags(menu, 'value');
  const texts = tags(menu, 'text');
  if (ids.length === 0) {
    console.error(`No EPA record for ${year} ${make} ${model}.`);
    console.error(`Tip: EV model names are per-variant. List them with:`);
    console.error(`  curl "${EPA}/menu/model?year=${year}&make=${encodeURIComponent(make)}"`);
    process.exitCode = 1;
    return;
  }
  for (const [i, id] of ids.entries()) {
    const xml = await getText(`${EPA}/${id}`);
    const num = (n) => (tag(xml, n) === null ? null : Number(tag(xml, n)));
    const comb = num('comb08');
    const combE = num('combE');
    const co2 = num('co2TailpipeGpm');
    const lv = num('lv4') || num('hlv');
    console.log(`\n# ${year} ${make} ${model} — ${texts[i]} (vehicle ${id})`);
    console.log(`  url            ${EPA}/${id}`);
    if (comb) console.log(`  fuelEconomy    ${round(MPG_L100 / comb)} L/100km   (EPA combined ${comb} mpg US ÷ 235.214583)`);
    if (combE) console.log(`  electricCons   ${round(combE / MPH_KM)} kWh/100km (EPA ${combE} kWh/100mi ÷ 1.609344, measured at the wall)`);
    if (num('range')) console.log(`  electricRange  ${Math.round(num('range') * MPH_KM)} km        (EPA ${num('range')} mi × 1.609344)`);
    if (co2) console.log(`  co2            ${round(co2 / MPH_KM, 1)} g/km      (EPA ${round(co2, 1)} g/mi ÷ 1.609344, US cycle)`);
    if (lv) console.log(`  bootVolume     ${Math.round(lv * CUFT_L)} L         (EPA ${lv} cu ft × 28.3168; US method ≠ VDA)`);
    if (tag(xml, 'evMotor')) console.log(`  power          ${tag(xml, 'evMotor')}  ← the only public figure for most EVs`);
    console.log(`  NOTE: EPA changed methodology in 2008 and recalculated older cars.`);
  }
}

// ---------------------------------------------------------------------------
// NHTSA Canadian Vehicle Specifications — 1971+, public domain, has KERB WEIGHT
// ---------------------------------------------------------------------------

async function cmdCvs(year, ...makeParts) {
  const make = makeParts.join(' ');
  const url = withQuery('https://vpic.nhtsa.dot.gov/api/vehicles/GetCanadianVehicleSpecifications/', {
    Year: year, Make: make, units: 'Metric', format: 'json',
  });
  const data = await getJson(url);
  console.log(`${data.Count} record(s) — ${url}\n`);
  for (const row of data.Results ?? []) {
    const spec = Object.fromEntries(row.Specs.filter((s) => s.Value).map((s) => [s.Name, s.Value]));
    if (!spec.Model) continue;
    console.log(`${spec.Model}  (model year ${spec.MYR ?? '?'})`);
    if (spec.CW) console.log(`   mass       ${spec.CW} kg      (curb weight, Canadian market)`);
    if (spec.OL) console.log(`   length     ${Number(spec.OL) * 10} mm  (published ${spec.OL} cm)`);
    if (spec.OW) console.log(`   width      ${Number(spec.OW) * 10} mm  (published ${spec.OW} cm)`);
    if (spec.OH) console.log(`   height     ${Number(spec.OH) * 10} mm  (published ${spec.OH} cm)`);
    if (spec.WB) console.log(`   wheelbase  ${Number(spec.WB) * 10} mm  (published ${spec.WB} cm)`);
    if (spec.WD) console.log(`   weight distribution ${spec.WD} front/rear  ← no schema field yet`);
    console.log('');
  }
  if (!data.Count) console.error('No records. CVS stamps a model year (MYR) that can differ from the year queried — try year±1.');
}

// ---------------------------------------------------------------------------
// NHTSA NCAP safety ratings and recalls — public domain
// ---------------------------------------------------------------------------

async function cmdNcap(year, make, ...modelParts) {
  const model = modelParts.join(' ');
  const list = await getJson(`https://api.nhtsa.gov/SafetyRatings/modelyear/${year}/make/${encodeURIComponent(make)}/model/${encodeURIComponent(model)}`);
  for (const v of list.Results ?? []) {
    const detail = await getJson(`https://api.nhtsa.gov/SafetyRatings/VehicleId/${v.VehicleId}`);
    const r = detail.Results?.[0] ?? {};
    console.log(`${r.VehicleDescription}`);
    console.log(`   overall ${r.OverallRating}  front ${r.OverallFrontCrashRating}  side ${r.OverallSideCrashRating}  rollover ${r.RolloverRating} (P=${r.RolloverPossibility})`);
    console.log(`   complaints ${r.ComplaintsCount}  recalls ${r.RecallsCount}\n`);
  }
  if (!list.Count) console.error('No NCAP record. The five-star scheme only covers model year 2011 onwards.');
}

async function cmdRecalls(year, make, ...modelParts) {
  const model = modelParts.join(' ');
  const data = await getJson(withQuery('https://api.nhtsa.gov/recalls/recallsByVehicle', { make, model, modelYear: year }));
  console.log(`${data.Count} recall campaign(s) for ${year} ${make} ${model}\n`);
  for (const r of data.results ?? []) {
    console.log(`${r.NHTSACampaignNumber}  ${r.Component}`);
    console.log(`   ${(r.Summary ?? '').slice(0, 220)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Natural Resources Canada — metric, and the only free source of a COMBINED
// system output for dual-motor EVs
// ---------------------------------------------------------------------------

const NRCAN_PACKAGE = '98f1a129-f628-4ce4-b24d-6f16bf24dd64';

async function nrcanCsvUrl(kind) {
  const pkg = await getJson(`https://open.canada.ca/data/api/3/action/package_show?id=${NRCAN_PACKAGE}`);
  const wanted = { bev: 'battery-electric', phev: 'plug-in-hybrid', fuel: 'fuel-consumption-ratings' }[kind];
  const match = (pkg.result.resources ?? []).find(
    (r) => r.format === 'CSV' && (r.url ?? '').includes(wanted) && !(r.url ?? '').includes('/am'),
  );
  if (!match) throw new Error(`No NRCan CSV found for "${kind}". Try: bev | phev | fuel`);
  return match.url;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c !== '\r') field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

async function cmdNrcan(kind, make, ...modelParts) {
  const model = modelParts.join(' ').toLowerCase();
  const url = await nrcanCsvUrl(kind);
  const rows = parseCsv(await getText(url));
  const header = rows[0].map((h) => h.trim());
  const matches = rows.slice(1).filter(
    (r) => r.length > 3 && r[1]?.toLowerCase() === make.toLowerCase() && r[2]?.toLowerCase().includes(model),
  );
  console.log(`${matches.length} row(s) — ${url}\n`);
  console.log(header.join(' | '), '\n');
  for (const r of matches) console.log(r.join(' | '));
  console.log('\nAll figures are already SI (kW, km, kWh/100 km, g/km) — no conversion needed.');
  console.log('Motor (kW) on a dual-motor car is a COMBINED system output, unlike EPA per-motor ratings.');
}

// ---------------------------------------------------------------------------
// RDW (Netherlands) — registered vehicles, including classics
// ---------------------------------------------------------------------------

async function cmdRdw(make, ...modelParts) {
  const model = modelParts.join(' ');
  // The wildcard is a literal `%` here: withQuery() URL-encodes the whole
  // parameter once. Pre-encoding it as %25 double-encodes and matches nothing.
  const where = `merk='${make.toUpperCase().replace(/'/g, "''")}' AND handelsbenaming like '%${model.toUpperCase().replace(/'/g, "''")}%'`;
  const rows = await getJson(withQuery('https://opendata.rdw.nl/resource/m9d7-ebf2.json', { $limit: '8', $where: where }));
  console.log(`${rows.length} registered vehicle(s) matching ${make} ${model}\n`);
  for (const r of rows) {
    console.log(`${r.handelsbenaming}  (first admitted ${r.datum_eerste_toelating ?? '?'})`);
    if (r.massa_ledig_voertuig) console.log(`   mass        ${r.massa_ledig_voertuig} kg   (massa ledig voertuig — kerb)`);
    if (r.wielbasis) console.log(`   wheelbase   ${Number(r.wielbasis) * 10} mm  (published ${r.wielbasis} cm)`);
    if (r.cilinderinhoud) console.log(`   displacement ${r.cilinderinhoud} cc`);
    if (r.aantal_zitplaatsen) console.log(`   seats       ${r.aantal_zitplaatsen}`);
    if (r.aantal_deuren) console.log(`   doors       ${r.aantal_deuren}`);
    if (r.catalogusprijs) console.log(`   list price  €${r.catalogusprijs} (as registered)`);
    console.log('');
  }
  console.log('CAUTION: these are registration records for individual cars, not manufacturer');
  console.log('specifications. Check several plates agree before using a figure, and say in the');
  console.log('sourceNote that it is Dutch registration data for that year.');
}

// ---------------------------------------------------------------------------

const [command, ...args] = process.argv.slice(2);
try {
  if (command === 'epa') await cmdEpa(...args);
  else if (command === 'cvs') await cmdCvs(...args);
  else if (command === 'ncap') await cmdNcap(...args);
  else if (command === 'recalls') await cmdRecalls(...args);
  else if (command === 'nrcan') await cmdNrcan(...args);
  else if (command === 'rdw') await cmdRdw(...args);
  else {
    console.error('usage: specs.mjs <epa|cvs|ncap|recalls|nrcan|rdw> …  (see the header of this file)');
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exitCode = 1;
}
