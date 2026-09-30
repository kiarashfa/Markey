/**
 * The seven taxonomy axes as computed views.
 *
 * Taxonomy pages own no content. Each one is derived at build time from tagged
 * entries, which is what makes re-tagging safe: nothing "lives" at
 * `/body-style/coupe/`, so nothing breaks when a car stops being tagged that
 * way. Two axes are never authored at all — Origin resolves through the
 * brand's country, Era is computed from production years.
 *
 * **Views list generations and halo trims, not model hubs.** Those are the
 * entries that carry the tags, and they are also what a search
 * like "1980s coupé" wants to land on — a hub spanning forty years and three
 * body styles is the wrong answer to a specific query. Hubs stay reachable
 * one breadcrumb up.
 */
import {
  bodyStyles,
  drivetrains,
  eras,
  positioning,
  powertrains,
  segments,
  type VocabTerm,
} from '../../schemas/taxonomy.ts';
import { erasFor, type JoinedBrand, type JoinedCar } from './entries.ts';

export interface AxisConfig {
  /** The fixed URL segment. */
  axis: string;
  title: string;
  /** Shown on the axis index page. */
  description: string;
  /** False for the two computed axes — nothing is ever tagged with them. */
  authored: boolean;
}

export const AXES: AxisConfig[] = [
  {
    axis: 'body-style',
    title: 'Body style',
    description:
      'The shape of the car. A generation can span more than one: a range sold as a saloon, an estate and a coupé appears under all three.',
    authored: true,
  },
  {
    axis: 'powertrain',
    title: 'Powertrain',
    description: 'How the car is propelled and energised, from petrol to battery-electric.',
    authored: true,
  },
  {
    axis: 'drivetrain',
    title: 'Drivetrain',
    description: 'Which wheels are driven.',
    authored: true,
  },
  {
    axis: 'origin',
    title: 'Origin',
    description:
      "The manufacturer's country. Computed from the brand rather than set per car, so it can never disagree with the brand page.",
    authored: false,
  },
  {
    axis: 'segment',
    title: 'Segment',
    description:
      'One canonical size class, shown with both its European and US labels rather than picking a side.',
    authored: true,
  },
  {
    axis: 'positioning',
    title: 'Market positioning',
    description:
      'Where a car sat in the market, independent of its size. A full-size saloon can be mainstream or ultra-luxury.',
    authored: true,
  },
  {
    axis: 'era',
    title: 'Era',
    description:
      'Computed from production years, never authored. A car built across a decade boundary appears in both decades.',
    authored: false,
  },
];

export function axisConfig(axis: string): AxisConfig | undefined {
  return AXES.find((a) => a.axis === axis);
}

/** Country names become slugs; nothing else derives Origin term ids. */
export function countrySlug(country: string): string {
  return country
    .toLowerCase()
    .normalize('NFD')
    // Strip combining marks so "Côte d'Ivoire" and "Cote d'Ivoire" slug alike.
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The entries a taxonomy view is allowed to list. */
export function taxonomyCandidates(cars: JoinedCar[]): JoinedCar[] {
  return cars.filter((c) => c.data.kind !== 'model');
}

/**
 * Which terms of one axis an entry belongs to.
 *
 * Returns ids only; labels come from the vocabulary (or the brand, for
 * Origin), so a term's display name is never duplicated into content.
 */
export function termsForEntry(
  axis: string,
  car: JoinedCar,
  allCars: JoinedCar[],
  brandsById: Map<string, JoinedBrand>,
): string[] {
  switch (axis) {
    case 'body-style':
      return car.data.bodyStyles;
    case 'powertrain':
      return car.data.powertrains;
    case 'drivetrain':
      return car.data.drivetrains;
    case 'segment':
      return car.data.segment ? [car.data.segment] : [];
    case 'positioning':
      return car.data.positioning ? [car.data.positioning] : [];
    case 'origin': {
      const brand = brandsById.get(car.data.brandRef);
      return brand ? [countrySlug(brand.data.countryOfOrigin)] : [];
    }
    case 'era':
      return erasFor(car, allCars);
    default:
      return [];
  }
}

export interface TermView {
  id: string;
  label: string;
  description?: string;
  cars: JoinedCar[];
}

const AUTHORED_TERMS: Record<string, VocabTerm[]> = {
  'body-style': bodyStyles.terms,
  powertrain: powertrains.terms,
  drivetrain: drivetrains.terms,
  segment: segments.terms,
  positioning: positioning.terms,
};

/**
 * Every term of an axis that has at least one entry, with those entries.
 *
 * Empty terms are dropped rather than published: a vocabulary lists what the
 * site *could* classify, and an axis page listing thirteen segments where
 * eleven lead nowhere is a worse page than one listing the two that exist.
 */
export function buildTermViews(
  axis: string,
  cars: JoinedCar[],
  brands: JoinedBrand[],
): TermView[] {
  const candidates = taxonomyCandidates(cars);
  const brandsById = new Map(brands.map((b) => [b.id, b]));

  const grouped = new Map<string, JoinedCar[]>();
  for (const car of candidates) {
    for (const term of termsForEntry(axis, car, cars, brandsById)) {
      const list = grouped.get(term) ?? [];
      list.push(car);
      grouped.set(term, list);
    }
  }

  const labels = new Map<string, { label: string; description?: string }>();
  if (axis === 'era') {
    for (const term of eras.terms) labels.set(term.id, { label: term.label });
  } else if (axis === 'origin') {
    for (const brand of brands) {
      labels.set(countrySlug(brand.data.countryOfOrigin), {
        label: brand.data.countryOfOrigin,
      });
    }
  } else {
    for (const term of AUTHORED_TERMS[axis] ?? []) {
      labels.set(term.id, { label: term.label, description: term.description });
    }
  }

  const views: TermView[] = [];
  for (const [id, list] of grouped) {
    const meta = labels.get(id);
    views.push({
      id,
      label: meta?.label ?? id,
      description: meta?.description,
      cars: list.sort(
        (a, b) =>
          a.data.productionYears.start - b.data.productionYears.start ||
          a.data.name.localeCompare(b.data.name),
      ),
    });
  }

  // Era sorts chronologically; every other axis sorts by how much is in it,
  // so the useful terms surface first on a sparse catalog.
  return views.sort((a, b) =>
    axis === 'era'
      ? a.id.localeCompare(b.id)
      : b.cars.length - a.cars.length || a.label.localeCompare(b.label),
  );
}
