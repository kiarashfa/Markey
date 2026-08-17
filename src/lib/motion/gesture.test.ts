import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  clampWithRubberband,
  project,
  rubberband,
  snapTarget,
  velocityFrom,
} from './gesture.ts';

const SLIDE = 1265; // the width measured in the real layout at 1280px viewport

describe('project', () => {
  it('projects further the faster the flick', () => {
    assert.ok(Math.abs(project(-2000)) > Math.abs(project(-500)));
  });

  it('projects nothing when the gesture ended at rest', () => {
    assert.equal(project(0), 0);
  });

  it('keeps the sign of the gesture', () => {
    assert.ok(project(-1200) < 0);
    assert.ok(project(1200) > 0);
  });

  it('uses exponential decay, not the textbook v^2/2a form', () => {
    // At d = 0.998 the multiplier is 0.998 / 0.002 = 499 per (px/ms).
    assert.equal(Math.round(project(1000)), 499);
  });
});

describe('rubberband', () => {
  it('resists rather than following 1:1', () => {
    assert.ok(rubberband(200, SLIDE) < 200);
  });

  it('resists progressively — twice the overshoot is less than twice the give', () => {
    assert.ok(rubberband(400, SLIDE) < 2 * rubberband(200, SLIDE));
  });

  it('never hard-stops: some movement always survives', () => {
    assert.ok(rubberband(1000, SLIDE) > 0);
  });

  it('is symmetric in magnitude', () => {
    assert.equal(rubberband(-200, SLIDE), -rubberband(200, SLIDE));
  });
});

describe('clampWithRubberband', () => {
  const min = -SLIDE; // two slides
  const max = 0;

  it('tracks 1:1 inside the valid range', () => {
    assert.equal(clampWithRubberband(-400, min, max, SLIDE), -400);
  });

  it('rubber-bands past the first slide', () => {
    const result = clampWithRubberband(200, min, max, SLIDE);
    assert.ok(result > 0 && result < 200);
  });

  it('rubber-bands past the last slide', () => {
    const result = clampWithRubberband(min - 200, min, max, SLIDE);
    assert.ok(result < min && result > min - 200);
  });
});

describe('snapTarget', () => {
  it('snaps back when a short drag is released slowly', () => {
    // 80px of travel over 360ms -> about -222 px/s. Nowhere near the next slide.
    const velocity = (-80 / 360) * 1000;
    assert.equal(snapTarget(-80, velocity, SLIDE, 2), 0);
  });

  it('carries to the next slide on a fast flick of the same distance', () => {
    // The same 80px, thrown in 32ms -> -2500 px/s. This is the case that
    // separates a carousel that feels alive from one that feels like a form
    // control: distance is identical, intent is not.
    const velocity = (-80 / 32) * 1000;
    assert.equal(snapTarget(-80, velocity, SLIDE, 2), 1);
  });

  it('advances on a slow drag past the halfway point', () => {
    const velocity = (-700 / 600) * 1000;
    assert.equal(snapTarget(-700, velocity, SLIDE, 2), 1);
  });

  it('goes back when the flick reverses direction', () => {
    const velocity = (300 / 40) * 1000; // thrown rightwards from slide 1
    assert.equal(snapTarget(-SLIDE + 300, velocity, SLIDE, 2), 0);
  });

  it('clamps at the first slide however hard it is thrown', () => {
    assert.equal(snapTarget(0, 9000, SLIDE, 3), 0);
  });

  it('clamps at the last slide however hard it is thrown', () => {
    assert.equal(snapTarget(-2 * SLIDE, -9000, SLIDE, 3), 2);
  });

  it('survives a zero-width viewport instead of dividing by zero', () => {
    assert.equal(snapTarget(0, -1000, 0, 3), 0);
  });
});

describe('velocityFrom', () => {
  it('needs at least two samples', () => {
    assert.equal(velocityFrom([{ x: 10, t: 0 }]), 0);
    assert.equal(velocityFrom([]), 0);
  });

  it('averages over the window rather than trusting the last frame', () => {
    // 100px over 100ms, with a noisy middle sample that must not dominate.
    const v = velocityFrom([
      { x: 0, t: 0 },
      { x: 90, t: 50 },
      { x: 100, t: 100 },
    ]);
    assert.equal(v, 1000);
  });

  it('returns zero rather than Infinity when samples share a timestamp', () => {
    assert.equal(velocityFrom([{ x: 0, t: 5 }, { x: 100, t: 5 }]), 0);
  });
});
