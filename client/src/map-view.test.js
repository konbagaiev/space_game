// Unit tests for the star-system map's pan/zoom transform (map-view.js — pure, so it loads under
// `node --test` with no DOM). The load-bearing ones are the CLAMPS: without them a drag can throw the whole
// system off-canvas with no way back, and a wheel spin can zoom to a degenerate scale.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ZOOM_MIN, ZOOM_MAX, DEFAULT_VIEW, scaleOf, clampView, toScreen, toWorld,
  panByScreen, zoomAtScreen, centerOn, pickAt,
} from './map-view.js';

const FRAME = { width: 600, height: 400, worldRadius: 40000 };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

test('at zoom 1 the whole system fits inside the smaller canvas half-dimension', () => {
  const s = scaleOf(DEFAULT_VIEW, FRAME);
  const halfMin = Math.min(FRAME.width, FRAME.height) / 2;
  assert.ok(s * FRAME.worldRadius < halfMin, 'the outermost object is on-canvas');
  assert.ok(s * FRAME.worldRadius > halfMin - 40, 'and it uses nearly the whole canvas (padding only)');
});

test('toWorld is the exact inverse of toScreen, at any view', () => {
  for (const view of [DEFAULT_VIEW, { zoom: 7.5, cx: 12000, cz: -4000 }, { zoom: ZOOM_MIN, cx: 0, cz: 0 }]) {
    for (const [wx, wz] of [[0, 0], [15000, -9000], [-2500, 700]]) {
      const p = toScreen(view, FRAME, wx, wz);
      const w = toWorld(view, FRAME, p.x, p.y);
      assert.ok(near(w.x, wx, 1e-6) && near(w.z, wz, 1e-6), `round-trip ${wx},${wz} at zoom ${view.zoom}`);
    }
  }
});

test('the view centre maps to the canvas centre', () => {
  const view = { zoom: 3, cx: -900, cz: 400 };
  const p = toScreen(view, FRAME, view.cx, view.cz);
  assert.ok(near(p.x, FRAME.width / 2) && near(p.y, FRAME.height / 2));
});

test('clampView bounds zoom in both directions', () => {
  assert.equal(clampView({ zoom: 1e6, cx: 0, cz: 0 }, FRAME).zoom, ZOOM_MAX);
  assert.equal(clampView({ zoom: 0.0001, cx: 0, cz: 0 }, FRAME).zoom, ZOOM_MIN);
  assert.equal(clampView({ zoom: 4, cx: 0, cz: 0 }, FRAME).zoom, 4);
});

// THE pan guard: however far you drag, the centre stays inside the system disc, so the map can never be
// flung into empty space with no way to get back.
test('clampView keeps the centre inside the system — panning can never lose the map', () => {
  const far = clampView({ zoom: 5, cx: 5e6, cz: -3e6 }, FRAME);
  assert.ok(Math.hypot(far.cx, far.cz) <= FRAME.worldRadius + 1e-6,
    `centre pulled back to the system (got ${Math.hypot(far.cx, far.cz)})`);
  assert.ok(near(far.cx / Math.hypot(far.cx, far.cz), 5e6 / Math.hypot(5e6, 3e6), 1e-9),
    'and it keeps the direction it was dragged in');
});

test('panByScreen moves the content WITH the pointer and stays clamped', () => {
  const view = { zoom: 2, cx: 0, cz: 0 };
  const s = scaleOf(view, FRAME);
  const moved = panByScreen(view, FRAME, 60, -20);
  assert.ok(near(moved.cx, -60 / s) && near(moved.cz, 20 / s), 'dragging right shows what was to the left');
  // a huge drag still lands inside the system
  const yanked = panByScreen(view, FRAME, 1e7, 1e7);
  assert.ok(Math.hypot(yanked.cx, yanked.cz) <= FRAME.worldRadius + 1e-6);
});

test('zoomAtScreen keeps the world point under the cursor pinned', () => {
  const view = { zoom: 1.5, cx: 3000, cz: -1200 };
  const px = 140, py = 300;
  const before = toWorld(view, FRAME, px, py);
  for (const f of [1.6, 1 / 1.6, 4, 0.25]) {
    const after = zoomAtScreen(view, FRAME, f, px, py);
    const w = toWorld(after, FRAME, px, py);
    assert.ok(near(w.x, before.x, 1e-3) && near(w.z, before.z, 1e-3),
      `factor ${f}: the point under the cursor does not slide (${w.x} vs ${before.x})`);
  }
});

test('zoomAtScreen respects the zoom bounds even when the anchor is off-centre', () => {
  const view = { zoom: ZOOM_MAX, cx: 0, cz: 0 };
  assert.equal(zoomAtScreen(view, FRAME, 10, 10, 10).zoom, ZOOM_MAX);
  assert.equal(zoomAtScreen({ zoom: ZOOM_MIN, cx: 0, cz: 0 }, FRAME, 0.1, 10, 10).zoom, ZOOM_MIN);
});

test('centerOn re-centres without touching zoom (list row → map focus)', () => {
  const view = { zoom: 6, cx: 0, cz: 0 };
  const c = centerOn(view, FRAME, -1480, -1180);
  assert.equal(c.zoom, 6);
  const p = toScreen(c, FRAME, -1480, -1180);
  assert.ok(near(p.x, FRAME.width / 2) && near(p.y, FRAME.height / 2));
});

test('pickAt returns the nearest marker within the pick radius, else null', () => {
  const objects = [
    { id: 'a', pos: { x: 0, z: 0 } },
    { id: 'b', pos: { x: 20000, z: 0 } },
  ];
  const view = DEFAULT_VIEW;
  const pa = toScreen(view, FRAME, 0, 0);
  assert.equal(pickAt(objects, view, FRAME, pa.x + 3, pa.y + 3).id, 'a');
  assert.equal(pickAt(objects, view, FRAME, pa.x + 200, pa.y), null, 'far from any marker → no pick');
  // when two markers are close, the nearer one wins
  const pb = toScreen(view, FRAME, 20000, 0);
  assert.equal(pickAt(objects, view, FRAME, pb.x - 2, pb.y).id, 'b');
});
