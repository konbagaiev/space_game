// Hangar shop + stash (docs/plans/hangar-shop.md). The "spend" side of the economy: equipped loadout +
// stash + a simple shop, with a live ship-stats panel (HP / acceleration / maneuverability / weight / top speed) that
// shows the delta vs the previous config. The server stays authoritative — every action posts to an
// endpoint and re-renders from the response. A leaf module: the Main Window calls in (openBay/showBayView/
// canLaunch/updateTakeoffGate/renderShipStatsBar/deriveShipStats); nothing here calls back out into the UI.
import { esc, slotLabel, priceLabel } from './format.js';
import { G, CATALOG, world } from './state.js';
import { rebuildActiveShip } from './ship-build.js';
import { makePlayer } from './sim-core/ship-entity.js';
import { PLAYER_MAX_SPEED } from './sim-core/step-player.js';
import { updateHud, updateMenuCredits } from './hud.js';
import { fetchJson, missionClearDone } from './net.js';
import { API_BASE } from './api-base.js';
import { t } from './i18n.js';
import { shipModelCfg } from './ship-factory.js';
import { buildModelViewer, setViewerModel, startViewer, stopViewer, resizeViewer, disposeViewer, itemModelCfg, setTopDownView, enableOrbit } from './model-viewer.js';
import { gatedRefs, hasNew, prune, primeSets, unseenSections, unseenItems, refOf, absorbRefs, GATE_KINDS, LEGACY_GATE_KINDS } from './shop-markers.js';
import { GROUP_WEAPON_TYPE, slotAcceptsWeaponType } from './shop-slots.js';
import { isShopItem, REQUIRED_SLOTS, COMPONENT_SLOTS, sellPrice } from './sim-core/shop-rules.js'; // shared with the server (DECISIONS §136)

let shopData = null;       // { credits, shopUnlocked, stash, activeShip } — last server state
let panelMode = 'slot';   // right context panel: 'slot' (selected-slot detail) | 'shop' (the shop)
let selectedSlot = null;  // the loadout slot selected around the ship (component slot key OR weapon group)
let selectedStashRef = null; // { kind, refId } chosen in the slot panel → show its info + Install; else the equipped item + Remove
let shopType = 'hull';    // selected type in the shop panel
let selectedShopItem = null; // { kind, refId } shown in the shop DETAIL card (stats + 3D model + Buy), or null = the list
let shopBusy = false;     // guard against double-submits
let lastShipStats = null; // previous ship-stats snapshot (for the delta arrows)
let loadoutViewer = null; // 3D viewer for the centered ship (#loadout-ship), built lazily
let shopModelViewer = null; // 3D viewer for the shop detail card's item model (#shop-model)
// Where each slot chip sits around the centered ship (percent of #loadout-center; translate -50%,-50%).
const SLOT_LAYOUT = {
  gun:      { top: '12%', left: '30%' }, rocket:   { top: '12%', left: '70%' }, // weapons up front
  grab:     { top: '40%', left: '19%' }, shield:   { top: '40%', left: '81%' },
  hull:     { top: '66%', left: '19%' }, repair:   { top: '66%', left: '81%' },
  engine:   { top: '90%', left: '30%' }, thruster: { top: '90%', left: '70%' },
};

// Normalize the three item sources (catalog component / catalog weapon / server stash row) to one
// shape { kind, refId, name, type, price, s (stat fields), weight } the renderers + statLine share.
const normComponent = (c) => (c ? { kind: 'component', refId: c.id, name: c.name, type: c.type, price: c.price ?? 0, s: c.stats, weight: c.weight } : null);
const normWeapon = (w) => (w ? { kind: 'weapon', refId: w.id, name: w.name, type: w.type, price: w.price ?? 0, s: w, weight: w.weight } : null);
const normStash = (it) => (it.kind === 'component'
  ? { kind: it.kind, refId: it.refId, name: it.name, type: it.type, price: it.price, qty: it.qty, s: it.stats, weight: it.weight }
  : { kind: it.kind, refId: it.refId, name: it.name, type: it.type, price: it.price, qty: it.qty, s: it.stats, weight: it.stats.weight });

