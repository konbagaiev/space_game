// Data backend selector: PostgreSQL when DATABASE_URL is set (production),
// otherwise SQLite (local dev / tests). Both expose the same async API.
const usePostgres = !!process.env.DATABASE_URL;
const impl = usePostgres ? await import('./db_postgres.js') : await import('./db.js');

export const backend = usePostgres ? 'postgres' : 'sqlite';
export const migrate = (...a) => impl.migrate(...a);
export const registerPlayer = (...a) => impl.registerPlayer(...a);
export const recordGame = (...a) => impl.recordGame(...a);
export const getPlayerGames = (...a) => impl.getPlayerGames(...a);
export const stats = (...a) => impl.stats(...a);
export const getShips = (...a) => impl.getShips(...a);
export const getWeapons = (...a) => impl.getWeapons(...a);
export const getComponents = (...a) => impl.getComponents(...a);
export const getActivePlayerShip = (...a) => impl.getActivePlayerShip(...a);
export const getMap = (...a) => impl.getMap(...a);
export const getLevel = (...a) => impl.getLevel(...a);
