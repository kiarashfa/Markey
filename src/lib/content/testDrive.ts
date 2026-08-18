/**
 * Assembles the physics inputs for a car — SPEC.md §8.2, §9.5.
 *
 * The gatekeeper between authored content and the dynamics model. Its job is to
 * decide whether there is *enough* real data to model this car at all, and to
 * say precisely what is missing when there is not. A car that cannot be
 * modelled gets an honest explanation, never a panel of defaults dressed up as
 * a readout.
 */
import { resolveFrontalArea } from '../math/dynamics/aero.ts';
import { tyreGripForYear } from '../math/dynamics/constants.ts';
import type { VehicleInputs } from '../math/dynamics/performance.ts';
import type { CarData } from '../../schemas/car.ts';
import type { PropertyValue } from '../../schemas/primitives.ts';

const value = (pv: PropertyValue | undefined): number | null =>
  pv && pv.value !== null ? pv.value : null;

export interface TestDriveData {
  /** Null when the car cannot be modelled at all. */
  inputs: VehicleInputs | null;
  /** Plain-language list of what the physics still needs. */
  missing: string[];
  published: {
    zeroToHundredS: number | null;
    topSpeedKmh: number | null;
    consumptionL100km: number | null;
  };
  frontalAreaEstimated: boolean;
  frontalAreaNote?: string;
  trimName: string | null;
}

/**
 * Builds inputs from the best-documented trim of an entry.
 *
 * "Best documented" rather than "first" or "fastest": the point of Test Drive
 * is to model something, and picking the trim with the most complete data is
 * the choice most likely to produce a panel at all. The trim used is named in
 * the UI so the reader knows which one they are looking at.
 *
 * The three inputs the model *cannot* run without count for far more than the
 * two published figures it merely compares itself against. Phase 10 found out
 * why the hard way: the Range Rover Classic has one trim with a power figure
 * and another with a mass and a drag coefficient. Counting fields flat made
 * those trims tie, the first won, and the page told the reader it was missing
 * a mass and a Cd that the entry actually has — naming the wrong gap, which is
 * its own kind of dishonesty. Published figures still break ties, so a trim
 * that can be modelled *and* checked is preferred to one that can only be
 * modelled.
 */
export function buildTestDriveData(car: CarData): TestDriveData {
  const REQUIRED_WEIGHT = 10;
  const scored = car.trims
    .map((trim) => {
      const required = [
        value(trim.power),
        value(trim.mass),
        value(trim.dragCoefficient),
      ].filter((v) => v !== null).length;
      const comparable = [
        value(trim.topSpeed),
        value(trim.zeroToHundredKph),
      ].filter((v) => v !== null).length;
      return { trim, present: required * REQUIRED_WEIGHT + comparable };
    })
    .sort((a, b) => b.present - a.present);

  const best = scored[0]?.trim;
  const published = {
    zeroToHundredS: best ? value(best.zeroToHundredKph) : null,
    topSpeedKmh: best ? value(best.topSpeed) : null,
    consumptionL100km: best ? value(best.fuelEconomy) : null,
  };

  if (!best) {
    return {
      inputs: null,
      missing: ['any trim data at all'],
      published,
      frontalAreaEstimated: false,
      trimName: null,
    };
  }

  const powerKw = value(best.power);
  const massKg = value(best.mass);
  const cd = value(best.dragCoefficient);

  const area = resolveFrontalArea(
    value(best.frontalArea),
    value(best.dimensions?.width) ?? value(car.dimensions?.width),
    value(best.dimensions?.height) ?? value(car.dimensions?.height),
  );

  const missing: string[] = [];
  if (powerKw === null) missing.push('power');
  if (massKg === null) missing.push('kerb weight');
  if (cd === null) missing.push('drag coefficient');
  if (area === null) missing.push('frontal area (and no width/height to estimate it from)');

  if (powerKw === null || massKg === null || cd === null || area === null) {
    return {
      inputs: null,
      missing,
      published,
      frontalAreaEstimated: area?.estimated ?? false,
      frontalAreaNote: area?.note,
      trimName: best.name,
    };
  }

  return {
    inputs: {
      massKg,
      powerKw,
      dragCoefficient: cd,
      frontalAreaM2: area.value,
      drivetrain: best.drivetrain,
      tyreGrip: value(best.tyreGrip) ?? tyreGripForYear(car.productionYears.start),
      powertrain: best.powertrain,
      ...(value(best.weightDistributionFront) !== null
        ? { frontWeightFraction: value(best.weightDistributionFront)! }
        : {}),
    },
    missing,
    published,
    frontalAreaEstimated: area.estimated,
    frontalAreaNote: area.note,
    trimName: best.name,
  };
}

/** Whether a car has enough data to be worth offering Test Drive at all. */
export function hasTestDrive(car: CarData): boolean {
  return buildTestDriveData(car).inputs !== null;
}
