/**
 * Everything that draws.
 *
 * ## Shape of a frame
 *
 * | pass       | target                                  | when                 |
 * |------------|-----------------------------------------|----------------------|
 * | scene      | HDR colour + depth texture              | only when the view moved |
 * | copy       | the frame's colour, from the cached scene | every frame        |
 * | flow       | the frame, blended over the scene       | every frame          |
 * | composite  | the canvas, tonemapped                  | every frame          |
 *
 * **The scene is cached.** The car, the floor and the section box do not move
 * between frames; only the flow does. Raymarching a body with soft shadows and
 * a floor reflection costs tens of milliseconds at full resolution, and paying
 * it every frame to redraw an identical picture is the single most expensive
 * mistake this renderer could make. It is re-marched when the camera, the yaw,
 * the size or the pressure view changes, and replayed from a texture otherwise.
 *
 * ## Why two framebuffers over one colour texture
 *
 * The volume modes need to *read* the scene depth to know where the car is; the
 * tracer modes need to *depth-test* against it. A framebuffer cannot sample the
 * depth texture it has attached, so there are two: one with the depth
 * attachment for tracers, one without it for the volume. They share the colour
 * texture, so whichever ran, the composite finds the result in the same place.
 *
 * ## Why tonemapping is last
 *
 * The flow blends into an HDR target and the sum is tonemapped once. Blending
 * smoke into display values instead washes the ribbons out over the bright
 * parts of the body, because two things that are each 0.9 in display space are
 * not twice as bright as one of them.
 */
import { cameraView, type CameraView, type Vec3Like } from './camera.ts';
import { COMPOSITE_FS, sceneShader } from './sceneShaders.ts';
import { FULLSCREEN_VS } from './shaders.ts';
import { Program, UNIT, makeFramebuffer, makeTexture, setFiltering } from './gl.ts';
import { DyeField, volumeShader } from './smoke.ts';
import {
  TracerField,
  mistFragmentShader,
  mistVertexShader,
  mistVertexCount,
  ribbonFragmentShader,
  ribbonVertexShader,
  ribbonVertexCount,
} from './tracers.ts';
import { colorModeIndex, modeUsesDye, modeUsesTracers, modeUsesVolume } from './flow.ts';
import type { ColorModeId, FlowModeId } from './flow.ts';
import type { RakeConfig } from './sources.ts';
import type { Solver } from './solver.ts';
import type { BodyModel, ModelFit } from './models/index.ts';

export interface ViewOptions {
  width: number;
  height: number;
  camera: Vec3Like;
  target: Vec3Like;
  /** Body yaw in radians. Must match the yaw the body was rasterised with. */
  yaw: number;
  showBox: boolean;
}

export interface FlowOptions {
  mode: FlowModeId;
  color: ColorModeId;
  /** 0–1; scales filament thickness and volume opacity. */
  density: number;
}

/** Quality presets, which the visitor picks and the renderer obeys. */
export const QUALITY = {
  low: { label: 'Low', scale: 0.6, maxDpr: 1.0 },
  medium: { label: 'Medium', scale: 0.85, maxDpr: 1.35 },
  high: { label: 'High', scale: 1.0, maxDpr: 1.75 },
} as const;

export type QualityId = keyof typeof QUALITY;

