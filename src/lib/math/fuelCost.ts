/**
 * Running cost.
 *
 * Energy or fuel cost from consumption × price × distance. Regional numbers
 * come from **both** curated presets and fully editable override fields: the
 * preset pre-fills, nothing is locked. A visitor in a country with no preset,
 * or with a workplace charger, or buying diesel at a supermarket, is not
 * second-class — they type their own number and the maths is identical.
 *
 * Fuel prices are the most perishable data on the site. They are therefore
 * presets a user is *expected* to edit, each stamped with the date it was
 * gathered, and never presented as current market data.
 */

export type EnergyType = 'petrol' | 'diesel' | 'electricity';

export interface PricePreset {
  id: string;
  label: string;
  /** Currency code, ISO 4217. */
  currency: string;
  /** Price per litre, or per kWh for electricity. */
  price: number;
  unit: 'per-litre' | 'per-kwh';
  energyType: EnergyType;
  /** When this figure was gathered — it starts going stale immediately. */
  asOf: string;
  source?: string;
}

/**
 * Starter presets.
 *
 * **These are placeholders, deliberately.** Real sourced figures with citations
 * arrive with the pilot content batch; shipping invented prices would be
 * exactly the fabrication the whole project forbids. Until then the UI must
 * show these as unsourced starting points, and `sourced: false` is what tells
 * it to.
 */
export const PRICE_PRESETS: (PricePreset & { sourced: boolean })[] = [
  {
    id: 'custom',
    label: 'Enter my own price',
    currency: 'EUR',
    price: 0,
    unit: 'per-litre',
    energyType: 'petrol',
    asOf: '',
    sourced: false,
  },
];

export interface FuelCostInputs {
  /** L/100 km, or kWh/100 km for an electric car. */
  consumptionPer100km: number;
  /** Price per litre or per kWh, matching the consumption unit. */
  pricePerUnit: number;
  /** Distance to cost, km. */
  distanceKm: number;
}

export interface FuelCostResult {
  /** Total energy or fuel used over the distance. */
  unitsUsed: number;
  /** Cost over the distance, in whatever currency the price was given in. */
  cost: number;
  costPer100km: number;
  costPerKm: number;
}

/**
 * Cost of covering a distance.
 *
 * Currency-agnostic on purpose: the caller supplies a price and gets an answer
 * in the same currency. Baking in conversion would mean shipping exchange
 * rates, which go stale faster than fuel prices and would be one more number
 * pretending to be current.
 */
export function fuelCost(inputs: FuelCostInputs): FuelCostResult | null {
  const { consumptionPer100km, pricePerUnit, distanceKm } = inputs;
  if (consumptionPer100km < 0 || pricePerUnit < 0 || distanceKm < 0) return null;
  if (consumptionPer100km === 0) {
    return { unitsUsed: 0, cost: 0, costPer100km: 0, costPerKm: 0 };
  }

  const unitsUsed = (consumptionPer100km / 100) * distanceKm;
  const cost = unitsUsed * pricePerUnit;
  const costPer100km = consumptionPer100km * pricePerUnit;

  return {
    unitsUsed,
    cost,
    costPer100km,
    costPerKm: distanceKm > 0 ? cost / distanceKm : costPer100km / 100,
  };
}

/** Annual running cost at a given yearly distance. */
export function annualFuelCost(
  consumptionPer100km: number,
  pricePerUnit: number,
  annualDistanceKm: number,
): FuelCostResult | null {
  return fuelCost({ consumptionPer100km, pricePerUnit, distanceKm: annualDistanceKm });
}

export interface ComparisonRow {
  label: string;
  consumptionPer100km: number;
  pricePerUnit: number;
}

/**
 * Compares running costs across cars, sorted cheapest first.
 *
 * Takes a price per row rather than one shared price, because comparing a
 * petrol car against an electric one at a single price per unit is meaningless
 * — a litre and a kilowatt-hour are not the same thing and do not cost the
 * same. Forcing the caller to supply both prices makes that unavoidable.
 */
export function compareRunningCosts(
  rows: ComparisonRow[],
  annualDistanceKm: number,
): { label: string; annualCost: number; costPer100km: number }[] {
  return rows
    .map((row) => {
      const result = annualFuelCost(row.consumptionPer100km, row.pricePerUnit, annualDistanceKm);
      return {
        label: row.label,
        annualCost: result?.cost ?? 0,
        costPer100km: result?.costPer100km ?? 0,
      };
    })
    .sort((a, b) => a.annualCost - b.annualCost);
}

/**
 * What a difference in consumption is worth per year.
 *
 * The question a buyer is actually asking when they compare two cars — how many
 * years of fuel saving pay back a higher purchase price.
 */
export function annualSaving(
  cheaperPer100km: number,
  dearerPer100km: number,
  pricePerUnit: number,
  annualDistanceKm: number,
): number {
  const delta = dearerPer100km - cheaperPer100km;
  return (delta / 100) * annualDistanceKm * pricePerUnit;
}

/**
 * Years for a fuel saving to repay a price difference.
 *
 * Returns `null` when the saving is zero or negative — an infinite payback
 * period is a way of saying "never", and a number would imply otherwise.
 * Deliberately ignores interest, depreciation and maintenance; it is a
 * fuel-only comparison and the UI must say so.
 */
export function paybackYears(
  priceDifference: number,
  annualSavingAmount: number,
): number | null {
  if (annualSavingAmount <= 0) return null;
  return priceDifference / annualSavingAmount;
}
