import { useState, useEffect, useCallback } from 'react';
import PhaserGame from '../game/PhaserGame';
import EventBus from '../EventBus';
import socket from '../socket';
import './GameScreen.css';

export default function GameScreen({ gameData, onGameEnd, onExitGame, mode }) {
  const [distance, setDistance] = useState(0);
  const [speed, setSpeed] = useState(0);
  const [fuel, setFuel] = useState(100);
  const [coins, setCoins] = useState(0);
  const [timer, setTimer] = useState({ remaining: 120, total: 120 });
  const [leaderboard, setLeaderboard] = useState([]);
  const [showExitModal, setShowExitModal] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [position, setPosition] = useState({ position: 1, total: 1 });
  const [nitro, setNitro] = useState(null);

  const isSolo = mode === 'solo';
  const isBots = mode === 'bots';
  const isLocal = isSolo || isBots; // No socket needed

  useEffect(() => {
    const unsubHud = EventBus.on('hudUpdate', (data) => {
      setDistance(data.distance);
      setSpeed(data.speed);
      if (data.fuel !== undefined) setFuel(data.fuel);
      if (data.coins !== undefined) setCoins(data.coins);
      if (data.nitro !== undefined) setNitro(data.nitro);
    });

    const unsubTimer = EventBus.on('timerUpdate', (data) => {
      setTimer(data);
    });

    const unsubLeaderboard = EventBus.on('leaderboardUpdate', (data) => {
      setLeaderboard(data);
    });

    const unsubGameEnd = EventBus.on('gameEnd', (data) => {
      onGameEnd(data);
    });

    // Bot position updates
    const unsubPosition = EventBus.on('positionUpdate', (data) => {
      setPosition(data);
    });

    // Bot leaderboard updates
    const unsubBotLeaderboard = EventBus.on('botLeaderboardUpdate', (data) => {
      setLeaderboard(data);
    });

    // Only listen to socket in multiplayer
    let handleGameEnd = null;
    if (!isLocal) {
      handleGameEnd = (data) => {
        onGameEnd(data);
      };
      socket.on('gameEnd', handleGameEnd);
    }

    return () => {
      unsubHud();
      unsubTimer();
      unsubLeaderboard();
      unsubGameEnd();
      unsubPosition();
      unsubBotLeaderboard();
      if (handleGameEnd) socket.off('gameEnd', handleGameEnd);
    };
  }, [onGameEnd, isLocal]);

  const getTimerClass = () => {
    if (timer.remaining <= 10) return 'danger';
    if (timer.remaining <= 30) return 'warning';
    return '';
  };

  const getFuelClass = () => {
    if (fuel <= 15) return 'fuel-critical';
    if (fuel <= 35) return 'fuel-low';
    return '';
  };

  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handlePauseToggle = useCallback(() => {
    if (!isLocal || showExitModal) return;
    setIsPaused(prev => {
      const next = !prev;
      if (next) EventBus.emit('pauseGame');
      else EventBus.emit('resumeGame');
      return next;
    });
  }, [isLocal, showExitModal]);

  const handleOpenExitModal = useCallback(() => {
    setShowExitModal(true);
    if (isLocal && !isPaused) {
      EventBus.emit('pauseGame');
      setIsPaused(true);
    }
  }, [isLocal, isPaused]);

  const handleCloseExitModal = useCallback(() => {
    setShowExitModal(false);
    // Do not auto-resume in solo if we hit exit from pause menu,
    // only if we hit it directly from game
  }, []);

  const handleConfirmExit = useCallback(() => {
    if (!isLocal) {
      socket.emit('leaveRoom');
    }
    onExitGame();
  }, [isLocal, onExitGame]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (showExitModal) {
          handleCloseExitModal();
        } else if (isLocal) {
          handlePauseToggle();
        } else {
          handleOpenExitModal();
        }
      } else if (e.key.toLowerCase() === 'p' && isLocal && !showExitModal) {
        handlePauseToggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSolo, showExitModal, handlePauseToggle, handleOpenExitModal, handleCloseExitModal]);

  // In local modes (solo + bots), pass null socket so GameScene knows not to sync
  const gameSocket = isLocal ? null : socket;
  const gameMyId = isLocal ? 'solo-player' : socket.id;

  return (
    <div className="game-screen">
      <PhaserGame
        level={gameData.level}
        players={gameData.players}
        socket={gameSocket}
        myId={gameMyId}
      />

      <div className={`hud-overlay ${isPaused || showExitModal ? 'blurred' : ''}`}>
        {/* Top-right: Pause + Exit buttons */}
        <div className="top-right-controls">
          {isLocal && (
            <button className="control-btn pause-btn" onClick={handlePauseToggle} title="Pause (P or ESC)">
              {isPaused ? '▶' : '⏸'}
            </button>
          )}
          <button className="control-btn exit-btn" onClick={handleOpenExitModal} title="Exit Game (ESC)">
            🚪
          </button>
        </div>

        <div className="hud-top">
          {/* Left column: Stats + Fuel + Nitro (stacked cleanly) */}
          <div className="hud-left">
            <div className="hud-stat">
              <span className="hud-stat-icon">📏</span>
              <div>
                <div className="hud-stat-value">{distance}m</div>
                <div className="hud-stat-label">Distance</div>
              </div>
            </div>
            <div className="hud-stat">
              <span className="hud-stat-icon">⚡</span>
              <div>
                <div className="hud-stat-value">{speed} km/h</div>
                <div className="hud-stat-label">Speed</div>
              </div>
            </div>
            <div className="hud-stat">
              <span className="hud-stat-icon">🪙</span>
              <div>
                <div className="hud-stat-value">{coins}</div>
                <div className="hud-stat-label">Coins</div>
              </div>
            </div>

            {/* Fuel Gauge — inside left column */}
            <div className={`fuel-gauge ${getFuelClass()}`}>
              <div className="fuel-label">⛽ FUEL</div>
              <div className="fuel-bar-container">
                <div className="fuel-bar-fill" style={{ width: `${fuel}%` }} />
              </div>
              <div className="fuel-percentage">{fuel}%</div>
            </div>

            {/* Nitro Gauge — inside left column */}
            {nitro && (
              <div className={`nitro-gauge ${nitro.isActive ? 'nitro-active' : ''} ${nitro.isCooldown ? 'nitro-cooldown' : ''} ${!nitro.canActivate && !nitro.isActive && !nitro.isCooldown ? 'nitro-gap' : ''}`}>
                <div className="nitro-header">
                  <span className="nitro-icon">{nitro.isActive ? '🔥' : nitro.isCooldown ? '⏳' : '⚡'}</span>
                  <span className="nitro-label">NITRO</span>
                  <span className="nitro-uses">
                    {nitro.isCooldown 
                      ? `${nitro.cooldownRemaining}s`
                      : `${nitro.usesRemaining}/${nitro.maxUses}`
                    }
                  </span>
                </div>
                <div className="nitro-bar-container">
                  {nitro.isCooldown ? (
                    <div className="nitro-bar-fill cooldown-fill"
                      style={{ width: `${((nitro.cooldownTotal - nitro.cooldownRemaining) / nitro.cooldownTotal) * 100}%` }} />
                  ) : nitro.isActive ? (
                    <div className="nitro-bar-fill active-fill"
                      style={{ width: `${nitro.intensity * 100}%` }} />
                  ) : (
                    <div className="nitro-bar-fill ready-fill"
                      style={{ width: `${(nitro.usesRemaining / nitro.maxUses) * 100}%` }} />
                  )}
                </div>
                {nitro.gapRemaining > 0 && !nitro.isCooldown && (
                  <div className="nitro-gap-text">Ready in {nitro.gapRemaining}s</div>
                )}
              </div>
            )}
          </div>

          {/* Center - Timer / Solo badge / Bot Position */}
          <div className="hud-center">
            {isBots ? (
              <div className="solo-badge bot-position-badge">
                <div className="solo-badge-text">🏁 Position</div>
                <div className="bot-position-value">{position.position}/{position.total}</div>
              </div>
            ) : isSolo ? (
              <div className="solo-badge">
                <div className="solo-badge-text">🎮 SOLO</div>
                <div className="solo-badge-sub">No Time Limit</div>
              </div>
            ) : (
              <div className="timer-display">
                <div className={`timer-value ${getTimerClass()}`}>
                  {formatTime(timer.remaining)}
                </div>
                <div className="timer-label">Time Remaining</div>
              </div>
            )}
          </div>

          {/* Right - Leaderboard, pushed below the pause/exit buttons */}
          {(!isSolo) && (
            <div className="hud-right">
              <div className="leaderboard-title">🏆 {isBots ? 'Race Standings' : 'Leaderboard'}</div>
              {leaderboard.map((entry, i) => (
                <div
                  key={entry.id}
                  className={`leaderboard-entry ${(isBots ? entry.isPlayer : entry.id === socket.id) ? 'is-me' : ''} ${i === 0 ? 'is-leader' : ''}`}
                >
                  <span className="lb-rank">#{entry.rank}</span>
                  <div className="lb-color" style={{ background: entry.color }} />
                  <span className="lb-name">
                    {entry.name}{(isBots ? entry.isPlayer : entry.id === socket.id) ? ' (You)' : ''}
                  </span>
                  <span className="lb-distance">{entry.distance}m</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Bottom - Controls */}
        <div className="hud-bottom">
          <div className="controls-hint">
            <div className="key-hint">
              <span className="key">→</span> Gas
            </div>
            <div className="key-hint">
              <span className="key">←</span> Brake
            </div>
            <div className="key-hint">
              <span className="key">↑</span> Tilt Back
            </div>
            <div className="key-hint">
              <span className="key">↓</span> Tilt Fwd
            </div>
            <div className="key-hint nitro-key-hint">
              <span className="key nitro-key">SPACE</span> Nitro
            </div>
          </div>
        </div>
      </div>

      {/* Modals overlay */}
      {(showExitModal || isPaused) && (
        <div className="modal-overlay screen-enter">
          {showExitModal ? (
            <div className="game-modal exit-modal glass-card">
              <h2>Leave Game?</h2>
              <p>Are you sure you want to leave? Your progress will be lost.</p>
              <div className="modal-actions">
                <button className="btn-secondary" onClick={handleCloseExitModal}>❌ Cancel</button>
                <button className="btn-primary danger-btn" onClick={handleConfirmExit}>✅ Leave</button>
              </div>
            </div>
          ) : isPaused ? (
            <div className="game-modal pause-modal glass-card">
              <h2>Paused</h2>
              <div className="modal-actions vertical">
                <button className="btn-primary" onClick={handlePauseToggle}>▶️ Resume</button>
                <button className="btn-secondary" onClick={handleOpenExitModal}>🚪 Exit Game</button>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
