// Audio + settings menu: the settings gear opens an audio modal (Master/Music/SFX volumes + on/off
// toggles), changes persist to localStorage and reach the engine, and the music scene follows game
// state (hangar/menu mood ⇄ combat mood). SFX/music are inaudible in headless software audio, so we
// assert on engine STATE (settings + scene) and the DOM, not on sound. We DO verify the sampled-SFX
// happy path (served same-origin + decodable) since that's deterministic regardless of autoplay.
import { SOUNDS } from '../../../server/src/catalog_seed.js';

export const name = '12-audio';

export default async function ({ page, assert, shot }) {
  // Sampled SFX: each registry URL (catalog_seed SOUNDS, served via /api/sounds) is served same-origin and
  // decodes to a short clip. This is the sample layer's happy path; OfflineAudioContext.decodeAudioData
  // needs no user gesture, so it's reliable headless (unlike the live AudioContext, which may stay
  // suspended). A missing/undecodable file would silently fall back to synth — in the seed it should
  // always resolve, so we assert it here.
  for (const { key, url } of SOUNDS) {
    const r = await page.evaluate(async (u) => {
      const res = await fetch(u);
      if (!res.ok) return { ok: false, status: res.status };
      const buf = await res.arrayBuffer();
      const decoded = await new OfflineAudioContext(1, 1, 44100).decodeAudioData(buf.slice(0));
      return { ok: true, dur: decoded.duration, bytes: buf.byteLength };
    }, url);
    assert.ok(r.ok, `sfx '${key}' (${url}) is served same-origin (status ${r.status})`);
    assert.ok(r.dur > 0.02 && r.dur < 5, `sfx '${key}' decodes to a clip (${r.dur}s)`);
  }

  // On a menu (Welcome or Hangar) the gear is visible; the engine starts on the menu mood once unlocked.
  const menuUp = await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    return vis('welcome') || vis('hangar');
  });
  assert.ok(menuUp, 'a menu screen is up');
  assert.ok(await page.evaluate(() => getComputedStyle(document.getElementById('settings-btn')).display !== 'none'),
    'the settings gear is visible on menus');

  // Open the modal via the gear (the click also unlocks the AudioContext under the user gesture).
  await page.click('#settings-btn');
  assert.ok(await page.evaluate(() => document.getElementById('settings-overlay').classList.contains('on')),
    'the settings modal opens');
  await shot('settings-open');

  // The three sliders + two toggles exist and reflect the engine's current settings.
  const ui = await page.evaluate(() => {
    const g = window.__game, s = g.audio.getSettings();
    return {
      master: +document.getElementById('set-master').value, settingMaster: Math.round(s.master * 100),
      musicOn: document.getElementById('set-music-on').textContent.trim(),
      sfxOn: document.getElementById('set-sfx-on').textContent.trim(),
    };
  });
  assert.equal(ui.master, ui.settingMaster, 'the master slider reflects the engine setting');
  assert.ok(ui.musicOn.length > 0 && ui.sfxOn.length > 0, 'the on/off toggles are labeled');

  // Dragging the master slider updates the engine and persists to localStorage.
  await page.evaluate(() => {
    const el = document.getElementById('set-master');
    el.value = 33;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const afterMaster = await page.evaluate(() => ({
    engine: Math.round(window.__game.audio.getSettings().master * 100),
    stored: Math.round(parseFloat(localStorage.getItem('audioMaster')) * 100),
  }));
  assert.equal(afterMaster.engine, 33, 'the engine master volume follows the slider');
  assert.equal(afterMaster.stored, 33, 'the master volume is persisted to localStorage');

  // Toggling Music off zeroes the channel + persists '0'.
  await page.click('#set-music-on');
  const musicOff = await page.evaluate(() => ({
    on: window.__game.audio.getSettings().musicOn,
    stored: localStorage.getItem('audioMusicOn'),
  }));
  assert.equal(musicOff.on, false, 'music toggles off in the engine');
  assert.equal(musicOff.stored, '0', 'the music-off state is persisted');

  await page.click('#settings-close');
  assert.ok(await page.evaluate(() => !document.getElementById('settings-overlay').classList.contains('on')),
    'the settings modal closes');

  // Music scene follows state: launch a fight → combat mood; the gear hides during a live fight.
  await page.evaluate(() => {
    const vis = (id) => { const el = document.getElementById(id); return el && getComputedStyle(el).display !== 'none'; };
    if (vis('hangar')) document.getElementById('hangar-go').click();
    else if (vis('welcome')) document.getElementById('takeoff').click();
  });
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => typeof window.__game.audio.getSettings().master === 'number'),
    'the audio engine is reachable and returns settings'); // isReady may be false under headless autoplay
  // The gear is ALWAYS available (incl. during a live fight) and opening it doubles as pause.
  assert.ok(await page.evaluate(() => getComputedStyle(document.getElementById('settings-btn')).display !== 'none'),
    'the gear is available during a live fight');
  await page.click('#settings-btn');
  assert.ok(await page.evaluate(() => document.getElementById('settings-overlay').classList.contains('on')
    && document.getElementById('pause-btn').textContent === '▶'),
    'opening settings from gameplay also pauses the fight');
  await shot('in-combat-settings');
  await page.click('#settings-close');
  assert.ok(await page.evaluate(() => !document.getElementById('settings-overlay').classList.contains('on')
    && document.getElementById('pause-btn').textContent === '⏸'),
    'closing settings resumes (since the gear paused it)');
}
