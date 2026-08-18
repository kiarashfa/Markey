/**
 * Lagrangian tracers — the ribbons and the mist.
 *
 * ## Why tracers and not a dye field
 *
 * The first version of the smoke advected a scalar dye through the lattice. It
 * is the obvious thing to do and it does not give you lines: semi-Lagrangian
 * advection interpolates once per step, and a few hundred interpolations turn a
 * crisp filament into fog. (That fog is genuinely useful for showing the *size*
 * of a separated region, which is why `smoke.ts` still exists — but it is a
 * different picture answering a different question.)
 *
 * A tunnel does not release a cloud when it wants lines. It has a **rake**, and
 * each nozzle bleeds one continuous filament. You read the flow from how the
 * lines bend, bunch and burst — and a line only stays a line if nothing ever
 * averages it with its neighbours.
 *
 * ## What a filament actually is
 *
 * A **streakline**: the locus of every fluid element that has passed through
 * one fixed point. So each nozzle owns a ring buffer of tracers. Every emission
 * interval the head advances and a fresh tracer is born at the nozzle; every
 * frame all of them advect. Draw them oldest to newest and the polyline through
 * them *is* the streakline. Nothing is stylised: each vertex is a fluid element
 * that really was at the nozzle N steps ago and has been carried by the
 * solver's own velocity field ever since.
 *
 * The mist is the same tracers drawn as loose dots instead of joined up. It
 * gives up the identity of any one path in exchange for showing the whole field
 * at once.
 *
 * ## Three things that are not obvious
 *
 * 1. **Emission is paced by distance, not by frames.** Birth one tracer per
 *    frame and the spacing along a filament becomes whatever the frame rate
 *    happened to be — at 60 fps the buffer covers a quarter of the tunnel, at
 *    15 fps it overshoots and wraps onto itself.
 *
 * 2. **RK2, not Euler.** Euler visibly cuts the corner of a vortex and spirals
 *    the filament inward, inventing a structure the solver never produced.
 *
 * 3. **`gl.lineWidth` is clamped to 1 on every desktop browser.** So each
 *    segment is expanded into two triangles in *screen* space, sized from a
 *    world width so filaments recede with distance like real objects, with a
 *    sub-pixel rule that dims rather than thins once a filament is finer than a
 *    pixel — otherwise distant filaments either vanish or all read equally
 *    bright, and the depth cue inverts.
 */
import { FIELD_GLSL, RAMP_GLSL } from './flow.ts';
import { RAKE_GLSL } from './sources.ts';
import { FULLSCREEN_VS, PREAMBLE } from './shaders.ts';
import { sectionGlsl, type CellMap } from './section.ts';

/** Ring-buffer length: tracers per nozzle. */
export const SAMPLES = 96;

/**
 * Cells of travel between births, chosen so a full ring spans the tunnel.
 *
 * Fixing it at a constant wastes the buffer whenever the grid is not the size
 * it was tuned for: at 2.0 cells a 96-slot ring reaches 190 cells, which
 * overshoots a 120-cell domain by 60% — the surplus slots hold tracers that
 * left the tunnel and are frozen dead, so a third of the buffer draws nothing.
 * Deriving it means the filament always reaches exactly the outlet, and gets a
 * finer polyline on the smaller grids, which are the ones with frames to spare.
 */
export const spacing = (map: CellMap) => map.nx / (SAMPLES - 1);

const HASH_GLSL = `
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
`;

