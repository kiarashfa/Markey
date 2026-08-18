/**
 * What a body model has to provide.
 *
 * ## Why this interface exists
 *
 * The wind tunnel is not a feature of one car. It has to run for whichever cars
 * the encyclopedia decides to build a Test Drive page for, and adding the next
 * one must not mean editing the solver, the renderer, or the UI. So a model is
 * a self-contained thing that answers three questions, and nothing outside
 * `models/` knows how it answers them:
 *
 * 1. **What does the fluid see?** — `aeroSdf(dx)`, in world metres, built
 *    against the cell size, because which features are resolvable is a property
 *    of the grid rather than of the shape.
 * 2. **What does the camera see?** — `glsl()`, a chunk of GLSL defining
 *    `float bodySD(vec3 p, out int mat)` in the same metres.
 * 3. **How big is it?** — bounds, for ray rejection, and a canonical length,
 *    width and height so the shape can be **fitted** to a real car's published
 *    dimensions rather than every car being drawn the same size.
 *
 * ## Fitting, and its honest limit
 *
 * A model is a *shape family*, not a scan. Fitting stretches the canonical
 * shape onto a car's published length, width and height; it does not turn a GT
 * coupé into that manufacturer's GT coupé. The UI has to say so, and does.
 */
import type { BodySdf } from '../section.ts';

/** Canonical proportions of an unfitted model, in metres. */
export interface ModelSize {
  length: number;
  width: number;
  height: number;
}

/** Per-axis stretch applied to the canonical shape. 1 means unfitted. */
export interface ModelFit {
  x: number;
  y: number;
  z: number;
}

export const NO_FIT: ModelFit = { x: 1, y: 1, z: 1 };

export interface BodyModel {
  /** Stable id, used in URLs, the registry and the UI. */
  readonly id: string;
  /** Short human label, e.g. "GT coupé". */
  readonly label: string;
  /**
   * What this shape actually is, in one sentence, for the disclosure the UI
   * shows. It must not claim to be any particular car.
   */
  readonly note: string;
  /** Body-style tags this shape is a reasonable stand-in for. */
  readonly bodyStyles: readonly string[];
  readonly size: ModelSize;
  /** Loose bounds in canonical metres, for rejecting rays before marching. */
  readonly bounds: { lo: [number, number, number]; hi: [number, number, number] };

  /**
   * The shape the fluid is allowed to see, in world metres, at this cell size.
   *
   * Takes the fit so the rasterised body and the drawn body are the same
   * object — passing an unfitted SDF to the voxeliser and a fitted one to the
   * renderer is the exact mistake this signature is shaped to prevent.
   */
  aeroSdf(dxMetres: number, fit: ModelFit): BodySdf;

  /**
   * GLSL for the renderer. It must define, in fitted world metres:
   *
   * - `float bodySD(vec3 p, out int mat)` — distance and material id;
   * - `const vec3 BODY_LO, BODY_HI` — loose bounds, for rejecting rays;
   * - `const float BODY_PIVOT` — the x the body turns about when yawed.
   *
   * Anything else it needs it declares itself. Material ids are the shared set
   * below, so the renderer's shading code is written once.
   */
  glsl(fit: ModelFit): string;

  /**
   * Data for the model's profile texture, or null if it needs none.
   * Bound to the sampler named `uProfiles`.
   */
  bakeProfiles(): { data: Float32Array; width: number; height: number } | null;
}

/**
 * Material ids, shared across every model so the renderer's shading code is
 * written once. A model that has no chrome simply never returns 3.
 */
export const MATERIAL = {
  PAINT: 0,
  GLASS: 1,
  RUBBER: 2,
  CHROME: 3,
  MATTE: 4,
} as const;

/**
 * Fits a model to a car's published dimensions.
 *
 * Missing dimensions leave that axis unfitted rather than guessing, which is
 * the same rule the rest of the encyclopedia follows: an absent figure is a
 * gap, never an inference.
 *
 * The stretch is clamped. A shape family stretched past about a fifth stops
 * being the thing it was drawn as — the sections distort, the wheels go
 * elliptical, and the result is a worse stand-in than the unfitted shape. When
 * the clamp bites, the honest reading is that this car wants a different model,
 * not a more violent stretch of this one.
 */
export function fitModel(
  model: BodyModel,
  dims: { lengthM: number | null; widthM: number | null; heightM: number | null },
): ModelFit {
  const axis = (want: number | null, canonical: number) => {
    if (want === null || !(want > 0)) return 1;
    return Math.max(0.82, Math.min(1.18, want / canonical));
  };
  return {
    x: axis(dims.lengthM, model.size.length),
    y: axis(dims.heightM, model.size.height),
    z: axis(dims.widthM, model.size.width),
  };
}
