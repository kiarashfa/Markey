/**
 * Steady-state energy use at speed.
 *
 * Total resistive power divided by powertrain efficiency, converted per
 * powertrain type. This models a car holding a constant speed on level ground:
 * it is **not** a drive cycle and must never be compared against a WLTP or EPA
 * figure as though it were. Real-world consumption includes acceleration,
 * hills, stops, ancillaries and cold starts, all of which this ignores.
 *
 * Its value is comparative rather than absolute — it shows why a tall SUV costs
 * so much more to hold at 120 km/h than a low saloon of the same mass, which is
 * exactly the thing drag figures alone fail to make concrete.
 */
import { kmhToMs } from '../units.ts';
import {
  AIR_DENSITY,
  FUEL_ENERGY,
  GRAVITY,
  ROLLING_RESISTANCE,
  drivetrainEfficiency,
  powertrainEfficiency,
} from './constants.ts';
import { dragForce } from './aero.ts';

export interface ConsumptionInputs {
  massKg: number;
  dragCoefficient: number;
  frontalAreaM2: number;
  drivetrain: string;
  /** A powertrain tag from the taxonomy: petrol, diesel, bev, ... */
  powertrain: string;
  rollingResistance?: number;
  airDensity?: number;
}

export interface ConsumptionAtSpeed {
  speedKmh: number;
  /** Power at the wheels to hold this speed, kW. */
  wheelPowerKw: number;
  /** Energy drawn from the tank or battery, kW. */
  inputPowerKw: number;
  /** Litres per 100 km, for liquid-fuelled cars. */
  litresPer100km: number | null;
  /** kWh per 100 km, for electrified cars. */
  kwhPer100km: number | null;
  /** How much of the wheel power is spent pushing air aside, 0–1. */
  dragShare: number;
}

const LIQUID_FUELS: Record<string, keyof typeof FUEL_ENERGY> = {
  petrol: 'petrol',
  diesel: 'diesel',
  hybrid: 'petrol',
  phev: 'petrol',
  'mild-hybrid': 'petrol',
  rotary: 'petrol',
  lpg: 'petrol',
  cng: 'petrol',
};

const ELECTRIC = new Set(['bev', 'fcev', 'range-extender']);

/**
 * Energy use to hold a constant speed.
 *
 * Returns `null` rather than a number when an input the physics genuinely needs
 * is missing — a car with no Cd gets no aero panel at all (discipline
 * 2), not a panel full of guesses.
 */
export function consumptionAtSpeed(
  speedKmh: number,
  inputs: ConsumptionInputs,
): ConsumptionAtSpeed | null {
  if (speedKmh <= 0 || inputs.massKg <= 0) return null;
  if (inputs.dragCoefficient <= 0 || inputs.frontalAreaM2 <= 0) return null;

  const v = kmhToMs(speedKmh);
  const rho = inputs.airDensity ?? AIR_DENSITY.value;
  const crr = inputs.rollingResistance ?? ROLLING_RESISTANCE.value;

  const drag = dragForce(v, inputs.dragCoefficient, inputs.frontalAreaM2, rho);
  const rolling = crr * inputs.massKg * GRAVITY.value;
  const totalForce = drag + rolling;

  const wheelPowerW = totalForce * v;
  const inputPowerW =
    wheelPowerW / (drivetrainEfficiency(inputs.drivetrain) * powertrainEfficiency(inputs.powertrain));

  // Energy per 100 km = power × time to cover 100 km.
  const hoursPer100km = 100 / speedKmh;
  const energyKwhPer100km = (inputPowerW / 1000) * hoursPer100km;

  let litresPer100km: number | null = null;
  let kwhPer100km: number | null = null;

  if (ELECTRIC.has(inputs.powertrain)) {
    kwhPer100km = energyKwhPer100km;
  } else {
    const fuel = LIQUID_FUELS[inputs.powertrain];
    if (fuel) {
      // 1 kWh = 3.6 MJ.
      const megajoulesPer100km = energyKwhPer100km * 3.6;
      litresPer100km = megajoulesPer100km / FUEL_ENERGY[fuel]!.value;
    }
  }

  return {
    speedKmh,
    wheelPowerKw: wheelPowerW / 1000,
    inputPowerKw: inputPowerW / 1000,
    litresPer100km,
    kwhPer100km,
    dragShare: totalForce > 0 ? drag / totalForce : 0,
  };
}

/**
 * A consumption curve across a speed range, for the Test Drive chart.
 *
 * The interesting feature is the crossover: below roughly 60–70 km/h rolling
 * resistance dominates, above it drag does, because drag rises with the square
 * of speed while rolling resistance is flat. That crossover is visible in
 * `dragShare` and is the point the chart exists to make.
 */
export function consumptionCurve(
  inputs: ConsumptionInputs,
  fromKmh = 30,
  toKmh = 200,
  stepKmh = 10,
): ConsumptionAtSpeed[] {
  const points: ConsumptionAtSpeed[] = [];
  for (let speed = fromKmh; speed <= toKmh; speed += stepKmh) {
    const point = consumptionAtSpeed(speed, inputs);
    if (point) points.push(point);
  }
  return points;
}

/**
 * The speed at which drag overtakes rolling resistance.
 *
 * Solvable in closed form: `½ρ·Cd·A·v² = Crr·m·g`.
 */
export function dragCrossoverSpeed(inputs: ConsumptionInputs): number | null {
  if (inputs.dragCoefficient <= 0 || inputs.frontalAreaM2 <= 0 || inputs.massKg <= 0) return null;
  const rho = inputs.airDensity ?? AIR_DENSITY.value;
  const crr = inputs.rollingResistance ?? ROLLING_RESISTANCE.value;
  const rolling = crr * inputs.massKg * GRAVITY.value;
  const v = Math.sqrt(rolling / (0.5 * rho * inputs.dragCoefficient * inputs.frontalAreaM2));
  return v * 3.6;
}
