/**
 * Acceleration and top speed — SPEC.md §8.2.
 *
 * Two models, both textbook:
 *
 * **Top speed** solves `P_wheel = ½ρ·Cd·A·v³ + Crr·m·g·v` for `v`. There is no
 * closed form, so it is solved numerically.
 *
 * **0–100 km/h** is two-phase: a traction-limited launch, where grip and weight
 * transfer set the ceiling, then a power-limited phase integrated forward in
 * time. Modelling it as a single power-limited phase is the usual shortcut and
 * it produces absurd figures for high-powered cars — a 500 kW rear-drive car
 * does not reach 100 km/h in 1.9 seconds because its tyres will not let it.
 *
 * Everything here is **modelled**. Where a manufacturer figure exists it is
 * what the spec sheet shows; these outputs sit alongside it, labelled as the
 * model's (SPEC.md §8.2 discipline 1).
 */
import { kmhToMs, msToKmh } from '../units.ts';
import {
  AIR_DENSITY,
  DRIVEN_AXLE_WEIGHT_FRACTION,
  GRAVITY,
  LOAD_TRANSFER_RATIO,
  ROLLING_RESISTANCE,
  drivetrainEfficiency,
  powerAvailability,
} from './constants.ts';
import { dragForce } from './aero.ts';

export interface VehicleInputs {
  /** Kerb mass, kg. */
  massKg: number;
  /** Crankshaft power, kW. */
  powerKw: number;
  dragCoefficient: number;
  frontalAreaM2: number;
  drivetrain: string;
  /** Tyre–road friction coefficient. */
  tyreGrip: number;
  /**
   * Powertrain tag. Only affects how much of peak power is available during
   * acceleration (an EV has far more of it than a geared combustion car) —
   * it does not change top speed, which occurs at peak power by definition.
   */
  powertrain?: string;
  rollingResistance?: number;
  airDensity?: number;
  /** Occupant + fuel allowance, kg. Real tests carry a driver. */
  payloadKg?: number;
  /**
   * Manufacturer's electronic speed limiter, km/h, where one exists.
   *
   * Without this the model reports the speed at which power and drag balance,
   * which for a limited car is not its top speed at all — it is the speed it
   * *would* reach unrestricted. Many EVs and most German cars are limited well
   * below that point.
   */
  speedLimiterKmh?: number;
}

/** A driver and a tank of fuel — the condition a published 0–100 is measured in. */
export const TEST_PAYLOAD_KG = 75;

function totalMass(inputs: VehicleInputs): number {
  return inputs.massKg + (inputs.payloadKg ?? TEST_PAYLOAD_KG);
}

/**
 * Resistive force at a given speed: aerodynamic drag plus rolling resistance.
 */
export function resistiveForce(speedMs: number, inputs: VehicleInputs): number {
  const crr = inputs.rollingResistance ?? ROLLING_RESISTANCE.value;
  const rho = inputs.airDensity ?? AIR_DENSITY.value;
  const drag = dragForce(speedMs, inputs.dragCoefficient, inputs.frontalAreaM2, rho);
  const rolling = crr * totalMass(inputs) * GRAVITY.value;
  return drag + rolling;
}

export interface TopSpeedResult {
  /** The figure to show, km/h — the limiter where one applies. */
  kmh: number;
  /** Where power and drag balance, ignoring any limiter. */
  unrestrictedKmh: number;
  /** True when an electronic limiter, not physics, sets the number. */
  limited: boolean;
}

/**
 * Top speed, solved numerically.
 *
 * Solves `P_wheel = ½ρ·Cd·A·v³ + Crr·m·g·v` by bisection rather than
 * Newton–Raphson: the function is monotonic over the bracket, bisection cannot
 * diverge, and 60 iterations over a 0–600 km/h bracket converge far below the
 * precision the inputs justify. Robustness beats speed here — this runs once
 * per car, not per frame.
 *
 * **What this figure is, and is not.** It is the speed at which available power
 * balances drag and rolling resistance. It does **not** know about gearing (a
 * car geared out below this speed will never reach it), nor about electronic
 * limiters unless one is supplied. That gap is real and sometimes large: with
 * no limiter given, a Tesla Model 3 Long Range models at ~336 km/h against a
 * published 233 km/h, because the published figure is a limiter and this one is
 * aerodynamics. Supply `speedLimiterKmh` where it is known, and read the
 * unrestricted figure for what it is — a measure of how slippery and powerful
 * the car is, not a claim about what it will do.
 */
export function topSpeedDetailed(inputs: VehicleInputs): TopSpeedResult | null {
  if (inputs.powerKw <= 0 || inputs.massKg <= 0) return null;
  if (inputs.dragCoefficient <= 0 || inputs.frontalAreaM2 <= 0) return null;

  const wheelPowerW = inputs.powerKw * 1000 * drivetrainEfficiency(inputs.drivetrain);

  // Excess power available at speed v. Positive means the car can still
  // accelerate; the root is the top speed.
  const excess = (speedMs: number) => wheelPowerW - resistiveForce(speedMs, inputs) * speedMs;

  let low = 0;
  let high = kmhToMs(600);
  if (excess(high) > 0) return null; // beyond the bracket; refuse to extrapolate

  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (excess(mid) > 0) low = mid;
    else high = mid;
  }
  const unrestrictedKmh = msToKmh((low + high) / 2);

  const limiter = inputs.speedLimiterKmh;
  const limited = limiter !== undefined && limiter > 0 && limiter < unrestrictedKmh;
  return {
    kmh: limited ? limiter : unrestrictedKmh,
    unrestrictedKmh,
    limited,
  };
}

