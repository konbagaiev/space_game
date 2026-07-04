// Hangar shop + stash (docs/plans/hangar-shop.md). The "spend" side of the economy: equipped loadout +
// stash + a simple shop, with a live ship-stats panel (HP / acceleration / maneuverability / weight) that
// shows the delta vs the previous config. The server stays authoritative — every action posts to an
// endpoint and re-renders from the response. A leaf module: the Main Window calls in (openBay/showBayView/
// updateTakeoffGate/renderShipStatsBar/deriveShipStats); nothing here calls back out into the UI.
import { esc, slotLabel, priceLabel, sellLabel } from './format.js';
import { G, CATALOG } from './state.js';
import { shipMass, deriveDrive } from './components.js';
import { resolveComponents, buildPlayerFor } from './ship-build.js';
import { updateHud } from './hud.js';
import { fetchJson } from './net.js';
import { API_BASE } from './api-base.js';
import { t } from './i18n.js';

let shopData = null;     // { credits, shopUnlocked, stash, activeShip } — last server state
let bayView = 'loadout'; // which screen is open: 'loadout' | 'stash' | 'shop' (separate screens, not columns)
let shopType = 'hull';   // selected type in the two-pane shop ('hull'|'engine'|'thruster'|'repair'|'weapon')
let shopBusy = false;    // guard against double-submits
let lastShipStats = null; // previous ship-stats snapshot (for the delta arrows)
const REQUIRED_SLOTS = ['hull', 'engine', 'thruster']; // can't be empty at take-off

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
    else if (type === 'engine') { add('ui.shop.stat.accel', s.power); add('ui.shop.stat.maxspeed', s.maxSpeed); }
    else if (type === 'thruster') add('ui.shop.stat.maneuver', s.power);
    else if (type === 'repair') {
      parts.push(`${t('ui.shop.stat.heal')} +${s.repairPerTick}/${s.intervalSec}s`);
      if (s.maxFraction != null) parts.push(`${t('ui.shop.stat.cap')} ${Math.round(s.maxFraction * 100)}%`);
    }
    else if (type === 'grab') add('ui.shop.stat.grab', s.strength); // tractor: range = strength (world units)
  } else { // weapon
    // Triple spiral rocket fires 3 real warheads, each dealing `power` — show the per-warhead × count
    // so the shop reflects the true on-hit damage (40×3), not one warhead's 40. (See catalog id 11.)
    add('ui.shop.stat.dmg', s.spiral ? `${s.power}×3` : s.power);
    if (s.fireCooldown) parts.push(type === 'rocket'
      ? `${t('ui.shop.stat.reload')} ${s.fireCooldown}s`
      : `${t('ui.shop.stat.rof')} ${(1 / s.fireCooldown).toFixed(1)}/s`);
    add('ui.shop.stat.speed', s.projectileSpeed);
    add('ui.shop.stat.range', s.maxRange);
    add('ui.shop.stat.blast', s.blastRadius);
  }
  if (typeof weight === 'number') add('ui.shop.stat.weight', weight);
  return parts.join(' · ');
}

// Derive the ship's HP / acceleration / maneuverability / weight client-side from a candidate config
// (the server stays authoritative on the saved config; this is just for the live preview panel).
export function deriveShipStats(components, mounts) {
  const rc = resolveComponents(components);
  const ship = {
    hull: rc.hull, engine: rc.engine, thruster: rc.thruster, repair: rc.repair, grab: rc.grab, // grab weighs into mass — must be spread in explicitly (rc isn't spread)
    mounts: (mounts || []).map((m) => ({ weapon: CATALOG.weapons.get(m.weapon) })).filter((m) => m.weapon),
  };
  const weight = shipMass(ship);
  let acceleration = 0, turnRate = 0;
  if (rc.engine) { deriveDrive(ship); acceleration = ship.acceleration; turnRate = ship.turnRate; }
  return { hp: rc.hull ? rc.hull.durability : 0, acceleration, turnRate, weight };
}