/** Advances every tracer, and births the head slot when one is due. */
export function updateShader(): string {
  return `${PREAMBLE}
${FIELD_GLSL}
${RAKE_GLSL}
${HASH_GLSL}
uniform sampler2D uPos;
uniform float uAdvect;     /* lattice steps of travel this frame */
uniform int uHead;         /* ring slot reborn this frame, or -1 */
uniform int uSamples;
uniform float uJitter;     /* cells of scatter at birth */
uniform float uSeed;
uniform float uReset;
out vec4 oPos;

void main() {
  ivec2 t = ivec2(gl_FragCoord.xy);
  int col = t.x, row = t.y;
  vec3 born = nozzleByIndex(row);
  if (uJitter > 0.0) born += (hash33(vec3(float(row), uSeed, float(col))) - 0.5) * uJitter;

  /* Dead, so nothing is drawn until the ring has been walked once. */
  if (uReset > 0.5) { oPos = vec4(born, 0.0); return; }
  if (col == uHead) { oPos = vec4(born, 1.0); return; }

  vec4 P = texelFetch(uPos, t, 0);
  if (P.w < 0.5) { oPos = P; return; }

  /* RK2 in cell coordinates. Velocity is in lattice units, which are cells per
     lattice step, so the step is just the number of steps elapsed. */
  vec3 p = P.xyz;
  vec3 v0 = velAt(p);
  vec3 v1 = velAt(p + v0 * (0.5 * uAdvect));
  vec3 pn = p + v1 * uAdvect;

  if (outsideGrid(pn)) { oPos = vec4(p, 0.0); return; }
  /*
   * A tracer should never enter the body — the velocity goes to zero at the
   * wall — but interpolation across the wall lets it. Hold it rather than kill
   * it: a filament really does bunch against a stagnation point, and that is
   * one of the things worth seeing.
   */
  if (inSolid(pn)) { oPos = vec4(p, 1.0); return; }
  oPos = vec4(pn, 1.0);
}
`;
}

/** Shared by both draws: unpack a slot, project it, colour it. */
const DRAW_COMMON = `
uniform sampler2D uPos;
uniform mat4 uViewProj;
uniform vec2 uRes;
uniform vec3 uCam;
uniform int uHead;
uniform int uSamples;
uniform float uMinHalfPx;

/* two triangles: (0,-1) (0,+1) (1,-1) / (0,+1) (1,+1) (1,-1) */
const vec2 CORNER[6] = vec2[6](vec2(0.0,-1.0), vec2(0.0,1.0), vec2(1.0,-1.0),
                               vec2(0.0, 1.0), vec2(1.0,1.0), vec2(1.0,-1.0));
`;

/** Ribbons: each segment of each filament expanded into a screen-space quad. */
export function ribbonVertexShader(map: CellMap): string {
  return `${PREAMBLE}
${sectionGlsl(map)}
${FIELD_GLSL}
${DRAW_COMMON}
uniform float uWidthM;     /* filament diameter at the nozzle, metres */
uniform float uSpread;     /* how much it fattens with age, as a multiple */
out float vSide;
out float vAge;
out float vSpeed;
out float vVort;
out float vShrink;
out vec3 vWorld;
out vec3 vTangent;

void main() {
  int id = gl_VertexID;
  int seg = id / 6;
  vec2 corner = CORNER[id - seg * 6];
  int perNozzle = uSamples - 1;
  int nozzle = seg / perNozzle;
  int j = seg - nozzle * perNozzle;

  /* Birth order, oldest to newest: head+1, head+2, … head+samples. */
  int i0 = (uHead + 1 + j) % uSamples;
  int i1 = (uHead + 2 + j) % uSamples;
  vec4 A = texelFetch(uPos, ivec2(i0, nozzle), 0);
  vec4 B = texelFetch(uPos, ivec2(i1, nozzle), 0);

  /* Either end dead: collapse behind the near plane so it is clipped away. */
  if (A.w < 0.5 || B.w < 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vSide = 9.0; return; }

  vec3 W0 = cellToWorld(A.xyz);
  vec3 W1 = cellToWorld(B.xyz);
  vec4 c0 = uViewProj * vec4(W0, 1.0);
  vec4 c1 = uViewProj * vec4(W1, 1.0);
  if (c0.w <= 1e-4 || c1.w <= 1e-4) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vSide = 9.0; return; }

  vec2 p0 = c0.xy / c0.w * 0.5 * uRes;
  vec2 p1 = c1.xy / c1.w * 0.5 * uRes;
  vec2 d = p1 - p0;
  float len = length(d);
  vec2 dir = len > 1e-5 ? d / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);

  vec4 c = corner.x < 0.5 ? c0 : c1;
  vec3 W = corner.x < 0.5 ? W0 : W1;
  vec3 T = W1 - W0;
  T = length(T) > 1e-9 ? normalize(T) : vec3(1.0, 0.0, 0.0);

  float ageF = float(j) / float(perNozzle);   /* 0 oldest, 1 at the nozzle */

  /*
   * A streakline is a curve and has no thickness at all; the width drawn here
   * is a rendering choice. The growth with age is the one physical thing about
   * it — a real filament is stirred apart by the flow as it travels.
   */
  float halfW = 0.5 * uWidthM * (1.0 + uSpread * (1.0 - ageF));

  /* Pixels per metre HERE, by projecting an offset rather than trusting a
     scalar — perspective makes that scalar wrong away from the centre. */
  vec3 V = normalize(uCam - W);
  vec3 across = cross(T, V);
  across = length(across) > 1e-6 ? normalize(across) : vec3(0.0, 1.0, 0.0);
  vec4 cOff = uViewProj * vec4(W + across * halfW, 1.0);
  vec2 pHere = c.xy / c.w * 0.5 * uRes;
  float halfPx = (cOff.w > 1e-4) ? length(cOff.xy / cOff.w * 0.5 * uRes - pHere) : uMinHalfPx;

  float drawPx = max(halfPx, uMinHalfPx);
  vShrink = halfPx / drawPx;

  vec2 pp = (corner.x < 0.5 ? p0 : p1) + nrm * (drawPx * corner.y);
  gl_Position = vec4(pp / (0.5 * uRes) * c.w, c.z, c.w);

  vec3 P = (corner.x < 0.5 ? A : B).xyz;
  vSpeed = speedRatio(P);
  vVort = vorticity(P);
  vSide = corner.y;
  vAge = 1.0 - ageF;          /* 0 at release, 1 at the end of life */
  vWorld = W;
  vTangent = T;
}
`;
}

