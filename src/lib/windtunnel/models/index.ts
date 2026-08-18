/**
 * The body-model registry.
 *
 * ## Adding a car
 *
 * You do not add a car here. Cars come from the content collections, and the
 * tunnel picks a model for one by its `bodyStyles` tags and stretches it onto
 * its published dimensions. A new car needs no code at all.
 *
 * ## Adding a model
 *
 * Write a module in this directory that exports a `BodyModel`, then add it to
 * `MODELS` below. Nothing else in the wind tunnel needs to change: the solver
 * asks the model what the fluid sees, the renderer asks it for GLSL, and the UI
 * asks it for a label and a caveat. That is the whole contract, and it is in
 * `types.ts`.
 *
 * The registry is ordered. `pickModel` returns the first model whose declared
 * body styles overlap the car's, so put more specific shapes before more
 * general ones, and keep a general one last as the fallback.
 */
import { coupeGt } from './coupeGt.ts';
import { fitModel } from './types.ts';
import type { BodyModel, ModelFit } from './types.ts';

export type { BodyModel, ModelFit, ModelSize } from './types.ts';
export { MATERIAL, NO_FIT, fitModel } from './types.ts';

/**
 * Every shape the tunnel can run, most specific first.
 *
 * There is one today. That is a real limit, not an oversight: a saloon, a hatch
 * and an SUV each need their own profile set to be worth having, and shipping a
 * coupé relabelled as an SUV would be worse than shipping neither. Until those
 * exist, `pickModel` returns the coupé for everything and the UI says which
 * shape it used, so the substitution is visible rather than implied.
 */
export const MODELS: readonly BodyModel[] = [coupeGt];

export const DEFAULT_MODEL = coupeGt;

export function modelById(id: string): BodyModel | undefined {
  return MODELS.find((m) => m.id === id);
}

const normalise = (s: string) => s.trim().toLowerCase();

/** The closest shape family to a car's body-style tags. */
export function pickModel(bodyStyles: readonly string[]): BodyModel {
  const tags = bodyStyles.map(normalise);
  for (const model of MODELS) {
    if (model.bodyStyles.some((b) => tags.includes(normalise(b)))) return model;
  }
  return DEFAULT_MODEL;
}

export interface ModelChoice {
  model: BodyModel;
  fit: ModelFit;
  /** True when this car's body style has no model of its own yet. */
  substituted: boolean;
}

/**
 * Everything the tunnel needs to know about the shape it is about to run:
 * which family, stretched by how much, and whether that family actually matches
 * what the car is.
 */
export function chooseModel(
  bodyStyles: readonly string[],
  dims: { lengthM: number | null; widthM: number | null; heightM: number | null },
): ModelChoice {
  const model = pickModel(bodyStyles);
  const tags = bodyStyles.map(normalise);
  const substituted = !model.bodyStyles.some((b) => tags.includes(normalise(b)));
  return { model, fit: fitModel(model, dims), substituted };
}
