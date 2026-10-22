// Mobile Main Window: on a short (landscape) viewport the redesigned Main Window is a fixed full-height
// grid — left menu | work zone | right column (the mission list on Missions) — so nothing relies on page
// scroll and the Take-off button is on-screen without scrolling. Also checks the mission cards + their
// action buttons fit the narrow 25% column, and that the single touch-only floating "Full screen" button
// is gated to touch menus (body.touch + body.menu). Runs late (it shrinks the viewport).
export const name = '07-mobile-hangar';

export default async function ({ page, assert, shot }) {
  await page.setViewportSize({ width: 760, height: 360 }); // mobile-landscape-ish, short height

  // the shared player is campaign-cleared (scenario 05) → reload lands on the Main Window
  await page.goto(page.url(), { waitUntil: 'load' });
  await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });

  // the 3-column Missions grid lays out left→right: menu, work zone, mission list — and Take-off is on-screen
  const m = await page.evaluate(() => {
    const main = document.getElementById('mainwin');
    const menu = document.getElementById('mw-menu').getBoundingClientRect();
    const work = document.getElementById('mw-work').getBoundingClientRect();
    const side = document.getElementById('mw-ship-col').getBoundingClientRect();
    const go = document.getElementById('mw-takeoff').getBoundingClientRect();
    return {
      isGrid: getComputedStyle(main).display === 'grid',
      ordered: menu.left < work.left && work.left < side.left,
      sideQuarter: side.width / window.innerWidth, // ~25%
      goInView: go.top >= 0 && go.bottom <= window.innerHeight && go.width > 0,
    };
  });
  assert.ok(m.isGrid, 'the Main Window is a fixed grid (no page-scroll column)');
  assert.ok(m.ordered, 'columns are laid out left→right: menu, work zone, mission list');
  assert.ok(m.sideQuarter > 0.18 && m.sideQuarter < 0.32, 'the right column is ~25% of the width');
  assert.ok(m.goInView, 'the Take-off button is on-screen without scrolling');
  await shot('mobile-main-window');

  // the narrow column must FIT the cards: no card or action button spills past its right edge
  const fits = await page.evaluate(() => {
    const col = document.getElementById('mw-ship-col').getBoundingClientRect();
    const cards = [...document.querySelectorAll('#mw-mission-board .mission-card')];
    const btns = [...document.querySelectorAll('#mw-mission-board .mc-actions button')];
    return {
      cards: cards.length,
      cardsFit: cards.every((c) => c.getBoundingClientRect().right <= col.right + 1),
      btnsFit: btns.every((b) => b.getBoundingClientRect().right <= col.right + 1),
      scrolls: getComputedStyle(document.getElementById('mw-mission-board')).overflowY === 'auto',
    };
  });
  assert.ok(fits.cards >= 1, 'the mission list renders in the right column on a phone-landscape viewport');
  assert.ok(fits.cardsFit, 'mission cards fit inside the 25% column');
  assert.ok(fits.btnsFit, 'mission-card action buttons fit inside the 25% column');
  assert.ok(fits.scrolls, 'the mission list is its own scroller');

  // Only the mission description scrolls (not the whole frame): it has its own overflow.
  const descScrolls = await page.evaluate(() => getComputedStyle(document.getElementById('mw-mission-desc')).overflowY === 'auto');
  assert.ok(descScrolls, 'the mission description is the independent scroller');

  // Single floating "Full screen" button: hidden on non-touch; shown on touch menus (the Main Window adds
  // body.menu); hidden once fullscreen (body.fs). It carries the translated words on aria-label/title.
  const fs = await page.evaluate(() => {
    const btn = document.getElementById('fullscreen-btn');
    const disp = () => getComputedStyle(btn).display;
    const hiddenNonTouch = disp() === 'none';
    document.body.classList.add('touch'); // the Main Window already set body.menu
    const shownOnTouchMenu = disp() !== 'none';
    document.body.classList.add('fs');
    const hiddenWhenFs = disp() === 'none';
    document.body.classList.remove('fs', 'touch');
    return {
      exists: !!btn,
      hiddenNonTouch,
      shownOnTouchMenu,
      hiddenWhenFs,
      label: btn.getAttribute('aria-label'),
      text: btn.textContent.trim(),
    };
  });
  assert.ok(fs.exists, 'a single floating #fullscreen-btn exists');
  assert.ok(fs.hiddenNonTouch, 'the floating Full screen button is hidden on non-touch');
  assert.ok(fs.shownOnTouchMenu, 'it shows on touch menus (body.touch + body.menu)');
  assert.ok(fs.hiddenWhenFs, 'it hides once fullscreen (body.fs)');
  assert.equal(fs.text, '⛶', 'the button is icon-only (⛶ glyph, no words)');
  assert.ok(fs.label && /full screen/i.test(fs.label), 'the words live on aria-label/title');

  // Loadout's ship stats (five pairs since Top speed joined) must fit the narrow 25% column on a phone:
  // the strip wraps onto a second row instead of overflowing (docs/plans/2026-10-22-1334-loadout-skill-stats.md).
  await page.evaluate(() => document.querySelector('.mw-item[data-mw="loadout"]').click());
  await page.waitForFunction('document.querySelectorAll("#ship-stats .stat").length === 5', null, { timeout: 5000 });
  const fit = await page.evaluate(() => {
    const host = document.getElementById('ship-stats').getBoundingClientRect();
    const col = document.getElementById('mw-ship-col').getBoundingClientRect();
    const statEls = [...document.querySelectorAll('#ship-stats .stat')];
    const stats = statEls.map((e) => e.getBoundingClientRect());
    const inside = (r, o) => r.left >= o.left - 1 && r.right <= o.right + 1 && r.top >= o.top - 1 && r.bottom <= o.bottom + 1;
    // A squeezed (nowrap) strip shrinks the .stat boxes and lets their TEXT spill over the neighbours, so
    // box containment alone can't see it: also require each label/value inside its own stat, and no two
    // stats overlapping.
    const textInStat = statEls.every((e, i) => [...e.querySelectorAll('.k, .v')].every((c) => inside(c.getBoundingClientRect(), stats[i])));
    const noOverlap = stats.every((a, i) => stats.every((b, j) => i >= j
      || a.right <= b.left + 1 || b.right <= a.left + 1 || a.bottom <= b.top + 1 || b.bottom <= a.top + 1));
    return {
      textInStat, noOverlap,
      phone: document.body.classList.contains('dev-phone'),
      statsInHost: stats.every((r) => r.left >= host.left - 1 && r.right <= host.right + 1 && r.top >= host.top - 1 && r.bottom <= host.bottom + 1),
      hostInCol: host.left >= col.left - 1 && host.right <= col.right + 1,
      hostW: host.width,
    };
  });
  assert.ok(fit.phone, 'the 760×360 run is classified dev-phone');
  assert.ok(fit.hostW > 0, '#ship-stats is laid out');
  assert.ok(fit.textInStat, 'every stat label/value lies inside its own stat on a phone (no squeezed text spill)');
  assert.ok(fit.noOverlap, 'no two stats overlap on a phone');
  assert.ok(fit.statsInHost, 'every ship stat lies inside #ship-stats on a phone (wraps, never overflows)');
  assert.ok(fit.hostInCol, '#ship-stats lies inside the right column horizontally on a phone');
  await shot('loadout-stats-phone');
}
