/**
 * GLSL ES 3.00 for the GPU solver — **generated from `lattice.ts`**.
 *
 * The direction table, weights and opposite indices are emitted from the same
 * arrays the CPU reference reads. Neither can drift from the other, because
 * neither has its own copy.
 *
 * ## Two traps, both from the Aeolus author's notes and both real
 *
 * 1. **Sampler precision.** GLSL ES 3.00 gives a default precision to exactly
 *    two sampler types (`sampler2D` and `samplerCube`, both `lowp`) and to none
 *    of the others. Anything else is a compile error naming a line inside
 *    whichever shared chunk happened to use it — a long way from the code that
 *    forgot to declare it. So all of them are declared once, in the preamble.
 * 2. **The preamble is added here, never in a shader body.** A second
 *    `#version` directive is a compile error, and because programs link lazily
 *    the failure surfaces later as a null uniform rather than at compile time.
 */
import { C, Q, W, opp } from './lattice.ts';
import { FANS_GLSL } from './fans.ts';

/** Emitted once at the top of every stage. */
export const PREAMBLE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler3D;
precision highp isampler2D;
`;

/** The lattice, as GLSL constants generated from the TypeScript arrays. */
function latticeGlsl(): string {
  const dirs: string[] = [];
  const weights: string[] = [];
  const opposites: string[] = [];
  for (let i = 0; i < Q; i++) {
    dirs.push(`  vec3(${C[i * 3]!.toFixed(1)}, ${C[i * 3 + 1]!.toFixed(1)}, ${C[i * 3 + 2]!.toFixed(1)})`);
    weights.push(`  ${W[i]!.toPrecision(17)}`);
    opposites.push(`  ${opp(i)}`);
  }
  return `
const int Q = ${Q};
const vec3 CDIR[Q] = vec3[Q](
${dirs.join(',\n')}
);
const float WT[Q] = float[Q](
${weights.join(',\n')}
);
const int OPP[Q] = int[Q](
${opposites.join(',\n')}
);
`;
}

/**
 * Atlas addressing.
 *
 * WebGL2 cannot render into a 3D texture layer without a separate draw per
 * layer, so the lattice lives in a 2D atlas of z-slices. One draw covers the
 * whole volume, which is what keeps a step to two passes rather than 2·nz.
 */
const ATLAS = `
uniform vec3 uGrid;    /* nx, ny, nz */
uniform vec2 uTiles;   /* tiles across, tiles down */
uniform vec2 uAtlas;   /* atlas size in texels */

ivec3 uvToCell(vec2 fragCoord) {
  int px = int(fragCoord.x);
  int py = int(fragCoord.y);
  int tx = px / int(uGrid.x);
  int ty = py / int(uGrid.y);
  int x  = px - tx * int(uGrid.x);
  int y  = py - ty * int(uGrid.y);
  int z  = ty * int(uTiles.x) + tx;
  return ivec3(x, y, z);
}

vec2 cellToUv(ivec3 c) {
  int tile = c.z;
  int tx = tile % int(uTiles.x);
  int ty = tile / int(uTiles.x);
  vec2 texel = vec2(float(tx) * uGrid.x + float(c.x) + 0.5,
                    float(ty) * uGrid.y + float(c.y) + 0.5);
  return texel / uAtlas;
}

bool inside(ivec3 c) {
  return c.x >= 0 && c.y >= 0 && c.z >= 0 &&
         c.x < int(uGrid.x) && c.y < int(uGrid.y) && c.z < int(uGrid.z);
}
`;

/** Reads the 19 distributions from the five packed targets. */
const READ_G = `
uniform sampler2D uG0, uG1, uG2, uG3, uG4;

void readG(vec2 uv, out float g[Q]) {
  vec4 a = texture(uG0, uv);
  vec4 b = texture(uG1, uv);
  vec4 c = texture(uG2, uv);
  vec4 d = texture(uG3, uv);
  vec4 e = texture(uG4, uv);
  g[0]=a.x; g[1]=a.y; g[2]=a.z; g[3]=a.w;
  g[4]=b.x; g[5]=b.y; g[6]=b.z; g[7]=b.w;
  g[8]=c.x; g[9]=c.y; g[10]=c.z; g[11]=c.w;
  g[12]=d.x; g[13]=d.y; g[14]=d.z; g[15]=d.w;
  g[16]=e.x; g[17]=e.y; g[18]=e.z;
}

