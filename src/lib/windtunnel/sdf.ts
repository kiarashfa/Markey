/**
 * Signed-distance geometry for the wind tunnel.
 *
 * Two families, and the difference between them is the whole honesty story:
 *
 *  - **Calibration shapes** — sphere, cube, flat plate, teardrop. These have
 *    published drag coefficients, which is what makes the validation gate in
 *    `validation.ts` possible at all. They are the only shapes the solver is
 *    allowed to be *checked* against.
 *  - **Segment proxy bodies** — a representative coupé, saloon, hatch, SUV or
 *    estate, built procedurally from primitives with per-axis stretch. These
 *    are **not** models of any specific car. A drag number from one describes
 *    that *shape*, not that car, and the UI must say so.
 *
 * Procedural geometry rather than 3D assets is what makes the 3D tab reach more
 * than a curated handful: the design establishes that no free, accurately-
 * licensed library of real car models exists, so sourcing one per car was never
 * going to happen.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** A signed distance field in normalised tunnel coordinates. */
export type Sdf = (p: Vec3) => number;

// --- primitives ------------------------------------------------------------

const length3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);

export function sdSphere(radius: number): Sdf {
  return (p) => length3(p.x, p.y, p.z) - radius;
}

export function sdBox(hx: number, hy: number, hz: number): Sdf {
  return (p) => {
    const qx = Math.abs(p.x) - hx;
    const qy = Math.abs(p.y) - hy;
    const qz = Math.abs(p.z) - hz;
    const outside = length3(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0));
    const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
    return outside + inside;
  };
}

/** Rounded box — the base primitive every proxy body is built from. */
export function sdRoundBox(hx: number, hy: number, hz: number, r: number): Sdf {
  const box = sdBox(Math.max(0, hx - r), Math.max(0, hy - r), Math.max(0, hz - r));
  return (p) => box(p) - r;
}

export function sdEllipsoid(rx: number, ry: number, rz: number): Sdf {
  return (p) => {
    const k0 = length3(p.x / rx, p.y / ry, p.z / rz);
    const k1 = length3(p.x / (rx * rx), p.y / (ry * ry), p.z / (rz * rz));
    return k1 === 0 ? -Math.min(rx, ry, rz) : (k0 * (k0 - 1)) / k1;
  };
}

export const union = (a: Sdf, b: Sdf): Sdf => (p) => Math.min(a(p), b(p));

/** Smooth union — what makes a procedural car read as one body, not a pile. */
export function smoothUnion(a: Sdf, b: Sdf, k: number): Sdf {
  return (p) => {
    const da = a(p);
    const db = b(p);
    const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (db - da)) / k));
    return db * (1 - h) + da * h - k * h * (1 - h);
  };
}

export const translate = (s: Sdf, dx: number, dy: number, dz: number): Sdf => (p) =>
  s({ x: p.x - dx, y: p.y - dy, z: p.z - dz });

/** Per-axis stretch. The operation that lets one body cover a whole segment. */
export const scale = (s: Sdf, sx: number, sy: number, sz: number): Sdf => {
  const m = Math.min(sx, sy, sz);
  return (p) => s({ x: p.x / sx, y: p.y / sy, z: p.z / sz }) * m;
};

// --- calibration shapes ----------------------------------------------------

export type CalibrationShapeId = 'sphere' | 'cube' | 'plate' | 'teardrop';

export interface CalibrationShape {
  id: CalibrationShapeId;
  label: string;
  /** The published figure the solver is measured against. Never tuned. */
  publishedCd: number;
  /** Acceptable spread, reflecting how tightly the reference itself is known. */
  tolerance: number;
  publishedNote: string;
  /** Projected frontal area in the same units the SDF uses. */
  frontalArea: number;
  sdf: Sdf;
}

const R = 0.5;

/**
 * The four shapes with published drag coefficients.
 *
 * These values come from the standard aerodynamics literature and are the
 * published reference values. **They are never adjusted to match
 * what the solver produces** — if a shape is badly off, the integration is
 * wrong, and tuning the reference would destroy the only check that exists.
 */
