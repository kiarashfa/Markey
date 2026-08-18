import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  C,
  CS2,
  Q,
  W,
  dragCoefficient,
  equilibrium,
  equilibriumDev,
  momentsDev,
  nuFromOmega,
  omegaFromNu,
  opp,
  packChannel,
  packTarget,
  trtOmegaMinus,
} from './lattice.ts';

const close = (a: number, b: number, tol: number, msg?: string) =>
  assert.ok(Math.abs(a - b) <= tol, msg ?? `expected ${a} ≈ ${b} (±${tol})`);

/**
 * These are the tests that actually prove the velocity set is a valid D3Q19.
 * A lattice that fails an isotropy moment produces plausible-looking flow that
 * is quietly wrong — which, for a solver whose whole purpose is reporting a
 * drag number, is the worst possible failure mode.
 */
describe('D3Q19 velocity set', () => {
  it('has 19 directions and 19 weights', () => {
    assert.equal(Q, 19);
    assert.equal(C.length, Q * 3);
    assert.equal(W.length, Q);
  });

  it('weights sum to exactly 1 — zeroth moment', () => {
    let sum = 0;
    for (let i = 0; i < Q; i++) sum += W[i]!;
    close(sum, 1, 1e-15);
  });

  it('first moment vanishes: Σ w_i c_i = 0', () => {
    for (const axis of [0, 1, 2]) {
      let sum = 0;
      for (let i = 0; i < Q; i++) sum += W[i]! * C[i * 3 + axis]!;
      close(sum, 0, 1e-15, `axis ${axis}`);
    }
  });

  it('second moment is isotropic: Σ w_i c_ia c_ib = c_s² δ_ab', () => {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        let sum = 0;
        for (let i = 0; i < Q; i++) sum += W[i]! * C[i * 3 + a]! * C[i * 3 + b]!;
        close(sum, a === b ? CS2 : 0, 1e-15, `moment ${a}${b}`);
      }
    }
  });

  it('third moment vanishes — no odd-order anisotropy', () => {
    for (let a = 0; a < 3; a++) {
      for (let b = 0; b < 3; b++) {
        for (let c = 0; c < 3; c++) {
          let sum = 0;
          for (let i = 0; i < Q; i++)
            sum += W[i]! * C[i * 3 + a]! * C[i * 3 + b]! * C[i * 3 + c]!;
          close(sum, 0, 1e-15, `moment ${a}${b}${c}`);
        }
      }
    }
  });

  it('fourth moment satisfies the isotropy identity', () => {
    // Σ w c_a c_b c_c c_d = c_s⁴ (δab δcd + δac δbd + δad δbc)
    const d = (x: number, y: number) => (x === y ? 1 : 0);
    for (let a = 0; a < 3; a++)
      for (let b = 0; b < 3; b++)
        for (let c = 0; c < 3; c++)
          for (let e = 0; e < 3; e++) {
            let sum = 0;
            for (let i = 0; i < Q; i++)
              sum += W[i]! * C[i * 3 + a]! * C[i * 3 + b]! * C[i * 3 + c]! * C[i * 3 + e]!;
            const expected =
              CS2 * CS2 * (d(a, b) * d(c, e) + d(a, c) * d(b, e) + d(a, e) * d(b, c));
            close(sum, expected, 1e-15, `moment ${a}${b}${c}${e}`);
          }
  });

  it('every direction has a true opposite', () => {
    for (let i = 0; i < Q; i++) {
      const j = opp(i);
      assert.ok(j >= 0 && j < Q, `opp(${i}) out of range`);
      for (const axis of [0, 1, 2]) {
        // `===` rather than assert.equal: negating the rest direction's zero
        // gives -0, and assert.equal uses Object.is, which separates them.
        assert.ok(
          C[j * 3 + axis]! === -C[i * 3 + axis]!,
          `opp(${i}) axis ${axis}: ${C[j * 3 + axis]} vs ${-C[i * 3 + axis]!}`,
        );
      }
    }
  });

  it('opposite is an involution and fixes only the rest direction', () => {
    assert.equal(opp(0), 0);
    for (let i = 0; i < Q; i++) assert.equal(opp(opp(i)), i);
    for (let i = 1; i < Q; i++) assert.notEqual(opp(i), i);
  });

  it('opposite pairs share a weight', () => {
    for (let i = 0; i < Q; i++) close(W[i]!, W[opp(i)]!, 1e-15);
  });

  it('contains exactly one rest, six face and twelve edge directions', () => {
    const counts = { rest: 0, face: 0, edge: 0, other: 0 };
    for (let i = 0; i < Q; i++) {
      const n = Math.abs(C[i * 3]!) + Math.abs(C[i * 3 + 1]!) + Math.abs(C[i * 3 + 2]!);
      if (n === 0) counts.rest++;
      else if (n === 1) counts.face++;
      else if (n === 2) counts.edge++;
      else counts.other++;
    }
    assert.deepEqual(counts, { rest: 1, face: 6, edge: 12, other: 0 });
  });
});

