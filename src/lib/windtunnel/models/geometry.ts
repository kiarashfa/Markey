/**
 * Signed-distance geometry shared by every body model.
 *
 * Two copies of each primitive live here — one in TypeScript, one in GLSL —
 * because the same shape has to be evaluated in two places for two different
 * reasons: on the CPU to rasterise the solid mask the fluid sees, and on the
 * GPU to raymarch the surface the visitor sees. They are emitted side by side
 * so a change to one is impossible to make without seeing the other.
 *
 * ## Provenance
 * The lofted-superellipse construction, the monotone profile fitting and the
 * arch-versus-fender constraint come from the Aeolus T-1 solver vendored at
 * `reference/aeolus/`, which Kiarash has permission to use or modify and which
 * is credited on `/attributions/`.
 */

/**
 * Monotone cubic Hermite through control points. Fritsch–Carlson tangents.
 *
 * Plain cubic Hermite overshoots between control points, and on a car body an
 * overshoot is a visible dent or a bulge that was never designed. Clipping the
 * tangents makes overshoot impossible.
 */
export class Profile {
  readonly x: Float64Array;
  readonly y: Float64Array;
  private readonly m: Float64Array;
  readonly n: number;

  constructor(points: [number, number][]) {
    this.n = points.length;
    this.x = new Float64Array(this.n);
    this.y = new Float64Array(this.n);
    for (let i = 0; i < this.n; i++) {
      this.x[i] = points[i]![0];
      this.y[i] = points[i]![1];
      if (i > 0 && !(this.x[i]! > this.x[i - 1]!)) {
        throw new Error('Profile: x must strictly increase');
      }
    }
    this.m = new Float64Array(this.n);
    this.fitMonotone();
  }

  private fitMonotone(): void {
    const { n, x, y, m } = this;
    if (n === 1) {
      m[0] = 0;
      return;
    }
    const d = new Float64Array(n - 1);
    for (let i = 0; i < n - 1; i++) d[i] = (y[i + 1]! - y[i]!) / (x[i + 1]! - x[i]!);
    m[0] = d[0]!;
    m[n - 1] = d[n - 2]!;
    for (let i = 1; i < n - 1; i++) m[i] = (d[i - 1]! + d[i]!) * 0.5;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) {
        m[i] = 0;
        m[i + 1] = 0;
        continue;
      }
      const a = m[i]! / d[i]!;
      const b = m[i + 1]! / d[i]!;
      if (a < 0) m[i] = 0;
      if (b < 0) m[i + 1] = 0;
      const s = a * a + b * b;
      if (s > 9) {
        const t = 3 / Math.sqrt(s);
        m[i] = t * a * d[i]!;
        m[i + 1] = t * b * d[i]!;
      }
    }
  }

  at(t: number): number {
    const { n, x, y, m } = this;
    if (t <= x[0]!) return y[0]!;
    if (t >= x[n - 1]!) return y[n - 1]!;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid]! <= t) lo = mid;
      else hi = mid;
    }
    const h = x[hi]! - x[lo]!;
    const s = (t - x[lo]!) / h;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * y[lo]! +
      (s3 - 2 * s2 + s) * h * m[lo]! +
      (-2 * s3 + 3 * s2) * y[hi]! +
      (s3 - s2) * h * m[hi]!
    );
  }
}

// --- primitives, in TypeScript ---------------------------------------------

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

export const sdSphere = (x: number, y: number, z: number, r: number) => Math.hypot(x, y, z) - r;

export function sdBox(x: number, y: number, z: number, hx: number, hy: number, hz: number) {
  const dx = Math.abs(x) - hx;
  const dy = Math.abs(y) - hy;
  const dz = Math.abs(z) - hz;
  return (
    Math.hypot(Math.max(dx, 0), Math.max(dy, 0), Math.max(dz, 0)) +
    Math.min(Math.max(dx, Math.max(dy, dz)), 0)
  );
}

export const sdRoundBox = (
  x: number, y: number, z: number, hx: number, hy: number, hz: number, r: number,
) => sdBox(x, y, z, hx - r, hy - r, hz - r) - r;

export function sdCylinderZ(x: number, y: number, z: number, r: number, halfLen: number) {
  const d = Math.hypot(x, y) - r;
  const dz = Math.abs(z) - halfLen;
  return Math.min(Math.max(d, dz), 0) + Math.hypot(Math.max(d, 0), Math.max(dz, 0));
}

