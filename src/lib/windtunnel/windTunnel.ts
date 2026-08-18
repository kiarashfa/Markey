/**
 * The wind tunnel, as one object.
 *
 * The Svelte component should own presentation and nothing else. It does not
 * know where the working section is, how large a cell is, how a body becomes a
 * solid mask, or which pass a flow mode needs — those live in `section.ts`,
 * `models/`, `solver.ts` and `renderer.ts` respectively, and the last time that
 * knowledge was spread across the UI the smoke drifted off the car.
 *
 * So this is the whole surface: build one, `step` it, `render` it, and change
 * settings on it. Everything else is an implementation detail of the modules
 * behind it.
 */
import { Renderer, QUALITY, type FlowOptions, type QualityId, type ViewOptions } from './renderer.ts';
import { isSupported } from './gl.ts';
import { Solver, suggestGrid, type SolverStats } from './solver.ts';
import { chooseModel, type BodyModel, type ModelChoice } from './models/index.ts';
import { DEFAULT_RAKE, defaultRakeFor, type RakeConfig } from './sources.ts';
import { makeCellMap, yawBody } from './section.ts';
import { FAN_PRESETS, fanById, type Fan } from './fans.ts';
import type { ColorModeId, FlowModeId } from './flow.ts';

export { QUALITY, isSupported };
export type { QualityId } from './renderer.ts';
export type { FlowModeId, ColorModeId } from './flow.ts';
export type { RakeConfig } from './sources.ts';

export interface TunnelDimensions {
  lengthM: number | null;
  widthM: number | null;
  heightM: number | null;
}

export interface TunnelOptions {
  bodyStyles: readonly string[];
  dimensions: TunnelDimensions;
  quality?: QualityId;
}

export interface TunnelSettings {
  flow: FlowModeId;
  color: ColorModeId;
  rake: RakeConfig;
  density: number;
  fans: readonly string[];
  yawDeg: number;
  showBox: boolean;
  quality: QualityId;
}

export const DEFAULT_SETTINGS: TunnelSettings = {
  flow: 'ribbon',
  color: 'speed',
  rake: DEFAULT_RAKE,
  density: 1,
  fans: [],
  yawDeg: 0,
  showBox: true,
  quality: 'high',
};

/**
 * Free stream and viscosity, chosen by running the solver rather than by taste.
 *
 * 0.09 lattice units is Mach 0.156 against the lattice speed of sound — inside
 * the range where the compressibility error of the standard equilibrium is
 * negligible, and fast enough that a filament crosses the section while someone
 * is still watching.
 *
 * The viscosity is what it is because of stability. It sets the relaxation rate
 * on its own — ω = 1/(3ν + ½) — and at ν = 0.0032, ω is 1.962, close enough to
 * the limit of 2 that this exact configuration went non-finite after about
 * three thousand steps. ν = 0.008 puts ω at 1.908 and survived twelve thousand.
 * The cost is Reynolds number: this runs at Re ≈ 250, so the wake is more
 * laminar and thicker than a real car's — one more reason the drag figure it
 * reports is a property of the shape at this scale and not of the car.
 */
const PHYSICS = { velocity: 0.09, viscosity: 0.008 } as const;

/** Steps spent behind the loading state so the first frame has a wake in it. */
const PRIME_STEPS = 500;

export class WindTunnel {
  readonly solver: Solver;
  readonly renderer: Renderer;
  readonly choice: ModelChoice;
  readonly model: BodyModel;

  private settings: TunnelSettings = { ...DEFAULT_SETTINGS };
  private pendingSteps = 0;
  private disposed = false;

  constructor(gl: WebGL2RenderingContext, options: TunnelOptions) {
    this.choice = chooseModel(options.bodyStyles, options.dimensions);
    this.model = this.choice.model;

    const grid = suggestGrid();
    this.solver = new Solver(gl, this.bodyAt(0, makeCellMap(grid).dx), grid, {
      ...PHYSICS,
      movingRoad: true,
      smagorinsky: true,
    });
    this.renderer = new Renderer(this.solver, gl, this.model, this.choice.fit, this.settings.rake);
    this.settings.quality = options.quality ?? 'high';
  }

