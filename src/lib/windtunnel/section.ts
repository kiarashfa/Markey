/**
 * The working section — the single authority on where the tunnel is in metres
 * and how that maps onto lattice cells.
 *
 * ## Why this module exists
 *
 * Three separate pieces of code need the same answer to "which cell is this
 * point in?": the voxeliser that builds the solid mask, the fragment shader
 * that raymarches the dye, and the UI that places the body. When each carried
 * its own copy of the mapping they drifted, and the symptom is not an error —
 * it is smoke that detaches from the car, which reads as a physics bug and is
 * not one. So the mapping is derived here, once, and emitted to GLSL from the
 * same constants the TypeScript uses. This is the same discipline `shaders.ts`
 * applies to the lattice directions.
 *
 * ## Cubic cells are not a preference
 *
 * D3Q19 assumes `dx = dy = dz`; the weights, the speed of sound and the
 * viscosity–relaxation relation are all written in units where one cell is one
 * lattice unit in every direction. A section of 9.6 × 3.2 × 3.2 m on a
 * 144 × 72 × 72 grid looks reasonable and is silently wrong — 66 mm cells
 * streamwise against 44 mm transverse. So the grid is described by a single
 * number and `makeCellMap` refuses anything that would not be cubic.
 */
import type { Vec3 } from './sdf.ts';

/** A body in world metres. Nose at x = 0, wheels on y = 0, centred on z = 0. */
export type BodySdf = (x: number, y: number, z: number) => number;

/**
 * Fixed properties of the section.
 *
 * Height and width are chosen against the car rather than the other way round:
 * 3.2 m gives roughly 1.8 car-widths either side and 2.4 car-heights above,
 * which keeps blockage in the range where far-field boundaries can absorb it.
 * The streamwise aspect buys 2.2 m of settled approach and 3.1 m of wake — the
 * wake is what the visitor is actually here to look at, so it gets the room.
 */
export const SECTION = {
  height: 3.2,
  width: 3.2,
  xInlet: -2.2,
  /** Streamwise cells per transverse cell. Keeps cells cubic by construction. */
  aspect: 3,
} as const;

export interface Grid {
  nx: number;
  ny: number;
  nz: number;
}

export interface CellMap extends Grid {
  /** Metres per cell — cubic in all three axes. */
  dx: number;
  /** Section extent in metres. */
  length: number;
  height: number;
  width: number;
  /** World x of the inlet plane, and z of the near wall. */
  xInlet: number;
  zMin: number;
  /** Centre of cell (ix, iy, iz) in world metres. */
  cellToWorld(ix: number, iy: number, iz: number, out: Vec3): Vec3;
}

/** The one grid family: `n` transverse cells, `n · aspect` streamwise. */
export function sectionGrid(n: number): Grid {
  return { nx: n * SECTION.aspect, ny: n, nz: n };
}

export function makeCellMap(grid: Grid): CellMap {
  const { nx, ny, nz } = grid;
  const dy = SECTION.height / ny;
  const dz = SECTION.width / nz;
  if (Math.abs(dy - dz) > 1e-9) {
    throw new Error(
      `Cells must be cubic for D3Q19: ${dy.toFixed(4)} m in y against ${dz.toFixed(4)} m in z.`,
    );
  }
  const dx = dy;
  const zMin = -SECTION.width * 0.5;
  return {
    nx,
    ny,
    nz,
    dx,
    length: nx * dx,
    height: SECTION.height,
    width: SECTION.width,
    xInlet: SECTION.xInlet,
    zMin,
    cellToWorld(ix, iy, iz, out) {
      out.x = SECTION.xInlet + (ix + 0.5) * dx;
      out.y = (iy + 0.5) * dx;
      out.z = zMin + (iz + 0.5) * dx;
      return out;
    },
  };
}

/**
 * The same constants, as GLSL. Emitted rather than retyped, for the reason in
 * the module comment.
 *
 * `worldToCell` returns a **fractional cell index**, matching `cellToWorld`
 * above: index `i` is the cell whose centre sits at `xInlet + (i + 0.5)·dx`.
 * The atlas lookup adds the remaining half-texel, so a returned value of `0`
 * lands exactly on the first texel's centre and never bleeds into a neighbour.
 */
export function sectionGlsl(map: CellMap): string {
  return `
const float SEC_DX   = ${map.dx.toPrecision(12)};
const float SEC_L    = ${map.length.toPrecision(12)};
const float SEC_H    = ${map.height.toPrecision(12)};
const float SEC_W    = ${map.width.toPrecision(12)};
const float SEC_X0   = ${map.xInlet.toPrecision(12)};
const float SEC_Z0   = ${map.zMin.toPrecision(12)};
const vec3  SEC_LO   = vec3(SEC_X0, 0.0, SEC_Z0);
const vec3  SEC_HI   = vec3(SEC_X0 + SEC_L, SEC_H, SEC_Z0 + SEC_W);

vec3 worldToCell(vec3 p) { return (p - SEC_LO) / SEC_DX - 0.5; }
vec3 cellToWorld(vec3 c) { return SEC_LO + (c + 0.5) * SEC_DX; }
`;
}

/**
 * Rasterises an SDF into a solid mask and counts the projected frontal area.
 *
 * The area is counted by projection along the flow axis, so `Cd = 2F/(ρU²A)`
 * uses the area of the body the fluid actually sees rather than the area of the
 * ideal shape it came from. Using the analytic area against a voxelised force
 * folds the discretisation error straight into Cd.
 *
 * The mapping is a parameter because there are two legitimate ones: the CI
 * validation gate works on unit shapes in a unit box, and the tunnel works in
 * metres. One rasteriser, two mappings, no third copy.
 */
export function rasterise(
  nx: number,
  ny: number,
  nz: number,
  cellToWorld: (ix: number, iy: number, iz: number, out: Vec3) => Vec3,
  sdf: BodySdf,
): { solid: Uint8Array; frontalAreaCells: number } {
  const solid = new Uint8Array(nx * ny * nz);
  const hit = new Uint8Array(ny * nz);
  const p: Vec3 = { x: 0, y: 0, z: 0 };

  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      const row = (z * ny + y) * nx;
      for (let x = 0; x < nx; x++) {
        cellToWorld(x, y, z, p);
        if (sdf(p.x, p.y, p.z) <= 0) {
          solid[row + x] = 1;
          hit[z * ny + y] = 1;
        }
      }
    }
  }

  let area = 0;
  for (let i = 0; i < hit.length; i++) area += hit[i]!;
  return { solid, frontalAreaCells: area };
}

/** Rasterises a body given in world metres onto the working section. */
export function voxeliseSection(map: CellMap, body: BodySdf) {
  return rasterise(map.nx, map.ny, map.nz, map.cellToWorld, body);
}

/** Rotates a body about the vertical axis through its own centre. */
export function yawBody(body: BodySdf, yawRad: number, centreX: number): BodySdf {
  if (yawRad === 0) return body;
  const c = Math.cos(-yawRad);
  const s = Math.sin(-yawRad);
  return (x, y, z) => {
    const qx = x - centreX;
    return body(qx * c - z * s + centreX, y, qx * s + z * c);
  };
}
