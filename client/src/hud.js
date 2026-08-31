// HUD draws: the per-frame readouts, off-screen enemy markers, mini-map radar, and the perf overlay.
//
// These are pure draw functions — they READ live state (G, the entity arrays, the engine singletons)
// and write to the DOM; they never mutate game state. The sim loop calls them each frame. Pause control
// (setPaused/togglePause) and the OOB warning stay inline with the sim cluster — they touch the level
// runner + music routing, which haven't been split out yet.
import * as THREE from 'three';
import { G, enemies, allies, creditPopups } from './state.js';
import { drops } from './drops.js'; // off-screen loot markers (no circular dep — drops.js does not import hud.js)
import { camera, renderer, gameW, gameH } from './engine.js';
import { ARENA, arenaCenter } from './world.js';
import { cssColor } from './format.js';
import { t } from './i18n.js';
import { el } from './dom.js';
import { isDev } from './dev.js';
import { lightStatus } from './engine-lights.js'; // ?lights=N fork: lit/pool readout on the dev line
import { liveProgress } from './progression.js';

const DEV = isDev(); // ?dev → append live JS-heap usage + ●dev tag to the perf overlay (see dev.js)

// ---------- Cheap DOM writes ----------
// The HUD redraws every frame, and field telemetry from a weak phone measured it at a FIXED ~8 ms/frame
// (`js.dom`) no matter what was happening — 40% of a 50fps budget before the sim or the renderer run at
// all. Two habits caused it, and both are free to fix:
//
//   1. Writing values that had not changed. `updateHud` re-ran `innerHTML` (an HTML parse + child rebuild)
//      sixty times a second for a credits line that changes on a kill, and rewrote the same percentages
//      and widths every frame. `setText`/`setHTML`/`setStyle` skip the write when the value is identical.
//   2. Positioning with `left`/`top`, which invalidates LAYOUT for every element every frame. `place()`
//      writes one `transform` instead — the compositor handles it and layout is never touched. The
//      elements' own centring/anchor offsets moved out of CSS and into the `extra` argument, since a JS
//      `style.transform` would otherwise override the CSS one.
//
// Both are behaviour-identical: the DOM ends in exactly the same state, just without the redundant work.
// The cached value lives on the node so a pooled element that gets reused keeps its own history.
const setText = (node, v) => { if (node._txt !== v) { node._txt = v; node.textContent = v; } };
const setHTML = (node, v) => { if (node._html !== v) { node._html = v; node.innerHTML = v; } };
const setStyle = (node, prop, v) => {
  const k = '_st_' + prop;
  if (node[k] !== v) { node[k] = v; node.style[prop] = v; }
};
// Position an absolutely-positioned overlay element (all of them sit at left:0/top:0 in CSS). `extra` is
// the element's own centring/rotation, appended so everything stays in ONE transform.
const place = (node, x, y, extra = '') =>
  setStyle(node, 'transform', `translate3d(${x.toFixed(1)}px,${y.toFixed(1)}px,0)${extra}`);

