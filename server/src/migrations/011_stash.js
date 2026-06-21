// 011 — hangar shop + stash (docs/plans/hangar-shop.md). The "spend" side of the economy: a player
// inventory (`stash`), buy/sell, equip/unequip. Server-authoritative + transactional.
//   - `stash`: items a player owns but hasn't equipped. Qty model, keyed by (player_id, kind, ref_id);
//     `kind` ∈ {component, weapon} (two separate id-spaces → components.id / weapons.id). One row per
//     instance only later, if items gain individual state (upgrades/wear).
//   - `price`: a top-level catalog field (like components.weight). Seeded 0 for now (economy inert);
//     real prices slot in later. Sell price is floor(price * 0.75), computed server-side.
//   - `players.shop_unlocked`: the shop/stash unlocks only after the player clears the last level
//     (level 3 today). current_progress can't move past the final level, so a flag tracks "cleared".
export const up = (db) => {
  db.exec(`
    CREATE TABLE IF NOT EXISTS stash (
      player_id TEXT    NOT NULL,            -- the owning player (logical FK to players)
      kind      TEXT    NOT NULL,            -- 'component' | 'weapon' (separate id-spaces)
      ref_id    INTEGER NOT NULL,            -- components.id / weapons.id
      qty       INTEGER NOT NULL DEFAULT 1,
      UNIQUE (player_id, kind, ref_id)
    );
    CREATE INDEX IF NOT EXISTS idx_stash_player ON stash(player_id);
    ALTER TABLE components ADD COLUMN price INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE weapons    ADD COLUMN price INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE players    ADD COLUMN shop_unlocked INTEGER NOT NULL DEFAULT 0;
  `);
};
