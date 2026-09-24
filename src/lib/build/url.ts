/**
 * A build, in a URL.
 *
 * The build has no storage behind it and never needs any: the address bar *is*
 * the save file. That is the same decision the comparison tool made, and
 * for the same reason — a thing you want to send someone belongs in a link.
 *
 * **Readable rather than packed.** A base64 blob would be shorter, and it would
 * also be opaque, fragile across the mangling links suffer in chat clients, and
 * impossible to edit by hand. These are ordinary query parameters: `bm=1350` is
 * the mass, and a visitor who wants to change it in the address bar can.
 *
 * Every key is prefixed `b` so a build can share a URL with the comparison
 * tool's own `cars=` parameter without either having to know about the other.
 */
import type { BuildSpec } from './spec.ts';

/** Wire key → field. The short names exist to keep a shared link readable. */
const NUMBER_KEYS = {
  bm: 'massKg',
  bp: 'powerKw',
  bt: 'torqueNm',
  bc: 'dragCoefficient',
  ba: 'frontalAreaM2',
  bg: 'tyreGrip',
  bk: 'kmhPer1000rpm',
  br: 'redlineRpm',
  bx: 'speedLimiterKmh',
  bl: 'lengthMm',
  bw: 'widthMm',
  bh: 'heightMm',
} as const satisfies Record<string, keyof BuildSpec>;

const TEXT_KEYS = {
  bn: 'name',
  bs: 'segment',
  bdt: 'drivetrain',
  bpt: 'powertrain',
  bb: 'bodyStyle',
} as const satisfies Record<string, keyof BuildSpec>;

/** Long enough for any real name, short enough that it cannot bloat a link. */
export const MAX_NAME_LENGTH = 60;

/**
 * Writes a build into search parameters, in place.
 *
 * Zero and empty values are omitted rather than written out. A zero is how the
 * spec says "not supplied" — no limiter, no gearing, estimate the frontal area
 * — so writing `bx=0` would add length to say nothing, and decoding an absent
 * key back to zero restores it exactly.
 */
export function writeBuildParams(params: URLSearchParams, spec: BuildSpec): void {
  for (const [key, field] of Object.entries(TEXT_KEYS)) {
    const value = String(spec[field] ?? '').trim();
    if (value) params.set(key, value.slice(0, MAX_NAME_LENGTH));
    else params.delete(key);
  }
  for (const [key, field] of Object.entries(NUMBER_KEYS)) {
    const value = Number(spec[field]);
    if (Number.isFinite(value) && value !== 0) params.set(key, trim(value));
    else params.delete(key);
  }
}

/** Drops trailing zeroes so `0.29` stays `0.29` and `1350` stays `1350`. */
function trim(value: number): string {
  return String(Math.round(value * 1e6) / 1e6);
}

export function clearBuildParams(params: URLSearchParams): void {
  for (const key of [...Object.keys(TEXT_KEYS), ...Object.keys(NUMBER_KEYS)]) {
    params.delete(key);
  }
}

/** True when a URL carries a build at all. */
export function hasBuildParams(params: URLSearchParams): boolean {
  return [...Object.keys(TEXT_KEYS), ...Object.keys(NUMBER_KEYS)].some((key) => params.has(key));
}

/**
 * Reads a build out of search parameters.
 *
 * Returns `null` when there is no build in the URL — which is different from a
 * build whose fields are all empty, and the caller needs to tell those apart to
 * decide between "start from the default preset" and "show what is missing".
 *
 * A missing or unparseable field decodes to zero rather than to a preset value.
 * Filling a partial link from a preset would put numbers in front of the
 * visitor that whoever sent the link never chose, which is the same failure as
 * inventing a specification — so a partial build stays partial and says so.
 */
export function readBuildParams(params: URLSearchParams): BuildSpec | null {
  if (!hasBuildParams(params)) return null;

  const spec = {
    name: '',
    segment: '',
    massKg: 0,
    powerKw: 0,
    torqueNm: 0,
    drivetrain: '',
    powertrain: '',
    dragCoefficient: 0,
    frontalAreaM2: 0,
    tyreGrip: 0,
    kmhPer1000rpm: 0,
    redlineRpm: 0,
    speedLimiterKmh: 0,
    lengthMm: 0,
    widthMm: 0,
    heightMm: 0,
    bodyStyle: '',
  } satisfies BuildSpec as BuildSpec;

  for (const [key, field] of Object.entries(TEXT_KEYS)) {
    const raw = params.get(key);
    if (raw !== null) (spec[field] as string) = raw.trim().slice(0, MAX_NAME_LENGTH);
  }
  for (const [key, field] of Object.entries(NUMBER_KEYS)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const value = Number.parseFloat(raw);
    // A negative mass or a negative Cd is not a car, and letting one through
    // would produce a confidently signed nonsense figure rather than a gap.
    (spec[field] as number) = Number.isFinite(value) && value > 0 ? value : 0;
  }
  return spec;
}

/** A build encoded as a query string, without the leading `?`. */
export function encodeBuild(spec: BuildSpec): string {
  const params = new URLSearchParams();
  writeBuildParams(params, spec);
  return params.toString();
}

/** The inverse of `encodeBuild`. */
export function decodeBuild(query: string): BuildSpec | null {
  return readBuildParams(new URLSearchParams(query));
}
