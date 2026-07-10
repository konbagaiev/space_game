// "Reset my progress" control in the settings modal (slide-to-confirm → confirm/cancel). Asserts:
//  - the settings modal still FITS in the viewport with the new danger zone (no clipping);
//  - dragging the slide knob fully right arms it and opens the confirm dialog;
//  - Cancel dismisses the dialog and snaps the slide back;
//  - Confirm POSTs /api/players/:id/reset (intercepted) — the real handler then reloads the page.
export const name = 'reset-progress';

export default async function ({ page, assert, shot }) {
  // launch into the game from whichever menu is up, then open settings via the gear (always visible)
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(150);
  await page.click('#settings-btn');
  await page.waitForTimeout(100);

  // Language row: switching to RU updates BOTH the settings and welcome toggle hosts live (no reload)
  // and re-localizes the modal chrome — exercises "setLanguage updates ALL mounted hosts". Checked first
  // so it runs independently of the modal-fit assertion below.
  const langBefore = await page.evaluate(() => document.documentElement.lang);
  assert.equal(langBefore, 'en', 'starts in English');
  await page.click('#settings-lang button:last-child'); // RU (SUPPORTED = [en, ru])
  await page.waitForTimeout(120);
  const langAfter = await page.evaluate(() => ({
    docLang: document.documentElement.lang,
    settingsActive: document.querySelector('#settings-lang button.active')?.textContent,
    welcomeActive: document.querySelector('#lang-switch button.active')?.textContent,
    title: document.querySelector('#settings-overlay h1')?.textContent,
  }));
  assert.equal(langAfter.docLang, 'ru', 'language switched to RU live (no reload)');
  assert.equal(langAfter.settingsActive, 'RU', 'settings toggle shows RU active');
  assert.equal(langAfter.welcomeActive, 'RU', 'welcome toggle re-rendered to RU active (all hosts updated)');
  assert.equal(langAfter.title, 'Настройки', 'modal chrome re-localized live');
  await page.click('#settings-lang button:first-child'); // restore EN so later shots/state are stable
  await page.waitForTimeout(120);

  // the modal must fit on screen even with the reset danger zone + Language row added
  const fit = await page.evaluate(() => {
    const box = document.querySelector('#settings-overlay .settings-box');
    const r = box.getBoundingClientRect();
    return { boxH: r.height, winH: window.innerHeight, clipped: box.scrollHeight - box.clientHeight, resetVisible: !!document.getElementById('reset-slide').offsetParent };
  });
  await shot('settings-open');
  assert.ok(fit.boxH <= fit.winH + 1, `settings box fits the viewport (box ${fit.boxH} <= win ${fit.winH})`);
  assert.ok(fit.clipped <= 1, `no internal scroll/clipping in the modal (overflow ${fit.clipped})`);
  assert.ok(fit.resetVisible, 'the reset control is visible in the modal');

  // helper: drag the knob from its center to the far right of the track
  const dragSlide = async (toFraction) => {
    const knob = await page.$('#reset-slide .slide-knob');
    const slide = await page.$('#reset-slide');
    const kb = await knob.boundingBox();
    const sb = await slide.boundingBox();
    await page.mouse.move(kb.x + kb.width / 2, kb.y + kb.height / 2);
    await page.mouse.down();
    await page.mouse.move(sb.x + sb.width * toFraction, kb.y + kb.height / 2, { steps: 12 });
    await page.mouse.up();
  };

  // a short drag should NOT arm (snaps back, no dialog)
  await dragSlide(0.4);
  await page.waitForTimeout(250);
  let confirmOn = await page.evaluate(() => document.getElementById('reset-confirm').classList.contains('on'));
  assert.equal(confirmOn, false, 'a partial slide does not arm the reset');

  // a full drag arms it → the confirm dialog opens
  await dragSlide(1.2); // overshoot to guarantee we reach the end
  confirmOn = await page.evaluate(() => document.getElementById('reset-confirm').classList.contains('on'));
  await shot('confirm-open');
  assert.equal(confirmOn, true, 'a full slide opens the confirm dialog');

  // Cancel dismisses the dialog and snaps the slide back to the start
  await page.click('#reset-cancel');
  await page.waitForTimeout(250);
  const afterCancel = await page.evaluate(() => ({
    confirmOn: document.getElementById('reset-confirm').classList.contains('on'),
    armed: document.getElementById('reset-slide').classList.contains('armed'),
  }));
  assert.equal(afterCancel.confirmOn, false, 'Cancel closes the confirm dialog');
  assert.equal(afterCancel.armed, false, 'Cancel snaps the slide back (not armed)');

  // Confirm path: intercept the reset call so we can assert it fires (the handler then reloads the page).
  // try/finally so the mock is ALWAYS removed — otherwise a failure here leaks it into later scenarios
  // (their real /reset gets stubbed → e.g. 97-briefing-showcase can't roll progress back).
  let resetCalled = null;
  await page.route('**/api/players/*/reset', async (route) => {
    resetCalled = route.request().method();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });
  try {
    await dragSlide(1.2);
    await page.waitForTimeout(100);
    await page.click('#reset-do');
    await page.waitForTimeout(300);
    assert.equal(resetCalled, 'POST', 'Confirm reset POSTs to /api/players/:id/reset');
  } finally {
    await page.unroute('**/api/players/*/reset');
  }
}