export function sdCapsule(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  r: number,
) {
  const pax = px - ax, pay = py - ay, paz = pz - az;
  const bax = bx - ax, bay = by - ay, baz = bz - az;
  const h = clamp(
    (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz + 1e-20),
    0, 1,
  );
  return Math.hypot(pax - bax * h, pay - bay * h, paz - baz * h) - r;
}

/** `e` controls how boxy the section is: 2 is an ellipse, higher is squarer. */
export function superellipse2D(u: number, v: number, a: number, b: number, e: number) {
  if (a <= 1e-9 || b <= 1e-9) return Math.hypot(u, v);
  const s = Math.pow(Math.pow(Math.abs(u) / a, e) + Math.pow(Math.abs(v) / b, e), 1 / e);
  return (s - 1) * Math.min(a, b);
}

/** Exact combine of a 2D section with an axial slab. */
export function extrude(dSection: number, dAxis: number) {
  return (
    Math.min(Math.max(dSection, dAxis), 0) +
    Math.hypot(Math.max(dSection, 0), Math.max(dAxis, 0))
  );
}

export function smin(a: number, b: number, k: number) {
  if (k <= 0) return Math.min(a, b);
  const h = clamp(0.5 + (0.5 * (b - a)) / k, 0, 1);
  return mix(b, a, h) - k * h * (1 - h);
}

export function smax(a: number, b: number, k: number) {
  if (k <= 0) return Math.max(a, b);
  const h = clamp(0.5 - (0.5 * (b - a)) / k, 0, 1);
  return mix(b, a, h) + k * h * (1 - h);
}

export const opUnion = (a: number, b: number) => Math.min(a, b);
export const opSub = (a: number, b: number) => Math.max(a, -b);
export const ssub = (a: number, b: number, k: number) => smax(a, -b, k);

export function polarRepeat(x: number, y: number, n: number): [number, number] {
  const ang = Math.atan2(y, x);
  const sector = (Math.PI * 2) / n;
  const a = ang - sector * Math.floor(ang / sector + 0.5);
  const r = Math.hypot(x, y);
  return [Math.cos(a) * r, Math.sin(a) * r];
}

// --- the same primitives, in GLSL ------------------------------------------

/**
 * Emitted once into any shader that evaluates a body model.
 *
 * Names are suffixed so they cannot collide with the solver's own helpers when
 * two chunks land in the same program.
 */
export const GEOMETRY_GLSL = `
float sdBox3(vec3 p, vec3 h) {
  vec3 d = abs(p) - h;
  return length(max(d, 0.0)) + min(max(d.x, max(d.y, d.z)), 0.0);
}
float sdRoundBox3(vec3 p, vec3 h, float r) { return sdBox3(p, h - r) - r; }

float sdCylZ(vec3 p, float r, float hl) {
  float d = length(p.xy) - r;
  float dz = abs(p.z) - hl;
  return min(max(d, dz), 0.0) + length(vec2(max(d,0.0), max(dz,0.0)));
}

float sdCapsule3(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);
  return length(pa - ba*h) - r;
}

float superellipse2D(float u, float v, float a, float b, float e) {
  if (a <= 1e-6 || b <= 1e-6) return length(vec2(u, v));
  float s = pow(pow(abs(u)/a, e) + pow(abs(v)/b, e), 1.0/e);
  return (s - 1.0) * min(a, b);
}

float sdExtrude(float dSection, float dAxis) {
  return min(max(dSection, dAxis), 0.0) + length(vec2(max(dSection,0.0), max(dAxis,0.0)));
}

float smin2(float a, float b, float k) {
  float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
  return mix(b, a, h) - k*h*(1.0-h);
}
float smax2(float a, float b, float k) {
  float h = clamp(0.5 - 0.5*(b-a)/k, 0.0, 1.0);
  return mix(b, a, h) + k*h*(1.0-h);
}
float ssub2(float a, float b, float k) { return smax2(a, -b, k); }

vec2 polarRepeat(vec2 p, float n) {
  float ang = atan(p.y, p.x);
  float sector = 6.2831853 / n;
  float a = ang - sector * floor(ang/sector + 0.5);
  float r = length(p);
  return vec2(cos(a)*r, sin(a)*r);
}
`;