// ---------- HUD ----------
export function updateHud() {
  // {earned} = credits banked this run → green so it reads as live mission gain (matches the "+xx" kill popups).
  // total/earned are numbers and the catalog string is trusted, so innerHTML here is safe.
  setHTML(el.credits, t('ui.hud.credits_line', { total: G.balance, earned: `<span class="hud-earned">${G.earned}</span>` }));
  setText(el.kills, G.enemyTotal > 0 ? `${G.kills}/${G.enemyTotal}` : String(G.kills));
  const hpPct = Math.max(0, G.player.hp / G.player.maxHp * 100);
  setStyle(el.hpFill, 'width', hpPct + '%');
  setText(el.hpPct, hpPct.toFixed(1) + '%'); // remaining health, one decimal

  // shield bar (above the health bar): blue while active (width = remaining fraction), purple while broken
  // (width grows over the recharge time); hidden entirely when the ship carries no shield component.
  const sh = G.player.shield;
  if (sh && sh.capacity > 0) {
    setStyle(el.shieldBar, 'display', 'block');
    el.hpBar.classList.add('with-shield');
    const val = G.player._shieldValue;
    if (val > 0) { // active → blue, width = remaining fraction
      el.shieldBar.classList.remove('recharging');
      setStyle(el.shieldFill, 'width', Math.max(0, Math.min(1, val / sh.capacity)) * 100 + '%');
    } else {       // broken → purple, width grows over the recharge time
      el.shieldBar.classList.add('recharging');
      const frac = sh.rechargeSec > 0 ? Math.min(1, G.player._shieldRechargeAccum / sh.rechargeSec) : 0;
      setStyle(el.shieldFill, 'width', frac * 100 + '%');
    }
  } else { // no shield component → hide the bar, health bar reverts to full rounded corners
    setStyle(el.shieldBar, 'display', 'none');
    el.hpBar.classList.remove('with-shield');
  }

  // rocket reload: the 🚀 circle fills up (radial) as the rocket group reloads
  const rg = G.player.groups.rocket;
  const cd = rg ? rg.reload : 1;
  const left = rg ? Math.max(0, rg.cooldown) : 0;
  const ready = left <= 0;
  const deg = Math.round((cd > 0 ? 1 - left / cd : 1) * 360);
  const col = ready ? '#77ee77' : '#ffaa55';
  setStyle(el.rocketFill, 'background', `conic-gradient(${col} ${deg}deg, rgba(120,90,60,.22) ${deg}deg)`);
  el.rocketBtn.classList.toggle('ready', ready);
}

// The Main Window top-bar credit balance (beside the inactive "Ships" label). Menus only — the in-fight
// balance is the HUD credits line above — so it's pushed on menu entry (showMain/showWelcome) and after
// every shop action (renderBay), not per frame. The bay passes the server's own `credits` (authoritative
// and fresher than G.balance, which openBay doesn't sync); everyone else falls back to G.balance.
export function updateMenuCredits(balance = G.balance) {
  el.mwCreditsVal.textContent = balance;
}

// ---------- Character progression HUD (docs/plans/2026-08-09-character-progression.md) ----------
// The always-on bottom XP bar (fills toward the next level; previews the current run's unbanked XP live)
// plus the free-skill-points badge on the Character menu item. Runs every frame — setText/setStyle skip
// unchanged writes, so it's cheap. Hidden with no player data or during a cutscene/replay.
export function updateProgressionHud() {
  const prog = G.activeShip && G.activeShip.progression;
  const show = !!prog && !G.replayMode;
  setStyle(el.xpBar, 'display', show ? 'block' : 'none');
  if (show) {
    // The bar shows the LIVE level, not the banked one: the run's unbanked XP is rolled through the curve
    // here (`liveProgress`), so crossing a threshold mid-fight bumps the level, empties the bar toward the
    // next one and toasts immediately — waiting for `bankRun` back at base would hide the moment it happened.
    const live = liveProgress(prog, G.earnedXp);
    setStyle(el.xpFill, 'width', Math.max(0, Math.min(100, 100 * live.into / (live.span || 1))).toFixed(1) + '%');
    setText(el.xpText, `${t('ui.character.level', { level: live.level })} · ${t('ui.character.xp', { into: Math.round(live.into), span: live.span })}`);
    announceLevel(live.level);
  }
  const pts = prog ? prog.skillPoints : 0; // free-skill-points badge on the Character menu item
  setText(el.charBadge, pts > 0 ? String(pts) : '');
  el.charBadge.classList.toggle('show', pts > 0);
}

// Highest character level the "Level up" toast has already been shown for. `null` until the first HUD
// frame with player data, so loading an existing level-7 pilot doesn't toast on page load.
let announcedLevel = null;

// Toast `level` if it is genuinely NEW for this session. Two call sites race for it and only one wins:
// the live HUD (the threshold crossed mid-fight — the normal path) and `bankRun` (the server's
// authoritative level, which still covers a level gained while the bar was hidden). A level that went
// DOWN — progress reset, or a refetch that disagrees — re-syncs silently, so the next real gain toasts.
export function announceLevel(level) {
  const n = Math.max(0, level | 0);
  if (announcedLevel !== null && n > announcedLevel) showLevelUp();
  announcedLevel = n;
}

