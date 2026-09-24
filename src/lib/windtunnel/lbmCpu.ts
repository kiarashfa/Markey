/**
 * A CPU D3Q19 reference solver.
 *
 * ## Why this exists when the real one runs on the GPU
 *
 * The validation gate is the thing that earns the wind tunnel
 * the right to report a drag number at all. A gate that can only be run by
 * opening a browser and looking at it is not a gate — it cannot run in CI, it
 * cannot fail a build, and it rots the first time nobody checks.
 *
 * So the solver exists twice: this one, plain TypeScript, small grids, runnable
 * under `node --test`; and the GPU one in `solver.ts` for interactive use. Both
 * read their velocity set from `lattice.ts`, so they cannot disagree about the
 * physics — and this one is what `validation.test.ts` actually measures.
 *
 * The same split is what the vendored Aeolus does, for the same reason.
 *
 * ## Method
 * TRT collision (Ginzburg–Adler), deviation-form distributions, halfway
 * bounce-back at solid nodes with **momentum exchange** for the force, a moving
 * road under the body, and Smagorinsky eddy viscosity for the unresolved
 * scales.
 */
import {
  C,
  Q,
  W,
  equilibriumDev,
  eddyOmega,
  momentsDev,
  omegaFromNu,
  opp,
  trtOmegaMinus,
} from './lattice.ts';
import { rasterise } from './section.ts';
import type { Sdf, Vec3 } from './sdf.ts';

export interface SolverOptions {
  /** Grid cells along the streamwise axis. */
  nx: number;
  ny: number;
  nz: number;
  /** Inlet velocity in lattice units. Keep well below 0.1 for low Mach. */
  velocity: number;
  /** Kinematic viscosity in lattice units. Sets the Reynolds number. */
  viscosity: number;
  /** Fraction of the domain the body occupies, streamwise. */
  bodyScale?: number;
  /** Ground plane with the road moving at inlet speed — essential for cars. */
  movingRoad?: boolean;
  /** Subgrid model. Off for calibration shapes at low Re. */
  smagorinsky?: boolean;
}

export interface SolveResult {
  /** Streamwise force on the body, lattice units. */
  force: number;
  /** Projected frontal area in cells. */
  frontalAreaCells: number;
  cd: number | null;
  steps: number;
  /** True when the run went non-finite — never report a Cd from one. */
  diverged: boolean;
}

/**
 * Voxelises an SDF into a solid mask and counts the projected frontal area.
 *
 * The area is counted by projection along the flow axis — the same thing the
 * GPU does by rendering a silhouette — so `Cd = 2F/(ρU²A)` uses an area that
 * actually corresponds to the voxelised body rather than to the ideal shape it
 * came from. Using the analytic area against a voxelised force would fold the
 * discretisation error straight into Cd.
 */
export function voxelise(
  sdf: Sdf,
  nx: number,
  ny: number,
  nz: number,
  bodyScale: number,
): { solid: Uint8Array; frontalAreaCells: number } {
  /*
   * Normalised placement: the shape is centred transversely, sits 32% along the
   * duct so there is wake to look at, and is scaled so `bodyScale` is its size
   * as a fraction of the narrowest dimension. This is the calibration-shape
   * convention — the tunnel proper works in metres and uses `voxeliseSection`.
   */
  const cx = nx * 0.32;
  const cy = ny * 0.5;
  const cz = nz * 0.5;
  const span = Math.min(nx, ny, nz) * bodyScale;
  const p: Vec3 = { x: 0, y: 0, z: 0 };

  return rasterise(
    nx,
    ny,
    nz,
    (ix, iy, iz, out) => {
      out.x = (ix - cx) / span;
      out.y = (iy - cy) / span;
      out.z = (iz - cz) / span;
      return out;
    },
    (x, y, z) => {
      p.x = x;
      p.y = y;
      p.z = z;
      return sdf(p);
    },
  );
}

/**
 * Runs the solver to a steady-ish state and returns the drag.
 *
 * Deliberately simple in its convergence handling: it runs a fixed number of
 * steps and averages the force over the tail of the run. A wake at these
 * Reynolds numbers is genuinely unsteady, so there is no converged value to
 * detect — the honest quantity is a time average, and saying so is better than
 * a convergence check that silently stops at a peak or a trough.
 */