export class Renderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly solver: Solver;
  private readonly vao: WebGLVertexArrayObject;

  private readonly progScene: Program;
  private readonly progComposite: Program;
  private readonly progVolume: Program;
  private readonly progRibbon: Program;
  private readonly progMist: Program;

  private readonly texProfiles: WebGLTexture | null = null;
  readonly tracers: TracerField;
  readonly dye: DyeField;

  private texScene: WebGLTexture | null = null;
  private texFrame: WebGLTexture | null = null;
  private texDepth: WebGLTexture | null = null;
  private fboScene: WebGLFramebuffer | null = null;
  private fboFrameDepth: WebGLFramebuffer | null = null;
  private fboFrameFlat: WebGLFramebuffer | null = null;
  private width = 0;
  private height = 0;
  private sceneKey = '';
  private disposed = false;

  constructor(
    solver: Solver,
    gl: WebGL2RenderingContext,
    model: BodyModel,
    fit: ModelFit,
    rake: RakeConfig,
  ) {
    this.gl = gl;
    this.solver = solver;
    this.vao = gl.createVertexArray()!;

    const map = solver.map;
    this.progScene = new Program(gl, 'wt.scene', FULLSCREEN_VS, sceneShader(map, model, fit));
    this.progComposite = new Program(gl, 'wt.composite', FULLSCREEN_VS, COMPOSITE_FS);
    this.progVolume = new Program(gl, 'wt.volume', FULLSCREEN_VS, volumeShader(map));
    this.progRibbon = new Program(
      gl, 'wt.ribbon', ribbonVertexShader(map), ribbonFragmentShader(),
    );
    this.progMist = new Program(gl, 'wt.mist', mistVertexShader(map), mistFragmentShader());

    const profiles = model.bakeProfiles();
    if (profiles) {
      this.texProfiles = gl.createTexture()!;
      gl.bindTexture(gl.TEXTURE_2D, this.texProfiles);
      gl.texImage2D(
        gl.TEXTURE_2D, 0, gl.RGBA16F, profiles.width, profiles.height, 0,
        gl.RGBA, gl.FLOAT, profiles.data,
      );
      setFiltering(gl, gl.LINEAR);
    }

    const host = {
      gl,
      map,
      tilesX: solver.tilesX,
      tilesY: solver.tilesY,
      atlasW: solver.atlasW,
      atlasH: solver.atlasH,
      texField: solver.texField,
      texSolid: solver.texSolid,
      velocity: solver.velocity,
    };
    this.tracers = new TracerField(host, rake);
    this.dye = new DyeField(host, rake);
  }

  // --- state the visitor changes -------------------------------------------

  setRake(rake: RakeConfig): void {
    this.tracers.setRake(rake);
    this.dye.setRake(rake);
  }

  /** Forces the cached scene to be re-marched on the next frame. */
  invalidateScene(): void {
    this.sceneKey = '';
  }

  clearFlow(): void {
    this.tracers.reset();
    this.dye.reset();
  }

  /**
   * Advances only what the current mode actually draws.
   *
   * Advecting the dye while the visitor is looking at ribbons is a full extra
   * pass over the whole atlas, every frame, to update a texture nothing reads.
   */
  advanceFlow(mode: FlowModeId, steps: number): void {
    if (steps <= 0) return;
    if (modeUsesTracers(mode)) {
      this.tracers.setJitter(mode === 'mist' ? 1.4 : 0);
      this.tracers.advance(steps);
    }
    if (modeUsesDye(mode)) this.dye.advance(steps);
  }

  // --- targets -------------------------------------------------------------

  private ensureTargets(w: number, h: number) {
    if (this.fboScene && this.width === w && this.height === h) return;
    const gl = this.gl;
    for (const t of [this.texScene, this.texFrame, this.texDepth]) if (t) gl.deleteTexture(t);
    for (const f of [this.fboScene, this.fboFrameDepth, this.fboFrameFlat]) {
      if (f) gl.deleteFramebuffer(f);
    }

    const colour = () =>
      makeTexture(gl, w, h, { internal: gl.RGBA16F, filter: gl.LINEAR });
    this.texScene = colour();
    this.texFrame = colour();

    /* A depth *texture*, not a renderbuffer: the volume pass has to read it to
       know where the car is. */
    this.texDepth = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.texDepth);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, w, h, 0,
      gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null,
    );
    setFiltering(gl, gl.NEAREST);

    const withDepth = (tex: WebGLTexture) => {
      const fbo = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.texDepth, 0);
      const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Scene framebuffer is incomplete (0x${status.toString(16)}).`);
      }
      return fbo;
    };
    this.fboScene = withDepth(this.texScene);
    this.fboFrameDepth = withDepth(this.texFrame);
    this.fboFrameFlat = makeFramebuffer(gl, [this.texFrame]);

    this.width = w;
    this.height = h;
    this.sceneKey = '';
  }

  // --- the frame -----------------------------------------------------------

  render(view: ViewOptions, flow: FlowOptions): void {
    if (this.disposed || view.width < 1 || view.height < 1) return;
    const gl = this.gl;
    const aspect = view.width / view.height;
    const cam = cameraView(view.camera, view.target, aspect);

    this.ensureTargets(view.width, view.height);
    gl.bindVertexArray(this.vao);

    this.drawScene(view, cam, flow.mode === 'pressure');
    this.copySceneIntoFrame(view);

    if (modeUsesVolume(flow.mode)) this.drawVolume(view, cam, flow);
    else if (modeUsesTracers(flow.mode)) this.drawTracers(view, cam, flow);

    // --- composite to the canvas ------------------------------------------
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, view.width, view.height);
    this.progComposite.use().f('uTonemap', 1).tex('uScene', UNIT.SCENE, this.texFrame!);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private drawScene(view: ViewOptions, cam: CameraView, pressure: boolean) {
    const gl = this.gl;
    const key = [
      view.width, view.height,
      view.camera.x, view.camera.y, view.camera.z,
      view.target.x, view.target.y, view.target.z,
      view.yaw, view.showBox ? 1 : 0, pressure ? 1 : 0,
      /* The pressure view paints the body from the live field, so it is not a
         static picture and cannot be cached across steps. */
      pressure ? this.solver.stats().steps : 0,
    ].join(',');
    if (key === this.sceneKey) return;
    this.sceneKey = key;

    const solver = this.solver;
    const { nx, ny, nz } = solver.map;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboScene);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, view.width, view.height);
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.ALWAYS);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const p = this.progScene
      .use()
      .f3('uGrid', nx, ny, nz)
      .f2('uTiles', solver.tilesX, solver.tilesY)
      .f2('uAtlas', solver.atlasW, solver.atlasH)
      .f('uVelocity', solver.velocity)
      .f2('uResolution', view.width, view.height)
      .f3('uCam', view.camera.x, view.camera.y, view.camera.z)
      .f3('uTarget', view.target.x, view.target.y, view.target.z)
      .f('uYaw', view.yaw)
      .f('uShowBox', view.showBox ? 1 : 0)
      .f('uPressure', pressure ? 1 : 0)
      .f('uDepthA', cam.depthA)
      .f('uDepthB', cam.depthB)
      .tex('uField', UNIT.FIELD, solver.texField)
      .tex('uSolidTex', UNIT.SOLID, solver.texSolid);
    if (this.texProfiles) p.tex('uProfiles', UNIT.PROFILES, this.texProfiles);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private copySceneIntoFrame(view: ViewOptions) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFrameFlat);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, view.width, view.height);
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    this.progComposite.use().f('uTonemap', 0).tex('uScene', UNIT.SCENE, this.texScene!);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private drawVolume(view: ViewOptions, cam: CameraView, flow: FlowOptions) {
    const gl = this.gl;
    const solver = this.solver;
    const { nx, ny, nz } = solver.map;

    /* No depth attachment here: the pass samples the depth texture, and a
       framebuffer may not read the attachment it is bound to. */
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFrameFlat);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, view.width, view.height);
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.progVolume
      .use()
      .f3('uGrid', nx, ny, nz)
      .f2('uTiles', solver.tilesX, solver.tilesY)
      .f2('uAtlas', solver.atlasW, solver.atlasH)
      .f('uVelocity', solver.velocity)
      .f2('uResolution', view.width, view.height)
      .f3('uCam', view.camera.x, view.camera.y, view.camera.z)
      .f3('uTarget', view.target.x, view.target.y, view.target.z)
      .f('uDepthA', cam.depthA)
      .f('uDepthB', cam.depthB)
      .f('uGain', (flow.mode === 'wake' ? 2.1 : 5.4) * flow.density)
      .i('uVolumeKind', flow.mode === 'wake' ? 1 : 0)
      .i('uColorMode', colorModeIndex(flow.color))
      .tex('uField', UNIT.FIELD, solver.texField)
      .tex('uSolidTex', UNIT.SOLID, solver.texSolid)
      .tex('uDye', UNIT.DYE, this.dye.density)
      .tex('uSceneDepth', UNIT.DEPTH, this.texDepth!);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.BLEND);
  }

  private drawTracers(view: ViewOptions, cam: CameraView, flow: FlowOptions) {
    const gl = this.gl;
    const solver = this.solver;
    const { nx, ny, nz } = solver.map;
    const mist = flow.mode === 'mist';
    const nozzles = this.tracers.nozzles;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fboFrameDepth);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, view.width, view.height);
    /*
     * Depth-tested but not depth-writing. Writing would make filaments occlude
     * each other in draw order rather than in depth order, and a filament is
     * translucent — the far one has to show through the near one.
     */
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    /* Premultiplied alpha: the fragment shader emits colour already scaled by
       coverage, so overlapping filaments accumulate without darkening. */
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const p = (mist ? this.progMist : this.progRibbon)
      .use()
      .f3('uGrid', nx, ny, nz)
      .f2('uTiles', solver.tilesX, solver.tilesY)
      .f2('uAtlas', solver.atlasW, solver.atlasH)
      .f('uVelocity', solver.velocity)
      .f2('uRes', view.width, view.height)
      .f3('uCam', view.camera.x, view.camera.y, view.camera.z)
      .f('uMinHalfPx', 0.7)
      .i('uHead', this.tracers.head)
      .i('uSamples', 96)
      .i('uColorMode', colorModeIndex(flow.color))
      .mat4('uViewProj', cam.viewProj)
      .tex('uField', UNIT.FIELD, solver.texField)
      .tex('uSolidTex', UNIT.SOLID, solver.texSolid)
      .tex('uPos', UNIT.POS, this.tracers.positions);

    if (mist) {
      p.f('uDotM', 0.055).f('uAlpha', 0.30 * flow.density);
      gl.drawArrays(gl.TRIANGLES, 0, mistVertexCount(nozzles));
    } else {
      p.f('uWidthM', 0.022 * (0.6 + 0.8 * flow.density))
        .f('uSpread', 1.6)
        .f('uAlpha', 0.8)
        .f('uSigma', 2.0);
      gl.drawArrays(gl.TRIANGLES, 0, ribbonVertexCount(nozzles));
    }
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const gl = this.gl;
    this.tracers.dispose();
    this.dye.dispose();
    for (const t of [this.texScene, this.texFrame, this.texDepth, this.texProfiles]) {
      if (t) gl.deleteTexture(t);
    }
    for (const f of [this.fboScene, this.fboFrameDepth, this.fboFrameFlat]) {
      if (f) gl.deleteFramebuffer(f);
    }
    for (const p of [
      this.progScene, this.progComposite, this.progVolume, this.progRibbon, this.progMist,
    ]) {
      p.dispose();
    }
    gl.deleteVertexArray(this.vao);
  }
}