// A full, localized list of an item's characteristics (text only — no art), shown on hover / (i).
function statLine(kind, type, s, weight) {
  const parts = [];
  const add = (label, val) => { if (val != null && val !== 0) parts.push(`${t(label)} ${val}`); };
  if (kind === 'component') {
    if (type === 'hull') add('ui.shop.stat.hp', s.durability);
    else if (type === 'engine') add('ui.shop.stat.power', s.power); // raw catalog power, not the bar's Accel (power ÷ mass, skills applied); engine.maxSpeed caps ENEMIES only — the player's cap is the bar's Top speed
    else if (type === 'thruster') add('ui.shop.stat.power', s.power); // raw power, not the bar's Turn rate
    else if (type === 'repair') {
      parts.push(`${t('ui.shop.stat.heal')} +${s.repairPerTick}/${s.intervalSec}s`);
      if (s.maxFraction != null) parts.push(`${t('ui.shop.stat.cap')} ${Math.round(s.maxFraction * 100)}%`);
    }
    else if (type === 'grab') add('ui.shop.stat.grab', s.strength); // tractor: abstract grab strength (reach is emergent, not equal to this number)
    else if (type === 'shield') { add('ui.shop.stat.shield', s.capacity); parts.push(`${t('ui.shop.stat.recharge')} ${s.rechargeSec}s`); } // damage buffer: capacity + recharge time
  } else { // weapon
    // Triple spiral rocket fires 3 real warheads, each dealing `power` — show the per-warhead × count
    // so the shop reflects the true on-hit damage (40×3), not one warhead's 40. (See catalog id 11.)
    add('ui.shop.stat.dmg', s.spiral ? `${s.power}×3` : s.power);
    // The charged beam's two extra facts: how long the trigger takes to fire, and how wide the hit corridor
    // drawn on screen is. Both are the weapon — reading only DMG/RoF would describe a different gun.
    // `toFixed(1)` on the charge so a whole second reads "1.0s" rather than "1s", i.e. as a duration.
    if (type === 'beam') {
      parts.push(`${t('ui.shop.stat.charge')} ${s.chargeTime.toFixed(1)}s`);
      parts.push(`${t('ui.shop.stat.arc')} ±${s.corridorDeg}°`);
    }
    if (s.fireCooldown) parts.push(type === 'rocket'
      ? `${t('ui.shop.stat.reload')} ${s.fireCooldown}s`
      // A BEAM'S TRUE CYCLE IS charge + cooldown. `1 / fireCooldown` alone would advertise **2.0/s** for a
      // weapon that spends a whole second charging and only fires every 1.5 s — a flat lie, and exactly the
      // trap the Triple spiral's `40×3` two lines above exists to avoid. At the shipped 1.0 s + 0.5 s this
      // renders `RoF 0.7/s` (the label's existing one-decimal format).
      : `${t('ui.shop.stat.rof')} ${(1 / (type === 'beam' ? s.chargeTime + s.fireCooldown : s.fireCooldown)).toFixed(1)}/s`);
    add('ui.shop.stat.speed', s.projectileSpeed); // absent on a beam: a hitscan has no flight time
    add('ui.shop.stat.range', s.maxRange);
    add('ui.shop.stat.blast', s.blastRadius);
  }
  if (typeof weight === 'number') add('ui.shop.stat.weight', weight);
  return parts.join(' · ');
}

// The Loadout stats ARE the flown ship's: build the player entity exactly as a take-off would (makePlayer —
// skills included) and read its numbers. No hand-kept copy to drift (audit A3, DECISIONS §163). makePlayer
// draws no RNG and resolves fresh component/weapon copies, so calling it from a UI render is side-effect free.
// `active` is the active-ship record { ship, loadout, components, progression }.
// Top speed = the sim's own clamp (step-player.js): the flat pilot cap × the Mobility multiplier.
export function deriveShipStats(active) {
  // A record without its ship row can't be built — show zeros rather than throw and blank the Loadout.
  if (!active || !active.ship || !active.ship.stats) return { hp: 0, acceleration: 0, turnRate: 0, weight: 0, topSpeed: 0 };
  const p = makePlayer(world.catalog, {
    ship: active.ship,
    loadout: active.loadout || { mounts: [] },
    components: active.components,
    skills: active.progression ? active.progression.skills : null,
  });
  return { hp: p.maxHp, acceleration: p.acceleration, turnRate: p.turnRate, weight: p.mass,
           topSpeed: PLAYER_MAX_SPEED * p.maxSpeedMul };
}

// Render the live stats bar with ▲/▼ deltas vs the previous config (green = better, red = worse;
// for weight, lighter is better so the colors invert while the arrow still tracks the raw direction).
export function renderShipStatsBar(st, hostId = 'ship-stats') {
  const host = document.getElementById(hostId);
  if (!host) return;
  const defs = [
    { key: 'hp', label: t('ui.shop.stat.hp'), dp: 0 },
    { key: 'acceleration', label: t('ui.shop.stat.accel'), dp: 1 },
    { key: 'turnRate', label: t('ui.shop.stat.maneuver'), dp: 2 },
    { key: 'weight', label: t('ui.shop.stat.weight'), dp: 0, lowerBetter: true },
    { key: 'topSpeed', label: t('ui.shop.stat.topspeed'), dp: 1 }, // 1 dp: 31.5 must not round to a misleading 32
  ];
  host.innerHTML = defs.map((d) => {
    const cur = d.dp ? st[d.key].toFixed(d.dp) : Math.round(st[d.key]);
    let delta = '';
    if (lastShipStats) {
      const diff = st[d.key] - lastShipStats[d.key];
      if (Math.abs(diff) > 1e-6) {
        const up = diff > 0;
        const good = d.lowerBetter ? !up : up;
        const num = d.dp ? Math.abs(diff).toFixed(d.dp) : Math.abs(Math.round(diff));
        delta = `<span class="d ${good ? 'up' : 'down'}">${up ? '▲' : '▼'}${num}</span>`;
      }
    }
    const crit = d.key === 'hp' && st.hp === 0; // no hull → HP 0, flag it red
    return `<div class="stat"><div class="k">${esc(d.label)}</div><div class="v${crit ? ' crit' : ''}">${cur}${delta}</div></div>`;
  }).join('');
  lastShipStats = st;
}
// Reset the delta baseline so the next renderShipStatsBar shows no ▲/▼ (called when the Main Window opens).
export function resetShipStatsDelta() { lastShipStats = null; }

