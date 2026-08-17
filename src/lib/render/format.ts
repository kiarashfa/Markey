/**
 * Display formatting for stored values.
 *
 * Deliberately *not* unit conversion — SPEC.md §8.1 puts SI⇄imperial in
 * `lib/math/units.ts` (Phase 3), shared between the static render and the
 * client-side unit toggle so the two can never disagree. This module only
 * turns a stored SI number into readable text.
 */
import type { PropertyValue } from '../../schemas/primitives.ts';

/** How each stored SI unit is written for a reader. */
const UNIT_LABELS: Record<string, string> = {
  kW: 'kW',
  Nm: 'N⋅m',
  kg: 'kg',
  mm: 'mm',
  m2: 'm²',
  cc: 'cc',
  s: 's',
  'km/h': 'km/h',
  'L/100km': 'L/100 km',
  'kWh/100km': 'kWh/100 km',
  kWh: 'kWh',
  km: 'km',
  'g/km': 'g/km',
  L: 'L',
  '': '',
};

export function unitLabel(unit: string): string {
  return UNIT_LABELS[unit] ?? unit;
}

/**
 * Significant decimals per unit.
 *
 * Precision is a property of the quantity, not of whether the number happens
 * to land on a whole value: a frontal area of exactly 2 m² should read
 * "2.00 m²", because "2 m²" implies a measurement an order of magnitude
 * coarser than the one actually made. Lengths in millimetres are the opposite
 * case — nobody publishes a wheelbase to two decimal places.
 */
const UNIT_DECIMALS: Record<string, number> = {
  '': 2, // drag coefficient, tyre grip — the second decimal is meaningful
  m2: 2,
  s: 1,
  'L/100km': 1,
  'kWh/100km': 1,
  kWh: 1,
  'g/km': 0,
  mm: 0,
  kg: 0,
  kW: 0,
  Nm: 0,
  cc: 0,
  'km/h': 0,
  km: 0,
  L: 0,
};

export function formatNumber(value: number, unit?: string): string {
  const decimals =
    unit !== undefined && unit in UNIT_DECIMALS
      ? UNIT_DECIMALS[unit]!
      : Number.isInteger(value)
        ? 0
        : 1;
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * The rendered form of a value, or `null` when there is nothing honest to
 * show. `null` is the signal for the caller to render an empty state — never a
 * dash that reads like a real measurement of zero.
 */
export function formatValue(pv: PropertyValue | undefined): string | null {
  if (!pv || pv.value === null) return null;
  const unit = unitLabel(pv.unit);
  const number = formatNumber(pv.value, pv.unit);
  return unit ? `${number} ${unit}` : number;
}

/** True when a value carries a real figure worth showing. */
export function hasValue(pv: PropertyValue | undefined): boolean {
  return Boolean(pv && pv.value !== null);
}

export const STATUS_LABELS: Record<string, string> = {
  verified: 'Verified',
  estimated: 'Estimated',
  placeholder: 'Not yet available',
  'conflicting-sources': 'Sources disagree',
};

export const STATUS_EXPLANATIONS: Record<string, string> = {
  verified: 'Taken from a cited source.',
  estimated: 'Calculated or approximated, not measured. The basis is stated.',
  placeholder: 'We do not have this figure yet. It is left empty rather than guessed.',
  'conflicting-sources': 'Published sources disagree on this figure.',
};

/** Formats a production range the way a reader expects to see it. */
export function formatYears(range: { start: number; end: number | null }): string {
  return range.end === null ? `${range.start}–present` : `${range.start}–${range.end}`;
}
