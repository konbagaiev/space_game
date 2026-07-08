// Staged briefing reveal (docs/plans/2026-07-05-1641-briefing-staged-reveal.md): on L1 the welcome
// briefing types out then reveals Take-off (no ship picker); on L2/L3 the Main Window campaign briefing
// types out then reveals the ship-preview window + granted-item showcase + Take-off. L4+ stays instant.
// The typewriter runs ~5s, so each screen is SKIPPED (tap the briefing text) for deterministic assertions.
export const name = '18-briefing-staged-reveal';

export default async function ({ page, assert, shot }) {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.unroute('**/api/players/*/reset').catch(() => {}); // clear any leaked mock from 14-reset-progress
  const pid = await page.evaluate(() => localStorage.getItem('playerId'));
  const css = (sel, prop) => page.evaluate(({ sel, prop }) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el)[prop] : null;
  }, { sel, prop });
  const textLen = (sel) => page.evaluate((sel) => (document.querySelector(sel)?.textContent || '').length, sel);

  // ---- L1: the welcome / ship-picker screen. landOn (below) is previewTarget-gated and never resolves on
  // the welcome screen, so drive the reset+reload directly and wait for the staged welcome reveal. ----
  const landWelcome = async () => {
    // Reset lands on the intro (id 1), which AUTO-LAUNCHES the fight (no welcome screen). Advance once to
    // "Level 1" (id 2, no briefing → welcome screen) so the staged welcome reveal is what loads.
    await page.evaluate(async ({ pid }) => {
      await fetch(`/api/players/${pid}/reset`, { method: 'POST' });
      await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
    }, { pid });
    await page.goto(page.url(), { waitUntil: 'load' });
    await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
    await page.waitForSelector('#welcome', { state: 'visible', timeout: 6000 });
    await page.waitForFunction('window.__game.welcomeStaged === true', null, { timeout: 6000 });
  };

  await landWelcome();
  // 1. mid-type: Take-off hidden, intro not yet full.
  assert.equal(await css('#takeoff', 'visibility'), 'hidden', 'L1: Take-off hidden while intro types');
  const introMid = await textLen('#welcome .intro');
  // 2. the .intro font bump (26px desktop).
  assert.equal(await css('#welcome .intro', 'fontSize'), '26px', 'L1: welcome .intro is 26px');
  // 3. skip → intro full + Take-off revealed at once.
  await page.click('#welcome .intro');
  await page.waitForFunction('window.__game.welcomeStaged === false', null, { timeout: 2000 });
  const introFull = await textLen('#welcome .intro');
  assert.ok(introMid < introFull, 'L1: intro was mid-type (shorter) before the skip');
  assert.equal(await css('#takeoff', 'visibility'), 'visible', 'L1: Take-off visible after skip');
  await shot('L1-welcome-revealed');

  // 4a. Regression guard (welcome-pin-takeoff), PHONE form: the grid pins the footer to the viewport bottom
  // while the greeting/intro scroll INDEPENDENTLY. This is now the PHONE-only layout (non-phone forms
  // top-align instead — see 4b), so we test it at a phone-form viewport (880×360, longest edge < 900 →
  // dev-phone). At that size the intro overflows its scroll cell, so we assert BOTH (a) the scroll region
  // genuinely scrolls AND (b) the footer is flush to the content bottom. This FAILS if #welcome is reverted
  // to the centered-flex column — there is no #welcome-scroll, and the footer (last children) is vertically
  // centered, not pinned. (A "takeoff.bottom <= innerHeight" check would NOT catch a revert: the
  // bottom-anchored button stays on-screen in the flex layout too — the flex trap clips the unreachable
  // TOP, not the button. This is why we assert the pin, not mere visibility.)
  await page.setViewportSize({ width: 880, height: 360 });
  await page.evaluate(() => window.dispatchEvent(new Event('resize'))); // recompute the form class for the new size
  await page.waitForTimeout(50);
  const pin = await page.evaluate(() => {
    const scroll = document.getElementById('welcome-scroll');
    const foot = document.getElementById('welcome-footer'); // null on a centered-flex revert → assertion fails
    const wel = document.getElementById('welcome');
    const padBottom = parseFloat(getComputedStyle(wel).paddingBottom); // 24px
    return {
      form: document.body.className.match(/dev-\S+/)?.[0],
      overflows: scroll.scrollHeight > scroll.clientHeight,
      scrollH: scroll.scrollHeight, clientH: scroll.clientHeight,
      footBottom: foot.getBoundingClientRect().bottom,
      contentBottom: window.innerHeight - padBottom, // 360 − 24 = 336
    };
  });
  assert.equal(pin.form, 'dev-phone', `L1: 880×360 is phone form (pinned-footer layout) — got ${pin.form}`);
  // (a) the text region actually overflows.
  assert.ok(pin.overflows, `L1: intro region scrolls at 880×360 (scrollH ${pin.scrollH} > clientH ${pin.clientH})`);
  // (b) the footer is pinned flush to the bottom (footBottom === innerHeight−24). ≤2px tolerance.
  assert.ok(Math.abs(pin.footBottom - pin.contentBottom) <= 2,
    `L1: footer pinned to bottom at 880×360 (footBottom ${Math.round(pin.footBottom)} ≈ contentBottom ${pin.contentBottom})`);

  // 4b. New PC layout guard: on non-phone forms the greeting/intro + Take-off footer are pinned to the TOP
  // (grid-template-rows: auto auto; align-content: start), NOT vertically centered or bottom-pinned. At
  // 1280×800 (desktop) the footer sits well above the viewport bottom, directly under the short intro.
  await page.setViewportSize({ width: 1280, height: 800 }); // restore for the L2/L3/L4 Main Window section
  await page.evaluate(() => window.dispatchEvent(new Event('resize')));
  await page.waitForTimeout(50);
  const topPin = await page.evaluate(() => {
    const foot = document.getElementById('welcome-footer');
    return { form: document.body.className.match(/dev-\S+/)?.[0], footBottom: Math.round(foot.getBoundingClientRect().bottom), h: window.innerHeight };
  });
  assert.equal(topPin.form, 'dev-desktop', `L1: 1280×800 is desktop form — got ${topPin.form}`);
  assert.ok(topPin.footBottom < topPin.h / 2,
    `L1(PC): footer top-aligned, well above the viewport bottom (footBottom ${topPin.footBottom} < ${topPin.h / 2})`);

  // ---- L2/L3/L4: the Main Window. Reuse 97's previewTarget-gated landOn helper (works on these levels). ----
  const landOn = async (n) => {
    await page.evaluate(async ({ pid, n }) => {
      await fetch(`/api/players/${pid}/reset`, { method: 'POST' });
      for (let i = 0; i < n; i++) await fetch(`/api/players/${pid}/advance`, { method: 'POST' });
    }, { pid, n });
    await page.goto(page.url(), { waitUntil: 'load' });
    await page.waitForFunction('!!(window.__game && window.__game.player)', null, { timeout: 8000 });
    await page.waitForFunction('!!(window.__game.previewTarget)', null, { timeout: 4000 });
  };

  const stagedCase = async (n, itemRe, label) => {
    await landOn(n);
    await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
    // mid-type: ship window + Take-off hidden, text not yet full.
    assert.equal(await page.evaluate(() => window.__game.briefingStaged), true, `${label}: briefing staged`);
    assert.equal(await css('#mw-ship-col', 'visibility'), 'hidden', `${label}: ship window hidden while typing`);
    assert.equal(await css('#mw-go', 'visibility'), 'hidden', `${label}: Take-off hidden while typing`);
    const mid = await textLen('#mw-mission-text');
    // skip → full text + ship window + showcase + Take-off revealed at once.
    await page.click('#mw-mission-desc');
    await page.waitForFunction('window.__game.briefingStaged === false', null, { timeout: 2000 });
    const full = await textLen('#mw-mission-text');
    assert.ok(mid < full, `${label}: briefing was mid-type (shorter) before the skip`);
    assert.equal(await css('#mw-ship-col', 'visibility'), 'visible', `${label}: ship window visible after skip`);
    assert.equal(await css('#mw-go', 'visibility'), 'visible', `${label}: Take-off visible after skip`);
    await page.waitForFunction('!!(window.__game.itemShowcaseTarget)', null, { timeout: 4000 });
    assert.match(await page.evaluate(() => window.__game.itemShowcaseTarget), itemRe, `${label}: showcase item model`);
    await shot(label);
  };

  await stagedCase(2, /machine_gun_hangar\./, 'L2-staged-revealed'); // MG briefing (id 3) → Machine Gun
  await stagedCase(3, /repair_drone_hangar\./, 'L3-staged-revealed'); // drone briefing (id 4) → Repair drone

  // 7. Negative: the unlockShop briefing (id 5) is instant — no staging, ship window + Take-off already
  // visible, text already full.
  await landOn(4);
  await page.waitForSelector('#mainwin.on', { state: 'attached', timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__game.briefingStaged), false, 'L4: not staged (instant)');
  assert.equal(await css('#mw-ship-col', 'visibility'), 'visible', 'L4: ship window visible immediately');
  assert.equal(await css('#mw-go', 'visibility'), 'visible', 'L4: Take-off visible immediately');
  await shot('L4-instant');
}
