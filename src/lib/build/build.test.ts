import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  DEFAULT_PRESET_ID,
  SEGMENT_PRESETS,
  defaultSpec,
  missingInputs,
  presetById,
  resolveBuildArea,
  resolveGearing,
  specFromPreset,
  toVehicleInputs,
  type BuildSpec,
} from './spec.ts';
import { decodeBuild, encodeBuild, hasBuildParams, readBuildParams } from './url.ts';
import { BUILD_ID, buildColumn } from './compare.ts';
import { gearedTopSpeed, rpmAtSpeed } from '../math/dynamics/gearing.ts';
import {
  topSpeedDetailed,
  zeroToHundred,
  type VehicleInputs,
} from '../math/dynamics/performance.ts';

const close = (actual: number, expected: number, tolerance: number, message?: string) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    message ?? `expected ${actual} to be within ${tolerance} of ${expected}`,
  );

// ---------------------------------------------------------------------------

describe('gearing', () => {
  it('multiplies road speed per 1000 rpm by the redline', () => {
    close(gearedTopSpeed({ kmhPer1000rpm: 36, redlineRpm: 7200 })!, 259.2, 1e-9);
  });

  it('reports nothing rather than zero when no gearing was supplied', () => {
    assert.equal(gearedTopSpeed(undefined), null);
    assert.equal(gearedTopSpeed({ kmhPer1000rpm: 0, redlineRpm: 7000 }), null);
    assert.equal(gearedTopSpeed({ kmhPer1000rpm: 40, redlineRpm: 0 }), null);
  });

  it('inverts to engine speed at a road speed', () => {
    close(rpmAtSpeed({ kmhPer1000rpm: 40, redlineRpm: 6000 }, 120)!, 3000, 1e-9);
    assert.equal(rpmAtSpeed(undefined, 120), null);
  });
});

describe('gearing in the shared physics path', () => {
  const base: VehicleInputs = {
    massKg: 1250,
    powerKw: 165,
    dragCoefficient: 0.3,
    frontalAreaM2: 1.99,
    drivetrain: 'rwd',
    tyreGrip: 1.0,
    powertrain: 'petrol',
  };

  it('leaves a car with no gearing exactly as it was', () => {
    const result = topSpeedDetailed(base)!;
    assert.equal(result.gearedKmh, null);
    assert.equal(result.gearLimited, false);
    assert.equal(result.kmh, result.unrestrictedKmh);
  });

  it('caps top speed at the geared ceiling and says so', () => {
    const geared = topSpeedDetailed({
      ...base,
      gearing: { kmhPer1000rpm: 30, redlineRpm: 7000 },
    })!;
    assert.ok(geared.unrestrictedKmh > 210, 'this car should out-power its gearing');
    close(geared.gearedKmh!, 210, 1e-9);
    assert.equal(geared.kmh, 210);
    assert.equal(geared.gearLimited, true);
    assert.equal(geared.limited, false);
  });

  it('does not raise a top speed the car cannot otherwise reach', () => {
    const tall = topSpeedDetailed({
      ...base,
      gearing: { kmhPer1000rpm: 80, redlineRpm: 7000 },
    })!;
    // Geared for 560 km/h, which changes nothing: power still runs out first.
    assert.equal(tall.kmh, tall.unrestrictedKmh);
    assert.equal(tall.gearLimited, false);
  });

  it('reports the limiter, not the gearing, when the limiter binds first', () => {
    const both = topSpeedDetailed({
      ...base,
      gearing: { kmhPer1000rpm: 30, redlineRpm: 7000 },
      speedLimiterKmh: 180,
    })!;
    assert.equal(both.kmh, 180);
    assert.equal(both.limited, true);
    assert.equal(both.gearLimited, false);
  });

  it('refuses an acceleration target above the geared ceiling', () => {
    const gearedOut = { ...base, gearing: { kmhPer1000rpm: 12, redlineRpm: 7000 } };
    // Geared for 84 km/h: 0–100 is not a figure this car has.
    assert.equal(zeroToHundred(gearedOut), null);
    assert.equal(zeroToHundred(base) === null, false);
  });
});

// ---------------------------------------------------------------------------