export function solve(sdf: Sdf, options: SolverOptions, steps = 600): SolveResult {
  const { nx, ny, nz, velocity, viscosity } = options;
  const bodyScale = options.bodyScale ?? 0.28;
  const smagorinsky = options.smagorinsky ?? false;

  const cells = nx * ny * nz;
  const { solid, frontalAreaCells } = voxelise(sdf, nx, ny, nz, bodyScale);

  let f = new Float64Array(cells * Q);
  let fNext = new Float64Array(cells * Q);

  // Initialise every fluid node at the inlet condition.
  const eq = new Float64Array(Q);
  equilibriumDev(eq, 0, velocity, 0, 0);
  for (let c = 0; c < cells; c++) {
    for (let i = 0; i < Q; i++) f[c * Q + i] = eq[i]!;
  }

  const omegaPlus = omegaFromNu(viscosity);
  const omegaMinus = trtOmegaMinus(omegaPlus);

  const idx = (x: number, y: number, z: number) => (z * ny + y) * nx + x;

  let forceSum = 0;
  let forceSamples = 0;
  const averageFrom = Math.floor(steps * 0.6);
  let diverged = false;

  const gLocal = new Float64Array(Q);
  const gEq = new Float64Array(Q);

  for (let step = 0; step < steps && !diverged; step++) {
    let stepForce = 0;

    // --- collide -----------------------------------------------------------
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const c = idx(x, y, z);
          if (solid[c]) continue;
          const base = c * Q;

          for (let i = 0; i < Q; i++) gLocal[i] = f[base + i]!;
          const m = momentsDev(gLocal);
          const rho = 1 + m.delta;
          if (!Number.isFinite(rho) || rho <= 0) {
            diverged = true;
            break;
          }
          const ux = m.jx / rho;
          const uy = m.jy / rho;
          const uz = m.jz / rho;

          equilibriumDev(gEq, m.delta, ux, uy, uz);

          let omega = omegaPlus;
          if (smagorinsky) {
            let qNeq = 0;
            for (let i = 0; i < Q; i++) {
              const neq = gLocal[i]! - gEq[i]!;
              qNeq += neq * neq;
            }
            omega = eddyOmega(omegaPlus, qNeq);
          }
          const omegaM = smagorinsky ? trtOmegaMinus(omega) : omegaMinus;

          // TRT: split into symmetric and antisymmetric parts about the
          // opposite pair, and relax each at its own rate.
          for (let i = 0; i < Q; i++) {
            const j = opp(i);
            const nPlus = 0.5 * (gLocal[i]! - gEq[i]! + (gLocal[j]! - gEq[j]!));
            const nMinus = 0.5 * (gLocal[i]! - gEq[i]! - (gLocal[j]! - gEq[j]!));
            f[base + i] = gLocal[i]! - omega * nPlus - omegaM * nMinus;
          }
        }
        if (diverged) break;
      }
      if (diverged) break;
    }
    if (diverged) break;

    // --- stream, with bounce-back and momentum exchange --------------------
    fNext.fill(0);
    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        for (let x = 0; x < nx; x++) {
          const c = idx(x, y, z);
          if (solid[c]) continue;
          const base = c * Q;

          for (let i = 0; i < Q; i++) {
            const nxp = x + C[i * 3]!;
            const nyp = y + C[i * 3 + 1]!;
            const nzp = z + C[i * 3 + 2]!;

            // Outside the domain: inlet is fixed, everything else is outflow.
            if (nxp < 0 || nxp >= nx || nyp < 0 || nyp >= ny || nzp < 0 || nzp >= nz) {
              fNext[base + opp(i)] = f[base + i]!;
              continue;
            }

            const n = idx(nxp, nyp, nzp);
            if (solid[n]) {
              // Halfway bounce-back. The momentum exchanged with the wall is
              // 2·c_i·f_i — summing it over every boundary link IS the force,
              // with no surface reconstruction and no pressure integration.
              fNext[base + opp(i)] = f[base + i]!;
              stepForce += 2 * C[i * 3]! * (f[base + i]! + W[i]!);
            } else {
              fNext[n * Q + i] = f[base + i]!;
            }
          }
        }
      }
    }

    // --- boundaries --------------------------------------------------------
    equilibriumDev(gEq, 0, velocity, 0, 0);

    for (let z = 0; z < nz; z++) {
      for (let y = 0; y < ny; y++) {
        // Inlet: hold the free-stream condition.
        const inlet = idx(0, y, z) * Q;
        for (let i = 0; i < Q; i++) fNext[inlet + i] = gEq[i]!;

        // Outlet: copy from upstream — a crude but stable zero-gradient.
        const outlet = idx(nx - 1, y, z) * Q;
        const upstream = idx(nx - 2, y, z) * Q;
        for (let i = 0; i < Q; i++) fNext[outlet + i] = fNext[upstream + i]!;
      }
    }

    /*
     * Lateral and top boundaries are FREE STREAM, not walls.
     *
     * This is external flow — a body in open air — and the first version of
     * this solver let the domain edges act as no-slip walls, which turned it
     * into a blocked duct. The walls grew boundary layers, the channel
     * effectively narrowed, flow accelerated around the body and every
     * calibration shape came out 2–4× its published Cd with the ordering
     * scrambled. Holding the far field at the inlet condition removes the
     * blockage entirely.
     */
    for (let z = 0; z < nz; z++) {
      for (let x = 0; x < nx; x++) {
        const top = idx(x, ny - 1, z) * Q;
        for (let i = 0; i < Q; i++) fNext[top + i] = gEq[i]!;
        if (!options.movingRoad) {
          const bottom = idx(x, 0, z) * Q;
          for (let i = 0; i < Q; i++) fNext[bottom + i] = gEq[i]!;
        }
      }
    }
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        const near = idx(x, y, 0) * Q;
        const far = idx(x, y, nz - 1) * Q;
        for (let i = 0; i < Q; i++) {
          fNext[near + i] = gEq[i]!;
          fNext[far + i] = gEq[i]!;
        }
      }
    }

    if (options.movingRoad) {
      // The road moves with the free stream. A stationary floor grows a
      // boundary layer that does not exist under a real car and corrupts the
      // underbody flow.
      for (let z = 0; z < nz; z++) {
        for (let x = 0; x < nx; x++) {
          const road = idx(x, 0, z) * Q;
          equilibriumDev(gEq, 0, velocity, 0, 0);
          for (let i = 0; i < Q; i++) fNext[road + i] = gEq[i]!;
        }
      }
    }

    const swap = f;
    f = fNext;
    fNext = swap;

    if (step >= averageFrom) {
      if (!Number.isFinite(stepForce)) {
        diverged = true;
        break;
      }
      forceSum += stepForce;
      forceSamples++;
    }
  }

  if (diverged || forceSamples === 0) {
    return { force: NaN, frontalAreaCells, cd: null, steps, diverged: true };
  }

  const force = forceSum / forceSamples;
  const cd =
    frontalAreaCells > 0 && velocity > 0
      ? (2 * force) / (1 * velocity * velocity * frontalAreaCells)
      : null;

  return { force, frontalAreaCells, cd, steps, diverged: false };
}
