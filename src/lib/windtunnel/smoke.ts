/**
 * The volume passes — smoke, and wake.
 *
 * ## Two pictures, one raymarch
 *
 * **Smoke** is a dye released at the rake and carried by the flow. It is a
 * genuine scalar field advected by the solver's own velocity, stored in the
 * same z-slice atlas as everything else. Semi-Lagrangian advection smears it,
 * which is exactly why it is here and not in `tracers.ts`: a filament wants to
 * stay a line, but a cloud that spreads is what fills a separated region and
 * shows you how big it is.
 *
 * **Wake** releases nothing. The wake indicator — how far below the free stream
 * the streamwise velocity has fallen — is a function of the velocity field the
 * solver already publishes, so it can be marched directly. It answers "how big
 * is the low-pressure hole the car drags along", which is where most of a
 * road car's drag comes from.
 *
 * Both are a front-to-back raymarch with Beer–Lambert accumulation, so they
 * share the pass and differ only in what they sample.
 *
 * ## Why advection runs once a frame, not once a step
 *
 * The tracers integrate over all the steps elapsed in one go, and the dye
 * should too. N interpolations of one step each is N chances to smear; one
 * interpolation of N steps is one. Semi-Lagrangian advection is unconditionally
 * stable, so the long step costs nothing in stability and buys a visibly
 * sharper cloud.
 */
import { FIELD_GLSL, RAMP_GLSL } from './flow.ts';
import { RAKE_GLSL } from './sources.ts';
import { PREAMBLE } from './shaders.ts';
import { sectionGlsl, type CellMap } from './section.ts';

/**
 * Dye advection: backtrace each cell along its own velocity and read what was
 * there, then re-seed at the nozzles.
 *
 * The dye carries two channels. `r` is density; `g` is age in units of a
 * filament lifetime, advected along with it so the age ramp has something to
 * colour. Age is *not* recoverable from density — a cell can be dense because
 * it was just seeded or because two old plumes met — so it has to ride along.
 */
export function dyeShader(): string {
  return `${PREAMBLE}
${FIELD_GLSL}
${RAKE_GLSL}
uniform sampler2D uDye;
uniform float uAdvect;      /* lattice steps of travel this frame */
uniform float uNozzleR;     /* seed radius in cells */
uniform float uDecay;       /* fraction retained per frame */
uniform float uReset;
out vec4 oDye;

void main() {
  int px = int(gl_FragCoord.x), py = int(gl_FragCoord.y);
  int tx = px / int(uGrid.x), ty = py / int(uGrid.y);
  vec3 c = vec3(float(px - tx*int(uGrid.x)),
                float(py - ty*int(uGrid.y)),
                float(ty*int(uTiles.x) + tx));

  if (uReset > 0.5) { oDye = vec4(0.0); return; }
  if (c.z > uGrid.z - 0.5) { oDye = vec4(0.0); return; }   /* unused atlas tile */
  if (inSolid(c)) { oDye = vec4(0.0); return; }

  /* Backtrace. One interpolation for the whole frame's travel. */
  vec3 src = c - velAt(c) * uAdvect;
  float fz = fract(src.z);
  vec4 d0 = texture(uDye, cellToUv(vec3(src.x, src.y, floor(src.z))));
  vec4 d1 = texture(uDye, cellToUv(vec3(src.x, src.y, floor(src.z) + 1.0)));
  vec2 carried = mix(d0.rg, d1.rg, fz);

  float dye = carried.r * uDecay;
  float age = min(carried.g + uAdvect * 0.004, 1.0);

  /*
   * Seed at the nozzles. A sphere of dye per nozzle rather than a full-width
   * curtain: a curtain gives every view ray metres of dye to cross, the render
   * saturates to an opaque slab, and the car vanishes behind it.
   *
   * The rake is one plane of cells, so the loop is skipped outright everywhere
   * else. Without that guard every cell in the atlas pays for every nozzle,
   * which is the whole grid times the whole rake, every frame, to change
   * nothing outside one slab.
   */
  if (abs(c.x - uRakeO.x) <= uNozzleR) {
    int n = int(uRake.x) * int(uRake.y);
    for (int i = 0; i < MAX_NOZZLES; i++) {
      if (i >= n) break;
      float r = length(c - nozzleByIndex(i));
      float hit = 1.0 - smoothstep(uNozzleR * 0.55, uNozzleR, r);
      if (hit > 0.0) { dye = max(dye, hit); age = min(age, 1.0 - hit); }
    }
  }

  oDye = vec4(dye, age, 0.0, 1.0);
}
`;
}

/**
 * The volume pass: smoke from the dye field, or wake from the velocity field.
 *
 * Stepping in metres rather than in fractions of the ray is deliberate. A
 * feature is a few cells across; a fixed step count spread over a ray whose
 * length changes with the camera cannot promise to stay under that, and thin
 * structures flicker in and out as you orbit.
 */
