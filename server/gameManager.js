const LEVEL_TIMERS = {
  1: 120,
  2: 90,
  3: 60,
  4: 150, // Highway
  5: 120, // Moon
  6: 90   // Rooftop
};

const TARGET_DISTANCES = {
  1: 5000,
  2: 4000,
  3: 3000,
  4: 6000,
  5: 4000,
  6: 3000
};

const BROADCAST_INTERVAL = 50; // 20 Hz

class GameManager {
  constructor(io, roomManager) {
    this.io = io;
    this.roomManager = roomManager;
    this.games = new Map(); // roomCode -> gameState
  }

  startGame(roomCode) {
    const room = this.roomManager.getRoom(roomCode);
    if (!room) return;

    const level = room.level || 1;
    const timer = LEVEL_TIMERS[level];
    const targetDistance = TARGET_DISTANCES[level];

    const gameState = {
      roomCode,
      level,
      timer,
      targetDistance,
      startTime: Date.now(),
      players: {},
      finished: new Set(),
      gameOver: new Set(),
      broadcastInterval: null,
      timerInterval: null
    };

    // Initialize player states
    room.players.forEach(p => {
      gameState.players[p.id] = {
        id: p.id,
        name: p.name,
        color: p.color,
        x: 0,
        y: 0,
        rotation: 0,
        velocityX: 0,
        velocityY: 0,
        distance: 0,
        finished: false,
        gameOver: false,
        finishTime: null
      };
    });

    this.games.set(roomCode, gameState);

    // Start broadcasting game state
    gameState.broadcastInterval = setInterval(() => {
      this.broadcastState(roomCode);
    }, BROADCAST_INTERVAL);

    // Start timer countdown
    gameState.timerInterval = setInterval(() => {
      const elapsed = (Date.now() - gameState.startTime) / 1000;
      const remaining = Math.max(0, gameState.timer - elapsed);

      this.io.to(roomCode).emit('timerUpdate', { 
        remaining: Math.ceil(remaining),
        total: gameState.timer
      });

      if (remaining <= 0) {
        this.endGame(roomCode, 'timeUp');
      }
    }, 1000);
  }

  updatePlayer(roomCode, socketId, data) {
    const game = this.games.get(roomCode);
    if (!game || !game.players[socketId]) return;

    const player = game.players[socketId];
    if (player.finished || player.gameOver) return;

    // Validate incoming data (basic anti-cheat)
    if (typeof data.x !== 'number' || typeof data.y !== 'number') return;
    if (Math.abs(data.x) > 100000 || Math.abs(data.y) > 100000) return;

    player.x = data.x;
    player.y = data.y;
    player.rotation = data.rotation || 0;
    player.velocityX = data.velocityX || 0;
    player.velocityY = data.velocityY || 0;
    player.distance = Math.max(player.distance, data.distance || 0);
  }

  broadcastState(roomCode) {
    const game = this.games.get(roomCode);
    if (!game) return;

    const players = Object.values(game.players).map(p => ({
      id: p.id,
      name: p.name,
      color: p.color,
      x: p.x,
      y: p.y,
      rotation: p.rotation,
      velocityX: p.velocityX,
      velocityY: p.velocityY,
      distance: Math.round(p.distance),
      finished: p.finished,
      gameOver: p.gameOver
    }));

    // Sort by distance for leaderboard
    const leaderboard = [...players]
      .sort((a, b) => b.distance - a.distance)
      .map((p, i) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        distance: p.distance,
        rank: i + 1,
        finished: p.finished,
        gameOver: p.gameOver
      }));

    this.io.to(roomCode).emit('gameState', { players, leaderboard });
  }

  playerFinished(roomCode, socketId, distance, time) {
    const game = this.games.get(roomCode);
    if (!game || !game.players[socketId]) return;

    game.players[socketId].finished = true;
    game.players[socketId].distance = distance;
    game.players[socketId].finishTime = time;
    game.finished.add(socketId);

    this.io.to(roomCode).emit('playerFinishedNotify', {
      playerId: socketId,
      name: game.players[socketId].name
    });

    // Check if all active players are done
    const activePlayers = Object.values(game.players).filter(p => !p.gameOver);
    const allFinished = activePlayers.every(p => p.finished);
    if (allFinished) {
      this.endGame(roomCode, 'allFinished');
    }
  }

  playerGameOver(roomCode, socketId, reason, distance) {
    const game = this.games.get(roomCode);
    if (!game || !game.players[socketId]) return;

    game.players[socketId].gameOver = true;
    game.players[socketId].distance = distance;
    game.gameOver.add(socketId);

    // Check if all players are done/over
    const allDone = Object.values(game.players).every(p => p.finished || p.gameOver);
    if (allDone) {
      this.endGame(roomCode, 'allDone');
    }
  }

  removePlayer(roomCode, socketId) {
    const game = this.games.get(roomCode);
    if (!game) return;

    delete game.players[socketId];
    game.finished.delete(socketId);
    game.gameOver.delete(socketId);

    // If no players left, cleanup
    if (Object.keys(game.players).length === 0) {
      this.cleanupGame(roomCode);
    } else {
      // Check if all remaining are done
      const allDone = Object.values(game.players).every(p => p.finished || p.gameOver);
      if (allDone) {
        this.endGame(roomCode, 'allDone');
      }
    }
  }

  endGame(roomCode, reason) {
    const game = this.games.get(roomCode);
    if (!game) return;

    // Build final rankings
    const rankings = Object.values(game.players)
      .sort((a, b) => {
        // Finished players rank first, then by distance
        if (a.finished && !b.finished) return -1;
        if (!a.finished && b.finished) return 1;
        if (a.finished && b.finished) return (a.finishTime || Infinity) - (b.finishTime || Infinity);
        return b.distance - a.distance;
      })
      .map((p, i) => ({
        rank: i + 1,
        id: p.id,
        name: p.name,
        color: p.color,
        distance: Math.round(p.distance),
        finished: p.finished,
        gameOver: p.gameOver,
        finishTime: p.finishTime ? p.finishTime.toFixed(1) : null
      }));

    this.io.to(roomCode).emit('gameEnd', { reason, rankings });
    
    this.roomManager.setStatus(roomCode, 'finished');
    this.cleanupGame(roomCode);
  }

  cleanupGame(roomCode) {
    const game = this.games.get(roomCode);
    if (!game) return;

    if (game.broadcastInterval) clearInterval(game.broadcastInterval);
    if (game.timerInterval) clearInterval(game.timerInterval);
    this.games.delete(roomCode);
  }
}

module.exports = { GameManager };
