// Data backend selector: PostgreSQL when DATABASE_URL is set (production),
// otherwise SQLite (local dev / tests). Both expose the same async API.
const usePostgres = !!process.env.DATABASE_URL;
const impl = usePostgres ? await import('./db_postgres.js') : await import('./db.js');

export const backend = usePostgres ? 'postgres' : 'sqlite';
export const migrate = (...a) => impl.migrate(...a);
export const registerPlayer = (...a) => impl.registerPlayer(...a);
export const setPlayerLanguage = (...a) => impl.setPlayerLanguage(...a);
export const getCurrentLevel = (...a) => impl.getCurrentLevel(...a);
export const advanceProgress = (...a) => impl.advanceProgress(...a);
export const recordGame = (...a) => impl.recordGame(...a);
export const recordEvent = (...a) => impl.recordEvent(...a);
export const getPlayerGames = (...a) => impl.getPlayerGames(...a);
export const stats = (...a) => impl.stats(...a);
export const getShips = (...a) => impl.getShips(...a);
export const getWeapons = (...a) => impl.getWeapons(...a);
export const getComponents = (...a) => impl.getComponents(...a);
export const getActivePlayerShip = (...a) => impl.getActivePlayerShip(...a);
export const getMap = (...a) => impl.getMap(...a);
export const getLevel = (...a) => impl.getLevel(...a);
// Hangar shop + stash (docs/plans/hangar-shop.md)
export const getStash = (...a) => impl.getStash(...a);
export const buyItem = (...a) => impl.buyItem(...a);
export const sellItem = (...a) => impl.sellItem(...a);
export const equipItem = (...a) => impl.equipItem(...a);
export const unequipItem = (...a) => impl.unequipItem(...a);
// Authentication (DECISIONS §11)
export const getPlayerPublic = (...a) => impl.getPlayerPublic(...a);
export const setUsername = (...a) => impl.setUsername(...a);
export const findPlayerForLogin = (...a) => impl.findPlayerForLogin(...a);
export const emailInUse = (...a) => impl.emailInUse(...a);
export const registerAccount = (...a) => impl.registerAccount(...a);
export const setVerifyToken = (...a) => impl.setVerifyToken(...a);
export const verifyEmailToken = (...a) => impl.verifyEmailToken(...a);
export const createSession = (...a) => impl.createSession(...a);
export const getSessionPlayer = (...a) => impl.getSessionPlayer(...a);
export const deleteSession = (...a) => impl.deleteSession(...a);
