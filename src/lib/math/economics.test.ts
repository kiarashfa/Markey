import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  annualFuelCost,
  annualSaving,
  compareRunningCosts,
  fuelCost,
  paybackYears,
} from './fuelCost.ts';
import {
  anchorDeviation,
  depreciate,
  depreciationCurve,
  mileageFactor,
} from './depreciation.ts';
import { RISK_DISCLAIMER, riskIndex } from './riskIndex.ts';
import { isScoreDisplayable, markeyScore, SCORE_WEIGHTS } from './score.ts';
import {
  applyDealbreakers,
  blockingConstraints,
  filterCandidates,
  matchmake,
  rankByPreference,
  type Candidate,
} from './matchmaker.ts';

const close = (actual: number, expected: number, tolerance: number) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

// ---------------------------------------------------------------------------

describe('fuelCost', () => {
  it('costs a distance at a price', () => {
    // 8 L/100 km over 1000 km at 1.75/L = 80 L = 140.
    const result = fuelCost({ consumptionPer100km: 8, pricePerUnit: 1.75, distanceKm: 1000 })!;
    close(result.unitsUsed, 80, 1e-9);
    close(result.cost, 140, 1e-9);
    close(result.costPer100km, 14, 1e-9);
  });

  it('handles zero distance without dividing by zero', () => {
    const result = fuelCost({ consumptionPer100km: 8, pricePerUnit: 1.75, distanceKm: 0 })!;
    assert.equal(result.cost, 0);
    close(result.costPerKm, 0.14, 1e-9);
  });

  it('handles a car that uses nothing', () => {
    const result = fuelCost({ consumptionPer100km: 0, pricePerUnit: 1.75, distanceKm: 1000 })!;
    assert.equal(result.cost, 0);
  });

  it('rejects negative inputs rather than returning a negative cost', () => {
    assert.equal(fuelCost({ consumptionPer100km: -8, pricePerUnit: 1.75, distanceKm: 100 }), null);
    assert.equal(fuelCost({ consumptionPer100km: 8, pricePerUnit: -1.75, distanceKm: 100 }), null);
    assert.equal(fuelCost({ consumptionPer100km: 8, pricePerUnit: 1.75, distanceKm: -100 }), null);
  });

  it('computes an annual cost', () => {
    close(annualFuelCost(6, 1.8, 15000)!.cost, 1620, 1e-9);
  });

  it('sorts a comparison cheapest first, with a price per row', () => {
    // A litre and a kWh are not the same thing, so each row carries its own
    // price — comparing them at one price would be meaningless.
    const rows = compareRunningCosts(
      [
        { label: 'petrol', consumptionPer100km: 8, pricePerUnit: 1.75 },
        { label: 'electric', consumptionPer100km: 18, pricePerUnit: 0.3 },
      ],
      15000,
    );
    assert.equal(rows[0]!.label, 'electric');
    close(rows[0]!.annualCost, 810, 1e-9);
    close(rows[1]!.annualCost, 2100, 1e-9);
  });

  it('computes payback on a fuel saving', () => {
    const saving = annualSaving(6, 9, 1.8, 15000); // 3 L/100km cheaper
    close(saving, 810, 1e-9);
    close(paybackYears(4050, saving)!, 5, 1e-9);
  });

  it('returns null payback when there is no saving', () => {
    // "Never" is the answer, and a number would imply otherwise.
    assert.equal(paybackYears(5000, 0), null);
    assert.equal(paybackYears(5000, -100), null);
  });
});

// ---------------------------------------------------------------------------

