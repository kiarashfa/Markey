/**
 * Depreciation.
 *
 * A transparent, formula-driven decay curve. **Explicitly a projection, never a
 * live market-data claim.** Real used-car pricing sits in the
 * "likely not obtainable at all" column for a free global static site, so this
 * module exists to be honest about modelling rather than to pretend at data it
 * cannot have.
 *
 * The model is exponential decay with a segment- and tier-dependent rate,
 * adjusted for mileage and condition:
 *
 *   `value(t) = price · (1 − rate)^t · mileageFactor · conditionFactor`
 *
 * Exponential rather than linear because that is how cars actually behave — a
 * fixed percentage of remaining value each year, so the curve is steep early
 * and flattens out. A linear model would reach zero on a specific date, which
 * no car does.
 *
 * Where the owner has logged real valuations (`valueAnchors`),
 * those are plotted on the same chart as points. The curve is never fitted to
 * them: a projection that quietly rewrites itself to pass through user data
 * stops being a projection and starts being a very short trend line.
 */

export interface DecayRate {
  /** Fraction of remaining value lost per year. */
  rate: number;
  basis: string;
}

/**
 * Annual decay rates by market-positioning tier.
 *
 * The ordering — premium and luxury cars losing value faster in percentage
 * terms than mainstream ones — is a well-established pattern: they carry more
 * optional equipment that does not survive resale, cost more to maintain out of
 * warranty, and sell into a thinner used market. Ultra-luxury is not simply the
 * next step up, because at that tier collectibility starts to counteract
 * depreciation entirely, which is why it is flagged for a caveat rather than
 * projected confidently.
 */
export const DECAY_BY_POSITIONING: Record<string, DecayRate> = {
  economy: {
    rate: 0.15,
    basis: 'Low purchase price, strong used demand, cheap to run and repair.',
  },
  mainstream: {
    rate: 0.17,
    basis: 'The volume market, and the reference point for the other tiers.',
  },
  premium: {
    rate: 0.2,
    basis: 'Higher option content that does not survive resale, and dearer out-of-warranty maintenance.',
  },
  luxury: {
    rate: 0.24,
    basis: 'A thin used market and running costs that deter second owners.',
  },
  'ultra-luxury': {
    rate: 0.18,
    basis:
      'Very low volume, where collectibility begins to counteract depreciation. The least predictable tier by a wide margin: individual cars deviate enormously and this figure should be read as barely more than a placeholder.',
  },
};

/** Powertrain adjustment, in percentage points added to the annual rate. */
export const DECAY_ADJUSTMENT_BY_POWERTRAIN: Record<string, DecayRate> = {
  bev: {
    rate: 0.03,
    basis:
      'Battery-electric cars have depreciated faster than combustion equivalents through the 2020s, as rapid model-cycle improvement and battery-health uncertainty both weigh on used values. This is a real observed pattern rather than a permanent property, and is a prime candidate for revision.',
  },
  phev: {
    rate: 0.01,
    basis: 'Plug-in hybrids sit between the two, with some of the same battery-life uncertainty.',
  },
};

export const DEFAULT_ANNUAL_KM = 15000;

export interface DepreciationInputs {
  /** Original purchase price, in any currency — output is in the same one. */
  purchasePrice: number;
  /** Years since purchase. Fractional years are fine. */
  ageYears: number;
  positioning?: string;
  powertrain?: string;
  /** Actual distance covered, km. Compared against the expected average. */
  mileageKm?: number;
  /** Expected annual distance for the mileage adjustment. */
  annualKmExpected?: number;
  /** 0.85 (rough) to 1.1 (exceptional). 1.0 is average for its age. */
  conditionFactor?: number;
  /** Override the modelled rate entirely. */
  annualRateOverride?: number;
}

export interface DepreciationResult {
  /** Projected current value. */
  value: number;
  /** Total lost since purchase. */
  lost: number;
  /** Fraction of the original price retained, 0–1. */
  retained: number;
  /** The annual rate actually used, after all adjustments. */
  effectiveAnnualRate: number;
  /** Adjustments applied, for showing the working. */
  workings: string[];
}

/**
 * Mileage adjustment.
 *
 * Value moves with distance relative to what the car "should" have covered by
 * now. Capped at ±25% because beyond that mileage stops being a linear
 * modifier: a 300,000 km car is not priced by formula, it is priced by
 * inspection.
 */
