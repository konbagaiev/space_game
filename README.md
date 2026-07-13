# Vega Sentinels

A browser game prototype: several 3D spaceships fighting on a plane.
Built on **Three.js** (frontend) with a **Node.js + Express + PostgreSQL** backend
(anonymous player auto-registration and game history; multiplayer is planned).

## Structure

```
.
├── client/      Three.js game code (frontend)
│   └── index.html
├── server/      Backend: player registration, multiplayer (in development)
├── docs/        Documentation and decisions made
│   └── DECISIONS.md
└── README.md
```

## How to run

With the backend (recommended — enables player registration & game history):

```
cd server
npm install      # first time only
npm start        # http://localhost:4000
```

Then open **http://localhost:4000** (the server serves the game). Internet access is needed
(Three.js loads from a CDN).

The client uses ES modules (`client/src/*.js`), so it must be **served over http** — opening
`client/index.html` as a `file://` won't load the modules. The backend server above serves it;
to run the client alone (without the API), use any static server, e.g.
`npx serve client` or `python3 -m http.server -d client`. Backend calls then fail silently
(no registration/history).

## Documentation

Key decisions, reasons, and parameters to tweak are in [`docs/DECISIONS.md`](docs/DECISIONS.md).
