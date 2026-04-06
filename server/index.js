const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { RoomManager } = require('./roomManager');
const { GameManager } = require('./gameManager');

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:5173', 'http://localhost:3000'],
    methods: ['GET', 'POST']
  }
});

const roomManager = new RoomManager();
const gameManager = new GameManager(io, roomManager);

io.on('connection', (socket) => {
  console.log(`Player connected: ${socket.id}`);

  // Create a new room
  socket.on('createRoom', ({ playerName, vehicleType }, callback) => {
    try {
      const room = roomManager.createRoom(socket.id, playerName, vehicleType);
      socket.join(room.code);
      console.log(`Room ${room.code} created by ${playerName}`);
      callback({ success: true, room: roomManager.getRoomData(room.code) });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  // Join existing room
  socket.on('joinRoom', ({ roomCode, playerName, vehicleType }, callback) => {
    try {
      const room = roomManager.joinRoom(socket.id, playerName, roomCode, vehicleType);
      socket.join(roomCode);
      console.log(`${playerName} joined room ${roomCode}`);
      
      // Notify all players in room
      io.to(roomCode).emit('roomUpdate', roomManager.getRoomData(roomCode));
      callback({ success: true, room: roomManager.getRoomData(roomCode) });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  // Player ready toggle
  socket.on('toggleReady', (callback) => {
    try {
      const roomCode = roomManager.getPlayerRoom(socket.id);
      if (!roomCode) throw new Error('Not in a room');
      
      roomManager.toggleReady(socket.id);
      io.to(roomCode).emit('roomUpdate', roomManager.getRoomData(roomCode));
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  // Select level (host only)
  socket.on('selectLevel', ({ level }, callback) => {
    try {
      const roomCode = roomManager.getPlayerRoom(socket.id);
      if (!roomCode) throw new Error('Not in a room');
      
      roomManager.setLevel(roomCode, socket.id, level);
      io.to(roomCode).emit('roomUpdate', roomManager.getRoomData(roomCode));
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  // Select vehicle
  socket.on('selectVehicle', ({ vehicleType }, callback) => {
    try {
      const roomCode = roomManager.getPlayerRoom(socket.id);
      if (!roomCode) throw new Error('Not in a room');
      
      roomManager.setVehicle(roomCode, socket.id, vehicleType);
      io.to(roomCode).emit('roomUpdate', roomManager.getRoomData(roomCode));
      if (callback) callback({ success: true });
    } catch (error) {
      if (callback) callback({ success: false, error: error.message });
    }
  });

  // Start game (host only)
  socket.on('startGame', (callback) => {
    try {
      const roomCode = roomManager.getPlayerRoom(socket.id);
      if (!roomCode) throw new Error('Not in a room');
      
      const room = roomManager.getRoom(roomCode);
      if (room.hostId !== socket.id) throw new Error('Only host can start');
      if (room.players.length < 1) throw new Error('Need at least 1 player');
      
      roomManager.setStatus(roomCode, 'playing');
      gameManager.startGame(roomCode);
      
      io.to(roomCode).emit('gameStart', {
        level: room.level,
        players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, vehicle: p.vehicle || 'car' }))
      });
      
      callback({ success: true });
    } catch (error) {
      callback({ success: false, error: error.message });
    }
  });

  // Player position update (high frequency)
  socket.on('playerUpdate', (data) => {
    const roomCode = roomManager.getPlayerRoom(socket.id);
    if (!roomCode) return;
    
    gameManager.updatePlayer(roomCode, socket.id, data);
  });

  // Player finished
  socket.on('playerFinished', ({ distance, time }) => {
    const roomCode = roomManager.getPlayerRoom(socket.id);
    if (!roomCode) return;
    
    gameManager.playerFinished(roomCode, socket.id, distance, time);
  });

  // Player game over (flipped, time out)
  socket.on('playerGameOver', ({ reason, distance }) => {
    const roomCode = roomManager.getPlayerRoom(socket.id);
    if (!roomCode) return;
    
    gameManager.playerGameOver(roomCode, socket.id, reason, distance);
  });

  // Play again
  socket.on('playAgain', () => {
    const roomCode = roomManager.getPlayerRoom(socket.id);
    if (!roomCode) return;
    
    const room = roomManager.getRoom(roomCode);
    if (room) {
      roomManager.setStatus(roomCode, 'lobby');
      roomManager.resetReady(roomCode);
      gameManager.cleanupGame(roomCode);
      io.to(roomCode).emit('backToLobby', roomManager.getRoomData(roomCode));
    }
  });

  // Instant Restart (Host only)
  socket.on('restartGame', (callback) => {
    try {
      const roomCode = roomManager.getPlayerRoom(socket.id);
      if (!roomCode) throw new Error('Not in a room');
      
      const room = roomManager.getRoom(roomCode);
      if (room.hostId !== socket.id) throw new Error('Only host can restart');
      if (room.players.length < 1) throw new Error('Need at least 1 player');

      // Wipe old game session states
      gameManager.cleanupGame(roomCode);
      
      // Set status directly to playing, skipping lobby
      roomManager.setStatus(roomCode, 'playing');
      gameManager.startGame(roomCode);
      
      // Broadcast immediate transition into Game scene for everyone
      io.to(roomCode).emit('gameStart', {
        level: room.level,
        players: room.players.map(p => ({ id: p.id, name: p.name, color: p.color, vehicle: p.vehicle || 'car' }))
      });
      
      if(callback) callback({ success: true });
    } catch (error) {
      if(callback) callback({ success: false, error: error.message });
    }
  });

  // Leave room
  socket.on('leaveRoom', () => {
    handleDisconnect(socket);
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`Player disconnected: ${socket.id}`);
    handleDisconnect(socket);
  });

  function handleDisconnect(socket) {
    const roomCode = roomManager.getPlayerRoom(socket.id);
    if (!roomCode) return;
    
    const room = roomManager.getRoom(roomCode);
    const wasHost = room && room.hostId === socket.id;
    
    roomManager.leaveRoom(socket.id);
    socket.leave(roomCode);
    
    const updatedRoom = roomManager.getRoom(roomCode);
    if (updatedRoom) {
      // Notify remaining players
      io.to(roomCode).emit('playerLeft', { 
        playerId: socket.id,
        room: roomManager.getRoomData(roomCode)
      });
      
      if (updatedRoom.status === 'playing') {
        gameManager.removePlayer(roomCode, socket.id);
      }
    }
  }
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🏁 Racing server running on port ${PORT}`);
});