// How many of (kind, refId) the player already owns = equipped on the active ship + qty in the stash.
function ownedCount(kind, refId) {
  let n = 0;
  for (const it of (shopData && shopData.stash) || []) if (it.kind === kind && it.refId === refId) n += it.qty;
  const active = shopData && shopData.activeShip;
  if (active) {
    if (kind === 'component') {
      for (const slot of COMPONENT_SLOTS) if (active.components && active.components[slot] === refId) n++;
    } else {
      for (const m of (active.loadout && active.loadout.mounts) || []) if (m.weapon === refId) n++;
    }
  }
  return n;
}
const SHOP_TYPES = ['hull', 'engine', 'thruster', 'repair', 'shield', 'weapon', 'grab'];
function shopCatalog() {
  const items = [];
  for (const c of CATALOG.components.values()) items.push(normComponent(c));
  for (const w of CATALOG.weapons.values()) items.push(normWeapon(w));
  return items;
}

// ---------- Gated shop rows (`stats.minLevel` / `stats.minMission`) ----------
// A gated row is simply ABSENT from the shop until its gate opens — the maintainer's call: no greyed-out
// teaser (DECISIONS §108). Two gate kinds, both compared by NAME/ID STRING against what the server ships
// with the active ship (DECISIONS §95 — the client never learns a raw level or mission row id):
//   `minLevel`   → campaign progress   → `activeShip.reachedLevels`   (FACTORY_GATE, "Level 3" cleared)
//   `minMission` → a cleared side mission → `activeShip.clearedMissions` (RESEARCH_GATE, "Research station")
// Both must pass. The server refuses the buy anyway (`buyItem`), so this filter is presentation, not
// enforcement, and a LOOTED copy of a gated item still deposits and equips.
const itemUnlocked = (s) => {
  if (!s) return true;
  if (s.minLevel && !((G.activeShip && G.activeShip.reachedLevels) || []).includes(s.minLevel)) return false;
  if (s.minMission && !((G.activeShip && G.activeShip.clearedMissions) || []).includes(s.minMission)) return false;
  return true;
};
// Every row the shop would list right now (the same predicate renderShopPanel filters by, minus the type).
const buyableNow = () => shopCatalog().filter((n) => isShopItem(n.price, n.s) && itemUnlocked(n.s));

// ---------- The gold "(new)" trail (client/src/shop-markers.js holds the pure logic) ----------
// TWO marker keys, on purpose (DECISIONS §111), plus one housekeeping key:
//   shopSeenNew:<id>      "the shop has been OPENED since these rows unlocked" → the Loadout menu "(new)"
//                         + the Shop-button "(new)"; written by markShopItemsSeen() on `open-shop`.
//   shopItemsClicked:<id> "this specific ROW has been clicked in the shop list" → the gold type-tab + the
//                         gold row; written by markShopItemClicked() on `shop-item`.
// One key could not serve both: opening the shop would mark everything seen and kill every gold frame
// before it could render. A third, non-marker key records which GATE KINDS those baselines were taken
// under (shopMarkerKinds), so a release that introduces a gate kind doesn't announce gear the player
// already owns — see primeShopItemsSeen.
const seenKey = () => `shopSeenNew:${G.playerId || 'anon'}`;
const clickedKey = () => `shopItemsClicked:${G.playerId || 'anon'}`;
const kindsKey = () => `shopMarkerKinds:${G.playerId || 'anon'}`; // the gate kinds this device's baselines were taken under
// null = this device has NO baseline yet (never primed). A corrupt value reads as null too, which
// re-primes rather than re-arming — a storage hiccup must not invent a marker that isn't.
const readSet = (key) => {
  try { const raw = localStorage.getItem(key); return raw == null ? null : new Set(JSON.parse(raw)); }
  catch { return null; }
};
const writeSet = (key, refs) => { try { localStorage.setItem(key, JSON.stringify(refs)); } catch { /* private mode */ } };
const gatedRefsNow = () => gatedRefs(buyableNow());