float readGi(vec2 uv, int i) {
  if (i < 4)  { vec4 t = texture(uG0, uv); return i==0?t.x:i==1?t.y:i==2?t.z:t.w; }
  if (i < 8)  { vec4 t = texture(uG1, uv); int j=i-4;  return j==0?t.x:j==1?t.y:j==2?t.z:t.w; }
  if (i < 12) { vec4 t = texture(uG2, uv); int j=i-8;  return j==0?t.x:j==1?t.y:j==2?t.z:t.w; }
  if (i < 16) { vec4 t = texture(uG3, uv); int j=i-12; return j==0?t.x:j==1?t.y:j==2?t.z:t.w; }
  vec4 t = texture(uG4, uv); int j=i-16; return j==0?t.x:j==1?t.y:t.z;
}
`;

const PHYSICS = `
void moments(in float g[Q], out float delta, out vec3 j) {
  delta = 0.0; j = vec3(0.0);
  for (int i = 0; i < Q; i++) { delta += g[i]; j += g[i] * CDIR[i]; }
}

void equilibriumDev(float delta, vec3 u, out float ge[Q]) {
  float rho = 1.0 + delta;
  float usq = 1.5 * dot(u, u);
  for (int i = 0; i < Q; i++) {
    float cu = dot(CDIR[i], u);
    ge[i] = WT[i] * (delta + rho * (3.0*cu + 4.5*cu*cu - usq));
  }
}
`;

export const FULLSCREEN_VS = `${PREAMBLE}
out vec2 vUv;
void main() {
  /* Two triangles from gl_VertexID — no vertex buffer, no attribute state. */
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;

/** Pass 1 — local TRT collision, writing post-collision distributions. */
export const COLLIDE_FS = `${PREAMBLE}
${latticeGlsl()}
${ATLAS}
${READ_G}
${PHYSICS}
${FANS_GLSL}
uniform sampler2D uSolid;
uniform float uOmegaPlus;
uniform float uOmegaMinus;
uniform float uSmagorinsky;

layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
layout(location=3) out vec4 o3;
layout(location=4) out vec4 o4;

void main() {
  ivec3 cell = uvToCell(gl_FragCoord.xy);
  vec2 uv = cellToUv(cell);
  float g[Q]; readG(uv, g);

  if (texture(uSolid, uv).r > 0.5 || !inside(cell)) {
    /* Solid nodes hold their state; the stream pass bounces off them. */
    o0=vec4(g[0],g[1],g[2],g[3]); o1=vec4(g[4],g[5],g[6],g[7]);
    o2=vec4(g[8],g[9],g[10],g[11]); o3=vec4(g[12],g[13],g[14],g[15]);
    o4=vec4(g[16],g[17],g[18],0.0);
    return;
  }

  float delta; vec3 j;
  moments(g, delta, j);
  float rho = 1.0 + delta;
  vec3 u = j / max(rho, 1e-6);

  /*
   * Auxiliary fans, as a shift of the equilibrium velocity. The fluid relaxes
   * toward u + du rather than u, which is a body force the collision then
   * carries through the rest of the step by itself.
   */
  u += fanVelocity(vec3(cell));

  float ge[Q]; equilibriumDev(delta, u, ge);

  float omegaP = uOmegaPlus;
  if (uSmagorinsky > 0.5) {
    /* Strain rate from the second moment of the non-equilibrium part — local,
       no neighbour reads. That locality is why LBM suits a GPU at all. */
    float qneq = 0.0;
    for (int i = 0; i < Q; i++) { float n = g[i]-ge[i]; qneq += n*n; }
    float nu0 = (1.0/omegaP - 0.5) / 3.0;
    float cs2 = 0.11 * 0.11;
    float nuT = 0.5 * (sqrt(nu0*nu0 + 2.0*cs2*sqrt(2.0*qneq)) + nu0);
    omegaP = 1.0 / (3.0 * max(nu0, nuT) + 0.5);
  }

  float out_[Q];
  for (int i = 0; i < Q; i++) {
    int k = OPP[i];
    float nPlus  = 0.5 * ((g[i]-ge[i]) + (g[k]-ge[k]));
    float nMinus = 0.5 * ((g[i]-ge[i]) - (g[k]-ge[k]));
    out_[i] = g[i] - omegaP*nPlus - uOmegaMinus*nMinus;
  }

  o0=vec4(out_[0],out_[1],out_[2],out_[3]);
  o1=vec4(out_[4],out_[5],out_[6],out_[7]);
  o2=vec4(out_[8],out_[9],out_[10],out_[11]);
  o3=vec4(out_[12],out_[13],out_[14],out_[15]);
  o4=vec4(out_[16],out_[17],out_[18],0.0);
}
`;

/**
 * Pass 2 — stream (pull), bounce-back, boundaries, and the drag force.
 *
 * Gathering rather than scattering: each cell pulls `f_i` from the neighbour
 * upwind of direction `i`. Where that neighbour is solid the population is
 * replaced by its own opposite (halfway bounce-back), and the momentum
 * exchanged with the wall — `2·c_i·f_i` — is accumulated into a sixth target.
 * Summing that target IS the drag, with no surface reconstruction.
 */
export const STREAM_FS = `${PREAMBLE}
${latticeGlsl()}
${ATLAS}
${READ_G}
${PHYSICS}
uniform sampler2D uSolid;
uniform float uVelocity;
uniform float uMovingRoad;

layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;
layout(location=2) out vec4 o2;
layout(location=3) out vec4 o3;
layout(location=4) out vec4 o4;
layout(location=5) out vec4 oForce;

void main() {
  ivec3 cell = uvToCell(gl_FragCoord.xy);
  vec2 uv = cellToUv(cell);
  float force = 0.0;
  float f[Q];

  bool solidHere = texture(uSolid, uv).r > 0.5;

  /* Far field: inlet, lateral and top boundaries hold the free stream. This is
     external flow — letting the domain edges act as walls turns it into a
     blocked duct and inflates every drag number, which is exactly what the CPU
     reference did until it was fixed. */
  bool farField = !inside(cell) || cell.x == 0
    || cell.y == int(uGrid.y)-1
    || cell.z == 0 || cell.z == int(uGrid.z)-1
    || (uMovingRoad > 0.5 && cell.y == 0)
    || (uMovingRoad <= 0.5 && cell.y == 0);

  if (farField && !solidHere) {
    float ge[Q]; equilibriumDev(0.0, vec3(uVelocity, 0.0, 0.0), ge);
    o0=vec4(ge[0],ge[1],ge[2],ge[3]); o1=vec4(ge[4],ge[5],ge[6],ge[7]);
    o2=vec4(ge[8],ge[9],ge[10],ge[11]); o3=vec4(ge[12],ge[13],ge[14],ge[15]);
    o4=vec4(ge[16],ge[17],ge[18],0.0); oForce=vec4(0.0);
    return;
  }

  for (int i = 0; i < Q; i++) {
    ivec3 src = cell - ivec3(CDIR[i]);
    if (!inside(src)) {
      /* Outflow at the far end: zero gradient. */
      f[i] = readGi(uv, i);
      continue;
    }
    vec2 suv = cellToUv(src);
    if (texture(uSolid, suv).r > 0.5) {
      float own = readGi(uv, OPP[i]);
      f[i] = own;
      force += 2.0 * CDIR[OPP[i]].x * (own + WT[OPP[i]]);
    } else {
      f[i] = readGi(suv, i);
    }
  }

  o0=vec4(f[0],f[1],f[2],f[3]);
  o1=vec4(f[4],f[5],f[6],f[7]);
  o2=vec4(f[8],f[9],f[10],f[11]);
  o3=vec4(f[12],f[13],f[14],f[15]);
  o4=vec4(f[16],f[17],f[18],0.0);
  oForce = vec4(solidHere ? 0.0 : force, 0.0, 0.0, 1.0);
}
`;

/**
 * Pass 3 — decode the macroscopic field into something anything can sample.
 *
 * Reconstructing `u` from the nineteen distributions costs five texture fetches
 * and a nineteen-term sum. The tracer integrator wants that value at four
 * points per particle per frame, with interpolation, which through the raw
 * distributions would be forty fetches for one velocity. Decoding once per step
 * into `(ux, uy, uz, δρ)` turns every later read into a single filtered fetch.
 *
 * The density deviation rides in the spare channel because pressure is a
 * first-class view: in a lattice-Boltzmann fluid `p = ρ·cs²`, so δρ *is* the
 * pressure field up to a constant, and it would be perverse to recompute it
 * from the populations when this pass already has them open.
 */
export const FIELD_FS = `${PREAMBLE}
${latticeGlsl()}
${ATLAS}
${READ_G}
${PHYSICS}
uniform sampler2D uSolid;
out vec4 oField;

void main() {
  ivec3 cell = uvToCell(gl_FragCoord.xy);
  vec2 uv = cellToUv(cell);
  if (!inside(cell) || texture(uSolid, uv).r > 0.5) { oField = vec4(0.0); return; }

  float g[Q]; readG(uv, g);
  float delta; vec3 j; moments(g, delta, j);
  oField = vec4(j / max(1.0 + delta, 1e-6), delta);
}
`;

/** Sums a texture by repeated 4×4 reduction — used for the drag total. */
export const REDUCE_FS = `${PREAMBLE}
uniform sampler2D uSrc;
uniform vec2 uSrcSize;
out vec4 oSum;
void main() {
  vec2 base = floor(gl_FragCoord.xy) * 4.0;
  float sum = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      vec2 p = (base + vec2(float(x), float(y)) + 0.5) / uSrcSize;
      if (p.x < 1.0 && p.y < 1.0) sum += texture(uSrc, p).r;
    }
  }
  oSum = vec4(sum, 0.0, 0.0, 1.0);
}
`;
