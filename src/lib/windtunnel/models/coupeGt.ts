/**
 * `coupe-gt` — a two-door GT coupé.
 *
 * ## What this is, and what it is not
 *
 * It is a **shape family**: a representative front-engined GT coupé, about
 * 4.3 m long, with a long bonnet, a cab-back greenhouse and a tapering tail. It
 * is fitted to each car's published length, width and height before use.
 *
 * It is **not a model of any particular car**. Nothing here was measured from a
 * vehicle, and no manufacturer's surfacing is reproduced. A drag figure taken
 * from it describes this shape at this scale — not the car whose page it
 * appears on. DATA_SOURCES.md establishes why: there is no free, accurately
 * licensed library of real car models, so sourcing one per car was never on the
 * table, and inventing one and calling it a Toyota would be exactly the kind of
 * plausible-looking fabrication the whole project refuses to do.
 *
 * ## Why a loft rather than primitives
 *
 * A car is a shape whose *sections* are simple and whose *lengthwise variation*
 * is everything. Lofting a superellipse whose half-width, sill height, crown
 * height and exponent are all functions of x gives a body with a real
 * silhouette — a shoulder over the front axle, a haunch over the rear, a
 * tapering tail — from about a dozen control points per curve. Composing
 * spheres and boxes cannot produce that.
 *
 * The exponent sweep *is* the styling: 2.3 at the prow is a soft oval, 3.5 over
 * the front axle is a full shoulder carrying the fender out over the tyre, 3.4
 * through the doors, back to 2.6 so the tail closes.
 *
 * ## The constraint that looks catastrophic when broken
 *
 *     arch top = AXLE_Y + ARCH_R  must sit BELOW the body surface at |z| = TRACK_Z
 *
 * The arch is a cylinder subtracted from the body. If it reaches higher than
 * the fender does over the wheel, it does not cut an arch — it cuts the fender
 * off, and you can see the road through the car.
 */
import {
  GEOMETRY_GLSL,
  Profile,
  extrude,
  opSub,
  opUnion,
  polarRepeat,
  sdCapsule,
  sdCylinderZ,
  sdRoundBox,
  sdSphere,
  smin,
  ssub,
  superellipse2D,
} from './geometry.ts';
import type { BodyModel, ModelFit } from './types.ts';
import type { BodySdf } from '../section.ts';

const CAR = {
  L: 4.3,
  AXLE_F: 1.0,
  AXLE_R: 3.52,
  AXLE_Y: 0.315,
  TRACK_Z: 0.72,
  TYRE_R: 0.315,
  ARCH_ZIN: 0.5,
  FILLET: 0.035,
  ARCH_R_F: 0.365,
  ARCH_R_R: 0.38,
  HEIGHT: 1.245,
  HALF_WIDTH: 0.93,
} as const;

const PROFILES = {
  hzLower: new Profile([
    [0.0, 0.09], [0.12, 0.34], [0.35, 0.6], [0.62, 0.72],
    [1.0, 0.845], [1.45, 0.805], [1.95, 0.815], [2.6, 0.825],
    [3.1, 0.845], [3.52, 0.87], [3.95, 0.76], [4.2, 0.55], [4.3, 0.22],
  ]),
  ybLower: new Profile([
    [0.0, 0.34], [0.2, 0.2], [0.55, 0.135], [1.0, 0.115],
    [1.6, 0.105], [2.8, 0.105], [3.3, 0.115], [3.8, 0.17],
    [4.1, 0.28], [4.3, 0.44],
  ]),
  ytLower: new Profile([
    [0.0, 0.44], [0.15, 0.53], [0.4, 0.655], [0.72, 0.79],
    [1.0, 0.815], [1.35, 0.775], [1.75, 0.795], [2.3, 0.848],
    [2.95, 0.875], [3.52, 0.925], [3.95, 0.87], [4.2, 0.78], [4.3, 0.62],
  ]),
  eUpper: new Profile([
    [0.0, 2.3], [0.62, 3.1], [1.0, 3.5], [1.6, 3.2],
    [2.5, 3.4], [3.52, 3.3], [4.3, 2.6],
  ]),
  hzGreen: new Profile([
    [1.62, 0.06], [1.8, 0.42], [2.0, 0.6], [2.3, 0.655],
    [2.9, 0.655], [3.25, 0.62], [3.6, 0.5], [3.9, 0.24], [4.05, 0.05],
  ]),
  ytGreen: new Profile([
    [1.62, 0.8], [1.85, 0.93], [2.1, 1.1], [2.4, 1.215],
    [2.72, 1.235], [3.0, 1.225], [3.3, 1.165], [3.6, 1.07],
    [3.9, 0.93], [4.05, 0.84],
  ]),
};

