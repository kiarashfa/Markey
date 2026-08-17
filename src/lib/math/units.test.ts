import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  convertForDisplay,
  kgToPounds,
  kmhToMph,
  kwToBhp,
  kwToPs,
  kwh100kmToMpge,
  l100kmToMpgImp,
  l100kmToMpgUs,
  mmToFeetInches,
  mmToInches,
  mpgUsToL100km,
  nmToLbFt,
  powerToWeight,
} from './units.ts';

const close = (actual: number, expected: number, tolerance: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

describe('length', () => {
  it('converts mm to inches exactly', () => {
    assert.equal(mmToInches(25.4), 1);
    assert.equal(mmToInches(2540), 100);
  });

  it('rolls 12 inches up to the next foot', () => {
    // 1828.7 mm is 5 ft 11.99 in — naive rounding gives 5 ft 12 in.
    const result = mmToFeetInches(1828.7);
    assert.deepEqual(result, { feet: 6, inches: 0 });
  });

  it('handles an exact foot boundary', () => {
    assert.deepEqual(mmToFeetInches(304.8), { feet: 1, inches: 0 });
  });
});

describe('power', () => {
  it('distinguishes metric PS from mechanical bhp', () => {
    // The two differ by ~1.4%, and conflating them is the single most common
    // error in published car specs.
    const ps = kwToPs(100);
    const bhp = kwToBhp(100);
    close(ps, 135.96, 0.01);
    close(bhp, 134.1, 0.01);
    assert.ok(ps > bhp, 'PS is always the larger number for the same kW');
  });

  it('round-trips', () => {
    close(kwToPs(147.1), 200, 0.05);
  });
});

describe('torque and mass', () => {
  it('converts N·m to lb·ft', () => close(nmToLbFt(100), 73.756, 0.001));
  it('converts kg to pounds', () => close(kgToPounds(1000), 2204.62, 0.01));
});

describe('speed', () => {
  it('converts km/h to mph', () => close(kmhToMph(100), 62.137, 0.001));
  it('handles the German limiter exactly', () => close(kmhToMph(250), 155.34, 0.01));
});

describe('fuel economy — reciprocal scales', () => {
  it('converts L/100 km to US mpg', () => {
    close(l100kmToMpgUs(10)!, 23.52, 0.01);
    close(l100kmToMpgUs(5)!, 47.04, 0.01);
  });

  it('converts L/100 km to imperial mpg', () => {
    close(l100kmToMpgImp(10)!, 28.25, 0.01);
  });

  it('is reciprocal, not linear — halving consumption doubles mpg', () => {
    const a = l100kmToMpgUs(10)!;
    const b = l100kmToMpgUs(5)!;
    close(b / a, 2, 0.0001);
  });

  it('round-trips through the inverse', () => {
    close(mpgUsToL100km(l100kmToMpgUs(7.5)!)!, 7.5, 0.0001);
  });

  it('returns null rather than Infinity at zero consumption', () => {
    // A page rendering "∞ mpg" is a bug; null routes to the empty state.
    assert.equal(l100kmToMpgUs(0), null);
    assert.equal(l100kmToMpgImp(0), null);
    assert.equal(mpgUsToL100km(0), null);
  });

  it('returns null for negative consumption', () => {
    assert.equal(l100kmToMpgUs(-5), null);
  });

  it('converts kWh/100 km to MPGe on the EPA convention', () => {
    // 15 kWh/100 km ≈ 24.14 kWh/100 miles; at the EPA's 33.7 kWh per gallon
    // equivalent that is 139.6 MPGe. Cross-checks against the EPA's own
    // published pairings — 25 kWh/100 mi rates as ~135 MPGe.
    close(kwh100kmToMpge(15)!, 139.6, 0.1);
    close(kwh100kmToMpge(25 / 1.609344)!, 134.8, 0.1);
  });
});

describe('powerToWeight', () => {
  it('returns kW per tonne', () => {
    assert.equal(powerToWeight(200, 1000), 200);
    assert.equal(powerToWeight(150, 1500), 100);
  });

  it('returns null for zero mass rather than Infinity', () => {
    assert.equal(powerToWeight(200, 0), null);
    assert.equal(powerToWeight(200, -100), null);
  });
});

describe('convertForDisplay', () => {
  it('leaves metric values in SI', () => {
    assert.deepEqual(convertForDisplay(210, 'kW', 'metric'), {
      value: 210,
      unit: 'kW',
      formatted: '210 kW',
    });
  });

  it('converts power to PS for imperial display', () => {
    const result = convertForDisplay(210, 'kW', 'imperial')!;
    assert.equal(result.unit, 'PS');
    close(result.value, 285.5, 0.1);
  });

  it('returns null where the imperial equivalent is undefined', () => {
    assert.equal(convertForDisplay(0, 'L/100km', 'imperial'), null);
  });

  it('leaves dimensionless and time values alone in both systems', () => {
    assert.equal(convertForDisplay(0.31, '', 'imperial')!.value, 0.31);
    assert.equal(convertForDisplay(7.4, 's', 'imperial')!.value, 7.4);
  });

  it('shows a drag coefficient to two decimals, not rounded to zero', () => {
    assert.equal(convertForDisplay(0.3, '', 'metric')!.formatted, '0.30 ');
  });
});
