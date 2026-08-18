/**
 * Build Car — the specification of a hypothetical car (SPEC.md §9.6).
 *
 * A `BuildSpec` is *only* inputs. It computes nothing, so it can be encoded
 * into a URL, handed to the comparison tool, or round-tripped through storage
 * without any risk of a stale derived figure travelling with it. Turning one
 * into physics is `toVehicleInputs`, and what comes out is fed to the **same**
 * `dynamics/*` functions Test Drive runs on real cars — no second physics path,
 * which is the whole point of the feature (SPEC.md §9.6).
 *
 * ## About the presets, and why they are not a violation of the data rule
 *
 * The project's rule is that a *fact about a real car* is never invented. A
 * preset here is not a fact about anything: it is a starting position for a car
 * the visitor is making up, in a tool whose entire premise is that the numbers
 * are theirs to change. SPEC.md §9.6 asks for exactly this — "sensible defaults
 * pre-fill from a chosen segment so the visitor starts from something plausible
 * rather than an empty form."
 *
 * Two rules keep it honest anyway:
 *
 *  1. Every preset carries a `basis` saying what class of car it describes, in
 *     the same style as `dynamics/constants.ts`, and the UI shows it.
 *  2. No preset is named after, or numerically copied from, a specific car. A
 *     preset that read 147 kW / 1190 kg / Cd 0.27 would be a Toyota 86 wearing
 *     a disguise, and a visitor could reasonably read the resulting figures as
 *     a claim about that car.
 */
import { resolveFrontalArea } from '../math/dynamics/aero.ts';
import type { Gearing } from '../math/dynamics/gearing.ts';
import type { VehicleInputs } from '../math/dynamics/performance.ts';

export interface BuildSpec {
  /** What the visitor calls it. Shown in the comparison column header. */
  name: string;
  /**
   * The id of the preset this build started from, or '' once it has drifted
   * far enough that naming one would be misleading. Presentational only — the
   * physics never reads it.
   */
  segment: string;
  massKg: number;
  powerKw: number;
  /** N⋅m. Carried and displayed; see `TORQUE_NOTE` for what the model does with it. */
  torqueNm: number;
  drivetrain: string;
  powertrain: string;
  dragCoefficient: number;
  /** m². Zero means "estimate it from the body dimensions instead". */
  frontalAreaM2: number;
  tyreGrip: number;
  /** Road speed at 1000 rpm in top, km/h. Zero means "no gearing supplied". */
  kmhPer1000rpm: number;
  redlineRpm: number;
  /** km/h. Zero means "not limited". */
  speedLimiterKmh: number;
  /** Body dimensions in mm — the shape the wind tunnel runs, and the frontal-area fallback. */
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  /** A body-style tag, for choosing the tunnel's shape family. */
  bodyStyle: string;
}

/**
 * What the model does with torque, stated once and shown in the UI.
 *
 * A field that silently does nothing is worse than no field: the visitor moves
 * it, nothing changes, and they conclude the whole readout is decorative. So
 * torque is carried, displayed and compared — and the model's use of it is
 * named rather than implied.
 */
export const TORQUE_NOTE =
  'The acceleration model integrates power, not torque: at any instant the force at the wheels is limited by power over speed, or by grip, whichever is lower. Torque is carried on the build and shown for comparison, but changing it alone will not change the modelled figures.';

export interface SegmentPreset {
  /**
   * The preset's own id. Mostly a taxonomy segment from
   * `src/data/taxonomy/segments.json`, but not required to be: the classes a
   * *builder* thinks in are not always the classes the catalogue sorts by, and
   * an electric compact is a different starting point from a petrol one even
   * though both are C-segment.
   */
  id: string;
  label: string;
  /** What class of car this describes. Published beside the form. */
  basis: string;
  spec: Omit<BuildSpec, 'name' | 'segment'>;
}

/**
 * A modern, unremarkable example of each segment.
 *
 * Deliberately unexciting: the presets exist so the form starts somewhere
 * plausible, not so it starts somewhere impressive. Grip is the contemporary
 * road-tyre figure from `dynamics/constants.ts`; gearing is the tall final
 * drive a modern car uses to keep motorway revs down, which is also what makes
 * gearing worth modelling at all.
 */