describe('build presets', () => {
  it('has a default that exists', () => {
    assert.ok(presetById(DEFAULT_PRESET_ID), `${DEFAULT_PRESET_ID} is not a preset`);
  });

  it('gives every preset a basis, as the constants do', () => {
    for (const preset of SEGMENT_PRESETS) {
      assert.ok(preset.basis.length > 40, `${preset.id} has no real basis`);
      assert.ok(preset.label.length > 0);
    }
  });

  it('produces a modellable car from every preset', () => {
    for (const preset of SEGMENT_PRESETS) {
      const spec = specFromPreset(preset);
      assert.deepEqual(missingInputs(spec), [], `${preset.id} cannot be modelled`);
      const inputs = toVehicleInputs(spec)!;
      const accel = zeroToHundred(inputs);
      const top = topSpeedDetailed(inputs);
      assert.ok(accel, `${preset.id} has no 0-100`);
      assert.ok(top, `${preset.id} has no top speed`);
      // Sanity, not calibration: a preset that models a road car at 2 s or
      // 500 km/h is a typo, and this is the cheapest place to catch it.
      assert.ok(accel.seconds > 2 && accel.seconds < 30, `${preset.id}: ${accel.seconds} s`);
      assert.ok(top.kmh > 100 && top.kmh < 400, `${preset.id}: ${top.kmh} km/h`);
    }
  });

  it('leaves frontal area to be estimated from the body, and flags it', () => {
    const spec = defaultSpec();
    assert.equal(spec.frontalAreaM2, 0, 'presets should not assert a frontal area');
    const area = resolveBuildArea(spec)!;
    assert.equal(area.estimated, true);
    close(area.value, 0.85 * 1.8 * 1.46, 1e-9);
  });

  it('takes a stated frontal area in preference to the estimate', () => {
    const spec = { ...defaultSpec(), frontalAreaM2: 2.5 };
    const area = resolveBuildArea(spec)!;
    assert.equal(area.estimated, false);
    assert.equal(area.value, 2.5);
  });

  it('treats an electric preset as having no gearing rather than fake gearing', () => {
    const bev = SEGMENT_PRESETS.find((p) => p.spec.powertrain === 'bev')!;
    assert.equal(resolveGearing(specFromPreset(bev)), undefined);
  });
});

