const COLORS = ['#ff4757', '#2ed573', '#1e90ff', '#ffa502'];
const MAX_PLAYERS = 4;

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRooms = new Map(); // socketId -> roomCode
  }

  generateCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    // Ensure unique
    if (this.rooms.has(code)) return this.generateCode();
    return code;
  }

  createRoom(socketId, playerName, vehicleType = 'car') {
    // Leave existing room first
    if (this.playerRooms.has(socketId)) {
      this.leaveRoom(socketId);
    }

    const code = this.generateCode();
    const room = {
      code,
      hostId: socketId,
      players: [{
        id: socketId,
        name: playerName || 'Player 1',
        ready: false,
        color: COLORS[0],
        vehicle: vehicleType
      }],
      status: 'lobby', // lobby | playing | finished
      level: 1,
      createdAt: Date.now()
    };

    this.rooms.set(code, room);
    this.playerRooms.set(socketId, code);
    return room;
  }

  joinRoom(socketId, playerName, roomCode, vehicleType = 'car') {
    const code = roomCode.toUpperCase().trim();
    const room = this.rooms.get(code);
    
    if (!room) throw new Error('Room not found');
    if (room.status !== 'lobby') throw new Error('Game already in progress');
    if (room.players.length >= MAX_PLAYERS) throw new Error('Room is full');
    if (room.players.find(p => p.id === socketId)) throw new Error('Already in room');

    // Leave existing room first
    if (this.playerRooms.has(socketId)) {
      this.leaveRoom(socketId);
    }

    const colorIndex = room.players.length;
    room.players.push({
      id: socketId,
      name: playerName || `Player ${room.players.length + 1}`,
      ready: false,
      color: COLORS[colorIndex % COLORS.length],
      vehicle: vehicleType
    });

    this.playerRooms.set(socketId, code);
    return room;
  }

  leaveRoom(socketId) {
    const roomCode = this.playerRooms.get(socketId);
    if (!roomCode) return;

    const room = this.rooms.get(roomCode);
    if (!room) {
      this.playerRooms.delete(socketId);
      return;
    }

    room.players = room.players.filter(p => p.id !== socketId);
    this.playerRooms.delete(socketId);

    if (room.players.length === 0) {
      this.rooms.delete(roomCode);
      return;
    }

    // Transfer host if needed
    if (room.hostId === socketId) {
      room.hostId = room.players[0].id;
    }
  }

  toggleReady(socketId) {
    const roomCode = this.playerRooms.get(socketId);
    const room = this.rooms.get(roomCode);
    if (!room) return;

    const player = room.players.find(p => p.id === socketId);
    if (player) {
      player.ready = !player.ready;
    }
  }

  resetReady(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return;
    room.players.forEach(p => p.ready = false);
  }

  setLevel(roomCode, socketId, level) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found');
    if (room.hostId !== socketId) throw new Error('Only host can change level');
    room.level = level;
  }

  setVehicle(roomCode, socketId, vehicleType) {
    const room = this.rooms.get(roomCode);
    if (!room) throw new Error('Room not found');
    const player = room.players.find(p => p.id === socketId);
    if (player) {
      player.vehicle = vehicleType;
    }
  }

  setStatus(roomCode, status) {
    const room = this.rooms.get(roomCode);
    if (room) room.status = status;
  }

  getRoom(roomCode) {
    return this.rooms.get(roomCode);
  }

  getPlayerRoom(socketId) {
    return this.playerRooms.get(socketId);
  }

  getRoomData(roomCode) {
    const room = this.rooms.get(roomCode);
    if (!room) return null;
    return {
      code: room.code,
      hostId: room.hostId,
      players: room.players.map(p => ({
        id: p.id,
        name: p.name,
        ready: p.ready,
        color: p.color,
        vehicle: p.vehicle || 'car'
      })),
      status: room.status,
      level: room.level
    };
  }
}

module.exports = { RoomManager };