const E_LOWER = 4.6;
const YB_GREEN = 0.66;
const GREEN_X0 = 1.62;
const GREEN_X1 = 4.05;

function loft(
  x: number, y: number, az: number,
  x0: number, x1: number,
  hzP: Profile, ybP: Profile | number, ytP: Profile,
  eUp: Profile | number, eDn: number, fillet: number,
): number {
  const xc = x < x0 ? x0 : x > x1 ? x1 : x;
  const hz = hzP.at(xc);
  const yb = typeof ybP === 'number' ? ybP : ybP.at(xc);
  const yt = ytP.at(xc);
  const yc = 0.5 * (yb + yt);
  const hy = 0.5 * (yt - yb);
  const a = Math.max(hz - fillet, 0.006);
  const b = Math.max(hy - fillet, 0.006);
  const e = y > yc ? (typeof eUp === 'number' ? eUp : eUp.at(xc)) : eDn;
  return extrude(superellipse2D(az, y - yc, a, b, e) - fillet, Math.max(x0 - x, x - x1));
}

const lowerBody = (x: number, y: number, az: number) =>
  loft(x, y, az, 0, CAR.L, PROFILES.hzLower, PROFILES.ybLower, PROFILES.ytLower,
       PROFILES.eUpper, E_LOWER, CAR.FILLET);

const greenhouse = (x: number, y: number, az: number) =>
  loft(x, y, az, GREEN_X0, GREEN_X1, PROFILES.hzGreen, YB_GREEN, PROFILES.ytGreen,
       2.6, 3.0, 0.03);

/** A cylinder about the axle, alive only outboard — keeps the floor pan intact. */
const archCut = (x: number, y: number, az: number, ax: number, R: number) =>
  Math.max(Math.hypot(x - ax, y - CAR.AXLE_Y) - R, CAR.ARCH_ZIN - az);

const TYRE = { MID: 0.245, HR: 0.02, CORE_HW: 0.055, FILLET: 0.05 };

function tyreSmooth(x: number, y: number, z: number) {
  const r = Math.hypot(x, y);
  const a = Math.abs(r - TYRE.MID) - TYRE.HR;
  const b = Math.abs(z) - TYRE.CORE_HW;
  return Math.hypot(Math.max(a, 0), Math.max(b, 0)) + Math.min(Math.max(a, b), 0) - TYRE.FILLET;
}

/**
 * The rim, in TypeScript.
 *
 * The fluid never sees it — at 80 mm cells a spoke is a fifth of a cell, so
 * `aeroSdf` uses a plain disc and this detail exists only in the GLSL twin.
 * It is kept here so the two descriptions of a wheel stay side by side: the
 * next model to be written will need both, and a rim that exists in one
 * language only is how they drift.
 */
export function rim(x: number, y: number, z: number) {
  const lip = opSub(sdCylinderZ(x, y, z, 0.196, 0.048), sdCylinderZ(x, y, z, 0.172, 0.06));
  const q = polarRepeat(x, y, 5);
  const spoke = sdRoundBox(q[0] - 0.112, q[1], z, 0.072, 0.024, 0.017, 0.011);
  const hub = sdCylinderZ(x, y, z, 0.05, 0.044);
  const face = opSub(sdCylinderZ(x, y, z, 0.178, 0.013), sdCylinderZ(x, y, z, 0.15, 0.02));
  let d = smin(lip, spoke, 0.01);
  d = smin(d, hub, 0.02);
  d = opUnion(d, face);
  return opUnion(d, sdSphere(q[0] - 0.034, q[1], z - 0.038, 0.012));
}

const WHEELS: { x: number; z: number }[] = [
  { x: CAR.AXLE_F, z: CAR.TRACK_Z },
  { x: CAR.AXLE_F, z: -CAR.TRACK_Z },
  { x: CAR.AXLE_R, z: CAR.TRACK_Z },
  { x: CAR.AXLE_R, z: -CAR.TRACK_Z },
];

/** Whether the grid is fine enough to cut wheel arches without holing the body. */
export const archesResolved = (dxMetres: number) => dxMetres < 0.033;

// --- profile baking, for the GPU -------------------------------------------

const PROFILE_SAMPLES = 256;