describe('depreciation', () => {
  it('decays exponentially, not linearly', () => {
    const y1 = depreciate({ purchasePrice: 30000, ageYears: 1, positioning: 'mainstream' })!;
    const y2 = depreciate({ purchasePrice: 30000, ageYears: 2, positioning: 'mainstream' })!;
    const y3 = depreciate({ purchasePrice: 30000, ageYears: 3, positioning: 'mainstream' })!;
    const drop1 = 30000 - y1.value;
    const drop2 = y1.value - y2.value;
    const drop3 = y2.value - y3.value;
    assert.ok(drop1 > drop2 && drop2 > drop3, 'each year should lose less than the last');
  });

  it('returns the purchase price at age zero', () => {
    close(depreciate({ purchasePrice: 30000, ageYears: 0 })!.value, 30000, 1e-9);
  });

  it('never reaches zero', () => {
    const old = depreciate({ purchasePrice: 30000, ageYears: 40 })!;
    assert.ok(old.value > 0, 'exponential decay asymptotes; no car is worth exactly nothing');
  });

  it('depreciates a luxury car faster than an economy one', () => {
    const economy = depreciate({ purchasePrice: 30000, ageYears: 5, positioning: 'economy' })!;
    const luxury = depreciate({ purchasePrice: 30000, ageYears: 5, positioning: 'luxury' })!;
    assert.ok(luxury.retained < economy.retained);
  });

  it('applies the electric adjustment on top of the tier rate', () => {
    const petrol = depreciate({ purchasePrice: 40000, ageYears: 4, positioning: 'premium' })!;
    const ev = depreciate({
      purchasePrice: 40000,
      ageYears: 4,
      positioning: 'premium',
      powertrain: 'bev',
    })!;
    assert.ok(ev.value < petrol.value);
    close(ev.effectiveAnnualRate - petrol.effectiveAnnualRate, 0.03, 1e-9);
  });

  it('shows its working', () => {
    const result = depreciate({ purchasePrice: 30000, ageYears: 3, positioning: 'premium' })!;
    assert.ok(result.workings.length >= 2);
    assert.ok(result.workings.some((w) => w.includes('20%')));
  });

  it('rejects nonsense inputs rather than projecting from them', () => {
    assert.equal(depreciate({ purchasePrice: 0, ageYears: 3 }), null);
    assert.equal(depreciate({ purchasePrice: -1000, ageYears: 3 }), null);
    assert.equal(depreciate({ purchasePrice: 30000, ageYears: -1 }), null);
    assert.equal(depreciate({ purchasePrice: 30000, ageYears: 3, conditionFactor: 0 }), null);
  });

  it('honours a rate override', () => {
    const result = depreciate({ purchasePrice: 30000, ageYears: 1, annualRateOverride: 0.5 })!;
    close(result.value, 15000, 1e-9);
  });

  describe('mileageFactor', () => {
    it('is neutral at exactly the expected mileage', () => {
      close(mileageFactor(45000, 3, 15000), 1, 1e-9);
    });

    it('adds value for a low-mileage car', () => {
      assert.ok(mileageFactor(20000, 3, 15000) > 1);
    });

    it('removes value for a high-mileage car', () => {
      assert.ok(mileageFactor(90000, 3, 15000) < 1);
    });

    it('clamps at ±25% — beyond that a car is priced by inspection', () => {
      assert.ok(mileageFactor(1000000, 3, 15000) >= 0.75);
      assert.ok(mileageFactor(0, 20, 15000) <= 1.25);
    });

    it('is neutral at age zero rather than dividing by zero', () => {
      assert.equal(mileageFactor(0, 0, 15000), 1);
    });
  });

  it('produces a monotonically falling curve', () => {
    const curve = depreciationCurve({ purchasePrice: 30000, ageYears: 0 }, 10, 1);
    assert.equal(curve.length, 11);
    for (let i = 1; i < curve.length; i++) {
      assert.ok(curve[i]!.value < curve[i - 1]!.value);
    }
  });

  it('reports how far a real valuation sits from the projection without refitting', () => {
    // Refitting the curve to user anchors would throw away the only real
    // market data the site ever sees.
    const inputs = { purchasePrice: 30000, ageYears: 0, positioning: 'mainstream' };
    const deviations = anchorDeviation([{ ageYears: 3, value: 22000 }], inputs);
    assert.equal(deviations.length, 1);
    assert.ok(deviations[0]!.deltaPercent > 0, 'a car worth more than projected shows positive');
    close(deviations[0]!.actual, 22000, 1e-9);
  });
});

// ---------------------------------------------------------------------------

