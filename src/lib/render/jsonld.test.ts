import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFile } from 'node:fs/promises';

import { UNIT, breadcrumbJsonLd, carJsonLd, describedTrim, serialiseJsonLd } from './jsonld.ts';
import { carDataSchema, type CarData } from '../../schemas/car.ts';

/**
 * Every property this module may emit, and the type it belongs to.
 *
 * **Checked against schema.org, not remembered.** The Rich Results Test needs a
 * deployed URL and cannot run here, so this list is the offline gate: a
 * property that is not on it fails the build, which means adding one is a
 * deliberate act that starts with looking it up.
 */
const ALLOWED = {
  Car: new Set([
    '@context',
    '@type',
    // Thing
    'name',
    'alternateName',
    'description',
    'url',
    'image',
    // Product
    'brand',
    'manufacturer',
    'model',
    'additionalProperty',
    'height',
    'width',
    // Vehicle
    'vehicleModelDate',
    'productionDate',
    'bodyType',
    'fuelType',
    'driveWheelConfiguration',
    'vehicleTransmission',
    'numberOfForwardGears',
    'vehicleEngine',
    'speed',
    'accelerationTime',
    'weightTotal',
    'fuelConsumption',
  ]),
  EngineSpecification: new Set([
    '@type',
    'enginePower',
    'torque',
    'engineDisplacement',
    'engineType',
    'fuelType',
  ]),
  QuantitativeValue: new Set(['@type', 'value', 'unitCode', 'unitText']),
  PropertyValue: new Set(['@type', 'name', 'value']),
  Brand: new Set(['@type', 'name']),
  Organization: new Set(['@type', 'name']),
  BreadcrumbList: new Set(['@context', '@type', 'itemListElement']),
  ListItem: new Set(['@type', 'position', 'name', 'item']),
} as const;

/** Walks the object and holds every node to the allow-list for its `@type`. */
function assertAllowed(node: unknown, path = '$'): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => assertAllowed(item, `${path}[${i}]`));
    return;
  }
  if (node === null || typeof node !== 'object') return;

  const object = node as Record<string, unknown>;
  const type = object['@type'];
  assert.ok(typeof type === 'string', `${path} has no @type`);
  const allowed = ALLOWED[type as keyof typeof ALLOWED];
  assert.ok(allowed, `${path}: @type "${type}" is not one this module may emit`);

  for (const key of Object.keys(object)) {
    assert.ok(allowed.has(key), `${path}: "${key}" is not a checked property of ${type}`);
    assertAllowed(object[key], `${path}.${key}`);
  }
}

/** Nothing empty, ever — structured data is read by things that cannot tell. */
function assertNoEmptyValues(node: unknown, path = '$'): void {
  if (Array.isArray(node)) {
    assert.ok(node.length > 0, `${path} is an empty array`);
    node.forEach((item, i) => assertNoEmptyValues(item, `${path}[${i}]`));
    return;
  }
  if (node === null) assert.fail(`${path} is null`);
  if (typeof node === 'object') {
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      assertNoEmptyValues(value, `${path}.${key}`);
    }
    return;
  }
  if (typeof node === 'string') assert.ok(node.trim().length > 0, `${path} is an empty string`);
  if (typeof node === 'number') assert.ok(Number.isFinite(node), `${path} is not a finite number`);
}

/**
 * The real content, through the real schema.
 *
 * Parsed rather than `JSON.parse`d because the schema is where the defaults
 * live — an entry that omits `bodyStyles` gets `[]` from zod, and testing
 * against the raw file would be testing a shape the renderer never sees.
 */
const load = async (slug: string): Promise<CarData> =>
  carDataSchema.parse(
    JSON.parse(
      await readFile(new URL(`../../content/carData/${slug}.json`, import.meta.url), 'utf8'),
    ),
  );

// ---------------------------------------------------------------------------

