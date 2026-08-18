/**
 * The lattice-Boltzmann solver. Physics only — it draws nothing.
 *
 * ## Shape of a step
 *
 * Three draws, each with a fixed source and a fixed destination:
 *
 * | pass    | reads   | writes                      |
 * |---------|---------|-----------------------------|
 * | collide | `state` | `post`                      |
 * | stream  | `post`  | `state` + the force target  |
 * | field   | `state` | the decoded field atlas     |
 *
 * There is deliberately **no A/B ping-pong flag** for the distributions. The
 * two passes already alternate the roles, so a flag would only ever have one
 * value — and the version that had one grew two force framebuffers, of which
 * exactly one had the force texture attached, so drag silently read zero on
 * half the code paths. Fixed roles make that class of bug unrepresentable.
 *
 * ## What it publishes
 *
 * One `RGBA16F` atlas of `(ux, uy, uz, δρ)` and one solid mask. Everything that
 * draws — tracers, dye, the volume march, the pressure view — reads those and
 * never touches the distributions. That is the whole interface, and it is why
 * adding a flow mode does not mean touching this file.
 */
import { omegaFromNu, trtOmegaMinus } from './lattice.ts';
import { COLLIDE_FS, FIELD_FS, FULLSCREEN_VS, REDUCE_FS, STREAM_FS } from './shaders.ts';
import { MAX_FANS, type Fan } from './fans.ts';
import { Program, UNIT, makeFramebuffer, makeTexture, setFiltering } from './gl.ts';
import { makeCellMap, sectionGrid, voxeliseSection } from './section.ts';
import type { BodySdf, CellMap, Grid } from './section.ts';

export interface SolverConfig {
  /** Free-stream velocity in lattice units. Must stay well below the Mach limit. */
  velocity: number;
  /** Kinematic viscosity in lattice units. */
  viscosity: number;
  movingRoad?: boolean;
  smagorinsky?: boolean;
}

export interface SolverStats {
  steps: number;
  /** Streamwise force in lattice units, time-averaged over recent samples. */
  force: number;
  cd: number | null;
  frontalAreaCells: number;
  reynolds: number;
  /** Metres per lattice cell — the resolution limit, stated in real units. */
  cellSizeM: number;
  /** True once the field went non-finite. Report nothing from a diverged run. */
  diverged: boolean;
  /** True while any auxiliary fan is running, which changes what drag means. */
  disturbed: boolean;
}

/**
 * Grid sized to the device — a phone must not be handed a desktop lattice.
 *
 * One number chooses the grid, because `sectionGrid` fixes the other two and
 * that is what keeps cells cubic. The tiers are transverse cell counts, so the
 * cell size they imply is 3.2/n metres: 100 mm and 80 mm.
 *
 * The tiers are deliberately modest. An earlier version went to 192 × 64 × 64
 * whenever `hardwareConcurrency` was high, on the theory that a machine with
 * many cores has a good GPU. It does not follow: the machine this was tuned on
 * reports twenty cores and renders on integrated Intel graphics, where that
 * lattice costs 4 ms a step and the tunnel crawls. **Core count says nothing
 * about the GPU**, and there is no honest way to ask, so the sane default is a
 * grid any WebGL2 device can run and a step budget the visitor controls.
 */
export function suggestGrid(): Grid {
  if (typeof navigator === 'undefined') return sectionGrid(32);
  const mobile = window.matchMedia('(max-width: 767px)').matches;
  const cores = navigator.hardwareConcurrency ?? 4;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  if (mobile || cores <= 4 || memory <= 4) return sectionGrid(32);
  return sectionGrid(40);
}

export class Solver {
  readonly map: CellMap;
  readonly tilesX: number;
  readonly tilesY: number;
  readonly atlasW: number;
  readonly atlasH: number;

  /** The decoded macroscopic field, `(ux, uy, uz, δρ)`. Filtered. */
  readonly texField: WebGLTexture;
  /** The solid mask, 1 inside the body. Point-sampled. */
  readonly texSolid: WebGLTexture;

  private readonly gl: WebGL2RenderingContext;
  private readonly cfg: Required<SolverConfig>;

  private readonly progCollide: Program;
  private readonly progStream: Program;
  private readonly progField: Program;
  private readonly progReduce: Program;