export const SEGMENT_PRESETS: readonly SegmentPreset[] = [
  {
    id: 'b-segment',
    label: 'B-segment / Subcompact',
    basis: 'A modern supermini: small three- or four-cylinder petrol engine, front-wheel drive, around 4 m long.',
    spec: {
      massKg: 1150,
      powerKw: 74,
      torqueNm: 175,
      drivetrain: 'fwd',
      powertrain: 'petrol',
      dragCoefficient: 0.31,
      frontalAreaM2: 0,
      tyreGrip: 1.0,
      kmhPer1000rpm: 38,
      redlineRpm: 6000,
      speedLimiterKmh: 0,
      lengthMm: 4050,
      widthMm: 1750,
      heightMm: 1470,
      bodyStyle: 'hatchback',
    },
  },
  {
    id: 'c-segment',
    label: 'C-segment / Compact',
    basis: 'A modern small family hatchback: turbocharged petrol, front-wheel drive, the volume car of most European markets.',
    spec: {
      massKg: 1350,
      powerKw: 110,
      torqueNm: 250,
      drivetrain: 'fwd',
      powertrain: 'petrol',
      dragCoefficient: 0.29,
      frontalAreaM2: 0,
      tyreGrip: 1.0,
      kmhPer1000rpm: 42,
      redlineRpm: 6000,
      speedLimiterKmh: 0,
      lengthMm: 4300,
      widthMm: 1800,
      heightMm: 1460,
      bodyStyle: 'hatchback',
    },
  },
  {
    id: 'd-segment',
    label: 'D-segment / Mid-size',
    basis: 'A large family saloon or estate: longer, heavier and more slippery than a hatchback of the same power.',
    spec: {
      massKg: 1550,
      powerKw: 140,
      torqueNm: 320,
      drivetrain: 'fwd',
      powertrain: 'petrol',
      dragCoefficient: 0.27,
      frontalAreaM2: 0,
      tyreGrip: 1.0,
      kmhPer1000rpm: 45,
      redlineRpm: 6000,
      speedLimiterKmh: 0,
      lengthMm: 4750,
      widthMm: 1840,
      heightMm: 1450,
      bodyStyle: 'saloon',
    },
  },
  {
    id: 'e-segment',
    label: 'E-segment / Full-size',
    basis: 'An executive saloon: rear- or all-wheel drive, six cylinders or a large four, and enough weight to show what mass costs in acceleration.',
    spec: {
      massKg: 1800,
      powerKw: 190,
      torqueNm: 400,
      drivetrain: 'rwd',
      powertrain: 'petrol',
      dragCoefficient: 0.26,
      frontalAreaM2: 0,
      tyreGrip: 1.0,
      kmhPer1000rpm: 50,
      redlineRpm: 6500,
      speedLimiterKmh: 250,
      lengthMm: 4950,
      widthMm: 1870,
      heightMm: 1450,
      bodyStyle: 'saloon',
    },
  },
  {
    id: 's-segment',
    label: 'S-segment / Sports car',
    basis: 'A light rear-drive coupé: modest capacity, high revs, short gearing. The class where the geared ceiling bites well below the aerodynamic one.',
    spec: {
      massKg: 1250,
      powerKw: 165,
      torqueNm: 230,
      drivetrain: 'rwd',
      powertrain: 'petrol',
      dragCoefficient: 0.3,
      frontalAreaM2: 0,
      tyreGrip: 1.0,
      kmhPer1000rpm: 36,
      redlineRpm: 7200,
      speedLimiterKmh: 0,
      lengthMm: 4300,
      widthMm: 1800,
      heightMm: 1300,
      bodyStyle: 'coupe',
    },
  },
  {
    id: 'suv-compact',
    label: 'Compact SUV',
    basis: 'A C-segment platform with a high-riding body: same footprint, more frontal area and a worse drag coefficient, which is the whole aerodynamic story of the class.',
    spec: {
      massKg: 1550,
      powerKw: 110,
      torqueNm: 250,
      drivetrain: 'fwd',
      powertrain: 'petrol',
      dragCoefficient: 0.33,
      frontalAreaM2: 0,
      tyreGrip: 1.0,
      kmhPer1000rpm: 42,
      redlineRpm: 6000,
      speedLimiterKmh: 0,
      lengthMm: 4400,
      widthMm: 1840,
      heightMm: 1640,
      bodyStyle: 'suv',
    },
  },
  {
    id: 'suv-large',
    label: 'Full-size SUV',
    basis: 'A large seven-seat SUV: two tonnes and a big flat face, so it needs far more power than a saloon for the same cruising speed.',
    spec: {
      massKg: 2300,
      powerKw: 220,
      torqueNm: 500,
      drivetrain: 'awd',
      powertrain: 'diesel',
      dragCoefficient: 0.35,
      frontalAreaM2: 0,
      tyreGrip: 1.0,
      kmhPer1000rpm: 55,
      redlineRpm: 4500,
      speedLimiterKmh: 0,
      lengthMm: 5000,
      widthMm: 1990,
      heightMm: 1780,
      bodyStyle: 'suv',
    },
  },
  {
    id: 'c-segment-bev',
    label: 'Compact electric',
    basis: 'A battery-electric hatchback: heavier than the petrol car it replaces, geared with a single ratio, and far more of its rated power available from rest.',
    spec: {
      massKg: 1750,
      powerKw: 150,
      torqueNm: 310,
      drivetrain: 'fwd',
      powertrain: 'bev',
      dragCoefficient: 0.26,
      frontalAreaM2: 0,
      tyreGrip: 1.0,
      kmhPer1000rpm: 0,
      redlineRpm: 0,
      speedLimiterKmh: 160,
      lengthMm: 4300,
      widthMm: 1810,
      heightMm: 1560,
      bodyStyle: 'hatchback',
    },
  },
];

