/**
 * D3Q19 lattice — the single source of truth for the discrete velocity set.
 *
 * Both the CPU reference solver (`lbmCpu.ts`) and the GPU shaders
 * (`shaders.ts`) read their direction table from here; the GLSL is *generated*
 * from these same arrays. If the two ever disagree it is one typo in one place,
 * and `lattice.test.ts` catches it.
 *
 * ## Provenance
 * The method is textbook lattice Boltzmann (Qian–d'Humières–Lallemand D3Q19,
 * Ginzburg–Adler TRT, Smagorinsky LES). The *structure* below — opposite pairs
 * adjacent, the deviation form, the five-target packing — follows the Aeolus
 * T-1 solver vendored at `reference/aeolus/`, which Kiarash has permission to
 * use or modify, and which is credited on `/attributions/`. Its author's notes
 * on the TRT stability trap (see `trtOmegaMinus` below) saved a day of work
 * that would otherwise have been spent rediscovering it.
 *
 * ## The ordering
 * Directions are laid out so opposite pairs are adjacent:
 *
 *   i = 0        rest
 *   i = 1..6     the six face neighbours (±x, ±y, ±z)
 *   i = 7..18    the twelve edge neighbours
 *
 * which makes the opposite index a two-instruction expression with no lookup
 * table — and a bounce-back wall is the cheapest operation in the solver.
 */

export const Q = 19;

/** Discrete velocities `c_i`, as flat triples. Opposite pairs adjacent. */
// prettier-ignore
export const C = new Int8Array([
   0,  0,  0,   /*  0  rest  */
   1,  0,  0,   /*  1  +x    */
  -1,  0,  0,   /*  2  -x    */
   0,  1,  0,   /*  3  +y    */
   0, -1,  0,   /*  4  -y    */
   0,  0,  1,   /*  5  +z    */
   0,  0, -1,   /*  6  -z    */
   1,  1,  0,   /*  7  +x+y  */
  -1, -1,  0,   /*  8  -x-y  */
   1, -1,  0,   /*  9  +x-y  */
  -1,  1,  0,   /* 10  -x+y  */
   1,  0,  1,   /* 11  +x+z  */
  -1,  0, -1,   /* 12  -x-z  */
   1,  0, -1,   /* 13  +x-z  */
  -1,  0,  1,   /* 14  -x+z  */
   0,  1,  1,   /* 15  +y+z  */
   0, -1, -1,   /* 16  -y-z  */
   0,  1, -1,   /* 17  +y-z  */
   0, -1,  1,   /* 18  -y+z  */
]);

const W1 = 1 / 3;
const W2 = 1 / 18;
const W3 = 1 / 36;

/** Lattice weights `w_i`. Sum to exactly 1. */
export const W = new Float64Array([
  W1,
  W2, W2, W2, W2, W2, W2,
  W3, W3, W3, W3, W3, W3, W3, W3, W3, W3, W3, W3,
]);

/** Opposite direction, in closed form — no lookup table. */
export function opp(i: number): number {
  return i === 0 ? 0 : i & 1 ? i + 1 : i - 1;
}

/** Lattice speed of sound squared, and its inverse. */
export const CS2 = 1 / 3;
export const INV_CS2 = 3;

// ---------------------------------------------------------------------------
// Packing
// ---------------------------------------------------------------------------

/**
 * 19 distributions across five RGBA render targets.
 *
 * `g_i` lives in target `i >> 2`, channel `i & 3`. Slot 19 (target 4, channel
 * 3) is unused and must be written as zero — a stale value there is invisible
 * until it corrupts a moment sum.
 */
export const N_TARGETS = 5;
export const packTarget = (i: number): number => i >> 2;
export const packChannel = (i: number): number => i & 3;

// ---------------------------------------------------------------------------
// Physics
// ---------------------------------------------------------------------------

/**
 * Equilibrium in **deviation form**: `g_i = f_i − w_i`, so the stored quantity
 * is `delta = rho − 1` rather than `rho ≈ 1`.
 *
 * This is not a micro-optimisation. At the Mach numbers a wind tunnel runs at,
 * `f_i` is dominated by `w_i` and the physically interesting part is five or
 * six decimal places down. Storing the deviation keeps those digits in the
 * float's mantissa instead of throwing them away, which is what makes a
 * float32 GPU texture viable at all.
 */
export function equilibriumDev(
  out: Float64Array,
  delta: number,
  ux: number,
  uy: number,
  uz: number,
): Float64Array {
  const rho = 1 + delta;
  const usq = 1.5 * (ux * ux + uy * uy + uz * uz);
  for (let i = 0; i < Q; i++) {
    const cu = C[i * 3]! * ux + C[i * 3 + 1]! * uy + C[i * 3 + 2]! * uz;
    out[i] = W[i]! * (delta + rho * (3 * cu + 4.5 * cu * cu - usq));
  }
  return out;
}

