/**
 * A build as a comparison column.
 *
 * The comparison tool accepts a Build Car creation as one of its
 * four slots. The cheap way to do that is a second table code path for builds;
 * this is the other way — the build is shaped into the same `CatalogueCar` the
 * catalogue produces, so there is exactly one table, one set of rows and one
 * formatter, and a build cannot drift into being presented differently from a
 * real car by accident.
 *
 * **Except where it must be.** Two things are genuinely different about a build
 * and both are visible rather than smoothed over:
 *
 *  1. Its performance figures are **modelled**, where a real car's are
 *     published. Those cells are marked, and a build is never awarded "best" on
 *     them — a modelled figure beating a manufacturer's claim is a statement
 *     about the model, not about the car.
 *  2. It has **no consumption figure at all**. The model can produce one, but
 *     only as steady-state use at a chosen speed, and a real car's published
 *     figure is a drive cycle. They are not the same measurement, so putting
 *     them in one row would be the exact false equivalence the site refuses.
 *     The Test Drive readout shows the build's cruise figure, where it can be
 *     labelled properly.
 */
import type { CatalogueCar } from '../content/catalogue.ts';
import { zeroToHundred, topSpeedDetailed } from '../math/dynamics/performance.ts';
import { toVehicleInputs, type BuildSpec } from './spec.ts';

/**
 * Stable ids for the comparison rows.
 *
 * The rows live in the island; these ids are what lets this module say
 * "the build's value on *that* row is modelled" without importing the UI or
 * matching on a display label that a copy-edit would break.
 */
export type CompareRowKey =
  | 'brand'
  | 'produced'
  | 'power'
  | 'torque'
  | 'zero-to-hundred'
  | 'top-speed'
  | 'consumption'
  | 'mass'
  | 'cd'
  | 'length'
  | 'width'
  | 'height'
  | 'body'
  | 'drivetrain'
  | 'powertrain';

/** Rows where a build's value comes from the model rather than from a source. */
export const MODELLED_ROWS: readonly CompareRowKey[] = ['zero-to-hundred', 'top-speed'];

/** The id a build occupies in the comparison's selection. */
export const BUILD_ID = '__build__';

/**
 * A neutral grey, not a brand colour.
 *
 * Every other column takes its accent from the manufacturer. A build has no
 * manufacturer, and borrowing one would put a badge on a car nobody made.
 */
export const BUILD_ACCENT = '#8e8e93';

export interface BuildColumn {
  /** Shaped like a catalogue entry so the comparison table has one code path. */
  car: CatalogueCar;
  spec: BuildSpec;
  /** True when the physics could not run — the performance rows are empty. */
  unmodelled: boolean;
}

/**
 * Shapes a build into a comparison column.
 *
 * `editHref` becomes the column's link, so the header of a shared comparison
 * leads back to the build that produced it, already filled in.
 */
export function buildColumn(spec: BuildSpec, editHref: string): BuildColumn {
  const inputs = toVehicleInputs(spec);
  const accel = inputs ? zeroToHundred(inputs) : null;
  const top = inputs ? topSpeedDetailed(inputs) : null;

  const car: CatalogueCar = {
    id: BUILD_ID,
    name: spec.name.trim() || 'Your build',
    fullName: null,
    kind: 'build',
    parent: null,
    url: editHref,
    generationCode: null,

    brandId: '',
    brandName: 'Your build',
    accentColor: BUILD_ACCENT,
    logoSrc: '',
    country: '',
    countryId: '',

    bodyStyles: spec.bodyStyle ? [spec.bodyStyle] : [],
    powertrains: spec.powertrain ? [spec.powertrain] : [],
    drivetrains: spec.drivetrain ? [spec.drivetrain] : [],
    segment: spec.segment || null,
    positioning: null,
    eras: [],

    // A build was never produced, and the row renders as a gap rather than as
    // a year it could be mistaken for.
    yearStart: 0,
    yearEnd: null,

    heroSrc: null,
    heroSrcset: null,
    heroAlt: null,

    lengthMm: spec.lengthMm > 0 ? spec.lengthMm : null,
    widthMm: spec.widthMm > 0 ? spec.widthMm : null,
    heightMm: spec.heightMm > 0 ? spec.heightMm : null,

    trims: [],

    powerKwMax: spec.powerKw > 0 ? spec.powerKw : null,
    torqueNmMax: spec.torqueNm > 0 ? spec.torqueNm : null,
    dragCoefficientMin: spec.dragCoefficient > 0 ? spec.dragCoefficient : null,
    zeroToHundredMinS: accel?.seconds ?? null,
    topSpeedMaxKmh: top?.kmh ?? null,
    // Deliberately null — see the note at the top of this file.
    consumptionMinL100km: null,
    massMinKg: spec.massKg > 0 ? spec.massKg : null,
    priceMin: null,
    // A build is a set of physical inputs, not a body with seats and a boot.
    // Practicality is not something the visitor specified, so it stays absent
    // rather than being defaulted into a comparison row.
    seatsMax: null,
    bootLitresMax: null,
  };

  return { car, spec, unmodelled: inputs === null };
}