describe('missing inputs', () => {
  it('names what the physics still needs', () => {
    const spec: BuildSpec = { ...defaultSpec(), powerKw: 0, dragCoefficient: 0 };
    assert.deepEqual(missingInputs(spec), ['power', 'drag coefficient']);
    assert.equal(toVehicleInputs(spec), null);
  });

  it('needs either a frontal area or a body to estimate one from', () => {
    const spec: BuildSpec = { ...defaultSpec(), frontalAreaM2: 0, widthMm: 0, heightMm: 0 };
    assert.deepEqual(missingInputs(spec), [
      'frontal area (and no width and height to estimate it from)',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('one physics path (SPEC.md §9.6)', () => {
  /**
   * The definition of done for Phase 7: a built car and a real car with
   * identical inputs produce identical outputs.
   *
   * The numbers are the Toyota 86 (ZN6) as the content collection holds it —
   * the one fully-sourced car, and the one the Test Drive page models. If Build
   * Car ever grew a physics path of its own, this test is where it would fail.
   */
  const REAL_CAR: VehicleInputs = {
    massKg: 1190,
    powerKw: 147,
    dragCoefficient: 0.27,
    frontalAreaM2: 0.85 * 1.775 * 1.285,
    drivetrain: 'rwd',
    tyreGrip: 1.0,
    powertrain: 'petrol',
  };

  const AS_A_BUILD: BuildSpec = {
    name: 'Same numbers',
    segment: '',
    massKg: 1190,
    powerKw: 147,
    torqueNm: 205,
    drivetrain: 'rwd',
    powertrain: 'petrol',
    dragCoefficient: 0.27,
    frontalAreaM2: 0,
    tyreGrip: 1.0,
    kmhPer1000rpm: 0,
    redlineRpm: 0,
    speedLimiterKmh: 0,
    lengthMm: 4240,
    widthMm: 1775,
    heightMm: 1285,
    bodyStyle: 'coupe',
  };

  it('derives the same inputs the content pipeline derives', () => {
    assert.deepEqual(toVehicleInputs(AS_A_BUILD), {
      ...REAL_CAR,
      gearing: undefined,
      speedLimiterKmh: undefined,
    });
  });

  it('produces identical figures', () => {
    const built = toVehicleInputs(AS_A_BUILD)!;
    assert.deepEqual(zeroToHundred(built), zeroToHundred(REAL_CAR));
    assert.deepEqual(topSpeedDetailed(built), topSpeedDetailed(REAL_CAR));
  });
});

// ---------------------------------------------------------------------------

describe('a build in a URL', () => {
  it('round-trips through its encoding', () => {
    const spec = defaultSpec();
    assert.deepEqual(decodeBuild(encodeBuild(spec)), spec);
  });

  it('round-trips every preset', () => {
    for (const preset of SEGMENT_PRESETS) {
      const spec = specFromPreset(preset);
      assert.deepEqual(decodeBuild(encodeBuild(spec)), spec, `${preset.id} did not round-trip`);
    }
  });

  it('round-trips a name with spaces and punctuation', () => {
    const spec = { ...defaultSpec(), name: "Kiarash's 2 + 2, mk II" };
    assert.equal(decodeBuild(encodeBuild(spec))!.name, "Kiarash's 2 + 2, mk II");
  });

  it('omits fields that were left unsupplied rather than writing zeroes', () => {
    const query = encodeBuild(defaultSpec());
    assert.equal(query.includes('bx='), false, 'wrote a limiter that does not exist');
    assert.equal(query.includes('ba='), false, 'wrote a frontal area that was never given');
  });

  it('tells an empty URL apart from an empty build', () => {
    assert.equal(decodeBuild(''), null);
    assert.equal(hasBuildParams(new URLSearchParams('cars=a,b')), false);
    assert.ok(decodeBuild('bm=1350'));
  });

  it('keeps a partial link partial instead of filling it from a preset', () => {
    const partial = decodeBuild('bm=1350&bp=110')!;
    assert.equal(partial.massKg, 1350);
    assert.equal(partial.dragCoefficient, 0);
    assert.ok(missingInputs(partial).includes('drag coefficient'));
  });

  it('rejects a negative or unparseable figure rather than modelling it', () => {
    const hostile = decodeBuild('bm=-1200&bc=abc&bp=110')!;
    assert.equal(hostile.massKg, 0);
    assert.equal(hostile.dragCoefficient, 0);
    assert.equal(hostile.powerKw, 110);
  });

  it('truncates an over-long name', () => {
    const long = decodeBuild(`bn=${'x'.repeat(500)}`)!;
    assert.ok(long.name.length <= 60);
  });

  it('shares a URL with the comparison tool without disturbing it', () => {
    const params = new URLSearchParams('cars=toyota-86-zn6,bmw-6-series-e24');
    for (const [key, value] of new URLSearchParams(encodeBuild(defaultSpec()))) {
      params.set(key, value);
    }
    assert.equal(params.get('cars'), 'toyota-86-zn6,bmw-6-series-e24');
    assert.deepEqual(readBuildParams(params), defaultSpec());
  });
});

// ---------------------------------------------------------------------------

describe('a build as a comparison column', () => {
  it('carries its typed inputs and its modelled figures', () => {
    const spec = defaultSpec();
    const { car, unmodelled } = buildColumn(spec, '/Markey/build/?bm=1350');
    assert.equal(unmodelled, false);
    assert.equal(car.id, BUILD_ID);
    assert.equal(car.massMinKg, spec.massKg);
    assert.equal(car.powerKwMax, spec.powerKw);
    assert.equal(car.torqueNmMax, spec.torqueNm);
    assert.equal(car.dragCoefficientMin, spec.dragCoefficient);
    assert.ok(car.zeroToHundredMinS! > 0);
    assert.ok(car.topSpeedMaxKmh! > 0);
    assert.equal(car.url, '/Markey/build/?bm=1350');
  });

  it('never offers a consumption figure, because it would not be comparable', () => {
    assert.equal(buildColumn(defaultSpec(), '/x').car.consumptionMinL100km, null);
  });

  it('leaves the performance rows empty when the build cannot be modelled', () => {
    const { car, unmodelled } = buildColumn({ ...defaultSpec(), powerKw: 0 }, '/x');
    assert.equal(unmodelled, true);
    assert.equal(car.zeroToHundredMinS, null);
    assert.equal(car.topSpeedMaxKmh, null);
    assert.equal(car.powerKwMax, null);
  });

  it('falls back to a name rather than an empty column header', () => {
    assert.equal(buildColumn({ ...defaultSpec(), name: '  ' }, '/x').car.name, 'Your build');
  });
});
