# Server (backend)

Empty for now — groundwork for the future. The server side will appear here:

- **Player registration / accounts** (login, profiles, progress).
- **Multiplayer** — synchronizing combat state between players (probably WebSocket;
  for a browser game this is a separate Node.js server).
- Possibly: leaderboards, matchmaking, saves.

The technologies aren't locked in. The likely direction is Node.js + WebSocket (ws / Socket.IO).
The client (Three.js) lives in `../client`.
