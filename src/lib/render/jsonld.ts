/**
 * JSON-LD structured data — SPEC.md §12, and the §16 open item it closes.
 *
 * ## The type choice, which §16 left open
 *
 * `schema.org/Car`. Not `Product`, and not both.
 *
 * `Car` **is** a `Product` — the hierarchy is `Thing > Product > Vehicle > Car`
 * — so emitting both would be one object claiming two types where the narrower
 * one already implies the wider. And `Car` is the only one of the two that
 * carries the vocabulary these pages are actually about: `vehicleEngine`,
 * `driveWheelConfiguration`, `accelerationTime`, `speed`, `weightTotal`. Every
 * property emitted here was checked against schema.org rather than assumed, and
 * `jsonld.test.ts` holds this module to the checked list.
 *
 * ## What is deliberately not claimed
 *
 * **No `offers`, no price, no availability.** Google's vehicle rich result is a
 * *listing* type — it describes a specific car for sale by a specific seller.
 * These pages are encyclopedia entries. Marking one up as a listing would be
 * false: there is no seller, no stock, and no car. The catalogue does hold
 * historical prices, and they are exactly the wrong thing to put in an `offer`,
 * because a 1976 launch price is not an offer to sell anyone anything.
 *
 * What that costs is real: without `offers` this is not eligible for a
 * merchant-style rich result. What it buys is markup that says only true
 * things. The `BreadcrumbList` below is the part search engines do render, and
 * it is true on every page that has breadcrumbs.
 *
 * ## The trim problem
 *
 * A generation has several trims with different power, mass and performance,
 * and one `Car` object has one `vehicleEngine`. Picking the fastest would
 * flatter the entry; picking the first would be arbitrary. So the engine and
 * performance block describes **one named trim**, and the object says which one
 * in an `additionalProperty` — a reader or a crawler can see the figures belong
 * to the 2.0 six-speed manual rather than to "the car" in general.
 */
import type { CarData } from '../../schemas/car.ts';
import type { PropertyValue } from '../../schemas/primitives.ts';
import { labelFor } from '../../schemas/taxonomy.ts';

/** UN/CEFACT Common Codes — the unit vocabulary `QuantitativeValue` expects. */
export const UNIT = {
  kilogram: 'KGM',
  kilometrePerHour: 'KMH',
  kilowatt: 'KWT',
  newtonMetre: 'NU',
  cubicCentimetre: 'CMQ',
  second: 'SEC',
  millimetre: 'MMT',
} as const;

export interface QuantitativeValue {
  '@type': 'QuantitativeValue';
  value: number;
  unitCode?: string;
  unitText?: string;
}

const number = (pv: PropertyValue | undefined): number | null =>
  pv && pv.value !== null ? pv.value : null;

/**
 * A measurement, or nothing at all.
 *
 * The whole module is built on this: a figure the catalogue does not have is
 * **absent from the markup**, never zero and never an empty string. Structured
 * data is read by machines that cannot tell a placeholder from a measurement,
 * so the honesty rule matters more here than anywhere a person can see it.
 */
function quantity(
  pv: PropertyValue | undefined,
  unitCode?: string,
  unitText?: string,
): QuantitativeValue | undefined {
  const value = number(pv);
  if (value === null) return undefined;
  const out: QuantitativeValue = { '@type': 'QuantitativeValue', value };
  if (unitCode) out.unitCode = unitCode;
  if (unitText) out.unitText = unitText;
  return out;
}

/** Drops every key whose value is undefined, recursively through objects. */
function prune<T extends Record<string, unknown>>(input: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      if (value.length > 0) out[key] = value;
      continue;
    }
    if (typeof value === 'object') {
      const nested = prune(value as Record<string, unknown>);
      // An object left with nothing but its @type says nothing.
      if (Object.keys(nested).filter((k) => k !== '@type').length > 0) out[key] = nested;
      continue;
    }
    if (typeof value === 'string' && value.trim() === '') continue;
    out[key] = value;
  }
  return out as T;
}

/**
 * The trim whose figures the markup describes.
 *
 * The best-documented one, by the same rule `lib/content/testDrive.ts` uses to
 * choose what to model — so the structured data and the Test Drive panel are
 * talking about the same car, which they would not be if each picked its own.
 */
export function describedTrim(car: CarData): CarData['trims'][number] | undefined {
  return [...car.trims]
    .map((trim) => ({
      trim,
      present: [
        number(trim.power),
        number(trim.torque),
        number(trim.mass),
        number(trim.topSpeed),
        number(trim.zeroToHundredKph),
      ].filter((v) => v !== null).length,
    }))
    .sort((a, b) => b.present - a.present)[0]?.trim;
}

/** `fuelType` and `driveWheelConfiguration` read better as words than as tags. */
const term = (axis: string, id: string | undefined): string | undefined =>
  id ? (labelFor(axis, id) ?? id) : undefined;