// "Level up" toast — centered white text that fades out over 2s (CSS animation). Restart the animation on
// each call so back-to-back level-ups each play.
export function showLevelUp() {
  const n = el.levelupToast;
  n.classList.remove('show');
  void n.offsetWidth; // force reflow so re-adding the class restarts the fade
  n.classList.add('show');
}

// ---------- Perf overlay (load) ----------
let perfAccum = 0, perfFrames = 0, perfFps = 0;
// Live ship-speed readout (world units/sec) for tuning a future max-speed cap: the current |velocity|
// plus a peak-hold. The peak resets whenever a fresh player ship is built (run start / loadout change —
// `buildPlayer` makes a new `G.player`), so it reflects the current run, not all-time. The player has NO
// speed limit today (sim.js "pure inertia: no friction, no speed limit"), so this shows the real range.
let speedNow = 0, speedPeak = 0, speedPlayerRef = null;
export function updatePerf(sec) { // `sec` = the RAW frame interval (not the sim's clamped dt — see animate)
  if (G.player) { // sample every frame so the peak-hold catches transient maxima between DOM writes
    if (G.player !== speedPlayerRef) { speedPlayerRef = G.player; speedPeak = 0; } // new build → reset peak
    speedNow = G.player.vel.length();
    if (speedNow > speedPeak) speedPeak = speedNow;
  }
  perfAccum += sec; perfFrames++;
  if (perfAccum >= 0.4) { // update ~2.5 times per sec
    perfFps = Math.round(perfFrames / perfAccum);
    const r = renderer.info.render;
    const tris = r.triangles >= 1e6
      ? (r.triangles / 1e6).toFixed(2) + 'M'
      : Math.round(r.triangles / 1e3) + 'k';
    const ms = (perfAccum / perfFrames * 1000).toFixed(1);
    // Append the real backbuffer size (CSS size × pixelRatio) — the actual pixels the GPU fills. Lets a
    // tester confirm whether a tier change moved the pixel count at all (a weak phone often reports
    // devicePixelRatio ~1, so the pixelRatioCap can be a no-op there). A sub-1 `renderScale` knob was tried
    // and REMOVED in 2026-06-27 — it moved fps by nothing on two real GPUs (DECISIONS §23), which is why
    // the glow overlay is tiered by PASS COUNT instead. `calls` therefore now INCLUDES the overlay's extra
    // submits on High/Balance (a second, glow-layer-only pass over the scene + 4 blur passes + 1 composite)
    // and does not on Performance, which has no overlay at all.
    const res = `${renderer.domElement.width}×${renderer.domElement.height}`;
    // In ?dev, append live JS-heap usage (Chrome only) so the tester can eyeball current RAM.
    // REAL-LIGHT FORK READOUT (?lights=N). On screen rather than in the console because the question it
    // answers — "is a light actually lit while I hold thrust?" — cannot be checked by pasting into a console
    // with both hands on the controls. `lit/pool` plus the live power is the whole diagnosis at a glance.
    const ls = lightStatus();
    const lightSuffix = ls.pool
      ? ` · lit ${ls.lit}/${ls.pool} pw ${Math.round(window.__lightPower || 0)} y ${Math.round(window.__lightY || 0)}`
      : '';
    const devSuffix = DEV ? (performance.memory ? ` · ${Math.round(performance.memory.usedJSHeapSize / 1048576)}MB` : '') + ' ●dev' : '';
    const spd = ` · spd ${Math.round(speedNow)} pk ${Math.round(speedPeak)}`; // current speed + run peak (units/s)
    setText(el.perf, t('ui.perf', { fps: perfFps, ms, calls: r.calls, tris }) + ' · ' + res + spd + lightSuffix + devSuffix);
    perfAccum = 0; perfFrames = 0;
  }
}