export function ribbonFragmentShader(): string {
  return `${PREAMBLE}
${RAMP_GLSL}
in float vSide;
in float vAge;
in float vSpeed;
in float vVort;
in float vShrink;
in vec3 vWorld;
in vec3 vTangent;
uniform vec3 uCam;
uniform float uAlpha;
uniform float uSigma;      /* optical depth through the centre of a filament */
out vec4 oColor;

const vec3 KEY = vec3(-0.5199, 0.7091, 0.4759);

void main() {
  if (vSide > 2.0) discard;

  /*
   * The ribbon is a CYLINDER of smoke, not a flat strip. Opacity follows
   * Beer–Lambert along the chord the view ray cuts: full depth at the centre,
   * zero at the silhouette. That is a physical profile and it gives the soft
   * edge for free.
   */
  float s = clamp(vSide, -1.0, 1.0);
  float chord = sqrt(max(1.0 - s * s, 1e-4));
  float alpha = (1.0 - exp(-uSigma * chord)) * uAlpha * vShrink;

  /* A screen-space quad has no normal, so reconstruct the cylinder's: at
     across-coordinate s the visible surface faces s along the across-axis plus
     sqrt(1 − s²) toward the eye. */
  vec3 V = normalize(uCam - vWorld);
  vec3 T = normalize(vTangent);
  vec3 across = cross(T, V);
  across = length(across) > 1e-6 ? normalize(across) : vec3(0.0, 1.0, 0.0);
  vec3 toEye = normalize(cross(across, T));
  vec3 N = normalize(across * s + toEye * chord);

  /* Wrap lighting: a filament a centimetre across is optically thin, so the key
     lights the far side too. A Lambertian half-space renders the shadowed side
     black, which is what soot does and smoke does not. */
  float wrap = clamp((dot(N, KEY) + 0.7) / 1.7, 0.0, 1.0);
  vec3 col = flowTint(vSpeed, vVort, vAge) * (0.42 + 0.75 * wrap);

  /* Fade the oldest end so a filament dissolves instead of ending in a stub. */
  alpha *= smoothstep(1.0, 0.90, vAge);

  oColor = vec4(col * alpha, alpha);
}
`;
}

