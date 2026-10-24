// The five character skills — ONE list for the server (players.skill_* columns, /skills/spend whitelist,
// new-player defaults), the Character screen (card order) and the tools. Order = Character card order.
// Lives in sim-core so the server can import it (DECISIONS §136); keep it free of three/DOM.
export const SKILLS = ['kinetic', 'rocket', 'shields', 'maneuver', 'mobility'];
export const skillColumn = (s) => `skill_${s}`;