export interface CarJsonLdInput {
  car: CarData;
  brandName: string;
  /** Absolute URL of the page this describes. */
  url: string;
  /** Absolute URL of the hero image, where there is one. */
  imageUrl?: string;
  /** The page's own description — the same one the meta tag carries. */
  description?: string;
}

/**
 * `schema.org/Car` for one catalogue entry.
 *
 * A model hub gets the identity half and no performance: a nameplate spanning
 * forty years has no engine, and giving it one trim's would be a claim about
 * the wrong car.
 */
export function carJsonLd(input: CarJsonLdInput): Record<string, unknown> {
  const { car, brandName, url, imageUrl, description } = input;
  const isHub = car.kind === 'model';
  const trim = isHub ? undefined : describedTrim(car);

  const engine = trim
    ? prune({
        '@type': 'EngineSpecification',
        enginePower: quantity(trim.power, UNIT.kilowatt),
        torque: quantity(trim.torque, UNIT.newtonMetre),
        engineDisplacement: quantity(trim.engine?.displacement, UNIT.cubicCentimetre),
        engineType: trim.engine?.configuration,
        fuelType: term('powertrain', trim.powertrain),
      })
    : undefined;

  const additional: Record<string, unknown>[] = [];
  if (car.generationCode) {
    additional.push({
      '@type': 'PropertyValue',
      name: 'Generation code',
      value: car.generationCode,
    });
  }
  // Production years as text, because `productionDate` is a single Date and a
  // generation is a span. Losing the end year would be the quiet kind of wrong.
  additional.push({
    '@type': 'PropertyValue',
    name: 'Production years',
    value:
      car.productionYears.end === null
        ? `${car.productionYears.start}–present`
        : `${car.productionYears.start}–${car.productionYears.end}`,
  });
  if (trim) {
    additional.push({
      '@type': 'PropertyValue',
      name: 'Figures describe trim',
      value: trim.name,
    });
  }
  const cd = trim ? number(trim.dragCoefficient) : null;
  if (cd !== null) {
    additional.push({ '@type': 'PropertyValue', name: 'Drag coefficient', value: cd });
  }

  return prune({
    '@context': 'https://schema.org',
    '@type': 'Car',
    name: car.fullName ?? car.name,
    alternateName: car.fullName ? car.name : undefined,
    description,
    url,
    image: imageUrl,
    brand: prune({ '@type': 'Brand', name: brandName }),
    manufacturer: prune({ '@type': 'Organization', name: brandName }),
    model: car.name,
    vehicleModelDate: String(car.productionYears.start),
    productionDate: String(car.productionYears.start),
    bodyType: car.bodyStyles.map((id) => term('body-style', id)).filter(Boolean)[0],
    fuelType: trim
      ? term('powertrain', trim.powertrain)
      : car.powertrains.map((id) => term('powertrain', id)).filter(Boolean)[0],
    driveWheelConfiguration: trim
      ? term('drivetrain', trim.drivetrain)
      : car.drivetrains.map((id) => term('drivetrain', id)).filter(Boolean)[0],
    vehicleTransmission: trim?.transmission,
    numberOfForwardGears: trim?.gears,
    vehicleEngine: engine,
    speed: trim ? quantity(trim.topSpeed, UNIT.kilometrePerHour) : undefined,
    accelerationTime: trim ? quantity(trim.zeroToHundredKph, UNIT.second) : undefined,
    weightTotal: trim ? quantity(trim.mass, UNIT.kilogram) : undefined,
    fuelConsumption: trim
      ? quantity(trim.fuelEconomy, undefined, 'L/100 km')
      : undefined,
    height: quantity(car.dimensions?.height, UNIT.millimetre),
    width: quantity(car.dimensions?.width, UNIT.millimetre),
    additionalProperty: additional,
  });
}

export interface Crumb {
  label: string;
  /** Absolute URL. A crumb without one is the current page and is dropped. */
  url?: string;
}

/**
 * `BreadcrumbList` — the one type here that search engines actually render.
 *
 * The final crumb is the current page and carries no `item`, which is what the
 * spec calls for: a breadcrumb trail ends where you are, and linking a page to
 * itself is noise.
 */
export function breadcrumbJsonLd(crumbs: Crumb[]): Record<string, unknown> | null {
  if (crumbs.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((crumb, index) =>
      prune({
        '@type': 'ListItem',
        position: index + 1,
        name: crumb.label,
        item: crumb.url,
      }),
    ),
  };
}

/**
 * Serialised for a `<script type="application/ld+json">`.
 *
 * `<` is escaped because a `</script>` inside a JSON string would close the
 * element early and spill the rest of the data into the document as markup.
 * Nothing in the catalogue contains one today; this is not the kind of thing to
 * find out about later.
 */
export function serialiseJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