// Render the live stats bar with ▲/▼ deltas vs the previous config (green = better, red = worse;
// for weight, lighter is better so the colors invert while the arrow still tracks the raw direction).
export function renderShipStatsBar(st) {
  const host = document.getElementById('ship-stats');
  const defs = [
    { key: 'hp', label: t('ui.shop.stat.hp'), dp: 0 },
    { key: 'acceleration', label: t('ui.shop.stat.accel'), dp: 1 },
    { key: 'turnRate', label: t('ui.shop.stat.maneuver'), dp: 2 },
    { key: 'weight', label: t('ui.shop.stat.weight'), dp: 0, lowerBetter: true },
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

// One item card. `actions` is an array of { act, label, cls } → buttons with data-* the click
// delegator reads. Stats are hidden by default; the (i) button reveals them (mobile), and the
// card's title shows them on hover (desktop).
function itemCard(n, slotTag, actions, priceMode = null, extraClass = '') {
  const stats = statLine(n.kind, n.type, n.s, n.weight);
  // header row: name (ellipsizes) · slot tag (loadout) · (i) — own cells, no overlap. The price cell goes
  // in the foot next to the action button(s): `priceMode` picks 'buy' (Shop → full catalog price) vs
  // 'sell' (Stash/Loadout → resale value, what the player gets); null → no price.
  const slotMeta = slotTag ? `<span class="meta slot-tag">${esc(slotTag)}</span>` : '';
  const priceMeta = (priceMode && n.price != null)
    ? `<span class="meta price">${esc(priceMode === 'sell' ? sellLabel(n.price) : priceLabel(n.price))}</span>`
    : '';
  const qty = n.qty > 1 ? ` ×${n.qty}` : '';
  const data = (n.kind && n.refId != null) ? `data-kind="${n.kind}" data-ref-id="${n.refId}"` : '';
  const acts = actions.map((a) => `<button class="${a.cls || ''}" data-act="${a.act}" ${a.slot ? `data-slot="${a.slot}"` : data}>${esc(a.label)}</button>`).join('');
  // "owned" badge (shop only): how many of this item the player already has (equipped + in stash)
  const owned = n.owned > 0 ? `<span class="owned-badge">${esc(t('ui.shop.owned', { n: n.owned }))}</span>` : '';
  // Two rows, always: the item name (+ owned + info + slot tag) on top, then the price + action button(s)
  // CENTERED on a second row — so a long item name and the price/Buy never have to share one line (they
  // don't fit on a phone). See docs/plans/main-window-redesign.md.
  return `<div class="bay-item ${extraClass}">
    <div class="head">
      <span class="name-text" title="${esc(n.name)}">${esc(n.name)}${qty}</span>
      ${owned}
      ${stats ? `<button class="info-btn" data-act="info" aria-label="info">i</button>` : ''}
      ${slotMeta}
    </div>
    ${(priceMeta || acts) ? `<div class="foot">${priceMeta}${acts ? `<span class="actions">${acts}</span>` : ''}</div>` : ''}
    ${stats ? `<div class="stats hidden">${esc(stats)}</div>` : ''}
  </div>`;
}

// How many of (kind, refId) the player already owns = equipped on the active ship + qty in the stash.
function ownedCount(kind, refId) {
  let n = 0;
  for (const it of (shopData && shopData.stash) || []) if (it.kind === kind && it.refId === refId) n += it.qty;
  const active = shopData && shopData.activeShip;
  if (active) {
    if (kind === 'component') {
      for (const slot of ['hull', 'engine', 'thruster', 'repair', 'grab']) if (active.components && active.components[slot] === refId) n++;
    } else {
      for (const m of (active.loadout && active.loadout.mounts) || []) if (m.weapon === refId) n++;
    }
  }
  return n;
}

// An empty loadout slot (dashed; required-empty slots are flagged in red — they block take-off).
function emptySlotCard(slot, required) {
  return `<div class="bay-item empty ${required ? 'required-empty' : ''}">
    <div class="head"><span class="name-text">${esc(t('ui.shop.empty'))}</span><span class="meta slot-tag">${esc(slotLabel(slot))}</span></div>
  </div>`;
}

function renderLoadout(active) {
  const host = document.getElementById('loadout-list');
  const comps = active.components || {};
  const groups = Object.keys((active.ship && active.ship.stats && active.ship.stats.groups) || {});
  const rows = [];
  for (const slot of ['hull', 'engine', 'thruster', 'repair', 'grab']) {
    const required = REQUIRED_SLOTS.includes(slot);
    const id = comps[slot];
    if (id == null) { if (slot !== 'repair' && slot !== 'grab') rows.push(emptySlotCard(slot, required)); continue; } // hide an empty optional repair/grab slot
    const actions = [{ act: 'unequip', label: t('ui.shop.action.unequip'), slot }];
    if (!required) actions.push({ act: 'sell-equipped', label: t('ui.shop.action.sell'), cls: 'sell', slot });
    rows.push(itemCard(normComponent(CATALOG.components.get(id)), slotLabel(slot), actions, 'sell'));
  }
  for (const g of groups) {
    const mount = (active.loadout && active.loadout.mounts || []).find((m) => m.group === g);
    if (!mount) { rows.push(emptySlotCard(g, false)); continue; }
    const actions = [
      { act: 'unequip', label: t('ui.shop.action.unequip'), slot: g },
      { act: 'sell-equipped', label: t('ui.shop.action.sell'), cls: 'sell', slot: g },
    ];
    rows.push(itemCard(normWeapon(CATALOG.weapons.get(mount.weapon)), slotLabel(g), actions, 'sell'));
  }
  host.innerHTML = rows.join('');
}

function renderStash(stash) {
  const host = document.getElementById('stash-list');
  if (!stash.length) { host.innerHTML = `<div class="bay-empty-note">${esc(t('ui.shop.empty_stash'))}</div>`; return; }
  host.innerHTML = stash.map((it) => {
    const n = normStash(it);
    const actions = [
      { act: 'equip', label: t('ui.shop.action.install'), cls: 'primary' },
      { act: 'sell', label: t('ui.shop.action.sell'), cls: 'sell' },
    ];
    return itemCard(n, null, actions, 'sell');
  }).join('');
}

// The shop is a two-pane screen: a type list (left) → the items of that type (right). It lists buyable
// items only — catalog entries with price > 0 (economy-shop-v2.md). Enemy/starter parts are priced 0 and
// stay hidden; the player ladder (priced) shows. Weapons are one of the "types".
const SHOP_TYPES = ['hull', 'engine', 'thruster', 'repair', 'weapon', 'grab'];
function renderShopTypes() {
  document.getElementById('shop-types').innerHTML = SHOP_TYPES.map((tp) =>
    `<button class="${tp === shopType ? 'active' : ''}" data-act="type" data-type="${tp}">${esc(t(`ui.shop.filter.${tp}`))}</button>`).join('');
}
function shopCatalog() {
  const items = [];
  for (const c of CATALOG.components.values()) items.push(normComponent(c));
  for (const w of CATALOG.weapons.values()) items.push(normWeapon(w));
  return items;
}
function renderShop() {
  const host = document.getElementById('shop-list');
  const items = shopCatalog().filter((n) => (n.price ?? 0) > 0 && n.s?.buyable !== false && // enemy parts set stats.buyable:false → resale-only, hidden here
    (shopType === 'weapon' ? n.kind === 'weapon' : n.type === shopType));
  for (const n of items) n.owned = ownedCount(n.kind, n.refId); // tag each with how many you already have
  host.innerHTML = items.length
    ? items.map((n) => itemCard(n, null, [{ act: 'buy', label: t('ui.shop.action.buy'), cls: 'primary' }], 'buy')).join('')
    : `<div class="bay-empty-note">${esc(t('ui.shop.empty_shop'))}</div>`;
}

// Show the active bay screen (Loadout / Stash / Shop). Which one is chosen comes from the left menu
// (which sets `bayView`); this just toggles the matching `.bay-view`.
function renderNav() {
  for (const v of ['loadout', 'stash', 'shop']) document.getElementById('view-' + v).classList.toggle('active', v === bayView);
}
// Called from the Main Window's left menu: select a bay screen + re-render the nav.
export function showBayView(which) { bayView = which; renderNav(); }

// Gate the mission Take-off button: a missing required slot (sold hull/engine/thruster) blocks launch.
export function updateTakeoffGate(active) {
  const btn = document.getElementById('mw-go');
  const note = document.getElementById('mw-go-note');
  const ok = !active || active.launchable !== false;
  btn.disabled = !ok;
  note.textContent = ok ? '' : t('ui.shop.cant_launch');
}

export function renderBay() {
  if (!shopData || !shopData.activeShip) return;
  const active = shopData.activeShip;
  document.getElementById('bay-credits-val').textContent = shopData.credits;
  renderShipStatsBar(deriveShipStats(active.components, active.loadout && active.loadout.mounts));
  renderLoadout(active);
  renderStash(shopData.stash || []);
  renderShopTypes();
  renderShop();
  renderNav();
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
  if (j.activeShip) { G.activeShip = j.activeShip; G.balance = j.credits; if (j.activeShip.ship) buildPlayerFor(j.activeShip.ship); }
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

// One delegated click handler for every bay action (filter / info toggle / buy / sell / equip / unequip).
document.getElementById('mw-view-bay').addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  if (act === 'type') { shopType = el.dataset.type; renderShopTypes(); renderShop(); return; }
  if (act === 'info') { const card = el.closest('.bay-item'); const s = card && card.querySelector('.stats'); if (s) s.classList.toggle('hidden'); return; }
  const kind = el.dataset.kind, slot = el.dataset.slot;
  const refId = el.dataset.refId != null ? Number(el.dataset.refId) : null;
  if (act === 'buy') return void shopAction('buy', { kind, refId });
  if (act === 'equip') return void shopAction('equip', { kind, refId });
  if (act === 'sell') return void shopAction('sell', { kind, refId });
  if (act === 'sell-equipped') return void shopAction('sell', { slot });
  if (act === 'unequip') return void shopAction('unequip', { slot });
});

// Prepare the shop bay when the Main Window opens. The Loadout/Stash/Shop menu items only show once the
// player has unlocked the shop (cleared the final level); when unlocked we fetch fresh state so the
// loadout/stash/balance are authoritative.
export async function openBay() {
  const unlocked = !!(G.playerId && G.activeShip && G.activeShip.shopUnlocked);
  document.querySelectorAll('.mw-shop-item').forEach((b) => b.classList.toggle('mw-hidden', !unlocked));
  if (!unlocked) { updateTakeoffGate(G.activeShip); return; }
  bayView = 'loadout';  // default the bay to the ship/loadout screen
  lastShipStats = null; // first render after opening shows no deltas
  try {
    const j = await fetchJson(`/api/players/${G.playerId}/stash`);
    shopData = j;
    if (j.activeShip) G.activeShip = j.activeShip;
    renderBay();
  } catch {}
}