describe('car JSON-LD', () => {
  it('emits only properties checked against schema.org', async () => {
    for (const slug of ['toyota-86-zn6', 'toyota-86', 'bmw-6-series-e24', 'bmw-6-series']) {
      const data = carJsonLd({
        car: await load(slug),
        brandName: 'Test Brand',
        url: `https://example.com/cars/${slug}/`,
        imageUrl: 'https://example.com/hero.jpg',
        description: 'A description.',
      });
      assertAllowed(data, slug);
      assertNoEmptyValues(data, slug);
    }
  });

  it('describes the fully-sourced car with its real figures', async () => {
    const data = carJsonLd({
      car: await load('toyota-86-zn6'),
      brandName: 'Toyota',
      url: 'https://example.com/cars/toyota-86-zn6/',
      description: 'The 86.',
    });

    assert.equal(data['@type'], 'Car');
    assert.equal(data['@context'], 'https://schema.org');
    assert.deepEqual(data.brand, { '@type': 'Brand', name: 'Toyota' });
    assert.deepEqual(data.speed, {
      '@type': 'QuantitativeValue',
      value: 233,
      unitCode: UNIT.kilometrePerHour,
    });
    assert.deepEqual(data.accelerationTime, {
      '@type': 'QuantitativeValue',
      value: 7.6,
      unitCode: UNIT.second,
    });
    assert.deepEqual(data.weightTotal, {
      '@type': 'QuantitativeValue',
      value: 1190,
      unitCode: UNIT.kilogram,
    });
    const engine = data.vehicleEngine as Record<string, unknown>;
    assert.deepEqual(engine.enginePower, {
      '@type': 'QuantitativeValue',
      value: 147,
      unitCode: UNIT.kilowatt,
    });
    assert.deepEqual(engine.torque, {
      '@type': 'QuantitativeValue',
      value: 205,
      unitCode: UNIT.newtonMetre,
    });
  });

  it('names the trim its figures belong to, rather than implying they are the car', async () => {
    const car = await load('toyota-86-zn6');
    const data = carJsonLd({ car, brandName: 'Toyota', url: 'https://example.com/' });
    const props = data.additionalProperty as { name: string; value: unknown }[];
    const named = props.find((p) => p.name === 'Figures describe trim');
    assert.ok(named, 'no trim named');
    assert.equal(named.value, describedTrim(car)!.name);
  });

  it('keeps the whole production span, which productionDate alone cannot', async () => {
    const car = await load('bmw-6-series-e24');
    const data = carJsonLd({ car, brandName: 'BMW', url: 'https://example.com/' });
    const props = data.additionalProperty as { name: string; value: unknown }[];
    assert.equal(props.find((p) => p.name === 'Production years')?.value, '1976–1989');
    assert.equal(data.productionDate, '1976');
  });

  it('gives a model hub no engine and no performance', async () => {
    const car = await load('toyota-86');
    assert.equal(car.kind, 'model');
    const data = carJsonLd({ car, brandName: 'Toyota', url: 'https://example.com/' });
    assert.equal(data.vehicleEngine, undefined);
    assert.equal(data.speed, undefined);
    assert.equal(data.accelerationTime, undefined);
    assert.equal(data.name, 'Toyota 86');
  });

  it('omits a figure the catalogue does not have rather than emitting a zero', async () => {
    const car = await load('bmw-6-series-e24');
    const data = carJsonLd({ car, brandName: 'BMW', url: 'https://example.com/' });
    // The E24 is the deliberately sparse entry. Whatever is missing must be
    // absent from the markup, and nothing present may be an empty husk.
    assertNoEmptyValues(data, 'e24');
    for (const key of ['speed', 'accelerationTime', 'weightTotal']) {
      const value = data[key];
      if (value !== undefined) {
        assert.ok(
          typeof (value as { value: number }).value === 'number',
          `${key} is present but carries no number`,
        );
      }
    }
  });

  it('claims no offer, price or availability', async () => {
    const car = await load('toyota-86-zn6');
    const serialised = serialiseJsonLd(carJsonLd({ car, brandName: 'Toyota', url: 'https://x/' }));
    for (const forbidden of ['offers', 'price', 'availability', 'seller', 'aggregateRating']) {
      assert.ok(!serialised.includes(`"${forbidden}"`), `markup claims ${forbidden}`);
    }
  });
});

describe('breadcrumb JSON-LD', () => {
  it('numbers the trail from one and leaves the last item unlinked', () => {
    const data = breadcrumbJsonLd([
      { label: 'Cars', url: 'https://example.com/cars/' },
      { label: 'Toyota', url: 'https://example.com/brands/toyota/' },
      { label: 'Toyota 86 (ZN6)' },
    ])!;
    assertAllowed(data);
    const items = data.itemListElement as Record<string, unknown>[];
    assert.equal(items.length, 3);
    assert.deepEqual(
      items.map((i) => i.position),
      [1, 2, 3],
    );
    assert.equal(items[2]!.item, undefined);
    assert.equal(items[0]!.item, 'https://example.com/cars/');
  });

  it('emits nothing for a trail too short to be one', () => {
    assert.equal(breadcrumbJsonLd([{ label: 'Cars', url: 'https://example.com/cars/' }]), null);
    assert.equal(breadcrumbJsonLd([]), null);
  });
});

describe('serialisation', () => {
  it('is valid JSON', async () => {
    const car = await load('toyota-86-zn6');
    const text = serialiseJsonLd(carJsonLd({ car, brandName: 'Toyota', url: 'https://x/' }));
    assert.doesNotThrow(() => JSON.parse(text.replace(/\\u003c/g, '<')));
  });

  it('cannot close the script element it sits in', () => {
    const text = serialiseJsonLd({ '@type': 'Thing', name: '</script><img onerror=x>' });
    assert.ok(!text.includes('</script>'));
    assert.ok(text.includes('\\u003c/script'));
  });
});
