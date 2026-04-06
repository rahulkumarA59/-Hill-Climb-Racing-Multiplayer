import { useState, useCallback, useMemo, useEffect } from 'react';
import StartScreen from './components/StartScreen';
import LobbyScreen from './components/LobbyScreen';
import GameScreen from './components/GameScreen';
import ResultScreen from './components/ResultScreen';
import { soundManager } from './game/audio/SoundManager';
import EventBus from './EventBus';
import socket from './socket';
import './App.css';

function App() {
  const [screen, setScreen] = useState('start'); // start | lobby | game | result
  const [room, setRoom] = useState(null);
  const [playerName, setPlayerName] = useState('');
  const [gameData, setGameData] = useState(null);
  const [results, setResults] = useState(null);
  const [gameMode, setGameMode] = useState('multiplayer'); // 'solo' | 'multiplayer'
  const [deathSnapshot, setDeathSnapshot] = useState(null);

  useEffect(() => {
    const handleSnapshot = (base64Img) => {
      setDeathSnapshot(base64Img);
    };

    EventBus.on('deathSnapshot', handleSnapshot);
    return () => EventBus.off('deathSnapshot', handleSnapshot);
  }, []);

  // Global gameStart listener for multiplayer restarts
  useEffect(() => {
    const handleServerGameStart = (data) => {
      setDeathSnapshot(null);
      setResults(null);
      setGameData({ ...data, mode: 'multiplayer' });
      soundManager.stopLobbyBGM();
      setScreen('game');
    };

    socket.on('gameStart', handleServerGameStart);
    return () => socket.off('gameStart', handleServerGameStart);
  }, []);

  const isHost = gameMode === 'multiplayer' && room?.hostId === socket.id;

  // ── Multiplayer flow: Start → Lobby → Game ──
  const handleJoinLobby = useCallback((roomData, name) => {
    setRoom(roomData);
    setPlayerName(name);
    setGameMode('multiplayer');
    setScreen('lobby');
    soundManager.startLobbyBGM();
  }, []);

  const handleGameStart = useCallback((data) => {
    setGameData({ ...data, mode: gameMode });
    soundManager.stopLobbyBGM();
    setScreen('game');
  }, [gameMode]);

  // ── Solo flow: Start → Game (skip lobby) ──
  const handleStartSolo = useCallback(({ level, playerName: name, vehicleType }) => {
    setGameMode('solo');
    setPlayerName(name);
    setRoom(null);
    setGameData({
      level,
      mode: 'solo',
      players: [{
        id: 'solo-player',
        name,
        color: '#00d4ff',
        isHost: true,
        vehicle: vehicleType || 'car'
      }]
    });
    soundManager.stopLobbyBGM();
    setScreen('game');
  }, []);

  // ── Bots flow: Start → Game with 3 AI bots ──
  const handleStartBots = useCallback(({ level, playerName: name, vehicleType }) => {
    setGameMode('bots');
    setPlayerName(name);
    setRoom(null);

    const playerVehicle = vehicleType || 'car';

    setGameData({
      level,
      mode: 'bots',
      players: [
        { id: 'solo-player', name, color: '#00d4ff', isHost: true, vehicle: playerVehicle },
        { id: 'bot-1', name: 'Speed Demon', color: '#ff4757', vehicle: playerVehicle, isBot: true, difficulty: 'hard' },
        { id: 'bot-2', name: 'Road Runner', color: '#2ed573', vehicle: playerVehicle, isBot: true, difficulty: 'medium' },
        { id: 'bot-3', name: 'Rookie Rick', color: '#ffa502', vehicle: playerVehicle, isBot: true, difficulty: 'easy' },
      ]
    });
    soundManager.stopLobbyBGM();
    setScreen('game');
  }, []);

  const handleGameEnd = useCallback((data) => {
    setResults({ ...data, mode: gameMode });
    setScreen('result');
    soundManager.startLobbyBGM();
  }, [gameMode]);

  const handlePlayAgain = useCallback((roomData) => {
    if (gameMode === 'solo') {
      setDeathSnapshot(null);
      setResults(null);
      handleStartSolo({ 
        level: gameData.level, 
        playerName, 
        vehicleType: gameData.players[0].vehicle 
      });
    } else if (gameMode === 'bots') {
      setDeathSnapshot(null);
      setResults(null);
      handleStartBots({ 
        level: gameData.level, 
        playerName, 
        vehicleType: gameData.players[0].vehicle 
      });
    } else {
      if (room && room.hostId === socket.id) {
        socket.emit('restartGame');
      }
    }
  }, [gameMode, gameData, playerName, room, handleStartSolo, handleStartBots]);

  const handleBackToMenu = useCallback(() => {
    setRoom(null);
    setResults(null);
    setGameData(null);
    setDeathSnapshot(null);
    setPlayerName('');
    setGameMode('multiplayer');
    setScreen('start');
    soundManager.startLobbyBGM();
  }, []);

  const handleLeaveLobby = useCallback(() => {
    setRoom(null);
    setScreen('start');
    soundManager.startLobbyBGM();
  }, []);

  // Background particles
  const particles = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 20; i++) {
      arr.push({
        id: i,
        left: Math.random() * 100,
        size: 2 + Math.random() * 4,
        duration: 10 + Math.random() * 20,
        delay: Math.random() * 15,
        color: Math.random() > 0.5 ? 'rgba(0, 212, 255, 0.15)' : 'rgba(123, 47, 247, 0.15)'
      });
    }
    return arr;
  }, []);

  return (
    <div className="app-container">
      {/* Background particles for non-game screens */}
      {screen !== 'game' && (
        <div className="bg-particles">
          {particles.map(p => (
            <div
              key={p.id}
              className="particle"
              style={{
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.size}px`,
                backgroundColor: p.color,
                animationDuration: `${p.duration}s`,
                animationDelay: `${p.delay}s`
              }}
            />
          ))}
        </div>
      )}

      {screen === 'start' && (
        <StartScreen
          onJoinLobby={handleJoinLobby}
          onStartSolo={handleStartSolo}
          onStartBots={handleStartBots}
        />
      )}

      {screen === 'lobby' && room && (
        <LobbyScreen
          room={room}
          playerName={playerName}
          onGameStart={handleGameStart}
          onLeave={handleLeaveLobby}
        />
      )}

      {screen === 'game' && gameData && (
        <GameScreen
          gameData={gameData}
          onGameEnd={handleGameEnd}
          onExitGame={handleBackToMenu}
          mode={gameMode}
        />
      )}

      {screen === 'result' && (
        <ResultScreen
          results={results}
          onPlayAgain={handlePlayAgain}
          onBackToMenu={handleBackToMenu}
          mode={gameMode}
          deathSnapshot={deathSnapshot}
          isHost={isHost}
        />
      )}
    </div>
  );
}

export default App;