// ---------- Off-screen enemy markers: edge arrows pointing toward enemies that are off-screen ----------
const markerPool = [];
const _ndc = new THREE.Vector3();
function getMarker(i) {
  while (markerPool.length <= i) {
    const d = document.createElement('div');
    d.className = 'marker';
    el.markers.appendChild(d);
    markerPool.push(d);
  }
  return markerPool[i];
}
export function updateMarkers() {
  // hide everything while there's no player or an overlay (game over / victory) is up
  if (!G.player || el.overlay.style.display !== 'none') { for (const m of markerPool) setStyle(m, 'display', 'none'); return; }
  const w = gameW(), h = gameH(), margin = 0.92; // game (rotated) screen size, not the raw viewport
  let used = 0;
  for (const e of enemies) {
    _ndc.copy(e.pos).project(camera);
    const behind = _ndc.z > 1;            // point is behind the camera -> NDC is mirrored
    let x = _ndc.x, y = _ndc.y;
    if (behind) { x = -x; y = -y; }
    if (!behind && x >= -1 && x <= 1 && y >= -1 && y <= 1) continue; // on screen -> no marker
    const k = margin / Math.max(Math.abs(x), Math.abs(y), 1e-4);     // clamp dir to the edge box
    const cx = x * k, cy = y * k;
    const m = getMarker(used++);
    setStyle(m, 'display', 'block');
    setStyle(m, 'borderLeftColor', cssColor(e.color ?? 0xffffff));    // tint by enemy type
    place(m, (cx * 0.5 + 0.5) * w, (-cy * 0.5 + 0.5) * h,
      ` translate(-50%,-50%) rotate(${(Math.atan2(-cy, cx) * 180 / Math.PI).toFixed(1)}deg)`);
  }
  for (let i = used; i < markerPool.length; i++) setStyle(markerPool[i], 'display', 'none');
}

// ---------- Off-screen loot markers: green edge arrows toward off-screen drops (nearest N) ----------
const dropMarkerPool = [];
const DROP_MARKER_MAX = 6;                 // cap: only the nearest few, so the edges don't clutter
function getDropMarker(i) {
  while (dropMarkerPool.length <= i) {
    const d = document.createElement('div');
    d.className = 'marker drop-marker';    // reuse the .marker arrow shape; .drop-marker sets the green
    el.markers.appendChild(d);
    dropMarkerPool.push(d);
  }
  return dropMarkerPool[i];
}
export function updateDropMarkers() {
  if (!G.player || el.overlay.style.display !== 'none') { for (const m of dropMarkerPool) setStyle(m, 'display', 'none'); return; }
  const w = gameW(), h = gameH(), margin = 0.92;
  // collect off-screen drops with their edge position + squared distance, keep the nearest DROP_MARKER_MAX
  const ppos = G.player.pos, offs = [];
  for (const d of drops) {
    _ndc.copy(d.pos).project(camera);
    const behind = _ndc.z > 1;
    let x = _ndc.x, y = _ndc.y;
    if (behind) { x = -x; y = -y; }
    if (!behind && x >= -1 && x <= 1 && y >= -1 && y <= 1) continue; // on screen → no marker
    const k = margin / Math.max(Math.abs(x), Math.abs(y), 1e-4);
    const dx = d.pos.x - ppos.x, dz = d.pos.z - ppos.z;
    offs.push({ cx: x * k, cy: y * k, d2: dx * dx + dz * dz, special: !!d.special });
  }
  offs.sort((a, b) => a.d2 - b.d2);
  const n = Math.min(offs.length, DROP_MARKER_MAX);
  for (let i = 0; i < n; i++) {
    const { cx, cy } = offs[i];
    const m = getDropMarker(i);
    setStyle(m, 'display', 'block');
    m.classList.toggle('special', !!offs[i].special); // pulsing green glow for the L1/L2 reward pointer
    place(m, (cx * 0.5 + 0.5) * w, (-cy * 0.5 + 0.5) * h,
      ` translate(-50%,-50%) rotate(${(Math.atan2(-cy, cx) * 180 / Math.PI).toFixed(1)}deg)`);
  }
  for (let i = n; i < dropMarkerPool.length; i++) { setStyle(dropMarkerPool[i], 'display', 'none'); dropMarkerPool[i].classList.remove('special'); }
}