/** Mist: every tracer as an independent camera-facing dot. */
export function mistVertexShader(map: CellMap): string {
  return `${PREAMBLE}
${sectionGlsl(map)}
${FIELD_GLSL}
${DRAW_COMMON}
uniform float uDotM;       /* dot diameter in metres */
out vec2 vLocal;
out float vAge;
out float vSpeed;
out float vVort;
out float vShrink;
out float vAlive;
out float vEdge;

void main() {
  int id = gl_VertexID;
  int q = id / 6;
  vec2 corner = CORNER[id - q * 6] * 2.0 - vec2(1.0, 0.0);   /* -1..1 in x, ±1 in y */
  int nozzle = q / uSamples;
  int slot = q - nozzle * uSamples;

  vec4 P = texelFetch(uPos, ivec2(slot, nozzle), 0);
  vAlive = P.w;
  if (P.w < 0.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }

  vec3 W = cellToWorld(P.xyz);
  vec4 c = uViewProj * vec4(W, 1.0);
  if (c.w <= 1e-4) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); vAlive = 0.0; return; }

  /* Screen-space billboard, sized from a world diameter so it recedes. */
  vec3 V = normalize(uCam - W);
  vec3 up = abs(V.y) < 0.95 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0);
  vec3 across = normalize(cross(up, V));
  vec4 cOff = uViewProj * vec4(W + across * (uDotM * 0.5), 1.0);
  vec2 here = c.xy / c.w * 0.5 * uRes;
  float halfPx = (cOff.w > 1e-4) ? length(cOff.xy / cOff.w * 0.5 * uRes - here) : uMinHalfPx;
  float drawPx = max(halfPx, uMinHalfPx);
  vShrink = halfPx / drawPx;

  vec2 pp = here + corner * drawPx;
  gl_Position = vec4(pp / (0.5 * uRes) * c.w, c.z, c.w);

  vLocal = corner;
  vSpeed = speedRatio(P.xyz);
  vVort = vorticity(P.xyz);
  /* Tracers stop at the outlet and are held there until their slot is reborn,
     so without this they stack into a bright wall against the far face. */
  vEdge = 1.0 - smoothstep(0.84, 0.99, P.x / uGrid.x);
  /* Age from the ring position: how far this slot is behind the head. */
  int behind = (uHead - slot + uSamples) % uSamples;
  vAge = 1.0 - float(behind) / float(uSamples - 1);
}
`;
}

export function mistFragmentShader(): string {
  return `${PREAMBLE}
${RAMP_GLSL}
in vec2 vLocal;
in float vAge;
in float vSpeed;
in float vVort;
in float vShrink;
in float vAlive;
in float vEdge;
uniform float uAlpha;
out vec4 oColor;

void main() {
  if (vAlive < 0.5) discard;
  float r = length(vLocal);
  if (r > 1.0) discard;
  /* Gaussian-ish core so dots blend into a haze rather than tiling as discs. */
  float a = exp(-r * r * 2.6) * uAlpha * vShrink * vEdge;
  /* Fade in at release and out at the end, so the mist has no hard edges. */
  a *= smoothstep(0.0, 0.08, vAge) * smoothstep(1.0, 0.85, vAge);
  oColor = vec4(flowTint(vSpeed, vVort, vAge) * a, a);
}
`;
}

/** Vertices for a ribbon draw: six per segment, per filament. */
export const ribbonVertexCount = (nozzles: number) => nozzles * (SAMPLES - 1) * 6;
/** Vertices for a mist draw: six per tracer. */
export const mistVertexCount = (nozzles: number) => nozzles * SAMPLES * 6;

// --- the tracer field ------------------------------------------------------

import { Program, UNIT, makeFramebuffer, makeTexture } from './gl.ts';
import { MAX_NOZZLES, nozzleCount, rakeInCells, type RakeConfig } from './sources.ts';

export interface TracerHost {
  gl: WebGL2RenderingContext;
  map: CellMap;
  tilesX: number;
  tilesY: number;
  atlasW: number;
  atlasH: number;
  texField: WebGLTexture;
  texSolid: WebGLTexture;
  velocity: number;
}

