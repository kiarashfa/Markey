/**
 * The Markey Score.
 *
 * One blended headline number from a small set of interpretable sub-factors.
 * The full formula is published on `/methodology/`, never a black box.
 *
 * **The weights are an open item** and cannot be tuned
 * meaningfully until there is real seed data. They therefore live as named
 * constants in one exported object, so tuning them is editing one literal
 * rather than hunting through a scoring function. Nothing else in the codebase
 * may hardcode a weight.
 *
 * Two rules the design has to hold to:
 *
 *  1. **A car is never scored on data it doesn't have.** Missing sub-factors are
 *     excluded and the weights renormalised across what remains, with the
 *     coverage reported. Treating a missing figure as zero would rank
 *     under-documented cars last, which measures our research, not the car.
 *  2. **The score is comparative, not absolute.** 72 does not mean "72% good";
 *     it means "better than a 60 on these factors, on these weights". The UI
 *     says so.
 */

export interface ScoreWeights {
  efficiency: number;
  performance: number;
  practicality: number;
  valueRetention: number;
}

/**
 * The weights. **Provisional.**
 *
 * Equal weighting is the honest starting position: any other split would be an
 * assertion about what matters that we have no evidence for yet. It is
 * deliberately a placeholder that looks like a placeholder.
 */
export const SCORE_WEIGHTS: ScoreWeights = {
  efficiency: 0.25,
  performance: 0.25,
  practicality: 0.25,
  valueRetention: 0.25,
};

export const WEIGHTS_ARE_PROVISIONAL = true;

export const SCORE_METHODOLOGY_NOTE =
  'The Markey Score blends four sub-factors on equal weights. Those weights are provisional: they will be tuned once there is enough of a catalog to tune against, and equal weighting is what we use in the meantime rather than inventing a split we cannot justify. A score is a comparison between cars on these factors — it is not a percentage, and it is not a verdict.';

export interface ScoreInputs {
  /** L/100 km, or the kWh/100 km equivalent for an electric car. */
  consumptionPer100km?: number | null;
  isElectric?: boolean;
  /** 0–100 km/h, seconds. */
  zeroToHundredSeconds?: number | null;
  powerToWeightKwPerTonne?: number | null;
  /** Boot volume in litres, where known. */
  bootLitres?: number | null;
  /** Overall length, mm — a proxy for interior space. */
  lengthMm?: number | null;
  /** Annual depreciation rate, 0–1, from `depreciation.ts`. */
  annualDepreciationRate?: number | null;
}

export interface SubScore {
  factor: keyof ScoreWeights;
  label: string;
  /** 0–100. */
  score: number;
  weight: number;
  explanation: string;
}

export interface ScoreResult {
  /** 0–100, or null when nothing could be scored. */
  score: number;
  subScores: SubScore[];
  /** Fraction of the total weight that had data behind it, 0–1. */
  coverage: number;
  missing: (keyof ScoreWeights)[];
}

function normalise(value: number, low: number, high: number): number {
  if (high === low) return 0;
  return Math.max(0, Math.min(100, ((value - low) / (high - low)) * 100));
}

/** Higher input, lower score. */
function normaliseInverted(value: number, low: number, high: number): number {
  return 100 - normalise(value, low, high);
}