// ---------- Roam mission pointer: a single GOLD edge arrow toward the active mission when it's off-screen ----------
// Only while roaming and only when there IS an active mission target (G.roamMission, snapshotted by
// enterRoam). Hides when the mission projects on-screen — the same off-screen-only rule as the loot/enemy
// arrows. The target sits on the flight plane, so we project (x, 0, z).
let missionMarker = null;
const _mm = new THREE.Vector3();
export function updateMissionMarker() {
  const target = G.roam && G.roamMission ? G.roamMission.pos : null;
  if (!target || !G.player || el.overlay.style.display !== 'none') {
    if (missionMarker) setStyle(missionMarker, 'display', 'none');
    return;
  }
  if (!missionMarker) {
    missionMarker = document.createElement('div');
    missionMarker.className = 'marker mission-marker'; // reuse the .marker arrow shape; .mission-marker sets the gold
    el.markers.appendChild(missionMarker);
  }
  _mm.set(target.x, 0, target.z).project(camera);
  const behind = _mm.z > 1;
  let x = _mm.x, y = _mm.y;
  if (behind) { x = -x; y = -y; }
  if (!behind && x >= -1 && x <= 1 && y >= -1 && y <= 1) { setStyle(missionMarker, 'display', 'none'); return; } // on screen → no arrow
  const w = gameW(), h = gameH(), margin = 0.92;
  const k = margin / Math.max(Math.abs(x), Math.abs(y), 1e-4);
  const cx = x * k, cy = y * k;
  setStyle(missionMarker, 'display', 'block');
  place(missionMarker, (cx * 0.5 + 0.5) * w, (-cy * 0.5 + 0.5) * h,
    ` translate(-50%,-50%) rotate(${(Math.atan2(-cy, cx) * 180 / Math.PI).toFixed(1)}deg)`);
}

// ---------- Credit popups: "+xx" green text floating up from each kill, holding then fading over ~2s ----------
const popupPool = [];
const _pp = new THREE.Vector3();
function getPopup(i) {
  while (popupPool.length <= i) {
    const d = document.createElement('div');
    d.className = 'credit-popup';
    el.markers.appendChild(d); // reuse the fixed, full-screen, non-interactive markers container
    popupPool.push(d);
  }
  return popupPool[i];
}
export function updateCreditPopups() {
  // hide everything while there's no player or an overlay (game over / victory) is up
  if (!G.player || el.overlay.style.display !== 'none') { for (const p of popupPool) setStyle(p, 'display', 'none'); return; }
  const w = gameW(), h = gameH();
  let used = 0;
  for (const cp of creditPopups) {
    _pp.copy(cp.pos).project(camera);
    if (_pp.z > 1) continue;                    // behind the camera -> skip
    const t = 1 - Math.max(0, cp.life) / cp.maxLife; // 0 -> 1 over its life
    const x = (_pp.x * 0.5 + 0.5) * w;
    const y = (-_pp.y * 0.5 + 0.5) * h - t * 40; // drift up ~40px in screen space
    const p = getPopup(used++);
    setStyle(p, 'display', 'block');
    place(p, x, y, ' translate(-50%,-50%)');
    setStyle(p, 'opacity', String(Math.min(1, Math.max(0, cp.life)).toFixed(2))); // hold full, then fade over the last ~1s
    // Pooled div is reused: a text popup (e.g. "EVADE" on a dodge) carries `text`; otherwise it's a credit "+xx".
    if (cp.text != null) { setText(p, cp.text); p.classList.toggle('evade', !!cp.evade); }
    else { setText(p, '+' + cp.amount); p.classList.remove('evade'); }
  }
  for (let i = used; i < popupPool.length; i++) setStyle(popupPool[i], 'display', 'none');
}