/**
 * Positions, and the ring that ages them.
 *
 * The texture is allocated once at the maximum rake and used to whatever extent
 * the current rake asks for. Reallocating on every change of the source control
 * would drop the whole flow field each time the visitor nudged a slider, which
 * is the opposite of what a control should feel like.
 */
export class TracerField {
  private readonly gl: WebGL2RenderingContext;
  private readonly host: TracerHost;
  private readonly prog: Program;
  private readonly tex: WebGLTexture[] = [];
  private readonly fbo: WebGLFramebuffer[] = [];
  private front = 0;
  private headSlot = 0;
  private sinceBirth = 0;
  private resetPending = true;
  private rake: RakeConfig;
  private jitterCells = 0;

  constructor(host: TracerHost, rake: RakeConfig) {
    this.host = host;
    this.gl = host.gl;
    this.rake = rake;
    this.prog = new Program(host.gl, 'wt.tracers.update', FULLSCREEN_VS, updateShader());
    for (let i = 0; i < 2; i++) {
      const t = makeTexture(host.gl, SAMPLES, MAX_NOZZLES);
      this.tex.push(t);
      this.fbo.push(makeFramebuffer(host.gl, [t]));
    }
  }

  get positions(): WebGLTexture {
    return this.tex[this.front]!;
  }
  get head(): number {
    return this.headSlot;
  }
  get nozzles(): number {
    return nozzleCount(this.rake);
  }

  setRake(rake: RakeConfig): void {
    if (rake.rows === this.rake.rows && rake.cols === this.rake.cols) return;
    this.rake = rake;
    this.resetPending = true;
  }

  /** Mist scatters its tracers so the rake lattice does not read as stripes. */
  setJitter(cells: number): void {
    this.jitterCells = cells;
  }

  reset(): void {
    this.resetPending = true;
  }

  /**
   * Advances every tracer by the lattice steps elapsed, and births one if the
   * flow has carried far enough since the last.
   *
   * `uAdvect` is a count of **lattice steps**, not a distance. Velocity in
   * lattice units already means "cells per lattice step", so multiplying by the
   * velocity here as well scales transport by the velocity twice — which at
   * u = 0.09 moves the tracers about a tenth as far as the fluid and pins every
   * filament to its nozzle.
   */
  advance(steps: number): void {
    const { gl, host } = this;
    const { nx, ny, nz } = host.map;

    this.sinceBirth += steps * host.velocity;
    let head = -1;
    if (this.resetPending || this.sinceBirth >= spacing(host.map)) {
      this.sinceBirth = 0;
      this.headSlot = (this.headSlot + 1) % SAMPLES;
      head = this.headSlot;
    }

    const rake = rakeInCells(host.map);
    const back = 1 - this.front;

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[back]!);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, SAMPLES, MAX_NOZZLES);

    this.prog
      .use()
      .f3('uGrid', nx, ny, nz)
      .f2('uTiles', host.tilesX, host.tilesY)
      .f2('uAtlas', host.atlasW, host.atlasH)
      .f('uVelocity', host.velocity)
      .tex('uField', UNIT.FIELD, host.texField)
      .tex('uSolidTex', UNIT.SOLID, host.texSolid)
      .tex('uPos', UNIT.POS, this.tex[this.front]!)
      .f('uAdvect', steps)
      .i('uHead', head)
      .i('uSamples', SAMPLES)
      .f('uJitter', this.jitterCells)
      .f('uSeed', 17.23)
      .f2('uRake', this.rake.rows, this.rake.cols)
      .f3('uRakeO', rake.origin[0], rake.origin[1], rake.origin[2])
      .f3('uRakeU', rake.spanU[0], rake.spanU[1], rake.spanU[2])
      .f3('uRakeV', rake.spanV[0], rake.spanV[1], rake.spanV[2])
      .f('uReset', this.resetPending ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    this.front = back;
    this.resetPending = false;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  dispose(): void {
    for (const t of this.tex) this.gl.deleteTexture(t);
    for (const f of this.fbo) this.gl.deleteFramebuffer(f);
    this.prog.dispose();
  }
}
