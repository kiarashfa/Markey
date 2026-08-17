/**
 * Aerodynamics — SPEC.md §8.2.
 *
 * Drag force, drag area, and the frontal-area estimate that makes the rest of
 * the model possible for cars where nobody published one.
 *
 * `F_d = ½ · ρ · Cd · A · v²`
 */
import { AIR_DENSITY, FRONTAL_AREA_FACTOR } from './constants.ts';

/**
 * Aerodynamic drag force in newtons.
 *
 * @param speedMs speed in m/s (not km/h — the square makes a unit slip
 *   catastrophic rather than merely wrong, so the signature takes SI base units)
 */
export function dragForce(
  speedMs: number,
  dragCoefficient: number,
  frontalAreaM2: number,
  airDensity: number = AIR_DENSITY.value,
): number {
  return 0.5 * airDensity * dragCoefficient * frontalAreaM2 * speedMs * speedMs;
}

/** Power required to overcome drag alone, in watts: `P = F · v`. */
export function dragPower(
  speedMs: number,
  dragCoefficient: number,
  frontalAreaM2: number,
  airDensity: number = AIR_DENSITY.value,
): number {
  return dragForce(speedMs, dragCoefficient, frontalAreaM2, airDensity) * speedMs;
}

/**
 * Drag area, CdA — the product that actually determines drag.
 *
 * Worth surfacing on its own because Cd alone is misleading when comparing
 * cars of different sizes: a van with a low Cd can still have far more drag
 * than a small car with a worse one.
 */
export function dragArea(dragCoefficient: number, frontalAreaM2: number): number {
  return dragCoefficient * frontalAreaM2;
}

export interface FrontalAreaEstimate {
  /** m² */
  value: number;
  /** Always 'estimated' — this is never a measurement. */
  status: 'estimated';
  /** The explanation the schema requires alongside any estimated value. */
  note: string;
}

/**
 * Estimates frontal area from the width × height bounding box.
 *
 * SPEC.md §8.2 fixes the approximation at ~0.85 × width × height and requires
 * anything derived from it to be flagged as estimated wherever it feeds a
 * displayed figure. The return type carries that flag and its explanation so a
 * caller cannot accidentally present the result as measured — the shape of the
 * value is what enforces the honesty rule.
 *
 * Returns `null` when either dimension is missing or non-positive: a car
 * without recorded dimensions gets an honest gap, not a guess.
 */
export function estimateFrontalArea(
  widthMm: number | null | undefined,
  heightMm: number | null | undefined,
  factor: number = FRONTAL_AREA_FACTOR.value,
): FrontalAreaEstimate | null {
  if (!widthMm || !heightMm || widthMm <= 0 || heightMm <= 0) return null;
  const widthM = widthMm / 1000;
  const heightM = heightMm / 1000;
  const value = factor * widthM * heightM;
  return {
    value,
    status: 'estimated',
    note: `Estimated as ${factor} × width × height = ${factor} × ${widthM.toFixed(3)} m × ${heightM.toFixed(3)} m ≈ ${value.toFixed(2)} m². Not a measured figure.`,
  };
}

/**
 * The frontal area to actually use, published in preference to estimated.
 *
 * SPEC.md §8.2 discipline 1: a modelled figure never overwrites a real one.
 */
export function resolveFrontalArea(
  publishedM2: number | null | undefined,
  widthMm: number | null | undefined,
  heightMm: number | null | undefined,
): { value: number; estimated: boolean; note?: string } | null {
  if (publishedM2 && publishedM2 > 0) {
    return { value: publishedM2, estimated: false };
  }
  const estimate = estimateFrontalArea(widthMm, heightMm);
  if (!estimate) return null;
  return { value: estimate.value, estimated: true, note: estimate.note };
}

/**
 * Cd back-calculated from a measured force — `Cd = 2F / (ρ · U² · A)`.
 *
 * This is the momentum-exchange relationship the wind-tunnel solver reports its
 * own Cd through (SPEC.md §9.5.1). It lives here so the 2D physics and the
 * solver share one definition rather than each carrying its own.
 */
export function dragCoefficientFromForce(
  forceN: number,
  speedMs: number,
  frontalAreaM2: number,
  airDensity: number = AIR_DENSITY.value,
): number | null {
  if (speedMs <= 0 || frontalAreaM2 <= 0) return null;
  return (2 * forceN) / (airDensity * speedMs * speedMs * frontalAreaM2);
}