// ---------- Enemy health bars: a translucent red bar above each damaged enemy (hidden at full health) ----------
const hpBarPool = [];
const _hb = new THREE.Vector3();
const _screenUp = new THREE.Vector3(); // world direction that maps to "up" on the screen (camera's local +Y)
function getHpBar(i) {
  while (hpBarPool.length <= i) {
    const d = document.createElement('div');
    d.className = 'enemy-hp';
    d.appendChild(document.createElement('i')); // the fill (width = current health fraction)
    el.markers.appendChild(d); // reuse the fixed, full-screen, non-interactive markers container
    hpBarPool.push(d);
  }
  return hpBarPool[i];
}
// Second pool, stacked ABOVE the red bar (a sibling element, not a child — 16-enemy-health-bar reads
// `.enemy-hp > i` widths, so the DOM shape of the red bar must not change). Blue while the shield holds,
// purple + filling with the recharge progress while it's broken.
const shieldBarPool = [];
function getShieldBar(i) {
  while (shieldBarPool.length <= i) {
    const d = document.createElement('div');
    d.className = 'enemy-shield';
    d.appendChild(document.createElement('i')); // the fill (width = shield fraction / recharge progress)
    el.markers.appendChild(d);
    shieldBarPool.push(d);
  }
  return shieldBarPool[i];
}
export function updateEnemyHealthBars() {
  // hide everything while there's no player or an overlay (game over / victory) is up
  if (!G.player || el.overlay.style.display !== 'none') {
    for (const b of hpBarPool) setStyle(b, 'display', 'none');
    for (const s of shieldBarPool) setStyle(s, 'display', 'none');
    return;
  }
  const w = gameW(), h = gameH();
  // Offset the anchor along the camera's screen-up axis (not world +Y): with the near-top-down camera
  // (CAM_OFFSET 0,110,26) world "up" points almost at the camera, so a +Y bump barely moves the bar up
  // the screen. The camera's local +Y in world *is* screen-up, so offsetting along it lifts the bar
  // straight up on screen above the model, while staying depth-correct (scales with zoom/distance).
  _screenUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
  let used = 0;
  // One ship's bars, from the shared pools. Extracted so the ALLY gets exactly the same treatment as an
  // enemy without spreading two arrays into one per frame — he carries every field this reads (`hp`,
  // `maxHp`, `shield`, `_shieldValue`, `_shieldRechargeAccum`, `radius`, `pos`).
  // Returns whether it used a pool slot.
  const drawShipBars = (e) => {
    const sh = e.shield || null;
    const shieldFull = !sh || e._shieldValue >= sh.capacity;
    if (e.hp >= e.maxHp && shieldFull) return false;   // nothing damaged at all → no bars
    _hb.copy(e.pos).addScaledVector(_screenUp, e.radius * 1.6 + 2); // lift up-screen, clear of the hull
    _hb.project(camera);
    if (_hb.z > 1) return false;                       // behind the camera -> skip
    const px = (_hb.x * 0.5 + 0.5) * w, py = (-_hb.y * 0.5 + 0.5) * h;
    const frac = Math.max(0, Math.min(1, e.hp / e.maxHp));
    const i = used++;
    const b = getHpBar(i);
    setStyle(b, 'display', 'block');
    place(b, px, py, ' translate(-50%, calc(-100% - 4px))'); // bottom edge pinned just above the anchor
    setStyle(b.firstChild, 'width', (frac * 100) + '%');
    // Shield strip: same anchor, lifted by the CSS transform. Ships without a shield get no strip.
    const s = getShieldBar(i);
    if (!sh) { setStyle(s, 'display', 'none'); return true; }
    const broken = !(e._shieldValue > 0);
    const sFrac = broken
      ? Math.max(0, Math.min(1, (e._shieldRechargeAccum || 0) / sh.rechargeSec)) // purple: recharge progress
      : Math.max(0, Math.min(1, e._shieldValue / sh.capacity));                  // blue: remaining absorption
    s.classList.toggle('recharging', broken);
    setStyle(s, 'display', 'block');
    place(s, px, py, ' translate(-50%, calc(-100% - 10px))'); // stacked above the red bar (4+5+1 px)
    setStyle(s.firstChild, 'width', (sFrac * 100) + '%');
    return true;
  };
  for (const e of enemies) drawShipBars(e);
  for (const a of allies) drawShipBars(a);   // the wingman's hull + shield, same pools (empty in shipped levels)
  for (let i = used; i < hpBarPool.length; i++) setStyle(hpBarPool[i], 'display', 'none');
  for (let i = used; i < shieldBarPool.length; i++) setStyle(shieldBarPool[i], 'display', 'none');
}