describe('riskIndex', () => {
  it('bands a fast expensive coupe higher than a slow cheap hatch', () => {
    const supercar = riskIndex({
      powerKw: 450,
      massKg: 1500,
      zeroToHundredSeconds: 3.0,
      positioning: 'ultra-luxury',
      bodyStyles: ['coupe'],
    })!;
    const hatch = riskIndex({
      powerKw: 66,
      massKg: 1100,
      zeroToHundredSeconds: 13.5,
      positioning: 'economy',
      bodyStyles: ['hatchback'],
    })!;
    assert.ok(supercar.band > hatch.band);
    assert.ok(supercar.index > hatch.index);
  });

  it('reweights across available factors instead of scoring a gap as zero risk', () => {
    // Treating missing data as zero would make an under-documented supercar
    // look safe.
    const partial = riskIndex({ powerKw: 450, massKg: 1500 })!;
    assert.ok(partial.missing.length > 0);
    assert.ok(partial.index > 50, 'a 300 kW/t car should still band high on one factor');
  });

  it('returns null when nothing usable was supplied', () => {
    assert.equal(riskIndex({}), null);
  });

  it('explains every factor it used', () => {
    const result = riskIndex({ powerKw: 150, massKg: 1400, positioning: 'premium' })!;
    for (const contribution of result.contributions) {
      assert.ok(contribution.reason.length > 0);
      assert.ok(contribution.score >= 0 && contribution.score <= 1);
    }
  });

  it('never exposes a monetary figure', () => {
    const result = riskIndex({ powerKw: 150, massKg: 1400, positioning: 'premium' })!;
    assert.ok(!('premium' in result) && !('quote' in result) && !('cost' in result));
    assert.match(RISK_DISCLAIMER, /not a quote/i);
  });
});

// ---------------------------------------------------------------------------

describe('markeyScore', () => {
  it('keeps its weights in one place and sums them to 1', () => {
    const total = Object.values(SCORE_WEIGHTS).reduce((a, b) => a + b, 0);
    close(total, 1, 1e-9);
  });

  it('scores an efficient practical car above a thirsty impractical one', () => {
    const sensible = markeyScore({
      consumptionPer100km: 4.5,
      zeroToHundredSeconds: 9.5,
      powerToWeightKwPerTonne: 75,
      bootLitres: 600,
      lengthMm: 4700,
      annualDepreciationRate: 0.15,
    })!;
    const thirsty = markeyScore({
      consumptionPer100km: 16,
      zeroToHundredSeconds: 9.5,
      powerToWeightKwPerTonne: 75,
      bootLitres: 200,
      lengthMm: 4700,
      annualDepreciationRate: 0.3,
    })!;
    assert.ok(sensible.score > thirsty.score);
  });

  it('scores electric consumption on its own scale', () => {
    // 18 kWh/100 km is good; scored against the petrol band it would look awful.
    const ev = markeyScore({ consumptionPer100km: 18, isElectric: true })!;
    const petrolScale = markeyScore({ consumptionPer100km: 18, isElectric: false })!;
    assert.ok(ev.score > petrolScale.score);
  });

  it('renormalises across available sub-factors and reports coverage', () => {
    const partial = markeyScore({ consumptionPer100km: 5 })!;
    close(partial.coverage, 0.25, 1e-9);
    assert.equal(partial.missing.length, 3);
  });

  it('withholds the headline number below half coverage', () => {
    // A blended score resting on one of four factors invites unearned confidence.
    const partial = markeyScore({ consumptionPer100km: 5 });
    assert.equal(isScoreDisplayable(partial), false);

    const enough = markeyScore({
      consumptionPer100km: 5,
      zeroToHundredSeconds: 8,
      bootLitres: 400,
    });
    assert.equal(isScoreDisplayable(enough), true);
  });

  it('returns null when there is nothing to score', () => {
    assert.equal(markeyScore({}), null);
  });

  it('keeps every sub-score in 0–100', () => {
    const extreme = markeyScore({
      consumptionPer100km: 0.1,
      zeroToHundredSeconds: 0.5,
      powerToWeightKwPerTonne: 5000,
      bootLitres: 99999,
      lengthMm: 99999,
      annualDepreciationRate: 0.99,
    })!;
    for (const sub of extreme.subScores) {
      assert.ok(sub.score >= 0 && sub.score <= 100, `${sub.factor} out of range: ${sub.score}`);
    }
  });
});

// ---------------------------------------------------------------------------

