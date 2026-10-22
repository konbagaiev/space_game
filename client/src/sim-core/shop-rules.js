// Is this catalog row for sale in the hangar shop? ONE rule for the shop list (shop.js buyableNow), the
// drop rarity (catalog_seed.js classifyRarity) and the server's buy gate (db.js buyItem). Takes price +
// stats separately because the two sides shape rows differently (client weapons are flattened: s = row).
// Level/mission gates (minLevel/minMission) are a separate, player-dependent check — not this rule.
// Lives under sim-core because the server may import from client/ but never the other way (DECISIONS §136);
// keep it free of three/DOM imports.
export const isShopItem = (price, stats) => (price | 0) > 0 && !(stats && stats.buyable === false);