export const DEFAULT_PRESET_ID = 'c-segment';

export function presetById(id: string): SegmentPreset | undefined {
  return SEGMENT_PRESETS.find((p) => p.id === id);
}

/** A build that starts from a preset, named for the class rather than a car. */
export function specFromPreset(preset: SegmentPreset): BuildSpec {
  return { name: `My ${preset.label.split(' / ')[0]}`, segment: preset.id, ...preset.spec };
}

export function defaultSpec(): BuildSpec {
  return specFromPreset(presetById(DEFAULT_PRESET_ID) ?? SEGMENT_PRESETS[0]!);
}

/** The frontal area the model will actually use, and whether it was estimated. */
export function resolveBuildArea(
  spec: BuildSpec,
): { value: number; estimated: boolean; note?: string } | null {
  return resolveFrontalArea(
    spec.frontalAreaM2 > 0 ? spec.frontalAreaM2 : null,
    spec.widthMm,
    spec.heightMm,
  );
}

/** Gearing, or undefined when the visitor left it out — never a fabricated pair. */
export function resolveGearing(spec: BuildSpec): Gearing | undefined {
  if (!(spec.kmhPer1000rpm > 0) || !(spec.redlineRpm > 0)) return undefined;
  return { kmhPer1000rpm: spec.kmhPer1000rpm, redlineRpm: spec.redlineRpm };
}

/**
 * What the physics still needs, in plain language.
 *
 * The same contract `lib/content/testDrive.ts` has for real cars: a build that
 * cannot be modelled says what is missing rather than showing a panel of
 * zeroes. Build Car has one advantage over a real car — the visitor can fix it.
 */
export function missingInputs(spec: BuildSpec): string[] {
  const missing: string[] = [];
  if (!(spec.massKg > 0)) missing.push('mass');
  if (!(spec.powerKw > 0)) missing.push('power');
  if (!(spec.dragCoefficient > 0)) missing.push('drag coefficient');
  if (resolveBuildArea(spec) === null) {
    missing.push('frontal area (and no width and height to estimate it from)');
  }
  if (!(spec.tyreGrip > 0)) missing.push('tyre grip');
  return missing;
}

/**
 * The build as physics inputs — `null` when something the model needs is absent.
 *
 * This is the join between Build Car and the rest of the site: what comes out
 * of here goes into the identical functions that model a real car, so a build
 * and a catalogue entry with the same numbers cannot produce different figures.
 * `build.test.ts` asserts exactly that against the one fully-sourced car.
 */
export function toVehicleInputs(spec: BuildSpec): VehicleInputs | null {
  if (missingInputs(spec).length > 0) return null;
  const area = resolveBuildArea(spec)!;
  return {
    massKg: spec.massKg,
    powerKw: spec.powerKw,
    dragCoefficient: spec.dragCoefficient,
    frontalAreaM2: area.value,
    drivetrain: spec.drivetrain,
    tyreGrip: spec.tyreGrip,
    powertrain: spec.powertrain,
    gearing: resolveGearing(spec),
    speedLimiterKmh: spec.speedLimiterKmh > 0 ? spec.speedLimiterKmh : undefined,
  };
}
