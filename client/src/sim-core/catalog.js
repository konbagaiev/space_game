// One flattening of catalog rows into the shape the simulation reads (`world.catalog`).
//
// Two hosts feed it: the browser with `/api/weapons|components|ships` (main.js bootstrap) and the server
// with the seed arrays (`server/src/sim-host.js buildCatalog`). Before this module each host hand-wrote the
// same loop (duplication audit C8); a host that flattened differently would be a different simulation.
//
// Deliberately NOT here: the level. The browser wraps it in the dev-flag chain and the server stamps
// `enemyTotal` — each host sets `catalog.level`/`levelName` itself after calling this.
//
// Ships are ordered by id on BOTH hosts (DECISIONS §168): `/api/ships` already returns `ORDER BY id`, and the
// server's seed array is sorted the same way here, so the two catalogs are identical. Sim code looks ships up
// by name or unique role; only dev tools index `enemyShips`.

export function emptyCatalog() {
  return { weapons: new Map(), components: new Map(), enemyShips: [], shipByName: new Map(), level: null, levelName: null };
}

// Fill `target` IN PLACE (the browser's CATALOG identity is load-bearing: `world.catalog = CATALOG`) and
// return it. Clears the three maps first, so a refill leaves no stale entries.
export function catalogFromRows({ weapons, components, ships }, target = emptyCatalog()) {
  target.weapons.clear(); target.components.clear(); target.shipByName.clear();
  // Weapons are flattened (stats spread to top level); keep the model URLs too (the `...w.stats` spread
  // also lifts `stats.model` to a top-level `model` key — read by itemModelCfg). Components are stored
  // whole, so their `modelUrlHigh` + nested `stats.model` flow through as-is.
  for (const w of weapons) {
    target.weapons.set(w.id, {
      id: w.id, name: w.name, type: w.type, price: w.price,
      modelUrl: w.modelUrl, modelUrlHigh: w.modelUrlHigh, rarity: w.rarity, color: w.color, ...w.stats,
    });
  }
  // Component and ship rows are stored as the SAME objects (no clone) — sim-host relies on that plus the
  // non-mutating `with*` helpers; never mutate a catalog row in place.
  for (const c of components) target.components.set(c.id, c);
  const byId = [...ships].sort((a, b) => a.id - b.id);  // a COPY: never reorder the caller's array
  target.enemyShips = byId.filter((s) => s.type === 'enemy');
  for (const s of byId) target.shipByName.set(s.name, s);
  return target;
}

// The ship row with this DB/seed id, or null. Ids are explicit in the seed and equal on every database.
export function shipById(catalog, id) {
  for (const s of catalog.shipByName.values()) if (s.id === id) return s;
  return null;
}