/**
 * Bakes the six profiles into a texture the raymarcher samples.
 *
 * Evaluating a monotone cubic with a binary search, four times per distance
 * evaluation, a hundred times per ray, is not something to do in a fragment
 * shader. Sampling the curves once on the CPU and letting the texture unit do
 * linear interpolation is visually identical and enormously cheaper.
 *
 * Row 0: hzLower, ybLower, ytLower, eUpper
 * Row 1: hzGreen, ytGreen, 0, 0
 */
function bakeProfiles() {
  const data = new Float32Array(PROFILE_SAMPLES * 2 * 4);
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const t = (i / (PROFILE_SAMPLES - 1)) * CAR.L;
    const o = i * 4;
    data[o] = PROFILES.hzLower.at(t);
    data[o + 1] = PROFILES.ybLower.at(t);
    data[o + 2] = PROFILES.ytLower.at(t);
    data[o + 3] = PROFILES.eUpper.at(t);

    const o2 = (PROFILE_SAMPLES + i) * 4;
    data[o2] = PROFILES.hzGreen.at(t);
    data[o2 + 1] = PROFILES.ytGreen.at(t);
  }
  return { data, width: PROFILE_SAMPLES, height: 2 };
}

// --- the model -------------------------------------------------------------

/**
 * What the FLUID is allowed to see.
 *
 * The Aeolus author is emphatic about this and the reasoning is worth keeping:
 * the aerodynamic shape depends on the lattice spacing, and pretending
 * otherwise is how a wind tunnel produces confident nonsense. At 60–100 mm per
 * cell, the 50 mm tyre-to-arch gap and the 51 mm fender skin are both *under
 * one cell*. Rasterising them gives a one-cell shell with holes, and a
 * bounce-back wall with holes is not a slow wall — it is a nozzle.
 *
 * So when the arch cannot be resolved it is not cut: the wheels are
 * smooth-unioned into the body and the fluid sees a skirted car. That is a
 * real, slightly slipperier shape, and the UI says so.
 */
function aeroSdf(dxMetres: number, fit: ModelFit): BodySdf {
  const canResolveArch = archesResolved(dxMetres);
  /* Undo the fit to evaluate in canonical space, then rescale the distance by
     the smallest factor so the result stays a conservative (Lipschitz) bound —
     a non-uniform stretch does not preserve distances, and an over-estimate is
     what makes a sphere-trace step through a surface. */
  const k = Math.min(fit.x, fit.y, fit.z);
  return (wx: number, wy: number, wz: number): number => {
    const x = wx / fit.x;
    const y = wy / fit.y;
    const z = wz / fit.z;
    const az = Math.abs(z);
    let d = smin(lowerBody(x, y, az), greenhouse(x, y, az), 0.055);
    if (canResolveArch) {
      d = ssub(d, archCut(x, y, az, CAR.AXLE_F, CAR.ARCH_R_F), 0.018);
      d = ssub(d, archCut(x, y, az, CAR.AXLE_R, CAR.ARCH_R_R), 0.018);
    }
    d = smin(d, sdCapsule(x, y, az, 2.02, 0.845, 0.8, 2.115, 0.905, 0.885, 0.042), 0.02);
    for (const w of WHEELS) {
      const wd = opUnion(
        tyreSmooth(x - w.x, y - CAR.AXLE_Y, az - Math.abs(w.z)),
        sdCylinderZ(x - w.x, y - CAR.AXLE_Y, az - Math.abs(w.z), 0.196, 0.048),
      );
      d = canResolveArch ? opUnion(d, wd) : smin(d, wd, 0.05);
    }
    return Math.max(d, 0.002 - y) * k;
  };
}

