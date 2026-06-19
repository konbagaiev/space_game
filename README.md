# Space Game

A browser game prototype: several 3D spaceships fighting on a plane.
Built on **Three.js** (frontend), the backend (player registration, multiplayer) is planned.

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

Open `client/index.html` in a browser (double click). No installation required —
Three.js is loaded from a CDN. Internet access is needed.

## Documentation

Key decisions, reasons, and parameters to tweak are in [`docs/DECISIONS.md`](docs/DECISIONS.md).
