// Phone layout of the shared star-system navigation component (systemmap-ui.mountSystemNav), in BOTH of
// its in-world hosts: the base-menu Map section and the in-flight overlay.
//
// What this pins: on a phone the map is the point of the screen, so it takes the central area down to the
// bottom edge and the object list is a COLUMN ON THE RIGHT — the same shape as the desktop. The first
// version stacked them instead, which split a 390px-tall landscape phone into two useless strips (a 149px
// map above a 153px list). It also hit-tests the bottom action button: in the base menu it ends in the same
// corner as the floating ⛶ fullscreen button, which draws over it and would steal the tap.
export const name = '34-phone-map-layout';

export default async function ({ page, assert, shot }) {
  await page.setViewportSize({ width: 844, height: 390 }); // phone held in landscape
  await page.waitForTimeout(400);

  // --- 1. Base-menu Map section ---
  const base = await page.evaluate(async () => {
    const g = window.__game;
    g.roam = false;
    g.showMain(null);
    document.body.classList.add('dev-phone', 'touch');
    document.body.classList.remove('dev-tablet', 'dev-desktop', 'dev-desktop-lg', 'fs', 'no-fs-api');
    document.querySelector('#mw-menu [data-mw="map"]').click();
    await new Promise((r) => setTimeout(r, 250));
    const box = (sel) => { const e = document.querySelector(sel); return e && e.getBoundingClientRect(); };
    const nav = box('#mw-view-map .sysnav'), map = box('#mw-view-map .sysnav-mapwrap'), side = box('#mw-view-map .sysnav-side');
    const last = document.querySelector('#mw-view-map .sysnav-actions button:last-child');
    const lb = last.getBoundingClientRect();
    const topAt = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === last || last.contains(e)); };
    return {
      row: getComputedStyle(document.querySelector('#mw-view-map .sysnav')).flexDirection,
      sideIsRight: side.left >= map.right - 1,
      mapFillsHeight: map.height / nav.height,        // ~1 — down to the bottom of the view
      mapIsTheBigHalf: map.width > side.width,
      fsShown: getComputedStyle(document.getElementById('fullscreen-btn')).display !== 'none',
      lastBtnTappable: topAt(lb.right - 6, lb.top + lb.height / 2), // the ⛶ corner
    };
  });
  assert.equal(base.row, 'row', 'phone base-menu Map lays the component out side by side (not stacked)');
  assert.ok(base.sideIsRight, 'the object list is the column to the RIGHT of the map');
  assert.ok(base.mapFillsHeight > 0.9, `the map runs to the bottom of the view (got ${base.mapFillsHeight.toFixed(2)} of it)`);
  assert.ok(base.mapIsTheBigHalf, 'and it keeps the larger share of the width');
  assert.ok(base.fsShown, 'sanity: the ⛶ fullscreen button is up in this state');
  assert.ok(base.lastBtnTappable, 'the bottom action button clears the floating ⛶ (its corner is still tappable)');
  await shot('phone-base-map');

  // --- 2. The same component as the in-flight overlay ---
  const overlay = await page.evaluate(async () => {
    const g = window.__game;
    document.body.classList.remove('menu');
    g.enterRoam(null);
    await new Promise((r) => setTimeout(r, 300));
    g.openSystemMap();
    await new Promise((r) => setTimeout(r, 300));
    const box = (sel) => { const e = document.querySelector(sel); return e && e.getBoundingClientRect(); };
    const nav = box('#systemmap-overlay .sysnav'), map = box('#systemmap-overlay .sysnav-mapwrap'), side = box('#systemmap-overlay .sysnav-side');
    const last = document.querySelector('#systemmap-overlay .sysnav-actions button:last-child');
    const lb = last.getBoundingClientRect();
    const top = document.elementFromPoint(lb.right - 6, lb.top + lb.height / 2);
    return {
      row: getComputedStyle(document.querySelector('#systemmap-overlay .sysnav')).flexDirection,
      sideIsRight: side.left >= map.right - 1,
      mapFillsHeight: map.height / nav.height,
      lastBtnTappable: !!top && (top === last || last.contains(top)),
    };
  });
  assert.equal(overlay.row, 'row', 'the in-flight overlay uses the same side-by-side shape on a phone');
  assert.ok(overlay.sideIsRight, 'list to the RIGHT there too');
  assert.ok(overlay.mapFillsHeight > 0.9, `and the map fills the overlay height (got ${overlay.mapFillsHeight.toFixed(2)})`);
  assert.ok(overlay.lastBtnTappable, 'its bottom action button is tappable (the z-9000 overlay covers the ⛶)');
  await shot('phone-overlay-map');
}