export function hasNewShopItems() {
  if (!(G.activeShip && G.activeShip.shopUnlocked)) return false; // nothing to look at while the shop is shut
  return hasNew(gatedRefsNow(), readSet(seenKey()));
}
export function markShopItemsSeen() { writeSet(seenKey(), gatedRefsNow()); }   // prune-to-unlocked on every write
// Clicking a row in the shop list IS seeing that item (not buying it, not merely opening its detail card).
function markShopItemClicked(kind, refId) {
  const gated = gatedRefsNow();
  const clicked = readSet(clickedKey()) || new Set();
  clicked.add(`${kind}:${refId}`);
  writeSet(clickedKey(), prune(gated, clicked));
}
// Establish the baseline at bootstrap for BOTH keys: whatever is already unlocked the first time we look
// counts as ALREADY SEEN. Without it, shipping a gate to a live game would tell every player who cleared it
// months ago that their long-owned gear is new — and would light gold frames all over a shop they have
// shopped in for weeks. A player short of a gate baselines to the empty set, so clearing it later still
// lights the trail.
//
// THREE cases, all handled here:
//  (a) NO baseline on this device → adopt everything unlocked right now (the original first-sight rule).
//  (b) An EXISTING baseline taken under FEWER gate kinds than the catalog has today → absorb the rows that
//      just became gated and are already unlocked. Without (b), this very release would fire "(new)" on
//      every grandfathered device: their gated set jumps from 3 rows to 5 (Ion engine + Nanobot repair
//      become gated-and-unlocked), and the stored `shopSeenNew` set only holds the 3. Keyed off gate KINDS,
//      not item ids, so it works for the next gate kind too — and it leaves a pending marker for an
//      already-known kind alone.
//  (c) An EXISTING baseline holding refs that are no longer unlocked (a progress reset / wipe relocked
//      them) → PRUNE both, every prime. `markShopItemsSeen` prunes `seen` on every shop-open, but nothing
//      prunes `clicked` unless a row is clicked — so a reset player who reopens the shop without clicking
//      anything kept a stale `clicked` set, and on re-earning the tier the menu "(new)" fired with no
//      matching gold in the shop. Same dead-end the `clicked`-from-`seen` seeding exists to prevent, for a
//      different cohort. Pruning is idempotent and cannot resurrect or swallow a marker: it only drops
//      refs the shop does not list right now.
export function primeShopItemsSeen() {
  // The gate sources must have arrived, or gatedRefsNow() fails closed to [] and bakes in a baseline that
  // says "nothing was unlocked" for a player who is in fact past the gates.
  if (!(G.activeShip && Array.isArray(G.activeShip.reachedLevels) && Array.isArray(G.activeShip.clearedMissions))) return;
  const unlocked = buyableNow();
  const refs = gatedRefs(unlocked);
  const known = readSet(kindsKey()); // null = a device from before this key existed
  const absorb = absorbRefs(unlocked, known ? [...known] : LEGACY_GATE_KINDS);
  // The decision itself is pure and unit-tested (shop-markers.js primeSets): first sight adopts what is
  // unlocked, a device with a `seen` but no `clicked` seeds `clicked` from `seen`, and every existing
  // baseline is absorbed + PRUNED. This function only does the I/O.
  const next = primeSets({ refs, absorb, seen: readSet(seenKey()), clicked: readSet(clickedKey()) });
  writeSet(seenKey(), next.seen);
  writeSet(clickedKey(), next.clicked);
  writeSet(kindsKey(), GATE_KINDS); // the baselines now know every gate kind the catalog can carry
}

// ---------- Loadout screen (Slice C): centered ship + slots around it + a right context panel ----------
// The 3D ship in the middle. Built lazily the first time the Loadout view is visible; runs while shown.
function ensureLoadoutViewer(active) {
  const canvas = document.getElementById('loadout-ship');
  if (!canvas) return;
  if (!loadoutViewer) {
    // Loadout ship: no auto-spin, default top-down view (nose up), drag to rotate.
    loadoutViewer = buildModelViewer(canvas, { autoRotate: false });
    setTopDownView(loadoutViewer);
    enableOrbit(loadoutViewer);
  }
  const ship = active.ship;
  if (ship) setViewerModel(loadoutViewer, ship.modelUrlHigh || ship.modelUrl, shipModelCfg(ship.stats));
  resizeViewer(loadoutViewer);
  startViewer(loadoutViewer);
}
export function stopLoadoutPreview() { stopViewer(loadoutViewer); disposeViewer(shopModelViewer); shopModelViewer = null; }
// Diagnostic accessor for the headless visual tests (read via the ?debug __game hook) — the live item
// viewer behind #shop-model, so a scenario can assert both WHICH glb is shown and that an animated one
// (the thruster's flame) is actually being clocked by its AnimationMixer.
export const shopItemViewer = () => shopModelViewer;
// The 3D model URL + cfg for a catalog item (weapon or component), or null if it has no model.
function itemModel(kind, refId) {
  const it = kind === 'weapon' ? CATALOG.weapons.get(refId) : CATALOG.components.get(refId);
  if (!it) return null;
  const url = it.modelUrlHigh || it.modelUrl || (it.stats && (it.stats.modelUrlHigh || it.stats.modelUrl));
  return url ? { url, cfg: itemModelCfg(it) } : null;
}
// Spin an item's 3D model in the panel's #shop-model canvas (used by BOTH the shop detail card and the
// selected-slot detail). Rebuilds the viewer each time (the canvas is recreated on every panel re-render)
// — the old one is disposed to free its WebGL context. No-op if there's no canvas (item has no model).
function showItemModel(kind, refId) {
  disposeViewer(shopModelViewer); shopModelViewer = null;
  const canvas = document.getElementById('shop-model');
  if (!canvas) return;
  shopModelViewer = buildModelViewer(canvas);
  const m = itemModel(kind, refId);
  if (m) setViewerModel(shopModelViewer, m.url, m.cfg);
  resizeViewer(shopModelViewer);
  startViewer(shopModelViewer);
}

