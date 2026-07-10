// RU-initial-state guard: a player whose stored preference is Russian must see the RU button active on
// BOTH static toggle hosts on FIRST paint — before touching any language toggle. Guards step 2c: the
// host rebuild lives in applyTranslations() (called by bootstrap's initial localize), not only in
// setLanguage(); with the bug the hosts mount at module-init while getLanguage()==='en' and stay on EN.
export const name = 'language-initial-ru';

export default async function ({ page, assert }) {
  // Seed a Russian preference and reload so bootstrap adopts it on first paint.
  await page.evaluate(() => localStorage.setItem('lang', 'ru'));
  await page.reload({ waitUntil: 'networkidle' });
  // Open settings (gear is always visible) WITHOUT touching any language toggle.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('mainwin')) document.getElementById('mw-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(150);
  await page.click('#settings-btn');
  await page.waitForTimeout(100);
  const initial = await page.evaluate(() => ({
    docLang: document.documentElement.lang,
    welcomeActive: document.querySelector('#lang-switch button.active')?.textContent,
    settingsActive: document.querySelector('#settings-lang button.active')?.textContent,
  }));
  assert.equal(initial.docLang, 'ru', 'bootstrap loaded RU');
  assert.equal(initial.welcomeActive, 'RU', 'welcome toggle shows RU active on initial load (not stuck on EN)');
  assert.equal(initial.settingsActive, 'RU', 'settings toggle shows RU active on initial load (not stuck on EN)');
  await page.evaluate(() => localStorage.removeItem('lang')); // clean up so other scenarios start neutral
}