  /** Current distributions. Read by collide, written by stream. */
  private readonly state: WebGLTexture[] = [];
  /** Post-collision distributions. Written by collide, read by stream. */
  private readonly post: WebGLTexture[] = [];
  private readonly texForce: WebGLTexture;

  private readonly fboPost: WebGLFramebuffer;
  private readonly fboState: WebGLFramebuffer;
  private readonly fboField: WebGLFramebuffer;
  private readonly reduceChain: {
    tex: WebGLTexture;
    fbo: WebGLFramebuffer;
    w: number;
    h: number;
  }[] = [];
  private readonly vao: WebGLVertexArrayObject;

  private fans: Fan[] = [];
  private fanPos = new Float32Array(MAX_FANS * 4);
  private fanDir = new Float32Array(MAX_FANS * 4);

  private stepCount = 0;
  private forceSamples: number[] = [];
  private frontalAreaCells = 0;
  private diverged = false;
  private disposed = false;

  constructor(gl: WebGL2RenderingContext, body: BodySdf, grid: Grid, config: SolverConfig) {
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('EXT_color_buffer_float is required for the wind tunnel.');
    }

    this.gl = gl;
    this.cfg = { movingRoad: true, smagorinsky: true, ...config };
    this.map = makeCellMap(grid);

    const { nx, ny, nz } = this.map;
    this.tilesX = Math.ceil(Math.sqrt(nz));
    this.tilesY = Math.ceil(nz / this.tilesX);
    this.atlasW = nx * this.tilesX;
    this.atlasH = ny * this.tilesY;

    const maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (this.atlasW > maxTex || this.atlasH > maxTex) {
      throw new Error(
        `The lattice needs a ${this.atlasW}x${this.atlasH} atlas; this device caps textures at ${maxTex}.`,
      );
    }

    this.progCollide = new Program(gl, 'wt.collide', FULLSCREEN_VS, COLLIDE_FS);
    this.progStream = new Program(gl, 'wt.stream', FULLSCREEN_VS, STREAM_FS);
    this.progField = new Program(gl, 'wt.field', FULLSCREEN_VS, FIELD_FS);
    this.progReduce = new Program(gl, 'wt.reduce', FULLSCREEN_VS, REDUCE_FS);

    this.vao = gl.createVertexArray()!;

    const seed = this.seedEquilibrium();
    for (let t = 0; t < 5; t++) {
      this.state.push(makeTexture(gl, this.atlasW, this.atlasH, { data: seed[t]! }));
      this.post.push(makeTexture(gl, this.atlasW, this.atlasH, { data: seed[t]! }));
    }
    this.texForce = makeTexture(gl, this.atlasW, this.atlasH);
    this.texSolid = makeTexture(gl, this.atlasW, this.atlasH);
    this.texField = makeTexture(gl, this.atlasW, this.atlasH, {
      internal: gl.RGBA16F,
      filter: gl.LINEAR,
    });

