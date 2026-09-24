/**
 * Shared filtering and ranking.
 *
 * Two tools sit on this module and they are deliberately different:
 *
 *  - **Guided Browse** applies dealbreakers only and ends in a filtered
 *    list. No scoring, no ranking, no opinion.
 *  - **Matchmaker** applies the same dealbreakers first, then ranks
 *    what survives by weighted preference.
 *
 * So filtering and ranking are separate, composable functions rather than one
 * `recommend()` that does both. That split is the whole architecture: Guided
 * Browse calls the first, Matchmaker calls both, and neither can silently
 * disagree with the other about what "matches".
 */

export interface Candidate {
  id: string;
  label: string;
  bodyStyles: string[];
  powertrains: string[];
  drivetrains: string[];
  segment?: string;
  positioning?: string;
  eras: string[];
  price?: number | null;
  seats?: number | null;
  consumptionPer100km?: number | null;
  zeroToHundredSeconds?: number | null;
  powerToWeightKwPerTonne?: number | null;
  bootLitres?: number | null;
  productionStart: number;
  productionEnd: number | null;
}

// ---------------------------------------------------------------------------
// Dealbreakers — hard filters
// ---------------------------------------------------------------------------

export interface Dealbreakers {
  /** Any of these body styles. Empty or absent means "no constraint". */
  bodyStyles?: string[];
  powertrains?: string[];
  drivetrains?: string[];
  segments?: string[];
  positioning?: string[];
  maxPrice?: number;
  minSeats?: number;
  maxConsumption?: number;
  producedAfter?: number;
  producedBefore?: number;
}

export interface FilterOutcome {
  candidate: Candidate;
  passed: boolean;
  /** Which dealbreakers it failed, so a UI can say *why* nothing matched. */
  failedOn: string[];
}

/**
 * Applies dealbreakers, reporting why each candidate failed.
 *
 * The `failedOn` detail is the difference between a useful tool and a
 * frustrating one: "0 results" is a dead end, while "12 cars matched
 * everything except your budget" tells the visitor exactly which constraint to
 * relax.
 *
 * A candidate missing the data a dealbreaker tests **fails** it. That is the
 * conservative direction: if someone requires under 6 L/100 km, a car whose
 * consumption we have never sourced must not be presented as satisfying it.
 */
export function applyDealbreakers(
  candidates: Candidate[],
  dealbreakers: Dealbreakers,
): FilterOutcome[] {
  return candidates.map((candidate) => {
    const failedOn: string[] = [];

    const anyOf = (required: string[] | undefined, has: string[], label: string) => {
      if (!required || required.length === 0) return;
      if (!required.some((r) => has.includes(r))) failedOn.push(label);
    };

    anyOf(dealbreakers.bodyStyles, candidate.bodyStyles, 'body style');
    anyOf(dealbreakers.powertrains, candidate.powertrains, 'powertrain');
    anyOf(dealbreakers.drivetrains, candidate.drivetrains, 'drivetrain');
    anyOf(dealbreakers.segments, candidate.segment ? [candidate.segment] : [], 'segment');
    anyOf(
      dealbreakers.positioning,
      candidate.positioning ? [candidate.positioning] : [],
      'positioning',
    );

    if (dealbreakers.maxPrice !== undefined) {
      if (candidate.price === null || candidate.price === undefined) failedOn.push('price (unknown)');
      else if (candidate.price > dealbreakers.maxPrice) failedOn.push('price');
    }

    if (dealbreakers.minSeats !== undefined) {
      if (candidate.seats === null || candidate.seats === undefined) failedOn.push('seats (unknown)');
      else if (candidate.seats < dealbreakers.minSeats) failedOn.push('seats');
    }

    if (dealbreakers.maxConsumption !== undefined) {
      if (candidate.consumptionPer100km === null || candidate.consumptionPer100km === undefined) {
        failedOn.push('consumption (unknown)');
      } else if (candidate.consumptionPer100km > dealbreakers.maxConsumption) {
        failedOn.push('consumption');
      }
    }

    if (dealbreakers.producedAfter !== undefined) {
      const end = candidate.productionEnd ?? new Date().getUTCFullYear();
      if (end < dealbreakers.producedAfter) failedOn.push('production era');
    }
    if (dealbreakers.producedBefore !== undefined) {
      if (candidate.productionStart > dealbreakers.producedBefore) failedOn.push('production era');
    }

    return { candidate, passed: failedOn.length === 0, failedOn };
  });
}

/** Guided Browse: the survivors, nothing more. */
export function filterCandidates(
  candidates: Candidate[],
  dealbreakers: Dealbreakers,
): Candidate[] {
  return applyDealbreakers(candidates, dealbreakers)
    .filter((outcome) => outcome.passed)
    .map((outcome) => outcome.candidate);
}

