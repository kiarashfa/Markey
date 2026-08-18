/**
 * The rake — where smoke enters the tunnel.
 *
 * A real tunnel does not fill the working section with fog. It has a **rake**:
 * a comb of nozzles on a mast upstream of the model, each bleeding a filament.
 * The default here is one vertical column on the centreline, which is the
 * classic arrangement and the one that reads most clearly: it shows the
 * stagnation point, the flow over the bonnet and roof, the underbody, and the
 * wake, all in the plane that matters most.
 *
 * More columns spread the rake across the track and show the spill around the
 * shoulders — genuinely more information, at the cost of looking through
 * several filaments at once from any angle but dead ahead. That trade is the
 * visitor's to make, so it is a control rather than a constant.
 */
import type { CellMap } from './section.ts';

export interface RakeConfig {
  /** Nozzles up the mast. */
  rows: number;
  /** Masts across the span. 1 is a single centreline column. */
  cols: number;
}

export const DEFAULT_RAKE: RakeConfig = { rows: 9, cols: 1 };

/**
 * The rake each mode opens with.
 *
 * Ribbons and smoke want few sources, so a single centreline mast is the
 * default and the one that reads most clearly. Mist wants the opposite: it is a
 * picture of the *whole* field, and nine sources make nine dotted lines rather
 * than a haze. Switching mode therefore switches the rake to something that
 * mode can actually show — and the visitor can change it afterwards, which is
 * why this is a default rather than a rule.
 */
export function defaultRakeFor(mode: string): RakeConfig {
  return mode === 'mist' ? { rows: MAX_ROWS, cols: MAX_COLS } : DEFAULT_RAKE;
}

/** The choices the UI offers, as a grid the visitor can read at a glance. */
export const RAKE_PRESETS: readonly { label: string; rake: RakeConfig }[] = [
  { label: '1 × 5', rake: { rows: 5, cols: 1 } },
  { label: '1 × 9', rake: { rows: 9, cols: 1 } },
  { label: '3 × 9', rake: { rows: 9, cols: 3 } },
  { label: '5 × 11', rake: { rows: 11, cols: 5 } },
  { label: '7 × 13', rake: { rows: 13, cols: 7 } },
];

/** Hard ceiling, so a slider cannot ask for more tracers than are allocated. */
export const MAX_ROWS = 13;
export const MAX_COLS = 7;
export const MAX_NOZZLES = MAX_ROWS * MAX_COLS;

export const nozzleCount = (r: RakeConfig) => r.rows * r.cols;

/**
 * Where the mast stands and how far it reaches, in metres.
 *
 * Just upstream of the nose, spanning a little more than the body's height and
 * track: seeding the whole section would spend most of the filaments on air
 * that never meets the car.
 */
export const RAKE_PLACEMENT = {
  x: -1.55,
  yLow: 0.09,
  yHigh: 1.58,
  zHalf: 0.86,
} as const;

/** Nozzle geometry in cell coordinates, derived from the section mapping. */
export function rakeInCells(map: CellMap) {
  const toCell = (x: number, y: number, z: number): [number, number, number] => [
    (x - map.xInlet) / map.dx - 0.5,
    y / map.dx - 0.5,
    (z - map.zMin) / map.dx - 0.5,
  ];
  const { x, yLow, yHigh, zHalf } = RAKE_PLACEMENT;
  return {
    origin: toCell(x, (yLow + yHigh) / 2, 0),
    /** Full span across rows (vertical) and columns (lateral), in cells. */
    spanU: [0, (yHigh - yLow) / map.dx, 0] as [number, number, number],
    spanV: [0, 0, (2 * zHalf) / map.dx] as [number, number, number],
  };
}

/**
 * Nozzle position, in GLSL. Shared by the tracer update and the dye seed so the
 * two kinds of smoke come out of the same holes.
 *
 * A single row or column sits on the centre of its span rather than at one end,
 * which is why the `> 1` guards are there and not merely defensive.
 */
export const RAKE_GLSL = `
const int MAX_NOZZLES = ${MAX_NOZZLES};
uniform vec3 uRakeO;    /* rake centre, in cells */
uniform vec3 uRakeU;    /* full vertical span, in cells */
uniform vec3 uRakeV;    /* full lateral span, in cells */
uniform vec2 uRake;     /* rows, cols */

vec3 nozzleAt(int row, int col) {
  float fu = uRake.x > 1.0 ? (float(row) / (uRake.x - 1.0) - 0.5) : 0.0;
  float fv = uRake.y > 1.0 ? (float(col) / (uRake.y - 1.0) - 0.5) : 0.0;
  return uRakeO + uRakeU * fu + uRakeV * fv;
}

/** Nozzle by flat index, in the order the tracer texture stores them. */
vec3 nozzleByIndex(int i) {
  int cols = int(uRake.y);
  int row = i / cols;
  return nozzleAt(row, i - row * cols);
}
`;
