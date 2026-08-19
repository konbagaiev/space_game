// Pure (THREE-free) autopilot dock/win constants + predicate, extracted from sim.js so it is
// node-testable (see autopilot-config.test.js). The autopilot flies the ship to a typed target — the
// base station OR a loot drop — but ONLY a station-targeted, engaged autopilot within the arrive radius
// may dock/win the mission. A chest-aimed autopilot must be structurally incapable of winning.
export const BASE_ARRIVE_RADIUS = 45; // horizontal distance to the station that ends autopilot + wins

// The dock/win predicate: true ONLY for a station-targeted, engaged autopilot within the arrive radius.
// A drop-targeted autopilot can never dock. Pure (no THREE) → node-testable.
export function canDock(autopilot, dist) {
  return !!autopilot && autopilot.active && autopilot.target?.kind === 'station' && dist <= BASE_ARRIVE_RADIUS;
}
