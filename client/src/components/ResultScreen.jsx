import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import socket from '../socket';
import { soundManager } from '../game/audio/SoundManager';
import './ResultScreen.css';

export default function ResultScreen({ results, onPlayAgain, onBackToMenu, mode, deathSnapshot, isHost }) {
  const [confetti, setConfetti] = useState([]);
  const [isNewRecord, setIsNewRecord] = useState(false);

  const isSolo = mode === 'solo';
  const isBots = mode === 'bots';
  const isLocalMode = isSolo || isBots;
  const rankings = results?.rankings || [];
  const myResult = isSolo ? rankings[0] : (isBots ? rankings.find(r => !r.isBot) : null);
  const winner = rankings[0];
  const isWinner = isSolo ? true : (isBots ? winner?.id === 'solo-player' : winner?.id === socket.id);

  // Home Screen Ambient Layers
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const containerRef = useRef(null);

  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100
    });
  }, []);

  const terrainPoints = useMemo(() => {
    const points = [];
    for (let x = 0; x <= 100; x += 2) {
      const y = 75 + Math.sin(x * 0.15) * 8 + Math.sin(x * 0.08 + 2) * 12 + Math.sin(x * 0.25 + 5) * 4;
      points.push(`${x}% ${y}%`);
    }
    return `polygon(0% 100%, ${points.join(', ')}, 100% 100%)`;
  }, []);

  const bgParticles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 40; i++) {
      arr.push({
        id: i,
        left: Math.random() * 100,
        size: 1 + Math.random() * 3,
        duration: 8 + Math.random() * 15,
        delay: Math.random() * 10,
        opacity: 0.1 + Math.random() * 0.3,
        type: Math.random() > 0.7 ? 'spark' : 'dust'
      });
    }
    return arr;
  }, []);

  useEffect(() => {
    let newRecord = false;

    if (isSolo && myResult && myResult.distance) {
      const savedScore = localStorage.getItem('terrainClimbHighScore');
      const currentHigh = savedScore ? parseInt(savedScore, 10) : 0;
      if (myResult.distance > currentHigh) {
        localStorage.setItem('terrainClimbHighScore', myResult.distance.toString());
        newRecord = true;
        setIsNewRecord(true);
      }
    }

    // Play sounds based on outcome
    if (isSolo) {
      if (newRecord) {
        soundManager.playVictorySound();
      } else {
        soundManager.playFinishSound();
      }
    } else {
      if (isWinner) {
        soundManager.playVictorySound();
      } else {
        soundManager.playDefeatSound();
      }
    }

    // Generate Neon 3D confetti explosion for winner or solo new record
    if (isWinner || (isSolo && newRecord)) {
      const pieces = [];
      const colors = ['#00d4ff', '#7b2ff7', '#ff4757', '#ffffff', '#00d4ff'];
      const centerX = window.innerWidth / 2;
      const centerY = window.innerHeight / 2;

      for (let i = 0; i < 120; i++) {
        const angle = Math.random() * Math.PI * 2;
        const velocity = 15 + Math.random() * 40; // Explosion speed
        
        pieces.push({
          id: i,
          x: 50, // start center (%)
          y: 50,
          vx: Math.cos(angle) * velocity,
          vy: Math.sin(angle) * velocity - 20, // upward bias
          color: colors[Math.floor(Math.random() * colors.length)],
          size: 8 + Math.random() * 12,
          rotationX: Math.random() * 360,
          rotationY: Math.random() * 360,
          rotationZ: Math.random() * 360,
          spinX: (Math.random() - 0.5) * 20,
          spinY: (Math.random() - 0.5) * 20,
          spinZ: (Math.random() - 0.5) * 20,
          delay: Math.random() * 0.2 // instantaneous burst
        });
      }
      setConfetti(pieces);

      // Animate confetti frame by frame
      let animationFrameId;
      let lastTime = performance.now();
      
      const updateConfetti = (time) => {
        const delta = (time - lastTime) / 1000;
        lastTime = time;

        setConfetti(prev => prev.map(p => {
          let newVy = p.vy + 40 * delta; // Gravity
          let newX = p.x + (p.vx * delta);
          let newY = p.y + (newVy * delta);
          
          return {
            ...p,
            x: newX,
            y: newY,
            vy: newVy,
            rotationX: p.rotationX + p.spinX,
            rotationY: p.rotationY + p.spinY,
            rotationZ: p.rotationZ + p.spinZ,
          };
        }));
        animationFrameId = requestAnimationFrame(updateConfetti);
      };
      
      animationFrameId = requestAnimationFrame(updateConfetti);

      return () => {
        cancelAnimationFrame(animationFrameId);
      };
    }

    // Listen for back to lobby (multiplayer only — not bots)
    if (!isLocalMode) {
      const handleBackToLobby = (roomData) => {
        onPlayAgain(roomData);
      };
      socket.on('backToLobby', handleBackToLobby);
      return () => {
        socket.off('backToLobby', handleBackToLobby);
      };
    }
  }, [isWinner, isSolo, onPlayAgain]);

  const handlePlayAgain = () => {
    if (isLocalMode) {
      // Solo & Bots: instant restart
      onPlayAgain(null);
    } else {
      socket.emit('playAgain');
    }
  };

  const handleBack = () => {
    if (!isLocalMode) {
      socket.emit('leaveRoom');
    }
    onBackToMenu();
  };

  const getReasonText = () => {
    if (isSolo) {
      const reason = results?.reason;
      if (reason === 'finished') return '🏁 Race Complete!';
      if (reason === 'flipped') return '🔄 Flipped!';
      if (reason === 'fuel') return '⛽ Out of Fuel!';
      if (reason === 'fell') return '💀 Fell Off!';
      return 'Race Over!';
    }
    switch (results?.reason) {
      case 'timeUp': return 'Time\'s up!';
      case 'allFinished': return 'Race complete!';
      case 'allDone': return 'Race over!';
      default: return 'Race finished!';
    }
  };

  const getMedal = (rank) => {
    switch (rank) {
      case 1: return '🥇';
      case 2: return '🥈';
      case 3: return '🥉';
      default: return `#${rank}`;
    }
  };

  const getPodiumOrder = () => {
    const ordered = [];
    if (rankings[1]) ordered.push({ ...rankings[1], place: 'second' });
    if (rankings[0]) ordered.push({ ...rankings[0], place: 'first' });
    if (rankings[2]) ordered.push({ ...rankings[2], place: 'third' });
    return ordered;
  };

  return (
    <div 
      className={`result-screen screen-enter ${isWinner && !isSolo ? 'victory-mode' : (!isSolo && !isBots ? 'defeat-mode' : (isBots && !isWinner ? 'defeat-mode' : ''))}`}
      ref={containerRef} 
      onMouseMove={handleMouseMove}
    >
      
      {/* ── Ambient Background Matches Home Page ── */}
      <div className="cursor-spotlight" style={{
        background: `radial-gradient(circle at ${mousePos.x}% ${mousePos.y}%, rgba(${isWinner ? '0,212,255' : '255,71,87'},0.06) 0%, transparent 50%)`
      }} />

      <div className="bg-layer bg-grid" />
      <div className="bg-layer bg-terrain" style={{ clipPath: terrainPoints }} />
      <div className="bg-layer bg-terrain bg-terrain-2" style={{
        clipPath: terrainPoints,
        transform: 'scaleX(-1) translateY(30px)'
      }} />

      <div className="particle-field">
        {bgParticles.map(p => (
          <div
            key={p.id}
            className={`home-particle ${p.type}`}
            style={{
              left: `${p.left}%`,
              width: `${p.size}px`,
              height: `${p.size}px`,
              animationDuration: `${p.duration}s`,
              animationDelay: `${p.delay}s`,
              opacity: p.opacity
            }}
          />
        ))}
      </div>

      <div className="speed-lines">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="speed-line" style={{
            top: `${15 + i * 14}%`,
            animationDelay: `${i * 0.4}s`,
            opacity: 0.03 + Math.random() * 0.04
          }} />
        ))}
      </div>
      {/* ──────────────────────────────────────── */}

      {(isWinner || (isSolo && isNewRecord)) && (
        <div className="confetti-container">
          {confetti.map(piece => (
            <div
              key={piece.id}
              className="confetti-piece"
              style={{
                left: `calc(50vw + ${piece.x - 50}vw)`,
                top: `calc(50vh + ${piece.y - 50}vh)`,
                backgroundColor: piece.color,
                width: `${piece.size}px`,
                height: `${piece.size}px`,
                transform: `rotateX(${piece.rotationX}deg) rotateY(${piece.rotationY}deg) rotateZ(${piece.rotationZ}deg)`,
                opacity: piece.y > 150 ? 0 : 1 // fade out as they fallway down
              }}
            />
          ))}
        </div>
      )}

      {/* Wrapper to handle Grid Split Layout on Death */}
      <div className={`result-layout-wrapper ${deathSnapshot ? 'split-layout' : ''}`}>

        {/* ── Left Side: Death Snapshot ── */}
        {deathSnapshot && (
          <div className="snapshot-panel glass-card screen-enter" style={{ animationDelay: '0.2s' }}>
            <div className="snapshot-header">
              <h3>MOMENT OF FAILURE</h3>
            </div>
            <div className="snapshot-image-container">
              <img src={deathSnapshot} className="snapshot-image" alt="Death Frame" />
              <div className="snapshot-vignette"></div>
            </div>
            <div className="snapshot-reason">
              {getReasonText()}
            </div>
          </div>
        )}

        {/* ── Right Side / Centered: Stats Panel ── */}
        <div className={`result-content glass-card ${isWinner && !isSolo ? 'victory-card bhaukal-entrance' : ''} ${deathSnapshot ? 'stats-panel screen-enter' : ''}`}>
          <div className="result-header">
            <h2>
              {isSolo ? (isNewRecord ? '🔥 NEW RECORD!' : getReasonText()) 
                : isBots ? (isWinner ? '🏆 VICTORY!' : '💀 DEFEATED') 
                : (isWinner ? '🏆 VICTORY!' : '💀 DEFEATED')}
            </h2>
            {(isBots || (!isSolo && !isBots)) && (
              <div className={`result-subtitle ${!isWinner ? 'motivational' : ''}`}>
                {isWinner ? 'You won the race!' : 'Try again. You were close.'}
              </div>
            )}
          </div>

          {/* ── Solo Mode: Personal Stats ── */}
          {isSolo && myResult && (
            <div className="solo-results">
              <div className="solo-stat-grid">
                <div className="solo-stat-card">
                  <div className="solo-stat-icon">📏</div>
                  <div className="solo-stat-value">{myResult.distance}m</div>
                  <div className="solo-stat-label">Distance</div>
                </div>
                <div className="solo-stat-card">
                  <div className="solo-stat-icon">🪙</div>
                  <div className="solo-stat-value">{myResult.coins || 0}</div>
                  <div className="solo-stat-label">Coins</div>
                </div>
                {myResult.finished && (
                  <div className="solo-stat-card finished-card">
                    <div className="solo-stat-icon">⏱️</div>
                    <div className="solo-stat-value">{myResult.finishTime}s</div>
                    <div className="solo-stat-label">Finish Time</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Bots Mode: Personal Stats Row + Podium ── */}
          {isBots && myResult && (
            <div className="solo-results">
              <div className="solo-stat-grid">
                <div className="solo-stat-card">
                  <div className="solo-stat-icon">📏</div>
                  <div className="solo-stat-value">{myResult.distance}m</div>
                  <div className="solo-stat-label">Distance</div>
                </div>
                <div className="solo-stat-card">
                  <div className="solo-stat-icon">🪙</div>
                  <div className="solo-stat-value">{myResult.coins || 0}</div>
                  <div className="solo-stat-label">Coins</div>
                </div>
                <div className="solo-stat-card">
                  <div className="solo-stat-icon">🏅</div>
                  <div className="solo-stat-value">{getMedal(myResult.rank)}</div>
                  <div className="solo-stat-label">Position</div>
                </div>
              </div>
            </div>
          )}

          {/* ── Multiplayer / Bots: Podium ── */}
          {(!isSolo) && rankings.length > 1 && (
            <div className="podium">
              {getPodiumOrder().map(player => (
                <div key={player.id} className={`podium-place ${player.place}`}>
                  <div className="podium-avatar">
                    {getMedal(player.rank)}
                  </div>
                  <div className="podium-name">{player.name}</div>
                  <div className="podium-distance">{player.distance}m</div>
                  <div className="podium-bar">{player.rank}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Multiplayer / Bots: Full Rankings ── */}
          {(!isSolo) && (
            <div className="rankings-list">
              {rankings.map((player) => (
                <div
                  key={player.id}
                  className={`ranking-entry ${player.rank === 1 ? 'winner' : ''} ${(isBots ? player.id === 'solo-player' : player.id === socket.id) ? 'is-me' : ''}`}
                >
                  <span className="rank-number">{getMedal(player.rank)}</span>
                  <div className="rank-color" style={{ background: player.color }} />
                  <div className="rank-info">
                    <div className="rank-name">
                      {player.name}{(isBots ? player.id === 'solo-player' : player.id === socket.id) ? ' (You)' : ''}
                      {player.isBot && ` 🤖`}
                    </div>
                    <div className="rank-details">
                      {player.finished ? `Finished in ${player.finishTime}s` :
                       player.gameOver ? 'Did not finish' : 'Racing...'}
                    </div>
                  </div>
                  <span className="rank-distance">{player.distance}m</span>
                </div>
              ))}
            </div>
          )}

          <div className="result-actions">
            <button className="btn-secondary" onClick={handleBack} id="back-to-menu-btn">
              ← Menu
            </button>
            {isLocalMode ? (
              <button className="btn-primary" onClick={handlePlayAgain} id="play-again-btn">
                🔄 Try Again
              </button>
            ) : isHost ? (
              <button className="btn-primary" onClick={handlePlayAgain} id="play-again-btn">
                🔄 Restart Match
              </button>
            ) : (
              <button className="btn-primary" disabled={true} id="play-again-btn" style={{ opacity: 0.6, cursor: 'not-allowed' }}>
                ⏳ Waiting for Host...
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
