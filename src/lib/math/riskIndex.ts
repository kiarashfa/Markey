/**
 * Relative insurance risk banding.
 *
 * **This never produces a monetary quote, and that is a design constraint
 * rather than a limitation to be worked around.** Insurance pricing is
 * personal (age, licence history, address, claims), actuarial (built on loss
 * data nobody publishes) and regulated (giving a figure that reads as a quote
 * has legal weight in several jurisdictions). A static site cannot responsibly
 * estimate a premium, so this reports a *relative band* — how a car compares to
 * other cars on the factors that are known to matter — and says plainly that a
 * real price depends on the driver, not the car.
 */

export type RiskBand = 1 | 2 | 3 | 4 | 5;

export interface RiskInputs {
  powerKw?: number | null;
  massKg?: number | null;
  /** Original price, for the parts-and-repair-cost dimension. */
  price?: number | null;
  /** 0–100 km/h, seconds. Faster cars are involved in costlier claims. */
  zeroToHundredSeconds?: number | null;
  positioning?: string;
  bodyStyles?: string[];
}

export interface RiskFactorContribution {
  factor: string;
  /** 0–1, where 1 is the highest risk contribution. */
  score: number;
  reason: string;
}

export interface RiskResult {
  band: RiskBand;
  label: string;
  /** 0–100, the blended index behind the band. */
  index: number;
  contributions: RiskFactorContribution[];
  /** Which inputs were missing, so the UI can say the band is partial. */
  missing: string[];
}

export const BAND_LABELS: Record<RiskBand, string> = {
  1: 'Low',
  2: 'Below average',
  3: 'Average',
  4: 'Above average',
  5: 'High',
};

/**
 * Weights for the blended index.
 *
 * Kept as named constants in one place, like the Markey Score's, so they can be
 * tuned without a rewrite. Power-to-weight leads because it is the factor with
 * the strongest and most consistently documented relationship to claim
 * frequency and severity.
 */
export const RISK_WEIGHTS = {
  powerToWeight: 0.4,
  acceleration: 0.25,
  value: 0.25,
  bodyStyle: 0.1,
} as const;

/** Maps a value onto 0–1 across a range, clamped at both ends. */
function normalise(value: number, low: number, high: number): number {
  if (high === low) return 0;
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

/**
 * A relative risk band.
 *
 * Degrades honestly: with only some inputs present it reweights across what it
 * has and reports the rest in `missing`, so the UI can show a partial band as
 * partial rather than passing off a one-factor guess as a full assessment.
 * Returns `null` when nothing usable was supplied at all.
 */
export function riskIndex(inputs: RiskInputs): RiskResult | null {
  const contributions: RiskFactorContribution[] = [];
  const missing: string[] = [];
  let weightedSum = 0;
  let weightUsed = 0;

  // --- power-to-weight ---------------------------------------------------
  if (inputs.powerKw && inputs.massKg && inputs.massKg > 0) {
    const ptw = inputs.powerKw / (inputs.massKg / 1000);
    // 40 kW/t is a slow economy car; 300 kW/t is supercar territory.
    const score = normalise(ptw, 40, 300);
    contributions.push({
      factor: 'Power-to-weight',
      score,
      reason: `${ptw.toFixed(0)} kW per tonne.`,
    });
    weightedSum += score * RISK_WEIGHTS.powerToWeight;
    weightUsed += RISK_WEIGHTS.powerToWeight;
  } else {
    missing.push('power-to-weight');
  }

  // --- acceleration ------------------------------------------------------
  if (inputs.zeroToHundredSeconds && inputs.zeroToHundredSeconds > 0) {
    // Inverted: a lower time is a higher risk score. 3 s is fast, 15 s is slow.
    const score = 1 - normalise(inputs.zeroToHundredSeconds, 3, 15);
    contributions.push({
      factor: 'Acceleration',
      score,
      reason: `0–100 km/h in ${inputs.zeroToHundredSeconds.toFixed(1)} s.`,
    });
    weightedSum += score * RISK_WEIGHTS.acceleration;
    weightUsed += RISK_WEIGHTS.acceleration;
  } else {
    missing.push('acceleration');
  }

  // --- repair cost proxy -------------------------------------------------
  const tierScore: Record<string, number> = {
    economy: 0.1,
    mainstream: 0.3,
    premium: 0.6,
    luxury: 0.85,
    'ultra-luxury': 1,
  };
  if (inputs.positioning && inputs.positioning in tierScore) {
    const score = tierScore[inputs.positioning]!;
    contributions.push({
      factor: 'Repair and parts cost',
      score,
      reason: `${inputs.positioning} tier — a proxy for what a claim costs to settle.`,
    });
    weightedSum += score * RISK_WEIGHTS.value;
    weightUsed += RISK_WEIGHTS.value;
  } else {
    missing.push('market positioning');
  }

  // --- body style --------------------------------------------------------
  if (inputs.bodyStyles && inputs.bodyStyles.length > 0) {
    const elevated = new Set(['coupe', 'roadster', 'convertible', 'targa']);
    const isElevated = inputs.bodyStyles.some((b) => elevated.has(b));
    const score = isElevated ? 0.7 : 0.3;
    contributions.push({
      factor: 'Body style',
      score,
      reason: isElevated
        ? 'Two-door and open bodies correlate with higher claim rates.'
        : 'A body style with no particular claim-rate elevation.',
    });
    weightedSum += score * RISK_WEIGHTS.bodyStyle;
    weightUsed += RISK_WEIGHTS.bodyStyle;
  } else {
    missing.push('body style');
  }

  if (weightUsed === 0) return null;

  // Reweight across whatever was available, rather than treating a missing
  // factor as a zero-risk one — which would make a car with no data look safe.
  const index = (weightedSum / weightUsed) * 100;

  let band: RiskBand;
  if (index < 20) band = 1;
  else if (index < 40) band = 2;
  else if (index < 60) band = 3;
  else if (index < 80) band = 4;
  else band = 5;

  return { band, label: BAND_LABELS[band], index, contributions, missing };
}

/**
 * The sentence the UI must show alongside any band.
 *
 * Exported as a constant rather than left to each template so the caveat cannot
 * be dropped by a component that forgets it.
 */
export const RISK_DISCLAIMER =
  'A relative comparison between cars, not a quote. What you would actually pay depends far more on you — your age, licence history, address and claims record — than on the car. Nothing here is an insurance estimate.';