// ---------- Mini-map / radar: arena bounds, the player (with heading), and type-colored enemy dots ----------
// Complements the edge arrows (arrows = immediate threat direction; the radar = spatial overview, useful
// now that the player can wander out of bounds). The shown range slightly exceeds the arena so an
// out-of-bounds player still reads near the edge.
const miniCtx = el.minimap.getContext('2d');
const MINI_VIEW = ARENA * 1.18; // world half-extent the radar shows (a touch beyond the arena)
// The radar is a full 2D-canvas repaint (clear + arena box + an arc per enemy) and it was running at the
// render frame rate. A radar does not need 60 Hz — nothing on it moves fast enough to read — and on a weak
// phone the repaint + canvas re-upload is a real slice of the per-frame DOM cost. Redraw at ~20 Hz; the
// caller still invokes this every frame, so hiding/showing stays instant.
const MINI_INTERVAL_MS = 50;
let miniLastDraw = -1e9;
export function updateMiniMap() {
  if (!G.player || el.overlay.style.display !== 'none') { setStyle(el.minimap, 'visibility', 'hidden'); return; }
  setStyle(el.minimap, 'visibility', 'visible');
  const now = performance.now();
  if (now - miniLastDraw < MINI_INTERVAL_MS) return; // throttled: keep the last painted frame on screen
  miniLastDraw = now;
  const S = el.minimap.width, c = S / 2, scale = (c - 6) / MINI_VIEW;
  // map world → radar relative to the arena center (so the boundary square stays centered when it drifts)
  const toX = (x) => c + (x - arenaCenter.x) * scale, toY = (z) => c + (z - arenaCenter.z) * scale;
  miniCtx.clearRect(0, 0, S, S);

  // arena boundary square
  const a = ARENA * scale;
  miniCtx.strokeStyle = 'rgba(73,224,255,.65)';
  miniCtx.lineWidth = 1;
  miniCtx.strokeRect(c - a, c - a, a * 2, a * 2);

  // enemies as dots, tinted by type color (same palette as the edge arrows)
  for (const e of enemies) {
    const ex = toX(e.pos.x), ey = toY(e.pos.z);
    if (ex < 1 || ex > S - 1 || ey < 1 || ey > S - 1) continue; // off the radar
    miniCtx.fillStyle = cssColor(e.color ?? 0xffffff);
    miniCtx.beginPath();
    miniCtx.arc(ex, ey, 2.4, 0, Math.PI * 2);
    miniCtx.fill();
  }

  // the wingman, in his own friendly colour — A4's whole legibility kit for him is his hull tint, his bars
  // and this dot. Deliberately NO off-screen edge arrow: an arrow pointing at him reads as "threat over
  // there". Empty in every level that ships today.
  for (const a of allies) {
    const ax = toX(a.pos.x), ay = toY(a.pos.z);
    if (ax < 1 || ax > S - 1 || ay < 1 || ay > S - 1) continue; // off the radar
    miniCtx.fillStyle = cssColor(a.color ?? 0xffffff);
    miniCtx.beginPath();
    miniCtx.arc(ax, ay, 2.4, 0, Math.PI * 2);
    miniCtx.fill();
  }

  // player as a heading triangle (red while out of bounds), clamped to the radar edge so it stays
  // visible even when the ship flies far outside the boundary
  const px = Math.max(6, Math.min(S - 6, toX(G.player.pos.x)));
  const py = Math.max(6, Math.min(S - 6, toY(G.player.pos.z)));
  const fx = Math.sin(G.player.heading), fz = Math.cos(G.player.heading); // forward dir (headingToDir)
  miniCtx.fillStyle = G.player.oobTime > 0 ? '#ff7a5a' : '#9fe8ff';
  miniCtx.beginPath();
  miniCtx.moveTo(px + fx * 6, py + fz * 6);                       // nose
  miniCtx.lineTo(px - fx * 4 - fz * 4, py - fz * 4 + fx * 4);     // back-left
  miniCtx.lineTo(px - fx * 4 + fz * 4, py - fz * 4 - fx * 4);     // back-right
  miniCtx.closePath();
  miniCtx.fill();
}
