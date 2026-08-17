/**
 * Unit conversion and formatting — SPEC.md §8.1.
 *
 * **SI is what is stored. Imperial is always computed on demand, client-side,
 * and never stored or indexed.** That rule is why this module exists as pure
 * functions rather than as a build step: the static render and the client-side
 * unit toggle call the same code, so the two can never disagree about what
 * 210 kW is in horsepower.
 *
 * Every factor below is an exact definition, not an approximation, except
 * where noted. Exactness matters more than it looks: rounding at each hop
 * compounds, and a spec sheet that says 155 mph on one page and 156 mph on
 * another has destroyed its own credibility over a rounding choice.
 */

export type UnitSystem = 'metric' | 'imperial';

// ---------------------------------------------------------------------------
// Exact conversion factors
// ---------------------------------------------------------------------------

/** Exact by international definition (1959). */
export const MM_PER_INCH = 25.4;
/** Exact: 1 lb = 0.45359237 kg by definition. */
export const KG_PER_POUND = 0.45359237;
/**
 * Metric horsepower (PS/DIN), the European convention: 1 PS = 75 kgf·m/s.
 * This is NOT the same as mechanical horsepower — see `KW_PER_HP_MECHANICAL`.
 */
export const KW_PER_PS = 0.73549875;
/** Mechanical/imperial horsepower (SAE, bhp): 550 ft·lbf/s. */
export const KW_PER_HP_MECHANICAL = 0.745699871582;
/** Exact: 1 mile = 1609.344 m. */
export const KM_PER_MILE = 1.609344;
/** Exact: 1 US gallon = 3.785411784 L. */
export const LITRES_PER_US_GALLON = 3.785411784;
/** Exact: 1 imperial gallon = 4.54609 L. */
export const LITRES_PER_IMP_GALLON = 4.54609;
/** Exact: 1 lbf·ft = 1.3558179483314004 N·m. */
export const NM_PER_LBFT = 1.3558179483314004;
/** Exact: 1 cubic inch = 16.387064 cm³. */
export const CC_PER_CUBIC_INCH = 16.387064;

// ---------------------------------------------------------------------------
// Length
// ---------------------------------------------------------------------------

export const mmToInches = (mm: number): number => mm / MM_PER_INCH;
export const inchesToMm = (inches: number): number => inches * MM_PER_INCH;
export const kmToMiles = (km: number): number => km / KM_PER_MILE;
export const milesToKm = (miles: number): number => miles * KM_PER_MILE;

/**
 * Millimetres as feet and inches — how a car's length is quoted in the US.
 *
 * Returns the parts rather than a string so the caller controls presentation.
 * Rolls 12″ up to the next foot, which naive rounding gets wrong: 1828.7 mm is
 * 6′ 0″, not 5′ 12″.
 */
export function mmToFeetInches(mm: number): { feet: number; inches: number } {
  const totalInches = mmToInches(mm);
  let feet = Math.floor(totalInches / 12);
  let inches = Math.round(totalInches - feet * 12);
  if (inches === 12) {
    feet += 1;
    inches = 0;
  }
  return { feet, inches };
}

// ---------------------------------------------------------------------------
// Mass
// ---------------------------------------------------------------------------

export const kgToPounds = (kg: number): number => kg / KG_PER_POUND;
export const poundsToKg = (lb: number): number => lb * KG_PER_POUND;

// ---------------------------------------------------------------------------
// Power and torque
// ---------------------------------------------------------------------------

/**
 * kW to metric horsepower (PS).
 *
 * The default is PS rather than bhp deliberately: this catalog is
 * global-historical and the overwhelming majority of published figures for
 * European and Japanese cars are PS/DIN. Quoting a PS figure as "bhp" is a 1.4%
 * error that gets repeated across the internet, and getting it right is the
 * kind of detail this site exists for.
 */
export const kwToPs = (kw: number): number => kw / KW_PER_PS;
export const psToKw = (ps: number): number => ps * KW_PER_PS;
export const kwToBhp = (kw: number): number => kw / KW_PER_HP_MECHANICAL;
export const bhpToKw = (bhp: number): number => bhp * KW_PER_HP_MECHANICAL;

export const nmToLbFt = (nm: number): number => nm / NM_PER_LBFT;
export const lbFtToNm = (lbft: number): number => lbft * NM_PER_LBFT;

// ---------------------------------------------------------------------------
// Speed
// ---------------------------------------------------------------------------

export const kmhToMph = (kmh: number): number => kmh / KM_PER_MILE;
export const mphToKmh = (mph: number): number => mph * KM_PER_MILE;
export const kmhToMs = (kmh: number): number => kmh / 3.6;
export const msToKmh = (ms: number): number => ms * 3.6;

// ---------------------------------------------------------------------------
// Volume and consumption
// ---------------------------------------------------------------------------

export const litresToUsGallons = (l: number): number => l / LITRES_PER_US_GALLON;
export const litresToImpGallons = (l: number): number => l / LITRES_PER_IMP_GALLON;
export const ccToCubicInches = (cc: number): number => cc / CC_PER_CUBIC_INCH;
export const cubicInchesToCc = (ci: number): number => ci * CC_PER_CUBIC_INCH;

/**
 * L/100 km to US miles per gallon.
 *
 * These are **reciprocal** scales, which is the single most common mistake in
 * fuel-economy conversion: you cannot linearly interpolate between them, and
 * halving L/100 km doubles mpg rather than halving it. Zero consumption is
 * infinite mpg, so it returns `null` rather than `Infinity` — a caller
 * rendering "∞ mpg" is a bug, and `null` routes it into the honest empty state
 * instead.
 */
