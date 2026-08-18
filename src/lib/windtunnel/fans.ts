/**
 * Auxiliary fans.
 *
 * A real tunnel sometimes has more than one flow: a crosswind rig, a jet under
 * the floor, a blower aimed at a separation you are trying to understand. Here
 * they are a way to poke the solution and watch it answer — turn a crosswind on
 * and the wake leans, the far-side filaments detach, and the drag figure moves.
 *
 * ## They are a real forcing term, not a visual effect
 *
 * A fan adds momentum to the fluid inside its throat, in the collision step,
 * before equilibrium is computed. The solver then does what it always does. So
 * a fan changes the flow *and* the measured drag — which is the point, and also
 * why the UI has to say that a drag figure taken with a fan running describes
 * the car in that disturbed flow rather than in a clean one.
 *
 * ## Why velocity shift rather than a proper force term
 *
 * Adding `Δu` to the velocity before the equilibrium is the simplest correct
 * forcing for a steady body force at low Mach; the more careful Guo forcing
 * differs at second order in `Δu`, which is far below the modelling error of a
 * 70 mm lattice. Spending accuracy where it cannot be seen, and complexity
 * where it can, is the wrong trade.
 */

export interface Fan {
  id: string;
  label: string;
  /** Throat centre, in world metres. */
  at: [number, number, number];
  /** Direction the fan blows; normalised on upload. */
  dir: [number, number, number];
  /** Throat radius in metres. */
  radius: number;
  /** Peak velocity added, as a multiple of the free stream. */
  strength: number;
}

/** Hard ceiling, so the shader's array has a fixed size. */
export const MAX_FANS = 4;

/**
 * The fans on offer.
 *
 * Deliberately few and deliberately named for what they show, not for where
 * they are. A menu of coordinates is a menu nobody uses.
 */
export const FAN_PRESETS: readonly Fan[] = [
  {
    id: 'crosswind',
    label: 'Crosswind',
    at: [2.0, 0.75, -1.5],
    dir: [0.18, 0, 1],
    radius: 1.15,
    strength: 0.55,
  },
  {
    id: 'gust',
    label: 'Head gust',
    at: [-1.9, 0.9, 0],
    dir: [1, -0.05, 0],
    radius: 0.85,
    strength: 0.7,
  },
  {
    id: 'underfloor',
    label: 'Underfloor jet',
    at: [1.2, 0.06, 0],
    dir: [1, 0.06, 0],
    radius: 0.45,
    strength: 0.8,
  },
  {
    id: 'tailblower',
    label: 'Tail blower',
    at: [5.4, 0.85, 0],
    dir: [-1, 0.12, 0],
    radius: 0.7,
    strength: 0.45,
  },
];

export const fanById = (id: string) => FAN_PRESETS.find((f) => f.id === id);

/**
 * Forcing, in GLSL, injected into the collision.
 *
 * The throat profile is smooth rather than a hard disc: a step change in the
 * body force across one cell is a discontinuity the lattice answers with a
 * pressure wave, and the wave is far more visible than the fan.
 */
export const FANS_GLSL = `
uniform int uFanCount;
uniform vec4 uFanPos[${MAX_FANS}];    /* xyz throat centre in CELLS, w radius in cells */
uniform vec4 uFanDir[${MAX_FANS}];    /* xyz unit direction, w peak speed in lattice units */

vec3 fanVelocity(vec3 cell) {
  vec3 add = vec3(0.0);
  for (int i = 0; i < ${MAX_FANS}; i++) {
    if (i >= uFanCount) break;
    vec4 P = uFanPos[i];
    float r = length(cell - P.xyz) / max(P.w, 1e-4);
    if (r >= 1.0) continue;
    float falloff = smoothstep(1.0, 0.0, r);
    add += uFanDir[i].xyz * (uFanDir[i].w * falloff);
  }
  return add;
}
`;