export function markeyScore(
  inputs: ScoreInputs,
  weights: ScoreWeights = SCORE_WEIGHTS,
): ScoreResult | null {
  const subScores: SubScore[] = [];
  const missing: (keyof ScoreWeights)[] = [];

  // --- efficiency --------------------------------------------------------
  if (inputs.consumptionPer100km && inputs.consumptionPer100km > 0) {
    // Electric consumption is on a different scale entirely (kWh vs litres),
    // so the bands differ. Scoring both against one range would rank every EV
    // as perfect, which measures the unit, not the car.
    const score = inputs.isElectric
      ? normaliseInverted(inputs.consumptionPer100km, 12, 30)
      : normaliseInverted(inputs.consumptionPer100km, 3, 20);
    subScores.push({
      factor: 'efficiency',
      label: 'Efficiency',
      score,
      weight: weights.efficiency,
      explanation: inputs.isElectric
        ? `${inputs.consumptionPer100km.toFixed(1)} kWh/100 km, scored against a 12–30 band.`
        : `${inputs.consumptionPer100km.toFixed(1)} L/100 km, scored against a 3–20 band.`,
    });
  } else {
    missing.push('efficiency');
  }

  // --- performance -------------------------------------------------------
  const perfParts: number[] = [];
  const perfNotes: string[] = [];
  if (inputs.zeroToHundredSeconds && inputs.zeroToHundredSeconds > 0) {
    perfParts.push(normaliseInverted(inputs.zeroToHundredSeconds, 2.5, 15));
    perfNotes.push(`0–100 in ${inputs.zeroToHundredSeconds.toFixed(1)} s`);
  }
  if (inputs.powerToWeightKwPerTonne && inputs.powerToWeightKwPerTonne > 0) {
    perfParts.push(normalise(inputs.powerToWeightKwPerTonne, 40, 300));
    perfNotes.push(`${inputs.powerToWeightKwPerTonne.toFixed(0)} kW/t`);
  }
  if (perfParts.length > 0) {
    subScores.push({
      factor: 'performance',
      label: 'Performance',
      score: perfParts.reduce((a, b) => a + b, 0) / perfParts.length,
      weight: weights.performance,
      explanation: perfNotes.join(', ') + '.',
    });
  } else {
    missing.push('performance');
  }

  // --- practicality ------------------------------------------------------
  const pracParts: number[] = [];
  const pracNotes: string[] = [];
  if (inputs.bootLitres && inputs.bootLitres > 0) {
    pracParts.push(normalise(inputs.bootLitres, 150, 700));
    pracNotes.push(`${inputs.bootLitres} L boot`);
  }
  if (inputs.lengthMm && inputs.lengthMm > 0) {
    pracParts.push(normalise(inputs.lengthMm, 3400, 5200));
    pracNotes.push(`${inputs.lengthMm} mm long`);
  }
  if (pracParts.length > 0) {
    subScores.push({
      factor: 'practicality',
      label: 'Practicality',
      score: pracParts.reduce((a, b) => a + b, 0) / pracParts.length,
      weight: weights.practicality,
      explanation: pracNotes.join(', ') + '.',
    });
  } else {
    missing.push('practicality');
  }

  // --- value retention ---------------------------------------------------
  if (inputs.annualDepreciationRate && inputs.annualDepreciationRate > 0) {
    subScores.push({
      factor: 'valueRetention',
      label: 'Value retention',
      score: normaliseInverted(inputs.annualDepreciationRate, 0.1, 0.35),
      weight: weights.valueRetention,
      explanation: `Projected to lose ${(inputs.annualDepreciationRate * 100).toFixed(0)}% of remaining value per year.`,
    });
  } else {
    missing.push('valueRetention');
  }

  if (subScores.length === 0) return null;

  const totalWeight = subScores.reduce((sum, s) => sum + s.weight, 0);
  const allWeight = Object.values(weights).reduce((a, b) => a + b, 0);
  const weighted = subScores.reduce((sum, s) => sum + s.score * s.weight, 0);

  return {
    score: weighted / totalWeight,
    subScores,
    coverage: allWeight > 0 ? totalWeight / allWeight : 0,
    missing,
  };
}

/**
 * Whether a score has enough behind it to be worth showing.
 *
 * A headline number resting on one of four sub-factors invites more confidence
 * than it has earned. Below half coverage the UI shows the sub-scores it does
 * have and withholds the blended number.
 */
export const MINIMUM_COVERAGE_TO_DISPLAY = 0.5;

export function isScoreDisplayable(result: ScoreResult | null): boolean {
  return result !== null && result.coverage >= MINIMUM_COVERAGE_TO_DISPLAY;
}