/**
 * Which single constraint is costing the most matches.
 *
 * Powers the "relax this and 12 more cars appear" hint that turns an empty
 * result into a next step.
 */
export function blockingConstraints(
  outcomes: FilterOutcome[],
): { constraint: string; blocks: number }[] {
  const counts = new Map<string, number>();
  for (const outcome of outcomes) {
    if (outcome.passed) continue;
    // Only count candidates blocked by exactly one thing: those are the ones
    // that would actually appear if that constraint were relaxed.
    if (outcome.failedOn.length === 1) {
      const key = outcome.failedOn[0]!;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([constraint, blocks]) => ({ constraint, blocks }))
    .sort((a, b) => b.blocks - a.blocks);
}

// ---------------------------------------------------------------------------
// Preferences — weighted ranking
// ---------------------------------------------------------------------------

/** How much each preference matters, 0 (don't care) to 1 (matters most). */
export interface Preferences {
  economy?: number;
  performance?: number;
  practicality?: number;
  affordability?: number;
}

export interface RankedMatch {
  candidate: Candidate;
  /** 0–100. A percentage match against the stated preferences only. */
  matchPercent: number;
  breakdown: { preference: string; score: number; weight: number }[];
  /** Preferences that could not be scored for lack of data. */
  unscored: string[];
}

function normalise(value: number, low: number, high: number): number {
  if (high === low) return 0;
  return Math.max(0, Math.min(1, (value - low) / (high - low)));
}

/**
 * Ranks candidates by weighted preference.
 *
 * Scores are relative **to the supplied set**, not to absolute bands, which is
 * what makes the percentage meaningful: "best of what fits your dealbreakers"
 * is the question actually being asked, and a fixed scale would tell every
 * budget-constrained visitor that all their options are mediocre.
 */
export function rankByPreference(
  candidates: Candidate[],
  preferences: Preferences,
): RankedMatch[] {
  if (candidates.length === 0) return [];

  const range = (pick: (c: Candidate) => number | null | undefined) => {
    const values = candidates
      .map(pick)
      .filter((v): v is number => v !== null && v !== undefined && Number.isFinite(v));
    if (values.length === 0) return null;
    return { low: Math.min(...values), high: Math.max(...values) };
  };

  const ranges = {
    economy: range((c) => c.consumptionPer100km),
    performance: range((c) => c.powerToWeightKwPerTonne),
    practicality: range((c) => c.bootLitres),
    affordability: range((c) => c.price),
  };

  return candidates
    .map((candidate) => {
      const breakdown: { preference: string; score: number; weight: number }[] = [];
      const unscored: string[] = [];
      let weighted = 0;
      let weightUsed = 0;

      const consider = (
        key: keyof Preferences,
        value: number | null | undefined,
        bounds: { low: number; high: number } | null,
        invert: boolean,
      ) => {
        const weight = preferences[key];
        if (!weight || weight <= 0) return;
        if (value === null || value === undefined || !bounds) {
          unscored.push(key);
          return;
        }
        const raw = normalise(value, bounds.low, bounds.high);
        const score = invert ? 1 - raw : raw;
        breakdown.push({ preference: key, score, weight });
        weighted += score * weight;
        weightUsed += weight;
      };

      // Lower is better for consumption and price; higher is better for the rest.
      consider('economy', candidate.consumptionPer100km, ranges.economy, true);
      consider('performance', candidate.powerToWeightKwPerTonne, ranges.performance, false);
      consider('practicality', candidate.bootLitres, ranges.practicality, false);
      consider('affordability', candidate.price, ranges.affordability, true);

      return {
        candidate,
        matchPercent: weightUsed > 0 ? (weighted / weightUsed) * 100 : 0,
        breakdown,
        unscored,
      };
    })
    .sort((a, b) => b.matchPercent - a.matchPercent || a.candidate.label.localeCompare(b.candidate.label));
}

/**
 * Matchmaker end to end: dealbreakers, then ranking of the survivors.
 *
 * Composed from the two functions above rather than reimplementing either, so
 * Matchmaker and Guided Browse can never disagree about what passes.
 */
export function matchmake(
  candidates: Candidate[],
  dealbreakers: Dealbreakers,
  preferences: Preferences,
): { ranked: RankedMatch[]; outcomes: FilterOutcome[]; blocking: { constraint: string; blocks: number }[] } {
  const outcomes = applyDealbreakers(candidates, dealbreakers);
  const survivors = outcomes.filter((o) => o.passed).map((o) => o.candidate);
  return {
    ranked: rankByPreference(survivors, preferences),
    outcomes,
    blocking: blockingConstraints(outcomes),
  };
}