// The equipped item in a slot (component slot key or weapon group), normalized — or null if empty.
function equippedInSlot(active, slotKey) {
  if (GROUP_WEAPON_TYPE[slotKey]) {
    const mount = (active.loadout && active.loadout.mounts || []).find((m) => m.group === slotKey);
    return mount ? normWeapon(CATALOG.weapons.get(mount.weapon)) : null;
  }
  const id = (active.components || {})[slotKey];
  return id != null ? normComponent(CATALOG.components.get(id)) : null;
}
// Stash items that fit a slot (one of the group's accepted weapon types, or the component type).
function stashForSlot(slotKey) {
  const asWeapon = !!GROUP_WEAPON_TYPE[slotKey];
  return ((shopData && shopData.stash) || []).map(normStash)
    .filter((n) => asWeapon
      ? (n.kind === 'weapon' && slotAcceptsWeaponType(slotKey, n.type))
      : (n.kind === 'component' && n.type === slotKey));
}

// The slot chips around the ship: each = its slot label + the equipped item name (or "empty").
function renderSlots(active) {
  const host = document.getElementById('loadout-slots');
  if (!host) return;
  const groups = Object.keys((active.ship && active.ship.stats && active.ship.stats.groups) || {});
  host.innerHTML = [...COMPONENT_SLOTS, ...groups].map((slotKey) => {
    const pos = SLOT_LAYOUT[slotKey] || { top: '50%', left: '50%' };
    const item = equippedInSlot(active, slotKey);
    const cls = ['slot-chip'];
    if (selectedSlot === slotKey) cls.push('selected');
    if (!item) cls.push('empty');
    if (!item && REQUIRED_SLOTS.includes(slotKey)) cls.push('required');
    return `<button class="${cls.join(' ')}" data-act="slot" data-slot="${esc(slotKey)}" style="top:${pos.top};left:${pos.left}">
      <span class="sc-type">${esc(slotLabel(slotKey))}</span>
      <span class="sc-name">${esc(item ? item.name : t('ui.shop.empty'))}</span>
    </button>`;
  }).join('');
}

// Name (+ "(owned ×N)" when n.owned > 0) and the stat line — the head of every item block.
function itemHeader(n) {
  const stats = statLine(n.kind, n.type, n.s, n.weight);
  const owned = n.owned > 0 ? ` <span class="owned-badge">${esc(t('ui.shop.owned', { n: n.owned }))}</span>` : '';
  return `<div class="lp-name">${esc(n.name)}${owned}</div>${stats ? `<div class="lp-stats">${esc(stats)}</div>` : ''}`;
}
// The item's 3D model canvas, or a graceful placeholder when it has no glb yet (most gear).
function itemModelSlot(kind, refId) {
  return itemModel(kind, refId)
    ? '<canvas id="shop-model" class="lp-model"></canvas>'
    : `<div class="lp-model lp-model-empty">${esc(t('ui.shop.no_model'))}</div>`;
}

// One item's info block at the top of the panel (name + stat line + its 3D model + an action-button row).
function itemInfo(n, actionsHtml) {
  return `<div class="lp-item">
    ${itemHeader(n)}
    ${itemModelSlot(n.kind, n.refId)}
    ${actionsHtml ? `<div class="lp-acts">${actionsHtml}</div>` : ''}
  </div>`;
}

