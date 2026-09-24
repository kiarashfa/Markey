/**
 * Shared plumbing for the seven axis route pairs.
 *
 * Fourteen route files that each re-derived their own term list would be
 * fourteen chances for one axis to quietly behave differently from the other
 * six. They all call these two functions instead, so a route file is a
 * declaration of which axis it is and nothing more.
 */
import { getBrands, getCars, type JoinedBrand } from './entries.ts';
import { axisConfig, buildTermViews, type AxisConfig, type TermView } from './taxonomy-views.ts';

export interface AxisData {
  config: AxisConfig;
  terms: TermView[];
  brandsById: Map<string, JoinedBrand>;
}

export async function loadAxis(axis: string): Promise<AxisData> {
  const config = axisConfig(axis);
  if (!config) {
    throw new Error(
      `Unknown taxonomy axis '${axis}'. The seven axes are fixed and listed in taxonomy-views.ts.`,
    );
  }
  const [cars, brands] = await Promise.all([getCars(), getBrands()]);
  return {
    config,
    terms: buildTermViews(axis, cars, brands),
    brandsById: new Map(brands.map((b) => [b.id, b])),
  };
}

/** `getStaticPaths` for an axis's `[slug].astro`. */
export async function axisTermPaths(axis: string) {
  const { config, terms, brandsById } = await loadAxis(axis);
  return terms.map((term) => ({
    params: { slug: term.id },
    props: { config, term, terms, brandsById },
  }));
}
