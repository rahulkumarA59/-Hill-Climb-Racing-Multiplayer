import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import socket from '../socket';
import LEVEL_CONFIGS from '../game/levels/LevelConfig';
import './StartScreen.css';

export default function StartScreen({ onJoinLobby, onStartSolo, onStartBots }) {
  const [playerName, setPlayerName] = useState('');
  const [roomCode, setRoomCode] = useState('');
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(socket.connected);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState(null); // null | 'solo' | 'bots' | 'multiplayer'
  const [soloLevel, setSoloLevel] = useState(null);
  const [vehicleType, setVehicleType] = useState('car'); // 'car' | 'bike'
  const [mousePos, setMousePos] = useState({ x: 50, y: 50 });
  const containerRef = useRef(null);

  // Track mouse for spotlight effect
  const handleMouseMove = useCallback((e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setMousePos({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100
    });
  }, []);

  useEffect(() => {
    setConnected(socket.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    const timer = setTimeout(() => setConnected(socket.connected), 500);
    return () => {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, []);

  // Generate terrain silhouette points
  const terrainPoints = useMemo(() => {
    const points = [];
    for (let x = 0; x <= 100; x += 2) {
      const y = 75 + Math.sin(x * 0.15) * 8 + Math.sin(x * 0.08 + 2) * 12 + Math.sin(x * 0.25 + 5) * 4;
      points.push(`${x}% ${y}%`);
    }
    return `polygon(0% 100%, ${points.join(', ')}, 100% 100%)`;
  }, []);

  // Generate particles
  const particles = useMemo(() => {
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

  const handleCreate = () => {
    if (!playerName.trim()) { setError('Please enter your name'); return; }
    setLoading(true); setError('');
    socket.emit('createRoom', { playerName: playerName.trim(), vehicleType }, (response) => {
      setLoading(false);
      if (response.success) onJoinLobby(response.room, playerName.trim());
      else setError(response.error || 'Failed to create room');
    });
  };

  const handleJoin = () => {
    if (!playerName.trim()) { setError('Please enter your name'); return; }
    if (!roomCode.trim()) { setError('Please enter room code'); return; }
    setLoading(true); setError('');
    socket.emit('joinRoom', { roomCode: roomCode.trim().toUpperCase(), playerName: playerName.trim(), vehicleType }, (response) => {
      setLoading(false);
      if (response.success) onJoinLobby(response.room, playerName.trim());
      else setError(response.error || 'Failed to join room');
    });
  };

  const handleSoloStart = (level) => {
    if (!playerName.trim()) { setError('Please enter your name'); return; }
    onStartSolo({ level, playerName: playerName.trim(), vehicleType });
  };

  const handleBotsStart = (level) => {
    if (!playerName.trim()) { setError('Please enter your name'); return; }
    onStartBots({ level, playerName: playerName.trim(), vehicleType });
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      if (mode === 'multiplayer') roomCode.trim() ? handleJoin() : handleCreate();
    }
  };

  const mapColors = {
    1: '#4CAF50', 2: '#D2961B', 3: '#FF4444',
    4: '#FFD700', 5: '#B0C4DE', 6: '#8A2BE2'
  };

  // ══════════════════════════════════════════
  //  HOME PAGE — Mode Selection
  // ══════════════════════════════════════════
  if (mode === null) {
    return (
      <div className="home-screen" ref={containerRef} onMouseMove={handleMouseMove}>
        {/* Dynamic cursor spotlight */}
        <div className="cursor-spotlight" style={{
          background: `radial-gradient(circle at ${mousePos.x}% ${mousePos.y}%, rgba(0,212,255,0.06) 0%, transparent 50%)`
        }} />

        {/* Animated background layers */}
        <div className="bg-layer bg-grid" />
        <div className="bg-layer bg-terrain" style={{ clipPath: terrainPoints }} />
        <div className="bg-layer bg-terrain bg-terrain-2" style={{
          clipPath: terrainPoints,
          transform: 'scaleX(-1) translateY(30px)'
        }} />

        {/* Floating particles */}
        <div className="particle-field">
          {particles.map(p => (
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

        {/* Speed lines */}
        <div className="speed-lines">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="speed-line" style={{
              top: `${15 + i * 14}%`,
              animationDelay: `${i * 0.4}s`,
              opacity: 0.03 + Math.random() * 0.04
            }} />
          ))}
        </div>

        {/* Main content */}
        <div className="home-content">
          {/* Hero Section */}
          <div className="hero-section">
            <div className="hero-badge">🏁 READY TO RACE?</div>
            <h1 className="hero-title">
              <span className="title-line-1">TERRAIN CLIMB</span>
              <span className="title-line-2">RACING</span>
            </h1>
            <p className="hero-tagline">Conquer the terrain. Dominate the race.</p>

            {/* Animated car */}
            <div className="hero-car">
              <svg width="160" height="70" viewBox="0 0 160 70" className="car-svg">
                <defs>
                  <linearGradient id="heroCarGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                    <stop offset="0%" stopColor="#00d4ff" />
                    <stop offset="50%" stopColor="#7b2ff7" />
                    <stop offset="100%" stopColor="#ff4757" />
                  </linearGradient>
                  <filter id="carGlow">
                    <feGaussianBlur stdDeviation="3" result="blur" />
                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                  </filter>
                </defs>
                <rect x="15" y="28" width="130" height="22" rx="8" fill="url(#heroCarGrad)" filter="url(#carGlow)" />
                <rect x="45" y="10" width="60" height="22" rx="6" fill="#1a1a4e" stroke="#00d4ff" strokeWidth="1" opacity="0.9" />
                <rect x="50" y="14" width="20" height="14" rx="3" fill="#87CEEB" opacity="0.5" />
                <rect x="74" y="14" width="20" height="14" rx="3" fill="#87CEEB" opacity="0.5" />
                <circle cx="40" cy="55" r="13" fill="#1a1a2e" stroke="#333" strokeWidth="2" />
                <circle cx="40" cy="55" r="8" fill="#444" />
                <circle cx="40" cy="55" r="3" fill="#666" />
                <circle cx="120" cy="55" r="13" fill="#1a1a2e" stroke="#333" strokeWidth="2" />
                <circle cx="120" cy="55" r="8" fill="#444" />
                <circle cx="120" cy="55" r="3" fill="#666" />
                <circle cx="143" cy="34" r="4" fill="#FFD700" opacity="0.9" />
                <circle cx="143" cy="34" r="7" fill="#FFD700" opacity="0.2" />
              </svg>
              <div className="car-exhaust">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="exhaust-puff" style={{ animationDelay: `${i * 0.3}s` }} />
                ))}
              </div>
              <div className="car-ground-glow" />
            </div>
          </div>

          {/* Mode Selection Buttons */}
          <div className="mode-buttons">
            <button className="game-btn btn-solo-mode" onClick={() => setMode('solo')} id="play-solo-btn">
              <div className="btn-icon">🎮</div>
              <div className="btn-content">
                <div className="btn-title">PLAY SOLO</div>
                <div className="btn-desc">No timer • Infinite play • All maps</div>
              </div>
              <div className="btn-arrow">→</div>
              <div className="btn-glow btn-glow-cyan" />
            </button>

            <button className="game-btn btn-bots-mode" onClick={() => setMode('bots')} id="play-bots-btn">
              <div className="btn-icon">🤖</div>
              <div className="btn-content">
                <div className="btn-title">PLAY WITH BOTS</div>
                <div className="btn-desc">Race against 3 AI opponents</div>
              </div>
              <div className="btn-arrow">→</div>
              <div className="btn-glow btn-glow-orange" />
            </button>

            <button className="game-btn btn-multi-mode" onClick={() => setMode('multiplayer')} id="play-multiplayer-btn">
              <div className="btn-icon">👥</div>
              <div className="btn-content">
                <div className="btn-title">MULTIPLAYER</div>
                <div className="btn-desc">Compete with friends • Ranked</div>
              </div>
              <div className="btn-arrow">→</div>
              <div className="btn-glow btn-glow-purple" />
            </button>
          </div>

          {/* Map Preview Strip */}
          <div className="map-strip">
            <div className="map-strip-label">🗺️ MAPS</div>
            <div className="map-strip-cards">
              {Object.keys(LEVEL_CONFIGS).map(Number).map(level => {
                const config = LEVEL_CONFIGS[level];
                return (
                  <div key={level} className="map-preview-card" style={{
                    borderColor: mapColors[level],
                    boxShadow: `0 0 12px ${mapColors[level]}22`
                  }}>
                    <div className="map-preview-dot" style={{ background: mapColors[level] }} />
                    <div className="map-preview-name">{config.name}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Connection indicator */}
        <div className="connection-pill">
          <div className={`conn-dot ${connected ? '' : 'off'}`} />
          <span>{connected ? 'Online' : 'Connecting...'}</span>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════
  //  SOLO — Level Selection (Grid UI)
  // ══════════════════════════════════════════
  if (mode === 'solo' || mode === 'bots') {
    const isBots = mode === 'bots';
    const mapMeta = {
      1: { emoji: '🌿', gradient: ['#4CAF50', '#2E7D32'], tagline: 'Smooth rolling hills' },
      2: { emoji: '🏜️', gradient: ['#D2961B', '#8B6914'], tagline: 'Rocky canyons & gaps' },
      3: { emoji: '🌋', gradient: ['#FF4444', '#8B0000'], tagline: 'Extreme volcanic terrain' },
      4: { emoji: '🛣️', gradient: ['#FFD700', '#CC8400'], tagline: 'High-speed jumps & dips' },
      5: { emoji: '🌙', gradient: ['#B0C4DE', '#4F6F8F'], tagline: 'Low gravity craters' },
      6: { emoji: '🏙️', gradient: ['#8A2BE2', '#4B0082'], tagline: 'Precision gap jumping' },
    };

    return (
      <div className="home-screen" ref={containerRef} onMouseMove={handleMouseMove}>
        <div className="cursor-spotlight" style={{
          background: `radial-gradient(circle at ${mousePos.x}% ${mousePos.y}%, rgba(0,212,255,0.06) 0%, transparent 50%)`
        }} />
        <div className="bg-layer bg-grid" />

        <div className="home-content solo-content screen-enter">
          <div className="page-header">
            <button className="back-btn" onClick={() => { setMode(null); setError(''); }}>
              ← Back
            </button>
            <div className="page-title">
              <h2>{isBots ? '🤖 PLAY WITH BOTS' : '🎮 SOLO MODE'}</h2>
              <p>{isBots ? 'Race against 3 AI opponents' : 'Choose your battleground'}</p>
            </div>
          </div>

          {/* Compact top row: Name + Vehicle */}
          <div className="solo-top-row">
            <div className="name-input-compact">
              <label>PLAYER NAME</label>
              <input
                type="text"
                className="input-field input-glow"
                placeholder="Enter your name..."
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                maxLength={15}
                id="solo-name-input"
              />
            </div>
            <div className="vehicle-selector-compact">
              <label>VEHICLE</label>
              <div className="vehicle-options">
                <button 
                  className={`vehicle-btn ${vehicleType === 'car' ? 'selected' : ''}`}
                  onClick={() => setVehicleType('car')}
                >
                  🚙 CAR
                </button>
                <button 
                  className={`vehicle-btn ${vehicleType === 'bike' ? 'selected' : ''}`}
                  onClick={() => setVehicleType('bike')}
                >
                  🏍️ BIKE
                </button>
              </div>
            </div>
          </div>

          {/* Map Selection Label */}
          <div className="map-section-label">
            <span className="label-icon">🗺️</span>
            <span>SELECT MAP</span>
            <div className="label-line" />
          </div>

          {/* 3-Column Map Grid */}
          <div className="map-grid">
            {Object.keys(LEVEL_CONFIGS).map(Number).map(level => {
              const config = LEVEL_CONFIGS[level];
              const meta = mapMeta[level];
              const isSelected = soloLevel === level;
              return (
                <div
                  key={level}
                  className={`map-card ${isSelected ? 'selected' : ''}`}
                  onClick={() => setSoloLevel(level)}
                  id={`map-card-${level}`}
                >
                  {/* Thumbnail Preview */}
                  <div className="map-thumb" style={{
                    background: `linear-gradient(135deg, ${meta.gradient[0]}44, ${meta.gradient[1]}44)`
                  }}>
                    <div className="map-thumb-emoji">{meta.emoji}</div>
                    <svg className="map-thumb-terrain" viewBox="0 0 200 60" preserveAspectRatio="none">
                      <path
                        d={`M0,40 C30,${30 + level * 3},50,${20 + level * 5},80,${35 - level * 2} C110,${50 - level * 3},140,${25 + level * 2},170,${30 + level * 4} C190,${35 - level},200,40,200,40 L200,60 L0,60 Z`}
                        fill={meta.gradient[0]}
                        opacity="0.6"
                      />
                      <path
                        d={`M0,48 C40,${38 + level * 2},70,${42 - level},100,${45 + level * 2} C130,${38 - level},160,${48 + level},200,45 L200,60 L0,60 Z`}
                        fill={meta.gradient[1]}
                        opacity="0.5"
                      />
                    </svg>
                    {isSelected && <div className="map-thumb-check">✓</div>}
                  </div>

                  {/* Card Info */}
                  <div className="map-card-body">
                    <div className="map-card-name">{config.name}</div>
                    <div className="map-card-tagline">{meta.tagline}</div>
                    <div className={`map-card-badge diff-${config.difficulty.toLowerCase()}`}>
                      {config.difficulty}
                    </div>
                  </div>

                  {/* Selected Glow */}
                  {isSelected && <div className="map-card-glow" style={{
                    boxShadow: `0 0 25px ${meta.gradient[0]}55, inset 0 0 25px ${meta.gradient[0]}11`,
                    borderColor: meta.gradient[0]
                  }} />}
                </div>
              );
            })}
          </div>

          {error && <div className="error-msg">{error}</div>}

          <button
            className="game-btn btn-start-race"
            onClick={() => isBots ? handleBotsStart(soloLevel) : handleSoloStart(soloLevel)}
            disabled={!soloLevel}
            id="solo-start-btn"
          >
            <div className="btn-icon">🏁</div>
            <div className="btn-content">
              <div className="btn-title">START RACE</div>
            </div>
            <div className="btn-glow btn-glow-green" />
          </button>
        </div>
      </div>
    );
  }

  // ══════════════════════════════════════════
  //  MULTIPLAYER — Create / Join Room
  // ══════════════════════════════════════════
  return (
    <div className="home-screen" ref={containerRef} onMouseMove={handleMouseMove}>
      <div className="cursor-spotlight" style={{
        background: `radial-gradient(circle at ${mousePos.x}% ${mousePos.y}%, rgba(123,47,247,0.06) 0%, transparent 50%)`
      }} />
      <div className="bg-layer bg-grid" />

      <div className="connection-pill">
        <div className={`conn-dot ${connected ? '' : 'off'}`} />
        <span>{connected ? 'Online' : 'Connecting...'}</span>
      </div>

      <div className="home-content multi-content screen-enter">
        <div className="page-header">
          <button className="back-btn" onClick={() => { setMode(null); setError(''); }}>
            ← Back
          </button>
          <div className="page-title">
            <h2>👥 MULTIPLAYER</h2>
            <p>Race against friends</p>
          </div>
        </div>

        <div className="multi-form glass-card">
          <div className="name-input-row">
            <label>PLAYER NAME</label>
            <input
              type="text"
              className="input-field input-glow"
              placeholder="Enter your name..."
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              onKeyDown={handleKeyPress}
              maxLength={15}
              id="player-name-input"
            />
          </div>

          <div className="vehicle-selector multi-vehicle">
            <label>VEHICLE</label>
            <div className="vehicle-options">
              <button 
                className={`vehicle-btn ${vehicleType === 'car' ? 'selected' : ''}`}
                onClick={() => setVehicleType('car')}
              >
                🚙 CAR
              </button>
              <button 
                className={`vehicle-btn ${vehicleType === 'bike' ? 'selected' : ''}`}
                onClick={() => setVehicleType('bike')}
              >
                🏍️ BIKE
              </button>
            </div>
          </div>

          <button
            className="game-btn btn-create-room"
            onClick={handleCreate}
            disabled={loading || !connected}
            id="create-room-btn"
          >
            <div className="btn-icon">🏁</div>
            <div className="btn-content">
              <div className="btn-title">{loading ? 'CREATING...' : 'CREATE ROOM'}</div>
              <div className="btn-desc">Start a new race lobby</div>
            </div>
            <div className="btn-glow btn-glow-purple" />
          </button>

          <div className="form-divider">
            <div className="divider-line" />
            <span>OR JOIN</span>
            <div className="divider-line" />
          </div>

          <div className="join-row">
            <input
              type="text"
              className="input-field input-glow input-code"
              placeholder="ROOM CODE"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              onKeyDown={handleKeyPress}
              maxLength={6}
              id="room-code-input"
            />
            <button
              className="btn-join-room"
              onClick={handleJoin}
              disabled={loading || !connected}
              id="join-room-btn"
            >
              {loading ? '...' : 'JOIN →'}
            </button>
          </div>

          {error && <div className="error-msg">{error}</div>}
        </div>
      </div>
    </div>
  );
}