// The right context panel: the selected slot's detail (equipped info + stash replacements) or the shop.
function renderPanel(active, unlocked) {
  const host = document.getElementById('loadout-panel');
  if (!host) return;
  if (panelMode === 'shop' && unlocked) { renderShopPanel(); return; }
  const parts = [];
  let focus = null; // the item whose 3D model is shown at the top (equipped or the picked stash part)
  if (!selectedSlot) {
    parts.push(`<div class="lp-hint">${esc(t('ui.shop.select_slot'))}</div>`);
  } else {
    const equipped = equippedInSlot(active, selectedSlot);
    const repl = unlocked ? stashForSlot(selectedSlot) : [];
    const picked = selectedStashRef && repl.find((r) => r.kind === selectedStashRef.kind && r.refId === selectedStashRef.refId);
    if (picked) {
      // a stash part is selected → its info (+ 3D model) + Install/Replace, with Sell pushed to the right
      const label = equipped ? 'ui.shop.action.replace' : 'ui.shop.action.install';
      const acts = `<button class="primary" data-act="install" data-kind="${picked.kind}" data-ref-id="${picked.refId}">${esc(t(label))}</button>`
        + `<button data-act="sell" data-kind="${picked.kind}" data-ref-id="${picked.refId}">${esc(t('ui.shop.action.sell'))}</button>`;
      parts.push(itemInfo(picked, acts));
      focus = picked;
    } else if (equipped) {
      // the equipped part → its info (+ 3D model) + Remove
      const removeBtn = unlocked ? `<button data-act="unequip" data-slot="${esc(selectedSlot)}">${esc(t('ui.shop.action.remove'))}</button>` : '';
      parts.push(itemInfo(equipped, removeBtn));
      focus = equipped;
    } else {
      parts.push(`<div class="lp-hint">${esc(t('ui.shop.slot_empty'))}</div>`);
    }
    if (unlocked) {
      if (repl.length) {
        parts.push(`<div class="lp-sub">${esc(t('ui.shop.in_stash'))}</div>`);
        parts.push('<div class="lp-list">' + repl.map((n) => {
          const sel = selectedStashRef && selectedStashRef.kind === n.kind && selectedStashRef.refId === n.refId;
          return `<button class="lp-row${sel ? ' selected' : ''}" data-act="pick-stash" data-kind="${n.kind}" data-ref-id="${n.refId}">${esc(n.name)}${n.qty > 1 ? ` ×${n.qty}` : ''}</button>`;
        }).join('') + '</div>');
      } else {
        parts.push(`<div class="lp-hint sub">${esc(t('ui.shop.no_replacement'))}</div>`);
      }
    }
  }
  // The Shop button carries the same gold "(new)" as the Loadout menu item when a newly unlocked item is
  // still waiting — the marker leads the player from the menu, through Loadout, all the way to the shelf.
  const shopNew = hasNewShopItems() ? `<span class="mw-new show">${esc(t('ui.mainwin.new'))}</span>` : '';
  const foot = unlocked ? `<div class="lp-foot"><button class="primary" data-act="open-shop">${esc(t('ui.shop.shop'))}${shopNew}</button></div>` : '';
  host.innerHTML = `<div class="lp-scroll">${parts.join('')}</div>${foot}`;
  if (focus) showItemModel(focus.kind, focus.refId);           // spin the focused item's model
  else { disposeViewer(shopModelViewer); shopModelViewer = null; } // nothing focused → free the context
}

// A shop list row — clickable (opens the detail card) with an inline Buy.
function shopRow(n, gold = false) {
  return `<div class="lp-shop-item${gold ? ' new' : ''}" data-act="shop-item" data-kind="${n.kind}" data-ref-id="${n.refId}">
    ${itemHeader(n)}
    <div class="lp-acts"><span class="price">${esc(priceLabel(n.price))}</span><button class="primary" data-act="buy" data-kind="${n.kind}" data-ref-id="${n.refId}">${esc(t('ui.shop.action.buy'))}</button></div>
  </div>`;
}
// The shop detail card (spec): characteristics at the top, the 3D model below, a Buy button below that,
// and a Back button at the bottom that returns to the list.
function renderShopDetail() {
  const host = document.getElementById('loadout-panel');
  const { kind, refId } = selectedShopItem;
  const it = kind === 'weapon' ? CATALOG.weapons.get(refId) : CATALOG.components.get(refId);
  const n = kind === 'weapon' ? normWeapon(it) : normComponent(it);
  if (!n) { selectedShopItem = null; return renderShopPanel(); }
  n.owned = ownedCount(kind, refId);
  host.innerHTML = `<div class="lp-scroll"><div class="lp-detail">
      ${itemHeader(n)}
      ${itemModelSlot(kind, refId)}
      <div class="lp-acts"><span class="price">${esc(priceLabel(n.price))}</span><button class="primary" data-act="buy" data-kind="${n.kind}" data-ref-id="${n.refId}">${esc(t('ui.shop.action.buy'))}</button></div>
    </div></div>
    <div class="lp-foot"><button data-act="shop-list">${esc(t('ui.shop.back'))}</button></div>`;
  showItemModel(kind, refId);
}
function renderShopPanel() {
  if (selectedShopItem) return renderShopDetail();
  disposeViewer(shopModelViewer); shopModelViewer = null; // left the detail → free the model context
  const host = document.getElementById('loadout-panel');
  const all = buyableNow();
  // The gold trail's last leg: a type tab is gold while its section still holds a row the player has never
  // clicked (DERIVED — the tab has no state of its own), and that row is gold inside the section.
  const clicked = readSet(clickedKey());
  const goldSections = unseenSections(all, clicked);
  const goldRefs = new Set(unseenItems(all, clicked).map(refOf));
  const types = SHOP_TYPES.map((tp) => `<button class="lp-type${tp === shopType ? ' active' : ''}${goldSections.has(tp) ? ' new' : ''}" data-act="type" data-type="${tp}">${esc(t(`ui.shop.filter.${tp}`))}</button>`).join('');
  const items = all.filter((n) => (shopType === 'weapon' ? n.kind === 'weapon' : n.type === shopType));
  for (const n of items) n.owned = ownedCount(n.kind, n.refId);
  const list = items.length ? items.map((n) => shopRow(n, goldRefs.has(refOf(n)))).join('') : `<div class="lp-hint">${esc(t('ui.shop.empty_shop'))}</div>`;
  host.innerHTML = `<div class="lp-scroll"><div class="lp-types">${types}</div><div class="lp-list shop">${list}</div></div>
    <div class="lp-foot"><button data-act="close-shop">${esc(t('ui.shop.back'))}</button></div>`;
}

