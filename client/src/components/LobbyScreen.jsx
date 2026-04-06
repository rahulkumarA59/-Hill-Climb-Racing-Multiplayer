import { useState, useEffect } from 'react';
import socket from '../socket';
import LEVEL_CONFIGS from '../game/levels/LevelConfig';
import './LobbyScreen.css';

export default function LobbyScreen({ room: initialRoom, playerName, onGameStart, onLeave }) {
  const [room, setRoom] = useState(initialRoom);
  const [copied, setCopied] = useState(false);

  const isHost = room.hostId === socket.id;
  const canStart = room.players.length >= 1;

  useEffect(() => {
    const handleRoomUpdate = (data) => setRoom(data);

    socket.on('roomUpdate', handleRoomUpdate);

    return () => {
      socket.off('roomUpdate', handleRoomUpdate);
    };
  }, [onGameStart]);

  const copyRoomCode = () => {
    navigator.clipboard.writeText(room.code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {
      // Fallback
      const input = document.createElement('input');
      input.value = room.code;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const handleReady = () => {
    socket.emit('toggleReady', () => {});
  };

  const handleSelectLevel = (level) => {
    if (!isHost) return;
    socket.emit('selectLevel', { level }, () => {});
  };

  const handleSelectVehicle = (vehicleType) => {
    socket.emit('selectVehicle', { vehicleType }, () => {});
  };

  const handleStart = () => {
    socket.emit('startGame', (response) => {
      if (!response.success) {
        console.error('Failed to start:', response.error);
      }
    });
  };

  const handleLeave = () => {
    socket.emit('leaveRoom');
    onLeave();
  };

  const emptySlots = Math.max(0, 4 - room.players.length);

  return (
    <div className="lobby-screen screen-enter">
      <div className="lobby-content glass-card">
        <div className="lobby-header">
          <h2>Race Lobby</h2>
          <div className="room-code-display">
            <span className="room-code-value">{room.code}</span>
            <button 
              className={`btn-copy ${copied ? 'copied' : ''}`} 
              onClick={copyRoomCode}
              id="copy-code-btn"
            >
              {copied ? '✓ Copied' : '📋 Copy'}
            </button>
          </div>
        </div>

        <div className="players-section">
          <h3>Players ({room.players.length}/4)</h3>
          <div className="player-list">
            {room.players.map(player => (
              <div key={player.id} className={`player-card ${player.ready ? 'ready' : ''}`}>
                <div className="player-color" style={{ background: player.color }} />
                <div className="player-info-container">
                  <span className="player-name">
                    {player.name}
                    {player.id === socket.id && ' (You)'}
                  </span>
                  
                  {player.id === socket.id ? (
                    <div className="mini-vehicle-selector">
                      <button 
                        className={`mini-v-btn ${player.vehicle === 'car' ? 'selected' : ''}`}
                        onClick={() => handleSelectVehicle('car')}
                      >🚙</button>
                      <button 
                        className={`mini-v-btn ${player.vehicle === 'bike' ? 'selected' : ''}`}
                        onClick={() => handleSelectVehicle('bike')}
                      >🏍️</button>
                    </div>
                  ) : (
                    <span className="player-vehicle-info">
                      {player.vehicle === 'bike' ? '🏍️ Bike' : '🚙 Car'}
                    </span>
                  )}
                </div>

                {player.id === room.hostId && (
                  <span className="host-badge">Host</span>
                )}
                <span className={`ready-badge ${player.ready ? 'is-ready' : 'not-ready'}`}>
                  {player.ready ? '✓ Ready' : 'Waiting'}
                </span>
              </div>
            ))}
            {Array.from({ length: emptySlots }).map((_, i) => (
              <div key={`empty-${i}`} className="empty-slot">
                Waiting for player...
              </div>
            ))}
          </div>
        </div>

        <div className="level-selector">
          <h3>Select Level {!isHost && '(Host picks)'}</h3>
          <div className="level-cards">
            {Object.keys(LEVEL_CONFIGS).map(Number).map(level => {
              const config = LEVEL_CONFIGS[level];
              return (
                <div
                  key={level}
                  className={`level-card ${room.level === level ? 'selected' : ''} ${!isHost ? 'disabled' : ''}`}
                  onClick={() => handleSelectLevel(level)}
                >
                  <div className="level-number">{level}</div>
                  <div className="level-name">{config.name}</div>
                  <div className="level-difficulty">{config.difficulty}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="lobby-actions">
          <button className="btn-secondary" onClick={handleLeave} id="leave-lobby-btn">
            ← Leave
          </button>
          {isHost ? (
            <button
              className="btn-primary btn-start"
              onClick={handleStart}
              disabled={!canStart}
              id="start-game-btn"
            >
              🏁 Start Race
            </button>
          ) : (
            <button
              className={`btn-primary`}
              onClick={handleReady}
              id="ready-btn"
            >
              {room.players.find(p => p.id === socket.id)?.ready ? '✓ Ready!' : 'Ready Up'}
            </button>
          )}
        </div>

        {!isHost && (
          <div className="waiting-text">
            Waiting for host to start
            <div className="waiting-dots">
              <span /><span /><span />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