describe('matchmaker', () => {
  const cars: Candidate[] = [
    {
      id: 'a',
      label: 'Economy hatch',
      bodyStyles: ['hatchback'],
      powertrains: ['petrol'],
      drivetrains: ['fwd'],
      segment: 'b-segment',
      positioning: 'economy',
      eras: ['2010s'],
      price: 15000,
      seats: 5,
      consumptionPer100km: 5,
      powerToWeightKwPerTonne: 60,
      bootLitres: 300,
      productionStart: 2012,
      productionEnd: 2019,
    },
    {
      id: 'b',
      label: 'Fast saloon',
      bodyStyles: ['saloon'],
      powertrains: ['petrol'],
      drivetrains: ['rwd'],
      segment: 'd-segment',
      positioning: 'premium',
      eras: ['2020s'],
      price: 60000,
      seats: 5,
      consumptionPer100km: 11,
      powerToWeightKwPerTonne: 200,
      bootLitres: 480,
      productionStart: 2020,
      productionEnd: null,
    },
    {
      id: 'c',
      label: 'Undocumented coupe',
      bodyStyles: ['coupe'],
      powertrains: ['petrol'],
      drivetrains: ['rwd'],
      eras: ['1980s'],
      price: null,
      seats: null,
      consumptionPer100km: null,
      powerToWeightKwPerTonne: null,
      bootLitres: null,
      productionStart: 1982,
      productionEnd: 1989,
    },
  ];

  it('filters on a body style', () => {
    const result = filterCandidates(cars, { bodyStyles: ['hatchback'] });
    assert.deepEqual(result.map((c) => c.id), ['a']);
  });

  it('treats an empty constraint as no constraint', () => {
    assert.equal(filterCandidates(cars, { bodyStyles: [] }).length, 3);
    assert.equal(filterCandidates(cars, {}).length, 3);
  });

  it('fails a candidate whose data is missing for a constraint it must satisfy', () => {
    // The conservative direction: an unknown consumption must not be presented
    // as satisfying "under 6 L/100 km".
    const outcomes = applyDealbreakers(cars, { maxConsumption: 6 });
    const undocumented = outcomes.find((o) => o.candidate.id === 'c')!;
    assert.equal(undocumented.passed, false);
    assert.ok(undocumented.failedOn.some((f) => f.includes('unknown')));
  });

  it('reports why each candidate failed', () => {
    const outcomes = applyDealbreakers(cars, { maxPrice: 20000, bodyStyles: ['saloon'] });
    const fast = outcomes.find((o) => o.candidate.id === 'b')!;
    assert.deepEqual(fast.failedOn, ['price']);
  });

  it('identifies the single constraint blocking the most cars', () => {
    // "0 results" is a dead end; "relax your budget and 2 more appear" is a
    // next step.
    const outcomes = applyDealbreakers(cars, { maxPrice: 10000 });
    const blocking = blockingConstraints(outcomes);
    assert.equal(blocking[0]!.constraint, 'price');
    assert.ok(blocking[0]!.blocks >= 1);
  });

  it('filters on a production era in both directions', () => {
    assert.deepEqual(
      filterCandidates(cars, { producedAfter: 2015 }).map((c) => c.id),
      ['a', 'b'],
    );
    assert.deepEqual(
      filterCandidates(cars, { producedBefore: 1990 }).map((c) => c.id),
      ['c'],
    );
  });

  it('ranks by preference relative to the supplied set', () => {
    const ranked = rankByPreference([cars[0]!, cars[1]!], { economy: 1 });
    assert.equal(ranked[0]!.candidate.id, 'a');
    assert.equal(ranked[0]!.matchPercent, 100);
  });

  it('flips the ranking when the preference flips', () => {
    const ranked = rankByPreference([cars[0]!, cars[1]!], { performance: 1 });
    assert.equal(ranked[0]!.candidate.id, 'b');
  });

  it('blends weighted preferences', () => {
    const ranked = rankByPreference([cars[0]!, cars[1]!], { economy: 1, performance: 1 });
    for (const match of ranked) {
      assert.ok(match.matchPercent >= 0 && match.matchPercent <= 100);
      assert.equal(match.breakdown.length, 2);
    }
  });

  it('ignores preferences with zero weight', () => {
    const ranked = rankByPreference([cars[0]!, cars[1]!], { economy: 1, performance: 0 });
    assert.equal(ranked[0]!.breakdown.length, 1);
  });

  it('reports preferences it could not score', () => {
    const ranked = rankByPreference([cars[2]!], { economy: 1 });
    assert.deepEqual(ranked[0]!.unscored, ['economy']);
  });

  it('handles an empty candidate list', () => {
    assert.deepEqual(rankByPreference([], { economy: 1 }), []);
  });

  it('composes filtering and ranking without disagreeing about what passes', () => {
    const result = matchmake(cars, { maxPrice: 70000 }, { economy: 1 });
    const filtered = filterCandidates(cars, { maxPrice: 70000 });
    assert.equal(result.ranked.length, filtered.length);
    assert.deepEqual(
      result.ranked.map((r) => r.candidate.id).sort(),
      filtered.map((c) => c.id).sort(),
    );
  });
});
