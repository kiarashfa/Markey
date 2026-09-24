/**
 * Braking.
 *
 * `d = v² / (2·μ·g)`
 *
 * This is the idealised constant-deceleration model, and its limits are worth
 * stating plainly because it flatters real cars: it assumes every tyre is at
 * peak grip for the entire stop, ignores brake fade, ignores aerodynamic drag
 * (which helps at high speed), ignores weight transfer unloading the rear axle,
 * and assumes the brakes can actually reach the tyres' limit — which for many
 * older cars they could not. Treat the output as the physical floor, not as a
 * test result.
 */
import { kmhToMs } from '../units.ts';
import { GRAVITY } from './constants.ts';

/**
 * Stopping distance in metres from a given speed.
 *
 * Pure tyre-limited braking, no reaction time — this is the vehicle's stopping
 * distance, not the driver's.
 */
export function stoppingDistance(
  fromKmh: number,
  tyreGrip: number,
  gravity: number = GRAVITY.value,
): number | null {
  if (fromKmh <= 0 || tyreGrip <= 0) return null;
  const v = kmhToMs(fromKmh);
  return (v * v) / (2 * tyreGrip * gravity);
}

/** The standard European measure: 100–0 km/h. */
export function brakingDistance100to0(tyreGrip: number): number | null {
  return stoppingDistance(100, tyreGrip);
}

/** The standard US measure: 60–0 mph. */
export function brakingDistance60to0Mph(tyreGrip: number): number | null {
  return stoppingDistance(96.56064, tyreGrip);
}

/** Peak deceleration in m/s², and in g for readability. */
export function peakDeceleration(
  tyreGrip: number,
  gravity: number = GRAVITY.value,
): { ms2: number; g: number } | null {
  if (tyreGrip <= 0) return null;
  return { ms2: tyreGrip * gravity, g: tyreGrip };
}

/** Time to stop under constant deceleration, seconds. */
export function stoppingTime(
  fromKmh: number,
  tyreGrip: number,
  gravity: number = GRAVITY.value,
): number | null {
  if (fromKmh <= 0 || tyreGrip <= 0) return null;
  return kmhToMs(fromKmh) / (tyreGrip * gravity);
}

/**
 * Total distance including a driver's reaction, metres.
 *
 * Separate from `stoppingDistance` on purpose: mixing the two is how a vehicle
 * measurement turns into a road-safety claim about a person. 1.5 s is a
 * commonly used design value for an alert driver and is stated as such.
 */
export const DEFAULT_REACTION_SECONDS = 1.5;

export function totalStoppingDistance(
  fromKmh: number,
  tyreGrip: number,
  reactionSeconds: number = DEFAULT_REACTION_SECONDS,
): { reaction: number; braking: number; total: number } | null {
  const braking = stoppingDistance(fromKmh, tyreGrip);
  if (braking === null) return null;
  const reaction = kmhToMs(fromKmh) * reactionSeconds;
  return { reaction, braking, total: reaction + braking };
}
