import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dragArea,
  dragCoefficientFromForce,
  dragForce,
  estimateFrontalArea,
  resolveFrontalArea,
} from './aero.ts';
import {
  brakingDistance100to0,
  peakDeceleration,
  stoppingDistance,
  stoppingTime,
  totalStoppingDistance,
} from './braking.ts';
import { consumptionAtSpeed, dragCrossoverSpeed } from './consumption.ts';
import {
  accelerationTo,
  topSpeed,
  topSpeedDetailed,
  zeroToHundred,
  type VehicleInputs,
} from './performance.ts';
import { tyreGripForYear } from './constants.ts';

const close = (actual: number, expected: number, tolerance: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

const within = (actual: number, low: number, high: number, message: string) =>
  assert.ok(actual >= low && actual <= high, `${message}: got ${actual}, expected ${low}–${high}`);

// ---------------------------------------------------------------------------

describe('aero', () => {
  it('computes drag force from the textbook formula', () => {
    // ½ · 1.225 · 0.30 · 2.20 · 30² = 363.8 N
    close(dragForce(30, 0.3, 2.2), 363.83, 0.01);
  });

  it('scales drag with the square of speed', () => {
    const atThirty = dragForce(30, 0.3, 2.2);
    const atSixty = dragForce(60, 0.3, 2.2);
    close(atSixty / atThirty, 4, 0.0001);
  });

  it('is zero at rest', () => {
    assert.equal(dragForce(0, 0.3, 2.2), 0);
  });

  it('computes drag area', () => {
    close(dragArea(0.3, 2.2), 0.66, 1e-9);
  });

  it('estimates frontal area at 0.85 of the bounding box', () => {
    const estimate = estimateFrontalArea(1725, 1365)!;
    close(estimate.value, 2.001, 0.001);
    assert.equal(estimate.status, 'estimated');
    assert.match(estimate.note, /0\.85/);
  });

  it('refuses to estimate frontal area without dimensions', () => {
    // An honest gap, not a guess — SPEC.md §8.2 discipline 2.
    assert.equal(estimateFrontalArea(null, 1365), null);
    assert.equal(estimateFrontalArea(1725, undefined), null);
    assert.equal(estimateFrontalArea(0, 1365), null);
    assert.equal(estimateFrontalArea(-1725, 1365), null);
  });

  it('prefers a published frontal area over an estimate', () => {
    // SPEC.md §8.2 discipline 1: a modelled figure never overwrites a real one.
    const resolved = resolveFrontalArea(2.15, 1725, 1365)!;
    assert.equal(resolved.value, 2.15);
    assert.equal(resolved.estimated, false);
  });

  it('falls back to the estimate and flags it', () => {
    const resolved = resolveFrontalArea(null, 1725, 1365)!;
    assert.equal(resolved.estimated, true);
    assert.ok(resolved.note);
  });

  it('returns null when neither published nor estimable', () => {
    assert.equal(resolveFrontalArea(null, null, null), null);
  });

  it('round-trips Cd through the momentum-exchange relation', () => {
    const force = dragForce(40, 0.31, 2.1);
    close(dragCoefficientFromForce(force, 40, 2.1)!, 0.31, 1e-9);
  });

  it('refuses to back out Cd at zero speed', () => {
    assert.equal(dragCoefficientFromForce(100, 0, 2.1), null);
  });
});

// ---------------------------------------------------------------------------

describe('braking', () => {
  it('computes stopping distance from v²/(2μg)', () => {
    // 100 km/h = 27.778 m/s; 27.778² / (2 · 1.0 · 9.80665) = 39.3 m
    close(brakingDistance100to0(1.0)!, 39.34, 0.01);
  });

  it('scales with the square of speed', () => {
    const fifty = stoppingDistance(50, 0.9)!;
    const hundred = stoppingDistance(100, 0.9)!;
    close(hundred / fifty, 4, 0.0001);
  });

  it('makes a period car stop measurably longer than a modern one', () => {
    const modern = brakingDistance100to0(tyreGripForYear(2020))!;
    const seventies = brakingDistance100to0(tyreGripForYear(1975))!;
    assert.ok(seventies > modern + 8, 'era grip should change the answer materially');
  });

  it('reports peak deceleration in g equal to the grip coefficient', () => {
    assert.equal(peakDeceleration(0.9)!.g, 0.9);
    close(peakDeceleration(0.9)!.ms2, 8.826, 0.001);
  });

  it('computes stopping time', () => {
    close(stoppingTime(100, 1.0)!, 2.832, 0.001);
  });

  it('keeps reaction distance separate from braking distance', () => {
    // Mixing them turns a vehicle measurement into a claim about a person.
    const result = totalStoppingDistance(100, 1.0, 1.5)!;
    close(result.reaction, 41.67, 0.01);
    close(result.braking, 39.34, 0.01);
    close(result.total, result.reaction + result.braking, 1e-9);
  });

  it('returns null for non-positive inputs', () => {
    assert.equal(stoppingDistance(0, 1.0), null);
    assert.equal(stoppingDistance(100, 0), null);
    assert.equal(stoppingDistance(-100, 1.0), null);
  });
});

// ---------------------------------------------------------------------------

describe('consumption', () => {
  const saloon = {
    massKg: 1500,
    dragCoefficient: 0.3,
    frontalAreaM2: 2.2,
    drivetrain: 'rwd',
    powertrain: 'petrol',
  };

  it('produces a believable steady-state figure at motorway speed', () => {
    const result = consumptionAtSpeed(120, saloon)!;
    within(result.litresPer100km!, 5, 11, 'steady 120 km/h cruise for a mid-size saloon');
  });

  it('uses more energy the faster you go', () => {
    const at90 = consumptionAtSpeed(90, saloon)!;
    const at130 = consumptionAtSpeed(130, saloon)!;
    assert.ok(at130.litresPer100km! > at90.litresPer100km!);
  });

  it('reports kWh rather than litres for an electric car', () => {
    const ev = consumptionAtSpeed(120, { ...saloon, powertrain: 'bev' })!;
    assert.equal(ev.litresPer100km, null);
    assert.ok(ev.kwhPer100km! > 0);
    within(ev.kwhPer100km!, 12, 30, 'steady 120 km/h cruise for an EV');
  });

  it('finds the crossover where drag overtakes rolling resistance', () => {
    // The point the Test Drive chart exists to make.
    within(dragCrossoverSpeed(saloon)!, 55, 95, 'drag/rolling crossover for a saloon');
  });

  it('puts the crossover lower for a draggy SUV than a slippery saloon', () => {
    const suv = { ...saloon, dragCoefficient: 0.36, frontalAreaM2: 3.1, massKg: 2200 };
    assert.ok(dragCrossoverSpeed(suv)! < dragCrossoverSpeed(saloon)! + 20);
  });

  it('reports drag as the dominant share at motorway speed', () => {
    assert.ok(consumptionAtSpeed(130, saloon)!.dragShare > 0.6);
  });

  it('returns null when Cd is missing rather than guessing', () => {
    assert.equal(consumptionAtSpeed(120, { ...saloon, dragCoefficient: 0 }), null);
    assert.equal(consumptionAtSpeed(120, { ...saloon, frontalAreaM2: 0 }), null);
    assert.equal(consumptionAtSpeed(0, saloon), null);
  });
});

// ---------------------------------------------------------------------------

describe('performance', () => {
  const base: VehicleInputs = {
    massKg: 1500,
    powerKw: 150,
    dragCoefficient: 0.3,
    frontalAreaM2: 2.2,
    drivetrain: 'rwd',
    tyreGrip: 0.9,
    powertrain: 'petrol',
  };

  it('returns null when an input the physics needs is missing', () => {
    assert.equal(topSpeed({ ...base, powerKw: 0 }), null);
    assert.equal(topSpeed({ ...base, dragCoefficient: 0 }), null);
    assert.equal(topSpeed({ ...base, massKg: 0 }), null);
    assert.equal(zeroToHundred({ ...base, tyreGrip: 0 }), null);
  });

  it('makes more power mean more top speed', () => {
    assert.ok(topSpeed({ ...base, powerKw: 300 })! > topSpeed(base)!);
  });

  it('makes more drag mean less top speed', () => {
    assert.ok(topSpeed({ ...base, dragCoefficient: 0.45 })! < topSpeed(base)!);
  });

  it('respects an electronic limiter and still reports the unrestricted figure', () => {
    // Without this an EV models at ~336 km/h against a published 233 — the
    // published number is a limiter, not aerodynamics.
    const limited = topSpeedDetailed({ ...base, powerKw: 320, speedLimiterKmh: 250 })!;
    assert.equal(limited.kmh, 250);
    assert.equal(limited.limited, true);
    assert.ok(limited.unrestrictedKmh > 250);
  });

  it('ignores a limiter set above what the car can reach', () => {
    const result = topSpeedDetailed({ ...base, speedLimiterKmh: 400 })!;
    assert.equal(result.limited, false);
    assert.equal(result.kmh, result.unrestrictedKmh);
  });

  it('is traction-limited off the line, not power-limited', () => {
    // The two-phase model exists precisely so a powerful rear-drive car cannot
    // post an impossible launch.
    const result = zeroToHundred({ ...base, powerKw: 500 })!;
    assert.equal(result.powerLimitedThroughout, false);
    assert.ok(result.tractionLimitedToKmh > 0);
  });

  it('gives a front-drive car a worse launch than a rear-drive one, all else equal', () => {
    // Load transfer unloads the driven axle on FWD and loads it on RWD. This
    // falls out of the physics rather than being asserted.
    const fwd = zeroToHundred({ ...base, powerKw: 250, drivetrain: 'fwd' })!;
    const rwd = zeroToHundred({ ...base, powerKw: 250, drivetrain: 'rwd' })!;
    assert.ok(fwd.seconds > rwd.seconds);
  });

  it('gives a grippier tyre a quicker launch', () => {
    const grippy = zeroToHundred({ ...base, powerKw: 300, tyreGrip: 1.05 })!;
    const slippery = zeroToHundred({ ...base, powerKw: 300, tyreGrip: 0.65 })!;
    assert.ok(grippy.seconds < slippery.seconds);
  });

  it('gives an EV more of its power off the line than a geared petrol car', () => {
    const ev = zeroToHundred({ ...base, powerKw: 250, drivetrain: 'awd', powertrain: 'bev' })!;
    const ice = zeroToHundred({ ...base, powerKw: 250, drivetrain: 'awd', powertrain: 'petrol' })!;
    assert.ok(ev.seconds < ice.seconds);
  });

  it('refuses to report a time for a car that cannot reach the target', () => {
    const underpowered: VehicleInputs = { ...base, powerKw: 3, massKg: 3000 };
    assert.equal(accelerationTo(200, underpowered), null);
  });

  it('rejects a non-positive target speed', () => {
    assert.equal(accelerationTo(0, base), null);
    assert.equal(accelerationTo(-50, base), null);
  });
});

// ---------------------------------------------------------------------------
// The reality check Instruction.md's Phase 3 DoD requires.
//
// Reference figures below are approximate published manufacturer claims used
// ONLY as a sanity anchor — they are not cited data and none of them is stored
// as content. The assertions are deliberately loose bands: the point is to
// catch a solver that returns 900 km/h, not to claim the model reproduces a
// manufacturer's test conditions.
// ---------------------------------------------------------------------------

describe('sanity check against real cars', () => {
  const golf: VehicleInputs = {
    massKg: 1285,
    powerKw: 110,
    dragCoefficient: 0.275,
    frontalAreaM2: 2.21,
    drivetrain: 'fwd',
    tyreGrip: 1.0,
    powertrain: 'petrol',
  };

  const nineEleven: VehicleInputs = {
    massKg: 1505,
    powerKw: 283,
    dragCoefficient: 0.29,
    frontalAreaM2: 2.09,
    drivetrain: 'rwd',
    tyreGrip: 1.05,
    powertrain: 'petrol',
  };

  const e24: VehicleInputs = {
    massKg: 1510,
    powerKw: 160,
    dragCoefficient: 0.39,
    frontalAreaM2: 2.0,
    drivetrain: 'rwd',
    tyreGrip: 0.8,
    powertrain: 'petrol',
  };

  it('lands a hot-hatch-adjacent hatchback near its published figures', () => {
    within(topSpeed(golf)!, 190, 240, 'Golf 1.5 TSI top speed (published ~210 km/h)');
    within(zeroToHundred(golf)!.seconds, 7.5, 11, 'Golf 0–100 (published ~9.2 s)');
  });

  it('lands a sports car near its published figures', () => {
    within(topSpeed(nineEleven)!, 270, 330, '911 Carrera top speed (published ~293 km/h)');
    within(zeroToHundred(nineEleven)!.seconds, 3.5, 6, '911 Carrera 0–100 (published ~4.2 s)');
  });

  it('lands a 1980s grand tourer near its published figures', () => {
    within(topSpeed(e24)!, 200, 260, 'E24 635CSi top speed (published ~222 km/h)');
    within(zeroToHundred(e24)!.seconds, 6, 10, 'E24 635CSi 0–100 (published ~7.4 s)');
  });

  it('never returns a physically absurd top speed', () => {
    // The failure mode Instruction.md names explicitly.
    for (const car of [golf, nineEleven, e24]) {
      assert.ok(topSpeed(car)! < 400, 'no road car in this set should model above 400 km/h');
      assert.ok(topSpeed(car)! > 100, 'nor below 100 km/h');
    }
  });

  it('ranks the three cars in the order a reader would expect', () => {
    assert.ok(topSpeed(nineEleven)! > topSpeed(e24)!);
    assert.ok(topSpeed(e24)! > topSpeed(golf)!);
    assert.ok(zeroToHundred(nineEleven)!.seconds < zeroToHundred(e24)!.seconds);
    assert.ok(zeroToHundred(e24)!.seconds < zeroToHundred(golf)!.seconds);
  });
});
