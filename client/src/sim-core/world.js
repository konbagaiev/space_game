// A World is one running fight: its entities, its event queue, and the host that gives its entities a body.
//
// Why this exists at all: `client/src/state.js` cannot be imported in Node — its module body reads
// `window.localStorage` through the graphics tier. So the simulation can never reach the module-level
// collections it grew up on, and the collections have to arrive as an argument instead. That is not
// architectural taste; it is the shape the packaging forces (DECISIONS §116-118, and
// docs/plans/server-authoritative-sim.md D2).
//
// One process can therefore hold many Worlds — which is what a server needs — while the browser simply
// creates one and hands its collections back out through `state.js`, so client code that reads `enemies`
// or `bullets` never learns anything changed.
//
// THE HOST. A bullet in the browser needs a mesh in the scene; the same bullet on a server needs nothing
// at all. The simulation must not know which it is talking to, so it announces lifecycle instead:
// `world.host.onSpawn(kind, entity)` when it creates something, `world.host.onDespawn(kind, entity)` when
// it destroys it. The browser host attaches and disposes Three.js objects; the Node host is `noopHost`
// below and does nothing. `kind` is one of 'enemy' | 'bullet' | 'rocket' | 'drop'.
//
// Note this is deliberately NOT the event queue. Events describe things that HAPPENED, are copied, and are
// drained in a batch at end of tick; the host is a lifecycle callback that has to run at the exact moment
// the entity appears or disappears, because a mesh must exist before the next render and must be disposed
// before the entity reference is dropped.
import { createEventQueue } from './events.js';
import { Vec3 } from './vec.js';

// A host that gives entities no body — the authority, the headless referee, and every unit test.
export const noopHost = { onSpawn() {}, onDespawn() {} };

export function createWorld({ host = noopHost } = {}) {
  return {
    host,
    events: createEventQueue(),

    // --- entities ---
    player: null,      // set by the host once the ship is built (ship-build.buildPlayer)
    enemies: [],
    bullets: [],
    rockets: [],
    drops: [],

    // --- where this run is being fought ---
    // The combat zone's centre. A mission may drift it (the freighter escort), and the soft boundary,
    // warp-back and mini-map are all measured from it — so it is simulation state, not scenery.
    arenaCenter: new Vec3(),
    arenaDrift: null,  // { x, z } world units per second, or null for a static map
  };
}