/** Plain `f_i^eq`, for tests that want to reason about `f` rather than `g`. */
export function equilibrium(
  out: Float64Array,
  rho: number,
  ux: number,
  uy: number,
  uz: number,
): Float64Array {
  const usq = 1.5 * (ux * ux + uy * uy + uz * uz);
  for (let i = 0; i < Q; i++) {
    const cu = C[i * 3]! * ux + C[i * 3 + 1]! * uy + C[i * 3 + 2]! * uz;
    out[i] = W[i]! * rho * (1 + 3 * cu + 4.5 * cu * cu - usq);
  }
  return out;
}

export interface Moments {
  delta: number;
  jx: number;
  jy: number;
  jz: number;
}

/** `delta = rho − 1` and the momentum `rho·u`, from deviation distributions. */
export function momentsDev(g: ArrayLike<number>): Moments {
  let delta = 0;
  let jx = 0;
  let jy = 0;
  let jz = 0;
  for (let i = 0; i < Q; i++) {
    const gi = g[i]!;
    delta += gi;
    jx += gi * C[i * 3]!;
    jy += gi * C[i * 3 + 1]!;
    jz += gi * C[i * 3 + 2]!;
  }
  return { delta, jx, jy, jz };
}

// ---------------------------------------------------------------------------
// Relaxation
// ---------------------------------------------------------------------------

/** `nu = c_s²(1/omega − 1/2)`, inverted. */
export const omegaFromNu = (nu: number): number => 1 / (nu * INV_CS2 + 0.5);
export const nuFromOmega = (omega: number): number => CS2 * (1 / omega - 0.5);

/**
 * The TRT antisymmetric relaxation rate.
 *
 * TRT relates the two rates through a magic parameter:
 * `Λ = (1/ω₊ − 1/2)(1/ω₋ − 1/2)`. `Λ = 3/16` places a bounce-back wall exactly
 * halfway between nodes independent of viscosity (Ginzburg & Adler 1994), and
 * since drag depends entirely on where the wall *thinks* it is, that is the
 * value that matters for a wind tunnel.
 *
 * **The trap, documented by the Aeolus author and reproduced here because it is
 * not obvious:** holding Λ fixed while shrinking ν — which is exactly what you
 * do to raise the Reynolds number — drives ω₋ toward zero. At wind-tunnel
 * viscosities Λ = 3/16 gives ω₋ ≈ 0.03–0.09, meaning the antisymmetric
 * non-equilibrium is essentially never relaxed: it advects around the lattice
 * undamped and grows without bound. The solver therefore clamps ω₋ to a stable
 * floor and accepts the small wall-position error, because a slightly
 * mispositioned wall is a bounded error and a diverging solver is not.
 */
export const TRT_LAMBDA = 3 / 16;
export const OMEGA_MINUS_FLOOR = 0.8;

export function trtOmegaMinus(omegaPlus: number, lambda = TRT_LAMBDA): number {
  const raw = 1 / (lambda / (1 / omegaPlus - 0.5) + 0.5);
  return Math.max(OMEGA_MINUS_FLOOR, Math.min(1.98, raw));
}

/**
 * Smagorinsky eddy viscosity — the subgrid model.
 *
 * At ~192 cells across a car at Re ≈ 10⁶ the grid resolves nothing like the
 * full turbulent spectrum, so the unresolved scales are modelled as extra
 * viscosity derived from the local strain rate. `Cs ≈ 0.10–0.12` is the
 * standard range for this kind of external flow.
 *
 * The strain rate comes from the second moment of the non-equilibrium part,
 * which LBM gives locally and for free — no finite differences, no neighbour
 * reads. That locality is the reason LBM suits a GPU at all.
 */
export const SMAGORINSKY_CS = 0.11;

export function eddyOmega(
  omega0: number,
  qNeq: number,
  cs: number = SMAGORINSKY_CS,
): number {
  const nu0 = nuFromOmega(omega0);
  // Solve nu_total = nu0 + (Cs Δ)² |S| with |S| recovered from Q^neq.
  const csDelta2 = cs * cs;
  const nuTotal =
    0.5 * (Math.sqrt(nu0 * nu0 + 2 * csDelta2 * Math.sqrt(2 * qNeq)) + nu0);
  return omegaFromNu(Math.max(nu0, nuTotal));
}

/**
 * Drag coefficient from a measured force — `Cd = 2F / (ρ U² A)`.
 *
 * In lattice units the conversion factors cancel entirely, which is why the
 * solver can report a physically meaningful Cd without ever choosing a metre
 * or a second.
 */
export function dragCoefficient(
  force: number,
  density: number,
  velocity: number,
  area: number,
): number | null {
  if (velocity <= 0 || area <= 0 || density <= 0) return null;
  return (2 * force) / (density * velocity * velocity * area);
}
