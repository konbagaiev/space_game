# Sell confirmation + quantity

**Status:** shipped 2026-08-09 (direct edit). Reference spec for the sell-confirm dialog the code comments
point at.

## Goal

Selling stash gear used to be instant and silent. Now clicking **Sell** on a stash item opens a
**confirmation dialog** that shows the **sale price**, and when the stash holds **more than one** of that
item, a **slider + number field** to choose how many to sell (total updates live).

## Behavior

- The Sell button (right context panel, on a picked stash item — `shop.js` `renderPanel`) opens
  `#sell-overlay` (`openSellConfirm`) instead of selling immediately.
- Dialog shows the item name and **You receive: `N × floor(price·0.75)` ◈** (`SELL_RATE` from `format.js`,
  mirrors the server's `sellPrice`).
- Stash qty > 1 → a range slider + number input (both clamped to `[1, qty]`, kept in lockstep by
  `syncSellQty`); the total recomputes on every change. Qty == 1 → the quantity row is hidden.
- Cancel / backdrop click closes without selling; **Sell** confirms → `shopAction('sell', {kind, refId,
  qty})`.
- Equipped-item sells (via `{slot}`) are untouched — always a single unit, no dialog (the only Sell button
  in the UI is for stash items).

## Server

`sellItem(playerId, { kind, refId, slot, qty = 1 })` (`db.js`): sells `min(qty, owned)` atomically (clamps
to owned to survive a stale/concurrent client count), decrements the stash row by N, credits `N × unit`,
returns `{ ok, sold, unit, refund }`. `POST /api/players/:id/sell` accepts an optional `qty` (positive
integer, 400 otherwise; omitted → 1, back-compatible).

## UI / files

`index.html` `#sell-overlay` markup; `styles.css` `#sell-overlay …` (mirrors the reset-confirm modal, blue
accent); `shop.js` `openSellConfirm`/`confirmSell`/`syncSellQty`; i18n `ui.shop.sell.*` (EN + RU).

## Tests

`server.test.js` — "sell honors a quantity, clamps to what is owned, and rejects a bad qty". Visual
`12-sell-confirm` (buy 3 → Sell → dialog, slider to 3 → total 336, confirm → sold + credited).

## Related fix (same change)

The shop **detail card** Buy button was unstyled (the `.primary` button rules were scoped to
`.lp-item`/`.lp-shop-item`/`.lp-foot`, not `.lp-detail`). Added `.lp-detail .lp-acts button[.primary]` to
those rules so it renders as the same blue button as the shop list.
