/**
 * The flattened catalogue — SPEC.md §9.1.
 *
 * One builder, used by three consumers: the `/catalogue.json` machine-readable
 * export, the catalog island, and the comparison and matchmaker tools. That is
 * the whole point — SPEC.md §9.1 requires the structured index to be generated
 * "from the same content the pages render from" so the two can never disagree
 * about what matches.
 *
 * Everything here is plain serializable data. Islands receive it across the
 * server/client boundary, so no schema types, no `Map`s, no functions.
 */
import { getBrands, getCars, erasFor, type JoinedBrand, type JoinedCar } from './entries.ts';
import { carHref, imageSrc } from './href.ts';
import { countrySlug } from './taxonomy-views.ts';
import type { PropertyValue } from '../../schemas/primitives.ts';

/** Unwraps a `PropertyValue` to a bare number, or null when there is no figure. */
function value(pv: PropertyValue | undefined): number | null {
  return pv && pv.value !== null ? pv.value : null;
}

export interface CatalogueTrim {
  id: string;
  name: string;
  drivetrain: string;
  powertrain: string;
  yearStart: number;
  yearEnd: number | null;
  powerKw: number | null;
  torqueNm: number | null;
  massKg: number | null;
  zeroToHundredS: number | null;
  topSpeedKmh: number | null;
  consumptionL100km: number | null;
  electricConsumptionKwh100km: number | null;
  dragCoefficient: number | null;
  frontalAreaM2: number | null;
  price: number | null;
  priceCurrency: string | null;
}

export interface CatalogueCar {
  id: string;
  name: string;
  fullName: string | null;
  kind: string;
  parent: string | null;
  url: string;
  generationCode: string | null;

  brandId: string;
  brandName: string;
  accentColor: string;
  logoSrc: string;
  country: string;
  countryId: string;

  bodyStyles: string[];
  powertrains: string[];
  drivetrains: string[];
  segment: string | null;
  positioning: string | null;
  eras: string[];

  yearStart: number;
  yearEnd: number | null;

  heroSrc: string | null;
  heroAlt: string | null;

  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;

  trims: CatalogueTrim[];

  /**
   * Headline figures for sorting and filtering, taken as the best or only
   * value across the entry's trims.
   *
   * Precomputed rather than derived in the UI so every consumer sorts on the
   * same number — a comparison tool and a catalog disagreeing about which car
   * is faster would be exactly the failure the shared builder exists to stop.
   */
  powerKwMax: number | null;
  zeroToHundredMinS: number | null;
  topSpeedMaxKmh: number | null;
  consumptionMinL100km: number | null;
  massMinKg: number | null;
  priceMin: number | null;
}

function toTrim(trim: JoinedCar['data']['trims'][number]): CatalogueTrim {
  const firstPrice = trim.prices[0];
  return {
    id: trim.id,
    name: trim.name,
    drivetrain: trim.drivetrain,
    powertrain: trim.powertrain,
    yearStart: trim.productionYears.start,
    yearEnd: trim.productionYears.end,
    powerKw: value(trim.power),
    torqueNm: value(trim.torque),
    massKg: value(trim.mass),
    zeroToHundredS: value(trim.zeroToHundredKph),
    topSpeedKmh: value(trim.topSpeed),
    consumptionL100km: value(trim.fuelEconomy),
    electricConsumptionKwh100km: value(trim.electricConsumption),
    dragCoefficient: value(trim.dragCoefficient),
    frontalAreaM2: value(trim.frontalArea),
    price: firstPrice?.amount ?? null,
    priceCurrency: firstPrice?.currency ?? null,
  };
}

/** Smallest non-null value, or null when nothing was recorded. */
function minOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? Math.min(...present) : null;
}

function maxOf(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? Math.max(...present) : null;
}

export function toCatalogueCar(
  car: JoinedCar,
  brand: JoinedBrand,
  allCars: JoinedCar[],
): CatalogueCar {
  const { data } = car;
  const trims = data.trims.map(toTrim);

  return {
    id: car.id,
    name: data.name,
    fullName: data.fullName ?? null,
    kind: data.kind,
    parent: data.parent,
    url: carHref(car.id),
    generationCode: data.generationCode ?? null,

    brandId: brand.id,
    brandName: brand.data.name,
    accentColor: brand.data.accentColor,
    logoSrc: imageSrc(brand.data.logo.src),
    country: brand.data.countryOfOrigin,
    countryId: countrySlug(brand.data.countryOfOrigin),

    bodyStyles: data.bodyStyles,
    powertrains: data.powertrains,
    drivetrains: data.drivetrains,
    segment: data.segment ?? null,
    positioning: data.positioning ?? null,
    eras: erasFor(car, allCars),

    yearStart: data.productionYears.start,
    yearEnd: data.productionYears.end,

    heroSrc: data.hero ? imageSrc(data.hero.src) : null,
    heroAlt: data.hero?.alt ?? null,

    lengthMm: value(data.dimensions?.length),
    widthMm: value(data.dimensions?.width),
    heightMm: value(data.dimensions?.height),

    trims,

    powerKwMax: maxOf(trims.map((t) => t.powerKw)),
    zeroToHundredMinS: minOf(trims.map((t) => t.zeroToHundredS)),
    topSpeedMaxKmh: maxOf(trims.map((t) => t.topSpeedKmh)),
    consumptionMinL100km: minOf(trims.map((t) => t.consumptionL100km)),
    massMinKg: minOf(trims.map((t) => t.massKg)),
    priceMin: minOf(trims.map((t) => t.price)),
  };
}

/**
 * Every entry that carries specifications.
 *
 * Model hubs are excluded for the same reason taxonomy views exclude them: a
 * hub spanning forty years has no single set of specifications to filter or
 * sort on, and including it would put a row in the table that no column
 * describes.
 */
export async function buildCatalogue(): Promise<CatalogueCar[]> {
  const [cars, brands] = await Promise.all([getCars(), getBrands()]);
  const brandsById = new Map(brands.map((b) => [b.id, b]));

  return cars
    .filter((car) => car.data.kind !== 'model')
    .map((car) => toCatalogueCar(car, brandsById.get(car.data.brandRef)!, cars))
    .sort((a, b) => a.brandName.localeCompare(b.brandName) || a.yearStart - b.yearStart);
}
