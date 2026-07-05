// Pure presentation helpers: HTML-escaping, color formatting, and i18n-aware
// price/slot labels. No shared game state — they take their inputs and return
// strings/numbers. (CATALOG-dependent helpers, e.g. ship stat/mount summaries,
// live closer to the shop code, not here.)
import { t } from './i18n.js';

// Escape user/DB-sourced text before interpolating into innerHTML.
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// 0xRRGGBB int → "#rrggbb" CSS color.
export const cssColor = (hex) => '#' + (hex >>> 0).toString(16).padStart(6, '0').slice(-6);

// Localized slot name (hull/engine/…), falling back to the raw key.
export const slotLabel = (slot) => t(`ui.shop.slot.${slot}`) || slot;

// Buy-price label ("12 ◈" or the localized "Free").
export const priceLabel = (p) => (p > 0 ? `${p} ◈` : t('ui.shop.free'));

// Resale value shown in Stash + Loadout — the amount the player actually gets for selling. Mirrors the
// server's sellPrice (db.js / db_postgres.js): floor(price * 0.75). Keep in sync if the server rate changes.
export const SELL_RATE = 0.75;
export const sellLabel = (p) => (p > 0 ? `${Math.floor(p * SELL_RATE)} ◈` : t('ui.shop.free'));
