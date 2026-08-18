/**
 * The scene — the car and the room it sits in.
 *
 * Two ideas:
 *
 * 1. **The body is raymarched from its SDF**, not drawn from the lattice's
 *    solid mask. The fluid sees a voxelised body because it must; the eye
 *    should see the shape that was designed. Drawing the voxels is why the
 *    first version of this looked like a grey lump.
 *
 * 2. **The tunnel is a place**: ground plane, grid, reflection, working-section
 *    box. Without them a body floats in a void with no sense of scale.
 *
 * The flow is not here. Tracers rasterise on top of this pass, and the volume
 * modes march against the depth it writes — both in `renderer.ts`.
 *
 * The shader is built against a `CellMap` and a `BodyModel`, so the
 * world-to-lattice mapping is the one in `section.ts` and the geometry is
 * whichever model the car chose, rather than either being a second copy that
 * can drift.
 */
import { FIELD_GLSL, RAMP_GLSL } from './flow.ts';
import { PREAMBLE } from './shaders.ts';
import { sectionGlsl, type CellMap } from './section.ts';
import type { BodyModel, ModelFit } from './models/index.ts';

/**
 * The studio, as a function rather than a texture.
 *
 * This is what makes painted metal read as painted metal. Two directional
 * lights give a car a pair of dots; what a real body panel shows is the *room*
 * — a bright ceiling, a dark floor, and a hard horizon line that runs the
 * length of the shoulder and bends exactly where the panel's curvature changes.
 * That reflected horizon is the single strongest cue that a surface is glossy
 * and curved, and no amount of Phong recovers it.
 *
 * A studio rig, then, evaluated per reflection ray: sky gradient, ground, a
 * tight horizon band, and two overhead softboxes. It costs a dot product and a
 * couple of smoothsteps, and no texture memory at all.
 */
const STUDIO_GLSL = `
const vec3 KEY  = vec3(-0.5199, 0.7091, 0.4759);   /* normalised */
const vec3 FILL = vec3( 0.7043, 0.3792, -0.5997);

vec3 environment(vec3 d) {
  vec3 sky = mix(vec3(0.052,0.062,0.082), vec3(0.15,0.19,0.27), smoothstep(0.0, 0.75, d.y));
  vec3 ground = vec3(0.026,0.028,0.033);
  vec3 col = d.y > 0.0 ? sky : ground;
  col += vec3(0.10,0.11,0.14) * exp(-abs(d.y) * 20.0);            /* horizon band */
  col += vec3(1.00,0.98,0.94) * 2.9 * smoothstep(0.87, 0.996, dot(d, KEY));
  col += vec3(0.80,0.88,1.00) * 1.3 * smoothstep(0.91, 0.999, dot(d, normalize(FILL)));
  return col;
}
`;

