import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { solve, voxelise } from './lbmCpu.ts';
import { CALIBRATION_SHAPES, proxyBody, sdSphere, segmentForBodyStyles } from './sdf.ts';
import {
  CI_GRID,
  SPHERE_BIAS_BAND,
  cliftGauvinSphereCd,
  effectiveDiameter,
  measureShape,
} from './validation.ts';

/**
 * The validation gate (SPEC.md §9.5.1), as far as a CI-affordable grid can
 * take it. See `validation.ts` for why the four published high-Re figures are
 * NOT what the CPU reference is measured against.
 */
describe('Clift–Gauvin correlation', () => {
  it('reproduces Stokes drag in the creeping limit', () => {
    // Cd -> 24/Re as Re -> 0.
    const re = 0.05;
    const ratio = cliftGauvinSphereCd(re) / (24 / re);
    assert.ok(Math.abs(ratio - 1) < 0.05, `expected ~24/Re, got ratio ${ratio}`);
  });

  it('falls steeply through the viscous range, then flattens', () => {
    // Not monotonic all the way: the correlation has a shallow minimum near
    // Re ≈ 5×10³ and rises slightly onto the ~0.47 plateau. Asserting a
    // monotonic fall to 10⁵ fails against a *correct* correlation.
    let previous = Infinity;
    for (const re of [1, 10, 100, 1000]) {
      const cd = cliftGauvinSphereCd(re);
      assert.ok(cd < previous, `Cd should fall with Re through the viscous range: ${cd} at Re ${re}`);
      previous = cd;
    }
    // Past the minimum it is essentially flat — within the plateau band.
    for (const re of [1e4, 1e5]) {
      const cd = cliftGauvinSphereCd(re);
      assert.ok(cd > 0.35 && cd < 0.6, `expected the plateau, got ${cd} at Re ${re}`);
    }
  });

  it('approaches the textbook 0.47 plateau at high Re', () => {
    // This is where SPEC.md's 0.47 actually lives — and it is three orders of
    // magnitude above where the CPU reference can run.
    const cd = cliftGauvinSphereCd(1e5);
    assert.ok(cd > 0.4 && cd < 0.6, `expected ≈0.47 at Re 1e5, got ${cd}`);
  });

  it('says a sphere at the Reynolds number we can afford is NOT 0.47', () => {
    // The category error this module exists to prevent.
    const cd = cliftGauvinSphereCd(64);
    assert.ok(cd > 1.0, `at Re 64 a sphere's Cd is ~1.4, not 0.47 — got ${cd}`);
  });
});

describe('voxelisation', () => {
  it('projects a frontal area close to the analytic circle', () => {
    const { frontalAreaCells } = voxelise(sdSphere(0.5), 40, 40, 40, 0.5);
    const radiusCells = 0.5 * 40 * 0.5;
    const analytic = Math.PI * radiusCells * radiusCells;
    const error = Math.abs(frontalAreaCells - analytic) / analytic;
    assert.ok(error < 0.15, `projected ${frontalAreaCells} vs analytic ${analytic.toFixed(0)}`);
  });

  it('recovers a diameter from a projected area', () => {
    const area = Math.PI * 5 * 5;
    assert.ok(Math.abs(effectiveDiameter(area) - 10) < 1e-9);
  });

  it('marks nothing solid for a body scaled to nothing', () => {
    const { frontalAreaCells } = voxelise(sdSphere(0.5), 20, 20, 20, 0.001);
    assert.equal(frontalAreaCells, 0);
  });
});