/** Top speed in km/h, or `null` when an input the physics needs is missing. */
export function topSpeed(inputs: VehicleInputs): number | null {
  return topSpeedDetailed(inputs)?.kmh ?? null;
}

export interface AccelerationResult {
  /** Seconds to the target speed. */
  seconds: number;
  /** Speed at which the launch stopped being traction-limited, km/h. */
  tractionLimitedToKmh: number;
  /** True when grip never limited the car — it was power-limited throughout. */
  powerLimitedThroughout: boolean;
}

/**
 * Acceleration from rest to a target speed, integrated forward in time.
 *
 * Phase 1 — traction-limited. The maximum longitudinal force the tyres can
 * transmit is `μ · N`, where `N` is the load on the driven axle including
 * longitudinal transfer under acceleration. For a rear-drive car, transfer
 * *helps* (load moves onto the driven axle); for front-drive it *hurts*. That
 * asymmetry is the reason a front-drive car cannot use big power off the line,
 * and it falls straight out of the model rather than being asserted.
 *
 * Phase 2 — power-limited. Force is `P_wheel / v`, less resistive force.
 *
 * The car is in whichever phase gives the lower force at each step, which is
 * the physically correct switch: it can never exceed either limit.
 */
export function accelerationTo(
  targetKmh: number,
  inputs: VehicleInputs,
  stepSeconds = 0.001,
): AccelerationResult | null {
  if (inputs.powerKw <= 0 || inputs.massKg <= 0 || inputs.tyreGrip <= 0) return null;
  if (inputs.dragCoefficient <= 0 || inputs.frontalAreaM2 <= 0) return null;
  if (targetKmh <= 0) return null;

  const mass = totalMass(inputs);
  // Peak power is not available throughout a standing start — see
  // POWER_AVAILABILITY in constants.ts for why, and how much it matters.
  const wheelPowerW =
    inputs.powerKw *
    1000 *
    drivetrainEfficiency(inputs.drivetrain) *
    powerAvailability(inputs.powertrain ?? 'petrol');
  const targetMs = kmhToMs(targetKmh);
  const staticFraction = DRIVEN_AXLE_WEIGHT_FRACTION[inputs.drivetrain] ?? 0.5;
  const isFrontDrive = inputs.drivetrain === 'fwd';
  const allWheelsDriven = staticFraction >= 1;

  let speed = 0;
  let time = 0;
  let tractionLimitedTo = 0;
  let everTractionLimited = false;

  // A generous ceiling: if the car has not reached the target in 60 s it is
  // either mis-specified or genuinely incapable, and returning null is more
  // honest than a number produced by an endless loop.
  const maxTime = 60;

  while (speed < targetMs && time < maxTime) {
    // --- traction limit -------------------------------------------------
    // Solve for the acceleration at which available grip exactly equals the
    // demanded force. Load transfer depends on acceleration, and acceleration
    // depends on load transfer, so this is a fixed point; two passes are
    // plenty at the precision the constants justify.
    let tractionAccel = inputs.tyreGrip * GRAVITY.value * staticFraction;
    if (!allWheelsDriven) {
      for (let pass = 0; pass < 2; pass++) {
        const transfer = LOAD_TRANSFER_RATIO.value * (tractionAccel / GRAVITY.value);
        const fraction = isFrontDrive
          ? Math.max(0, staticFraction - transfer)
          : Math.min(1, staticFraction + transfer);
        tractionAccel = inputs.tyreGrip * GRAVITY.value * fraction;
      }
    }
    const tractionForce = tractionAccel * mass;

    // --- power limit ----------------------------------------------------
    // At a standstill, P/v is unbounded, so the launch is traction-limited by
    // definition — guard the division rather than letting it produce Infinity.
    const powerForce = speed > 0.1 ? wheelPowerW / speed : Number.POSITIVE_INFINITY;

    const driveForce = Math.min(tractionForce, powerForce);
    if (driveForce === tractionForce && powerForce > tractionForce) {
      everTractionLimited = true;
      tractionLimitedTo = speed;
    }

    const netForce = driveForce - resistiveForce(speed, inputs);
    if (netForce <= 0) return null; // cannot reach the target speed at all

    speed += (netForce / mass) * stepSeconds;
    time += stepSeconds;
  }

  if (time >= maxTime) return null;

  return {
    seconds: time,
    tractionLimitedToKmh: msToKmh(tractionLimitedTo),
    powerLimitedThroughout: !everTractionLimited,
  };
}

/** 0–100 km/h, the figure a spec sheet quotes. */
export function zeroToHundred(inputs: VehicleInputs): AccelerationResult | null {
  return accelerationTo(100, inputs);
}

/** 0–60 mph, the US convention. 60 mph = 96.5606 km/h. */
export function zeroToSixtyMph(inputs: VehicleInputs): AccelerationResult | null {
  return accelerationTo(96.56064, inputs);
}

/**
 * Power-to-weight in kW per tonne, at kerb weight without payload.
 *
 * Deliberately excludes the test payload: this is a published-spec comparison
 * figure, and every manufacturer quotes it dry.
 */
export function powerToWeightRatio(inputs: VehicleInputs): number | null {
  if (inputs.massKg <= 0) return null;
  return inputs.powerKw / (inputs.massKg / 1000);
}