/** The same body in GLSL, with the millimetre details the eye can see. */
function glsl(fit: ModelFit): string {
  const f = (v: number) => v.toFixed(6);
  return `
${GEOMETRY_GLSL}
uniform sampler2D uProfiles;

const float CAR_L = ${CAR.L.toFixed(4)};
const float AXLE_F = ${CAR.AXLE_F.toFixed(4)};
const float AXLE_R = ${CAR.AXLE_R.toFixed(4)};
const float AXLE_Y = ${CAR.AXLE_Y.toFixed(4)};
const float TRACK_Z = ${CAR.TRACK_Z.toFixed(4)};
const float ARCH_ZIN = ${CAR.ARCH_ZIN.toFixed(4)};
const float FILLET = ${CAR.FILLET.toFixed(4)};
const float ARCH_R_F = ${CAR.ARCH_R_F.toFixed(4)};
const float ARCH_R_R = ${CAR.ARCH_R_R.toFixed(4)};
const float GREEN_X0 = ${GREEN_X0.toFixed(4)};
const float GREEN_X1 = ${GREEN_X1.toFixed(4)};
const float YB_GREEN = ${YB_GREEN.toFixed(4)};

/* Per-axis fit onto the car's published dimensions, and the Lipschitz factor
   that keeps the sphere trace conservative under a non-uniform stretch. */
const vec3 FIT = vec3(${f(fit.x)}, ${f(fit.y)}, ${f(fit.z)});
const float FIT_K = ${f(Math.min(fit.x, fit.y, fit.z))};

/* Loose bound on the whole body, in FITTED metres. Used to reject rays before
   marching — most pixels miss the body entirely and were paying 128 distance
   evaluations to find that out. */
const vec3 BODY_LO = vec3(-0.08, -0.02, -0.98) * FIT;
const vec3 BODY_HI = vec3(CAR_L + 0.10, 1.45, 0.98) * FIT;

/* Where the body turns when it is yawed: its own mid-length, in fitted metres. */
const float BODY_PIVOT = CAR_L * 0.5 * FIT.x;

vec4 profLower(float x) { return texture(uProfiles, vec2(clamp(x / CAR_L, 0.0, 1.0), 0.25)); }
vec4 profGreen(float x) { return texture(uProfiles, vec2(clamp(x / CAR_L, 0.0, 1.0), 0.75)); }

float loftLower(float x, float y, float az) {
  float xc = clamp(x, 0.0, CAR_L);
  vec4 p = profLower(xc);
  float yc = 0.5*(p.y + p.z), hy = 0.5*(p.z - p.y);
  float a = max(p.x - FILLET, 0.006), b = max(hy - FILLET, 0.006);
  float e = (y > yc) ? p.w : ${E_LOWER.toFixed(2)};
  return sdExtrude(superellipse2D(az, y - yc, a, b, e) - FILLET, max(-x, x - CAR_L));
}

float loftGreen(float x, float y, float az) {
  float xc = clamp(x, GREEN_X0, GREEN_X1);
  vec4 p = profGreen(xc);
  float yt = p.y;
  float yc = 0.5*(YB_GREEN + yt), hy = 0.5*(yt - YB_GREEN);
  float a = max(p.x - 0.03, 0.006), b = max(hy - 0.03, 0.006);
  float e = (y > yc) ? 2.6 : 3.0;
  return sdExtrude(superellipse2D(az, y - yc, a, b, e) - 0.03, max(GREEN_X0 - x, x - GREEN_X1));
}

float archCut(float x, float y, float az, float ax, float R) {
  return max(length(vec2(x - ax, y - AXLE_Y)) - R, ARCH_ZIN - az);
}

float tyreSmooth(vec3 p) {
  float r = length(p.xy);
  float a = abs(r - 0.245) - 0.02;
  float b = abs(p.z) - 0.055;
  return length(vec2(max(a,0.0), max(b,0.0))) + min(max(a,b), 0.0) - 0.05;
}

float rimSD(vec3 p) {
  float lip = max(sdCylZ(p, 0.196, 0.048), -sdCylZ(p, 0.172, 0.06));
  vec2 q = polarRepeat(p.xy, 5.0);
  float spoke = sdRoundBox3(vec3(q.x - 0.112, q.y, p.z), vec3(0.072, 0.024, 0.017), 0.011);
  float hub = sdCylZ(p, 0.05, 0.044);
  float face = max(sdCylZ(p, 0.178, 0.013), -sdCylZ(p, 0.15, 0.02));
  float d = smin2(lip, spoke, 0.01);
  d = smin2(d, hub, 0.02);
  d = min(d, face);
  return min(d, length(vec3(q.x - 0.034, q.y, p.z - 0.038)) - 0.012);
}

float wheelSD(vec3 p) { return min(tyreSmooth(p), rimSD(p)); }

/* Distance in fitted world metres; sets the material id. */
float bodySD(vec3 world, out int mat) {
  vec3 p = world / FIT;
  float az = abs(p.z);

  float dLower = loftLower(p.x, p.y, az);
  float dGreen = loftGreen(p.x, p.y, az);
  float body = smin2(dLower, dGreen, 0.055);
  body = ssub2(body, archCut(p.x, p.y, az, AXLE_F, ARCH_R_F), 0.018);
  body = ssub2(body, archCut(p.x, p.y, az, AXLE_R, ARCH_R_R), 0.018);

  /* grille recess */
  body = max(body, -sdRoundBox3(vec3(p.x - 0.055, p.y - 0.47, az), vec3(0.06, 0.08, 0.255), 0.035));
  /* headlamp dish */
  body = ssub2(body, length(vec3(p.x - 0.3, p.y - 0.6, az - 0.52)) - 0.155, 0.012);
  /* three fender gills — the sixties tell */
  for (int i = 0; i < 3; i++) {
    float vx = 1.38 + float(i) * 0.065;
    body = max(body, -sdRoundBox3(vec3(p.x - vx, p.y - 0.575, az - 0.8), vec3(0.016, 0.07, 0.075), 0.01));
  }
  /* wing mirrors: worth 2-4% of a car's drag, so they are not decoration */
  body = smin2(body, sdCapsule3(vec3(p.x, p.y, az), vec3(2.02,0.845,0.80), vec3(2.115,0.905,0.885), 0.042), 0.02);
  /* exhaust tips */
  body = min(body, sdCylZ(vec3(p.y - 0.255, az - 0.3, p.x - 4.27), 0.036, 0.055));
  body = max(body, 0.002 - p.y);

  float wheels = min(
    wheelSD(vec3(p.x - AXLE_F, p.y - AXLE_Y, az - TRACK_Z)),
    wheelSD(vec3(p.x - AXLE_R, p.y - AXLE_Y, az - TRACK_Z)));

  float d = min(body, wheels);

  mat = 0;
  if (wheels < body) {
    vec3 wp = vec3(p.x - (p.x < 2.26 ? AXLE_F : AXLE_R), p.y - AXLE_Y, az - TRACK_Z);
    mat = (length(wp.xy) > 0.20) ? 2 : 3;
  } else {
    float dl = length(vec3(p.x - 0.3, p.y - 0.6, az - 0.52));
    if (dl < 0.152) mat = 3;                                                  /* lamp */
    else if (p.x > 4.19 && p.y < 0.33 && az > 0.24 && az < 0.36) mat = 3;      /* tips */
    else if (p.x < 0.13 && abs(p.y - 0.47) < 0.09 && az < 0.27) mat = 4;       /* grille */
    else if (az > 0.70 && abs(p.y - 0.575) < 0.082 &&
             (abs(p.x-1.38) < 0.03 || abs(p.x-1.445) < 0.03 || abs(p.x-1.51) < 0.03)) mat = 4;
    /*
     * The daylight opening, in the greenhouse shell's own coordinates: u across
     * the width, v up the section.
     *
     * The gate that matters is dGreen < dLower — glass only where the
     * greenhouse shell is the surface we are actually standing on. Without it
     * the window test also matches points far down the flank, where the lofted
     * greenhouse is buried inside the lower body and v goes strongly negative,
     * and the whole side of the car turns to glass.
     */
    else if (dGreen < dLower) {
      vec4 g = profGreen(clamp(p.x, GREEN_X0, GREEN_X1));
      float hw = max(g.x, 1e-4);
      float u = az / hw;
      float v = (p.y - 0.5*(g.y + YB_GREEN)) / max(0.5*(g.y - YB_GREEN), 1e-4);
      float xA = 2.44 - 0.44*u;   /* A-pillar */
      float xC = 3.26 + 0.42*u;   /* C-pillar */
      bool inBand = v > -0.55 && v < 0.42;
      bool sideGlass = inBand && u > 0.60 && p.x > xA + 0.06 && p.x < xC - 0.06;
      bool backlight = inBand && u < 0.82 && p.x > xC - 0.02 && p.x < 4.00;
      bool screen    = inBand && u < 0.92 && p.x > 1.78 && p.x < xA + 0.02;
      if (sideGlass || backlight || screen) mat = 1;
    }
  }
  return d * FIT_K;
}
`;
}

export const coupeGt: BodyModel = {
  id: 'coupe-gt',
  label: 'GT coupé',
  note:
    'A representative two-door GT coupé — long bonnet, cab-back greenhouse, ' +
    'tapering tail — stretched onto this car’s published dimensions. It is a ' +
    'shape family, not a scan of the car.',
  bodyStyles: ['coupe', 'coupé', 'fastback', 'sports', 'roadster', 'convertible'],
  size: { length: CAR.L, width: CAR.HALF_WIDTH * 2, height: CAR.HEIGHT },
  bounds: { lo: [-0.08, -0.02, -0.98], hi: [CAR.L + 0.1, 1.45, 0.98] },
  aeroSdf,
  glsl,
  bakeProfiles,
};