  /**
   * The fitted body, yawed, in world metres — what both the fluid and the eye
   * see. The cell size is a parameter because the constructor needs it before
   * the solver exists to be asked.
   */
  private bodyAt(yawDeg: number, dx = this.solver.map.dx) {
    const sdf = this.model.aeroSdf(dx, this.choice.fit);
    const pivot = (this.model.size.length * this.choice.fit.x) / 2;
    return yawBody(sdf, (yawDeg * Math.PI) / 180, pivot);
  }

  // --- lifecycle -----------------------------------------------------------

  prime(): void {
    this.solver.prime(PRIME_STEPS);
    this.pendingSteps = 0;
  }

  /** Runs `n` lattice steps. The flow catches up once per frame, not per step. */
  step(n: number): void {
    for (let i = 0; i < n; i++) this.solver.step();
    this.pendingSteps += n;
  }

  /** Draws a frame, advancing whatever the current mode needs first. */
  render(view: Omit<ViewOptions, 'yaw' | 'showBox'>): void {
    if (this.disposed) return;
    this.renderer.advanceFlow(this.settings.flow, this.pendingSteps);
    this.pendingSteps = 0;

    const flow: FlowOptions = {
      mode: this.settings.flow,
      color: this.settings.color,
      density: this.settings.density,
    };
    this.renderer.render(
      {
        ...view,
        yaw: (this.settings.yawDeg * Math.PI) / 180,
        showBox: this.settings.showBox,
      },
      flow,
    );
  }

  /** Redraws without advancing anything — for when the visitor moves the camera. */
  redraw(view: Omit<ViewOptions, 'yaw' | 'showBox'>): void {
    if (this.disposed) return;
    this.renderer.render(
      {
        ...view,
        yaw: (this.settings.yawDeg * Math.PI) / 180,
        showBox: this.settings.showBox,
      },
      { mode: this.settings.flow, color: this.settings.color, density: this.settings.density },
    );
  }

  // --- settings ------------------------------------------------------------

  get current(): TunnelSettings {
    return this.settings;
  }

  /**
   * Applies a change.
   *
   * Yaw is the expensive one: it changes the shape the *fluid* sees, so the
   * body has to be rasterised again and the flow restarted. Turning the car and
   * leaving the lattice alone would show smoke flowing around a body that is no
   * longer there, which is a lie told convincingly. Everything else is a
   * uniform, so it takes effect on the next frame with no work at all.
   */
  update(patch: Partial<TunnelSettings>): void {
    const before = this.settings;
    const next = { ...before, ...patch };
    this.settings = next;

    if (patch.rake && (patch.rake.rows !== before.rake.rows || patch.rake.cols !== before.rake.cols)) {
      this.renderer.setRake(patch.rake);
    }
    if (patch.fans && patch.fans.join() !== before.fans.join()) {
      const fans = next.fans.map(fanById).filter((f): f is Fan => f !== undefined);
      this.solver.setFans(fans);
    }
    if (patch.yawDeg !== undefined && patch.yawDeg !== before.yawDeg) {
      this.solver.setBody(this.bodyAt(next.yawDeg));
      this.renderer.clearFlow();
      this.renderer.invalidateScene();
    }
    if (patch.showBox !== undefined && patch.showBox !== before.showBox) {
      this.renderer.invalidateScene();
    }
    if (patch.flow !== undefined && patch.flow !== before.flow) {
      /* Give the new mode a rake it can actually show, unless the caller asked
         for a specific one in the same breath. */
      if (patch.rake === undefined) {
        const rake = defaultRakeFor(patch.flow);
        this.settings = { ...this.settings, rake };
        this.renderer.setRake(rake);
      }
      /* Switching to a mode whose field has been sitting idle would show a
         stale picture for a second; clearing makes the transition honest. */
      this.renderer.clearFlow();
      this.renderer.invalidateScene();
    }
  }

  clearFlow(): void {
    this.renderer.clearFlow();
  }

  /** Device pixels for a CSS-pixel canvas, at the chosen quality. */
  bufferSize(cssWidth: number, cssHeight: number, dpr: number): { width: number; height: number } {
    const q = QUALITY[this.settings.quality];
    const s = Math.min(dpr, q.maxDpr) * q.scale;
    return {
      width: Math.max(1, Math.floor(cssWidth * s)),
      height: Math.max(1, Math.floor(cssHeight * s)),
    };
  }

  sampleForce(): void {
    this.solver.sampleForce();
  }

  stats(): SolverStats {
    return this.solver.stats();
  }

  get availableFans(): readonly Fan[] {
    return FAN_PRESETS;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.dispose();
    this.solver.dispose();
  }
}