// The Loadout item always opens the same screen; reset to the slot panel + re-render (starts the viewer).
export function showBayView() { panelMode = 'slot'; selectedSlot = null; selectedStashRef = null; if (shopData && shopData.activeShip) renderBay(); }

// THE launch gate (DECISIONS §100): a required slot (hull/armor, engine, thruster) left empty → the server
// reports `launchable: false` and NOTHING in the base menu may take the ship out. This is the only copy of
// the predicate; every launcher checks it in its own handler (mainwindow.js takeOff / #mw-go /
// #mw-mission-nav / the Map's onAutopilot, welcome.js takeOff), and updateTakeoffGate mirrors it onto the
// buttons. The in-flight overlay map is ungated on purpose: in roam the ship has already launched.
export function canLaunch(active = G.activeShip) {
  return !active || active.launchable !== false;
}

// Reflect the gate on the global launch controls: the side-mission launch (#mw-go), Take off (#mw-takeoff)
// and the briefing's "Autopilot to destination" (#mw-mission-nav). The reason goes in ONE place,
// #mw-takeoff-note under the launch bar (the Map view shows it via its own action note instead).
export function updateTakeoffGate(active) {
  const ok = canLaunch(active);
  for (const id of ['mw-go', 'mw-takeoff', 'mw-mission-nav']) {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !ok;
  }
  const note = document.getElementById('mw-takeoff-note');
  if (note) note.textContent = ok ? '' : t('ui.shop.cant_launch');
}

export function renderBay() {
  if (!shopData || !shopData.activeShip) return;
  const active = shopData.activeShip;
  const unlocked = !!shopData.shopUnlocked;
  document.getElementById('bay-credits-val').textContent = shopData.credits ?? 0;
  updateMenuCredits(shopData.credits); // buying/selling moves the balance → refresh the top-bar readout too
  renderShipStatsBar(deriveShipStats(active)); // right column, above the panel — the real build, skills included
  document.getElementById('mw-loadout-locked').style.display = unlocked ? 'none' : 'block';
  if (document.getElementById('mw-view-bay').classList.contains('active')) ensureLoadoutViewer(active); // spin the ship only while the screen is shown
  renderSlots(active);
  renderPanel(active, unlocked);
  updateTakeoffGate(active);
}

