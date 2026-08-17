/**
 * Pure gesture maths — the decisions behind a swipe, with no DOM in sight.
 *
 * Extracted from the spotlight carousel for the same reason `lib/math/` exists
 * (Instruction.md operating rule 6): the interesting part of a gesture is a
 * calculation, and a calculation that lives inside a component can only be
 * verified by driving a browser. These run under `node --test` instead, which
 * is the only way to actually assert that a slow 80 px drag snaps back while a
 * fast 80 px flick carries to the next slide.
 *
 * Sources for the formulae are Apple's *Designing Fluid Interfaces* sample
 * code, via `.claude/skills/apple-design` §6 and §9.
 */

/**
 * Where a flick would come to rest, given its release velocity.
 *
 * This is the exponential-decay form Apple actually ships, not the
 * physics-textbook `v² / 2a`. The distinction matters: the textbook form
 * under-projects fast flicks badly, which is what makes a carousel feel like
 * it resists you.
 *
 * @param velocity px/s at release
 * @param decelerationRate 0.998 is normal scroll feel; 0.99 is snappier
 */
export function project(velocity: number, decelerationRate = 0.998): number {
  return ((velocity / 1000) * decelerationRate) / (1 - decelerationRate);
}

/**
 * Progressive resistance past a boundary.
 *
 * The further past the edge, the less the content follows — real things slow
 * before they stop. A hard stop reads as "frozen"; this reads as "responsive,
 * but there is nothing more here".
 *
 * @param overshoot px dragged beyond the boundary
 * @param dimension the viewport dimension being dragged along
 */
export function rubberband(overshoot: number, dimension: number, constant = 0.55): number {
  if (dimension <= 0) return 0;
  return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
}

/**
 * Clamps a raw drag position, rubber-banding outside the valid range.
 *
 * @param raw where 1:1 tracking would put the track
 * @param min most-negative valid offset (the last slide)
 * @param max least-negative valid offset (the first slide, normally 0)
 */
export function clampWithRubberband(
  raw: number,
  min: number,
  max: number,
  dimension: number,
): number {
  if (raw > max) return max + rubberband(raw - max, dimension);
  if (raw < min) return min - rubberband(min - raw, dimension);
  return raw;
}

/**
 * Which slide a released gesture should land on.
 *
 * The landing slide is chosen from where the gesture is *going*, not from where
 * the finger happened to lift — which is what makes a flick feel like it throws
 * the carousel rather than nudging it.
 */
export function snapTarget(
  offset: number,
  velocity: number,
  slideWidth: number,
  slideCount: number,
  decelerationRate = 0.998,
): number {
  if (slideWidth <= 0 || slideCount <= 0) return 0;
  const projected = offset + project(velocity, decelerationRate);
  const index = Math.round(-projected / slideWidth);
  return Math.max(0, Math.min(slideCount - 1, index));
}

/**
 * Velocity in px/s from a short position history.
 *
 * A single frame's delta is noisy enough to make identical-feeling flicks
 * behave differently, so this averages over the sample window instead.
 */
export function velocityFrom(samples: { x: number; t: number }[]): number {
  if (samples.length < 2) return 0;
  const first = samples[0]!;
  const last = samples[samples.length - 1]!;
  const elapsed = last.t - first.t;
  if (elapsed <= 0) return 0;
  return ((last.x - first.x) / elapsed) * 1000;
}
