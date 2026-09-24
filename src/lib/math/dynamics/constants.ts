/**
 * Default constants for the vehicle-dynamics model.
 *
 * Every value here is a **reasoned default, not a measurement**, and each one
 * carries the reasoning that justifies it so `/methodology/` can publish the
 * basis rather than the bare number. These are an open item
 * to be set with real seed data; this is the starting position, gathered in one
 * file precisely so it can be tuned without hunting through the solver.
 *
 * The honesty rule that governs the whole module: an output computed from these
 * is **modelled**, never a manufacturer claim and never a test result.
 */

export interface ConstantNote {
  value: number;
  unit: string;
  /** Published on /methodology/ next to the value. */
  basis: string;
}

/** Sea-level air density at 15 °C, ISA standard. */
export const AIR_DENSITY: ConstantNote = {
  value: 1.225,
  unit: 'kg/m3',
  basis:
    'ISA standard atmosphere at sea level, 15 °C. Real density varies with altitude and temperature by several percent; the model does not attempt to correct for either, so drag figures are quoted at standard conditions.',
};

export const GRAVITY: ConstantNote = {
  value: 9.80665,
  unit: 'm/s2',
  basis: 'Standard gravity, by definition.',
};

/**
 * Tyre–road friction coefficient by era.
 *
 * Tyre compounds and construction improved enormously across the period this
 * catalog covers, and using one modern figure for a 1970s car on cross-plies
 * would flatter its braking and launch numbers badly. These are conservative
 * dry-asphalt values for a car in good condition on tyres of its own period.
 */
export const TYRE_GRIP_BY_ERA: { maxYear: number; mu: number; basis: string }[] = [
  {
    maxYear: 1969,
    mu: 0.65,
    basis: 'Cross-ply and early radial tyres on dry asphalt.',
  },
  {
    maxYear: 1989,
    mu: 0.8,
    basis: 'Period radial tyres on dry asphalt.',
  },
  {
    maxYear: 2009,
    mu: 0.9,
    basis: 'Modern radial road tyres on dry asphalt.',
  },
  {
    maxYear: 9999,
    mu: 1.0,
    basis: 'Contemporary performance road tyres on dry asphalt.',
  },
];

export function tyreGripForYear(year: number): number {
  return TYRE_GRIP_BY_ERA.find((band) => year <= band.maxYear)?.mu ?? 1.0;
}

/**
 * Rolling-resistance coefficient.
 *
 * Textbook range for passenger-car tyres on asphalt is roughly 0.010–0.015.
 * The model uses the middle of that band and does not vary it by era, because
 * the improvement in rolling resistance over time is real but much smaller than
 * the spread between individual tyre models — a per-era split would imply a
 * precision the model does not have.
 */
export const ROLLING_RESISTANCE: ConstantNote = {
  value: 0.012,
  unit: '',
  basis:
    'Mid-range value for passenger-car tyres on asphalt (typical range 0.010–0.015). Not varied by era: the spread between individual tyre models is wider than the historical trend, so a per-era figure would imply precision the model does not have.',
};

/**
 * Drivetrain efficiency — the fraction of crankshaft power reaching the road.
 *
 * These are the standard rules of thumb. They are the single largest source of
 * uncertainty in the top-speed and acceleration figures, which is why they are
 * stated rather than buried.
 */
export const DRIVETRAIN_EFFICIENCY: Record<string, ConstantNote> = {
  fwd: {
    value: 0.9,
    unit: '',
    basis: 'Transverse front-wheel drive, shortest path from engine to wheels.',
  },
  rwd: {
    value: 0.88,
    unit: '',
    basis: 'Longitudinal rear-wheel drive through a propshaft and final drive.',
  },
  awd: {
    value: 0.85,
    unit: '',
    basis: 'All-wheel drive: an extra differential and transfer path to drive.',
  },
  '4wd': {
    value: 0.83,
    unit: '',
    basis: 'Part-time four-wheel drive with a transfer case, typically heavier-duty and less efficient.',
  },
};

export function drivetrainEfficiency(drivetrain: string): number {
  return DRIVETRAIN_EFFICIENCY[drivetrain]?.value ?? 0.87;
}

/**
 * Static weight distribution on the driven axle, before load transfer.
 *
 * Used by the traction-limited launch phase. Real figures vary per car; these
 * are the conventional layout averages, and any car whose real distribution is
 * known should override them rather than rely on this.
 */
export const DRIVEN_AXLE_WEIGHT_FRACTION: Record<string, number> = {
  fwd: 0.62,
  rwd: 0.48,
  awd: 1.0,
  '4wd': 1.0,
};

/**
 * Longitudinal load transfer under acceleration, as a fraction of `a/g`.
 *
 * A proper treatment needs CG height and wheelbase, which are not in the data
 * for most cars. This uses the ratio typical of a passenger car (CG height
 * ≈ 0.55 m, wheelbase ≈ 2.7 m → h/L ≈ 0.20) and is explicitly an approximation.
 */
export const LOAD_TRANSFER_RATIO: ConstantNote = {
  value: 0.2,
  unit: '',
  basis:
    'CG height over wheelbase, h/L ≈ 0.55 m / 2.7 m, typical of a passenger car. A per-car figure would need CG height, which is almost never published.',
};