describe('the solver behaves like fluid', () => {
  it('does not diverge on the sphere', () => {
    const m = measureShape('sphere', CI_GRID, 300);
    assert.equal(m.diverged, false);
    assert.ok(m.cd !== null && Number.isFinite(m.cd), `Cd was ${m.cd}`);
  });

  it('produces positive drag in the flow direction', () => {
    // A negative drag would mean the momentum-exchange sign is inverted — the
    // single easiest thing to get wrong in the whole solver.
    const m = measureShape('sphere', CI_GRID, 300);
    assert.ok(m.cd! > 0, `drag should oppose the flow, got Cd ${m.cd}`);
  });

  it('sits within the stated band of Clift–Gauvin at the Re actually run', () => {
    const m = measureShape('sphere', CI_GRID, 300);
    const ratio = m.cd! / m.reference!;
    assert.ok(
      ratio >= SPHERE_BIAS_BAND.low && ratio <= SPHERE_BIAS_BAND.high,
      `sphere Cd ${m.cd!.toFixed(3)} vs Clift–Gauvin ${m.reference!.toFixed(3)} at Re ${m.reynolds.toFixed(0)} — ratio ${ratio.toFixed(2)} outside [${SPHERE_BIAS_BAND.low}, ${SPHERE_BIAS_BAND.high}]`,
    );
  });

  it('scales drag force with the square of velocity', () => {
    // Cd is defined so that it is velocity-independent. If doubling U does not
    // roughly quadruple the force, the definition is not being honoured.
    const shape = CALIBRATION_SHAPES[0]!;
    const slow = solve(shape.sdf, { ...CI_GRID, velocity: 0.03 }, 250);
    const fast = solve(shape.sdf, { ...CI_GRID, velocity: 0.06 }, 250);
    assert.ok(!slow.diverged && !fast.diverged);
    const forceRatio = fast.force / slow.force;
    assert.ok(forceRatio > 2.5 && forceRatio < 6, `force ratio ${forceRatio.toFixed(2)}, expected ≈4`);
  });

  it('gives a streamlined body less drag than a bluff one', () => {
    // The ordering any correct solver must reproduce, at matched conditions.
    const options = { ...CI_GRID, nx: 64, ny: 32, nz: 32, bodyScale: 0.34 };
    const sphere = solve(CALIBRATION_SHAPES[0]!.sdf, options, 300);
    const cube = solve(CALIBRATION_SHAPES[1]!.sdf, options, 300);
    assert.ok(!sphere.diverged && !cube.diverged);
    assert.ok(
      sphere.cd! < cube.cd!,
      `a sphere must have lower Cd than a face-on cube: ${sphere.cd!.toFixed(3)} vs ${cube.cd!.toFixed(3)}`,
    );
  });
});

describe('proxy bodies', () => {
  it('produces a solid body for every segment', () => {
    for (const segment of ['coupe', 'saloon', 'hatchback', 'suv', 'estate'] as const) {
      const body = proxyBody({ lengthM: 4.24, widthM: 1.775, heightM: 1.285, segment });
      const { frontalAreaCells } = voxelise(body, 40, 24, 24, 0.5);
      assert.ok(frontalAreaCells > 0, `${segment} voxelised to nothing`);
    }
  });

  it('gives a taller segment more frontal area than a lower one', () => {
    const dims = { lengthM: 4.5, widthM: 1.85, heightM: 1.7 };
    const suv = voxelise(proxyBody({ ...dims, segment: 'suv' }), 48, 32, 32, 0.5);
    const coupe = voxelise(proxyBody({ ...dims, segment: 'coupe' }), 48, 32, 32, 0.5);
    assert.ok(
      suv.frontalAreaCells >= coupe.frontalAreaCells,
      `SUV ${suv.frontalAreaCells} should not be smaller than coupé ${coupe.frontalAreaCells}`,
    );
  });

  it('maps body-style tags onto a silhouette, and refuses unknown ones', () => {
    assert.equal(segmentForBodyStyles(['coupe']), 'coupe');
    assert.equal(segmentForBodyStyles(['crossover']), 'suv');
    assert.equal(segmentForBodyStyles(['shooting-brake']), 'estate');
    assert.equal(segmentForBodyStyles(['spaceship']), null);
    assert.equal(segmentForBodyStyles([]), null);
  });
});
