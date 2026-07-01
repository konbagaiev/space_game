// Audio settings modal (the gear on menus / pause): master/music/sfx volumes + on/off toggles, the
// graphics-quality tier picker (persists + reloads), and the slide-to-confirm "reset my progress" control.
// A leaf module: it calls sim (pause/music) + the audio engine + persistence, never back into the UI.
// Only localizeSettings is called from outside (by the i18n language switch).
import { G } from './state.js';
import { audio } from './sound-routing.js';
import { saveAudioSettings } from './audio.js';
import { saveTier } from './graphics.js';
import { t } from './i18n.js';
import { setPaused, refreshMusic, levelRunner } from './sim.js';

const settingsBtn = document.getElementById('settings-btn');
const settingsOverlay = document.getElementById('settings-overlay');
const setMaster = document.getElementById('set-master');
const setMusic = document.getElementById('set-music');
const setSfx = document.getElementById('set-sfx');
const setMusicOn = document.getElementById('set-music-on');
const setSfxOn = document.getElementById('set-sfx-on');
function renderSettingsUI() {
  const s = audio.getSettings();
  setMaster.value = Math.round(s.master * 100);
  setMusic.value = Math.round(s.music * 100);
  setSfx.value = Math.round(s.sfx * 100);
  setMusicOn.textContent = t(s.musicOn ? 'ui.settings.on' : 'ui.settings.off');
  setMusicOn.classList.toggle('off', !s.musicOn);
  setSfxOn.textContent = t(s.sfxOn ? 'ui.settings.on' : 'ui.settings.off');
  setSfxOn.classList.toggle('off', !s.sfxOn);
  renderQualityUI();
}
// Graphics quality: highlight the active tier; picking one persists it and RELOADS so the whole preset
// applies cleanly. Antialias is a WebGLRenderer constructor arg (can't change live), and pixel ratio /
// star+particle density all read the tier at startup — so a reload is the simplest way to guarantee the
// full effect with no half-applied state. (The page reloads to the welcome/hangar; server-side progress
// is untouched.)
const setQuality = document.getElementById('set-quality');
function renderQualityUI() {
  setQuality.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('on', b.dataset.tier === G.gfx.name));
}
setQuality.addEventListener('click', (e) => {
  const b = e.target.closest('.seg-btn'); if (!b) return;
  if (b.dataset.tier === G.gfx.name) return; // already active
  saveTier(window.localStorage, b.dataset.tier);
  location.reload();
});
function applyAudioChange(patch) {
  audio.setSettings(patch);
  saveAudioSettings(window.localStorage, audio.getSettings()); // persist every change
}
// Opening settings doubles as pause: during a live fight the gear freezes the battle (like the pause
// button) and opens the menu in one click — no separate pause first. Closing resumes only if the gear is
// what paused it (a manual pause stays paused).
let settingsPausedByGear = false;
function openSettings() {
  audio.unlock(); refreshMusic(); renderSettingsUI();
  if (G.gameStarted && G.player && G.player.alive && !levelRunner.won && !G.paused) {
    settingsPausedByGear = true; setPaused(true);
  }
  settingsOverlay.classList.add('on');
}
function closeSettings() {
  settingsOverlay.classList.remove('on');
  dismissResetConfirm(); // also drop the reset confirm + re-arm the slide if either was left open
  if (settingsPausedByGear) { settingsPausedByGear = false; setPaused(false); }
}
settingsBtn.addEventListener('click', openSettings);
document.getElementById('settings-close').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => { if (e.target === settingsOverlay) closeSettings(); }); // backdrop click closes
setMaster.addEventListener('input', () => applyAudioChange({ master: setMaster.value / 100 }));
setMusic.addEventListener('input', () => applyAudioChange({ music: setMusic.value / 100 }));
setSfx.addEventListener('input', () => applyAudioChange({ sfx: setSfx.value / 100 }));
setSfx.addEventListener('change', () => audio.sfx.hit()); // preview the SFX level when the slider is released
setMusicOn.addEventListener('click', () => { applyAudioChange({ musicOn: !audio.getSettings().musicOn }); renderSettingsUI(); });
setSfxOn.addEventListener('click', () => { applyAudioChange({ sfxOn: !audio.getSettings().sfxOn }); renderSettingsUI(); });