describe('equilibrium', () => {
  it('reduces to the weights at rest with unit density', () => {
    const f = equilibrium(new Float64Array(Q), 1, 0, 0, 0);
    for (let i = 0; i < Q; i++) close(f[i]!, W[i]!, 1e-15);
  });

  it('conserves mass and momentum', () => {
    const f = equilibrium(new Float64Array(Q), 1.03, 0.04, -0.02, 0.01);
    let rho = 0;
    const j = [0, 0, 0];
    for (let i = 0; i < Q; i++) {
      rho += f[i]!;
      for (const a of [0, 1, 2]) j[a]! += f[i]! * C[i * 3 + a]!;
    }
    close(rho, 1.03, 1e-13);
    close(j[0]!, 1.03 * 0.04, 1e-13);
    close(j[1]!, 1.03 * -0.02, 1e-13);
    close(j[2]!, 1.03 * 0.01, 1e-13);
  });

  it('deviation form is exactly the plain form minus the weights', () => {
    // The identity the entire storage scheme rests on.
    const rho = 1.021;
    const u = [0.05, -0.03, 0.012] as const;
    const f = equilibrium(new Float64Array(Q), rho, u[0], u[1], u[2]);
    const g = equilibriumDev(new Float64Array(Q), rho - 1, u[0], u[1], u[2]);
    for (let i = 0; i < Q; i++) close(g[i]!, f[i]! - W[i]!, 1e-14, `direction ${i}`);
  });

  it('momentsDev recovers delta and momentum from the deviation form', () => {
    const rho = 0.987;
    const u = [-0.06, 0.02, 0.03] as const;
    const g = equilibriumDev(new Float64Array(Q), rho - 1, u[0], u[1], u[2]);
    const m = momentsDev(g);
    close(m.delta, rho - 1, 1e-13);
    close(m.jx, rho * u[0], 1e-13);
    close(m.jy, rho * u[1], 1e-13);
    close(m.jz, rho * u[2], 1e-13);
  });

  it('keeps precision at low Mach where the plain form would not', () => {
    // The reason deviation form exists: at u ~ 1e-4 the interesting part of f
    // is ~1e-5 of its own magnitude, and float32 has ~7 digits.
    const g = equilibriumDev(new Float64Array(Q), 0, 1e-4, 0, 0);
    const m = momentsDev(g);
    close(m.jx, 1e-4, 1e-12, 'momentum survives at low Mach');
  });
});

describe('relaxation', () => {
  it('omega and nu invert each other', () => {
    for (const nu of [0.001, 0.01, 0.1, 0.5]) close(nuFromOmega(omegaFromNu(nu)), nu, 1e-14);
  });

  it('omega stays inside the stable band for realistic viscosities', () => {
    for (const nu of [1e-4, 1e-3, 1e-2]) {
      const w = omegaFromNu(nu);
      assert.ok(w > 0 && w < 2, `omega ${w} outside (0,2) for nu ${nu}`);
    }
  });

  it('clamps the TRT antisymmetric rate away from zero', () => {
    // The documented trap: raising Re drives the raw omega_minus to zero and
    // the solver diverges. The floor is what keeps it bounded.
    const omegaPlus = omegaFromNu(1e-4); // a wind-tunnel viscosity
    const om = trtOmegaMinus(omegaPlus);
    assert.ok(om >= 0.8, `omega_minus ${om} fell below the stability floor`);
    assert.ok(om <= 1.98, `omega_minus ${om} above the stable ceiling`);
  });
});

describe('packing', () => {
  it('maps 19 directions into 5 RGBA targets without collision', () => {
    const seen = new Set<string>();
    for (let i = 0; i < Q; i++) {
      const key = `${packTarget(i)}:${packChannel(i)}`;
      assert.ok(!seen.has(key), `slot ${key} used twice`);
      seen.add(key);
      assert.ok(packTarget(i) < 5);
      assert.ok(packChannel(i) < 4);
    }
    assert.equal(seen.size, Q);
  });

  it('leaves exactly one slot spare, which must be written as zero', () => {
    assert.equal(5 * 4 - Q, 1);
    assert.equal(packTarget(18), 4);
    assert.equal(packChannel(18), 2);
  });
});

describe('dragCoefficient', () => {
  it('inverts the definition Cd = 2F/(rho U^2 A)', () => {
    // F chosen so Cd is exactly 0.47
    const rho = 1;
    const u = 0.1;
    const area = 20;
    const force = (0.47 * rho * u * u * area) / 2;
    close(dragCoefficient(force, rho, u, area)!, 0.47, 1e-12);
  });

  it('refuses to divide by zero', () => {
    assert.equal(dragCoefficient(1, 1, 0, 10), null);
    assert.equal(dragCoefficient(1, 1, 0.1, 0), null);
    assert.equal(dragCoefficient(1, 0, 0.1, 10), null);
  });
});
