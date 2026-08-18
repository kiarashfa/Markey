/**
 * The agreement test.
 *
 * The car is raymarched and the streaklines are rasterised. If the matrix and
 * the ray construction disagree by even a small amount, the smoke sits beside
 * the car rather than flowing over it — and that failure looks like a physics
 * bug, so it gets debugged in the wrong place. These tests pin the two together
 * from opposite ends: project a point through the matrix, take the pixel it
 * lands on, rebuild the ray for that pixel, and require the ray to hit the
 * point.
 */
import assert from 'node:assert/strict';
import test, { describe } from 'node:test';
import { FAR, NEAR, cameraView, dot, project, rayFor } from './camera.ts';

const eye = { x: 8.2, y: 2.4, z: -5.1 };
const target = { x: 2.05, y: 0.68, z: 0 };
const ASPECT = 16 / 9;

describe('cameraView', () => {
  test('builds an orthonormal, right-handed-to-the-raymarcher basis', () => {
    const v = cameraView(eye, target, ASPECT);
    for (const axis of [v.right, v.up, v.fwd]) {
      assert.ok(Math.abs(Math.hypot(...axis) - 1) < 1e-6, 'axis is not unit length');
    }
    assert.ok(Math.abs(dot(v.right, v.up)) < 1e-6);
    assert.ok(Math.abs(dot(v.right, v.fwd)) < 1e-6);
    assert.ok(Math.abs(dot(v.up, v.fwd)) < 1e-6);
  });

  test('looks at the target: it projects to the centre of the screen', () => {
    const v = cameraView(eye, target, ASPECT);
    const c = project(v.viewProj, target);
    assert.ok(c[3] > 0, 'the target is behind the camera');
    assert.ok(Math.abs(c[0] / c[3]) < 1e-6, 'target is off-centre horizontally');
    assert.ok(Math.abs(c[1] / c[3]) < 1e-6, 'target is off-centre vertically');
  });

  test('the projected pixel and the raymarched ray agree on every point', () => {
    const v = cameraView(eye, target, ASPECT);
    const points = [
      { x: 0, y: 0.5, z: 0 },
      { x: 4.3, y: 1.3, z: 0.9 },
      { x: -2.2, y: 0.1, z: -1.6 },
      { x: 2.0, y: 2.9, z: 1.4 },
      { x: 5.9, y: 0.02, z: -0.4 },
    ];

    for (const p of points) {
      const c = project(v.viewProj, p);
      assert.ok(c[3] > 0, `${JSON.stringify(p)} projected behind the camera`);
      const ndcX = c[0] / c[3];
      const ndcY = c[1] / c[3];
      assert.ok(Math.abs(ndcX) <= 1.001 && Math.abs(ndcY) <= 1.001, 'point fell off screen');

      const rd = rayFor(v, ndcX, ndcY, ASPECT);
      // Distance from the point to the ray through the eye: |(p−eye) × rd|.
      const q: [number, number, number] = [p.x - eye.x, p.y - eye.y, p.z - eye.z];
      const cx = q[1] * rd[2] - q[2] * rd[1];
      const cy = q[2] * rd[0] - q[0] * rd[2];
      const cz = q[0] * rd[1] - q[1] * rd[0];
      const miss = Math.hypot(cx, cy, cz);
      assert.ok(miss < 1e-4, `ray missed ${JSON.stringify(p)} by ${miss.toFixed(6)} m`);
    }
  });

  test('depth maps the near and far planes onto the full NDC range', () => {
    const v = cameraView(eye, target, ASPECT);
    const atNear = v.depthA + v.depthB / NEAR;
    const atFar = v.depthA + v.depthB / FAR;
    assert.ok(Math.abs(atNear + 1) < 1e-6, `near plane mapped to ${atNear}, not −1`);
    assert.ok(Math.abs(atFar - 1) < 1e-6, `far plane mapped to ${atFar}, not +1`);
  });

  test('depth from the matrix matches depth from the ray parameter', () => {
    // The scene shader has a distance t along a normalised ray, not a camera-space
    // z. It converts with zc = t·(rd·fwd); this checks that conversion.
    const v = cameraView(eye, target, ASPECT);
    const p = { x: 3.1, y: 1.05, z: 0.55 };
    const c = project(v.viewProj, p);
    const fromMatrix = c[2] / c[3];

    const rd = rayFor(v, c[0] / c[3], c[1] / c[3], ASPECT);
    const t = Math.hypot(p.x - eye.x, p.y - eye.y, p.z - eye.z);
    const zc = t * dot(rd, v.fwd);
    const fromRay = v.depthA + v.depthB / zc;

    assert.ok(
      Math.abs(fromMatrix - fromRay) < 1e-5,
      `matrix depth ${fromMatrix} against ray depth ${fromRay}`,
    );
  });

  test('an aspect change stretches x only, so the vertical field of view is fixed', () => {
    const wide = cameraView(eye, target, 21 / 9);
    const tall = cameraView(eye, target, 4 / 3);
    const p = { x: 2.05, y: 2.2, z: 0 };
    const a = project(wide.viewProj, p);
    const b = project(tall.viewProj, p);
    assert.ok(Math.abs(a[1] / a[3] - b[1] / b[3]) < 1e-6, 'vertical framing changed with aspect');
  });
});
