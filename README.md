# 🏁 Hill Climb Racing — Multiplayer

A real-time multiplayer physics-based 2D racing game inspired by Hill Climb Racing, built with React, Phaser.js, and Socket.IO.

## 🎮 Features

- **Physics-based gameplay** — Realistic car physics with suspension, gravity, and tilt
- **Procedural terrain** — Endlessly generated hills using layered sine waves
- **3 Difficulty levels** — Green Meadows (Easy), Desert Canyon (Medium), Volcanic Peaks (Hard)
- **Multiplayer support** — 2-4 players per room with real-time position sync
- **Live leaderboard** — See other players' progress in real-time
- **Timer system** — Race against the clock (60-120 seconds per level)
- **Premium UI** — Dark theme with glassmorphism, gradient effects, and animations

## 🚀 Quick Start

### Prerequisites
- Node.js (v16+)
- npm

### Install & Run

```bash
# From the project root:
npm install

# Start both server and client:
npm run dev
```

Or run them separately:

```bash
# Terminal 1 — Server
cd server
node index.js

# Terminal 2 — Client
cd client
npx vite --port 5173
```

- **Game**: http://localhost:5173
- **Server**: http://localhost:3001

## 🎮 Controls

| Key | Action |
|-----|--------|
| `→` / `D` | Accelerate |
| `←` / `A` | Brake |
| `↑` / `W` | Tilt Back |
| `↓` / `S` | Tilt Forward |

## 🏗️ Architecture

```
Racing/
├── package.json              # Root: runs client + server together
├── client/                   # React + Vite + Phaser.js
│   └── src/
│       ├── App.jsx           # Screen routing
│       ├── socket.js         # Socket.IO client
│       ├── EventBus.js       # React ↔ Phaser bridge
│       ├── components/       # UI screens (Start, Lobby, Game, Result)
│       └── game/
│           ├── config.js     # Phaser config
│           ├── scenes/       # GameScene
│           ├── entities/     # Car, GhostCar
│           ├── terrain/      # Procedural terrain generator
│           └── levels/       # Level configs (1-3)
└── server/                   # Node.js + Express + Socket.IO
    ├── index.js              # Server entry
    ├── roomManager.js        # Room CRUD + player management
    └── gameManager.js        # Game state, timer, scoring
```

## 🌐 Multiplayer

- Physics runs **client-side only** (Phaser Matter.js)
- Server relays **position/rotation data** at 20Hz
- Ghost cars use **interpolation** for smooth rendering
- Server is authoritative for **timer** and **leaderboard**

## ⚙️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React (Vite) |
| Game Engine | Phaser 3 |
| Physics | Matter.js (via Phaser) |
| Backend | Node.js + Express |
| Multiplayer | Socket.IO |
| Styling | Plain CSS |
