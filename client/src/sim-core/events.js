// The simulation's outbound channel.
//
// The sim decides; it does not act on the world outside itself. Instead of calling `audio.sfx.hit()`,
// `spawnExplosion()`, `el.overlay.style.display = …` or `bankRun()` mid-tick, it appends a describing
// event here and someone else decides what that means. In the browser that someone is the adapter in
// `sim.js` (FX, audio, HUD, the backend); on the server it will be the room broadcasting to clients.
// Same events, two very different consumers — which is the whole point.
//
// **Events carry copied values, never live references to moving state.** The queue is drained at the end
// of the tick, by which time a bullet's `pos` has moved on and its entity may be gone. An event describes
// what happened *at the moment it happened*, so positions are cloned at emit time. (Entity references are
// the exception, and deliberate: `enemyShieldHit` binds a pooled bubble to a specific ship, which is
// identity, not a value — exactly as it did when the call was inline.)
//
// See docs/plans/server-authoritative-sim.md (Slice B2).

// The event catalogue. Documented here rather than in a type system so there is one place to read what
// the simulation can say — the server will answer to the same list.
//
//   { type: 'hit',             target: 'enemy'|'player'|'ally', shipClass }  a bullet connected (impact SFX)
//   { type: 'bulletImpact',    pos, weaponClass, absorbed }            hit-flash where a bullet died
//   { type: 'shieldHit',       pos, broke }                            the PLAYER's shield caught a shot
//   { type: 'enemyShieldHit',  enemy, pos, broke }                     an ENEMY's shield caught a shot
//   { type: 'shieldReady' }                                            the player's shield finished recharging
//   { type: 'fire',            weaponClass, isRocket, fromPlayer }      a mount fired (only the player's is audible)
//   { type: 'evade',           pos }                                   a shot was dodged (Maneuver skill)
//   { type: 'pickup',          item }                                  the Grab collected a loot drop
//   { type: 'smoke',           pos }                                   one rocket-trail puff
//   { type: 'detonate',        pos, weaponClass, blastVis, blastTint, blastTime, blastBright }
//                                                                       a rocket went off (damage already applied)
//   { type: 'kill',            pos, isBoss, exhaustColor, sizeScale, role, shipClass, reward, xp, byAlly, name }
//   { type: 'allyDown',        pos, exhaustColor, sizeScale, shipClass }  the WINGMAN was destroyed — he is
//                                                                       gone for the rest of the mission and
//                                                                       is worth nothing (no credits, no XP,
//                                                                       no loot, not counted in world.kills)
//   { type: 'warpFlash',       pos }                                   the soft-boundary warp-back arrival
//   { type: 'banner',          key, params, dur }                      transient centred announcement (i18n KEY, not text)
//   { type: 'bannerClear' }                                             drop whatever banner is showing, now
//   { type: 'missionArrival',  missionId }                             a roam point-autopilot parked at a mission
//   { type: 'baseArrival' }                                             a roam dock-autopilot parked at the station
//   { type: 'missionZoneEnter' }                                        the fly-into-it countdown ran out
//   { type: 'cleared',         credits, xp, kills }                    the win condition was met — THE REWARD
//                                                                       IS DECIDED HERE (bank it; DECISIONS §130)
//   { type: 'finishing' }                                               the player ended the mission: salvage
//                                                                       swept, flying home — COMMIT THE ADVANCE
//   { type: 'win',             textKey, text }                         the ship arrived — the mission is closed
//   { type: 'death' }                                                  the player's ship was destroyed
//
// Note `banner` carries an i18n KEY plus params, never a translated string: `t()` is a client concern and
// must not be reachable from a headless authority.

export function createEventQueue() {
  const q = [];
  return {
    emit(event) { q.push(event); },
    // Hand every queued event to `fn` in emit order, then empty the queue. Safe to emit during a drain
    // only if the consumer expects it — nothing does today, so the simple loop stays.
    drain(fn) {
      for (let i = 0; i < q.length; i++) fn(q[i]);
      q.length = 0;
    },
    clear() { q.length = 0; },
    get length() { return q.length; },
  };
}

// ---------- Banner helpers ----------
// The transient centred announcement ("10 enemies left", "Final Stage", the roam countdown) is emitted
// from three different steps, so its two event shapes live here beside the catalogue rather than being
// re-typed in each. BANNER_FADE is the default lifetime; the adapter reads it back as its own fallback.
export const BANNER_FADE = 3; // seconds a banner takes to fade from full opacity to invisible
export function showBanner(world, key, params = null, dur = BANNER_FADE) {
  world.events.emit({ type: 'banner', key, params, dur });
}
export function clearBanner(world) { world.events.emit({ type: 'bannerClear' }); }