export function volumeShader(map: CellMap): string {
  return `${PREAMBLE}
${sectionGlsl(map)}
${FIELD_GLSL}
${RAMP_GLSL}
uniform sampler2D uDye;
uniform sampler2D uSceneDepth;
uniform vec2 uResolution;
uniform vec3 uCam;
uniform vec3 uTarget;
uniform float uDepthA;
uniform float uDepthB;
uniform float uGain;
uniform int uVolumeKind;    /* 0 dye, 1 wake */
in vec2 vUv;
out vec4 oColor;

bool boxHit(vec3 ro, vec3 rd, vec3 lo, vec3 hi, out float t0, out float t1) {
  vec3 inv = 1.0 / rd;
  vec3 a = (lo - ro) * inv, b = (hi - ro) * inv;
  vec3 tn = min(a, b), tf = max(a, b);
  t0 = max(max(tn.x, tn.y), tn.z);
  t1 = min(min(tf.x, tf.y), tf.z);
  return t1 > max(t0, 0.0);
}

/** Depth written by the scene pass, back to a distance along the ray. */
float sceneDistance(vec2 uv, float cosine) {
  float z = texture(uSceneDepth, uv).r * 2.0 - 1.0;
  float zc = uDepthB / max(z - uDepthA, -1e9);
  return zc / max(cosine, 1e-4);
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  ndc.x *= uResolution.x / uResolution.y;

  vec3 ro = uCam;
  vec3 fwd = normalize(uTarget - ro);
  vec3 right = normalize(cross(vec3(0.0,1.0,0.0), fwd));
  vec3 up = cross(fwd, right);
  vec3 rd = normalize(fwd*1.9 + right*ndc.x + up*ndc.y);

  float t0, t1;
  if (!boxHit(ro, rd, SEC_LO, SEC_HI, t0, t1)) { oColor = vec4(0.0); return; }

  /* Stop at whatever the scene already drew, so the volume is occluded by the
     car instead of hanging in front of it. */
  float tSolid = sceneDistance(vUv, dot(rd, fwd));
  float tIn = max(t0, 0.05);
  float tOut = min(t1, tSolid);
  if (tOut <= tIn) { oColor = vec4(0.0); return; }

  float dt = SEC_DX * 0.7;
  int steps = int(min((tOut - tIn) / dt, 384.0));
  float trans = 1.0;
  vec3 acc = vec3(0.0);

  for (int i = 0; i < 384; i++) {
    if (i >= steps) break;
    vec3 p = ro + rd * (tIn + dt * (float(i) + 0.5));
    vec3 c = worldToCell(p);
    if (outsideGrid(c)) continue;

    float density, age;
    if (uVolumeKind == 0) {
      vec2 d = mix(texture(uDye, cellToUv(vec3(c.x, c.y, floor(c.z)))).rg,
                   texture(uDye, cellToUv(vec3(c.x, c.y, floor(c.z) + 1.0))).rg,
                   fract(c.z));
      density = d.r;
      age = d.g;
    } else {
      density = wakeAmount(c);
      age = clamp(density, 0.0, 1.0);
    }
    if (density <= 0.004) continue;

    float a = clamp(density * uGain * dt, 0.0, 1.0);
    acc += trans * a * flowTint(speedRatio(c), vorticity(c), age);
    trans *= (1.0 - a);
    if (trans < 0.02) break;
  }

  /* Premultiplied, so the renderer can blend this over the scene directly. */
  oColor = vec4(acc, 1.0 - trans);
}
`;
}

// --- the dye field ---------------------------------------------------------

import { Program, UNIT, makeFramebuffer, makeTexture } from './gl.ts';
import { FULLSCREEN_VS } from './shaders.ts';
import { rakeInCells, type RakeConfig } from './sources.ts';

export interface DyeHost {
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
 * A scalar dye carried by the flow, in the same z-slice atlas as everything
 * else.
 *
 * `RG16F`, because it is sampled with linear filtering and because two channels
 * — density and age — are all it carries. Half-float filtering is core WebGL2;
 * filtering a 32-bit float texture needs an extension many devices lack.
 */
export class DyeField {
  private readonly gl: WebGL2RenderingContext;
  private readonly host: DyeHost;
  private readonly prog: Program;
  private readonly tex: WebGLTexture[] = [];
  private readonly fbo: WebGLFramebuffer[] = [];
  private front = 0;
  private resetPending = true;
  private rake: RakeConfig;

  constructor(host: DyeHost, rake: RakeConfig) {
    this.host = host;
    this.gl = host.gl;
    this.rake = rake;
    this.prog = new Program(host.gl, 'wt.dye', FULLSCREEN_VS, dyeShader());
    for (let i = 0; i < 2; i++) {
      const t = makeTexture(host.gl, host.atlasW, host.atlasH, {
        internal: host.gl.RG16F,
        format: host.gl.RG,
        filter: host.gl.LINEAR,
      });
      this.tex.push(t);
      this.fbo.push(makeFramebuffer(host.gl, [t]));
    }
  }

  get density(): WebGLTexture {
    return this.tex[this.front]!;
  }

  setRake(rake: RakeConfig): void {
    this.rake = rake;
  }

  reset(): void {
    this.resetPending = true;
  }

  /**
   * Advects by all the steps elapsed in one go.
   *
   * N interpolations of one step each is N chances to smear; one interpolation
   * of N steps is one. Semi-Lagrangian advection is unconditionally stable, so
   * the long step costs nothing in stability and buys a visibly sharper cloud.
   */
  advance(steps: number): void {
    const { gl, host } = this;
    const { nx, ny, nz } = host.map;
    const rake = rakeInCells(host.map);
    const back = 1 - this.front;

    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo[back]!);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, host.atlasW, host.atlasH);

    this.prog
      .use()
      .f3('uGrid', nx, ny, nz)
      .f2('uTiles', host.tilesX, host.tilesY)
      .f2('uAtlas', host.atlasW, host.atlasH)
      .f('uVelocity', host.velocity)
      .tex('uField', UNIT.FIELD, host.texField)
      .tex('uSolidTex', UNIT.SOLID, host.texSolid)
      .tex('uDye', UNIT.DYE, this.tex[this.front]!)
      .f('uAdvect', steps)
      .f('uNozzleR', Math.max(1.6, 0.16 / host.map.dx))
      .f('uDecay', 0.995)
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
