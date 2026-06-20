// Backend server: serves the game client (static) AND the JSON API on one origin
// (so the client can call /api/... without CORS). Storage is SQLite (see db.js).
import express from 'express';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { migrate, registerPlayer, recordGame, getPlayerGames, stats, getShips, getWeapons, getActivePlayerShip, getMap, getLevel, backend } from './datastore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDir = path.join(__dirname, '..', '..', 'client');

// Build the Express app (runs migrations first). Exported so tests can mount it
// without binding a port.
export async function createApp() {
  await migrate(); // bring the schema up to date before serving (backend chosen by DATABASE_URL)

  const app = express();
  app.use(express.json());

  // helper: run an async handler and forward errors to the error middleware
  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // Auto-register a player by their browser-generated id (create if new).
  app.post('/api/players/register', wrap(async (req, res) => {
    const { playerId } = req.body || {};
    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({ error: 'playerId (string) required' });
    }
    res.json(await registerPlayer(playerId));
  }));

  // Record one finished game in the player's history.
  app.post('/api/games', wrap(async (req, res) => {
    const { playerId, score, kills, durationMs } = req.body || {};
    if (!playerId || typeof playerId !== 'string') {
      return res.status(400).json({ error: 'playerId (string) required' });
    }
    res.json(await recordGame(playerId, { score, kills, durationMs }));
  }));

  // A player's game history (handy for testing / future UI).
  app.get('/api/players/:id/games', wrap(async (req, res) => {
    res.json(await getPlayerGames(req.params.id));
  }));

  app.get('/api/health', wrap(async (req, res) => res.json({ ok: true, backend, ...(await stats()) })));

  // Catalog: ships (player + enemies) and weapons, with their stats. Read-only.
  app.get('/api/ships', wrap(async (req, res) => res.json(await getShips())));
  app.get('/api/weapons', wrap(async (req, res) => res.json(await getWeapons())));

  // The player's active ship (template + effective loadout). Auto-registers + gives a default ship.
  app.get('/api/players/:id/active-ship', wrap(async (req, res) => {
    const active = await getActivePlayerShip(req.params.id);
    if (!active) return res.status(404).json({ error: 'no active ship' });
    res.json(active);
  }));

  // A map's scene descriptor (the client renders it via buildMap). Read-only.
  app.get('/api/maps/:name', wrap(async (req, res) => {
    const map = await getMap(req.params.name);
    if (!map) return res.status(404).json({ error: 'no such map' });
    res.json(map);
  }));

  // A level's descriptor (map + phase/wave script; the client's level runner plays it). Read-only.
  app.get('/api/levels/:name', wrap(async (req, res) => {
    const level = await getLevel(req.params.name);
    if (!level) return res.status(404).json({ error: 'no such level' });
    res.json(level);
  }));

  // Serve the game client (index.html etc.) from the same origin as the API.
  app.use(express.static(clientDir));

  // Error handler — log and return the message (so failures are visible).
  app.use((err, req, res, next) => {
    console.error('API error:', err);
    res.status(500).json({ error: String((err && err.message) || err) });
  });

  return app;
}

// CLI: `node src/server.js` builds the app and starts listening.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createApp();
  const PORT = process.env.PORT || 4000;
  const server = app.listen(PORT, () => {
    console.log(`Space game server running: http://localhost:${PORT}`);
  });
  // Graceful shutdown: on stop, stop accepting new connections and let in-flight
  // requests finish before exiting -> no dropped requests when the old container is
  // removed during a zero-downtime rollout.
  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 8000).unref(); // hard cap
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