export function l100kmToMpgUs(l100km: number): number | null {
  if (l100km <= 0) return null;
  const milesPer100km = 100 / KM_PER_MILE;
  const usGallonsPer100km = l100km / LITRES_PER_US_GALLON;
  return milesPer100km / usGallonsPer100km;
}

/** L/100 km to imperial (UK) mpg. Same reciprocal caveat as the US version. */
export function l100kmToMpgImp(l100km: number): number | null {
  if (l100km <= 0) return null;
  return 100 / KM_PER_MILE / (l100km / LITRES_PER_IMP_GALLON);
}

export function mpgUsToL100km(mpg: number): number | null {
  if (mpg <= 0) return null;
  return (100 / KM_PER_MILE) / (mpg / LITRES_PER_US_GALLON);
}

export function mpgImpToL100km(mpg: number): number | null {
  if (mpg <= 0) return null;
  return (100 / KM_PER_MILE) / (mpg / LITRES_PER_IMP_GALLON);
}

/** kWh/100 km to miles per kWh — the way EV efficiency is quoted in the US. */
export function kwh100kmToMilesPerKwh(kwh100km: number): number | null {
  if (kwh100km <= 0) return null;
  return kmToMiles(100) / kwh100km;
}

/**
 * kWh/100 km to MPGe (US EPA).
 *
 * The EPA defines the gasoline-equivalent of one gallon as exactly 33.7 kWh.
 * That number is a regulatory convention, not physics — it is stated here so
 * `/methodology/` can say so rather than presenting it as a natural constant.
 */
export const KWH_PER_GALLON_EQUIVALENT = 33.7;

export function kwh100kmToMpge(kwh100km: number): number | null {
  if (kwh100km <= 0) return null;
  const kwhPerMile = kwh100km / kmToMiles(100);
  return KWH_PER_GALLON_EQUIVALENT / kwhPerMile;
}

// ---------------------------------------------------------------------------
// Derived figures
// ---------------------------------------------------------------------------

/**
 * Power-to-weight in kW per tonne — SPEC.md §8.2.
 *
 * Returns `null` for a non-positive mass rather than `Infinity`: a car with no
 * recorded mass has an unknown power-to-weight, not an infinite one.
 */
export function powerToWeight(powerKw: number, massKg: number): number | null {
  if (massKg <= 0) return null;
  return powerKw / (massKg / 1000);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export interface FormatOptions {
  decimals?: number;
  locale?: string;
}

export function formatNumber(value: number, options: FormatOptions = {}): string {
  const { decimals = 0, locale = 'en-GB' } = options;
  return value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** A converted quantity ready for display: the number and its unit label. */
export interface DisplayValue {
  value: number;
  unit: string;
  formatted: string;
}

function display(value: number, unit: string, decimals: number): DisplayValue {
  return { value, unit, formatted: `${formatNumber(value, { decimals })} ${unit}` };
}

/**
 * Converts one stored SI value into the requested system for display.
 *
 * Returns `null` when the quantity has no meaningful value in that system
 * (a zero-consumption figure has no finite mpg), which the caller renders as
 * the honest empty state rather than as a number.
 */
export function convertForDisplay(
  value: number,
  siUnit: string,
  system: UnitSystem,
): DisplayValue | null {
  if (system === 'metric') {
    switch (siUnit) {
      case 'kW':
        return display(value, 'kW', 0);
      case 'Nm':
        return display(value, 'N⋅m', 0);
      case 'kg':
        return display(value, 'kg', 0);
      case 'mm':
        return display(value, 'mm', 0);
      case 'km/h':
        return display(value, 'km/h', 0);
      case 'L/100km':
        return display(value, 'L/100 km', 1);
      case 'kWh/100km':
        return display(value, 'kWh/100 km', 1);
      case 'cc':
        return display(value, 'cc', 0);
      case 'km':
        return display(value, 'km', 0);
      case 'm2':
        return display(value, 'm²', 2);
      case 's':
        return display(value, 's', 1);
      case '':
        return display(value, '', 2);
      default:
        return display(value, siUnit, 0);
    }
  }

  switch (siUnit) {
    case 'kW':
      return display(kwToPs(value), 'PS', 0);
    case 'Nm':
      return display(nmToLbFt(value), 'lb⋅ft', 0);
    case 'kg':
      return display(kgToPounds(value), 'lb', 0);
    case 'mm': {
      const inches = mmToInches(value);
      return display(inches, 'in', inches < 100 ? 1 : 0);
    }
    case 'km/h':
      return display(kmhToMph(value), 'mph', 0);
    case 'L/100km': {
      const mpg = l100kmToMpgUs(value);
      return mpg === null ? null : display(mpg, 'mpg (US)', 1);
    }
    case 'kWh/100km': {
      const mpge = kwh100kmToMpge(value);
      return mpge === null ? null : display(mpge, 'MPGe', 0);
    }
    case 'cc':
      return display(ccToCubicInches(value), 'cu in', 0);
    case 'km':
      return display(kmToMiles(value), 'mi', 0);
    case 'm2':
      return display(value * 10.7639104167, 'sq ft', 2);
    // Seconds and dimensionless ratios are the same in both systems.
    case 's':
      return display(value, 's', 1);
    case '':
      return display(value, '', 2);
    default:
      return display(value, siUnit, 0);
  }
}