// ---- Reset my progress: a slide-to-confirm control, then a confirm/cancel step ----
// The slide must be dragged (almost) fully left→right to "arm"; releasing short snaps back. Arming opens
// the confirm dialog; Confirm POSTs /reset (server wipes progress to the new-player baseline, keeps the
// account) and reloads for a clean re-fetch; Cancel snaps the slide back. Destructive, so two gestures.
const resetSlide = document.getElementById('reset-slide');
const resetKnob = resetSlide.querySelector('.slide-knob');
const resetFill = resetSlide.querySelector('.slide-fill');
const resetConfirm = document.getElementById('reset-confirm');
const resetDoBtn = document.getElementById('reset-do');
const ARM_FRACTION = 0.96; // knob must reach ~the far right to arm (deliberate gesture)
let resetDragging = false;
const knobMargin = 2;
const knobTravel = () => Math.max(0, resetSlide.clientWidth - resetKnob.offsetWidth - knobMargin * 2);
// Position the knob `x` px into its travel; returns the 0..1 fraction. `ease` animates the move (snap-back).
function placeKnob(x, ease) {
  const max = knobTravel();
  const px = Math.max(0, Math.min(max, x));
  const trans = ease ? 'left .18s ease, background .18s' : 'none';
  resetKnob.style.transition = trans;
  resetFill.style.transition = ease ? 'width .18s ease' : 'none';
  resetKnob.style.left = (knobMargin + px) + 'px';
  resetFill.style.width = (resetKnob.offsetWidth + px) + 'px';
  const frac = max > 0 ? px / max : 0;
  resetSlide.classList.toggle('armed', frac >= ARM_FRACTION);
  return frac;
}
// Distance of the pointer along the slide's travel axis, in the slide's local px. When the body is
// rotated 90° (portrait phone) the visually-horizontal slide runs along the viewport's Y axis, so we
// measure clientY against the rect's top instead of clientX against its left (see toGame / applyOrientation).
const knobXFromPointer = (clientX, clientY) => {
  const r = resetSlide.getBoundingClientRect();
  const along = G.rotated ? (clientY - r.top) : (clientX - r.left);
  return along - resetKnob.offsetWidth / 2;
};
function snapResetSlideBack() { resetDragging = false; resetSlide.classList.remove('dragging'); placeKnob(0, true); }
function dismissResetConfirm() { resetConfirm.classList.remove('on'); resetDoBtn.disabled = false; snapResetSlideBack(); }

resetKnob.addEventListener('pointerdown', (e) => {
  resetDragging = true; resetSlide.classList.add('dragging');
  resetKnob.setPointerCapture(e.pointerId); e.preventDefault();
});
resetKnob.addEventListener('pointermove', (e) => { if (resetDragging) placeKnob(knobXFromPointer(e.clientX, e.clientY), false); });
resetKnob.addEventListener('pointerup', (e) => {
  if (!resetDragging) return;
  resetDragging = false; resetSlide.classList.remove('dragging');
  const frac = placeKnob(knobXFromPointer(e.clientX, e.clientY), true);
  if (frac >= ARM_FRACTION) resetConfirm.classList.add('on'); // armed → ask to confirm
  else snapResetSlideBack();
});

document.getElementById('reset-cancel').addEventListener('click', dismissResetConfirm);
resetConfirm.addEventListener('click', (e) => { if (e.target === resetConfirm) dismissResetConfirm(); }); // backdrop
resetDoBtn.addEventListener('click', async () => {
  resetDoBtn.disabled = true;
  try {
    if (G.playerId) {
      const r = await fetch(`/api/players/${G.playerId}/reset`, { method: 'POST' });
      if (!r.ok) throw new Error('reset failed: ' + r.status);
    }
    location.reload(); // server is now at the new-player baseline; reload re-fetches level + active ship cleanly
  } catch (err) {
    console.warn('progress reset failed', err);
    dismissResetConfirm();
  }
});

// Localize the gear label + the On/Off toggles (JS-set, not data-i18n) — now and on language switch.
export function localizeSettings() {
  const lbl = t('ui.settings.open');
  settingsBtn.title = lbl; settingsBtn.setAttribute('aria-label', lbl);
  renderSettingsUI();
}
localizeSettings();