export function mileageFactor(
  mileageKm: number,
  ageYears: number,
  annualKmExpected: number = DEFAULT_ANNUAL_KM,
): number {
  if (ageYears <= 0 || annualKmExpected <= 0) return 1;
  const expected = annualKmExpected * ageYears;
  if (expected <= 0) return 1;
  const ratio = mileageKm / expected;
  // 10% of value per whole multiple of expected mileage, clamped.
  const adjustment = (1 - ratio) * 0.1;
  return 1 + Math.max(-0.25, Math.min(0.25, adjustment));
}

/**
 * Projected value.
 *
 * Returns `null` for nonsense inputs rather than a number, so a caller cannot
 * render a projection built on a negative price or a negative age.
 */
export function depreciate(inputs: DepreciationInputs): DepreciationResult | null {
  const {
    purchasePrice,
    ageYears,
    positioning = 'mainstream',
    powertrain,
    mileageKm,
    annualKmExpected = DEFAULT_ANNUAL_KM,
    conditionFactor = 1,
    annualRateOverride,
  } = inputs;

  if (purchasePrice <= 0 || ageYears < 0) return null;
  if (conditionFactor <= 0) return null;

  const workings: string[] = [];

  let rate: number;
  if (annualRateOverride !== undefined) {
    rate = annualRateOverride;
    workings.push(`Annual rate overridden to ${(rate * 100).toFixed(1)}%.`);
  } else {
    const base = DECAY_BY_POSITIONING[positioning] ?? DECAY_BY_POSITIONING.mainstream!;
    rate = base.rate;
    workings.push(`Base rate ${(base.rate * 100).toFixed(0)}%/yr for the ${positioning} tier.`);

    const adjustment = powertrain ? DECAY_ADJUSTMENT_BY_POWERTRAIN[powertrain] : undefined;
    if (adjustment) {
      rate += adjustment.rate;
      workings.push(
        `+${(adjustment.rate * 100).toFixed(0)} points for a ${powertrain} powertrain.`,
      );
    }
  }

  rate = Math.max(0, Math.min(0.6, rate));

  let value = purchasePrice * Math.pow(1 - rate, ageYears);
  workings.push(
    `${purchasePrice.toLocaleString()} × (1 − ${rate.toFixed(2)})^${ageYears} after ${ageYears} year${ageYears === 1 ? '' : 's'}.`,
  );

  if (mileageKm !== undefined && mileageKm >= 0) {
    const factor = mileageFactor(mileageKm, ageYears, annualKmExpected);
    value *= factor;
    const direction = factor >= 1 ? 'below' : 'above';
    workings.push(
      `Mileage ${direction} the ${annualKmExpected.toLocaleString()} km/yr assumption: ×${factor.toFixed(3)}.`,
    );
  }

  if (conditionFactor !== 1) {
    value *= conditionFactor;
    workings.push(`Condition: ×${conditionFactor.toFixed(2)}.`);
  }

  return {
    value,
    lost: purchasePrice - value,
    retained: value / purchasePrice,
    effectiveAnnualRate: rate,
    workings,
  };
}

export interface CurvePoint {
  ageYears: number;
  value: number;
}

/**
 * The projected curve, for charting.
 *
 * Mileage is projected forward at the expected annual rate rather than held at
 * today's odometer reading, because a curve that assumes a car stops being
 * driven is not a projection of anything.
 */
export function depreciationCurve(
  inputs: DepreciationInputs,
  toAgeYears = 15,
  stepYears = 0.5,
): CurvePoint[] {
  const points: CurvePoint[] = [];
  const annualKm = inputs.annualKmExpected ?? DEFAULT_ANNUAL_KM;

  for (let age = 0; age <= toAgeYears; age += stepYears) {
    const projected = depreciate({
      ...inputs,
      ageYears: age,
      mileageKm: inputs.mileageKm !== undefined ? annualKm * age : undefined,
    });
    if (projected) points.push({ ageYears: age, value: projected.value });
  }
  return points;
}

/**
 * How far a real logged valuation sits from the projection.
 *
 * My Garage lets an owner record real valuations they looked up. This
 * reports the gap between those anchors and the curve **without altering the
 * curve** — the divergence is the interesting thing, and hiding it by refitting
 * would throw away the only real market data the site ever sees.
 */
export function anchorDeviation(
  anchors: { ageYears: number; value: number }[],
  inputs: DepreciationInputs,
): { ageYears: number; actual: number; projected: number; deltaPercent: number }[] {
  return anchors
    .map((anchor) => {
      const projection = depreciate({ ...inputs, ageYears: anchor.ageYears });
      if (!projection || projection.value <= 0) return null;
      return {
        ageYears: anchor.ageYears,
        actual: anchor.value,
        projected: projection.value,
        deltaPercent: ((anchor.value - projection.value) / projection.value) * 100,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);
}
