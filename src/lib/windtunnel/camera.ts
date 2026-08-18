/**
 * The camera, shared between the raymarcher and the rasteriser.
 *
 * ## Why this is its own module with its own tests
 *
 * The car is raymarched — a ray per pixel, no matrices anywhere. The
 * streaklines are rasterised — triangles through a view-projection matrix. Both
 * have to believe in *exactly* the same camera, or the smoke sits next to the
 * car instead of flowing over it, and that reads as a physics bug rather than
 * as a projection bug.
 *
 * So the basis and the projection are derived here once, and `camera.test.ts`
 * asserts the two paths agree: it takes points, projects them through the
 * matrix, rebuilds the raymarch ray for the pixel that lands on, and checks the
 * ray passes through the point.
 *
 * ## Handedness
 *
 * The raymarcher looks along **+z in camera space** (`zc = dot(p - eye, fwd)`),
 * not GL's conventional −z. The projection below is written for that directly
 * rather than negating a textbook matrix, because a stray sign here is exactly
 * the bug this module exists to prevent.
 */

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface CameraView {
  /** Orthonormal basis. `fwd` points from the eye at the target. */
  right: [number, number, number];
  up: [number, number, number];
  fwd: [number, number, number];
  /** Column-major view-projection, for `gl_Position = uViewProj * vec4(p, 1)`. */
  viewProj: Float32Array;
  /** `zNdc = depthA + depthB / zc`, matching `viewProj`. */
  depthA: number;
  depthB: number;
}

/**
 * Focal length in NDC-y units: a ray for pixel `ndc` is
 * `normalize(fwd·FOCAL + right·ndc.x + up·ndc.y)`.
 *
 * Equivalent to a vertical field of view of 2·atan(1/1.9) ≈ 55.3°, which is a
 * natural-looking lens for a vehicle at a few metres.
 */
export const FOCAL = 1.9;

export const NEAR = 0.05;
export const FAR = 160;

const sub = (a: Vec3Like, b: Vec3Like): [number, number, number] => [a.x - b.x, a.y - b.y, a.z - b.z];

const norm = (v: [number, number, number]): [number, number, number] => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};

const cross = (
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export const dot = (a: [number, number, number], b: [number, number, number]) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Builds the basis the raymarcher uses, and the matrix that reproduces it.
 *
 * The basis construction is copied deliberately, term for term, from the shader
 * — `right = normalize(cross(worldUp, fwd))` then `up = cross(fwd, right)`. It
 * is not the conventional order, and "fixing" it here would break the agreement
 * that is the whole point.
 */
export function cameraView(eye: Vec3Like, target: Vec3Like, aspect: number): CameraView {
  const fwd = norm(sub(target, eye));
  const right = norm(cross([0, 1, 0], fwd));
  const up = cross(fwd, right);

  const depthA = (FAR + NEAR) / (FAR - NEAR);
  const depthB = (-2 * FAR * NEAR) / (FAR - NEAR);

  const e: [number, number, number] = [eye.x, eye.y, eye.z];
  // Camera-space coordinates of a world point p: (p−eye)·right, ·up, ·fwd.
  const tx = -dot(right, e);
  const ty = -dot(up, e);
  const tz = -dot(fwd, e);

  const sx = FOCAL / aspect;
  const sy = FOCAL;

  // Column-major, as GL wants it. Column j holds the coefficients of world axis
  // j; the fourth column carries the translation.
  const m = new Float32Array([
    sx * right[0], sy * up[0], depthA * fwd[0], fwd[0],
    sx * right[1], sy * up[1], depthA * fwd[1], fwd[1],
    sx * right[2], sy * up[2], depthA * fwd[2], fwd[2],
    sx * tx,       sy * ty,    depthA * tz + depthB, tz,
  ]);

  return { right, up, fwd, viewProj: m, depthA, depthB };
}

/** Applies a column-major 4×4 to a point, returning clip coordinates. */
export function project(m: Float32Array, p: Vec3Like): [number, number, number, number] {
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let r = 0; r < 4; r++) {
    out[r] = m[r]! * p.x + m[4 + r]! * p.y + m[8 + r]! * p.z + m[12 + r]!;
  }
  return out;
}

/**
 * The ray the raymarcher builds for a normalised device coordinate.
 *
 * `ndc` is in [-1, 1]²; the shader applies the aspect stretch to x itself, so
 * the same stretch is applied here.
 */
export function rayFor(
  view: CameraView,
  ndcX: number,
  ndcY: number,
  aspect: number,
): [number, number, number] {
  const x = ndcX * aspect;
  const { right, up, fwd } = view;
  return norm([
    fwd[0] * FOCAL + right[0] * x + up[0] * ndcY,
    fwd[1] * FOCAL + right[1] * x + up[1] * ndcY,
    fwd[2] * FOCAL + right[2] * x + up[2] * ndcY,
  ]);
}
