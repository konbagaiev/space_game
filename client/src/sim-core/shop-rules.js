// Is this catalog row for sale in the hangar shop? ONE rule for the shop list (shop.js buyableNow), the
// drop rarity (catalog_seed.js classifyRarity) and the server's buy gate (db.js buyItem). Takes price +
// stats separately because the two sides shape rows differently (client weapons are flattened: s = row).
// Level/mission gates (minLevel/minMission) are a separate, player-dependent check — not this rule.
// Lives under sim-core because the server may import from client/ but never the other way (DECISIONS §136);
// keep it free of three/DOM imports.
export const isShopItem = (price, stats) => (price | 0) > 0 && !(stats && stats.buyable === false);

// Equipment slots. COMPONENT_SLOTS in render order (Loadout chips); REQUIRED_SLOTS can't be empty at take-off
// and can't be sold while equipped. One list for the shop UI, the sim's mass sum and the server's gates.
export const REQUIRED_SLOTS = ['hull', 'engine', 'thruster'];
export const COMPONENT_SLOTS = ['hull', 'engine', 'thruster', 'repair', 'grab', 'shield'];

// Resale: the credits a sale pays per unit. ONE rate for the server's /sell and the client's resale labels.
export const SELL_RATE = 0.75;
export const sellPrice = (price) => Math.floor((price | 0) * SELL_RATE);