    this.fboPost = makeFramebuffer(gl, this.post);
    this.fboState = makeFramebuffer(gl, [...this.state, this.texForce]);
    this.fboField = makeFramebuffer(gl, [this.texField]);
    this.buildReduceChain();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.setBody(body);
  }

  // --- construction helpers ------------------------------------------------

  /** Distributions at the inlet condition, in deviation form, packed 4-per-target. */
  private seedEquilibrium(): Float32Array[] {
    const { velocity } = this.cfg;
    const usq = 1.5 * velocity * velocity;
    // prettier-ignore
    const dirs = [
      [0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
      [1, 1, 0], [-1, -1, 0], [1, -1, 0], [-1, 1, 0], [1, 0, 1], [-1, 0, -1],
      [1, 0, -1], [-1, 0, 1], [0, 1, 1], [0, -1, -1], [0, 1, -1], [0, -1, 1],
    ];
    const w = [1 / 3, ...Array(6).fill(1 / 18), ...Array(12).fill(1 / 36)];
    const geq = dirs.map((c, i) => {
      const cu = c[0]! * velocity;
      return w[i]! * (3 * cu + 4.5 * cu * cu - usq);
    });

    const texels = this.atlasW * this.atlasH;
    const targets = Array.from({ length: 5 }, () => new Float32Array(texels * 4));
    for (let i = 0; i < 19; i++) {
      const target = targets[i >> 2]!;
      const component = i & 3;
      const value = geq[i]!;
      for (let px = 0; px < texels; px++) target[px * 4 + component] = value;
    }
    return targets;
  }

  private buildReduceChain() {
    let w = this.atlasW;
    let h = this.atlasH;
    while (w > 8 || h > 8) {
      w = Math.max(1, Math.ceil(w / 4));
      h = Math.max(1, Math.ceil(h / 4));
      const tex = makeTexture(this.gl, w, h);
      this.reduceChain.push({ tex, fbo: makeFramebuffer(this.gl, [tex]), w, h });
    }
  }

  // --- body and fans -------------------------------------------------------

  /**
   * Rasterises a body given in world metres and uploads the solid mask.
   *
   * Separate from the constructor because the yaw control changes the shape the
   * *fluid* sees, not only the shape the camera sees. Turning the car and
   * leaving the lattice alone would show smoke flowing around a body that is no
   * longer there, which is a lie told convincingly.
   */
  setBody(body: BodySdf): void {
    const gl = this.gl;
    const { nx, ny, nz } = this.map;
    const { solid, frontalAreaCells } = voxeliseSection(this.map, body);
    this.frontalAreaCells = frontalAreaCells;
    this.forceSamples = [];

    const data = new Float32Array(this.atlasW * this.atlasH * 4);
    for (let z = 0; z < nz; z++) {
      const tx = z % this.tilesX;
      const ty = Math.floor(z / this.tilesX);
      for (let y = 0; y < ny; y++) {
        const src = (z * ny + y) * nx;
        const dst = ((ty * ny + y) * this.atlasW + tx * nx) * 4;
        for (let x = 0; x < nx; x++) data[dst + x * 4] = solid[src + x]!;
      }
    }

    gl.bindTexture(gl.TEXTURE_2D, this.texSolid);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA32F, this.atlasW, this.atlasH, 0, gl.RGBA, gl.FLOAT, data,
    );
    setFiltering(gl, gl.NEAREST);
  }

  /**
   * Sets the auxiliary fans, converting metres to cells once here rather than
   * per fragment.
   *
   * Changing them resets the force average: the drag before and after are
   * measurements of two different situations, and averaging across the change
   * would report a number that was never true of either.
   */
  setFans(fans: readonly Fan[]): void {
    this.fans = fans.slice(0, MAX_FANS);
    const m = this.map;
    this.fanPos = new Float32Array(MAX_FANS * 4);
    this.fanDir = new Float32Array(MAX_FANS * 4);
    this.fans.forEach((f, i) => {
      this.fanPos[i * 4] = (f.at[0] - m.xInlet) / m.dx - 0.5;
      this.fanPos[i * 4 + 1] = f.at[1] / m.dx - 0.5;
      this.fanPos[i * 4 + 2] = (f.at[2] - m.zMin) / m.dx - 0.5;
      this.fanPos[i * 4 + 3] = f.radius / m.dx;
      const len = Math.hypot(...f.dir) || 1;
      this.fanDir[i * 4] = f.dir[0] / len;
      this.fanDir[i * 4 + 1] = f.dir[1] / len;
      this.fanDir[i * 4 + 2] = f.dir[2] / len;
      this.fanDir[i * 4 + 3] = f.strength * this.cfg.velocity;
    });
    this.forceSamples = [];
  }

  // --- simulation ----------------------------------------------------------

  /** One lattice time step: collide, stream, decode the field. */
  step(): void {
    if (this.disposed || this.diverged) return;
    const gl = this.gl;
    const { nx, ny, nz } = this.map;

    gl.bindVertexArray(this.vao);
    gl.viewport(0, 0, this.atlasW, this.atlasH);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    const five = [0, 1, 2, 3, 4].map((i) => gl.COLOR_ATTACHMENT0 + i);

    const common = (p: Program, sources: WebGLTexture[]) => {
      p.use()
        .f3('uGrid', nx, ny, nz)
        .f2('uTiles', this.tilesX, this.tilesY)
        .f2('uAtlas', this.atlasW, this.atlasH);
      for (let i = 0; i < 5; i++) p.tex(`uG${i}`, i, sources[i]!);
      p.tex('uSolid', UNIT.SOLID, this.texSolid);
      return p;
    };

    // --- collide: state -> post -------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboPost);
    gl.drawBuffers(five);
    const omegaPlus = omegaFromNu(this.cfg.viscosity);
    common(this.progCollide, this.state)
      .f('uOmegaPlus', omegaPlus)
      .f('uOmegaMinus', trtOmegaMinus(omegaPlus))
      .f('uSmagorinsky', this.cfg.smagorinsky ? 1 : 0)
      .i('uFanCount', this.fans.length)
      .f4v('uFanPos[0]', this.fanPos)
      .f4v('uFanDir[0]', this.fanDir);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- stream: post -> state, plus the force target ----------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboState);
    gl.drawBuffers([...five, gl.COLOR_ATTACHMENT0 + 5]);
    common(this.progStream, this.post)
      .f('uVelocity', this.cfg.velocity)
      .f('uMovingRoad', this.cfg.movingRoad ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // --- field: state -> the atlas everything downstream reads -------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboField);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    common(this.progField, this.state);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.stepCount++;
  }

  /**
   * Runs the lattice forward before the first frame is shown.
   *
   * From a uniform initial field the first few hundred steps are the flow
   * discovering the body: there is no wake, no separation, nothing to look at.
   * Fast-forwarding through that is not a shortcut — the steps are real steps —
   * it just spends them while the loading state is up rather than making the
   * visitor watch an empty tunnel develop.
   */
  prime(steps: number): void {
    for (let i = 0; i < steps; i++) this.step();
  }

  /** Sums the force target. Called occasionally — a readback stalls the pipe. */
  sampleForce(): void {
    if (this.disposed || this.diverged) return;
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    this.progReduce.use();

    let srcTex = this.texForce;
    let srcW = this.atlasW;
    let srcH = this.atlasH;

    for (const level of this.reduceChain) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, level.fbo);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, level.w, level.h);
      this.progReduce.tex('uSrc', UNIT.G0, srcTex).f2('uSrcSize', srcW, srcH);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      srcTex = level.tex;
      srcW = level.w;
      srcH = level.h;
    }

    const last = this.reduceChain[this.reduceChain.length - 1];
    if (!last) return;
    const pixels = new Float32Array(last.w * last.h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, last.fbo);
    gl.readPixels(0, 0, last.w, last.h, gl.RGBA, gl.FLOAT, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    let sum = 0;
    for (let i = 0; i < pixels.length; i += 4) sum += pixels[i]!;

    /*
     * A lattice-Boltzmann run at an over-relaxed omega can go non-finite, and
     * when it does the whole field is NaN within a few hundred steps. An earlier
     * version simply declined to record a non-finite sample, which left the last
     * good average on screen next to a picture of nothing — a stale number
     * presented as a live one. Latch it instead, and let the UI say so.
     */
    if (!Number.isFinite(sum)) {
      this.diverged = true;
      return;
    }
    this.forceSamples.push(sum);
    if (this.forceSamples.length > 30) this.forceSamples.shift();
  }

  stats(): SolverStats {
    const force =
      this.forceSamples.length > 0
        ? this.forceSamples.reduce((a, b) => a + b, 0) / this.forceSamples.length
        : NaN;
    const { velocity } = this.cfg;
    const cd =
      !this.diverged && Number.isFinite(force) && this.frontalAreaCells > 0 && velocity > 0
        ? (2 * force) / (velocity * velocity * this.frontalAreaCells)
        : null;
    const diameter = 2 * Math.sqrt(this.frontalAreaCells / Math.PI);
    return {
      steps: this.stepCount,
      force,
      cd,
      frontalAreaCells: this.frontalAreaCells,
      reynolds: (velocity * diameter) / this.cfg.viscosity,
      cellSizeM: this.map.dx,
      diverged: this.diverged,
      disturbed: this.fans.length > 0,
    };
  }

  get velocity(): number {
    return this.cfg.velocity;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    for (const t of [
      ...this.state, ...this.post, this.texForce, this.texSolid, this.texField,
      ...this.reduceChain.map((l) => l.tex),
    ]) {
      gl.deleteTexture(t);
    }
    for (const f of [
      this.fboPost, this.fboState, this.fboField, ...this.reduceChain.map((l) => l.fbo),
    ]) {
      gl.deleteFramebuffer(f);
    }
    for (const p of [this.progCollide, this.progStream, this.progField, this.progReduce]) {
      p.dispose();
    }
    gl.deleteVertexArray(this.vao);
  }
}