export function sceneShader(map: CellMap, model: BodyModel, fit: ModelFit): string {
  return `${PREAMBLE}
${sectionGlsl(map)}
${FIELD_GLSL}
${RAMP_GLSL}
${STUDIO_GLSL}
${model.glsl(fit)}
uniform vec2 uResolution;
uniform vec3 uCam;
uniform vec3 uTarget;
uniform float uYaw;          /* body yaw, radians */
uniform float uShowBox;
uniform float uDepthA;
uniform float uDepthB;
uniform float uPressure;     /* 1 to paint the body by its own surface pressure */
in vec2 vUv;
out vec4 oColor;

/*
 * The body is yawed, so instead of rotating every sample point the ray itself
 * is rotated into body space once. A yaw is a rigid motion, so distances and
 * the ray parameter t carry over unchanged.
 */
void rayToBody(vec3 ro, vec3 rd, out vec3 bro, out vec3 brd) {
  float c = cos(uYaw), s = sin(uYaw);
  vec3 q = ro; q.x -= BODY_PIVOT;
  bro = vec3(q.x*c - q.z*s + BODY_PIVOT, q.y, q.x*s + q.z*c);
  brd = vec3(rd.x*c - rd.z*s, rd.y, rd.x*s + rd.z*c);
}

/** Body space back to world, for sampling the flow field at a surface point. */
vec3 bodyToWorld(vec3 p) {
  float c = cos(-uYaw), s = sin(-uYaw);
  vec3 q = p; q.x -= BODY_PIVOT;
  return vec3(q.x*c - q.z*s + BODY_PIVOT, q.y, q.x*s + q.z*c);
}

/* Slab test. Returns false when the ray misses, so the march is never entered. */
bool boxHit(vec3 ro, vec3 rd, vec3 lo, vec3 hi, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 a = (lo - ro) * inv, b = (hi - ro) * inv;
  vec3 tn = min(a, b), tf = max(a, b);
  t0 = max(max(tn.x, tn.y), tn.z);
  t1 = min(min(tf.x, tf.y), tf.z);
  return t1 > max(t0, 0.0);
}

struct Hit { float t; int mat; bool hit; };

Hit marchBodySpace(vec3 ro, vec3 rd, float tMax) {
  Hit h; h.t = 0.0; h.mat = 0; h.hit = false;
  float t0, t1;
  if (!boxHit(ro, rd, BODY_LO, BODY_HI, t0, t1)) return h;

  float t = max(t0, 0.01);
  float tEnd = min(t1, tMax);
  for (int i = 0; i < 128; i++) {
    if (t > tEnd) break;
    int m;
    float d = bodySD(ro + rd*t, m);
    if (d < 0.0015) { h.t = t; h.mat = m; h.hit = true; break; }
    t += max(d * 0.85, 0.0015);
  }
  return h;
}

Hit marchBody(vec3 ro, vec3 rd, float tMax) {
  vec3 bro, brd;
  rayToBody(ro, rd, bro, brd);
  return marchBodySpace(bro, brd, tMax);
}

/* Normal in body space, then rotated back into the world. */
vec3 bodyNormalWorld(vec3 pWorld) {
  vec3 bro, brd;
  rayToBody(pWorld, vec3(1.0, 0.0, 0.0), bro, brd);
  const vec2 e = vec2(1.0, -1.0) * 0.0018;
  int m;
  vec3 n = normalize(
    e.xyy*bodySD(bro+e.xyy,m) + e.yyx*bodySD(bro+e.yyx,m) +
    e.yxy*bodySD(bro+e.yxy,m) + e.xxx*bodySD(bro+e.xxx,m));
  float c = cos(-uYaw), s = sin(-uYaw);
  return vec3(n.x*c - n.z*s, n.y, n.x*s + n.z*c);
}

/* Shadow ray, marched in body space for the same reason as the primary ray. */
float softShadow(vec3 pWorld, vec3 lWorld) {
  vec3 bro, brd;
  rayToBody(pWorld, lWorld, bro, brd);
  float t0, t1;
  if (!boxHit(bro, brd, BODY_LO, BODY_HI, t0, t1)) return 1.0;
  float res = 1.0, t = max(t0, 0.03);
  int m;
  for (int i = 0; i < 24; i++) {
    if (t > min(t1, 5.0)) break;
    float d = bodySD(bro + brd*t, m);
    res = min(res, 9.0*d/t);
    if (res < 0.02) break;
    t += clamp(d, 0.02, 0.22);
  }
  return clamp(res, 0.0, 1.0);
}

/**
 * Surface pressure, read from the fluid just outside the wall.
 *
 * Sampling *at* the surface reads a solid cell, where the solver stores
 * nothing; stepping a couple of cells along the outward normal lands in the
 * fluid that is actually pressing on the panel. Two cells is far enough to
 * clear the voxelised wall and near enough that the pressure has not changed.
 */
float surfaceCp(vec3 pWorld, vec3 n) {
  vec3 c = worldToCell(pWorld + n * (SEC_DX * 2.0));
  if (outsideGrid(c)) return 0.0;
  return pressureCoefficient(fieldAt(c).w);
}

vec3 materialColour(int mat, vec3 n, vec3 rd, vec3 p) {
  vec3 base;
  float rough, metal = 0.0, clearcoat = 0.0;
  if (mat == 1)      { base = vec3(0.020,0.024,0.032); rough = 0.04; }
  else if (mat == 2) { base = vec3(0.042,0.042,0.047); rough = 0.80; }
  else if (mat == 3) { base = vec3(0.85,0.87,0.90);    rough = 0.06; metal = 1.0; }
  else if (mat == 4) { base = vec3(0.030,0.030,0.034); rough = 0.92; }
  else               { base = vec3(0.52,0.030,0.040);  rough = 0.10; clearcoat = 1.0; }

  /*
   * Pressure view: the paint is replaced by the measurement, but the lacquer,
   * the glass and the chrome are left alone. A car uniformly flooded with false
   * colour stops reading as a car, and then the reader cannot tell which part
   * of it the high pressure is on.
   */
  bool painted = uPressure > 0.5 && (mat == 0 || mat == 4);
  if (painted) {
    base = pressureTint(surfaceCp(p, n));
    rough = 0.9;          /* matte, so the reading is not diluted by the room */
    clearcoat = 0.0;
  }

  vec3 v = -rd;
  vec3 R = reflect(rd, n);
  float sh = softShadow(p, KEY);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 5.0);

  /* Diffuse: key with its shadow, a cool fill, and sky as ambient. */
  float ndl = max(dot(n, KEY), 0.0) * mix(0.30, 1.0, sh);
  float ndf = max(dot(n, FILL), 0.0) * 0.30;
  /* A painted body is a measurement, so it is lit flatly enough to be read as
     one: shading that swings a panel from dark to bright reads as a pressure
     gradient that is not there. */
  vec3 col = painted
    ? base * (0.55 + 0.45 * (ndl + ndf))
    : base * (ndl + ndf) + base * environment(n) * 0.55;

  /*
   * Specular is the environment seen along the reflection ray, blurred by
   * roughness. There is no way to prefilter an analytic environment, so
   * roughness is approximated by bending the ray back toward the normal — a
   * rough surface reflects something closer to what it faces.
   */
  vec3 env = environment(normalize(mix(R, n, rough * rough)));
  float f0 = mix(0.045, 1.0, metal);
  col += env * mix(f0, 1.0, fres) * mix(1.0, 0.55, rough) * (painted ? 0.18 : 1.0);

  /*
   * Clearcoat: a second, perfectly smooth layer over the paint. This is the
   * lacquer, and it is why a car has a hard bright line along its shoulder that
   * the colour underneath does not.
   */
  if (clearcoat > 0.5) col += environment(R) * (0.03 + 0.5 * fres) * mix(0.35, 1.0, sh);

  /* Glass is mostly what it reflects, plus a dark cabin behind it. */
  if (mat == 1) col += environment(R) * (0.10 + 0.80 * fres);

  return col;
}

/* 1.0 on a box edge, given a point in the box's own 0-1 coordinates. */
float boxEdge(vec3 rel) {
  vec3 e = min(rel, 1.0 - rel);
  if (e.x < 0.0035 && e.y < 0.030) return 1.0;
  if (e.x < 0.0035 && e.z < 0.030) return 1.0;
  if (e.y < 0.0060 && e.z < 0.030) return 1.0;
  return 0.0;
}

vec3 groundColour(vec3 p, vec3 rd) {
  /*
   * Grid: two scales, faded by distance *and* by how obliquely the ray meets
   * the floor. A grid line seen edge-on covers far less than a pixel, and
   * drawing it at full strength anyway is what turns a floor into a moiré field
   * towards the horizon.
   */
  float grazing = clamp(abs(rd.y) * 14.0, 0.0, 1.0);
  float fade = exp(-length(p - uCam) * 0.06) * grazing;

  vec2 g = abs(fract(p.xz) - 0.5);
  float line = 1.0 - smoothstep(0.0, 0.030, min(g.x, g.y));
  vec2 g5 = abs(fract(p.xz * 0.2) - 0.5);
  float line5 = 1.0 - smoothstep(0.0, 0.012, min(g5.x, g5.y));

  vec3 col = vec3(0.020, 0.022, 0.026);
  col += vec3(0.040, 0.045, 0.055) * line * fade;
  col += vec3(0.10, 0.11, 0.13) * line5 * fade;
  col += environment(reflect(rd, vec3(0.0, 1.0, 0.0))) * 0.22;
  return col;
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  ndc.x *= uResolution.x / uResolution.y;

  vec3 ro = uCam;
  vec3 fwd = normalize(uTarget - ro);
  vec3 right = normalize(cross(vec3(0.0,1.0,0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(fwd*1.9 + right*ndc.x + up*ndc.y);

  /* The background is the same room the bodywork reflects, so they agree. */
  vec3 col = environment(rd) * 0.55;

  float tGround = (rd.y < -1e-4) ? (-ro.y / rd.y) : 1e9;
  Hit body = marchBody(ro, rd, 60.0);

  float tSurface = 1e9;
  if (body.hit) {
    vec3 p = ro + rd*body.t;
    col = materialColour(body.mat, bodyNormalWorld(p), rd, p);
    tSurface = body.t;
  } else if (tGround < 1e8) {
    vec3 p = ro + rd*tGround;
    vec3 gc = groundColour(p, rd);

    /* Reflection: march the mirrored ray. This is what makes the floor read as
       a polished tunnel floor rather than a flat grey plane. Weighted by
       Fresnel, so it strengthens towards grazing angles as a real floor does. */
    vec3 rrd = reflect(rd, vec3(0.0,1.0,0.0));
    Hit refl = marchBody(p + vec3(0.0,0.002,0.0), rrd, 16.0);
    if (refl.hit) {
      vec3 rp = p + rrd*refl.t;
      float f = mix(0.30, 0.85, pow(1.0 - min(abs(rd.y), 1.0), 4.0));
      gc = mix(gc, materialColour(refl.mat, bodyNormalWorld(rp), rrd, rp),
               exp(-refl.t*0.30) * f);
    }
    gc *= mix(0.30, 1.0, softShadow(p + vec3(0.0,0.01,0.0), KEY));
    col = gc;
    tSurface = tGround;
  }

  if (uShowBox > 0.5) {
    float t0, t1;
    if (boxHit(ro, rd, SEC_LO, SEC_HI, t0, t1)) {
      /* Both faces the ray crosses, so the far edges draw too and the box
         reads as a wireframe rather than an open wedge. */
      float edge = 0.0;
      if (t0 > 0.0 && t0 < tSurface) edge = boxEdge((ro + rd*t0 - SEC_LO) / (SEC_HI - SEC_LO));
      if (t1 < tSurface) edge = max(edge, boxEdge((ro + rd*t1 - SEC_LO) / (SEC_HI - SEC_LO)) * 0.55);
      col += vec3(0.52,0.46,0.22) * edge * 0.5;
    }
  }

  /*
   * Depth, so the flow can be occluded. The march works in distance along a
   * normalised ray; the projection works in camera-space z. They differ by the
   * cosine between the ray and the view axis — miss that and filaments punch
   * through the bodywork towards the edges of the frame but not in the middle,
   * which is a maddening thing to debug. camera.test.ts pins it.
   */
  float zc = min(tSurface, 1e6) * dot(rd, fwd);
  gl_FragDepth = 0.5 * (uDepthA + uDepthB / max(zc, 1e-4)) + 0.5;

  oColor = vec4(col, 1.0);
}
`;
}

/**
 * Copies one HDR target into another, optionally tonemapping on the way.
 *
 * Two jobs, one shader. With `uTonemap` off it seeds the frame buffer from the
 * cached scene — the car and the tunnel do not move between frames, so they are
 * raymarched once per camera change and replayed from a texture thereafter,
 * which is the difference between a scene cost every frame and a blit. With it
 * on it is the final pass to the canvas: filmic-ish shoulder, then gamma, since
 * raw linear looks plastic.
 */
export const COMPOSITE_FS = `${PREAMBLE}
uniform sampler2D uScene;
uniform float uTonemap;
in vec2 vUv;
out vec4 oColor;
void main() {
  vec3 col = texture(uScene, vUv).rgb;
  if (uTonemap > 0.5) {
    col = col / (col + vec3(0.85));
    col = pow(max(col, 0.0), vec3(1.0/2.2));
  }
  oColor = vec4(col, 1.0);
}
`;