const setShopNote = (msg) => { document.getElementById('mw-bay-note').textContent = msg; };
function shopErr(status, j) {
  if (status === 402) return t('ui.shop.err_credits');
  if (status === 403) return t('ui.shop.err_locked');
  return (j && j.error) || t('ui.shop.err_generic');
}
// Apply a fresh server state: update globals, rebuild the 3D player to reflect the new loadout, re-render.
function applyShopState(j) {
  shopData = j;
  selectedStashRef = null; // the stash changed under us → re-evaluate the panel selection
  // rebuildActiveShip: immediate on the base menu, deferred to the next enterMenu if the response lands after Take off
  if (j.activeShip) { G.activeShip = j.activeShip; G.balance = j.credits; rebuildActiveShip(); }
  updateHud();
  renderBay();
}
async function shopAction(path, body) {
  if (shopBusy || !G.playerId) return;
  shopBusy = true; setShopNote('');
  try {
    const r = await fetch(API_BASE + `/api/players/${G.playerId}/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setShopNote(shopErr(r.status, j)); return; }
    applyShopState(j);
  } catch { setShopNote(t('ui.shop.err_network')); }
  finally { shopBusy = false; }
}

// ---- Sell confirmation + quantity (docs/plans/2026-08-09-sell-confirm-quantity.md) ----
// Selling stash gear now goes through a confirm modal that shows the sale price (75% of catalog, via
// `sellPrice` — the same function the server's /sell uses) and, when the stash holds more than one, a
// slider + number to choose how many to sell.
let pendingSell = null; // { kind, refId, max, unit } while the modal is open
const sellEl = (id) => document.getElementById(id);
function sellQtyClamped(v) { return Math.max(1, Math.min(pendingSell ? pendingSell.max : 1, parseInt(v, 10) || 1)); }
function refreshSellTotal() {
  if (!pendingSell) return;
  sellEl('sell-total-val').textContent = priceLabel(pendingSell.unit * sellQtyClamped(sellEl('sell-qty-range').value));
}
function syncSellQty(from) { // keep the slider + number field in lockstep, clamped to [1, max]
  const v = sellQtyClamped(from.value);
  sellEl('sell-qty-range').value = String(v); sellEl('sell-qty-num').value = String(v);
  refreshSellTotal();
}
function openSellConfirm(kind, refId) {
  const row = ((shopData && shopData.stash) || []).find((s) => s.kind === kind && s.refId === refId);
  if (!row) return; // sold out from under us → no-op
  pendingSell = { kind, refId, max: row.qty, unit: sellPrice(row.price) };
  sellEl('sell-item-name').textContent = row.name;
  const multi = row.qty > 1;
  sellEl('sell-qty-row').style.display = multi ? '' : 'none';
  sellEl('sell-qty-max').textContent = multi ? t('ui.shop.sell.in_stash', { n: row.qty }) : '';
  for (const id of ['sell-qty-range', 'sell-qty-num']) { const el = sellEl(id); el.min = '1'; el.max = String(row.qty); el.value = '1'; }
  refreshSellTotal();
  sellEl('sell-overlay').classList.add('on');
}
function closeSellConfirm() { pendingSell = null; sellEl('sell-overlay').classList.remove('on'); }
function confirmSell() {
  if (!pendingSell) return;
  const { kind, refId } = pendingSell;
  const qty = sellQtyClamped(sellEl('sell-qty-range').value);
  closeSellConfirm();
  shopAction('sell', { kind, refId, qty });
}
sellEl('sell-qty-range').addEventListener('input', (e) => { if (pendingSell) syncSellQty(e.target); });
sellEl('sell-qty-num').addEventListener('input', (e) => { if (pendingSell) syncSellQty(e.target); });
sellEl('sell-cancel').addEventListener('click', closeSellConfirm);
sellEl('sell-do').addEventListener('click', confirmSell);
sellEl('sell-overlay').addEventListener('click', (e) => { if (e.target === sellEl('sell-overlay')) closeSellConfirm(); }); // backdrop

// One delegated click handler for the whole Loadout screen. The slot chips live in the center work zone
// (#mw-view-bay) and the context panel in the right column (#loadout-panel) — attach to both.
function onLoadoutClick(e) {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const active = shopData && shopData.activeShip;
  const unlocked = !!(shopData && shopData.shopUnlocked);
  if (act === 'slot') { selectedSlot = el.dataset.slot; selectedStashRef = null; panelMode = 'slot'; renderSlots(active); renderPanel(active, unlocked); return; }
  if (act === 'pick-stash') { selectedStashRef = { kind: el.dataset.kind, refId: Number(el.dataset.refId) }; renderPanel(active, unlocked); return; }
  if (act === 'open-shop') {
    // Opening the shop IS seeing the new gear (not merely opening Loadout): mark it seen, then clear both
    // the Shop-button "(new)" (gone once the panel switches to shop mode) and the Loadout menu "(new)".
    markShopItemsSeen();
    document.dispatchEvent(new CustomEvent('shop-items-seen'));
    panelMode = 'shop'; selectedShopItem = null; renderPanel(active, unlocked); return;
  }
  if (act === 'close-shop') { panelMode = 'slot'; selectedShopItem = null; renderPanel(active, unlocked); return; }
  if (act === 'type') { shopType = el.dataset.type; selectedShopItem = null; renderShopPanel(); return; }
  if (act === 'shop-item') {
    // Clicking the ROW is what marks the item seen (the maintainer's call: not buying it, not the detail
    // card) — do it before rendering so returning to the list shows the gold already gone.
    markShopItemClicked(el.dataset.kind, Number(el.dataset.refId));
    selectedShopItem = { kind: el.dataset.kind, refId: Number(el.dataset.refId) };
    renderShopPanel(); return;                                   // open the detail card (stats + 3D model)
  }
  if (act === 'shop-list') { selectedShopItem = null; renderShopPanel(); return; } // Back → the item list
  const kind = el.dataset.kind, slot = el.dataset.slot;
  const refId = el.dataset.refId != null ? Number(el.dataset.refId) : null;
  if (act === 'install' || act === 'equip') return void shopAction('equip', { kind, refId });
  if (act === 'buy') return void shopAction('buy', { kind, refId });
  if (act === 'sell') return void openSellConfirm(kind, refId);
  if (act === 'unequip') return void shopAction('unequip', { slot });
}
document.getElementById('mw-view-bay').addEventListener('click', onLoadoutClick);   // slot chips (center)
document.getElementById('loadout-panel').addEventListener('click', onLoadoutClick);  // context panel (right column)

// Prepare the Loadout screen when the Main Window opens. Before the shop unlocks it's read-only (ship +
// slots shown, no stash/shop, a hint); once unlocked we fetch fresh state (authoritative loadout/stash).
export async function openBay() {
  const unlocked = !!(G.playerId && G.activeShip && G.activeShip.shopUnlocked);
  panelMode = 'slot'; selectedSlot = null; selectedStashRef = null;
  lastShipStats = null; // first render after opening shows no deltas
  if (!unlocked) {
    shopData = { credits: (G.activeShip && G.activeShip.credits) ?? G.balance ?? 0, shopUnlocked: false, stash: [], activeShip: G.activeShip };
    if (shopData.activeShip) renderBay();
    updateTakeoffGate(G.activeShip);
    return;
  }
  try {
    await missionClearDone(); // a just-cleared side mission must be committed before this read, or its
                              // gated rows stay hidden (and the "(new)" trail stays dark) until next landing
    const j = await fetchJson(`/api/players/${G.playerId}/stash`);
    shopData = j;
    if (j.activeShip) G.activeShip = j.activeShip;
    renderBay();
  } catch {}
}