/**
 * Mean fraction of peak power actually available during a standing-start run.
 *
 * **This is the model's largest deliberate approximation, and it exists because
 * the naive alternative is measurably wrong.** Integrating a 0–100 with full
 * peak power available from a standstill assumes an engine that makes its
 * rated output at every engine speed and a gearbox that changes ratio in zero
 * time. It does neither. A combustion engine sweeps its rev range in each gear,
 * spending most of the run below peak power, and loses roughly 0.3–0.5 s per
 * shift. Modelling the run at full power made this model predict a VW Golf at
 * 7.1 s against a published 9.2 s — a 23% error in the flattering direction.
 *
 * These factors are applied **only to acceleration**, never to top speed —
 * which is physically correct rather than convenient, because top speed occurs
 * precisely where the engine *is* at peak power.
 *
 * They are reasoned defaults, not measurements, and exactly
 * this class of constant stays open until there is real seed data to tune against.
 */
export const POWER_AVAILABILITY: Record<string, ConstantNote> = {
  ice: {
    value: 0.7,
    unit: '',
    basis:
      'Combustion engine through a multi-speed gearbox: the engine sweeps its rev range in each gear rather than sitting at peak power, and each shift costs roughly 0.3–0.5 s. Calibrated so the model lands close to published figures for cars across the range rather than flattering them.',
  },
  electric: {
    value: 0.92,
    unit: '',
    basis:
      'Electric drive with a single reduction gear: near-peak torque from zero and no shifts, so far more of the rated output is genuinely available. Not 1.0 — motor power still tapers above base speed.',
  },
};

const ELECTRIC_POWERTRAINS = new Set(['bev', 'fcev', 'range-extender']);

export function powerAvailability(powertrain: string): number {
  return ELECTRIC_POWERTRAINS.has(powertrain)
    ? POWER_AVAILABILITY.electric!.value
    : POWER_AVAILABILITY.ice!.value;
}

/**
 * Frontal area as a fraction of the width × height bounding box.
 *
 * The standing approximation for cars. Anything derived from it must be flagged
 * `estimated`, which the schema already enforces by requiring a `sourceNote`.
 */
export const FRONTAL_AREA_FACTOR: ConstantNote = {
  value: 0.85,
  unit: '',
  basis:
    'Standard approximation: a car fills roughly 85% of its width × height bounding box when viewed head-on. Published frontal areas are used in preference wherever they exist.',
};

/** Energy content of one litre of fuel, for consumption modelling. */
export const FUEL_ENERGY: Record<string, ConstantNote> = {
  petrol: {
    value: 32.0,
    unit: 'MJ/L',
    basis: 'Lower heating value of gasoline, approximately 32 MJ/L.',
  },
  diesel: {
    value: 35.8,
    unit: 'MJ/L',
    basis: 'Lower heating value of diesel, approximately 35.8 MJ/L.',
  },
};

/**
 * Tank-to-wheel thermal efficiency at steady cruise.
 *
 * At a constant motorway speed an engine sits far closer to its efficiency
 * island than in mixed driving, so these are cruise figures and would be
 * optimistic if applied to a drive cycle.
 */
export const POWERTRAIN_EFFICIENCY: Record<string, ConstantNote> = {
  petrol: {
    value: 0.28,
    unit: '',
    basis: 'Petrol engine at steady cruise, near its efficiency island. Lower in mixed driving.',
  },
  diesel: {
    value: 0.34,
    unit: '',
    basis: 'Diesel engine at steady cruise.',
  },
  hybrid: {
    value: 0.32,
    unit: '',
    basis: 'Full hybrid at steady cruise, where the electric path contributes little.',
  },
  phev: {
    value: 0.32,
    unit: '',
    basis: 'Plug-in hybrid running its combustion engine at steady cruise.',
  },
  bev: {
    value: 0.85,
    unit: '',
    basis: 'Battery to wheels: inverter, motor and reduction gear losses only.',
  },
  fcev: {
    value: 0.5,
    unit: '',
    basis: 'Fuel cell to wheels, including stack and drive losses.',
  },
};

export function powertrainEfficiency(powertrain: string): number {
  return POWERTRAIN_EFFICIENCY[powertrain]?.value ?? 0.28;
}

/**
 * Every constant, flattened for `/methodology/`.
 *
 * Exported as data rather than restated in prose on the page, so the published
 * methodology cannot drift away from the numbers the model actually uses.
 */
export function allConstants(): { name: string; value: number; unit: string; basis: string }[] {
  const rows: { name: string; value: number; unit: string; basis: string }[] = [
    { name: 'Air density (ρ)', ...AIR_DENSITY },
    { name: 'Standard gravity (g)', ...GRAVITY },
    { name: 'Rolling resistance (Crr)', ...ROLLING_RESISTANCE },
    { name: 'Frontal-area factor', ...FRONTAL_AREA_FACTOR },
    { name: 'Load-transfer ratio (h/L)', ...LOAD_TRANSFER_RATIO },
  ];
  for (const band of TYRE_GRIP_BY_ERA) {
    rows.push({
      name: `Tyre grip (μ), up to ${band.maxYear === 9999 ? 'present' : band.maxYear}`,
      value: band.mu,
      unit: '',
      basis: band.basis,
    });
  }
  for (const [key, note] of Object.entries(DRIVETRAIN_EFFICIENCY)) {
    rows.push({ name: `Drivetrain efficiency — ${key.toUpperCase()}`, ...note });
  }
  for (const [key, note] of Object.entries(POWERTRAIN_EFFICIENCY)) {
    rows.push({ name: `Powertrain efficiency — ${key}`, ...note });
  }
  for (const [key, note] of Object.entries(FUEL_ENERGY)) {
    rows.push({ name: `Fuel energy — ${key}`, ...note });
  }
  for (const [key, note] of Object.entries(POWER_AVAILABILITY)) {
    rows.push({ name: `Power availability in acceleration — ${key}`, ...note });
  }
  return rows;
}