export const CALIBRATION_SHAPES: CalibrationShape[] = [
  {
    id: 'sphere',
    label: 'Sphere',
    publishedCd: 0.47,
    tolerance: 0.14,
    publishedNote:
      'Cd ≈ 0.47 in the subcritical regime. Strongly Reynolds-dependent — it collapses to ≈0.1 past the drag crisis — so the comparison is only meaningful below Re ≈ 2×10⁵.',
    frontalArea: Math.PI * R * R,
    sdf: sdSphere(R),
  },
  {
    id: 'cube',
    label: 'Cube, face-on',
    publishedCd: 1.05,
    tolerance: 0.2,
    publishedNote: 'Cd ≈ 1.05 for a cube with a face normal to the flow.',
    frontalArea: (2 * R) * (2 * R),
    sdf: sdBox(R, R, R),
  },
  {
    id: 'plate',
    label: 'Flat plate, normal',
    publishedCd: 1.17,
    tolerance: 0.25,
    publishedNote:
      'Cd ≈ 1.17 for a thin square plate held normal to the flow. The hardest of the four for a lattice method: a sharp edge at grid resolution is where separation is least well resolved.',
    frontalArea: (2 * R) * (2 * R),
    sdf: sdBox(0.02, R, R),
  },
  {
    id: 'teardrop',
    label: 'Streamlined teardrop',
    publishedCd: 0.045,
    tolerance: 0.04,
    publishedNote:
      'Cd ≈ 0.04–0.05 for a well-formed streamlined body of revolution. An absolute tolerance looks generous but is not: at this magnitude the grid cannot resolve the attached boundary layer that produces the number.',
    frontalArea: Math.PI * (R * 0.5) * (R * 0.5),
    sdf: scale(sdEllipsoid(1.6 * R, 0.5 * R, 0.5 * R), 1, 1, 1),
  },
];

export function calibrationShape(id: CalibrationShapeId): CalibrationShape {
  const shape = CALIBRATION_SHAPES.find((s) => s.id === id);
  if (!shape) throw new Error(`Unknown calibration shape: ${id}`);
  return shape;
}

// --- segment proxy bodies --------------------------------------------------

export type BodySegment = 'coupe' | 'saloon' | 'hatchback' | 'suv' | 'estate';

export interface ProxyBodyParams {
  /** Overall length, width and height in metres — the car's real dimensions. */
  lengthM: number;
  widthM: number;
  heightM: number;
  segment: BodySegment;
}

/**
 * A representative body for a segment, stretched to a car's real dimensions.
 *
 * The silhouette differences are what actually drive the drag: where the roof
 * starts and ends, how fast the tail falls away, how much frontal area sits
 * above the bonnet line. Everything else — mirrors, wheels arches, door
 * handles — is below what a ~192-cell grid resolves anyway, so modelling it
 * would add cost and no accuracy.
 */
const SEGMENT_PROFILE: Record<
  BodySegment,
  { cabinStart: number; cabinEnd: number; roofHeight: number; tailDrop: number }
> = {
  coupe: { cabinStart: -0.05, cabinEnd: 0.3, roofHeight: 0.86, tailDrop: 0.55 },
  saloon: { cabinStart: -0.12, cabinEnd: 0.28, roofHeight: 0.92, tailDrop: 0.62 },
  hatchback: { cabinStart: -0.1, cabinEnd: 0.34, roofHeight: 0.95, tailDrop: 0.78 },
  suv: { cabinStart: -0.15, cabinEnd: 0.38, roofHeight: 1.0, tailDrop: 0.9 },
  estate: { cabinStart: -0.12, cabinEnd: 0.42, roofHeight: 0.97, tailDrop: 0.88 },
};

export function proxyBody(params: ProxyBodyParams): Sdf {
  const profile = SEGMENT_PROFILE[params.segment];
  const aspectH = params.heightM / params.lengthM;
  const aspectW = params.widthM / params.lengthM;

  // Lower body: full length, full width, roughly half the height.
  const lower = translate(
    sdRoundBox(0.5, aspectH * 0.3, aspectW * 0.5, 0.06),
    0,
    -aspectH * 0.18,
    0,
  );

  // Cabin: shorter, narrower, sitting on top. Its extent is the segment.
  const cabinHalfLength = (profile.cabinEnd - profile.cabinStart) * 0.5;
  const cabinCentre = (profile.cabinEnd + profile.cabinStart) * 0.5;
  const cabin = translate(
    sdRoundBox(cabinHalfLength, aspectH * 0.26 * profile.roofHeight, aspectW * 0.42, 0.08),
    cabinCentre,
    aspectH * 0.24,
    0,
  );

  // The tail: how abruptly the body ends is most of what separates a fastback
  // from a wagon in drag terms.
  const tail = translate(
    sdRoundBox(0.16, aspectH * 0.3 * profile.tailDrop, aspectW * 0.46, 0.07),
    0.36,
    -aspectH * 0.1,
    0,
  );

  return smoothUnion(smoothUnion(lower, cabin, 0.12), tail, 0.1);
}

/** Body style tags map onto the five proxy silhouettes. */
export function segmentForBodyStyles(bodyStyles: string[]): BodySegment | null {
  const map: Record<string, BodySegment> = {
    coupe: 'coupe',
    roadster: 'coupe',
    convertible: 'coupe',
    targa: 'coupe',
    saloon: 'saloon',
    liftback: 'saloon',
    hatchback: 'hatchback',
    microcar: 'hatchback',
    estate: 'estate',
    'shooting-brake': 'estate',
    suv: 'suv',
    crossover: 'suv',
    mpv: 'suv',
    van: 'suv',
    pickup: 'suv',
  };
  for (const style of bodyStyles) {
    const segment = map[style];
    if (segment) return segment;
  }
  return null;
}
