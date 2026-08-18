/**
 * The model contract.
 *
 * Adding a body model means writing one module and adding one line to the
 * registry. These tests are what make that safe: they hold every registered
 * model to the same contract, so a new one either satisfies it or fails here
 * rather than by rendering a hole in the middle of a car.
 *
 * They are deliberately written against `MODELS` rather than against the coupé,
 * so the next model is covered the moment it is registered.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { MODELS, chooseModel, fitModel, modelById, pickModel } from './index.ts';
import { NO_FIT } from './types.ts';

const DIMS = { lengthM: 4.24, widthM: 1.775, heightM: 1.285 };

describe('the registry', () => {
  test('is non-empty and every id is unique', () => {
    assert.ok(MODELS.length > 0);
    const ids = MODELS.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate model id');
  });

  test('every model can be looked up by its own id', () => {
    for (const m of MODELS) assert.equal(modelById(m.id), m);
  });

  test('picks a model for a body style it declares', () => {
    for (const m of MODELS) {
      for (const style of m.bodyStyles) {
        // The first model declaring a style wins, so only assert it is *a*
        // model that declares it — which is the actual guarantee.
        assert.ok(pickModel([style]).bodyStyles.includes(style.toLowerCase()) ||
                  pickModel([style]).bodyStyles.includes(style));
      }
    }
  });

  test('falls back rather than throwing on an unknown body style', () => {
    const choice = chooseModel(['hovercraft'], DIMS);
    assert.ok(choice.model, 'no model returned');
    assert.equal(choice.substituted, true, 'a fallback must declare itself a substitution');
  });

  test('does not flag a substitution when the style genuinely matches', () => {
    const style = MODELS[0]!.bodyStyles[0]!;
    assert.equal(chooseModel([style], DIMS).substituted, false);
  });

  test('matches body styles case-insensitively', () => {
    const style = MODELS[0]!.bodyStyles[0]!;
    assert.equal(pickModel([style.toUpperCase()]).id, MODELS[0]!.id);
  });
});

describe('fitting', () => {
  test('leaves an axis unfitted when the dimension is missing', () => {
    const fit = fitModel(MODELS[0]!, { lengthM: null, widthM: null, heightM: null });
    assert.deepEqual(fit, NO_FIT);
  });

  test('stretches toward the published dimensions', () => {
    const m = MODELS[0]!;
    const longer = fitModel(m, { lengthM: m.size.length * 1.1, widthM: null, heightM: null });
    assert.ok(longer.x > 1.0 && longer.x <= 1.18, `x fit was ${longer.x}`);
    assert.equal(longer.y, 1);
    assert.equal(longer.z, 1);
  });

  test('clamps rather than distorting a shape past recognition', () => {
    const m = MODELS[0]!;
    const absurd = fitModel(m, {
      lengthM: m.size.length * 3,
      widthM: m.size.width * 0.2,
      heightM: m.size.height * 5,
    });
    for (const v of [absurd.x, absurd.y, absurd.z]) {
      assert.ok(v >= 0.82 && v <= 1.18, `fit escaped the clamp: ${v}`);
    }
  });

  test('ignores a nonsensical dimension instead of inverting the body', () => {
    const fit = fitModel(MODELS[0]!, { lengthM: 0, widthM: -2, heightM: null });
    assert.deepEqual(fit, NO_FIT);
  });
});

describe('every model', () => {
  for (const model of MODELS) {
    describe(model.id, () => {
      test('declares itself honestly — no model may name a manufacturer', () => {
        assert.ok(model.label.length > 0);
        assert.ok(model.note.length > 20, 'the caveat shown to readers must say something');
        // A shape family must not claim to be a specific car.
        assert.doesNotMatch(model.note, /\b(toyota|bmw|ford|honda|porsche|ferrari)\b/i);
      });

      test('is solid inside and empty outside', () => {
        const sdf = model.aeroSdf(0.08, NO_FIT);
        const mid = model.size.length / 2;
        // Deep inside the body, roughly at seat height on the centreline.
        assert.ok(sdf(mid, model.size.height * 0.35, 0) < 0, 'the middle of the body is not solid');
        // Well clear of it in every direction.
        assert.ok(sdf(mid, model.size.height * 4, 0) > 0, 'air above the roof is solid');
        assert.ok(sdf(-5, 0.5, 0) > 0, 'air ahead of the nose is solid');
        assert.ok(sdf(mid, 0.5, model.size.width * 3) > 0, 'air beside the body is solid');
      });

      test('never reports a point below the road as fluid', () => {
        const sdf = model.aeroSdf(0.08, NO_FIT);
        assert.ok(sdf(model.size.length / 2, -0.2, 0) > 0, 'the body extends under the road');
      });

      test('the fit actually moves the surface', () => {
        const plain = model.aeroSdf(0.08, NO_FIT);
        const wide = model.aeroSdf(0.08, { x: 1, y: 1, z: 1.18 });
        // A point just outside the unfitted flank should be inside the wider one.
        const mid = model.size.length / 2;
        const z = model.size.width / 2;
        for (let dz = 0; dz < 0.3; dz += 0.02) {
          const probe = z + dz;
          if (plain(mid, 0.5, probe) > 0 && wide(mid, 0.5, probe) < 0) return;
        }
        assert.fail('widening the fit did not move the flank outward anywhere');
      });

      test('emits GLSL defining everything the renderer calls', () => {
        const src = model.glsl(NO_FIT);
        for (const symbol of ['bodySD', 'BODY_LO', 'BODY_HI', 'BODY_PIVOT']) {
          assert.ok(src.includes(symbol), `model GLSL is missing ${symbol}`);
        }
        // A stray backtick would terminate the template literal it lives in and
        // the failure surfaces as an unrelated parse error two files away.
        assert.ok(!src.includes('`'), 'model GLSL contains a backtick');
      });

      test('bakes a profile texture of the size it claims', () => {
        const baked = model.bakeProfiles();
        if (baked === null) return;
        assert.equal(baked.data.length, baked.width * baked.height * 4);
        assert.ok(baked.data.every(Number.isFinite), 'baked profiles contain non-finite values');
      });
    });
  }
});
